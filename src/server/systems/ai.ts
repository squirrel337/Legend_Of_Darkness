// 몬스터 인공지능: 배회, 선공, 추격, 공격, 마법, 귀환. 소환수는 주인을 따라다니며 주인 편에서 싸웁니다.
import { DIR_DX, DIR_DY, dirTowards, type Dir } from '../../shared/constants';
import type { Creature } from '../world/entities';
import type { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import { hasteFactor, monsterUseAbility, physicalAttack } from './combat';
import { bringToOwner } from './summons';

const DEFAULT_MOVE_MS = 700;
const DEFAULT_ATTACK_MS = 1400;
const LEASH_RANGE = 14;
const CHASE_GIVEUP_MS = 25_000;

// 소환수
/** 주인 주변 이 거리 안의 적은 먼저 공격합니다 */
const ALLY_ASSIST_RANGE = 6;
/** 주인에게서 이보다 멀리 있는 적은 쫓지 않습니다 */
const ALLY_LEASH = 10;
/** 주인과 이보다 멀어지면 따라갑니다 */
const ALLY_FOLLOW = 2;
/** 주인과 이보다 멀어지면(또는 다른 맵이면) 주인 곁으로 순간이동합니다 */
const ALLY_TELEPORT = 15;
/** 따라갈 때 걸음 간격 상한 (플레이어 걸음 230ms 를 대략 따라잡도록) */
const ALLY_FOLLOW_MS = 250;

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function stepMonster(m: Monster, x: number, y: number): void {
  const map = m.map!;
  const d = dirTowards(m.x, m.y, x, y);
  if (d !== null) m.dir = d as Dir;
  map.move(m, x, y);
  map.broadcast({ t: 'walk', id: m.id, x, y, dir: m.dir });
}

function face(m: Monster, t: { x: number; y: number }): void {
  const d = dirTowards(m.x, m.y, t.x, t.y);
  if (d !== null && d !== m.dir) {
    m.dir = d as Dir;
    m.map!.broadcast({ t: 'turn', id: m.id, dir: m.dir });
  }
}

/** 공격 간격 (신속이면 짧아짐) */
function attackMs(m: Monster): number {
  return Math.round((m.def.attackMs ?? DEFAULT_ATTACK_MS) * hasteFactor(m));
}

/** 야생 몬스터가 노릴 수 있는 대상: 무적/은신이 아닌 살아 있는 플레이어, 또는 소환수 */
function validTarget(m: Monster, c: Creature | null): c is Creature {
  if (!c || c.map !== m.map || c.isDead) return false;
  if (c.kind === 'player') {
    const p = c as Player;
    return !p.god && !p.hasStatus('hide');
  }
  return c.kind === 'monster' && (c as Monster).owner !== null;
}

/** 선공 범위 안에서 가장 가까운 플레이어나 소환수 */
function findTarget(m: Monster): Creature | null {
  const range = m.def.aggroRange ?? 4;
  const map = m.map!;
  let best: Creature | null = null;
  let bestD = Infinity;
  const consider = (c: Creature): void => {
    if (!validTarget(m, c)) return;
    const d = manhattan(m, c);
    if (d <= range && d < bestD) {
      best = c;
      bestD = d;
    }
  };
  for (const p of map.players) {
    consider(p);
    for (const s of p.summons) consider(s);
  }
  return best;
}

/** 대상과 싸웁니다: 마법 → 붙어 있으면 평타 → 아니면 다가감 (야생 몬스터와 소환수 공통) */
function fight(world: World, m: Monster, t: Creature, now: number): void {
  const map = m.map!;
  // 마법
  if (m.def.spells && now >= m.nextSpellAt && now >= m.nextAttackAt - 400) {
    for (const s of m.def.spells) {
      if (Math.random() >= s.chance) continue;
      const def = world.data.abilities.get(s.id);
      if (!def) continue;
      if ((m.spellCooldowns.get(def.id) ?? 0) > now) continue;
      face(m, t);
      if (monsterUseAbility(world, m, def, t)) {
        m.spellCooldowns.set(def.id, now + def.cooldownMs);
        m.nextSpellAt = now + 1500;
        m.nextAttackAt = now + attackMs(m);
        return;
      }
    }
    m.nextSpellAt = now + 1000;
  }
  if (manhattan(m, t) === 1) {
    face(m, t);
    if (now >= m.nextAttackAt) {
      m.nextAttackAt = now + attackMs(m);
      map.broadcast({ t: 'act', id: m.id, a: 'attack', dir: m.dir });
      physicalAttack(world, m, t, { mult: 1, element: m.offenseElement });
    }
    return;
  }
  if (now >= m.nextMoveAt) {
    m.nextMoveAt = now + (m.def.moveMs ?? DEFAULT_MOVE_MS);
    const step = map.nextStepTowards(m.x, m.y, t.x, t.y, 18);
    if (step) stepMonster(m, step.x, step.y);
  }
}

export function monsterTick(world: World, m: Monster, now: number): void {
  const map = m.map;
  if (!map || m.dead) return;
  if (m.owner) return allyTick(world, m, m.owner, now);
  if (m.def.passive) return;
  if (!m.canAct) return;

  let t = m.target;
  if (t && (!validTarget(m, t) || manhattan(m, t) > LEASH_RANGE || (now - m.chaseSince > CHASE_GIVEUP_MS && manhattan(m, t) > 1 && now - m.lastDamagedAt > 8000))) {
    m.target = null;
    t = null;
  }
  if (!t && m.def.aggressive) {
    t = findTarget(m);
    if (t) {
      m.target = t;
      m.chaseSince = now;
    }
  }

  if (t) return fight(world, m, t, now);

  // 대상이 없으면 집 근처를 배회하고, 체력을 회복합니다
  if (now >= m.nextMoveAt) {
    const moveMs = m.def.moveMs ?? DEFAULT_MOVE_MS;
    m.nextMoveAt = now + moveMs * (2 + Math.random() * 4);
    if (manhattan(m, { x: m.homeX, y: m.homeY }) > 7) {
      const step = map.nextStepTowards(m.x, m.y, m.homeX, m.homeY, 24);
      if (step) stepMonster(m, step.x, step.y);
      m.nextMoveAt = now + moveMs;
    } else if (Math.random() < 0.6) {
      const d = Math.floor(Math.random() * 4) as Dir;
      const nx = m.x + DIR_DX[d]!;
      const ny = m.y + DIR_DY[d]!;
      if (map.isFree(nx, ny) && !map.isWarpTile(nx, ny) && manhattan({ x: nx, y: ny }, { x: m.homeX, y: m.homeY }) <= 7) stepMonster(m, nx, ny);
    }
  }
}

// ───────────────────────── 소환수 ─────────────────────────

/** 주인의 소환수인지 */
const summonOf = (c: Creature | null, owner: Player): boolean => !!c && c.kind === 'monster' && (c as Monster).owner === owner;

/**
 * 소환수가 싸울 상대 (야생 몬스터).
 * 주인을 공격하는 적 → 소환수(자신이나 동료)를 공격하는 적 → 지금 싸우던 적 → 주인 주변의 적 순서.
 * 수련용 허수아비(passive)는 건드리지 않습니다.
 */
function allyTarget(m: Monster, owner: Player): Monster | null {
  const map = m.map!;
  let best: Monster | null = null;
  let bestScore = Infinity;
  for (const w of map.monsters) {
    if (w.owner || w.dead || w.def.passive) continue;
    const fromOwner = chebyshev(w, owner);
    if (fromOwner > ALLY_LEASH) continue;
    let rank: number;
    if (w.target === owner) rank = 0;
    else if (w.target === m || summonOf(w.target, owner)) rank = 1;
    else if (w === m.target) rank = 2;
    else if (fromOwner <= ALLY_ASSIST_RANGE) rank = 3;
    else continue;
    // 같은 순위면 가까운 적, 지금 싸우던 적을 조금 우선
    const score = rank * 1000 + manhattan(m, w) - (w === m.target ? 0.5 : 0);
    if (score < bestScore) {
      best = w;
      bestScore = score;
    }
  }
  return best;
}

/** 소환수 행동: 주인을 지키며 싸우고, 할 일이 없으면 주인을 따라다닙니다 (집으로 돌아가지 않음) */
function allyTick(world: World, m: Monster, owner: Player, now: number): void {
  const map = m.map!;
  if (owner.map !== map || chebyshev(m, owner) > ALLY_TELEPORT) {
    // 너무 멀거나 다른 맵: 주인 곁으로 순간이동 (마을이나 유령이면 summonTick 이 돌려보냄)
    if (owner.map && !owner.map.safe && !owner.isDead) bringToOwner(m, owner);
    return;
  }
  if (!m.canAct) return;
  const t = allyTarget(m, owner);
  m.target = t;
  if (t) return fight(world, m, t, now);
  if (chebyshev(m, owner) > ALLY_FOLLOW && now >= m.nextMoveAt) {
    m.nextMoveAt = now + Math.min(m.def.moveMs ?? DEFAULT_MOVE_MS, ALLY_FOLLOW_MS);
    const step = map.nextStepTowards(m.x, m.y, owner.x, owner.y, 24);
    if (step) stepMonster(m, step.x, step.y);
  }
}

/** 1초마다: 싸우지 않는 몬스터는 체력이 회복됩니다 */
export function monsterRegen(m: Monster, now: number): void {
  if (m.dead || m.hp >= m.maxHp) return;
  const idle = now - m.lastDamagedAt;
  if (m.def.passive) {
    if (idle > 6000) {
      m.hp = m.maxHp;
      m.damageBy.clear();
      m.map?.broadcast({ t: 'dmg', id: m.id, v: 0, k: 'heal', hp: 100 });
    }
    return;
  }
  if (m.target || idle < 8000) return;
  m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.05));
  if (m.hp >= m.maxHp) m.damageBy.clear();
  m.map?.broadcast({ t: 'dmg', id: m.id, v: 0, k: 'heal', hp: m.hpPct });
}
