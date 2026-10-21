// NPC 대화와 서비스: 상점, 직업 선택, 기술 배우기(스킬트리), 전직(환골탈태), 승급 장인(승급·교환), 2차 전직,
// 부활, 창고, 이동, 능력치 초기화. 성장 체계의 규칙은 progression.ts, 대화 선택지 key 는 docs/progression.md 8.4
import {
  CLASS_FALLBACK_NAMES,
  NPC_TALK_RANGE,
  dirTowards,
  formatNumber,
  type Dir,
} from '../../shared/constants';
import {
  bigNumber,
  classTier,
  isFirstClass,
  rebirthName,
  secondClassesOf,
  type ConditionCheck,
  type ConditionResult,
} from '../../shared/progression';
import type { NpcService } from '../../shared/types';
import type { DialogOption } from '../../shared/protocol';
import type { CharacterData } from '../storage';
import type { Npc } from '../world/Npc';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import {
  addItem,
  addToStorage,
  allocatedPoints,
  canFit,
  equipError,
  resetStatsOnData,
  setClassOnData,
  stackSize,
  takeFromSlot,
  unequipToBag,
} from './character';
import { cleanseDebuffs, revivePlayer } from './combat';
import {
  ascendOnData,
  beastTypeName,
  checkAscend,
  checkRebirth,
  checkSecondJob,
  chooseBeastTypeOnData,
  classBaseVitals,
  knownBeastType,
  learnEntries,
  learnFromTree,
  pureVitals,
  rebirthOffered,
  rebirthOnData,
  resetStatsBlocked,
  secondJobOnData,
  tradeExpOnData,
  tradeHpForStatOnData,
  tradeLimits,
} from './progression';

/** 유령은 대화와 부활만, 잠들거나 마비된 상태에서는 아무 서비스도 쓸 수 없습니다 */
const GHOST_KEYS = new Set(['close', 'back', 'talk', 'about', 'revive']);

function blockedReason(p: Player, key?: string): string | null {
  if (p.isDead) return key === undefined || GHOST_KEYS.has(key) ? null : '유령 상태에서는 할 수 없습니다. 먼저 신전의 사제에게 부활하세요.';
  if (!p.canAct) return '지금은 움직일 수 없습니다.';
  return null;
}

function npcFor(p: Player, npcId: unknown, key?: string): Npc | null {
  if (typeof npcId !== 'number' || !p.map) return null;
  const blocked = blockedReason(p, key);
  if (blocked) {
    p.err(blocked);
    return null;
  }
  const e = p.map.entities.get(npcId);
  if (!e || e.kind !== 'npc') return null;
  if (Math.abs(e.x - p.x) > NPC_TALK_RANGE || Math.abs(e.y - p.y) > NPC_TALK_RANGE) {
    p.err('너무 멀리 있습니다. 가까이 가서 말을 거세요.');
    return null;
  }
  return e as Npc;
}

function className(world: World, id: string): string {
  return world.data.classes.get(id as never)?.name ?? CLASS_FALLBACK_NAMES[id as keyof typeof CLASS_FALLBACK_NAMES] ?? id;
}

function mainOptions(world: World, p: Player, npc: Npc): DialogOption[] {
  const opts: DialogOption[] = [];
  npc.def.services.forEach((s, i) => {
    if (p.isDead && s.type !== 'revive' && s.type !== 'talk') return;
    switch (s.type) {
      case 'shop':
        opts.push({ key: `shop:${i}`, label: s.label ?? '물건 사기' });
        break;
      case 'buy':
        opts.push({ key: 'sell', label: s.label ?? '물건 팔기' });
        break;
      case 'class':
        // 5레벨 직업 선택은 1차 직업 길드장만 (2차 직업 스승은 그 직업이 된 사람에게 기술만 가르침)
        if (s.classId === 'peasant') opts.push({ key: 'learn:peasant', label: '기본 기술 배우기' });
        else if (p.data.classId === 'peasant' && isFirstClass(s.classId))
          opts.push({ key: `class:${s.classId}`, label: `${className(world, s.classId)}의 길 걷기 (직업 선택)` });
        else if (p.data.classId === s.classId) opts.push({ key: `learn:${s.classId}`, label: '기술/마법 배우기' });
        // 99레벨 1차 직업: 이 길드장의 직업으로 전직 (무도가는 무도 사범에게 환골탈태)
        if (rebirthOffered(p.data, world.data, s.classId))
          opts.push({
            key: `rebirth:${s.classId}`,
            label: `${rebirthName(p.data.classId, world.data.progression)}: ${className(world, s.classId)}(으)로 다시 태어나기`,
          });
        opts.push({ key: `about:${s.classId}`, label: `${className(world, s.classId)}에 대해 듣기` });
        break;
      case 'revive':
        if (p.isDead) opts.push({ key: 'revive', label: '부활하기' });
        break;
      case 'heal':
        opts.push({ key: 'heal', label: s.price ? `치료받기 (${formatNumber(s.price)} 골드)` : '치료받기 (무료)' });
        break;
      case 'ascend':
        opts.push({ key: 'ascend', label: '승급 장인의 일 (승급·체력/마나·능력치)' });
        break;
      case 'secondJob':
        opts.push({ key: 'second', label: '2차 전직' });
        // 계통이 없는 수인 (이 체계 전에 수인이 된 캐릭터). 고른 id 가 지금 설정에 없어도 다시 고르게 하지 않음
        if (p.data.classId === 'beastkin' && p.data.beastType === null) opts.push({ key: 'beast', label: '수인 계통 고르기' });
        break;
      case 'teleport':
        opts.push({ key: `tp:${i}`, label: s.label ?? '이동하기' });
        break;
      case 'resetStats':
        opts.push({ key: `reset:${i}`, label: `능력치 초기화 (${formatNumber(s.price)} 골드)` });
        break;
      case 'storage':
        opts.push({ key: 'storage', label: '창고 열기' });
        break;
      case 'talk':
        opts.push({ key: `talk:${i}`, label: s.label });
        break;
    }
  });
  opts.push({ key: 'close', label: '대화 끝내기' });
  return opts;
}

