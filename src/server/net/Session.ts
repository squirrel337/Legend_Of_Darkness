// WebSocket 연결 하나. 로그인/캐릭터 생성과, 로그인 후 메시지를 각 시스템으로 전달합니다.
import type { WebSocket } from 'ws';
import {
  EQUIP_SLOTS,
  HAIR_COLORS,
  HAIR_STYLES,
  INVENTORY_SIZE,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PROTOCOL_VERSION,
} from '../../shared/constants';
import { computeDerived, START_STAT } from '../../shared/formulas';
import type { S2C } from '../../shared/protocol';
import { validateName } from '../admin/AdminService';
import { hashPassword, RateLimiter, safeEqual, TokenBucket, verifyPassword } from '../auth';
import { log } from '../log';
import { emptyEquipment, nameKey, type CharacterData } from '../storage';
import { addItem, learnOnData, setLevelOnData } from '../systems/character';
import { handleChat } from '../systems/chat';
import { playerAssail, playerUseAbility } from '../systems/combat';
import { dropGold, dropItem, equipFromSlot, moveItem, pickup, unequip, useItem } from '../systems/inventory';
import { ghostRecall, handleTurn, handleWalk } from '../systems/movement';
import { buy, deposit, depositGold, learn, pickOption, sell, talkToNpc, withdraw, withdrawGold } from '../systems/npc';
import { handleAuto } from '../systems/autohunt';
import { allocateStat } from '../systems/progression';
import type { Player, PlayerLink } from '../world/Player';
import type { World } from '../world/World';

const MAX_BUFFERED = 4 * 1024 * 1024;
const STARTER_ITEMS: [string, number][] = [
  ['w_common_1', 1],
  ['a_common_1', 1],
  ['pot_hp_1', 10],
  ['pot_mp_1', 5],
  ['scroll_recall', 3],
];

export interface SessionLimits {
  /** IP 당 로그인 시도 */
  login: RateLimiter;
  /** 캐릭터 당 비밀번호 실패 */
  accountFail: RateLimiter;
  /** IP 당 캐릭터 생성 */
  create: RateLimiter;
  /** IP 당 초대 코드 실패 */
  invite: RateLimiter;
}

export function defaultLimits(): SessionLimits {
  return {
    login: new RateLimiter(10, 60_000),
    accountFail: new RateLimiter(8, 10 * 60_000),
    create: new RateLimiter(10, 60 * 60_000),
    invite: new RateLimiter(10, 60 * 60_000),
  };
}

const LOGIN_TIMEOUT_MS = 3 * 60_000;

export class Session implements PlayerLink {
  player: Player | null = null;
  private queue: S2C[] = [];
  private scheduled = false;
  private closed = false;
  private busy = false;
  private loginTimer: NodeJS.Timeout | null = null;
  private readonly bucket = new TokenBucket(80, 40);
  private violations = 0;

  constructor(
    private readonly ws: WebSocket,
    readonly ip: string,
    private readonly world: World,
    private readonly limits: SessionLimits,
  ) {}

