// 소지품: 장비, 사용, 버리기, 줍기 (접속 중인 플레이어용)
import {
  DIR_DX,
  DIR_DY,
  EQUIP_SLOT_NAMES,
  INVENTORY_SIZE,
  ITEM_COOLDOWN_MS,
  isEquipSlot,
} from '../../shared/constants';
import { TokenBucket } from '../auth';
import type { Player } from '../world/Player';
import { addItem, canFit, equipError, takeFromSlot } from './character';
import { applyStatus, cleanseDebuffs, healCreature, restoreMana } from './combat';
import { dropToGround } from './ground';
import { gainExp } from './progression';

const isSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < INVENTORY_SIZE;

/** 바닥에 버리기 속도 제한 (맵을 아이템으로 도배하지 못하게) */
const dropBuckets = new WeakMap<Player, TokenBucket>();
function canDrop(p: Player): boolean {
  let b = dropBuckets.get(p);
  if (!b) {
    b = new TokenBucket(8, 2);
    dropBuckets.set(p, b);
  }
  if (b.take()) return true;
  p.err('물건을 너무 빠르게 버리고 있습니다.');
  return false;
}

/** 아이템을 주고, 소지품이 꽉 차면 발밑에 떨어뜨립니다 */
export function giveItem(p: Player, itemId: string, qty: number): boolean {
  const def = p.world.data.items.get(itemId);
  if (!def) return false;
  const left = addItem(p.data, def, qty);
  p.markInv();
  if (left > 0 && p.map) {
    dropToGround(p.world, p.map, p.x, p.y, itemId, left, p.name);
    p.err(`소지품이 가득 차서 ${def.name} ${left}개를 바닥에 떨어뜨렸습니다.`);
  }
  return true;
}

export function equipFromSlot(p: Player, slot: unknown): void {
  if (!isSlot(slot)) return;
  if (p.isDead) return p.err('유령 상태에서는 장비를 바꿀 수 없습니다.');
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = p.world.data.items.get(s.item);
  if (!def) return;
  const err = equipError(p.data, def, p.isGm);
  if (err) return p.err(err);
  const eqSlot = def.slot!;
  const prev = p.data.equipment[eqSlot];
  p.data.equipment[eqSlot] = def.id;
  p.data.inventory[slot] = prev ? { item: prev, qty: 1 } : null;
  p.recompute();
  p.markInv();
  if (eqSlot === 'weapon' || eqSlot === 'armor' || eqSlot === 'helmet' || eqSlot === 'shield') p.broadcastLook();
}

export function unequip(p: Player, eq: unknown): void {
  if (!isEquipSlot(eq)) return;
  if (p.isDead) return p.err('유령 상태에서는 장비를 바꿀 수 없습니다.');
  const id = p.data.equipment[eq];
  if (!id) return;
  const def = p.world.data.items.get(id);
  if (def && !canFit(p.data, def, 1)) return p.err('소지품이 가득 찼습니다.');
  p.data.equipment[eq] = null;
  if (def) addItem(p.data, def, 1);
  p.recompute();
  p.markInv();
  if (eq === 'weapon' || eq === 'armor' || eq === 'helmet' || eq === 'shield') p.broadcastLook();
  p.sys(`${EQUIP_SLOT_NAMES[eq]}을(를) 벗었습니다.`);
}

export function useItem(p: Player, slot: unknown, now = Date.now()): void {
  if (!isSlot(slot)) return;
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = p.world.data.items.get(s.item);
  if (!def) return;
  if (def.type === 'equip') return equipFromSlot(p, slot);
  if (def.type !== 'consumable' || !def.use) return p.err('사용할 수 없는 아이템입니다.');
  if (now < p.nextItemAt) return;
  const use = def.use;
  if (p.isDead && !use.recall) return p.err('유령 상태에서는 사용할 수 없습니다.');
  if (!p.isDead && !p.canAct) return p.err('지금은 아이템을 사용할 수 없습니다.');
  if (def.level && p.data.level < def.level && !p.isGm) return p.err(`${def.level}레벨 이상만 사용할 수 있습니다.`);
  p.nextItemAt = now + ITEM_COOLDOWN_MS;
  takeFromSlot(p.data, slot, 1);
  p.markInv();
  if (use.hp) healCreature(p, p, use.hp, false);
  if (use.hpPct) healCreature(p, p, Math.round(p.maxHp * use.hpPct), false);
  if (use.mp) restoreMana(p, use.mp);
  if (use.mpPct) restoreMana(p, Math.round(p.maxMp * use.mpPct));
  if (use.cure) cleanseDebuffs(p);
  if (use.status) applyStatus(p, use.status, use.statusMs ?? 60000, undefined, p);
  if (use.exp) gainExp(p, use.exp);
  if (use.recall) {
    const town = p.world.maps.get('town')!;
    p.world.transfer(p, town, town.def.spawn.x, town.def.spawn.y);
    p.sys('마을로 돌아왔습니다.');
  }
}