function sendDialog(p: Player, npc: Npc, text: string, options: DialogOption[]): void {
  p.send({ t: 'dialog', npc: npc.id, name: npc.def.name, ...(npc.def.title ? { title: npc.def.title } : {}), text, options });
}

export function talkToNpc(world: World, p: Player, npcId: unknown): void {
  const npc = npcFor(p, npcId);
  if (!npc) return;
  p.talkingTo = npc;
  const d = dirTowards(npc.x, npc.y, p.x, p.y);
  if (d !== null && d !== npc.dir) {
    npc.dir = d as Dir;
    npc.map?.broadcast({ t: 'turn', id: npc.id, dir: npc.dir });
  }
  sendDialog(p, npc, npc.def.greeting, mainOptions(world, p, npc));
}

function service<T extends NpcService['type']>(npc: Npc, type: T, index?: number): Extract<NpcService, { type: T }> | undefined {
  if (index !== undefined) {
    const s = npc.def.services[index];
    return s && s.type === type ? (s as Extract<NpcService, { type: T }>) : undefined;
  }
  return npc.def.services.find((s) => s.type === type) as Extract<NpcService, { type: T }> | undefined;
}

export function pickOption(world: World, p: Player, npcId: unknown, keyRaw: unknown): void {
  if (typeof keyRaw !== 'string' || keyRaw.length > 64) return;
  const npc = npcFor(p, npcId, keyRaw.split(':')[0]);
  if (!npc) return;
  p.talkingTo = npc;
  const parts = keyRaw.split(':');
  const [key, arg, arg2] = parts as [string, string | undefined, string | undefined];
  const back = BACK;
  switch (key) {
    case 'close':
      p.talkingTo = null;
      p.send({ t: 'closeDialog' });
      return;
    case 'back':
      sendDialog(p, npc, npc.def.greeting, mainOptions(world, p, npc));
      return;
    case 'talk': {
      const s = service(npc, 'talk', Number(arg));
      if (s) sendDialog(p, npc, s.text, [back, { key: 'close', label: '대화 끝내기' }]);
      return;
    }
    case 'shop': {
      const s = service(npc, 'shop', Number(arg));
      if (!s) return;
      const items = s.items
        .map((id) => world.data.items.get(id))
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((d) => ({ item: d.id, price: d.price }));
      p.send({ t: 'shop', npc: npc.id, name: npc.def.name, items, sell: !!service(npc, 'buy') });
      return;
    }
    case 'sell':
      if (!service(npc, 'buy')) return;
      p.send({ t: 'shop', npc: npc.id, name: npc.def.name, items: [], sell: true });
      return;
    case 'about': {
      const cls = world.data.classes.get(arg as never);
      if (cls) sendDialog(p, npc, cls.desc, [back]);
      return;
    }
    case 'class': {
      const s = npc.def.services.find((x) => x.type === 'class' && x.classId === arg);
      // 2차 직업은 승급 뒤 2차 전직으로만 (5레벨에 고를 수 있는 것은 1차 직업뿐)
      if (!s || s.type !== 'class' || !isFirstClass(s.classId)) return;
      const cls = world.data.classes.get(s.classId)!;
      if (p.data.classId !== 'peasant') return sendDialog(p, npc, '이미 다른 길을 걷고 있군. 다른 길은 99레벨에 전직해서 걸을 수 있다네.', [back]);
      const need = world.config.classLevel;
      if (p.level < need && !p.isGm) return sendDialog(p, npc, `아직 이르네. ${need}레벨이 되면 다시 찾아오게.`, [back]);
      if (arg2 !== 'yes') {
        return sendDialog(p, npc, `${cls.desc}\n\n정말 ${cls.name}의 길을 걷겠는가? 한 번 정하면 99레벨에 전직하기 전까지는 바꿀 수 없다.`, [
          { key: `class:${cls.id}:yes`, label: `예, ${cls.name}이(가) 되겠습니다` },
          back,
        ]);
      }
      setClassOnData(p.data, world.data, cls.id);
      // 시작 장비는 바로 착용시키고, 원래 장비는 소지품으로
      for (const id of cls.starterItems ?? []) {
        const def = world.data.items.get(id);
        if (!def) continue;
        if (def.type === 'equip' && def.slot && equipError(p.data, def) === null) {
          unequipToBag(p.data, world.data, def.slot);
          p.data.equipment[def.slot] = def.id;
        } else addItem(p.data, def, 1);
      }
      p.recompute();
      p.hp = p.maxHp;
      p.mp = p.maxMp;
      p.markInv();
      p.markAbilities();
      p.broadcastLook();
      p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
      p.notice(`${cls.name}의 길을 걷기 시작했습니다!`, 'good');
      world.announce(`${p.name}님이 ${cls.name}의 길을 걷기 시작했습니다.`);
      sendDialog(p, npc, `좋다! 이제 그대는 ${cls.name}이다. 시작 장비를 입혀 주었다. 기술은 나에게 배울 수 있다.`, [
        { key: `learn:${cls.id}`, label: '기술/마법 배우기' },
        { key: 'close', label: '대화 끝내기' },
      ]);
      return;
    }
    case 'learn': {
      const classId = arg ?? '';
      const s = npc.def.services.find((x) => x.type === 'class' && x.classId === classId);
      if (!s || s.type !== 'class') return;
      if (classId !== 'peasant' && p.data.classId !== classId && !p.isGm) return sendDialog(p, npc, '그대는 우리 길드의 사람이 아니군.', [back]);
      // 이 직업 스킬트리의 기술과 배우는 조건의 상태 (gamedata/skilltrees.json)
      p.send({ t: 'learn', npc: npc.id, name: npc.def.name, classId: s.classId, list: learnEntries(p.data, world.data, s.classId) });
      return;
    }
    case 'revive': {
      if (!service(npc, 'revive')) return;
      if (!p.isDead) return sendDialog(p, npc, '그대는 살아 있습니다. 빛이 함께하기를.', [back]);
      revivePlayer(p, 1);
      p.mp = p.maxMp;
      p.markVitals();
      sendDialog(p, npc, '빛의 은총으로 다시 일어섰습니다. 조심해서 다니세요.', [{ key: 'close', label: '감사합니다' }]);
      return;
    }
    case 'heal': {
      const s = service(npc, 'heal');
      if (!s) return;
      if (p.isDead) return sendDialog(p, npc, '먼저 부활해야 합니다.', [back]);
      const price = s.price ?? 0;
      if (p.data.gold < price) return sendDialog(p, npc, '골드가 부족합니다.', [back]);
      p.data.gold -= price;
      p.hp = p.maxHp;
      p.mp = p.maxMp;
      cleanseDebuffs(p);
      p.markVitals();
      p.markInv();
      p.map?.broadcast({ t: 'fx', fx: 'heal', id: p.id });
      sendDialog(p, npc, '상처가 모두 아물었습니다.', [back, { key: 'close', label: '대화 끝내기' }]);
      return;
    }
    case 'rebirth':
      return rebirthDialog(world, p, npc, arg, arg2 === 'yes');
    case 'ascend':
      if (!service(npc, 'ascend')) return;
      return ascendDialog(world, p, npc, parts.slice(1));
    case 'second':
      if (!service(npc, 'secondJob')) return;
      return secondJobDialog(world, p, npc, parts.slice(1));
    case 'beast':
      if (!service(npc, 'secondJob')) return;
      return beastDialog(world, p, npc, arg, arg2 === 'yes');
    case 'tp': {
      const idx = Number(arg);
      const s = service(npc, 'teleport', idx);
      if (!s) return;
      if (arg2 === undefined) {
        const opts = s.dests.map((d, i) => ({
          key: `tp:${idx}:${i}`,
          label: `${d.label}${d.price ? ` — ${formatNumber(d.price)} 골드` : ''}${d.minLevel ? ` (${d.minLevel}레벨 이상)` : ''}`,
        }));
        return sendDialog(p, npc, '어디로 가시겠어요?', [...opts, back]);
      }
      const d = s.dests[Number(arg2)];
      if (!d) return;
      const map = world.maps.get(d.map);
      if (!map) return;
      if (d.minLevel && p.level < d.minLevel && !p.isGm) return sendDialog(p, npc, `그곳은 ${d.minLevel}레벨 이상만 갈 수 있어요.`, [back]);
      const price = d.price ?? 0;
      if (p.data.gold < price && !p.isGm) return sendDialog(p, npc, '골드가 부족해요.', [back]);
      if (!p.isGm) p.data.gold -= price;
      p.markInv();
      p.send({ t: 'closeDialog' });
      p.talkingTo = null;
      world.transfer(p, map, d.x ?? map.def.spawn.x, d.y ?? map.def.spawn.y);
      p.map?.broadcast({ t: 'fx', fx: 'teleport', id: p.id });
      return;
    }
    case 'reset': {
      const idx = Number(arg);
      const s = service(npc, 'resetStats', idx);
      if (!s) return;
      // 되돌릴 것이 없으면 골드만 내지 않게, 되돌리면 순수 체력·마력이 직업 기본 아래로 내려가면(건강·지혜 몫을 팔거나 바침) 막음
      const why = allocatedPoints(p.data) === 0 ? '아직 분배한 능력치가 없어 되돌릴 것이 없다.' : resetStatsBlocked(p.data, world.data);
      if (why) return sendDialog(p, npc, why, [back]);
      if (arg2 !== 'yes') {
        return sendDialog(p, npc, `분배한 능력치를 모두 되돌려 다시 분배할 수 있게 해 주겠다. 비용은 ${formatNumber(s.price)} 골드다.`, [
          { key: `reset:${idx}:yes`, label: '초기화하기' },
          back,
        ]);
      }
      if (p.data.gold < s.price) return sendDialog(p, npc, '골드가 부족하다.', [back]);
      p.data.gold -= s.price;
      const refund = resetStatsOnData(p.data);
      p.recompute();
      p.markInv();
      return sendDialog(p, npc, `능력치를 초기화했다. 돌려받은 포인트: ${refund}. G 키로 다시 분배하게.`, [back]);
    }
    case 'storage':
      if (!service(npc, 'storage')) return;
      p.send({ t: 'storage', npc: npc.id, slots: p.data.storage, gold: p.data.storageGold });
      return;
  }
}

