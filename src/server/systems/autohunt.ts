// 자동사냥: 서버가 플레이어 대신 사냥감을 찾아 걷고, 싸우고, 회복하고, 전리품을 줍습니다.
// 브라우저 탭이 백그라운드에 있어도 멈추지 않도록 모든 판단을 서버에서 합니다.
// 행동은 직접 조작과 같은 규칙(걷기 속도, 평타 대기, 기술 재사용 대기·마나, 아이템 대기)을 따릅니다.
import { sanitizeAutoSettings, type AutoSettings, type AutoState } from '../../shared/autohunt';
import { DIR_DX, DIR_DY, SPELL_GCD_MS, STATUS_INFO, WALK_MS, dirTowards, type StatusId } from '../../shared/constants';
import { magicBase, physicalBase } from '../../shared/formulas';
import type { AbilityDef, ItemDef } from '../../shared/types';
import { log } from '../log';
import type { Creature } from '../world/entities';
import type { GroundItem } from '../world/GroundItem';
import type { MapInstance } from '../world/MapInstance';
import type { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import { canFit } from './character';
import { playerAssail, playerUseAbility } from './combat';
import { pickup, useItem } from './inventory';
import { proficiencyMultiplier, secondJobPower } from './progression';

/** 한 칸 걷는 평균 간격 (직접 걷기보다 조금 느리게) */
export const AUTO_STEP_MS = Math.round(WALK_MS * 1.1);
/** 걸음 사이의 가장 짧은 간격 (직접 걸을 때 클라이언트가 다음 걸음을 보내는 간격과 같게) */
const AUTO_STEP_MIN_MS = Math.round(WALK_MS * 0.82);
/** 월드 틱 간격 (World.ts 의 TICK_MS. World.ts 가 이 파일을 불러오므로 거꾸로 불러오지 않고 같은 값을 둡니다) */
const TICK_MS = 100;
/** 판단 간격 */
const THINK_MS = 150;
/** 길찾기로 살펴보는 걸음 수 */
const SIGHT_STEPS = 16;
/** 이보다 멀리 돌아가야 닿는 사냥감은 노리지 않습니다 */
const PATH_LIMIT = 12;
/** 이보다 멀리 떨어진 전리품은 줍으러 가지 않습니다 */
const LOOT_LIMIT = 10;
/** 사냥감에게 이 시간 동안 다가가지 못하면 잠시 포기 */
const STUCK_TARGET_MS = 4000;
/** 공격할 자리에 있는데 이 시간 동안 피해를 주지 못하면 잠시 포기 */
const NO_DAMAGE_MS = 10_000;
/** 찾는 중에 이 시간 동안 걷지도 싸우지도 못하면 다른 곳으로 */
const STUCK_ROAM_MS = 8000;
/** 사냥 구역으로 이 시간 동안 돌아가지 못하면 멈춤 */
const STUCK_RETURN_MS = 8000;
const BLACKLIST_MS = 10_000;
const ITEM_BLACKLIST_MS = 30_000;
/** 실패한 기술은 잠시 다시 시도하지 않습니다 (오류 반복 방지) */
const ABILITY_BACKOFF_MS = 3000;
/** 소환 후 다시 소환을 시도하기까지 */
const SUMMON_BACKOFF_MS = 10_000;
/** 원거리 캐릭터가 붙은 적에게서 물러서는 최소 간격 */
const RETREAT_GAP_MS = 1200;
/** 원거리 캐릭터가 거리를 둘 때 쓰는 최대 거리 */
const KEEP_RANGE_MAX = 6;

type Pt = { x: number; y: number };

/** 플레이어 한 명의 자동사냥 진행 상태 (Player.auto) */
export interface AutoRun {
  settings: AutoSettings;
  /** 자동사냥을 시작한 곳. 이 둘레 settings.radius 칸 안에서만 움직입니다 */
  anchor: { mapId: string; x: number; y: number };
  state: AutoState;
  startedAt: number;
  /** 다음에 판단할 시각 */
  nextThinkAt: number;
  /** 다음 걸음을 걸을 예정 시각 (실제로는 반 틱 일찍부터 걸을 수 있음, stepReadyAt) */
  nextStepAt: number;
  /** 마지막으로 걸은 시각 */
  lastStepAt: number;
  /** 지금 노리는 몬스터 */
  target: Monster | null;
  targetId: number | null;
  /** 사냥감까지 남은 걸음 중 가장 가까웠던 값과 그때 시각 (막힘 판정) */
  targetBest: number;
  targetProgressAt: number;
  /** 사냥감에게 준 피해와 마지막으로 피해를 준 시각 (공격할 자리에서 오래 맞히지 못하면 포기) */
  targetDealt: number;
  targetHitAt: number;
  /** 줍으러 가는 아이템 */
  lootId: number | null;
  lootBest: number;
  lootProgressAt: number;
  /** 갈 수 없었던 몬스터/아이템 id → 다시 노릴 수 있는 시각 */
  blacklist: Map<number, number>;
  /** 실패한 기술 id → 다시 시도할 시각 */
  backoff: Map<string, number>;
  /** 찾는 중에 걸어가는 곳 */
  roam: Pt | null;
  /** 마지막으로 찾기 시작한 곳 (다음에는 여기서 먼 곳을 찾습니다) */
  lastSearch: Pt | null;
  lastPos: Pt;
  /** 마지막으로 걷거나 공격한 시각 */
  lastActiveAt: number;
  lastRetreatAt: number;
  /** 사냥 구역으로 돌아가는 중: 가장 가까웠던 거리와 그때 시각 */
  returnBest: number;
  returnProgressAt: number;
  /** 지난 판단 때의 체력과, 싸우는 동안 한 번에 깎인 가장 큰 체력 (위급 판정) */
  lastHp: number;
  bigHit: number;
  /** 쉬는 중 (체력/마나가 찰 때까지 사냥감을 찾지 않음) */
  resting: boolean;
  restForMp: boolean;
  /** 소지품이 가득 차서 줍기를 멈춤 */
  pickupOff: boolean;
  /** 한 번만 알리는 안내 */
  warned: Set<string>;
  /** 이번 자동사냥에서 쓰러뜨린 몬스터 수 (시작할 때의 처치 수와의 차이) */
  kills: number;
  killsAtStart: number;
}

// ───────────────────────── 켜기/끄기 ─────────────────────────

function refuseReason(p: Player): string | null {
  if (!p.map) return '지금은 자동사냥을 할 수 없습니다.';
  if (p.isDead) return '유령 상태에서는 자동사냥을 할 수 없습니다.';
  if (p.map.safe) return '마을에서는 자동사냥을 할 수 없습니다.';
  return null;
}

function newRun(p: Player, settings: AutoSettings, now: number): AutoRun {
  return {
    settings,
    anchor: { mapId: p.map!.id, x: p.x, y: p.y },
    state: 'searching',
    startedAt: now,
    nextThinkAt: now,
    nextStepAt: now,
    lastStepAt: 0,
    target: null,
    targetId: null,
    targetBest: Infinity,
    targetProgressAt: now,
    targetDealt: 0,
    targetHitAt: now,
    lootId: null,
    lootBest: Infinity,
    lootProgressAt: now,
    blacklist: new Map(),
    backoff: new Map(),
    roam: null,
    lastSearch: null,
    lastPos: { x: p.x, y: p.y },
    lastActiveAt: now,
    lastRetreatAt: 0,
    returnBest: Infinity,
    returnProgressAt: now,
    lastHp: p.hp,
    bigHit: 0,
    resting: false,
    restForMp: false,
    pickupOff: false,
    warned: new Set(),
    kills: 0,
    killsAtStart: p.data.kills,
  };
}

/** 클라이언트의 { t: 'auto', on, settings } 메시지 처리 */
export function handleAuto(world: World, p: Player, msg: Record<string, unknown>): void {
  void world;
  if (msg.on !== true) {
    if (p.auto) stopAuto(p, '자동사냥을 껐습니다.');
    else p.send({ t: 'auto', on: false });
    return;
  }
  const why = refuseReason(p);
  if (why) {
    if (p.auto) stopAuto(p, why);
    else p.send({ t: 'auto', on: false, reason: why });
    return;
  }
  const settings = sanitizeAutoSettings(msg.settings);
  const now = Date.now();
  const cur = p.auto;
  if (cur && cur.anchor.mapId === p.map!.id) {
    // 켜져 있는 동안 설정만 바꿈: 사냥 구역은 그대로 두고 새 설정으로 이어 갑니다
    cur.settings = settings;
    cur.backoff.clear();
    cur.blacklist.clear();
    cur.pickupOff = false;
    cur.resting = false;
    cur.nextThinkAt = now;
    p.send({ t: 'auto', on: true, state: cur.state });
    return;
  }
  p.auto = newRun(p, settings, now);
  p.send({ t: 'auto', on: true, state: p.auto.state });
}

/** 자동사냥을 끕니다 (수동 이동, 사망, 맵 이동, 접속 종료 등) */
export function stopAuto(p: Player, reason?: string): void {
  if (!p.auto) return;
  p.auto = null;
  p.send(reason ? { t: 'auto', on: false, reason } : { t: 'auto', on: false });
}

function setState(c: Ctx, s: AutoState): void {
  if (c.a.state === s) return;
  c.a.state = s;
  c.p.send({ t: 'auto', on: true, state: s });
}

// ───────────────────────── 틱 ─────────────────────────

/** 100ms 틱마다 각 플레이어에 대해 호출됩니다 */
export function autoHuntTick(world: World, p: Player, now: number): void {
  const a = p.auto;
  if (!a || now < a.nextThinkAt) return;
  a.nextThinkAt = now + THINK_MS;
  try {
    think(world, p, a, now);
  } catch (e) {
    log.error(`자동사냥 처리 중 오류 (${p.name}):`, e);
    stopAuto(p, '자동사냥 중 문제가 생겨 멈췄습니다.');
  }
}

function think(world: World, p: Player, a: AutoRun, now: number): void {
  const map = p.map;
  if (!map) return stopAuto(p, '자동사냥: 맵을 벗어나 멈췄습니다.');
  if (p.isDead) return stopAuto(p, '자동사냥: 캐릭터가 쓰러져 멈췄습니다.');
  if (map.id !== a.anchor.mapId) return stopAuto(p, '자동사냥: 다른 곳으로 옮겨져 멈췄습니다.');
  if (map.safe) return stopAuto(p, '마을에서는 자동사냥을 할 수 없습니다.');
  if (p.x !== a.lastPos.x || p.y !== a.lastPos.y) {
    a.lastPos = { x: p.x, y: p.y };
    a.lastActiveAt = now;
  }
  const c = new Ctx(world, p, a, map, now);
  noteTargetDeath(c);
  // 잠들거나 마비되면 기다립니다
  if (!p.canAct) return setState(c, 'idle');
  if (recover(c)) return;
  if (!p.auto) return;

  // 사냥 구역 밖: 붙어서 때리는 적이 없으면 돌아갑니다
  if (cheb(p, a.anchor) > c.s.radius) {
    const adj = c.attackers.find((m) => manh(p, m) === 1);
    if (adj) {
      setTarget(c, adj);
      return fight(c, adj);
    }
    return goBack(c);
  }
  a.returnBest = Infinity;
  a.returnProgressAt = now;

  // 쉬는 중
  if (a.resting) {
    if (c.attackers.length > 0 || restDone(c)) a.resting = false;
    else return setState(c, 'resting');
  }

  let t = keepTarget(c);
  // 나(나의 소환수)를 공격하는 몬스터를 먼저 상대합니다
  if (!t || !targetsMine(p, t)) {
    const att = pickTarget(c, true);
    if (att) t = att;
  }
  if (c.attackers.length === 0) {
    const loot = findLoot(c);
    if (loot) {
      if (t && !targetsMine(p, t)) clearTarget(c);
      return goLoot(c, loot);
    }
    if ((!t || !targetsMine(p, t)) && needRest(c)) {
      clearTarget(c);
      a.resting = true;
      return setState(c, 'resting');
    }
  }
  t ??= pickTarget(c, false);
  if (t) {
    setTarget(c, t);
    return fight(c, t);
  }
  clearTarget(c);
  // 소환수는 사냥감을 찾는 동안에도 미리 불러 둡니다
  if (rebuff(c, false)) return;
  roam(c);
}

// ───────────────────────── 판단 재료 ─────────────────────────

type Role = 'attack' | 'debuff' | 'buff' | 'summon' | 'heal' | 'mana' | 'other';

const ENEMY_TARGETING = new Set(['front', 'around', 'around8', 'enemy', 'enemyArea', 'line']);

/** 기술의 쓰임새 */
function roleOf(def: AbilityDef): Role {
  const fx = def.effects;
  if (fx.some((e) => e.type === 'summon')) return 'summon';
  if (ENEMY_TARGETING.has(def.targeting)) {
    if (fx.some((e) => e.type === 'physical' || e.type === 'magic' || e.type === 'sacrifice')) return 'attack';
    // 잠재우기는 때리면 깨므로 자동으로 쓰지 않습니다
    if (fx.some((e) => e.type === 'status' && STATUS_INFO[e.status].kind === 'debuff' && e.status !== 'sleep')) return 'debuff';
    return 'other';
  }
  if (fx.some((e) => e.type === 'dash' || e.type === 'revive')) return 'other';
  if (fx.some((e) => e.type === 'heal')) return 'heal';
  if (fx.some((e) => e.type === 'restoreMp')) return 'mana';
  if (fx.some((e) => e.type === 'status' && STATUS_INFO[e.status].kind === 'buff' && e.status !== 'hide')) return 'buff';
  return 'other';
}

/** 걸을 수 있는 칸까지의 걸음 수 (길찾기 결과) */
interface Field {
  start: number;
  dist: Map<number, number>;
  prev: Map<number, number>;
}

/** 한 번의 판단 동안 함께 쓰는 값들 */
class Ctx {
  readonly learned: AbilityDef[];
  readonly enemies: Monster[];
  /** 나(나의 소환수)를 노리는 가까운 적 */
  readonly attackers: Monster[];
  private fieldCache: Field | null = null;
  private styleCache: { reach: number; ranged: boolean } | null = null;

  constructor(
    readonly world: World,
    readonly p: Player,
    readonly a: AutoRun,
    readonly map: MapInstance,
    readonly now: number,
  ) {
    const abilities = world.data.abilities;
    this.learned = [...p.data.skills, ...p.data.spells].map((id) => abilities.get(id)).filter((d): d is AbilityDef => d !== undefined);
    this.enemies = [...map.monsters].filter(isEnemy);
    this.attackers = this.enemies.filter((m) => targetsMine(p, m) && cheb(p, m) <= 10 && cheb(m, a.anchor) <= a.settings.radius + 4);
  }

  get s(): AutoSettings {
    return this.a.settings;
  }

  /** 사냥 구역 안에서 걸어갈 수 있는 칸들 */
  get field(): Field {
    this.fieldCache ??= bfs(this.map, this.p, SIGHT_STEPS, (x, y) => Math.max(Math.abs(x - this.a.anchor.x), Math.abs(y - this.a.anchor.y)) <= this.s.radius);
    return this.fieldCache;
  }

  /** 걸은 뒤에는 길찾기를 다시 합니다 */
  moved(): void {
    this.fieldCache = null;
  }

  /** 직접 고른 공격/약화 기술 (고른 순서) */
  get chosenOffense(): AbilityDef[] {
    return this.s.abilities
      .map((id) => this.learned.find((d) => d.id === id))
      .filter((d): d is AbilityDef => d !== undefined && (roleOf(d) === 'attack' || roleOf(d) === 'debuff'));
  }

  /** 공격 기술 (사용 순서). 고른 공격 기술이 없으면 (회복·강화 기술만 골랐어도) 배운 공격 기술을 알아서 고릅니다 */
  get offense(): AbilityDef[] {
    const chosen = this.chosenOffense;
    if (chosen.length > 0) return chosen;
    if (!this.s.autoAbilities) return [];
    return this.learned.filter((d) => roleOf(d) === 'attack' || roleOf(d) === 'debuff');
  }

  /** 강화/소환 기술 */
  get buffs(): AbilityDef[] {
    const s = this.s;
    return this.learned.filter((d) => {
      const r = roleOf(d);
      if (r !== 'buff' && r !== 'summon') return false;
      return s.abilities.includes(d.id) || s.buffs;
    });
  }

  /** 회복 기술을 위해 남겨 둘 마나 */
  get healReserve(): number {
    if (this.s.hpPct <= 0) return 0;
    let r = Infinity;
    for (const d of this.learned) if (roleOf(d) === 'heal' && d.mp > 0) r = Math.min(r, d.mp);
    return r === Infinity ? 0 : r;
  }

  /** 거리를 두고 싸우는지 (활, 또는 자주 쓸 수 있는 원거리 공격 마법) */
  get style(): { reach: number; ranged: boolean } {
    if (this.styleCache) return this.styleCache;
    const ranged = this.p.derived.range > 1;
    let reach = ranged ? this.p.derived.range : 1;
    for (const d of this.offense) {
      if (d.kind !== 'spell' || d.cooldownMs > 3000) continue;
      if (d.targeting !== 'enemy' && d.targeting !== 'enemyArea') continue;
      if (!d.effects.some((e) => e.type === 'magic')) continue;
      if (!this.p.god && this.p.mp < d.mp + this.healReserve) continue;
      reach = Math.max(reach, d.range ?? 7);
    }
    this.styleCache = { reach: Math.min(reach, Math.max(KEEP_RANGE_MAX, ranged ? this.p.derived.range : 1)), ranged };
    return this.styleCache;
  }
}

const cheb = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manh = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const pct = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 100);

