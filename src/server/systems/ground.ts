// 바닥에 아이템/골드를 떨어뜨립니다
import { GROUND_ITEM_TTL_MS, LOOT_OWNER_MS, formatNumber } from '../../shared/constants';
import { GroundItem } from '../world/GroundItem';
import type { MapInstance } from '../world/MapInstance';
import type { World } from '../world/World';

/** 맵 하나에 놓일 수 있는 바닥 아이템 수 */
export const MAX_GROUND_ITEMS = 400;
/** 한 플레이어가 직접 버려서 바닥(모든 맵 합계)에 남겨 둘 수 있는 물건 수 */
export const MAX_PLAYER_DROPS = 30;

function oldestWhere(map: MapInstance, pred: (it: GroundItem) => boolean): GroundItem | null {
  let found: GroundItem | null = null;
  for (const it of map.items) if (pred(it) && (!found || it.expiresAt < found.expiresAt)) found = it;
  return found;
}

/** 맵이 가득 찼을 때 치울 아이템. 직접 버린 사람은 자기 물건만, 그 밖에는 버려진 물건 → 오래된 전리품 순 */
function evictionVictim(map: MapInstance, droppedBy: string | null): GroundItem | null {
  if (droppedBy) return oldestWhere(map, (it) => it.droppedBy === droppedBy);
  return oldestWhere(map, (it) => it.droppedBy !== null) ?? oldestWhere(map, () => true);
}

/** 플레이어(dropper = nameKey)가 이 맵에 물건을 버릴 수 있는지. 안 되면 이유를 반환합니다 */
export function dropBlockedReason(world: World, map: MapInstance, dropper: string): string | null {
  let mine = 0;
  for (const m of world.maps.values()) for (const it of m.items) if (it.droppedBy === dropper) mine++;
  if (mine >= MAX_PLAYER_DROPS) return `바닥에 버려 둔 물건이 너무 많습니다(최대 ${MAX_PLAYER_DROPS}개). 주워 가거나 사라질 때까지 기다려 주세요.`;
  if (map.items.size >= MAX_GROUND_ITEMS && !evictionVictim(map, dropper)) return '이곳에는 물건이 너무 많아서 더 버릴 수 없습니다.';
  return null;
}

/**
 * 바닥에 아이템(itemId=null 이면 골드)을 놓습니다.
 * owner 는 잠시 동안 혼자 주울 수 있는 사람, droppedBy 는 직접 버린 사람(nameKey)입니다.
 * 맵이 가득 차면 다른 사람의 전리품을 밀어내지 않도록 evictionVictim 순서로 치웁니다.
 */
export function dropToGround(
  world: World,
  map: MapInstance,
  x: number,
  y: number,
  itemId: string | null,
  qty: number,
  owner: string | null,
  droppedBy: string | null = null,
): GroundItem | null {
  if (qty <= 0) return null;
  while (map.items.size >= MAX_GROUND_ITEMS) {
    const victim = evictionVictim(map, droppedBy);
    if (!victim) return null;
    map.remove(victim);
  }
  const now = Date.now();
  const name = itemId ? (world.data.items.get(itemId)?.name ?? itemId) : `${formatNumber(qty)} 골드`;
  const it = new GroundItem(world.allocId(), itemId, qty, name, owner, now + LOOT_OWNER_MS, now + GROUND_ITEM_TTL_MS, droppedBy);
  it.x = x;
  it.y = y;
  map.add(it);
  return it;
}
