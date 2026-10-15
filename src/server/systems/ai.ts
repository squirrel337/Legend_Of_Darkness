// 몬스터 인공지능: 배회, 선공, 추격, 공격, 마법, 귀환
import { DIR_DX, DIR_DY, dirTowards, type Dir } from '../../shared/constants';
import type { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import { monsterUseAbility, physicalAttack } from './combat';

const DEFAULT_MOVE_MS = 700;
const DEFAULT_ATTACK_MS = 1400;
const LEASH_RANGE = 14;
const CHASE_GIVEUP_MS = 25_000;

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

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

function validTarget(m: Monster, p: Player | null): p is Player {
  return !!p && p.map === m.map && !p.isDead && !p.god && !p.hasStatus('hide');
}

function findTarget(m: Monster): Player | null {
  const range = m.def.aggroRange ?? 4;
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of m.map!.players) {
    if (!validTarget(m, p)) continue;
    const d = manhattan(m, p);
    if (d <= range && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export function monsterTick(world: World, m: Monster, now: number): void {
  const map = m.map;
  if (!map || m.dead) return;
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

  if (t) {
    const dist = manhattan(m, t);
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
          m.nextAttackAt = now + (m.def.attackMs ?? DEFAULT_ATTACK_MS);
          return;
        }
      }
      m.nextSpellAt = now + 1000;
    }
    if (dist === 1) {
      face(m, t);
      if (now >= m.nextAttackAt) {
        m.nextAttackAt = now + (m.def.attackMs ?? DEFAULT_ATTACK_MS);
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
    return;
  }

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