/** 내 편이 아닌, 싸울 수 있는 몬스터 */
function isEnemy(m: Monster): boolean {
  return !m.dead && !m.def.passive && !m.def.summon && m.owner === null;
}

/** 이 몬스터가 나 또는 나의 소환수를 노리는지 */
function targetsMine(p: Player, m: Monster): boolean {
  const t: unknown = m.target;
  if (!t) return false;
  if (t === p) return true;
  for (const s of p.summons) if (s === t) return true;
  return false;
}

/** 그룹이 아닌 다른 사람이 이미 싸우고 있는 몬스터인지 */
function engagedByOther(c: Ctx, m: Monster): boolean {
  const { p, world } = c;
  const t = m.target as Creature | null;
  if (t && t !== p && !t.isDead && t.map === m.map) {
    if (t.kind === 'player') {
      if (!world.groups.sameGroup(p.name, t.name)) return true;
    } else if (t.kind === 'monster') {
      const owner = (t as Monster).owner;
      if (owner && owner !== p && !world.groups.sameGroup(p.name, owner.name)) return true;
    }
  }
  if (m.damageBy.has(p.name)) return false;
  for (const [name, dmg] of m.damageBy) {
    if (dmg <= 0 || name === p.name || world.groups.sameGroup(p.name, name)) continue;
    const other = world.findPlayer(name);
    if (other && other.map === m.map && !other.isDead) return true;
  }
  return false;
}