  start(): void {
    this.send({ t: 'hello', version: PROTOCOL_VERSION, server: this.world.publicInfo() });
    // 로그인하지 않고 오래 머무는 연결은 끊습니다
    this.loginTimer = setTimeout(() => {
      if (!this.player) this.close('로그인 시간이 지났습니다.');
    }, LOGIN_TIMEOUT_MS);
    this.ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      void this.onMessage(raw.toString());
    });
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (e) => log.debug('WebSocket 오류:', e.message));
  }

  send(msg: S2C): void {
    if (this.closed) return;
    this.queue.push(msg);
    this.touch();
  }

  touch(): void {
    if (this.closed || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => this.flush());
  }

  private flush(): void {
    if (this.closed) {
      this.scheduled = false;
      return;
    }
    // 바뀐 상태 메시지를 먼저 대기열에 넣고(이때는 아직 예약 중이라 다시 예약되지 않음) 한 번에 보냅니다
    this.player?.flushDirty();
    this.scheduled = false;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    if (this.ws.bufferedAmount > MAX_BUFFERED) {
      log.warn(`${this.player?.name ?? this.ip}: 전송 대기열이 너무 커서 연결을 끊습니다.`);
      this.close('네트워크가 너무 느립니다.');
      return;
    }
    try {
      this.ws.send(JSON.stringify(batch.length === 1 ? batch[0] : batch));
    } catch (e) {
      log.debug('전송 실패:', (e as Error).message);
    }
  }

  close(reason: string): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    try {
      this.ws.close(4000, reason.slice(0, 100));
    } catch {
      this.ws.terminate();
    }
  }

  private loggedIn(): void {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = null;
  }

  private onClose(): void {
    this.closed = true;
    this.loggedIn();
    if (this.player) {
      this.world.leaveGame(this.player);
      this.player = null;
    }
  }

  private authFail(msg: string): void {
    this.send({ t: 'authFail', msg });
  }

  private async onMessage(text: string): Promise<void> {
    if (this.closed) return;
    if (!this.bucket.take()) {
      if (++this.violations > 200) this.close('메시지를 너무 많이 보냈습니다.');
      return;
    }
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      msg = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const t = msg.t;
    if (typeof t !== 'string') return;
    try {
      if (!this.player) {
        if (t === 'login') await this.login(msg);
        else if (t === 'create') await this.create(msg);
        else if (t === 'ping') this.send({ t: 'pong', ts: Number(msg.ts) || 0 });
        return;
      }
      await this.dispatch(this.player, t, msg);
    } catch (e) {
      log.error(`메시지 처리 오류 (${t}):`, e);
    }
  }

  private async login(msg: Record<string, unknown>): Promise<void> {
    if (this.busy || this.player) return;
    const name = typeof msg.name === 'string' ? msg.name.trim() : '';
    const password = typeof msg.password === 'string' ? msg.password : '';
    if (!name || !password || password.length > PASSWORD_MAX) return this.authFail('이름과 비밀번호를 입력하세요.');
    // IP 당 시도 횟수 (성공해도 초기화하지 않음)
    if (!this.limits.login.hit(this.ip)) return this.authFail('로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
    const key = nameKey(name);
    if (!this.limits.accountFail.peek(key)) return this.authFail('이 캐릭터의 비밀번호를 너무 많이 틀렸습니다. 10분 뒤에 다시 시도하세요.');
    const data = this.world.store.get(name);
    this.busy = true;
    let ok = false;
    try {
      ok = data ? await verifyPassword(password, data.passwordHash) : (await hashPassword(password), false);
    } finally {
      this.busy = false;
    }
    if (this.closed || this.player) return;
    // 비밀번호를 확인하는 동안 캐릭터가 삭제되었을 수도 있음
    if (!data || this.world.store.get(name) !== data) return this.authFail('캐릭터가 없거나 비밀번호가 틀렸습니다.');
    if (!ok) {
      this.limits.accountFail.add(key);
      return this.authFail('캐릭터가 없거나 비밀번호가 틀렸습니다.');
    }
    this.limits.accountFail.reset(key);
    if (data.banned) return this.authFail(`접속이 금지된 캐릭터입니다.${data.banReason ? ` (사유: ${data.banReason})` : ''}`);
    if (this.world.players.size >= this.world.config.maxPlayers && data.role === 'player' && !this.world.findPlayer(name)) {
      return this.authFail('서버 인원이 가득 찼습니다. 잠시 후 다시 시도하세요.');
    }
    const existing = this.world.findPlayer(name);
    if (existing) this.world.kick(existing, '다른 곳에서 같은 캐릭터로 접속했습니다.');
    this.loggedIn();
    this.player = this.world.enterGame(this, data);
  }

  private async create(msg: Record<string, unknown>): Promise<void> {
    if (this.busy || this.player) return;
    const cfg = this.world.config;
    const name = typeof msg.name === 'string' ? msg.name.trim() : '';
    const password = typeof msg.password === 'string' ? msg.password : '';
    const nameErr = validateName(name);
    if (nameErr) return this.authFail(nameErr);
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return this.authFail(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 정하세요.`);
    if (cfg.registration === 'closed') return this.authFail('이 서버는 새 캐릭터 생성을 막아 두었습니다. 관리자에게 문의하세요.');
    if (cfg.registration === 'invite') {
      if (!this.limits.invite.peek(this.ip)) return this.authFail('초대 코드를 너무 많이 틀렸습니다. 나중에 다시 시도하세요.');
      const code = typeof msg.invite === 'string' ? msg.invite : '';
      if (!cfg.inviteCode || !safeEqual(code, cfg.inviteCode)) {
        this.limits.invite.add(this.ip);
        return this.authFail('초대 코드가 올바르지 않습니다.');
      }
    }
    if (this.world.isReservedName(name)) return this.authFail('예약된 이름입니다. 다른 이름을 쓰세요.');
    if (this.world.store.has(name)) return this.authFail('이미 있는 이름입니다.');
    if (this.world.players.size >= cfg.maxPlayers) return this.authFail('서버 인원이 가득 찼습니다. 잠시 후 다시 시도하세요.');
    if (!this.limits.create.hit(this.ip)) return this.authFail('캐릭터를 너무 많이 만들었습니다. 나중에 다시 시도하세요.');
    const gender = msg.gender === 'f' ? 'f' : 'm';
    const hairStyle = Number.isInteger(msg.hairStyle) ? Math.max(0, Math.min(HAIR_STYLES - 1, msg.hairStyle as number)) : 0;
    const hairColor = Number.isInteger(msg.hairColor) ? Math.max(0, Math.min(HAIR_COLORS.length - 1, msg.hairColor as number)) : 0;
    // 만드는 동안(비밀번호 해시, 파일 저장) 다른 로그인/생성 요청은 받지 않습니다
    this.busy = true;
    try {
      const hash = await hashPassword(password);
      if (this.closed || this.player) return;
      if (this.world.store.has(name)) return this.authFail('이미 있는 이름입니다.');
      const data = newCharacter(this.world, name, hash, gender, hairStyle, hairColor);
      const firstAdmin = cfg.firstCharacterAdmin && this.world.claimFirstAdmin();
      if (firstAdmin) {
        data.role = 'admin';
        log.info(`첫 번째 캐릭터 ${name} 에게 관리자 권한을 주었습니다. (FIRST_CHARACTER_ADMIN=false 로 끌 수 있습니다)`);
      }
      data.lastIp = this.ip;
      try {
        await this.world.store.create(data);
      } catch {
        return this.authFail('이미 있는 이름입니다.');
      }
      log.info(`새 캐릭터: ${name} (${this.ip})`);
      if (this.closed || this.player) return;
      this.loggedIn();
      this.player = this.world.enterGame(this, data);
      this.player.notice(`${name}님, 어둠의 전설의 세계에 오신 것을 환영합니다!`, 'good');
      if (firstAdmin) this.player.notice('서버의 첫 캐릭터라서 관리자 권한을 받았습니다. F2: 운영자 도구', 'good');
    } finally {
      this.busy = false;
    }
  }

  private async dispatch(p: Player, t: string, m: Record<string, unknown>): Promise<void> {
    const w = this.world;
    switch (t) {
      case 'walk':
        return handleWalk(w, p, m.dir, m.x, m.y);
      case 'turn':
        return handleTurn(p, m.dir);
      case 'attack':
        return playerAssail(w, p, m.target);
      case 'ability':
        return playerUseAbility(w, p, m.id, m.target);
      case 'useItem':
        return useItem(p, m.slot);
      case 'equip':
        return equipFromSlot(p, m.slot);
      case 'unequip':
        return unequip(p, m.eq);
      case 'dropItem':
        return dropItem(p, m.slot, m.qty);
      case 'dropGold':
        return dropGold(p, m.amount);
      case 'pickup':
        return pickup(p);
      case 'moveItem':
        return moveItem(p, m.from, m.to);
      case 'moveAbility':
        return moveAbility(p, m.kind, m.from, m.to);
      case 'chat':
        return handleChat(w, p, m.text);
      case 'talk':
        return talkToNpc(w, p, m.npc);
      case 'pick':
        return pickOption(w, p, m.npc, m.key);
      case 'buy':
        return buy(w, p, m.npc, m.item, m.qty);
      case 'sell':
        return sell(w, p, m.npc, m.slot, m.qty);
      case 'learnAbility':
        return learn(w, p, m.npc, m.id);
      case 'deposit':
        return deposit(w, p, m.npc, m.slot, m.qty);
      case 'withdraw':
        return withdraw(w, p, m.npc, m.index, m.qty);
      case 'depositGold':
        return depositGold(p, m.npc, m.amount);
      case 'withdrawGold':
        return withdrawGold(p, m.npc, m.amount);
      case 'stat':
        return allocateStat(p, m.stat, m.n);
      case 'recall':
        return ghostRecall(w, p);
      case 'groupReply':
        return w.groups.reply(p, m.accept === true);
      case 'auto':
        return handleAuto(w, p, m);
      case 'ping':
        return this.send({ t: 'pong', ts: Number(m.ts) || 0 });
    }
  }
}

function moveAbility(p: Player, kind: unknown, from: unknown, to: unknown): void {
  if (kind !== 'skill' && kind !== 'spell') return;
  const list = kind === 'skill' ? p.data.skills : p.data.spells;
  if (typeof from !== 'number' || typeof to !== 'number') return;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  p.markAbilities();
}

/** 새 캐릭터 데이터 */
export function newCharacter(world: World, name: string, passwordHash: string, gender: 'm' | 'f', hairStyle: number, hairColor: number): CharacterData {
  const cfg = world.config;
  const town = world.data.maps.get('town')!;
  const data: CharacterData = {
    version: 1,
    name,
    passwordHash,
    createdAt: Date.now(),
    lastLoginAt: 0,
    lastIp: '',
    role: 'player',
    banned: false,
    banReason: '',
    gender,
    hairStyle,
    hairColor,
    classId: 'peasant',
    level: 1,
    exp: 0,
    stats: { str: START_STAT, int: START_STAT, wis: START_STAT, con: START_STAT, dex: START_STAT },
    statPoints: 0,
    bonusHp: 0,
    bonusMp: 0,
    hp: 1,
    mp: 0,
    gold: 100,
    mapId: 'town',
    x: town.spawn.x,
    y: town.spawn.y,
    dir: 2,
    ghost: false,
    inventory: Array.from({ length: INVENTORY_SIZE }, () => null),
    equipment: emptyEquipment(),
    skills: [],
    spells: [],
    storage: [],
    storageGold: 0,
    kills: 0,
    deaths: 0,
    playTimeSec: 0,
    godMode: false,
    cooldowns: {},
    statusSave: [],
  };
  if (cfg.startLevel > 1) setLevelOnData(data, cfg, cfg.startLevel);
  for (const [id, qty] of STARTER_ITEMS) {
    const def = world.data.items.get(id);
    if (!def) continue;
    if (def.type === 'equip' && def.slot && !data.equipment[def.slot]) data.equipment[def.slot] = def.id;
    else addItem(data, def, qty);
  }
  const aid = world.data.abilities.get('first_aid');
  if (aid) learnOnData(data, aid);
  const equipped = EQUIP_SLOTS.map((s) => data.equipment[s])
    .map((id) => (id ? world.data.items.get(id) : undefined))
    .filter((d): d is NonNullable<typeof d> => !!d);
  const derived = computeDerived({
    cls: world.data.classes.get(data.classId)!,
    level: data.level,
    stats: data.stats,
    bonusHp: 0,
    bonusMp: 0,
    equipment: equipped,
  });
  data.hp = derived.maxHp;
  data.mp = derived.maxMp;
  return data;
}
