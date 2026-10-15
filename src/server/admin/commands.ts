// 채팅 명령어 (/로 시작). 일반 명령어와 운영자(GM/관리자) 명령어
import { CLASS_FALLBACK_NAMES, ROLE_NAMES, formatNumber, type ClassId, type Role, type StatKey } from '../../shared/constants';
import { ghostRecall } from '../systems/movement';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import type { AdminResult, AdminService } from './AdminService';

type Level = 'player' | 'gm' | 'admin';

interface Ctx {
  world: World;
  p: Player;
  admin: AdminService;
}

interface Command {
  names: string[];
  level: Level;
  usage: string;
  desc: string;
  run: (ctx: Ctx, args: string[], rest: string) => void | Promise<void>;
}

const STAT_ALIASES: Record<string, StatKey | 'all'> = {
  힘: 'str',
  str: 'str',
  지능: 'int',
  int: 'int',
  지혜: 'wis',
  wis: 'wis',
  건강: 'con',
  체력: 'con',
  con: 'con',
  민첩: 'dex',
  dex: 'dex',
  전체: 'all',
  모두: 'all',
  all: 'all',
};

export function parseClass(s: string | undefined): ClassId | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  for (const [id, name] of Object.entries(CLASS_FALLBACK_NAMES)) if (v === id || v === name) return id as ClassId;
  return null;
}

function parseRole(s: string | undefined): Role | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  if (v === 'player' || v === '일반' || v === '플레이어') return 'player';
  if (v === 'gm' || v === '운영자') return 'gm';
  if (v === 'admin' || v === '관리자') return 'admin';
  return null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = s.replace(/[,_]/g, '').trim();
  // 1만, 1억 같은 한글 단위 지원
  const m = /^(-?\d+(?:\.\d+)?)(만|억|k|m)?$/i.exec(v);
  if (!m) return null;
  const mult = { 만: 1e4, 억: 1e8, k: 1e3, m: 1e6 }[(m[2] ?? '').toLowerCase() as '만' | '억' | 'k' | 'm'] ?? 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? Math.round(n) : null;
};

function report(p: Player, r: AdminResult): void {
  if (r.ok) p.sys(r.msg);
  else p.err(r.msg);
}

/** 첫 인자가 캐릭터 이름이면 대상, 아니면 자기 자신 */
function split(ctx: Ctx, args: string[], minRest: number): { target: string; rest: string[] } {
  if (args.length > minRest && args[0] && (ctx.world.findPlayer(args[0]) || ctx.world.store.has(args[0]))) {
    return { target: args[0], rest: args.slice(1) };
  }
  return { target: ctx.p.name, rest: args };
}