function blacklisted(c: Ctx, id: number): boolean {
  const until = c.a.blacklist.get(id);
  if (until === undefined) return false;
  if (until > c.now) return true;
  c.a.blacklist.delete(id);
  return false;
}

// ───────────────────────── 길찾기와 걷기 ─────────────────────────

/** from 에서 걸어갈 수 있는 칸들 (워프 칸, 막힌 칸, allowed 가 아닌 칸 제외) */
function bfs(map: MapInstance, from: Pt, maxSteps: number, allowed: (x: number, y: number) => boolean): Field {
  const start = map.idx(from.x, from.y);
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const queue = [start];
  for (let qi = 0; qi < queue.length && qi < 3000; qi++) {
    const k = queue[qi]!;
    const d = dist.get(k)!;
    if (d >= maxSteps) continue;
    const x = k % map.width;
    const y = (k - x) / map.width;
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DIR_DX[dir]!;
      const ny = y + DIR_DY[dir]!;
      if (!map.inBounds(nx, ny)) continue;
      const nk = map.idx(nx, ny);
      if (dist.has(nk)) continue;
      if (!map.isFree(nx, ny) || map.isWarpTile(nx, ny) || !allowed(nx, ny)) continue;
      dist.set(nk, d + 1);
      prev.set(nk, k);
      queue.push(nk);
    }
  }
  return { start, dist, prev };
}

/** 목표 칸으로 가는 첫 걸음 */
function firstStep(map: MapInstance, f: Field, goal: number): Pt | null {
  if (goal === f.start || !f.dist.has(goal)) return null;
  let k = goal;
  for (let guard = 0; guard < 5000; guard++) {
    const pk = f.prev.get(k);
    if (pk === undefined) return null;
    if (pk === f.start) break;
    k = pk;
  }
  const x = k % map.width;
  return { x, y: (k - x) / map.width };
}

/**
 * 다음 걸음을 걸을 수 있는지. 판단은 월드 틱(100ms)마다만 하므로 정확히 그 시각에 맞추면 한 칸이 300ms 가 됩니다.
 * 그래서 반 틱 일찍부터 걷게 하고, 이어서 걸을 때는 지난 걸음의 예정 시각에서 다음 걸음을 잽니다 (stepTo).
 */
function stepReadyAt(a: AutoRun): number {
  return Math.max(a.nextStepAt - TICK_MS / 2, a.lastStepAt + AUTO_STEP_MIN_MS);
}

function canStep(c: Ctx): boolean {
  const at = stepReadyAt(c.a);
  if (c.now >= at) return true;
  wake(c, at);
  return false;
}

/** 다음 판단을 at 무렵으로 당깁니다 */
function wake(c: Ctx, at: number): void {
  c.a.nextThinkAt = Math.min(c.a.nextThinkAt, Math.max(at, c.now + 50));
}

