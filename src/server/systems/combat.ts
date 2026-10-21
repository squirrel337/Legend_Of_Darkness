// 전투: 평타, 기술/마법, 피해/회복, 상태 효과, 사망/부활, 경험치와 전리품
import {
  ASSAIL_COOLDOWN_MS,
  DIR_DX,
  DIR_DY,
  SKILL_GCD_MS,
  SPELL_GCD_MS,
  STATUS_IDS,
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
import { gainExp, gainProficiency, proficiencyMultiplier } from './progression';
import { dismissSummons, summonCreatures, summonDied } from './summons';

// 테스트에서 Math.random 을 바꿔 끼울 수 있도록 호출할 때마다 찾습니다
const rand = () => Math.random();
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const isPlayer = (c: Creature): c is Player => c.kind === 'player';
const isMonster = (c: Creature): c is Monster => c.kind === 'monster';
/** 소환수 (주인이 있는 몬스터) */
const isSummon = (c: Creature): c is Monster => isMonster(c) && c.owner !== null;
/** 야생 몬스터 (주인이 없는 몬스터) */
const isWild = (c: Creature): c is Monster => isMonster(c) && c.owner === null;

/** 플레이어 편인지 (플레이어와 소환수). 아니면 몬스터 편(야생 몬스터) */
export function onPlayerSide(c: Creature): boolean {
  return isPlayer(c) || isSummon(c);
}

/** 신속: 평타/기술 재사용 대기에 곱하는 배율 (최소 0.5) */
export function hasteFactor(c: Creature): number {
  const h = c.statuses.get('haste');
  return h ? Math.max(0.5, 1 - h.potency / 100) : 1;
}

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

/** 해로운 상태 (중독, 저주, 수면, 마비, 출혈, 표식 …) */
const DEBUFFS: StatusId[] = STATUS_IDS.filter((id) => STATUS_INFO[id].kind === 'debuff');

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
    if ((s.id === 'poison' || s.id === 'bleed') && !c.isDead) {
      // 중독/출혈로는 죽지 않습니다 (체력 1 남김)
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

/** 전투 중으로 표시합니다 (전투 중에는 자연 회복이 느림). 소환수가 싸우면 주인도 전투 중입니다 */
function markCombat(c: Creature, now: number): void {
  c.lastCombatAt = now;
  if (isMonster(c) && c.owner) c.owner.lastCombatAt = now;
}

/**
 * 플레이어 편에게 공격받은 야생 몬스터가 노릴 대상을 정합니다 (빗나가도).
 * 소환수에게 맞으면 그 소환수로 돌아섭니다 (주인 대신 맞음). 이미 소환수와 싸우는 중이면 그대로 둡니다.
 * 플레이어에게 맞으면 노리던 대상이 없을 때만 그 플레이어를 노립니다.
 */
function provoke(m: Monster, src: Creature, now: number): void {
  const cur = m.target;
  if (cur && !cur.isDead && cur.map === m.map) {
    // 이미 싸우는 중: 소환수가 플레이어에게서 대상을 빼앗을 때만 바꿈
    if (!isSummon(src) || isSummon(cur)) return;
  }
  m.target = src;
  m.chaseSince = now;
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
  // 야수화: 받는 피해 10% 감소
  if (target.statuses.has('beast')) dmg *= 0.9;
  // 표식: 받는 피해 증가
  const mark = target.statuses.get('mark');
  if (mark) dmg *= 1 + mark.potency / 100;
  dmg = Math.max(1, Math.round(dmg));
  const before = target.hp;
  target.hp = Math.max(0, target.hp - dmg);
  markCombat(target, now);
  if (src) markCombat(src, now);
  if (target.statuses.has('sleep')) removeStatus(target, 'sleep');
  if (isMonster(target)) {
    target.lastDamagedAt = now;
    // 소환수가 준 피해는 주인 몫(경험치/전리품)으로 치고, 몬스터는 때린 소환수를 노립니다
    const credit = src && isSummon(src) ? src.owner : src;
    if (src && credit && isPlayer(credit) && isWild(target)) {
      target.addDamage(credit, Math.min(dmg, before));
      provoke(target, src, now);
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
  /** 플레이어 기술의 숙련도 배율 (평타·몬스터는 없음) */
  power?: number;
}

/** 물리 공격 한 번 (플레이어 또는 몬스터) */
export function physicalAttack(world: World, attacker: Creature, target: Creature, o: PhysOpts): number {
  const hitBonus = isPlayer(attacker) ? attacker.derived.hit : 0;
  const evade = target.statuses.get('evade');
  const missed =
    rand() > hitChance(attacker.dex, attacker.level, target.dex, target.level, hitBonus) ||
    // 회피: 그만큼(%) 더 잘 피합니다
    (evade !== undefined && rand() < evade.potency / 100);
  if (missed) {
    const now = Date.now();
    emitDamage(target, 0, 'miss');
    // 빗나가도 싸우는 중입니다
    markCombat(target, now);
    markCombat(attacker, now);
    if (isWild(target) && onPlayerSide(attacker)) provoke(target, attacker, now);
    return 0;
  }
  let base: number;
  let crit = false;
  if (isPlayer(attacker)) {
    const d = attacker.derived;
    base = physicalBase(d, attacker.level, randInt(d.dmgMin, d.dmgMax)) * o.mult + (o.bonus ?? 0);
    base *= o.power ?? 1;
    if (o.hideBonus && o.wasHidden) base *= 1 + o.hideBonus;
    const might = attacker.statuses.get('might');
    if (might) base *= 1 + might.potency / 100;
    const beast = attacker.statuses.get('beast');
    if (beast) base *= 1 + beast.potency / 100;
    if (rand() < critChance(d.dex, o.critBonus ?? 0)) {
      crit = true;
      base *= CRIT_MULT;
    }
  } else {
    const m = attacker as Monster;
    base = randInt(m.stats.dmg[0], m.stats.dmg[1]) * o.mult;
    const might = m.statuses.get('might');
    if (might) base *= 1 + might.potency / 100;
    const beast = m.statuses.get('beast');
    if (beast) base *= 1 + beast.potency / 100;
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

/** 마법 공격 한 번. power 는 플레이어 기술의 숙련도 배율 */
export function magicAttack(
  world: World,
  caster: Creature,
  target: Creature,
  e: Extract<AbilityEffect, { type: 'magic' }>,
  element: Element,
  power = 1,
): number {
  const magicPct = isPlayer(caster) ? caster.derived.magic : 0;
  let base = magicBase(e.base, e.ratio, statValue(caster, e.stat, 'int'), caster.level, magicPct) * power;
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
  // 소환수는 아무에게도 보상을 주지 않고 생성기와도 상관없습니다
  if (m.owner) return summonDied(m);
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
    // 2차 직업은 받은 경험치(배율·그룹 분배 뒤)의 일부를 어빌 경험치로도 받습니다 (gainExp 의 fromKill)
    const sharers = world.groups.expSharers(top, map, x, y);
    if (sharers.length <= 1) gainExp(top, exp, { fromKill: true });
    else {
      const each = (exp * (1 + 0.1 * (sharers.length - 1))) / sharers.length;
      for (const p of sharers) gainExp(p, each, { fromKill: true });
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
  dismissSummons(world, p, '쓰러지자 소환수가 돌아갔습니다.');
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

/**
 * 평타. 근접 무기는 바라보는 앞 칸을 칩니다.
 * 원거리 무기(활, 사거리 > 1)는 targetId 대상(사거리 안의 적)을, 없으면 가장 가까운 적을 쏩니다.
 * 휘두를 때마다 실제 평타 간격을 재사용 대기 메시지(id 'assail')로 알려 줍니다 (신속이면 짧아짐).
 */
export function playerAssail(world: World, p: Player, targetId?: unknown, now = Date.now()): void {
  const map = p.map;
  if (!map || p.isDead || !p.canAct) return;
  if (now < p.nextAssailAt) return;
  const cooldownMs = Math.round(ASSAIL_COOLDOWN_MS * hasteFactor(p));
  p.nextAssailAt = now + cooldownMs;
  // 클라이언트는 이 간격으로 평타 연타 간격을 맞춥니다 (신속의 세기는 클라이언트가 모름)
  p.send({ t: 'cooldown', id: 'assail', ms: cooldownMs });
  const wasHidden = p.hasStatus('hide');
  const range = p.derived.range;
  if (range > 1) {
    // 원거리: 대상을 정하고 그쪽을 바라본 뒤 화살을 날립니다 (대상이 없으면 헛손질)
    let target: Creature | undefined;
    if (!map.safe) {
      const picked = typeof targetId === 'number' ? map.entities.get(targetId) : undefined;
      if (picked && (picked.kind === 'player' || picked.kind === 'monster')) {
        const c = picked as Creature;
        if (hostile(p, c) && chebyshev(p, c) <= range) target = c;
      }
      target ??= nearestHostile(p, range);
    }
    if (target) faceTowards(p, target);
    map.broadcast({ t: 'act', id: p.id, a: 'attack', dir: p.dir });
    if (!target) return;
    breakHide(p);
    const el = p.offenseElement;
    map.broadcast({ t: 'fx', fx: 'arrow', id: target.id, from: p.id, el });
    physicalAttack(world, p, target, { mult: 1, element: el, wasHidden });
    return;
  }
  map.broadcast({ t: 'act', id: p.id, a: 'attack', dir: p.dir });
  if (map.safe) return;
  const target = frontCreature(p);
  // 같은 편(다른 플레이어, 소환수)은 때리지 않습니다
  if (!target || !hostile(p, target)) return;
  breakHide(p);
  physicalAttack(world, p, target, { mult: 1, element: p.offenseElement, wasHidden });
}

// ───────────────────────── 기술/마법 ─────────────────────────

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 시전자 기준 적대 관계인지.
 * 플레이어 편(플레이어 + 소환수)과 몬스터 편(야생 몬스터)이 서로 적입니다. 무적 플레이어는 대상이 아닙니다.
 */
export function hostile(caster: Creature, c: Creature): boolean {
  if (c === caster || c.isDead) return false;
  if (onPlayerSide(caster) === onPlayerSide(c)) return false;
  return !(isPlayer(c) && c.god);
}

/** 같은 편인지 (회복/강화 대상) */
export function friendly(caster: Creature, c: Creature): boolean {
  return onPlayerSide(caster) === onPlayerSide(c);
}

function frontCreature(c: Creature): Creature | undefined {
  return c.map?.creatureAt(c.x + DIR_DX[c.dir]!, c.y + DIR_DY[c.dir]!);
}

/** 대상 쪽으로 돌아섭니다 (주변에 알림) */
function faceTowards(c: Creature, t: { x: number; y: number }): void {
  const d = dirTowards(c.x, c.y, t.x, t.y);
  if (d !== null && d !== c.dir) {
    c.dir = d as Dir;
    c.map?.broadcast({ t: 'turn', id: c.id, dir: c.dir });
  }
}

/** 사거리(체비쇼프 거리) 안에서 가장 가까운 적. 바라보는 방향에 있는 대상을 약간 우선합니다 */
export function nearestHostile(caster: Creature, range: number): Creature | undefined {
  const map = caster.map;
  if (!map) return undefined;
  let best: Creature | undefined;
  let bestScore = Infinity;
  // 플레이어 편의 적은 야생 몬스터뿐, 몬스터 편의 적은 플레이어와 소환수
  const pools: Iterable<Creature>[] = onPlayerSide(caster) ? [map.monsters] : [map.players, map.monsters];
  for (const pool of pools) {
    for (const c of pool) {
      if (!hostile(caster, c)) continue;
      const d = chebyshev(caster, c);
      if (d > range) continue;
      const facing = dirTowards(caster.x, caster.y, c.x, c.y) === caster.dir ? -0.5 : 0;
      const score = d + facing;
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
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
  /** 숙련도 배율 (플레이어만): 피해·회복과 해로운 상태가 걸릴 확률에 곱함 */
  power?: number;
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
    case 'party': {
      // 자신 + 같은 맵, 사거리 안의 살아 있는 그룹원
      const out: Creature[] = [caster];
      if (isPlayer(caster)) {
        const g = caster.world.groups.groupOf(caster.name);
        if (g) {
          for (const name of g.members) {
            const mate: Player | undefined = caster.world.findPlayer(name);
            if (mate && mate !== caster && mate.map === map && !mate.isDead && chebyshev(caster, mate) <= range) out.push(mate);
          }
        }
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
  const power = ctx.power ?? 1;
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
    if (e.type === 'summon') {
      // 소환은 대상과 상관없이 한 번 (플레이어만 소환수를 거느립니다). 소환수의 체력·피해에 숙련도 배율
      if (isPlayer(caster)) summonCreatures(world, caster, e, Date.now(), power);
      continue;
    }
    for (const t of list) {
      if (!t.map || (t.isDead && e.type !== 'revive')) continue;
      const el = elementFor(def, caster, e);
      switch (e.type) {
        case 'physical': {
          // 연타: 한 번마다 명중/치명타를 따로 판정하고, 대상이 쓰러지면 멈춥니다
          const hits = Math.max(1, Math.min(5, e.hits ?? 1));
          let dealt = 0;
          for (let i = 0; i < hits && !t.isDead && t.map; i++) {
            const before = t.hp;
            physicalAttack(world, caster, t, {
              mult: e.mult,
              bonus: e.bonus,
              critBonus: e.critBonus,
              hideBonus: e.hideBonus,
              wasHidden,
              element: el,
              power,
            });
            dealt += Math.max(0, before - t.hp);
          }
          // 흡혈: 실제로 깎은 체력의 일부만큼 시전자 회복 (깎은 체력이 숙련도를 따르므로 따로 곱하지 않음)
          if (e.lifesteal && dealt > 0 && !caster.isDead) healCreature(caster, caster, Math.max(1, Math.round(dealt * e.lifesteal)), false);
          break;
        }
        case 'magic':
          magicAttack(world, caster, t, e, el, power);
          break;
        case 'heal': {
          const magicPct = isPlayer(caster) ? caster.derived.magic : 0;
          let amt = magicBase(e.base, e.ratio, statValue(caster, e.stat, 'wis'), caster.level, magicPct) * power;
          const focus = caster.statuses.get('focus');
          if (focus) amt *= 1 + focus.potency / 100;
          healCreature(caster, t, amt, false);
          break;
        }
        case 'status': {
          // 숙련도: 해로운 상태가 걸릴 확률에 배율 (확률이 없으면 1로 보고 곱한 뒤 1에서 자름)
          const chance = power !== 1 && STATUS_INFO[e.status].kind === 'debuff' ? Math.min(1, (e.chance ?? 1) * power) : e.chance;
          if (chance !== undefined && rand() > chance) {
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
          restoreMana(caster, caster.maxMp * e.pct * power);
          break;
        case 'sacrifice': {
          const cost = Math.floor(caster.hp * e.hpPct);
          if (cost <= 0) break;
          caster.hp = Math.max(1, caster.hp - cost);
          if (isPlayer(caster)) caster.markVitals();
          map.broadcast({ t: 'dmg', id: caster.id, v: cost, k: 'dot', hp: caster.hpPct });
          applyDamage(world, caster, t, cost * e.mult * power * elementMultiplier(el, t.defenseElement), 'crit');
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
  // 소환은 마나/재사용 대기를 쓰기 전에 미리 확인합니다
  if (def.effects.some((e) => e.type === 'summon')) {
    if (map.safe) return p.err('마을에서는 소환할 수 없습니다.');
    if (!map.findFreeNear(p.x, p.y, 4)) return p.err('소환수가 나타날 자리가 없습니다.');
  }
  if (now < p.gcdUntil) return;
  const cd = p.cooldowns.get(def.id) ?? 0;
  if (now < cd) return p.err(`${def.name}: ${((cd - now) / 1000).toFixed(1)}초 후에 다시 사용할 수 있습니다.`);
  if (p.mp < def.mp && !p.god) return p.err('마나가 부족합니다.');
  const ctx: CastContext = { def, caster: p, power: proficiencyMultiplier(p, def.id), ...(typeof targetId === 'number' ? { targetId } : {}) };
  // 대상 쪽을 바라보게
  if (def.targeting === 'enemy' || def.targeting === 'enemyArea' || def.targeting === 'ally') {
    const pre = resolveTargets(ctx);
    if (typeof pre === 'string') return p.err(pre);
    const t = pre[0];
    if (t && t !== p) faceTowards(p, t);
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
  // 신속이면 공용 대기와 재사용 대기가 줄어듭니다
  const haste = hasteFactor(p);
  p.gcdUntil = now + Math.round((def.kind === 'spell' ? SPELL_GCD_MS : SKILL_GCD_MS) * haste);
  if (def.cooldownMs > 0) {
    const ms = Math.round(def.cooldownMs * haste);
    p.cooldowns.set(def.id, now + ms);
    p.send({ t: 'cooldown', id: def.id, ms });
  }
  const wasHidden = p.hasStatus('hide');
  const appliesHide = def.effects.some((e) => e.type === 'status' && e.status === 'hide');
  if (!appliesHide && OFFENSIVE(def)) breakHide(p);
  p.map!.broadcast({ t: 'act', id: p.id, a: def.kind === 'spell' ? 'cast' : 'skill', dir: p.dir });
  runEffects(world, ctx, targets, wasHidden);
  // 실제로 쓴 기술·마법의 숙련도가 확률로 오릅니다 (허수아비를 쳐도 됨)
  gainProficiency(p, def.id);
}

/** 몬스터(소환수 포함)가 기술/마법을 사용합니다. 사용했으면 true */
export function monsterUseAbility(world: World, m: Monster, def: AbilityDef, target: Creature): boolean {
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
