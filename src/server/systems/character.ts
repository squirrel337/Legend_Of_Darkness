// 캐릭터 데이터(CharacterData)를 직접 다루는 순수 함수들.
// 접속 중이든 아니든 똑같이 쓸 수 있어서, 게임 진행과 관리자 기능이 함께 사용합니다.
import {
  EQUIP_SLOTS,
  INVENTORY_SIZE,
  MAX_ABILITIES,
  STAT_KEYS,
  type ClassId,
  type EquipSlot,
  type StatKey,
} from '../../shared/constants';
import { autoAllocate, expToNext, START_STAT } from '../../shared/formulas';
import { classTier } from '../../shared/progression';
import type { AbilityDef, ItemDef } from '../../shared/types';
import type { InvSlot } from '../../shared/protocol';
import type { ServerConfig } from '../config';
import type { GameData } from '../gamedata';
import { STORAGE_SLOTS, type CharacterData } from '../storage';

export function stackSize(def: ItemDef): number {
  return def.type === 'equip' ? 1 : Math.max(1, def.stack ?? 1);
}

/** 아이템을 소지품에 넣습니다. 들어가지 못한 개수를 반환합니다. */
export function addItem(data: CharacterData, def: ItemDef, qty: number): number {
  let left = Math.max(0, Math.floor(qty));
  const max = stackSize(def);
  if (max > 1) {
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      const s = data.inventory[i];
      if (s && s.item === def.id && s.qty < max) {
        const n = Math.min(left, max - s.qty);
        s.qty += n;
        left -= n;
      }
    }
  }
  for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
    if (!data.inventory[i]) {
      const n = Math.min(left, max);
      data.inventory[i] = { item: def.id, qty: n };
      left -= n;
    }
  }
  return left;
}

/** 이 아이템을 qty개 넣을 공간이 있는지 */
export function canFit(data: CharacterData, def: ItemDef, qty: number): boolean {
  const max = stackSize(def);
  let room = 0;
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const s = data.inventory[i];
    if (!s) room += max;
    else if (s.item === def.id && max > 1) room += max - s.qty;
    if (room >= qty) return true;
  }
  return room >= qty;
}

export function countItem(data: CharacterData, itemId: string): number {
  let n = 0;
  for (const s of data.inventory) if (s && s.item === itemId) n += s.qty;
  return n;
}

export function freeSlots(data: CharacterData): number {
  let n = 0;
  for (let i = 0; i < INVENTORY_SIZE; i++) if (!data.inventory[i]) n++;
  return n;
}

/** 슬롯에서 qty개를 꺼냅니다. 꺼낸 내용을 반환합니다. */
export function takeFromSlot(data: CharacterData, slot: number, qty: number): InvSlot | null {
  const s = data.inventory[slot];
  if (!s) return null;
  const n = Math.min(s.qty, Math.max(1, Math.floor(qty)));
  s.qty -= n;
  if (s.qty <= 0) data.inventory[slot] = null;
  return { item: s.item, qty: n };
}

export function removeItemQty(data: CharacterData, itemId: string, qty: number): boolean {
  if (countItem(data, itemId) < qty) return false;
  let left = qty;
  for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
    const s = data.inventory[i];
    if (s && s.item === itemId) {
      const n = Math.min(left, s.qty);
      s.qty -= n;
      left -= n;
      if (s.qty <= 0) data.inventory[i] = null;
    }
  }
  return true;
}

/** 창고에 아이템을 넣습니다. 들어가지 못한 개수를 반환합니다. force 면 칸 수 제한을 넘겨서라도 넣습니다. */
export function addToStorage(data: CharacterData, def: ItemDef, qty: number, force = false): number {
  let left = qty;
  const max = stackSize(def);
  if (max > 1) {
    for (const s of data.storage) {
      if (left <= 0) break;
      if (s.item === def.id && s.qty < max) {
        const n = Math.min(left, max - s.qty);
        s.qty += n;
        left -= n;
      }
    }
  }
  while (left > 0 && (force || data.storage.length < STORAGE_SLOTS)) {
    const n = Math.min(left, max);
    data.storage.push({ item: def.id, qty: n });
    left -= n;
  }
  return left;
}

/** 장비 가능 여부. 가능하면 null, 아니면 이유 */
export function equipError(data: CharacterData, def: ItemDef, bypass = false): string | null {
  if (def.type !== 'equip' || !def.slot) return '장비할 수 없는 아이템입니다.';
  if (bypass) return null;
  if (def.level && data.level < def.level) return `${def.level}레벨 이상만 장비할 수 있습니다.`;
  if (def.classes && def.classes.length > 0 && !def.classes.includes(data.classId)) return '현재 직업으로는 장비할 수 없습니다.';
  return null;
}

/**
 * 경험치를 더하고 레벨업을 처리합니다. 오른 레벨 수를 반환합니다.
 * 만렙에 도달한 뒤에도 경험치는 승급용으로 계속 쌓입니다.
 */
export function addExpToData(data: CharacterData, cfg: ServerConfig, amount: number): number {
  if (!(amount > 0)) return 0;
  data.exp += amount;
  let gained = 0;
  while (data.level < cfg.maxLevel) {
    const need = expToNext(data.level);
    if (data.exp < need) break;
    data.exp -= need;
    data.level++;
    data.statPoints += cfg.statPointsPerLevel;
    gained++;
  }
  return gained;
}

/** 레벨을 직접 정합니다. 오른 만큼 능력치 포인트를 줍니다. */
export function setLevelOnData(data: CharacterData, cfg: ServerConfig, level: number): number {
  const target = Math.max(1, Math.min(cfg.maxLevel, Math.floor(level)));
  const diff = target - data.level;
  if (diff > 0) data.statPoints += diff * cfg.statPointsPerLevel;
  else if (diff < 0) data.statPoints = Math.max(0, data.statPoints + diff * cfg.statPointsPerLevel);
  data.level = target;
  data.exp = 0;
  return diff;
}