/** 서버가 플레이어를 한 칸 걷게 합니다 (본인 포함 모두에게 알려서 화면에서 걷는 모습이 보임) */
function stepTo(c: Ctx, x: number, y: number): boolean {
  const { p, map, a, now } = c;
  if (manh(p, { x, y }) !== 1 || !map.isFree(x, y) || map.isWarpTile(x, y)) return false;
  const d = dirTowards(p.x, p.y, x, y);
  if (d === null) return false;
  p.dir = d;
  map.move(p, x, y);
  map.broadcast({ t: 'walk', id: p.id, x, y, dir: d });
  // 이어서 걷는 중이면 틱에 맞추느라 늦어진 만큼 다음 걸음을 당겨서 평균 AUTO_STEP_MS 로 걷습니다 (최소 간격은 stepReadyAt)
  const due = now - a.nextStepAt <= TICK_MS ? a.nextStepAt : now;
  a.nextStepAt = due + AUTO_STEP_MS;
  a.lastStepAt = now;
  a.nextThinkAt = stepReadyAt(a);
  a.lastActiveAt = now;
  a.lastPos = { x, y };
  c.moved();
  return true;
}

/** 목표 칸 쪽으로 한 걸음 (구역 안 길찾기) */
function stepAlong(c: Ctx, goal: number): boolean {
  const s = firstStep(c.map, c.field, goal);
  return s !== null && stepTo(c, s.x, s.y);
}

function face(c: Ctx, t: Pt): void {
  const { p, map } = c;
  const d = dirTowards(p.x, p.y, t.x, t.y);
  if (d !== null && d !== p.dir) {
    p.dir = d;
    map.broadcast({ t: 'turn', id: p.id, dir: d });
  }
}

/** 실패한 시도의 오류 메시지(p.err)가 대화창을 도배하지 않도록 잠시 가로챕니다 */
function quietly(p: Player, fn: () => void): void {
  const own = Object.prototype.hasOwnProperty.call(p, 'err');
  const prev = p.err;
  p.err = () => {};
  try {
    fn();
  } finally {
    if (own) p.err = prev;
    else delete (p as { err?: unknown }).err;
  }
}

// ───────────────────────── 사냥감 ─────────────────────────

function setTarget(c: Ctx, m: Monster): void {
  const a = c.a;
  if (a.target === m) return;
  a.target = m;
  a.targetId = m.id;
  a.targetBest = Infinity;
  a.targetProgressAt = c.now;
  a.targetDealt = m.damageBy.get(c.p.name) ?? 0;
  a.targetHitAt = c.now;
}

function clearTarget(c: Ctx): void {
  c.a.target = null;
  c.a.targetId = null;
}

/** 노리던 몬스터가 쓰러졌으면 놓아 줍니다 */
function noteTargetDeath(c: Ctx): void {
  c.a.kills = Math.max(0, c.p.data.kills - c.a.killsAtStart);
  if (c.a.target?.dead) clearTarget(c);
}

function validTarget(c: Ctx, m: Monster): boolean {
  const { p, s } = c;
  if (m.dead || m.map !== c.map || !isEnemy(m) || blacklisted(c, m.id)) return false;
  const mine = targetsMine(p, m);
  if (cheb(m, c.a.anchor) > s.radius + (mine ? 2 : 0)) return false;
  if (mine) return true;
  if (s.maxLevelGap > 0 && m.level > p.level + s.maxLevelGap) return false;
  return !engagedByOther(c, m);
}

/** 공격할 수 있는 자리까지 남은 걸음 (갈 수 없으면 null) */
function approachCost(c: Ctx, m: Monster): number | null {
  const { p } = c;
  const reach = c.style.reach;
  if (reach > 1 ? cheb(p, m) <= reach : manh(p, m) === 1) return 0;
  const f = c.field;
  let best: number | null = null;
  for (let d = 0; d < 4; d++) {
    const x = m.x + DIR_DX[d]!;
    const y = m.y + DIR_DY[d]!;
    if (!c.map.inBounds(x, y)) continue;
    const v = f.dist.get(c.map.idx(x, y));
    if (v !== undefined && (best === null || v < best)) best = v;
  }
  if (best === null) return null;
  return reach > 1 ? Math.max(1, best - (reach - 1)) : best;
}

function keepTarget(c: Ctx): Monster | null {
  const t = c.a.target;
  if (!t) return null;
  if (!validTarget(c, t) || approachCost(c, t) === null) {
    clearTarget(c);
    return null;
  }
  return t;
}

/** 사냥감 고르기: 나를 노리는 몬스터 → 가까운 몬스터 → 체력이 적은 몬스터 */
function pickTarget(c: Ctx, onlyAttackers: boolean): Monster | null {
  let best: Monster | null = null;
  let bk: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const m of onlyAttackers ? c.attackers : c.enemies) {
    if (!validTarget(c, m)) continue;
    const cost = approachCost(c, m);
    if (cost === null || cost > PATH_LIMIT) continue;
    const key: [number, number, number] = [targetsMine(c.p, m) ? 0 : 1, cost, m.hpPct];
    if (key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] || (key[1] === bk[1] && key[2] < bk[2])))) {
      best = m;
      bk = key;
    }
  }
  return best;
}

// ───────────────────────── 기술 ─────────────────────────

function ready(c: Ctx, def: AbilityDef, reserve: number): boolean {
  const { p, a, now } = c;
  if (now < p.gcdUntil) return false;
  if (now < (p.cooldowns.get(def.id) ?? 0)) return false;
  if (now < (a.backoff.get(def.id) ?? 0)) return false;
  return p.god || p.mp >= def.mp + reserve;
}

/**
 * 내 행동으로 바뀐 체력(필살의 체력 소모, 회복 기술, 흡혈, 물약)은 맞은 피해로 치지 않도록 위급 판정의 기준을 함께 옮깁니다.
 * 이렇게 하지 않으면 필살로 체력을 절반 쓴 것을 '한 번 더 맞으면 쓰러지는 큰 피해'로 보고 엘릭서나 귀환 주문서를 씁니다.
 */
function ownHpChange(c: Ctx, hpBefore: number): void {
  c.a.lastHp += c.p.hp - hpBefore;
}

/** 기술을 씁니다. 실제로 쓰였으면 true */
function cast(c: Ctx, def: AbilityDef, targetId?: number): boolean {
  const { p, a, now } = c;
  const before = p.gcdUntil;
  const hp = p.hp;
  quietly(p, () => playerUseAbility(c.world, p, def.id, targetId, now));
  ownHpChange(c, hp);
  if (p.gcdUntil !== before) {
    a.lastActiveAt = now;
    return true;
  }
  a.backoff.set(def.id, now + ABILITY_BACKOFF_MS);
  return false;
}

function adjacentEnemies(c: Ctx, at: Pt, eight: boolean): number {
  let n = 0;
  for (const m of c.enemies) {
    const dx = Math.abs(m.x - at.x);
    const dy = Math.abs(m.y - at.y);
    if (eight ? Math.max(dx, dy) === 1 : dx + dy === 1) n++;
  }
  return n;
}