// ───────────────────────── 성장 체계 대화 (전직·승급·2차 전직) ─────────────────────────

const BACK: DialogOption = { key: 'back', label: '돌아가기' };
const CLOSE: DialogOption = { key: 'close', label: '대화 끝내기' };

/** 조건 하나의 지금 값 (대화창 줄 끝에 붙임) */
function conditionDetail(r: ConditionResult): string {
  switch (r.cond.type) {
    case 'ascended':
      return '';
    case 'skillProf':
      return r.have === undefined ? ' (배우지 않음)' : ` (지금 ${r.have})`;
    case 'level':
      return ` (지금 ${r.have ?? 0})`;
    case 'rebirths':
      return ` (지금 ${r.have ?? 0}번)`;
    case 'payHp':
    case 'payMp':
      // 바친 뒤에도 직업 기본 체력·마나가 남아야 하므로 지금 값이 need 이상이어야 함
      return r.met ? ` (지금 ${bigNumber(r.have ?? 0)})` : ` (지금 ${bigNumber(r.have ?? 0)}, ${bigNumber(r.need ?? 0)} 이상이어야 바칠 수 있음)`;
    default:
      return r.have === undefined ? '' : ` (지금 ${bigNumber(r.have)})`;
  }
}

/** 조건 확인 결과를 대화창 줄로 ("○ 순수 체력 14,000 이상 (지금 15,230)", 모자라면 ×) */
function conditionLines(check: ConditionCheck | undefined): string[] {
  return (check?.results ?? []).map((r) => `${r.met ? '○' : '×'} ${r.label}${conditionDetail(r)}`);
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatNumber(n)}`;

/** 전직·2차 전직 뒤: 다시 계산하고 체력·마나를 채운 뒤 내 화면(소지품·기술·상태)과 주변에 알립니다 */
function afterClassChange(world: World, p: Player): void {
  p.recompute();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  p.markInv();
  p.markAbilities();
  p.markSelf();
  p.broadcastLook();
  p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
  world.groups.touch(p);
}

/**
 * 전직(무도가는 환골탈태): 새로 들어갈 직업의 길드장에게서 'rebirth:<직업>[:yes]'.
 * 먼저 하는 일과 조건을 줄마다 보여 주고, 조건을 모두 채웠을 때만 "예" 를 내놓습니다.
 */
function rebirthDialog(world: World, p: Player, npc: Npc, targetRaw: string | undefined, yes: boolean): void {
  const s = npc.def.services.find((x) => x.type === 'class' && x.classId === targetRaw);
  if (!s || s.type !== 'class' || !isFirstClass(s.classId)) return;
  const gd = world.data;
  const target = s.classId;
  const tName = className(world, target);
  const name = rebirthName(p.data.classId, gd.progression);
  const r = checkRebirth(p.data, gd, target);
  if (!yes || !r.ok) {
    const rb = gd.progression.rebirth;
    const lines = [
      `${name}하면 ${rb.restartLevel}레벨, 경험치 0 으로 돌아가고 능력치도 처음으로 돌아간다.`,
      '배운 기술과 마법(숙련도 포함), 승급 장인에게 산 체력·마나, 장비와 소지품, 골드와 창고는 그대로 남는다.',
      `다만 새 직업과 레벨(${rb.restartLevel})로 입을 수 없는 장비(다른 직업 전용, 레벨 제한이 더 높은 것)는 벗겨 소지품(가득하면 창고)에 넣어 주마.`,
      '',
      `${tName}(으)로 ${name}하는 조건:`,
      ...conditionLines(r.check),
      '',
      r.ok ? `정말 ${tName}(으)로 다시 태어나겠는가?` : r.msg,
    ];
    return sendDialog(p, npc, lines.join('\n'), r.ok ? [{ key: `rebirth:${target}:yes`, label: `예, ${name}하겠습니다` }, BACK] : [BACK]);
  }
  const res = rebirthOnData(p.data, gd, world.config, target);
  if (!res.ok) return sendDialog(p, npc, res.msg, [BACK]);
  afterClassChange(world, p);
  p.notice(res.msg, 'good');
  world.announce(`${p.name}님이 ${tName}(으)로 ${name}했습니다.`);
  sendDialog(
    p,
    npc,
    `다시 태어난 것을 축하하네. 이제 그대는 ${p.data.level}레벨 ${tName}이다. 배운 기술과 마법은 그대로 쓸 수 있고, ${tName}의 기술은 나에게 배울 수 있다.`,
    [{ key: `learn:${target}`, label: '기술/마법 배우기' }, CLOSE],
  );
}

type TradeKind = 'hp' | 'mp' | 'stat';

/** 교환 메뉴·확인을 보낼 때마다 새 표를 정합니다 (선택지 key 에 붙여, 지난 메뉴의 선택은 받지 않음) */
function newTradeToken(p: Player): string {
  p.tradeToken = (p.tradeToken + 1) % 1_000_000_000;
  return String(p.tradeToken);
}

/**
 * 승급 장인: 'ascend' → 메뉴, 'ascend:hp|mp|stat' → 횟수 고르기, 'ascend:do[:yes]' → 승급.
 * 교환은 'ascend:hp|mp|stat:<횟수|all>:<표>[:yes]': 표는 마지막으로 보낸 교환 메뉴·확인의 것만 받아 같은 선택이 두 번 와도
 * (두 번 누르기 등) 한 번만 바꿉니다. 할 수 있는 만큼 모두(all)와 체력 → 능력치는 한 번 더 묻고 ':yes' 로 바꿉니다.
 */
function ascendDialog(world: World, p: Player, npc: Npc, args: string[]): void {
  const gd = world.data;
  const asc = gd.progression.ascend;
  if (p.level < asc.level) return sendDialog(p, npc, `승급 장인의 일은 ${asc.level}레벨이 된 자만 맡길 수 있다. 더 수련하고 오게.`, [BACK]);
  const [what, n, token, yes] = args;
  if (what === 'hp' || what === 'mp' || what === 'stat') {
    if (n === undefined) return tradeMenu(world, p, npc, what);
    if (token !== String(p.tradeToken)) return tradeMenu(world, p, npc, what, '이미 처리했거나 지난 선택이다. 다시 골라 주게.');
    const times = n === 'all' ? tradeLimits(p.data, gd)[what] : Number(n);
    const trade = (d: CharacterData) => (what === 'stat' ? tradeHpForStatOnData(d, gd, times) : tradeExpOnData(d, gd, what, times));
    if ((n === 'all' || what === 'stat') && yes !== 'yes') {
      // 할 수 없는 교환은 묻지 않고 이유를 바로 (복사본으로 해 봄)
      const trial = trade(structuredClone(p.data));
      return trial.ok ? tradeConfirm(world, p, npc, what, times) : tradeMenu(world, p, npc, what, trial.msg);
    }
    const r = trade(p.data);
    if (r.ok) {
      p.recompute();
      p.markSelf();
      p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
      p.notice(r.msg, 'good');
    }
    return tradeMenu(world, p, npc, what, r.msg);
  }
  if (what === 'do') return ascendDo(world, p, npc, n === 'yes');
  ascendMenu(world, p, npc);
}

function ascendMenu(world: World, p: Player, npc: Npc, note?: string): void {
  const gd = world.data;
  const asc = gd.progression.ascend;
  const d = p.data;
  const pure = pureVitals(d, gd);
  const lim = tradeLimits(d, gd);
  const t = asc.expTrade;
  const lines = [
    ...(note ? [note, ''] : []),
    `쌓인 경험치: ${bigNumber(d.exp)}`,
    `순수 체력 ${formatNumber(pure.hp)} · 순수 마력 ${formatNumber(pure.mp)} (산 체력 ${signed(d.bonusHp)} · 산 마나 ${signed(d.bonusMp)})`,
    '',
    `경험치 ${bigNumber(t.exp)}을(를) 바치면 최대 체력 +${formatNumber(t.hp)} 또는 최대 마나 +${formatNumber(t.mp)}을(를) 주겠다.`,
    `최대 체력 ${formatNumber(asc.hpToStat.hp)}을(를) 바치면 능력치 ${formatNumber(asc.hpToStat.stat)}을(를) 주겠다. (직업 기본 체력 ${formatNumber(classBaseVitals(d, gd).hp)} 아래로는 팔 수 없다)`,
  ];
  if (d.ascended) lines.push('', `그대는 이미 승급한 ${asc.title}이다.`);
  else if (isFirstClass(d.classId)) lines.push('', '조건을 채우면 승급할 수 있다. 승급하면 2차 직업 인도자에게 2차 전직을 청할 수 있다.');
  const opts: DialogOption[] = [
    { key: 'ascend:hp', label: `경험치로 체력 사기 (${formatNumber(lim.hp)}번 가능)` },
    { key: 'ascend:mp', label: `경험치로 마나 사기 (${formatNumber(lim.mp)}번 가능)` },
    { key: 'ascend:stat', label: `체력으로 능력치 사기 (${formatNumber(lim.stat)}번 가능)` },
  ];
  if (isFirstClass(d.classId) && !d.ascended) opts.push({ key: 'ascend:do', label: '승급하기' });
  opts.push(BACK);
  sendDialog(p, npc, lines.join('\n'), opts);
}

/** 교환 n 번으로 얻는 것 ("체력 +1,000") */
function tradeGain(world: World, kind: TradeKind, n: number): string {
  const asc = world.data.progression.ascend;
  return kind === 'hp'
    ? `체력 +${formatNumber(asc.expTrade.hp * n)}`
    : kind === 'mp'
      ? `마나 +${formatNumber(asc.expTrade.mp * n)}`
      : `능력치 +${formatNumber(asc.hpToStat.stat * n)}`;
}

/** 교환 한 가지의 횟수 고르기: 1번, 10번, 100번, 할 수 있는 만큼 모두 (선택지 key 에는 이 메뉴의 표가 붙음) */
function tradeMenu(world: World, p: Player, npc: Npc, kind: TradeKind, note?: string): void {
  const gd = world.data;
  const asc = gd.progression.ascend;
  const lim = tradeLimits(p.data, gd)[kind];
  const desc =
    kind === 'stat'
      ? `최대 체력 ${formatNumber(asc.hpToStat.hp)}을(를) 바칠 때마다 능력치 포인트 ${formatNumber(asc.hpToStat.stat)}을(를) 주겠다. 순수 체력이 직업 기본 체력 아래로 내려가게는 팔 수 없다.`
      : `경험치 ${bigNumber(asc.expTrade.exp)}을(를) 바칠 때마다 최대 ${tradeGain(world, kind, 1)}.`;
  const status =
    kind === 'stat'
      ? `순수 체력 ${formatNumber(pureVitals(p.data, gd).hp)} · 직업 기본 체력 ${formatNumber(classBaseVitals(p.data, gd).hp)} · 남은 능력치 포인트 ${formatNumber(p.data.statPoints)}`
      : `쌓인 경험치: ${bigNumber(p.data.exp)}`;
  const counts = [1, 10, 100].filter((n) => n <= lim);
  if (lim > 1 && !counts.includes(lim)) counts.push(lim);
  const token = newTradeToken(p);
  const opts: DialogOption[] = counts.map((n) => {
    const all = n === lim && n > 1;
    return {
      key: `ascend:${kind}:${all ? 'all' : n}:${token}`,
      label: `${all ? `${formatNumber(n)}번 모두` : `${formatNumber(n)}번`} (${tradeGain(world, kind, n)})`,
    };
  });
  opts.push({ key: 'ascend', label: '돌아가기' });
  const lines = [...(note ? [note, ''] : []), desc, status, lim > 0 ? `지금 ${formatNumber(lim)}번 할 수 있다.` : '지금은 할 수 없다.'];
  sendDialog(p, npc, lines.join('\n'), opts);
}

/** 할 수 있는 만큼 모두 바꾸기와 체력 → 능력치(판 체력은 경험치로만 다시 삼)는 한 번 더 묻습니다 */
function tradeConfirm(world: World, p: Player, npc: Npc, kind: TradeKind, times: number): void {
  if (!Number.isInteger(times) || times < 1) return tradeMenu(world, p, npc, kind, '지금은 할 수 없다.');
  const asc = world.data.progression.ascend;
  const cost = kind === 'stat' ? `최대 체력 ${formatNumber(asc.hpToStat.hp * times)}` : `경험치 ${bigNumber(asc.expTrade.exp * times)}`;
  const lines = [`${formatNumber(times)}번 바꾸면 ${cost}을(를) 바치고 ${tradeGain(world, kind, times)}을(를) 얻는다.`];
  if (kind === 'stat')
    lines.push(
      asc.expTrade.hp > 0
        ? `판 체력은 경험치로만 다시 살 수 있다. (경험치 ${bigNumber(asc.expTrade.exp)}에 체력 +${formatNumber(asc.expTrade.hp)})`
        : '판 체력은 다시 살 수 없다.',
    );
  lines.push('', '바꾸겠는가?');
  const token = newTradeToken(p);
  sendDialog(p, npc, lines.join('\n'), [
    { key: `ascend:${kind}:${times}:${token}:yes`, label: '예, 바치겠습니다' },
    { key: `ascend:${kind}`, label: '돌아가기' },
  ]);
}

function ascendDo(world: World, p: Player, npc: Npc, yes: boolean): void {
  const gd = world.data;
  const asc = gd.progression.ascend;
  const backToMenu: DialogOption = { key: 'ascend', label: '돌아가기' };
  const r = checkAscend(p.data, gd);
  if (!yes || !r.ok) {
    const lines = [
      `승급하면 ${asc.title}(이)라 불리고, 2차 직업 인도자에게 2차 전직을 청할 수 있다.`,
      '',
      '승급 조건:',
      ...conditionLines(r.check),
      '',
      r.ok ? '승급하겠는가? 경험치는 써서 없어진다.' : r.msg,
    ];
    return sendDialog(p, npc, lines.join('\n'), r.ok ? [{ key: 'ascend:do:yes', label: '예, 승급하겠습니다' }, backToMenu] : [backToMenu]);
  }
  const res = ascendOnData(p.data, gd);
  if (!res.ok) return ascendMenu(world, p, npc, res.msg);
  p.recompute();
  p.markSelf();
  p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
  p.notice(res.msg, 'good');
  world.announce(`${p.name}님이 승급하여 ${asc.title}이(가) 되었습니다!`);
  sendDialog(p, npc, `훌륭하다! 이제 그대는 ${asc.title}이다. 마을의 2차 직업 인도자를 찾아가면 2차 전직을 청할 수 있다.`, [backToMenu, CLOSE]);
}

/**
 * 2차 직업 인도자: 'second' → 갈 수 있는 길, 'second:<2차 직업>' → 조건(수인은 계통 고르기),
 * 'second:<2차 직업>:yes' 또는 'second:beastkin:<계통>[:yes]' → 2차 전직
 */
function secondJobDialog(world: World, p: Player, npc: Npc, args: string[]): void {
  const gd = world.data;
  const sc = gd.progression.second;
  const cur = p.data.classId;
  const [targetRaw, a, b] = args;
  const backTo = (key: string): DialogOption => ({ key, label: '돌아가기' });
  if (classTier(cur) === 2) return sendDialog(p, npc, `그대는 이미 ${className(world, cur)}의 길을 걷고 있다. (어빌 ${p.data.abilityLevel})`, [BACK]);
  if (!isFirstClass(cur)) return sendDialog(p, npc, '2차 전직은 1차 직업을 가진 자가 승급한 뒤에야 할 수 있다.', [BACK]);
  const targets = secondClassesOf(cur, sc.from);
  if (targetRaw === undefined) {
    if (targets.length === 0) return sendDialog(p, npc, `${className(world, cur)}에게는 2차 전직의 길이 없다.`, [BACK]);
    const text = [
      '승급한 자는 2차 직업으로 나아갈 수 있다.',
      `레벨은 그대로이고, 새로 어빌리티 레벨(어빌)이 1부터 ${gd.progression.ability.maxLevel}까지 오른다. 배운 기술과 마법은 그대로 쓸 수 있다.`,
      '',
      `${className(world, cur)}이(가) 갈 수 있는 길: ${targets.map((t) => className(world, t)).join(', ')}`,
    ];
    return sendDialog(p, npc, text.join('\n'), [...targets.map((t) => ({ key: `second:${t}`, label: `${className(world, t)}(으)로 2차 전직` })), BACK]);
  }
  const target = targets.find((t) => t === targetRaw);
  if (!target) return sendDialog(p, npc, `${className(world, cur)}은(는) 그 길로 갈 수 없다.`, [backTo('second')]);
  const isBeast = target === 'beastkin';
  const beast = isBeast ? (a ?? null) : null;
  const yes = isBeast ? b === 'yes' : a === 'yes';
  if (beast !== null && !knownBeastType(gd, beast)) return sendDialog(p, npc, '그런 계통은 없다.', [backTo('second:beastkin')]);
  const tName = className(world, target);
  const r = checkSecondJob(p.data, gd, target, beast);
  if (!yes || !r.ok) {
    const lines = [gd.classes.get(target)?.desc ?? '', '', `${tName}(으)로 2차 전직하는 조건:`, ...conditionLines(r.check), ''];
    const opts: DialogOption[] = [];
    const unmet = r.check?.results.find((x) => !x.met);
    if (isBeast && beast === null) {
      // 수인: 조건을 채웠으면 계통부터 고름
      if (r.check?.ok) {
        lines.push('수인은 짐승의 계통을 하나 골라야 한다. 한 번 고르면 바꿀 수 없다.');
        for (const t of sc.beastTypes) opts.push({ key: `second:beastkin:${t.id}`, label: `${t.name} 수인` });
      } else lines.push(unmet ? `2차 전직 조건이 모자랍니다: ${unmet.label}` : r.msg);
    } else if (r.ok) {
      const what = beast ? `${beastTypeName(gd, beast)} 계통의 ${tName}` : tName;
      lines.push(`정말 ${what}이(가) 되겠는가? 경험치와 바치는 체력·마력은 써서 없어진다.${beast ? ' 계통은 바꿀 수 없다.' : ''}`);
      opts.push({ key: beast ? `second:beastkin:${beast}:yes` : `second:${target}:yes`, label: `예, ${what}이(가) 되겠습니다` });
    } else lines.push(r.msg);
    opts.push(backTo(beast ? 'second:beastkin' : 'second'));
    return sendDialog(p, npc, lines.join('\n'), opts);
  }
  const res = secondJobOnData(p.data, gd, target, beast);
  if (!res.ok) return sendDialog(p, npc, res.msg, [backTo('second')]);
  afterClassChange(world, p);
  p.notice(res.msg, 'good');
  const what = p.data.beastType ? `${beastTypeName(gd, p.data.beastType)} 계통의 ${tName}` : tName;
  world.announce(`${p.name}님이 ${what}(으)로 2차 전직했습니다!`);
  sendDialog(p, npc, `이제 그대는 ${what}이다. 어빌리티 레벨 1부터 쌓아 가게. ${tName}의 기술은 ${tName} 길드장에게 배울 수 있다.`, [CLOSE]);
}

/** 계통이 없는 수인(이 체계 전에 수인이 된 캐릭터)이 계통을 한 번 고릅니다: 'beast[:<계통>[:yes]]' */
function beastDialog(world: World, p: Player, npc: Npc, id: string | undefined, yes: boolean): void {
  const gd = world.data;
  const types = gd.progression.second.beastTypes;
  if (p.data.classId !== 'beastkin') return sendDialog(p, npc, '계통은 수인만 고른다.', [BACK]);
  if (p.data.beastType !== null)
    return sendDialog(
      p,
      npc,
      knownBeastType(gd, p.data.beastType)
        ? `그대는 이미 ${beastTypeName(gd, p.data.beastType)} 계통이다. 계통은 바꿀 수 없다.`
        : `그대가 고른 계통('${p.data.beastType}')이 지금은 없다. 계통은 바꿀 수 없으니 관리자에게 알리게.`,
      [BACK],
    );
  if (id === undefined)
    return sendDialog(p, npc, '그대는 아직 짐승의 계통을 정하지 않았군. 하나를 고르게. 한 번 고르면 바꿀 수 없다.', [
      ...types.map((t) => ({ key: `beast:${t.id}`, label: `${t.name} 계통` })),
      BACK,
    ]);
  const t = types.find((x) => x.id === id);
  if (!t) return;
  if (!yes)
    return sendDialog(p, npc, `${t.name} 계통의 수인이 되겠는가? 한 번 정하면 바꿀 수 없다.`, [
      { key: `beast:${t.id}:yes`, label: `예, ${t.name} 계통으로 하겠습니다` },
      { key: 'beast', label: '돌아가기' },
    ]);
  const r = chooseBeastTypeOnData(p.data, gd, t.id);
  if (r.ok) {
    p.markSelf();
    p.notice(r.msg, 'good');
  }
  sendDialog(p, npc, r.msg, [BACK, CLOSE]);
}

function hasShopItem(npc: Npc, itemId: string): boolean {
  return npc.def.services.some((s) => s.type === 'shop' && s.items.includes(itemId));
}

export function buy(world: World, p: Player, npcId: unknown, itemId: unknown, qtyRaw: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || typeof itemId !== 'string') return;
  if (!hasShopItem(npc, itemId)) return;
  const def = world.data.items.get(itemId);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, stackSize(def) > 1 ? 1000 : 10)) : 1;
  const cost = def.price * qty;
  if (p.data.gold < cost) return p.err('골드가 부족합니다.');
  if (!canFit(p.data, def, qty)) return p.err('소지품에 자리가 부족합니다.');
  p.data.gold -= cost;
  addItem(p.data, def, qty);
  p.markInv();
  p.markSelf();
  p.sys(`${def.name}${qty > 1 ? ` ${qty}개` : ''}을(를) ${formatNumber(cost)} 골드에 샀습니다.`);
}

export function sell(world: World, p: Player, npcId: unknown, slot: unknown, qtyRaw: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || !npc.def.services.some((s) => s.type === 'buy')) return;
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return;
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const unit = Math.floor(def.price / 2);
  if (unit <= 0) return p.err('이 물건은 팔 수 없습니다.');
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : 1;
  const taken = takeFromSlot(p.data, slot, qty);
  if (!taken) return;
  const gain = unit * taken.qty;
  p.data.gold += gain;
  p.markInv();
  p.markSelf();
  p.sys(`${def.name}${taken.qty > 1 ? ` ${taken.qty}개` : ''}을(를) ${formatNumber(gain)} 골드에 팔았습니다.`);
}

/**
 * 길드장 창에서 기술 배우기 ('learnAbility'): 그 기술이 있는 스킬트리를 이 NPC 가 가르쳐야 하고,
 * 스킬트리의 조건(지금 직업, 레벨/어빌, 골드, 재료, 선수과목 숙련도, 능력치, 수인 계통)으로 판정합니다.
 * 운영자는 조건 없이 무료로 배웁니다.
 */
export function learn(world: World, p: Player, npcId: unknown, abilityId: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || typeof abilityId !== 'string') return;
  const def = world.data.abilities.get(abilityId);
  const at = world.data.nodeOf(abilityId);
  if (!def || !at) return;
  // 길드장은 자기 직업의 트리를, 수련장 관리인은 평민 트리를 가르칩니다
  if (!npc.def.services.some((s) => s.type === 'class' && s.classId === at.classId)) return;
  const r = learnFromTree(p.data, world.data, def.id, { free: p.isGm });
  if (!r.ok) return p.err(r.msg);
  p.markAbilities();
  p.markInv();
  p.markSelf();
  p.notice(`${def.name}을(를) 배웠습니다! (${def.kind === 'skill' ? 'S' : 'D'} 키)`, 'good');
  p.sys(r.msg);
  pickOption(world, p, npcId, `learn:${at.classId}`);
}

function storageNpc(p: Player, npcId: unknown): Npc | null {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || !npc.def.services.some((s) => s.type === 'storage')) return null;
  return npc;
}

function sendStorage(p: Player, npc: Npc): void {
  p.send({ t: 'storage', npc: npc.id, slots: p.data.storage, gold: p.data.storageGold });
}

export function deposit(world: World, p: Player, npcId: unknown, slot: unknown, qtyRaw: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof slot !== 'number' || !Number.isInteger(slot)) return;
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : s.qty;
  const taken = takeFromSlot(p.data, slot, qty);
  if (!taken) return;
  const left = addToStorage(p.data, def, taken.qty);
  if (left > 0) {
    addItem(p.data, def, left);
    p.err('창고가 가득 찼습니다.');
  }
  p.markInv();
  sendStorage(p, npc);
}

export function withdraw(world: World, p: Player, npcId: unknown, index: unknown, qtyRaw: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof index !== 'number' || !Number.isInteger(index)) return;
  const s = p.data.storage[index];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : s.qty;
  if (!canFit(p.data, def, qty)) return p.err('소지품에 자리가 부족합니다.');
  addItem(p.data, def, qty);
  s.qty -= qty;
  if (s.qty <= 0) p.data.storage.splice(index, 1);
  p.markInv();
  sendStorage(p, npc);
}

export function depositGold(p: Player, npcId: unknown, amount: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return;
  if (amount > p.data.gold) return p.err('골드가 부족합니다.');
  p.data.gold -= amount;
  p.data.storageGold += amount;
  p.markInv();
  p.markSelf();
  sendStorage(p, npc);
}

export function withdrawGold(p: Player, npcId: unknown, amount: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return;
  if (amount > p.data.storageGold) return p.err('맡긴 골드가 부족합니다.');
  p.data.storageGold -= amount;
  p.data.gold += amount;
  p.markInv();
  p.markSelf();
  sendStorage(p, npc);
}
