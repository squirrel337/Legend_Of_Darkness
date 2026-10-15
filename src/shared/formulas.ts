// 성장/전투 공식. 서버가 판정에 사용하고, 클라이언트는 화면 표시용으로 사용합니다.
import { clamp, type Element, type StatKey, type StatusId, STATUS_INFO } from './constants';
import type { ClassDef, ItemDef, MonsterDef, StatBlock } from './types';

/** 레벨 L에서 L+1로 가는 데 필요한 경험치 */
export function expToNext(level: number): number {
  if (level < 1) return 0;
  return Math.floor(15 * Math.pow(level, 2.4) + 50 * level);
}

/** 1레벨부터 level 레벨까지 누적 필요 경험치 */
export function totalExpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += expToNext(l);
  return sum;
}

export const START_STAT = 3;

/** 레벨에 따른 몬스터 기본 능력치 */
export function monsterBaseHp(level: number): number {
  return Math.round(18 + 13 * level + 0.45 * level * level);
}

export function monsterBaseDmg(level: number): [number, number] {
  const avg = 3 + 1.6 * level + 0.06 * level * level;
  return [Math.max(1, Math.round(avg * 0.8)), Math.max(2, Math.round(avg * 1.2))];
}

export function monsterBaseAc(level: number): number {
  return -Math.min(30, Math.floor(level * 0.3));
}

export function monsterBaseExp(level: number): number {
  return Math.max(1, Math.round(expToNext(level) / (8 + 0.5 * level)));
}

export function monsterBaseGold(level: number): [number, number] {
  return [level * 2 + 2, level * 5 + 5];
}

export interface MonsterStats {
  hp: number;
  dmg: [number, number];
  ac: number;
  exp: number;
  gold: [number, number];
  dex: number;
  int: number;
}

export function monsterStats(def: MonsterDef): MonsterStats {
  const L = def.level;
  const hp = def.hp ?? Math.round(monsterBaseHp(L) * (def.hpMult ?? 1));
  let dmg: [number, number];
  if (def.dmg) dmg = [def.dmg[0], def.dmg[1]];
  else {
    const b = monsterBaseDmg(L);
    const m = def.dmgMult ?? 1;
    dmg = [Math.max(1, Math.round(b[0] * m)), Math.max(1, Math.round(b[1] * m))];
  }
  return {
    hp: Math.max(1, hp),
    dmg,
    ac: def.ac ?? monsterBaseAc(L),
    exp: def.exp ?? Math.round(monsterBaseExp(L) * (def.expMult ?? 1)),
    gold: def.gold ?? monsterBaseGold(L),
    dex: 3 + Math.round(L * 0.5),
    int: 3 + Math.round(L * 1.2),
  };
}

/** AC에 따른 받는 물리 피해 배율. AC가 낮을수록(음수) 피해가 줄어듭니다. */
export function acMultiplier(ac: number): number {
  return clamp(1 + ac / 100, 0.2, 2.0);
}

/** 마법 피해는 AC의 영향을 절반만 받습니다 */
export function acMagicMultiplier(ac: number): number {
  return clamp(1 + ac / 200, 0.5, 1.5);
}

/** 속성 상성: 불 > 바람 > 땅 > 물 > 불, 빛 <-> 어둠 */
const STRONG_AGAINST: Partial<Record<Element, Element>> = {
  fire: 'wind',
  wind: 'earth',
  earth: 'water',
  water: 'fire',
  light: 'dark',
  dark: 'light',
};

export function elementMultiplier(attack: Element, defense: Element): number {
  if (attack === 'none' || defense === 'none') return 1;
  if (STRONG_AGAINST[attack] === defense) return 1.5;
  if (STRONG_AGAINST[defense] === attack) {
    // 빛/어둠은 서로에게 강함
    return attack === 'light' || attack === 'dark' ? 1.5 : 0.75;
  }
  if (attack === defense) return 0.6;
  return 1;
}

/** 레벨에 따른 능력 배율 (스킬/마법/평타 공통) */
export function levelScale(level: number): number {
  return 1 + level / 40;
}

/** 물리 명중률 */
export function hitChance(attDex: number, attLevel: number, defDex: number, defLevel: number, hitBonusPct = 0): number {
  const p = 0.88 + (attDex - defDex) * 0.004 + (attLevel - defLevel) * 0.012 + hitBonusPct / 100;
  return clamp(p, 0.3, 0.98);
}

export function critChance(dex: number, bonus = 0): number {
  return clamp(0.03 + dex * 0.0015 + bonus, 0, 0.6);
}

export const CRIT_MULT = 1.5;

export function fistDamage(level: number): [number, number] {
  return [1 + Math.floor(level / 10), 3 + Math.floor(level / 5)];
}