/** 일직선 공격: 대상이 바라볼 수 있는 일직선 위, 사거리 안에 있고 사이가 막히지 않았는지 */
function lineClear(c: Ctx, t: Pt, range: number): boolean {
  const { p, map } = c;
  if (p.x !== t.x && p.y !== t.y) return false;
  const n = manh(p, t);
  if (n < 1 || n > range) return false;
  const sx = Math.sign(t.x - p.x);
  const sy = Math.sign(t.y - p.y);
  for (let i = 1; i <= n; i++) if (!map.isWalkable(p.x + sx * i, p.y + sy * i)) return false;
  return true;
}

const AROUND4: readonly Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const AROUND8: readonly Pt[] = [...AROUND4, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }];

/** 그 칸에서 플레이어의 기술에 맞는 몬스터 (소환수는 플레이어 편이라 맞지 않습니다) */
function monsterAt(c: Ctx, x: number, y: number): Monster | null {
  const e = c.map.creatureAt(x, y);
  if (!e || e.kind !== 'monster') return null;
  const m = e as Monster;
  return !m.dead && m.owner === null ? m : null;
}

function monstersAround(c: Ctx, at: Pt, offs: readonly Pt[]): Monster[] {
  const out: Monster[] = [];
  for (const o of offs) {
    const m = monsterAt(c, at.x + o.x, at.y + o.y);
    if (m) out.push(m);
  }
  return out;
}

interface ReachPlan {
  face?: Pt;
  targetId?: number;
  /** 실제로 맞을 몬스터 (서버의 범위 판정과 같은 모양) */
  hit: Monster[];
}

/** 이 기술을 지금 쓰면 맞을 몬스터들. 대상을 칠 수 없으면 null */
function victims(c: Ctx, def: AbilityDef, t: Monster): ReachPlan | null {
  const { p, map } = c;
  switch (def.targeting) {
    case 'front':
      return manh(p, t) === 1 ? { face: t, hit: [t] } : null;
    case 'around':
      return { hit: monstersAround(c, p, AROUND4) };
    case 'around8':
      return { hit: monstersAround(c, p, AROUND8) };
    case 'line': {
      // 바라보는 쪽으로 사거리까지, 막힌 칸 앞까지의 모든 몬스터
      const range = def.range ?? 3;
      if (!lineClear(c, t, range)) return null;
      const sx = Math.sign(t.x - p.x);
      const sy = Math.sign(t.y - p.y);
      const hit: Monster[] = [];
      for (let i = 1; i <= range; i++) {
        const x = p.x + sx * i;
        const y = p.y + sy * i;
        if (!map.isWalkable(x, y)) break;
        const m = monsterAt(c, x, y);
        if (m) hit.push(m);
      }
      return { face: t, hit };
    }
    case 'enemy':
      return cheb(p, t) <= (def.range ?? 7) ? { targetId: t.id, hit: [t] } : null;
    case 'enemyArea':
      // 대상과 그 주변 4칸
      return cheb(p, t) <= (def.range ?? 7) ? { targetId: t.id, hit: [t, ...monstersAround(c, t, AROUND4)] } : null;
    default:
      return null;
  }
}

/**
 * 범위 기술로도 건드리면 안 되는 몬스터: 그룹이 아닌 다른 사람이 싸우는 몬스터(가로채기),
 * 레벨이 너무 높아 노리지 않는 몬스터. 나(나의 소환수)를 노리는 몬스터는 괜찮습니다.
 */
function offLimits(c: Ctx, m: Monster): boolean {
  if (targetsMine(c.p, m)) return false;
  if (c.s.maxLevelGap > 0 && m.level > c.p.level + c.s.maxLevelGap) return true;
  return engagedByOther(c, m);
}

/** 지금 이 기술로 대상을 칠 수 있으면 쓰는 방법과 쳐 줄 몬스터들, 아니면 null */
function reachPlan(c: Ctx, def: AbilityDef, t: Monster): ReachPlan | null {
  const v = victims(c, def, t);
  if (!v) return null;
  // 건드리면 안 되는 몬스터가 함께 맞으면 쓰지 않습니다 (남의 사냥감 가로채기 방지)
  if (v.hit.some((m) => offLimits(c, m))) return null;
  // 허수아비 같은 싸우지 않는 몬스터는 쳐 주지 않습니다
  const hit = v.hit.filter(isEnemy);
  return hit.length > 0 ? { ...v, hit } : null;
}

/**
 * 기술의 대략적인 기대 피해 (고르는 순서용). 맞는 몬스터마다 남은 체력보다 큰 피해는 쳐 주지 않습니다.
 * 숙련도 배율을 곱하므로, 갓 배운 기술보다 숙련도가 높은 (이전 직업의 기술일 수도 있는) 기술을 먼저 고를 수 있습니다.
 * 2차 직업 위력도 곱해 남은 체력과 견주는 값이 실제 피해와 맞게 합니다
 */
function valueOf(c: Ctx, def: AbilityDef, hit: readonly Monster[]): number {
  const { p } = c;
  const d = p.derived;
  const phys = physicalBase(d, p.level, (d.dmgMin + d.dmgMax) / 2);
  let v = 0;
  for (const e of def.effects) {
    if (e.type === 'physical') v += (phys * e.mult + (e.bonus ?? 0)) * (e.hits ?? 1);
    else if (e.type === 'magic') v += magicBase(e.base, e.ratio, d[e.stat ?? 'int'], p.level, d.magic);
    else if (e.type === 'sacrifice') v += p.hp * e.hpPct * e.mult;
    else if (e.type === 'status' && STATUS_INFO[e.status].kind === 'debuff') v += phys * 0.8;
  }
  v *= proficiencyMultiplier(p, def.id) * secondJobPower(p);
  let sum = 0;
  for (const m of hit) sum += Math.min(v, m.hp);
  return sum;
}

function debuffStatuses(def: AbilityDef): StatusId[] {
  const out: StatusId[] = [];
  for (const e of def.effects) if (e.type === 'status' && STATUS_INFO[e.status].kind === 'debuff') out.push(e.status);
  return out;
}

/** 공격 기술을 하나 씁니다 */
function useOffense(c: Ctx, t: Monster): boolean {
  const { p, s } = c;
  if (c.now < p.gcdUntil) return false;
  const reserve = c.healReserve;
  const chosen = c.chosenOffense.length > 0;
  const options: { def: AbilityDef; plan: ReachPlan; v: number }[] = [];
  for (const def of c.offense) {
    if (!ready(c, def, def.mp > 0 ? reserve : 0)) continue;
    const plan = reachPlan(c, def, t);
    if (!plan) continue;
    const isAttack = roleOf(def) === 'attack';
    // 약화 기술은 아직 걸려 있지 않을 때만
    if (!isAttack && debuffStatuses(def).every((st) => t.hasStatus(st))) continue;
    // 체력을 깎는 기술은 체력이 넉넉하고, 대상이 그 피해를 다 받아낼 만큼 단단할 때만
    if (def.effects.some((e) => e.type === 'sacrifice' && (pct(p.hp, p.maxHp) < Math.max(70, s.hpPct + 20) || t.hp < p.hp * e.hpPct * 2))) continue;
    options.push({ def, plan, v: valueOf(c, def, plan.hit) });
  }
  // 직접 고른 공격 기술이 있으면 그 순서대로, 없으면 기대 피해가 큰 것부터 (같으면 마나와 재사용 대기가 적은 것)
  if (!chosen) options.sort((x, y) => y.v - x.v || x.def.mp - y.def.mp || x.def.cooldownMs - y.def.cooldownMs);
  for (const o of options) {
    if (o.plan.face) face(c, o.plan.face);
    if (cast(c, o.def, o.plan.targetId)) return true;
  }
  return false;
}

