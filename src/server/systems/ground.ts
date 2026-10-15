// 바닥에 아이템/골드를 떨어뜨립니다
import { GROUND_ITEM_TTL_MS, LOOT_OWNER_MS, formatNumber } from '../../shared/constants';
import { GroundItem } from '../world/GroundItem';
import type { MapInstance } from '../world/MapInstance';
import type { World } from '../world/World';

export function dropToGround(
  world: World,
  map: MapInstance,
  x: number,
  y: number,
  itemId: string | null,
  qty: number,
  owner: string | null,
): GroundItem | null {
  if (qty <= 0) return null;
  const now = Date.now();
  const name = itemId ? (world.data.items.get(itemId)?.name ?? itemId) : `${formatNumber(qty)} 골드`;
  const it = new GroundItem(world.allocId(), itemId, qty, name, owner, now + LOOT_OWNER_MS, now + GROUND_ITEM_TTL_MS);
  it.x = x;
  it.y = y;
  map.add(it);
  return it;
}