export interface DerivedStats {
  str: number;
  int: number;
  wis: number;
  con: number;
  dex: number;
  maxHp: number;
  maxMp: number;
  ac: number;
  dmgMin: number;
  dmgMax: number;
  /** 추가 물리 피해 */
  dmgBonus: number;
  /** 명중 보정 % */
  hit: number;
  /** 마법 피해/회복 보정 % */
  magic: number;
  offense: Element;
  defense: Element;
}

export interface DerivedInput {
  cls: ClassDef;
  level: number;
  stats: StatBlock;
  bonusHp: number;
  bonusMp: number;
  equipment: ItemDef[];
  statuses?: { id: StatusId; potency: number }[];
}

export function computeDerived(input: DerivedInput): DerivedStats {
  const { cls, level, stats } = input;
  const d: DerivedStats = {
    str: stats.str,
    int: stats.int,
    wis: stats.wis,
    con: stats.con,
    dex: stats.dex,
    maxHp: 0,
    maxMp: 0,
    ac: 0,
    dmgMin: 0,
    dmgMax: 0,
    dmgBonus: 0,
    hit: 0,
    magic: 0,
    offense: 'none',
    defense: 'none',
  };
  let hpBonus = input.bonusHp;
  let mpBonus = input.bonusMp;
  let weapon: ItemDef | undefined;
  for (const item of input.equipment) {
    if (item.slot === 'weapon') weapon = item;
    if (item.ac) d.ac += item.ac;
    const b = item.bonus;
    if (b) {
      d.str += b.str ?? 0;
      d.int += b.int ?? 0;
      d.wis += b.wis ?? 0;
      d.con += b.con ?? 0;
      d.dex += b.dex ?? 0;
      hpBonus += b.hp ?? 0;
      mpBonus += b.mp ?? 0;
      d.hit += b.hit ?? 0;
      d.dmgBonus += b.dmg ?? 0;
      d.magic += b.magic ?? 0;
    }
    if (item.offense) d.offense = item.offense;
    if (item.defense) d.defense = item.defense;
  }
  if (weapon?.dmg) {
    d.dmgMin = weapon.dmg[0];
    d.dmgMax = weapon.dmg[1];
  } else {
    const f = fistDamage(level);
    d.dmgMin = f[0];
    d.dmgMax = f[1];
  }
  for (const s of input.statuses ?? []) {
    if (s.id === 'armor') d.ac -= s.potency;
    if (s.id === 'curse') d.ac += s.potency;
  }
  d.maxHp = Math.max(1, Math.round(cls.baseHp + cls.hpPerLevel * (level - 1) + d.con * cls.hpPerCon + hpBonus));
  d.maxMp = Math.max(0, Math.round(cls.baseMp + cls.mpPerLevel * (level - 1) + d.wis * cls.mpPerWis + mpBonus));
  return d;
}

/** 평타/물리 스킬의 기본 피해 (속성/AC/치명타 적용 전) */
export function physicalBase(d: DerivedStats, level: number, weaponRoll: number): number {
  return (weaponRoll + d.str * 0.8 + d.dex * 0.2 + d.dmgBonus) * levelScale(level);
}

/** 마법 피해/회복의 기본값 */
export function magicBase(base: number, ratio: number, statValue: number, level: number, magicPct: number): number {
  return (base + statValue * ratio) * levelScale(level) * (1 + magicPct / 100);
}

/** 2초마다 회복되는 양 */
export function regenAmounts(d: DerivedStats, inSafeZone: boolean, inCombat: boolean): { hp: number; mp: number } {
  let mult = inCombat ? 1 : 2;
  if (inSafeZone) mult = 4;
  return {
    hp: Math.floor((d.maxHp * 0.01 + d.con * 0.25) * mult),
    mp: Math.floor((d.maxMp * 0.015 + d.wis * 0.3) * mult),
  };
}

/** 능력치 자동 분배: 가중치에 따라 points를 나눕니다. */
export function autoAllocate(weights: Partial<Record<StatKey, number>>, points: number): StatBlock {
  const out: StatBlock = { str: 0, int: 0, wis: 0, con: 0, dex: 0 };
  const keys = (Object.keys(weights) as StatKey[]).filter((k) => (weights[k] ?? 0) > 0);
  if (keys.length === 0 || points <= 0) return out;
  const total = keys.reduce((s, k) => s + (weights[k] ?? 0), 0);
  let given = 0;
  for (const k of keys) {
    const n = Math.floor((points * (weights[k] ?? 0)) / total);
    out[k] += n;
    given += n;
  }
  // 나머지는 가중치가 큰 순서대로
  const sorted = [...keys].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  let i = 0;
  while (given < points) {
    out[sorted[i % sorted.length]!] += 1;
    given++;
    i++;
  }
  return out;
}

export function statusPotency(id: StatusId, potency?: number): number {
  return potency ?? STATUS_INFO[id].potency;
}

/** 승급(만렙 이후 경험치로 체력/마나 구매) 설정 */
export const ASCEND = {
  exp: 500_000,
  hp: 100,
  mp: 50,
} as const;