function buffStatuses(def: AbilityDef): StatusId[] {
  const out: StatusId[] = [];
  for (const e of def.effects) if (e.type === 'status' && STATUS_INFO[e.status].kind === 'buff') out.push(e.status);
  return out;
}

/** 나의 소환수 수 (종류별) */
function summonCount(c: Ctx, monsterId: string): number {
  const mine = new Set<Monster>();
  for (const m of c.p.summons) if (!m.dead && m.map === c.map && m.def.id === monsterId) mine.add(m);
  for (const m of c.map.monsters) if (m.owner === c.p && !m.dead && m.def.id === monsterId) mine.add(m);
  return mine.size;
}

/** 꺼진 강화 기술을 다시 걸고, 모자란 소환수를 부릅니다 */
function rebuff(c: Ctx, fighting: boolean): boolean {
  const { p } = c;
  if (c.now < p.gcdUntil) return false;
  const reserve = c.healReserve;
  for (const def of c.buffs) {
    if (!ready(c, def, def.mp > 0 ? reserve : 0)) continue;
    if (roleOf(def) === 'summon') {
      const e = def.effects.find((x) => x.type === 'summon');
      if (!e || e.type !== 'summon' || summonCount(c, e.monster) >= e.max) continue;
      if (cast(c, def)) {
        c.a.backoff.set(def.id, c.now + SUMMON_BACKOFF_MS);
        return true;
      }
      continue;
    }
    // 강화는 싸울 때만 (찾는 동안 마나를 아낍니다)
    if (!fighting) continue;
    if (buffStatuses(def).every((st) => p.hasStatus(st))) continue;
    if (cast(c, def, def.targeting === 'ally' ? p.id : undefined)) return true;
  }
  return false;
}

// ───────────────────────── 회복 ─────────────────────────

/** 회복 기술의 회복량 (숙련도 배율과 2차 직업 위력 포함) */
function healAmount(c: Ctx, def: AbilityDef): number {
  const d = c.p.derived;
  let v = 0;
  for (const e of def.effects) if (e.type === 'heal') v += magicBase(e.base, e.ratio, d[e.stat ?? 'wis'], c.p.level, d.magic);
  return v * proficiencyMultiplier(c.p, def.id) * secondJobPower(c.p);
}

/** 모자란 양을 채우는 가장 작은 것, 없으면 가장 큰 것 */
function pickBest<T>(list: { v: number; item: T }[], missing: number): T | null {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.v - b.v);
  return (sorted.find((x) => x.v >= missing) ?? sorted[sorted.length - 1]!).item;
}

function usableItem(c: Ctx, def: ItemDef | undefined): def is ItemDef {
  return !!def && def.type === 'consumable' && !!def.use && (!def.level || c.p.level >= def.level || c.p.isGm);
}

/** 물약 칸 목록. precious(엘릭서처럼 비율로 회복)는 위급할 때만 */
function potions(c: Ctx, kind: 'hp' | 'mp', precious: boolean): { v: number; item: number }[] {
  const { p, world } = c;
  const out: { v: number; item: number }[] = [];
  p.data.inventory.forEach((s, i) => {
    if (!s) return;
    const def = world.data.items.get(s.item);
    if (!usableItem(c, def)) return;
    const u = def.use!;
    if (u.recall || u.exp) return;
    const flat = kind === 'hp' ? (u.hp ?? 0) : (u.mp ?? 0);
    const ratio = kind === 'hp' ? (u.hpPct ?? 0) : (u.mpPct ?? 0);
    if (flat <= 0 && ratio <= 0) return;
    if (ratio > 0 && !precious) return;
    out.push({ v: flat + ratio * (kind === 'hp' ? p.maxHp : p.maxMp), item: i });
  });
  return out;
}

function recallSlot(c: Ctx): number {
  const { p, world } = c;
  return p.data.inventory.findIndex((s) => {
    if (!s) return false;
    const def = world.data.items.get(s.item);
    return usableItem(c, def) && def.use!.recall === true;
  });
}

/** 아이템을 씁니다. 실제로 쓰였으면 true */
function useSlot(c: Ctx, slot: number): boolean {
  const { p, now } = c;
  if (now < p.nextItemAt) return false;
  const before = p.nextItemAt;
  const hp = p.hp;
  quietly(p, () => useItem(p, slot, now));
  ownHpChange(c, hp);
  return p.nextItemAt !== before;
}

function healSkills(c: Ctx): AbilityDef[] {
  return c.learned.filter((d) => roleOf(d) === 'heal');
}

/** 곧(1.5초 안에) 쓸 수 있는 회복 기술이 있는지 */
function healSoon(c: Ctx): boolean {
  const { p, now } = c;
  return healSkills(c).some((d) => (p.god || p.mp >= d.mp) && (p.cooldowns.get(d.id) ?? 0) - now <= 1500);
}

/** 마나가 넉넉한 회복 기술을 가장 먼저 쓸 수 있게 되는 시각 (공용 대기와 그 기술의 재사용 대기 중 늦은 쪽). 없으면 null */
function healReadyAt(c: Ctx): number | null {
  const { p, a, now } = c;
  let best: number | null = null;
  for (const d of healSkills(c)) {
    if (!p.god && p.mp < d.mp) continue;
    if (now < (a.backoff.get(d.id) ?? 0)) continue;
    const at = Math.max(now, p.gcdUntil, p.cooldowns.get(d.id) ?? 0);
    if (best === null || at < best) best = at;
  }
  return best;
}

/** 이 캐릭터가 마나를 쓰는지 (마나를 쓰지 않으면 마나 물약을 아낍니다) */
function usesMana(c: Ctx): boolean {
  return c.p.maxMp > 0 && c.learned.some((d) => d.mp > 0);
}

function notifyOnce(c: Ctx, key: string, text: string): void {
  if (c.a.warned.has(key)) return;
  c.a.warned.add(key);
  c.p.notice(text, 'warn');
}