export function dropItem(p: Player, slot: unknown, qty: unknown): void {
  if (!isSlot(slot) || !p.map) return;
  if (p.isDead || !p.data.inventory[slot] || !canDrop(p)) return;
  const n = typeof qty === 'number' && Number.isInteger(qty) && qty > 0 ? qty : 1;
  const taken = takeFromSlot(p.data, slot, n);
  if (!taken) return;
  p.markInv();
  dropToGround(p.world, p.map, p.x, p.y, taken.item, taken.qty, null);
}

export function dropGold(p: Player, amount: unknown): void {
  if (!p.map || p.isDead) return;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return;
  if (amount > p.data.gold) return p.err('골드가 부족합니다.');
  if (!canDrop(p)) return;
  p.data.gold -= amount;
  p.markInv();
  p.markSelf();
  dropToGround(p.world, p.map, p.x, p.y, null, amount, null);
}

export function moveItem(p: Player, from: unknown, to: unknown): void {
  if (!isSlot(from) || !isSlot(to) || from === to) return;
  const inv = p.data.inventory;
  const a = inv[from] ?? null;
  const b = inv[to] ?? null;
  // 같은 아이템이면 합치기
  if (a && b && a.item === b.item) {
    const def = p.world.data.items.get(a.item);
    const max = def ? (def.type === 'equip' ? 1 : (def.stack ?? 1)) : 1;
    if (max > 1 && b.qty < max) {
      const n = Math.min(a.qty, max - b.qty);
      b.qty += n;
      a.qty -= n;
      if (a.qty <= 0) inv[from] = null;
      p.markInv();
      return;
    }
  }
  inv[from] = b;
  inv[to] = a;
  p.markInv();
}

/** 발밑(없으면 앞 칸)의 아이템을 줍습니다 */
export function pickup(p: Player, now = Date.now()): void {
  const map = p.map;
  if (!map || p.isDead) return;
  let items = map.itemsAt(p.x, p.y);
  if (items.length === 0) items = map.itemsAt(p.x + DIR_DX[p.dir]!, p.y + DIR_DY[p.dir]!);
  if (items.length === 0) return p.err('주울 수 있는 아이템이 없습니다.');
  let picked = 0;
  for (const it of items) {
    if (it.owner && it.owner !== p.name && now < it.ownerUntil && !p.isGm && !p.world.groups.sameGroup(p.name, it.owner)) {
      p.err(`${it.name}: 다른 사람의 전리품입니다. 잠시 후에 주울 수 있습니다.`);
      continue;
    }
    if (it.itemId === null) {
      p.data.gold += it.qty;
      p.send({ t: 'gain', exp: 0, gold: it.qty });
      p.markInv();
      p.markSelf();
    } else {
      const def = p.world.data.items.get(it.itemId);
      if (!def) {
        map.remove(it);
        continue;
      }
      const left = addItem(p.data, def, it.qty);
      p.markInv();
      if (left === it.qty) {
        p.err('소지품이 가득 찼습니다.');
        break;
      }
      if (left > 0) {
        // 일부만 주웠으면 남은 수량으로 다시 놓습니다
        map.remove(it);
        dropToGround(p.world, map, it.x, it.y, it.itemId, left, it.owner);
        picked++;
        continue;
      }
      p.sys(`${def.name}${it.qty > 1 ? ` ${it.qty}개` : ''}을(를) 주웠습니다.`);
    }
    map.remove(it, 'pickup');
    picked++;
  }
  if (picked > 0) p.markSelf();
}