const COMMANDS: Command[] = [
  // ───────────── 일반 ─────────────
  {
    names: ['도움말', 'help', '?', '명령어'],
    level: 'player',
    usage: '/도움말',
    desc: '명령어 목록을 봅니다.',
    run: ({ p }) => {
      const lines = COMMANDS.filter((c) => allowed(p, c.level)).map((c) => `${c.usage} — ${c.desc}`);
      p.sys('──── 명령어 ────');
      for (const l of lines) p.sys(l);
      p.sys('채팅 접두어: !외치기  @이름 귓속말  #그룹말');
    },
  },
  {
    names: ['누구', 'who', '접속자'],
    level: 'player',
    usage: '/누구',
    desc: '접속 중인 사람을 봅니다.',
    run: ({ world, p }) => {
      const list = [...world.players.values()].map((o) => `${o.name}(${o.level}${o.isGm ? ',GM' : ''})`);
      p.sys(`접속자 ${list.length}명: ${list.join(', ')}`);
    },
  },
  {
    names: ['귓', 'w', '귓속말', 'whisper'],
    level: 'player',
    usage: '/귓 이름 내용',
    desc: '귓속말을 보냅니다. (@이름 내용 도 가능)',
    run: ({ world, p }, args) => whisper(world, p, args[0] ?? '', args.slice(1).join(' ')),
  },
  {
    names: ['답장', 'r', 'reply'],
    level: 'player',
    usage: '/답장 내용',
    desc: '마지막으로 귓속말한 사람에게 답장합니다.',
    run: ({ world, p }, _a, rest) => {
      if (!p.lastWhisperFrom) return p.err('답장할 상대가 없습니다.');
      whisper(world, p, p.lastWhisperFrom, rest);
    },
  },
  {
    names: ['외치기', 'shout', 's'],
    level: 'player',
    usage: '/외치기 내용',
    desc: '같은 지역의 모두에게 외칩니다. (!내용 도 가능)',
    run: ({ p }, _a, rest) => shout(p, rest),
  },
  {
    names: ['파티', '그룹', 'group', 'party'],
    level: 'player',
    usage: '/파티 초대|수락|거절|탈퇴|추방 [이름]',
    desc: '그룹(파티)을 관리합니다. #내용 으로 그룹 대화.',
    run: ({ world, p }, args) => {
      const sub = (args[0] ?? '').toLowerCase();
      const name = args[1] ?? '';
      if (['초대', 'invite', 'i'].includes(sub)) return world.groups.invite(p, name);
      if (['수락', 'accept', 'a', 'y'].includes(sub)) return world.groups.reply(p, true);
      if (['거절', 'decline', 'n'].includes(sub)) return world.groups.reply(p, false);
      if (['탈퇴', 'leave', 'l'].includes(sub)) return world.groups.leave(p);
      if (['추방', 'kick', 'k'].includes(sub)) return world.groups.kick(p, name);
      if (sub && world.findPlayer(sub)) return world.groups.invite(p, sub);
      p.err('사용법: /파티 초대 이름 | /파티 수락 | /파티 거절 | /파티 탈퇴 | /파티 추방 이름');
    },
  },
  {
    names: ['위치', 'pos', 'loc'],
    level: 'player',
    usage: '/위치',
    desc: '현재 위치를 봅니다.',
    run: ({ p }) => p.sys(`${p.map?.def.name ?? '?'} (${p.map?.id}) — X ${p.x}, Y ${p.y}`),
  },
  {
    names: ['귀환', 'recall'],
    level: 'player',
    usage: '/귀환',
    desc: '유령 상태일 때 마을로 돌아갑니다. (R 키)',
    run: ({ world, p }) => ghostRecall(world, p),
  },

  // ───────────── 운영자: 성장 ─────────────
  {
    names: ['레벨', 'level', 'lv'],
    level: 'gm',
    usage: '/레벨 [이름] 레벨',
    desc: '레벨을 설정합니다. (능력치 포인트 자동 지급)',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const n = num(rest[0]);
      if (n === null) return ctx.p.err('사용법: /레벨 [이름] 레벨');
      report(ctx.p, ctx.admin.setLevel(ctx.p.name, target, n));
    },
  },
  {
    names: ['레벨업', 'levelup', 'lvup'],
    level: 'gm',
    usage: '/레벨업 [이름] [수]',
    desc: '레벨을 올립니다. (기본 1)',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 0);
      const n = num(rest[0]) ?? 1;
      report(ctx.p, ctx.admin.addLevels(ctx.p.name, target, n));
    },
  },
  {
    names: ['경험치', 'exp'],
    level: 'gm',
    usage: '/경험치 [이름] 양',
    desc: '경험치를 줍니다. (예: /경험치 100만)',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const n = num(rest[0]);
      if (n === null) return ctx.p.err('사용법: /경험치 [이름] 양');
      report(ctx.p, ctx.admin.addExp(ctx.p.name, target, n));
    },
  },
  {
    names: ['만렙', 'max', 'maxout'],
    level: 'gm',
    usage: '/만렙 [이름] [직업]',
    desc: '만렙 + 능력치 최대 + 모든 기술 + 최고 장비를 한 번에!',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 0);
      const cls = rest[0] ? parseClass(rest[0]) : null;
      if (rest[0] && !cls) return ctx.p.err('직업: 전사/도적/마법사/성직자/무도가');
      report(ctx.p, ctx.admin.maxOut(ctx.p.name, target, cls ?? undefined));
    },
  },
  {
    names: ['스탯', 'stat', '능력치'],
    level: 'gm',
    usage: '/스탯 [이름] 힘|지능|지혜|건강|민첩|전체 값',
    desc: '능력치를 설정합니다.',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 2);
      const stat = STAT_ALIASES[(rest[0] ?? '').toLowerCase()];
      const n = num(rest[1]);
      if (!stat || n === null) return ctx.p.err('사용법: /스탯 [이름] 힘|지능|지혜|건강|민첩|전체 값');
      report(ctx.p, ctx.admin.setStat(ctx.p.name, target, stat, n));
    },
  },
  {
    names: ['스탯최대', 'maxstat'],
    level: 'gm',
    usage: '/스탯최대 [이름]',
    desc: '모든 능력치를 최대치로 만듭니다.',
    run: (ctx, args) => {
      const { target } = split(ctx, args, 0);
      report(ctx.p, ctx.admin.maxStats(ctx.p.name, target));
    },
  },
  {
    names: ['포인트', 'points'],
    level: 'gm',
    usage: '/포인트 [이름] 수',
    desc: '능력치 포인트를 줍니다.',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const n = num(rest[0]);
      if (n === null) return ctx.p.err('사용법: /포인트 [이름] 수');
      report(ctx.p, ctx.admin.addStatPoints(ctx.p.name, target, n));
    },
  },
  {
    names: ['자동분배', 'autostat'],
    level: 'gm',
    usage: '/자동분배 [이름]',
    desc: '남은 능력치 포인트를 직업에 맞게 분배합니다.',
    run: (ctx, args) => report(ctx.p, ctx.admin.autoStats(ctx.p.name, split(ctx, args, 0).target)),
  },
  {
    names: ['스탯초기화', 'resetstat'],
    level: 'gm',
    usage: '/스탯초기화 [이름]',
    desc: '능력치를 초기화하고 포인트를 돌려줍니다.',
    run: (ctx, args) => report(ctx.p, ctx.admin.resetStats(ctx.p.name, split(ctx, args, 0).target)),
  },
  {
    names: ['직업', 'class'],
    level: 'gm',
    usage: '/직업 [이름] 전사|도적|마법사|성직자|무도가|평민',
    desc: '직업을 바꿉니다.',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const cls = parseClass(rest[0]);
      if (!cls) return ctx.p.err('사용법: /직업 [이름] 전사|도적|마법사|성직자|무도가|평민');
      report(ctx.p, ctx.admin.setClass(ctx.p.name, target, cls));
    },
  },
  {
    names: ['배우기', 'learn'],
    level: 'gm',
    usage: '/배우기 [이름] 전부|기술이름',
    desc: '기술/마법을 배웁니다.',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const what = rest.join(' ');
      if (!what || what === '전부' || what === 'all' || what === '모두') return report(ctx.p, ctx.admin.learnAll(ctx.p.name, target));
      report(ctx.p, ctx.admin.learnAbility(ctx.p.name, target, what));
    },
  },
  {
    names: ['장비', 'gear'],
    level: 'gm',
    usage: '/장비 [이름]',
    desc: '레벨과 직업에 맞는 최고 장비를 착용시킵니다.',
    run: (ctx, args) => report(ctx.p, ctx.admin.giveGear(ctx.p.name, split(ctx, args, 0).target)),
  },
  {
    names: ['아이템', 'item', 'give'],
    level: 'gm',
    usage: '/아이템 [이름] 아이템이름 [개수]',
    desc: '아이템을 줍니다. (예: /아이템 엘릭서 10)',
    run: (ctx, args) => {
      let target = ctx.p.name;
      let list = [...args];
      if (list.length >= 2 && (ctx.world.findPlayer(list[0]!) || ctx.world.store.has(list[0]!))) {
        const restQuery = list.slice(1).filter((x) => num(x) === null).join(' ');
        if (ctx.world.data.findItem(restQuery)) {
          target = list[0]!;
          list = list.slice(1);
        }
      }
      let qty = 1;
      const last = num(list[list.length - 1]);
      if (list.length > 1 && last !== null) {
        qty = last;
        list = list.slice(0, -1);
      }
      const query = list.join(' ');
      if (!query) return ctx.p.err('사용법: /아이템 [이름] 아이템이름 [개수]');
      report(ctx.p, ctx.admin.giveItem(ctx.p.name, target, query, qty));
    },
  },
  {
    names: ['골드', 'gold', '돈'],
    level: 'gm',
    usage: '/골드 [이름] 양',
    desc: '골드를 줍니다. (음수면 뺏습니다)',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 1);
      const n = num(rest[0]);
      if (n === null) return ctx.p.err('사용법: /골드 [이름] 양');
      report(ctx.p, ctx.admin.addGold(ctx.p.name, target, n));
    },
  },
  {
    names: ['보너스', 'bonus'],
    level: 'gm',
    usage: '/보너스 [이름] 체력 마나',
    desc: '승급 보너스(추가 최대 체력/마나)를 설정합니다.',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 2);
      const hp = num(rest[0]);
      const mp = num(rest[1]);
      if (hp === null || mp === null) return ctx.p.err('사용법: /보너스 [이름] 체력 마나');
      report(ctx.p, ctx.admin.setBonus(ctx.p.name, target, hp, mp));
    },
  },
  {
    names: ['회복', 'heal'],
    level: 'gm',
    usage: '/회복 [이름]',
    desc: '체력/마나를 모두 회복합니다. (유령이면 부활)',
    run: (ctx, args) => report(ctx.p, ctx.admin.heal(ctx.p.name, split(ctx, args, 0).target)),
  },
  {
    names: ['부활', 'revive'],
    level: 'gm',
    usage: '/부활 [이름]',
    desc: '유령을 부활시킵니다.',
    run: (ctx, args) => report(ctx.p, ctx.admin.revive(ctx.p.name, split(ctx, args, 0).target)),
  },
  {
    names: ['무적', 'god'],
    level: 'gm',
    usage: '/무적 [이름] [켜기|끄기]',
    desc: '무적 모드 (피해를 받지 않고 몬스터가 공격하지 않음, 마나 소모 없음)',
    run: (ctx, args) => {
      const { target, rest } = split(ctx, args, 0);
      const v = (rest[0] ?? '').toLowerCase();
      const on = ['켜기', 'on', '1'].includes(v) ? true : ['끄기', 'off', '0'].includes(v) ? false : null;
      report(ctx.p, ctx.admin.setGod(ctx.p.name, target, on));
    },
  },

  // ───────────── 운영자: 이동 ─────────────
  {
    names: ['이동', 'tp', 'teleport'],
    level: 'gm',
    usage: '/이동 맵 [x y]',
    desc: '맵으로 순간이동합니다. (town, forest, crypt1, crypt2, plains, cave, tower, abyss, training)',
    run: (ctx, args) => {
      if (!args[0]) return ctx.p.err('사용법: /이동 맵 [x y]');
      const x = num(args[1]) ?? undefined;
      const y = num(args[2]) ?? undefined;
      report(ctx.p, ctx.admin.teleport(ctx.p.name, ctx.p.name, args[0], x, y));
    },
  },
  {
    names: ['보내기', 'send'],
    level: 'gm',
    usage: '/보내기 이름 맵 [x y]',
    desc: '다른 사람을 맵으로 보냅니다.',
    run: (ctx, args) => {
      if (!args[0] || !args[1]) return ctx.p.err('사용법: /보내기 이름 맵 [x y]');
      report(ctx.p, ctx.admin.teleport(ctx.p.name, args[0], args[1], num(args[2]) ?? undefined, num(args[3]) ?? undefined));
    },
  },
  {
    names: ['소환', 'summon'],
    level: 'gm',
    usage: '/소환 이름',
    desc: '접속 중인 사람을 내 옆으로 데려옵니다.',
    run: ({ world, p, admin }, args) => {
      const t = world.findPlayer(args[0] ?? '');
      if (!t || !p.map) return p.err('접속 중인 사람이 아닙니다.');
      report(p, admin.teleport(p.name, t.name, p.map.id, p.x, p.y));
    },
  },
  {
    names: ['찾아가기', 'goto'],
    level: 'gm',
    usage: '/찾아가기 이름',
    desc: '접속 중인 사람에게 갑니다.',
    run: ({ world, p, admin }, args) => {
      const t = world.findPlayer(args[0] ?? '');
      if (!t || !t.map) return p.err('접속 중인 사람이 아닙니다.');
      report(p, admin.teleport(p.name, p.name, t.map.id, t.x, t.y));
    },
  },

  // ───────────── 운영자: 월드 ─────────────
  {
    names: ['몬스터', 'spawn', '소환몹'],
    level: 'gm',
    usage: '/몬스터 몬스터이름 [수]',
    desc: '내 주변에 몬스터를 소환합니다.',
    run: (ctx, args) => {
      let list = [...args];
      let count = 1;
      const last = num(list[list.length - 1]);
      if (list.length > 1 && last !== null) {
        count = last;
        list = list.slice(0, -1);
      }
      if (list.length === 0) return ctx.p.err('사용법: /몬스터 몬스터이름 [수]');
      report(ctx.p, ctx.admin.spawnMonster(ctx.p, list.join(' '), count));
    },
  },
  {
    names: ['몬스터제거', 'killall', 'clear'],
    level: 'gm',
    usage: '/몬스터제거',
    desc: '현재 맵의 몬스터를 모두 제거합니다. (잠시 후 다시 생김)',
    run: (ctx) => report(ctx.p, ctx.admin.killAll(ctx.p)),
  },
  {
    names: ['공지', 'announce', 'notice'],
    level: 'gm',
    usage: '/공지 내용',
    desc: '전체 공지를 보냅니다.',
    run: (ctx, _a, rest) => report(ctx.p, ctx.admin.announce(ctx.p.name, rest)),
  },
  {
    names: ['정보', 'info'],
    level: 'gm',
    usage: '/정보 이름',
    desc: '캐릭터 정보를 봅니다.',
    run: ({ world, p, admin }, args) => {
      const d = admin.characterDetail(args[0] ?? p.name);
      if (!d) return p.err('캐릭터를 찾을 수 없습니다.');
      const cls = world.data.classes.get(d.classId)?.name ?? d.classId;
      p.sys(
        `${d.name} — ${cls} ${d.level}레벨, 경험치 ${formatNumber(d.exp)}, 골드 ${formatNumber(d.gold)}, ` +
          `힘${d.stats.str} 지능${d.stats.int} 지혜${d.stats.wis} 건강${d.stats.con} 민첩${d.stats.dex}, ` +
          `포인트 ${d.statPoints}, 권한 ${ROLE_NAMES[d.role]}, ${d.online ? '접속 중' : '오프라인'} (${d.mapId} ${d.x},${d.y})`,
      );
    },
  },
  {
    names: ['저장', 'save'],
    level: 'gm',
    usage: '/저장',
    desc: '접속 중인 모든 캐릭터를 즉시 저장합니다.',
    run: (ctx) => report(ctx.p, ctx.admin.saveAll(ctx.p.name)),
  },
  {
    names: ['추방', 'kick'],
    level: 'gm',
    usage: '/추방 이름 [사유]',
    desc: '접속을 강제로 종료시킵니다.',
    run: (ctx, args) => {
      if (!args[0]) return ctx.p.err('사용법: /추방 이름 [사유]');
      report(ctx.p, ctx.admin.kick(ctx.p.name, args[0], args.slice(1).join(' ') || undefined));
    },
  },

  // ───────────── 관리자 전용 ─────────────
  {
    names: ['배율', 'rate'],
    level: 'admin',
    usage: '/배율 경험치|골드|드롭 값',
    desc: '서버 배율을 바꿉니다. (예: /배율 경험치 10)',
    run: (ctx, args) => {
      const key = { 경험치: 'expRate', exp: 'expRate', 골드: 'goldRate', gold: 'goldRate', 드롭: 'dropRate', drop: 'dropRate' }[
        (args[0] ?? '').toLowerCase()
      ];
      const v = args[1] !== undefined ? Number(args[1]) : NaN;
      if (!key || !Number.isFinite(v)) {
        const s = ctx.admin.settings();
        return ctx.p.sys(`현재 배율 — 경험치 x${s.expRate}, 골드 x${s.goldRate}, 드롭 x${s.dropRate}. 사용법: /배율 경험치|골드|드롭 값`);
      }
      report(ctx.p, ctx.admin.updateSettings(ctx.p.name, { [key]: v }));
    },
  },
  {
    names: ['권한', 'role'],
    level: 'admin',
    usage: '/권한 이름 일반|운영자|관리자',
    desc: '권한을 바꿉니다.',
    run: (ctx, args) => {
      const role = parseRole(args[1]);
      if (!args[0] || !role) return ctx.p.err('사용법: /권한 이름 일반|운영자|관리자');
      report(ctx.p, ctx.admin.setRole(ctx.p.name, args[0], role));
    },
  },
  {
    names: ['금지', 'ban'],
    level: 'admin',
    usage: '/금지 이름 [사유]',
    desc: '접속을 금지합니다.',
    run: (ctx, args) => {
      if (!args[0]) return ctx.p.err('사용법: /금지 이름 [사유]');
      report(ctx.p, ctx.admin.ban(ctx.p.name, args[0], args.slice(1).join(' ')));
    },
  },
  {
    names: ['금지해제', 'unban'],
    level: 'admin',
    usage: '/금지해제 이름',
    desc: '접속 금지를 풉니다.',
    run: (ctx, args) => {
      if (!args[0]) return ctx.p.err('사용법: /금지해제 이름');
      report(ctx.p, ctx.admin.unban(ctx.p.name, args[0]));
    },
  },
];