/** 체력/마나 회복. 무언가 했으면(또는 멈췄으면) true */
function recover(c: Ctx): boolean {
  const { p, s, now } = c;
  const a = c.a;
  const hpPct = pct(p.hp, p.maxHp);
  const underAttack = c.attackers.length > 0 || adjacentEnemies(c, p, false) > 0;
  // 싸우는 동안 한 번에 크게 깎였으면, 같은 공격을 한 번 더 받으면 쓰러질 때 위급으로 봅니다
  if (!underAttack) a.bigHit = 0;
  else if (a.lastHp - p.hp > a.bigHit) a.bigHit = a.lastHp - p.hp;
  a.lastHp = p.hp;
  const danger = underAttack && a.bigHit > 0 && p.hp <= a.bigHit * 1.1;
  if (s.hpPct > 0 && (hpPct < s.hpPct || danger)) {
    const critical = hpPct < Math.min(20, s.hpPct) || danger;
    // 1) 자신에게 쓸 수 있는 회복 기술
    const skills = healSkills(c)
      .filter((d) => ready(c, d, 0))
      .map((d) => ({ v: healAmount(c, d), item: d }));
    const skill = pickBest(skills, p.maxHp - p.hp);
    if (skill && cast(c, skill, skill.targeting === 'ally' ? p.id : undefined)) {
      setState(c, 'healing');
      return true;
    }
    // 회복 기술을 공용 대기(GCD) 한 번 길이 안에 쓸 수 있으면 (방금 쓴 기술의 공용 대기 등), 위급하지 않을 때는 물약을 아끼고 기다립니다
    const healAt = critical ? null : healReadyAt(c);
    if (healAt !== null && healAt - now <= SPELL_GCD_MS) {
      wake(c, healAt);
      return true;
    }
    // 2) 체력 물약
    const pots = potions(c, 'hp', critical);
    if (pots.length > 0) {
      if (now < p.nextItemAt) {
        wake(c, p.nextItemAt);
      } else {
        const slot = pickBest(pots, p.maxHp - p.hp);
        if (slot !== null && useSlot(c, slot)) {
          setState(c, 'healing');
          return true;
        }
      }
    } else if (potions(c, 'hp', true).length === 0) {
      // 3) 물약이 없음: 맞고 있는데 위험하면 귀환하거나 멈춥니다
      if (critical && underAttack && !healSoon(c)) {
        const r = s.recall ? recallSlot(c) : -1;
        if (r >= 0) {
          if (now < p.nextItemAt) {
            wake(c, p.nextItemAt);
            return true;
          }
          stopAuto(p, '자동사냥: 물약이 떨어져 귀환 주문서로 마을에 돌아갔습니다.');
          quietly(p, () => useItem(p, r, now));
          return true;
        }
        stopAuto(p, '자동사냥: 체력이 위험한데 물약이 없어 멈췄습니다!');
        return true;
      }
      if (!healSoon(c)) notifyOnce(c, 'hpPotion', '자동사냥: 체력 물약이 떨어졌습니다.');
    }
  }
  if (s.mpPct > 0 && usesMana(c) && pct(p.mp, p.maxMp) < s.mpPct) {
    // 마나 회복 기술은 붙어 있는 적이 없을 때
    if (adjacentEnemies(c, p, false) === 0) {
      const skill = c.learned.find((d) => roleOf(d) === 'mana' && ready(c, d, 0));
      if (skill && cast(c, skill)) {
        setState(c, 'healing');
        return true;
      }
    }
    const pots = potions(c, 'mp', false);
    if (pots.length > 0 && now >= p.nextItemAt) {
      const slot = pickBest(pots, p.maxMp - p.mp);
      if (slot !== null && useSlot(c, slot)) {
        setState(c, 'healing');
        return true;
      }
    }
  }
  return false;
}

/** 싸우지 않을 때 쉬어야 하는지 (회복 수단이 없음) */
function needRest(c: Ctx): boolean {
  const { p, s, a } = c;
  if (s.hpPct > 0 && pct(p.hp, p.maxHp) < s.hpPct && potions(c, 'hp', false).length === 0 && !healSoon(c)) {
    a.restForMp = false;
    return true;
  }
  // 마법으로 싸우는 캐릭터는 마나가 모자라면 쉬어 갑니다
  if (s.mpPct > 0 && usesMana(c) && pct(p.mp, p.maxMp) < s.mpPct && potions(c, 'mp', false).length === 0) {
    const caster = c.offense.some((d) => d.kind === 'spell' && d.mp > 0) && p.derived.range <= 1;
    const manaSkill = c.learned.some((d) => roleOf(d) === 'mana' && ready(c, d, 0));
    if (caster && !manaSkill) {
      a.restForMp = true;
      return true;
    }
  }
  return false;
}

function restDone(c: Ctx): boolean {
  const { p, s, a } = c;
  if (s.hpPct > 0 && p.hp < p.maxHp && pct(p.hp, p.maxHp) < Math.min(95, s.hpPct + 15)) return false;
  if (a.restForMp && p.mp < p.maxMp && pct(p.mp, p.maxMp) < Math.min(95, Math.max(s.mpPct, 20) + 25)) return false;
  return true;
}

// ───────────────────────── 싸움 ─────────────────────────

/** 평타. 원거리 무기면 대상을 지정해서 쏩니다 */
function assail(c: Ctx, t: Monster): boolean {
  const { p, now } = c;
  if (now < p.nextAssailAt) return false;
  face(c, t);
  const before = p.nextAssailAt;
  if (c.style.ranged) playerAssail(c.world, p, t.id, now);
  else playerAssail(c.world, p, undefined, now);
  if (p.nextAssailAt === before) return false;
  c.a.lastActiveAt = now;
  return true;
}

/** 붙은 적에게서 한 칸 물러설 자리 (구역 안, 다른 적과도 붙지 않는 칸) */
function retreatTile(c: Ctx, t: Monster): Pt | null {
  const { p, map, a, s } = c;
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    const x = p.x + DIR_DX[d]!;
    const y = p.y + DIR_DY[d]!;
    if (!map.isFree(x, y) || map.isWarpTile(x, y)) continue;
    if (cheb({ x, y }, a.anchor) > s.radius) continue;
    if (adjacentEnemies(c, { x, y }, false) > 0) continue;
    const dt = cheb({ x, y }, t);
    if (dt < 2 || dt > c.style.reach) continue;
    let score = 0;
    for (const m of c.enemies) score += Math.min(4, manh({ x, y }, m));
    if (score > bestScore) {
      best = { x, y };
      bestScore = score;
    }
  }
  return best;
}

/** 사냥감에게 다가가는 걸음 */
function approach(c: Ctx, t: Monster): boolean {
  const { map } = c;
  const f = c.field;
  let goal = -1;
  let bestD = Infinity;
  for (let d = 0; d < 4; d++) {
    const x = t.x + DIR_DX[d]!;
    const y = t.y + DIR_DY[d]!;
    if (!map.inBounds(x, y)) continue;
    const k = map.idx(x, y);
    const v = f.dist.get(k);
    if (v !== undefined && v < bestD) {
      bestD = v;
      goal = k;
    }
  }
  if (goal >= 0 && stepAlong(c, goal)) return true;
  // 구역 안 길이 막혔으면 몬스터 쪽 길찾기를 빌립니다 (구역을 벗어나지 않을 때만)
  const s = map.nextStepTowards(c.p.x, c.p.y, t.x, t.y, SIGHT_STEPS);
  return s !== null && cheb(s, c.a.anchor) <= c.s.radius && stepTo(c, s.x, s.y);
}

