// 소환수 관리: 불러내기, 주인을 따라 맵 이동, 시간이 다 되면 사라지기, 주인이 떠나면 함께 사라지기
// 소환수는 주인(플레이어) 편에서 싸우는 몬스터입니다 (Monster.owner). 싸우는 방식은 systems/ai.ts 의 allyTick.
import { DIR_DX, DIR_DY } from '../../shared/constants';
import type { AbilityEffect } from '../../shared/types';
import type { MapInstance } from '../world/MapInstance';
import { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

type SummonEffect = Extract<AbilityEffect, { type: 'summon' }>;

/** 주인 곁에 소환수를 놓을 때 찾는 거리 */
const PLACE_RANGE = 6;

/** 소환수를 맵에서 없앱니다 (보상 없음). 쓰러진 것으로 표시해 노리던 몬스터들이 놓칩니다 */
function removeSummon(m: Monster, fx: 'death' | 'warp'): void {
  m.owner?.summons.delete(m);
  m.dead = true;
  m.target = null;
  m.statuses.clear();
  m.map?.remove(m, fx);
}

/** 소환 효과: 시전자 곁에 소환수를 부릅니다. 부른 수를 돌려줍니다 */
export function summonCreatures(world: World, p: Player, e: SummonEffect, now = Date.now()): number {
  const map = p.map;
  const def = world.data.monsters.get(e.monster);
  if (!map || !def || p.isDead) return 0;
  if (map.safe) {
    p.err('마을에서는 소환할 수 없습니다.');
    return 0;
  }
  const count = Math.max(1, Math.min(e.max, e.count ?? 1));
  // 같은 종류는 max 마리까지: 넘치면 오래된 것부터 돌려보냅니다 (Set 은 넣은 순서)
  const same = [...p.summons].filter((s) => s.def.id === def.id);
  const excess = same.length + count - e.max;
  for (let i = 0; i < excess && i < same.length; i++) removeSummon(same[i]!, 'warp');
  let made = 0;
  for (let i = 0; i < count; i++) {
    // 되도록 바라보는 앞 칸에
    const fx = p.x + DIR_DX[p.dir]!;
    const fy = p.y + DIR_DY[p.dir]!;
    const spot = map.isFree(fx, fy) && !map.isWarpTile(fx, fy) ? { x: fx, y: fy } : map.findFreeNear(p.x, p.y, PLACE_RANGE);
    if (!spot) break;
    // 소환자의 레벨에 맞춰 강해집니다
    const m = new Monster(world.allocId(), def, p.level);
    m.owner = p;
    m.expireAt = now + e.durationMs;
    m.x = spot.x;
    m.y = spot.y;
    m.homeX = spot.x;
    m.homeY = spot.y;
    m.dir = p.dir;
    m.nextMoveAt = now + 300;
    m.nextAttackAt = now + 300;
    p.summons.add(m);
    map.add(m);
    map.broadcast({ t: 'fx', fx: 'summon', id: m.id, from: p.id });
    made++;
  }
  if (made === 0) p.err('소환수가 나타날 자리가 없습니다.');
  return made;
}

/** 소환수가 싸우다 쓰러졌을 때 (combat.killMonster 에서 맵에서 치운 뒤 호출) */
export function summonDied(m: Monster): void {
  const owner = m.owner;
  if (!owner) return;
  owner.summons.delete(m);
  m.target = null;
  owner.sys(`소환수 ${m.name}이(가) 쓰러졌습니다.`);
}

/** 소환수를 주인 곁으로 옮깁니다 (다른 맵이면 맵째 옮김). 자리가 없으면 돌려보내고 false */
export function bringToOwner(m: Monster, p: Player): boolean {
  const map = p.map;
  const spot = map ? map.findFreeNear(p.x, p.y, PLACE_RANGE) : null;
  if (!map || !spot) {
    removeSummon(m, 'warp');
    return false;
  }
  m.target = null;
  if (m.map === map) {
    map.move(m, spot.x, spot.y);
    map.broadcast({ t: 'jump', id: m.id, x: spot.x, y: spot.y, dir: m.dir });
  } else {
    m.map?.remove(m, 'warp');
    m.x = spot.x;
    m.y = spot.y;
    map.add(m);
  }
  m.homeX = spot.x;
  m.homeY = spot.y;
  return true;
}

/** 소환수가 따라갈 수 있는 주인인지 (접속 중, 살아 있음, 마을이 아닌 맵) */
function followable(world: World, p: Player): boolean {
  return world.findPlayer(p.name) === p && !p.isDead && !!p.map && !p.map.safe;
}

/** 100ms 틱마다 맵마다 호출: 만료되거나 주인을 잃은 소환수 정리 */
export function summonTick(world: World, map: MapInstance, now: number): void {
  let list: Monster[] | null = null;
  for (const m of map.monsters) if (m.owner) (list ??= []).push(m);
  if (!list) return;
  for (const m of list) {
    const owner = m.owner!;
    // 주인이 접속을 끊었거나 다른 데서 이미 놓아 버린 소환수
    if (world.findPlayer(owner.name) !== owner || !owner.summons.has(m)) {
      removeSummon(m, 'warp');
      continue;
    }
    if (m.expireAt > 0 && now >= m.expireAt) {
      removeSummon(m, 'death');
      owner.sys(`소환 시간이 다 되어 소환수가 돌아갔습니다. (${m.name})`);
      continue;
    }
    if (owner.map !== map) {
      // 주인이 다른 맵에 있으면 따라가고, 따라갈 수 없으면 돌려보냅니다
      if (followable(world, owner)) bringToOwner(m, owner);
      else removeSummon(m, 'warp');
      continue;
    }
    if (owner.isDead) removeSummon(m, 'warp');
  }
}

/** 주인의 소환수를 모두 없앱니다 (접속 종료, 사망 등). reason 이 있으면 주인에게 알림 */
export function dismissSummons(world: World, p: Player, reason?: string): void {
  void world;
  if (p.summons.size === 0) return;
  for (const m of [...p.summons]) removeSummon(m, 'warp');
  p.summons.clear();
  if (reason) p.sys(reason);
}

/** 주인이 다른 맵(또는 먼 곳)으로 옮겨진 뒤 호출: 소환수를 데려가거나 돌려보냄 */
export function onOwnerMoved(world: World, p: Player): void {
  if (p.summons.size === 0) return;
  const map = p.map;
  if (!map || p.isDead) return dismissSummons(world, p);
  if (map.safe) return dismissSummons(world, p, '마을에는 소환수를 데려갈 수 없어 돌려보냈습니다.');
  for (const m of [...p.summons]) if (m.map !== map) bringToOwner(m, p);
}