export function allocatedPoints(data: CharacterData): number {
  return STAT_KEYS.reduce((s, k) => s + Math.max(0, data.stats[k] - START_STAT), 0);
}

export function resetStatsOnData(data: CharacterData): number {
  const refund = allocatedPoints(data);
  for (const k of STAT_KEYS) data.stats[k] = START_STAT;
  data.statPoints += refund;
  return refund;
}

/** 남은 포인트를 직업 비율대로 자동 분배합니다. 분배한 포인트 수를 반환합니다. */
export function autoAllocateOnData(data: CharacterData, gd: GameData, cfg: ServerConfig): number {
  const cls = gd.classes.get(data.classId)!;
  let points = data.statPoints;
  let spent = 0;
  for (let round = 0; round < 6 && points > 0; round++) {
    const weights: Partial<Record<StatKey, number>> = {};
    for (const k of STAT_KEYS) if ((cls.statWeights[k] ?? 0) > 0 && data.stats[k] < cfg.statCap) weights[k] = cls.statWeights[k];
    if (Object.keys(weights).length === 0) for (const k of STAT_KEYS) if (data.stats[k] < cfg.statCap) weights[k] = 1;
    if (Object.keys(weights).length === 0) break;
    const add = autoAllocate(weights, points);
    for (const k of STAT_KEYS) {
      const room = cfg.statCap - data.stats[k];
      const n = Math.min(room, add[k]);
      data.stats[k] += n;
      points -= n;
      spent += n;
    }
  }
  data.statPoints = points;
  return spent;
}

export function abilityAllowedFor(def: AbilityDef, classId: ClassId): boolean {
  return def.classId === 'peasant' || def.classId === classId;
}

/** 기술·마법을 배운 것으로 적습니다. 숙련도는 prof (원작처럼 배우면 0 부터) */
export function learnOnData(data: CharacterData, def: AbilityDef, prof = 0): boolean {
  const list = def.kind === 'skill' ? data.skills : data.spells;
  if (list.includes(def.id) || list.length >= MAX_ABILITIES) return false;
  list.push(def.id);
  data.prof[def.id] = prof;
  return true;
}

/** 배우지 않은 기술의 숙련도 항목을 지웁니다 (기술을 잊게 한 뒤에) */
export function pruneProf(data: CharacterData): void {
  const learned = new Set([...data.skills, ...data.spells]);
  for (const id of Object.keys(data.prof)) if (!learned.has(id)) delete data.prof[id];
}

/** 장비를 벗겨 소지품(꽉 차면 창고)으로 옮깁니다 */
export function unequipToBag(data: CharacterData, gd: GameData, slot: EquipSlot): boolean {
  const id = data.equipment[slot];
  if (!id) return false;
  const def = gd.items.get(id);
  data.equipment[slot] = null;
  if (!def) return true;
  // 소지품이 가득 차면 창고로 (창고도 가득 차면 칸 수를 넘겨서라도 보관해 아이템을 잃지 않게 함)
  if (addItem(data, def, 1) > 0) addToStorage(data, def, 1, true);
  return true;
}

/**
 * 직업 변경 (평민의 5레벨 직업 선택과 관리자 명령): 다른 직업의 기술/마법과 못 쓰는 장비를 정리합니다.
 * 전직·2차 전직은 기술을 그대로 가지므로 이 함수를 쓰지 않습니다 (progression.ts).
 * 2차 직업이 되면 어빌리티 레벨이 1 이상, 아니면 0 이 되고, 수인이 아니면 계통을 지웁니다.
 */
export function setClassOnData(data: CharacterData, gd: GameData, classId: ClassId): void {
  data.classId = classId;
  const keep = (id: string) => {
    const a = gd.abilities.get(id);
    return a !== undefined && abilityAllowedFor(a, classId);
  };
  data.skills = data.skills.filter(keep);
  data.spells = data.spells.filter(keep);
  pruneProf(data);
  if (classTier(classId) === 2) data.abilityLevel = Math.max(1, data.abilityLevel);
  else {
    data.abilityLevel = 0;
    data.abilityExp = 0;
  }
  if (classId !== 'beastkin') data.beastType = null;
  for (const s of EQUIP_SLOTS) {
    const id = data.equipment[s];
    const def = id ? gd.items.get(id) : undefined;
    if (def?.classes && def.classes.length > 0 && !def.classes.includes(classId)) unequipToBag(data, gd, s);
  }
}

/** 직업과 레벨에 맞는 가장 좋은 장비 목록 (관리자 지급용) */
export function bestGearFor(data: CharacterData, gd: GameData): ItemDef[] {
  const cls = gd.classes.get(data.classId)!;
  const weights = cls.statWeights;
  const mainStat = (Object.keys(weights) as StatKey[]).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))[0] ?? 'str';
  const out: ItemDef[] = [];
  for (const slot of EQUIP_SLOTS) {
    let best: ItemDef | undefined;
    let bestScore = -Infinity;
    for (const it of gd.items.values()) {
      if (it.slot !== slot || equipError(data, it) !== null) continue;
      let score = (it.level ?? 0) * 10;
      if (it.classes?.includes(data.classId)) score += 5;
      if (slot === 'ring' && it.bonus?.[mainStat]) score += 3;
      if ((slot === 'necklace' || slot === 'belt') && (it.offense === 'light' || it.defense === 'light')) score += 1;
      if (score > bestScore) {
        best = it;
        bestScore = score;
      }
    }
    if (best) out.push(best);
  }
  return out;
}