function fight(c: Ctx, t: Monster): void {
  const { p, a, now } = c;
  const cost = approachCost(c, t);
  if (cost !== null && cost < a.targetBest) {
    a.targetBest = cost;
    a.targetProgressAt = now;
  }
  // 1) 강화 2) 공격 기술 3) 평타
  if (!rebuff(c, true)) useOffense(c, t);
  if (t.dead) {
    noteTargetDeath(c);
    return setState(c, 'fighting');
  }
  const reach = c.style.reach;
  const dist = cheb(p, t);
  const adjacent = manh(p, t) === 1;
  // 평타: 활은 사거리 안이면, 근접 무기는 붙어 있으면 (마법으로 싸우다 붙었을 때도 무기로 칩니다)
  if ((c.style.ranged ? dist <= p.derived.range : adjacent) && assail(c, t)) a.targetProgressAt = now;
  if (t.dead) {
    noteTargetDeath(c);
    return setState(c, 'fighting');
  }
  const inPosition = reach > 1 ? dist <= reach : adjacent;
  const dealt = t.damageBy.get(p.name) ?? 0;
  if (dealt > a.targetDealt || !inPosition) {
    a.targetDealt = dealt;
    a.targetHitAt = now;
  }
  if (inPosition) {
    if (now - a.targetHitAt > NO_DAMAGE_MS) {
      a.blacklist.set(t.id, now + BLACKLIST_MS);
      clearTarget(c);
      return setState(c, 'searching');
    }
    setState(c, 'fighting');
    a.targetProgressAt = now;
    // 원거리 캐릭터는 붙은 적에게서 한 걸음 물러섭니다
    if (reach > 1 && adjacentEnemies(c, p, false) > 0 && now - a.lastRetreatAt >= RETREAT_GAP_MS && now >= stepReadyAt(a)) {
      const r = retreatTile(c, t);
      if (r && stepTo(c, r.x, r.y)) {
        a.lastRetreatAt = now;
        return;
      }
    }
    if (p.nextAssailAt > now) wake(c, p.nextAssailAt);
    if (p.gcdUntil > now) wake(c, p.gcdUntil);
    return;
  }
  // 다가가기 (오래 다가가지 못하면 잠시 포기)
  if (now - a.targetProgressAt > STUCK_TARGET_MS) {
    a.blacklist.set(t.id, now + BLACKLIST_MS);
    clearTarget(c);
    return setState(c, 'searching');
  }
  setState(c, 'moving');
  if (!canStep(c)) return;
  approach(c, t);
}

// ───────────────────────── 전리품 ─────────────────────────

function mayLoot(c: Ctx, it: GroundItem): boolean {
  const { p, now, world } = c;
  if (!it.owner || it.owner === p.name || now >= it.ownerUntil) return true;
  return world.groups.sameGroup(p.name, it.owner);
}

function findLoot(c: Ctx): GroundItem | null {
  const { p, a, s, map, world } = c;
  if (!s.pickup || a.pickupOff) return null;
  let best: GroundItem | null = null;
  let bestD = Infinity;
  let full = false;
  for (const it of map.items) {
    // 사람이 일부러 버린 물건은 줍지 않습니다
    if (it.droppedBy !== null) continue;
    if (cheb(it, a.anchor) > s.radius || blacklisted(c, it.id) || !mayLoot(c, it)) continue;
    const d = it.x === p.x && it.y === p.y ? 0 : c.field.dist.get(map.idx(it.x, it.y));
    if (d === undefined || d > LOOT_LIMIT) continue;
    if (it.itemId !== null) {
      const def = world.data.items.get(it.itemId);
      if (!def) continue;
      if (!canFit(p.data, def, 1)) {
        full = true;
        continue;
      }
    }
    if (d < bestD) {
      best = it;
      bestD = d;
    }
  }
  if (!best && full) {
    a.pickupOff = true;
    p.notice('자동사냥: 소지품이 가득 차서 줍기를 멈췄습니다.', 'warn');
  }
  return best;
}

function goLoot(c: Ctx, it: GroundItem): void {
  const { p, a, now, map } = c;
  setState(c, 'looting');
  if (a.lootId !== it.id) {
    a.lootId = it.id;
    a.lootBest = Infinity;
    a.lootProgressAt = now;
  }
  if (p.x === it.x && p.y === it.y) {
    quietly(p, () => pickup(p, now));
    a.lastActiveAt = now;
    // 남아 있으면(남의 것이거나 일부만 주움) 다시 시도하지 않습니다
    if (it.map) a.blacklist.set(it.id, now + ITEM_BLACKLIST_MS);
    a.lootId = null;
    return;
  }
  const d = c.field.dist.get(map.idx(it.x, it.y)) ?? Infinity;
  if (d < a.lootBest) {
    a.lootBest = d;
    a.lootProgressAt = now;
  } else if (now - a.lootProgressAt > STUCK_TARGET_MS) {
    a.blacklist.set(it.id, now + ITEM_BLACKLIST_MS);
    a.lootId = null;
    return;
  }
  if (!canStep(c)) return;
  stepAlong(c, map.idx(it.x, it.y));
}

// ───────────────────────── 찾기와 돌아가기 ─────────────────────────

function pickRoamGoal(c: Ctx): Pt | null {
  const { p, a, map } = c;
  const f = c.field;
  const far: number[] = [];
  const near: number[] = [];
  for (const [k, d] of f.dist) {
    if (d >= 4) far.push(k);
    else if (d >= 1) near.push(k);
  }
  const pool = far.length > 0 ? far : near;
  if (pool.length === 0) return null;
  const from = a.lastSearch ?? p;
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 24; i++) {
    const k = pool[Math.floor(Math.random() * pool.length)]!;
    const x = k % map.width;
    const pt = { x, y: (k - x) / map.width };
    // 지난번에 찾던 곳에서 멀고, 시작한 곳에서 너무 멀지 않은 곳
    const score = cheb(pt, from) - cheb(pt, a.anchor) * 0.3 + Math.random() * 3;
    if (score > bestScore) {
      best = pt;
      bestScore = score;
    }
  }
  return best;
}

function roam(c: Ctx): void {
  const { p, a, now, map } = c;
  setState(c, 'searching');
  if (a.roam) {
    const arrived = p.x === a.roam.x && p.y === a.roam.y;
    const lost = !c.field.dist.has(map.idx(a.roam.x, a.roam.y));
    if (arrived || lost || now - a.lastActiveAt > STUCK_ROAM_MS) a.roam = null;
  }
  if (!a.roam) {
    a.roam = pickRoamGoal(c);
    a.lastSearch = { x: p.x, y: p.y };
    a.lastActiveAt = now;
    if (!a.roam) return setState(c, 'idle');
  }
  if (!canStep(c)) return;
  if (!stepAlong(c, map.idx(a.roam.x, a.roam.y))) a.roam = null;
}

/** 사냥 구역 밖으로 밀려났으면 시작한 곳으로 돌아갑니다 */
function goBack(c: Ctx): void {
  const { p, a, now, map } = c;
  setState(c, 'returning');
  clearTarget(c);
  const d = cheb(p, a.anchor);
  if (d < a.returnBest) {
    a.returnBest = d;
    a.returnProgressAt = now;
  } else if (now - a.returnProgressAt > STUCK_RETURN_MS) {
    return stopAuto(p, '자동사냥: 사냥 구역으로 돌아갈 수 없어 멈췄습니다.');
  }
  if (!canStep(c)) return;
  const { x, y } = a.anchor;
  const step = manh(p, a.anchor) === 1 ? { x, y } : map.nextStepTowards(p.x, p.y, x, y, 60);
  if (step && stepTo(c, step.x, step.y)) return;
  // 시작한 칸이 막혀 있으면 구역 안의 가장 가까운 칸으로
  const f = bfs(map, p, 30, () => true);
  let goal = -1;
  let bestD = Infinity;
  for (const [k, dist] of f.dist) {
    const kx = k % map.width;
    const pt = { x: kx, y: (k - kx) / map.width };
    if (cheb(pt, a.anchor) <= c.s.radius && dist < bestD) {
      bestD = dist;
      goal = k;
    }
  }
  const s = goal >= 0 ? firstStep(map, f, goal) : null;
  if (s) stepTo(c, s.x, s.y);
}