const BY_NAME = new Map<string, Command>();
for (const c of COMMANDS) for (const n of c.names) BY_NAME.set(n.toLowerCase(), c);

function allowed(p: Player, level: Level): boolean {
  if (level === 'player') return true;
  if (level === 'gm') return p.isGm;
  return p.isAdmin;
}

export async function runCommand(world: World, admin: AdminService, p: Player, line: string): Promise<void> {
  const body = line.slice(1).trim();
  if (!body) return;
  const [head, ...args] = body.split(/\s+/);
  const cmd = BY_NAME.get((head ?? '').toLowerCase());
  if (!cmd || !allowed(p, cmd.level)) {
    p.err(`알 수 없는 명령어입니다: /${head}  (/도움말)`);
    return;
  }
  const rest = body.slice((head ?? '').length).trim();
  try {
    await cmd.run({ world, p, admin }, args.filter(Boolean), rest);
  } catch (e) {
    p.err(`명령 실행 중 오류: ${(e as Error).message}`);
  }
}

export function whisper(world: World, p: Player, toName: string, text: string): void {
  const msg = text.trim();
  if (!toName || !msg) return p.err('사용법: @이름 내용  또는  /귓 이름 내용');
  const to = world.findPlayer(toName);
  if (!to) return p.err(`${toName}님은 접속 중이 아닙니다.`);
  to.send({ t: 'chat', ch: 'whisper', from: p.name, text: msg });
  to.lastWhisperFrom = p.name;
  p.send({ t: 'chat', ch: 'whisper', from: `→ ${to.name}`, text: msg });
}

export function shout(p: Player, text: string): void {
  const msg = text.trim();
  if (!msg || !p.map) return;
  p.map.broadcast({ t: 'chat', ch: 'shout', from: p.name, text: msg, id: p.id });
}
