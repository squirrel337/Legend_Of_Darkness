// 전투: 평타, 기술/마법, 피해/회복, 상태 효과, 사망/부활, 경험치와 전리품
import {
  ASSAIL_COOLDOWN_MS,
  DIR_DX,
  DIR_DY,
  SKILL_GCD_MS,
  SPELL_GCD_MS,
  STATUS_INFO,
  dirTowards,
  formatNumber,
  type Dir,
  type Element,
  type StatusId,
} from '../../shared/constants';
import {
  CRIT_MULT,
  acMagicMultiplier,
  acMultiplier,
  critChance,
  elementMultiplier,
  hitChance,
  magicBase,
  physicalBase,
} from '../../shared/formulas';
import type { AbilityDef, AbilityEffect } from '../../shared/types';
import type { DamageKind } from '../../shared/protocol';
import type { Creature } from '../world/entities';
import type { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import { dropToGround } from './ground';
import { gainExp } from './progression';

const rand = Math.random;
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const isPlayer = (c: Creature): c is Player => c.kind === 'player';
const isMonster = (c: Creature): c is Monster => c.kind === 'monster';

// ───────────────────────── 상태 효과 ─────────────────────────

function broadcastStatuses(c: Creature): void {
  c.map?.broadcast({ t: 'statuses', id: c.id, statuses: c.visibleStatuses() });
  if (isPlayer(c)) c.markSelf();
}

export function applyStatus(
  target: Creature,
  id: StatusId,
  durationMs: number,
  potency: number | undefined,
  source: Creature | null,
): boolean {
  if (target.isDead) return false;
  if (isMonster(target) && target.def.passive && STATUS_INFO[id].kind === 'debuff' && (id === 'sleep' || id === 'paralyze')) return false;
  const now = Date.now();
  const existing = target.statuses.get(id);
  const pot = potency ?? STATUS_INFO[id].potency;
  target.statuses.set(id, {
    id,
    until: Math.max(existing?.until ?? 0, now + durationMs),
    potency: Math.max(existing?.potency ?? 0, pot),
    sourceLevel: source?.level ?? target.level,
    sourceId: source?.id ?? target.id,
    nextTickAt: existing?.nextTickAt ?? now + 1000,
  });
  if (id === 'hide' && isPlayer(target)) {
    // 은신: 쫓아오던 몬스터들이 놓칩니다
    for (const m of target.map?.monsters ?? []) if (m.target === target) m.target = null;
  }
  if (isPlayer(target) && (id === 'armor' || id === 'curse')) target.recompute();
  broadcastStatuses(target);
  return true;
}

export function removeStatus(target: Creature, id: StatusId): void {
  if (!target.statuses.delete(id)) return;
  if (isPlayer(target) && (id === 'armor' || id === 'curse')) target.recompute();
  broadcastStatuses(target);
}

const DEBUFFS: StatusId[] = ['poison', 'curse', 'sleep', 'paralyze'];

export function cleanseDebuffs(target: Creature): void {
  for (const id of DEBUFFS) removeStatus(target, id);
}

/** 100ms마다 호출: 만료 처리와 지속 피해/회복 */
export function tickStatuses(c: Creature, now: number): void {
  if (c.statuses.size === 0) return;
  for (const s of [...c.statuses.values()]) {
    if (s.until <= now) {
      removeStatus(c, s.id);
      if (isPlayer(c)) c.sys(`${STATUS_INFO[s.id].name} 효과가 사라졌습니다.`);
      continue;
    }
    if (now < s.nextTickAt) continue;
    s.nextTickAt = now + 1000;
    if (s.id === 'poison' && !c.isDead) {
      // 중독으로는 죽지 않습니다 (체력 1 남김)
      let dmg = Math.round(s.potency + s.sourceLevel * 1.5);
      if (c.hp - dmg < 1) dmg = c.hp - 1;
      if (dmg > 0 && !(isPlayer(c) && c.god)) {
        c.hp -= dmg;
        emitDamage(c, dmg, 'dot');
      }
    } else if (s.id === 'regen' && !c.isDead) {
      healCreature(c, c, Math.round(s.potency + s.sourceLevel * 1.5), true);
    }
  }
}

// ───────────────────────── 피해와 회복 ─────────────────────────

function emitDamage(target: Creature, v: number, k: DamageKind): void {
  target.map?.broadcast({ t: 'dmg', id: target.id, v: Math.round(v), k, hp: target.hpPct });
  if (isPlayer(target)) target.markVitals();
}

/** 실제로 체력을 깎습니다. 죽으면 사망 처리까지 합니다. */
export function applyDamage(world: World, src: Creature | null, target: Creature, amount: number, kind: DamageKind): number {
  if (target.isDead || !target.map) return 0;
  const now = Date.now();
  if (isPlayer(target) && target.god) {
    emitDamage(target, 0, 'immune');
    return 0;
  }
  let dmg = amount;
  const iron = target.statuses.get('ironskin');
  if (iron) dmg *= 1 - Math.min(90, iron.potency) / 100;
  dmg = Math.max(1, Math.round(dmg));
  const before = target.hp;
  target.hp = Math.max(0, target.hp - dmg);
  target.lastCombatAt = now;
  if (src) src.lastCombatAt = now;
  if (target.statuses.has('sleep')) removeStatus(target, 'sleep');
  if (isMonster(target)) {
    target.lastDamagedAt = now;
    if (src && isPlayer(src)) {
      target.addDamage(src, Math.min(dmg, before));
      if (!target.target || target.target.isDead || target.target.map !== target.map) {
        target.target = src;
        target.chaseSince = now;
      }
    }
  }
  emitDamage(target, dmg, kind);
  if (target.hp <= 0) {
    if (isMonster(target)) killMonster(world, target);
    else if (isPlayer(target)) killPlayer(world, target, src);
  }
  return dmg;
}

export function healCreature(src: Creature, target: Creature, amount: number, quiet: boolean): number {
  if (target.isDead) return 0;
  const gain = Math.max(0, Math.min(Math.round(amount), target.maxHp - target.hp));
  target.hp += gain;
  if (!quiet || gain > 0) emitDamage(target, Math.round(amount), 'heal');
  void src;
  return gain;
}

export function restoreMana(target: Creature, amount: number): number {
  const gain = Math.max(0, Math.min(Math.round(amount), target.maxMp - target.mp));
  target.mp += gain;
  if (gain > 0) target.map?.broadcast({ t: 'dmg', id: target.id, v: gain, k: 'mp', hp: target.hpPct });
  if (isPlayer(target)) target.markVitals();
  return gain;
}

// ───────────────────────── 명중 판정 ─────────────────────────

interface PhysOpts {
  mult: number;
  bonus?: number;
  critBonus?: number;
  hideBonus?: number;
  wasHidden?: boolean;
  element: Element;
}

/** 물리 공격 한 번 (플레이어 또는 몬스터) */
export function physicalAttack(world: World, attacker: Creature, target: Creature, o: PhysOpts): number {
  const hitBonus = isPlayer(attacker) ? attacker.derived.hit : 0;
  if (rand() > hitChance(attacker.dex, attacker.level, target.dex, target.level, hitBonus)) {
    emitDamage(target, 0, 'miss');
    if (isMonster(target) && isPlayer(attacker) && !target.target) {
      target.target = attacker;
      target.chaseSince = Date.now();
    }
    return 0;
  }
  let base: number;
  let crit = false;
  if (isPlayer(attacker)) {
    const d = attacker.derived;
    base = physicalBase(d, attacker.level, randInt(d.dmgMin, d.dmgMax)) * o.mult + (o.bonus ?? 0);
    if (o.hideBonus && o.wasHidden) base *= 1 + o.hideBonus;
    const might = attacker.statuses.get('might');
    if (might) base *= 1 + might.potency / 100;
    if (rand() < critChance(d.dex, o.critBonus ?? 0)) {
      crit = true;
      base *= CRIT_MULT;
    }
  } else {
    const m = attacker as Monster;
    base = randInt(m.stats.dmg[0], m.stats.dmg[1]) * o.mult;
    const might = m.statuses.get('might');
    if (might) base *= 1 + might.potency / 100;
  }
  const dmg = base * acMultiplier(target.ac) * elementMultiplier(o.element, target.defenseElement);
  return applyDamage(world, attacker, target, dmg, crit ? 'crit' : 'phys');
}

function statValue(c: Creature, stat: string | undefined, fallback: 'int' | 'wis'): number {
  if (isPlayer(c)) {
    const d = c.derived as unknown as Record<string, number>;
    return d[stat ?? fallback] ?? 0;
  }
  return (c as Monster).stats.int;
}

export function magicAttack(world: World, caster: Creature, target: Creature, e: Extract<AbilityEffect, { type: 'magic' }>, element: Element): number {
  const magicPct = isPlayer(caster) ? caster.derived.magic : 0;
  let base = magicBase(e.base, e.ratio, statValue(caster, e.stat, 'int'), caster.level, magicPct);
  const focus = caster.statuses.get('focus');
  if (focus) base *= 1 + focus.potency / 100;
  base *= 0.9 + rand() * 0.2;
  const dmg = base * acMagicMultiplier(target.ac) * elementMultiplier(element, target.defenseElement);
  return applyDamage(world, caster, target, dmg, 'magic');
}

// ───────────────────────── 사망 ─────────────────────────

function killMonster(world: World, m: Monster): void {
  const map = m.map;
  if (!map || m.dead) return;
  const now = Date.now();
  m.dead = true;
  m.hp = 0;
  m.statuses.clear();
  const x = m.x;
  const y = m.y;
  map.remove(m, 'death');
  m.spawner?.onDeath(m, now);

  // 가장 많은 피해를 준 (접속 중인) 플레이어가 경험치와 전리품을 받습니다
  let top: Player | undefined;
  let topDmg = 0;
  for (const [name, dmg] of m.damageBy) {
    const p = world.findPlayer(name);
    // 유령이 된 사람은 보상을 받지 않습니다 (살아서 마무리한 사람이 받음)
    if (p && p.map === map && !p.isDead && dmg > topDmg) {
      top = p;
      topDmg = dmg;
    }
  }
  if (!top) return;
  top.data.kills++;
  const cfg = world.config;
  const exp = m.stats.exp * cfg.expRate;
  if (exp > 0) {
    const sharers = world.groups.expSharers(top, map, x, y);
    if (sharers.length <= 1) gainExp(top, exp);
    else {
      const each = (exp * (1 + 0.1 * (sharers.length - 1))) / sharers.length;
      for (const p of sharers) gainExp(p, each);
    }
  }
  const [gmin, gmax] = m.stats.gold;
  const gold = Math.floor(randInt(gmin, gmax) * cfg.goldRate);
  if (gold > 0) {
    top.data.gold += gold;
    top.send({ t: 'gain', exp: 0, gold });
    top.markInv();
    top.markSelf();
  }
  // 아이템 전리품
  const spots = dropSpots(map, x, y);
  let si = 0;
  for (const l of m.def.loot ?? []) {
    const chance = Math.min(1, l.chance * cfg.dropRate);
    if (rand() >= chance) continue;
    const qty = l.qty ? randInt(l.qty[0], l.qty[1]) : 1;
    const spot = spots[si++ % spots.length]!;
    dropToGround(world, map, spot.x, spot.y, l.item, qty, top.name);
    const def = world.data.items.get(l.item);
    if (def && def.type === 'equip' && (def.level ?? 0) >= 25) {
      top.notice(`${def.name}을(를) 획득할 기회! 바닥을 확인하세요.`, 'good');
    }
  }
  if (m.def.boss) {
    world.announce(`${top.name}님이 ${m.def.name}을(를) 쓰러뜨렸습니다!`);
  }
}

function dropSpots(map: NonNullable<Creature['map']>, x: number, y: number): { x: number; y: number }[] {
  const out = [{ x, y }];
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
    if (map.isWalkable(x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  }
  return out;
}

function killPlayer(world: World, p: Player, killer: Creature | null): void {
  const map = p.map;
  if (!map) return;
  p.data.ghost = true;
  p.hp = 0;
  p.data.deaths++;
  p.statuses.clear();
  const pen = world.config.deathExpPenalty;
  let lost = 0;
  if (pen > 0 && p.data.exp > 0) {
    lost = Math.floor(p.data.exp * pen);
    p.data.exp -= lost;
  }
  map.refreshBlocking(p);
  for (const m of map.monsters) if (m.target === p) m.target = null;
  p.recompute();
  p.broadcastLook();
  map.broadcast({ t: 'statuses', id: p.id, statuses: [] });
  const by = killer ? `${killer.name}에게 ` : '';
  p.notice(`${by}쓰러졌습니다... 유령이 되었습니다.`, 'warn');
  p.sys('신전의 사제에게 가면 부활할 수 있습니다. (R 키: 마을로 돌아가기)' + (lost > 0 ? ` 경험치 ${formatNumber(lost)}을(를) 잃었습니다.` : ''));
  world.groups.touch(p);
}

export function revivePlayer(p: Player, hpPct: number): boolean {
  if (!p.isDead || !p.map) return false;
  const map = p.map;
  if (!map.isFree(p.x, p.y)) {
    const spot = map.findFreeNear(p.x, p.y);
    if (spot) {
      map.move(p, spot.x, spot.y);
      map.broadcast({ t: 'jump', id: p.id, x: spot.x, y: spot.y, dir: p.dir });
    }
  }
  p.data.ghost = false;
  p.recompute(false);
  p.hp = Math.max(1, Math.round(p.maxHp * hpPct));
  map.refreshBlocking(p);
  p.markSelf();
  p.broadcastLook();
  map.broadcast({ t: 'fx', fx: 'revive', id: p.id });
  p.notice('부활했습니다!', 'good');
  p.world.groups.touch(p);
  return true;
}

// ───────────────────────── 평타 ─────────────────────────

function breakHide(p: Creature): void {
  if (p.statuses.has('hide')) removeStatus(p, 'hide');
}

export function canFight(p: Player): string | null {
  if (p.isDead) return '유령 상태에서는 싸울 수 없습니다.';
  if (!p.canAct) return '지금은 행동할 수 없습니다.';
  if (p.map?.safe) return '마을 안에서는 싸울 수 없습니다.';
  return null;
}

export function playerAssail(world: World, p: Player, now = Date.now()): void {
  const map = p.map;
  if (!map || p.isDead || !p.canAct) return;
  if (now < p.nextAssailAt) return;
  p.nextAssailAt = now + ASSAIL_COOLDOWN_MS;
  map.broadcast({ t: 'act', id: p.id, a: 'attack', dir: p.dir });
  if (map.safe) return;
  const wasHidden = p.hasStatus('hide');
  const target = map.creatureAt(p.x + DIR_DX[p.dir]!, p.y + DIR_DY[p.dir]!);
  if (!target || !isMonster(target) || target.isDead) return;
  breakHide(p);
  physicalAttack(world, p, target, { mult: 1, element: p.offenseElement, wasHidden });
}

// ───────────────────────── 기술/마법 ─────────────────────────

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 시전자 기준 적대 관계인지 */
function hostile(caster: Creature, c: Creature): boolean {
  if (c === caster || c.isDead) return false;
  if (isPlayer(caster)) return isMonster(c);
  return isPlayer(c) && !c.god;
}

function friendly(caster: Creature, c: Creature): boolean {
  if (isPlayer(caster)) return isPlayer(c);
  return isMonster(c);
}

function frontCreature(c: Creature): Creature | undefined {
  return c.map?.creatureAt(c.x + DIR_DX[c.dir]!, c.y + DIR_DY[c.dir]!);
}

function nearestHostile(caster: Creature, range: number): Creature | undefined {
  const map = caster.map;
  if (!map) return undefined;
  let best: Creature | undefined;
  let bestScore = Infinity;
  const pool: Iterable<Creature> = isPlayer(caster) ? map.monsters : map.players;
  for (const c of pool) {
    if (!hostile(caster, c)) continue;
    const d = chebyshev(caster, c);
    if (d > range) continue;
    // 바라보는 방향에 있는 대상을 약간 우선
    const facing = dirTowards(caster.x, caster.y, c.x, c.y) === caster.dir ? -0.5 : 0;
    const score = d + facing;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

interface CastContext {
  def: AbilityDef;
  caster: Creature;
  /** 클라이언트가 지정한 대상 */
  targetId?: number;
  /** 몬스터 시전 시 대상 */
  forcedTarget?: Creature;
}

/** 시전 대상 목록을 고릅니다. 실패하면 이유 문자열 */
function resolveTargets(ctx: CastContext): Creature[] | string {
  const { def, caster } = ctx;
  const map = caster.map!;
  const range = def.range ?? (def.targeting === 'line' ? 3 : 7);
  const pickTarget = (pred: (c: Creature) => boolean): Creature | undefined => {
    if (ctx.forcedTarget && pred(ctx.forcedTarget)) return ctx.forcedTarget;
    if (ctx.targetId !== undefined) {
      const e = map.entities.get(ctx.targetId);
      if (e && (e.kind === 'player' || e.kind === 'monster') && pred(e as Creature)) return e as Creature;
    }
    return undefined;
  };
  switch (def.targeting) {
    case 'self':
      return [caster];
    case 'front': {
      if (def.effects.some((e) => e.type === 'dash')) return []; // 돌진은 이동 후 정함
      const t = ctx.forcedTarget ?? frontCreature(caster);
      if (!t || !hostile(caster, t)) return '앞에 공격할 대상이 없습니다.';
      return [t];
    }
    case 'around':
    case 'around8': {
      const offs =
        def.targeting === 'around'
          ? [[0, -1], [1, 0], [0, 1], [-1, 0]]
          : [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      const out: Creature[] = [];
      for (const [dx, dy] of offs) {
        const c = map.creatureAt(caster.x + dx!, caster.y + dy!);
        if (c && hostile(caster, c)) out.push(c);
      }
      if (out.length === 0) return '주변에 공격할 대상이 없습니다.';
      return out;
    }
    case 'line': {
      const out: Creature[] = [];
      for (let i = 1; i <= range; i++) {
        const x = caster.x + DIR_DX[caster.dir]! * i;
        const y = caster.y + DIR_DY[caster.dir]! * i;
        if (!map.isWalkable(x, y)) break;
        const c = map.creatureAt(x, y);
        if (c && hostile(caster, c)) out.push(c);
      }
      if (out.length === 0) return '앞쪽에 공격할 대상이 없습니다.';
      return out;
    }
    case 'enemy':
    case 'enemyArea': {
      const inRange = (c: Creature) => hostile(caster, c) && chebyshev(caster, c) <= range;
      const t = pickTarget(inRange) ?? nearestHostile(caster, range);
      if (!t) return `사거리(${range}칸) 안에 대상이 없습니다.`;
      if (def.targeting === 'enemy') return [t];
      const out: Creature[] = [t];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const c = map.creatureAt(t.x + dx, t.y + dy);
        if (c && c !== t && hostile(caster, c)) out.push(c);
      }
      return out;
    }
    case 'ally': {
      const reviving = def.effects.some((e) => e.type === 'revive');
      const ok = (c: Creature) => friendly(caster, c) && chebyshev(caster, c) <= range && (reviving ? c.isDead : !c.isDead);
      const t = pickTarget(ok);
      if (t) return [t];
      if (reviving) {
        // 대상을 지정하지 않았으면 가장 가까운 유령
        let best: Creature | undefined;
        for (const p of map.players) if (ok(p) && (!best || chebyshev(caster, p) < chebyshev(caster, best))) best = p;
        return best ? [best] : '부활시킬 유령이 근처에 없습니다.';
      }
      return [caster];
    }
  }
}

function elementFor(def: AbilityDef, caster: Creature, effect: AbilityEffect): Element {
  if (def.element === 'weapon') return caster.offenseElement;
  if (def.element) return def.element;
  return effect.type === 'physical' ? caster.offenseElement : 'none';
}

/** 시전자를 바라보는 방향으로 최대 distance칸 이동 (돌진/순간이동) */
function dash(caster: Creature, distance: number): void {
  const map = caster.map!;
  let x = caster.x;
  let y = caster.y;
  for (let i = 0; i < distance; i++) {
    const nx = x + DIR_DX[caster.dir]!;
    const ny = y + DIR_DY[caster.dir]!;
    if (!map.isFree(nx, ny) || map.isWarpTile(nx, ny)) break;
    x = nx;
    y = ny;
  }
  if (x !== caster.x || y !== caster.y) {
    map.move(caster, x, y);
    map.broadcast({ t: 'jump', id: caster.id, x, y, dir: caster.dir });
  }
}

/** 효과를 실제로 적용합니다 (플레이어/몬스터 공통) */
function runEffects(world: World, ctx: CastContext, targets: Creature[], wasHidden: boolean): void {
  const { def, caster } = ctx;
  const map = caster.map!;
  let list = targets;
  for (const e of def.effects) {
    if (e.type === 'dash') {
      dash(caster, e.distance);
      if (def.targeting === 'front') {
        const t = frontCreature(caster);
        list = t && hostile(caster, t) ? [t] : [];
      }
      continue;
    }
    for (const t of list) {
      if (!t.map || (t.isDead && e.type !== 'revive')) continue;
      const el = elementFor(def, caster, e);
      switch (e.type) {
        case 'physical':
          physicalAttack(world, caster, t, {
            mult: e.mult,
            bonus: e.bonus,
            critBonus: e.critBonus,
            hideBonus: e.hideBonus,
            wasHidden,
            element: el,
          });
          break;
        case 'magic':
          magicAttack(world, caster, t, e, el);
          break;
        case 'heal': {
          const magicPct = isPlayer(caster) ? caster.derived.magic : 0;
          let amt = magicBase(e.base, e.ratio, statValue(caster, e.stat, 'wis'), caster.level, magicPct);
          const focus = caster.statuses.get('focus');
          if (focus) amt *= 1 + focus.potency / 100;
          healCreature(caster, t, amt, false);
          break;
        }
        case 'status': {
          if (e.chance !== undefined && rand() > e.chance) {
            map.broadcast({ t: 'dmg', id: t.id, v: 0, k: 'miss', hp: t.hpPct });
            break;
          }
          applyStatus(t, e.status, e.durationMs, e.potency, caster);
          break;
        }
        case 'cleanse':
          cleanseDebuffs(t);
          break;
        case 'revive':
          if (isPlayer(t)) revivePlayer(t, e.hpPct);
          break;
        case 'restoreMp':
          restoreMana(caster, caster.maxMp * e.pct);
          break;
        case 'sacrifice': {
          const cost = Math.floor(caster.hp * e.hpPct);
          if (cost <= 0) break;
          caster.hp = Math.max(1, caster.hp - cost);
          if (isPlayer(caster)) caster.markVitals();
          map.broadcast({ t: 'dmg', id: caster.id, v: cost, k: 'dot', hp: caster.hpPct });
          applyDamage(world, caster, t, cost * e.mult * elementMultiplier(el, t.defenseElement), 'crit');
          break;
        }
      }
    }
  }
  if (def.fx) {
    const el = def.element === 'weapon' ? caster.offenseElement : (def.element ?? 'none');
    if (list.length === 0 || def.targeting === 'self') map.broadcast({ t: 'fx', fx: def.fx, id: caster.id, from: caster.id, el });
    else for (const t of list) map.broadcast({ t: 'fx', fx: def.fx, id: t.id, from: caster.id, el });
  }
}

const OFFENSIVE = (def: AbilityDef) =>
  def.effects.some((e) => e.type === 'physical' || e.type === 'magic' || e.type === 'sacrifice') ||
  ['enemy', 'enemyArea', 'front', 'around', 'around8', 'line'].includes(def.targeting);

/** 플레이어가 기술/마법을 사용합니다 */
export function playerUseAbility(world: World, p: Player, abilityId: unknown, targetId: unknown, now = Date.now()): void {
  if (typeof abilityId !== 'string') return;
  const def = world.data.abilities.get(abilityId);
  const map = p.map;
  if (!def || !map) return;
  const list = def.kind === 'skill' ? p.data.skills : p.data.spells;
  if (!list.includes(def.id)) return p.err('배우지 않은 기술입니다.');
  if (p.isDead) return p.err('유령 상태에서는 사용할 수 없습니다.');
  if (!p.canAct) return p.err('지금은 행동할 수 없습니다.');
  if (map.safe && OFFENSIVE(def)) return p.err('마을 안에서는 싸울 수 없습니다.');
  if (now < p.gcdUntil) return;
  const cd = p.cooldowns.get(def.id) ?? 0;
  if (now < cd) return p.err(`${def.name}: ${((cd - now) / 1000).toFixed(1)}초 후에 다시 사용할 수 있습니다.`);
  if (p.mp < def.mp && !p.god) return p.err('마나가 부족합니다.');
  const ctx: CastContext = { def, caster: p, ...(typeof targetId === 'number' ? { targetId } : {}) };
  // 대상 쪽을 바라보게
  if (def.targeting === 'enemy' || def.targeting === 'enemyArea' || def.targeting === 'ally') {
    const pre = resolveTargets(ctx);
    if (typeof pre === 'string') return p.err(pre);
    const t = pre[0];
    if (t && t !== p) {
      const d = dirTowards(p.x, p.y, t.x, t.y);
      if (d !== null && d !== p.dir) {
        p.dir = d as Dir;
        map.broadcast({ t: 'turn', id: p.id, dir: p.dir });
      }
    }
    return castNow(world, p, ctx, pre, now);
  }
  const targets = resolveTargets(ctx);
  if (typeof targets === 'string') return p.err(targets);
  castNow(world, p, ctx, targets, now);
}

function castNow(world: World, p: Player, ctx: CastContext, targets: Creature[], now: number): void {
  const def = ctx.def;
  if (!p.god) p.mp -= def.mp;
  p.markVitals();
  p.gcdUntil = now + (def.kind === 'spell' ? SPELL_GCD_MS : SKILL_GCD_MS);
  if (def.cooldownMs > 0) {
    p.cooldowns.set(def.id, now + def.cooldownMs);
    p.send({ t: 'cooldown', id: def.id, ms: def.cooldownMs });
  }
  const wasHidden = p.hasStatus('hide');
  const appliesHide = def.effects.some((e) => e.type === 'status' && e.status === 'hide');
  if (!appliesHide && OFFENSIVE(def)) breakHide(p);
  p.map!.broadcast({ t: 'act', id: p.id, a: def.kind === 'spell' ? 'cast' : 'skill', dir: p.dir });
  runEffects(world, ctx, targets, wasHidden);
}

/** 몬스터가 기술/마법을 사용합니다. 사용했으면 true */
export function monsterUseAbility(world: World, m: Monster, def: AbilityDef, target: Player): boolean {
  if (!m.map || m.dead || !m.canAct) return false;
  const ctx: CastContext = { def, caster: m, forcedTarget: target };
  const range = def.range ?? 7;
  if (def.targeting !== 'self' && def.targeting !== 'around' && def.targeting !== 'around8' && chebyshev(m, target) > range) return false;
  const targets = resolveTargets(ctx);
  if (typeof targets === 'string' || (targets.length === 0 && def.targeting !== 'self')) return false;
  m.map.broadcast({ t: 'act', id: m.id, a: 'cast', dir: m.dir });
  runEffects(world, ctx, targets, false);
  return true;
}
