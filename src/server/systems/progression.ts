// 경험치/레벨업/능력치 분배 (접속 중인 플레이어용)와 성장 체계(전직·승급·2차 전직·어빌리티·숙련도·스킬트리 배우기).
// 성장 체계 함수의 모양(이름·인자·돌려주는 값·뜻)은 확정입니다. "엔진 트랙" 이라고 적힌 함수의 몸통은 엔진 트랙이 채웁니다.
// 규칙과 기본값은 docs/progression.md, 데이터 형식은 src/shared/progression.ts 를 보세요.
import {
  CLASS_FALLBACK_NAMES,
  EQUIP_SLOTS,
  formatNumber,
  isStatKey,
  MAX_ABILITIES,
  MAX_BONUS,
  MAX_STAT_POINTS,
  STAT_KEYS,
  type ClassId,
  type StatKey,
} from '../../shared/constants';
import { computeDerived, START_STAT, type DerivedStats } from '../../shared/formulas';
import {
  abilityExpToNext,
  abilityVitals,
  bigNumber,
  classTier,
  describeCondition,
  isFirstClass,
  isSecondClass,
  learnStatus,
  profEffect,
  profGainChance,
  rebirthName,
  type Condition,
  type ConditionCheck,
  type ConditionResult,
  type FirstClassId,
  type LearnContext,
  type NameLookup,
} from '../../shared/progression';
import type { ItemDef } from '../../shared/types';
import type { LearnEntry } from '../../shared/protocol';
import type { ServerConfig } from '../config';
import type { GameData } from '../gamedata';
import type { CharacterData } from '../storage';
import type { Player } from '../world/Player';
import { addExpToData, countItem, learnOnData, removeItemQty, unequipUnwearable } from './character';

/**
 * 경험치를 주고, 레벨이 오르면 축하 효과와 함께 알립니다.
 * fromKill 이면 몬스터를 잡아 받은 경험치라서, 2차 직업은 그 일부(ability.expRatio)를 어빌 경험치로도 받습니다.
 */
export function gainExp(p: Player, amount: number, opts: { showGain?: boolean; fromKill?: boolean } = {}): number {
  if (!(amount > 0)) return 0;
  const world = p.world;
  const amt = Math.floor(amount);
  const gained = addExpToData(p.data, world.config, amt);
  const ab = opts.fromKill ? abilityExpShare(p.data, world.data, amt) : 0;
  if (opts.showGain !== false) p.send({ t: 'gain', exp: amt, gold: 0, ...(ab > 0 ? { abilityExp: ab } : {}) });
  if (gained > 0) onLevelUp(p, gained);
  if (ab > 0) gainAbilityExp(p, amt);
  p.markSelf();
  return gained;
}

/** 레벨이 오른 직후 처리: 다시 계산, 체력/마나 회복, 알림 */
export function onLevelUp(p: Player, levels: number, opts: { byAdmin?: boolean } = {}): void {
  p.recompute();
  if (!p.isDead) {
    p.hp = p.maxHp;
    p.mp = p.maxMp;
  }
  const lv = p.data.level;
  p.send({ t: 'levelUp', level: lv });
  p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
  p.broadcastLook();
  const pts = p.data.statPoints;
  p.notice(levels > 1 ? `레벨 ${levels} 상승! ${lv}레벨이 되었습니다.` : `레벨 업! ${lv}레벨이 되었습니다.`, 'good');
  if (pts > 0 && !opts.byAdmin) p.sys(`분배할 수 있는 능력치 포인트가 ${pts} 있습니다. (G 키: 능력치 창)`);
  if (p.data.classId === 'peasant' && lv >= p.world.config.classLevel) {
    p.sys(`${p.world.config.classLevel}레벨이 되었습니다. 마을의 길드장을 찾아가 직업을 선택할 수 있습니다.`);
  }
  p.world.groups.touch(p);
}

/** 능력치 포인트 분배 */
export function allocateStat(p: Player, stat: unknown, n: unknown): void {
  if (!isStatKey(stat)) return;
  const count = typeof n === 'number' && Number.isInteger(n) ? n : 1;
  if (count < 1 || count > 1000) return;
  if (p.data.statPoints < count) {
    p.err('남은 능력치 포인트가 부족합니다.');
    return;
  }
  const cap = p.world.config.statCap;
  const key = stat as StatKey;
  const room = cap - p.data.stats[key];
  const add = Math.min(room, count);
  if (add <= 0) {
    p.err(`이 능력치는 최대치(${cap})입니다.`);
    return;
  }
  p.data.stats[key] += add;
  p.data.statPoints -= add;
  p.recompute();
  p.markVitals();
}

// ───────────────────────── 성장 체계: 계산 (구현됨) ─────────────────────────

/** 전직·승급·2차 전직·교환·배우기 같은 성장 행동의 결과 */
export interface ProgressionResult {
  ok: boolean;
  /** 플레이어에게 보일 말: 실패하면 이유, 성공하면 결과 */
  msg: string;
  /** 조건이 있는 행동이면 조건별 결과 (NPC 대화창이 줄마다 보여 줌) */
  check?: ConditionCheck;
}

/**
 * 장비를 뺀 최대 체력·마나를 계산할 때 직업·레벨·능력치 몫에 더하는 값:
 * 승급 장인에게 산 체력·마나(bonusHp/bonusMp, 음수일 수 있음) + 어빌리티 레벨 보너스.
 * Player.recompute, 관리자의 오프라인 계산, 순수 체력·마력 계산이 모두 이 값을 씁니다.
 */
export function vitalsBonus(data: CharacterData, gd: GameData): { hp: number; mp: number } {
  const a = abilityVitals(data.abilityLevel, gd.progression.ability);
  return { hp: data.bonusHp + a.hp, mp: data.bonusMp + a.mp };
}

/** 순수 최대 체력·마나 (장비와 상태 효과를 뺀 값): 전직·승급·2차 전직 조건의 pureHp/pureMp 가 이 값과 비교합니다 */
export function pureVitals(data: CharacterData, gd: GameData): { hp: number; mp: number } {
  const cls = gd.classes.get(data.classId) ?? gd.classes.get('peasant')!;
  const b = vitalsBonus(data, gd);
  const d = computeDerived({ cls, level: data.level, stats: data.stats, bonusHp: b.hp, bonusMp: b.mp, equipment: [] });
  return { hp: d.maxHp, mp: d.maxMp };
}

/**
 * 직업 기본 체력·마나 = 직업 기본 + 레벨 몫 (건강/지혜·산 값·어빌 보너스 제외).
 * 체력을 팔거나(hpToStat) 바칠 때(payHp/payMp) 순수 최대 체력·마나가 이 아래로 내려가게 할 수 없습니다.
 */
export function classBaseVitals(data: CharacterData, gd: GameData): { hp: number; mp: number } {
  const cls = gd.classes.get(data.classId) ?? gd.classes.get('peasant')!;
  return {
    hp: Math.round(cls.baseHp + cls.hpPerLevel * (data.level - 1)),
    mp: Math.round(cls.baseMp + cls.mpPerLevel * (data.level - 1)),
  };
}

/** describeCondition 에 넘길 이름 찾기 (서버의 게임 데이터로) */
export function namesOf(gd: GameData): NameLookup {
  return {
    abilityName: (id) => gd.abilities.get(id)?.name ?? id,
    itemName: (id) => gd.items.get(id)?.name ?? id,
  };
}

/** 서버 쪽 배우기 조건 확인에 쓰는 캐릭터 정보 (클라이언트도 같은 모양을 SelfState 에서 만들어 learnStatus 를 부름) */
export function learnContextOf(data: CharacterData, gd: GameData): LearnContext {
  const learned = new Set([...data.skills, ...data.spells]);
  return {
    classId: data.classId,
    level: data.level,
    abilityLevel: data.abilityLevel,
    gold: data.gold,
    stats: data.stats,
    beastType: data.beastType,
    learnedCount: (kind) => (kind === 'skill' ? data.skills : data.spells).length,
    learned: (id) => learned.has(id),
    prof: (id) => data.prof[id] ?? 0,
    itemCount: (id) => countItem(data, id),
    ability: (id) => gd.abilities.get(id),
    itemName: (id) => gd.items.get(id)?.name ?? id,
    beastTypeName: (id) => gd.progression.second.beastTypes.find((b) => b.id === id)?.name ?? id,
  };
}

/** 길드장 창('learn' 메시지)에 보낼 classId 직업 트리의 기술 목록: 필요 레벨(어빌) → 줄 → 칸 순서 */
export function learnEntries(data: CharacterData, gd: GameData, classId: ClassId): LearnEntry[] {
  const tree = gd.skillTrees.trees[classId];
  if (!tree) return [];
  const ctx = learnContextOf(data, gd);
  const need = (n: { level?: number; abilityLevel?: number }) => n.abilityLevel ?? n.level ?? 0;
  return tree.nodes
    .filter((n) => gd.abilities.has(n.ability))
    .sort((a, b) => need(a) - need(b) || a.row - b.row || a.col - b.col)
    .map((n) => ({
      id: n.ability,
      level: n.level ?? 0,
      abilityLevel: n.abilityLevel ?? 0,
      price: n.gold,
      ...learnStatus(classId, n, ctx),
    }));
}

// ───────────────────────── 성장 체계: 공용 도우미 ─────────────────────────

const ok = (msg: string, check?: ConditionCheck): ProgressionResult => ({ ok: true, msg, ...(check ? { check } : {}) });
const fail = (msg: string, check?: ConditionCheck): ProgressionResult => ({ ok: false, msg, ...(check ? { check } : {}) });

/** 직업 이름 (게임 데이터에 없으면 기본 이름) */
export function classNameOf(gd: GameData, id: ClassId): string {
  return gd.classes.get(id)?.name ?? CLASS_FALLBACK_NAMES[id];
}

/** 채우지 못한 첫 조건의 설명 */
function firstUnmet(check: ConditionCheck): string {
  return check.results.find((r) => !r.met)?.label ?? '';
}

/** 장비를 포함한 최종 능력치 (상태 효과 제외). 접속하지 않은 캐릭터도 같은 값 */
function derivedOf(data: CharacterData, gd: GameData): DerivedStats {
  const cls = gd.classes.get(data.classId) ?? gd.classes.get('peasant')!;
  const equipment = EQUIP_SLOTS.map((s) => (data.equipment[s] ? gd.items.get(data.equipment[s]!) : undefined)).filter(
    (x): x is ItemDef => x !== undefined,
  );
  const b = vitalsBonus(data, gd);
  return computeDerived({ cls, level: data.level, stats: data.stats, bonusHp: b.hp, bonusMp: b.mp, equipment });
}

/** 체력·마나를 새 최대치로 채웁니다 (전직·2차 전직 직후) */
function fillVitals(data: CharacterData, gd: GameData): void {
  const d = derivedOf(data, gd);
  data.hp = d.maxHp;
  data.mp = d.maxMp;
}

const isLearned = (data: CharacterData, id: string) => data.skills.includes(id) || data.spells.includes(id);

// ───────────────────────── 성장 체계: 조건 (엔진 트랙) ─────────────────────────

/**
 * 조건 목록을 확인합니다 (값을 바꾸지 않음). 결과는 설정 순서대로 조건마다 하나, label 은 describeCondition.
 * pureHp/pureMp 는 pureVitals, payHp/payMp 는 바친 뒤에도 classBaseVitals 이상인지, skillProf 는 배웠고 숙련도가 min 이상인지.
 * 쓰는 조건(경험치·골드·아이템을 냄, 체력·마력을 바침)이 같은 종류로 여럿이면 앞의 것과 합친 양을 채워야 합니다
 * (한꺼번에 써도 모자라지 않게). have 는 지금 값, need 는 채워야 하는 값입니다. 엔진 트랙.
 */
export function checkConditions(data: CharacterData, gd: GameData, conds: readonly Condition[]): ConditionCheck {
  const names = namesOf(gd);
  const pure = pureVitals(data, gd);
  const base = classBaseVitals(data, gd);
  const exp = Math.floor(data.exp);
  let expUsed = 0;
  let goldUsed = 0;
  let hpPaid = 0;
  let mpPaid = 0;
  const itemsUsed = new Map<string, number>();
  const results = conds.map((cond): ConditionResult => {
    const label = describeCondition(cond, names);
    const num = (have: number, need: number): ConditionResult => ({ cond, met: have >= need, label, have, need });
    switch (cond.type) {
      case 'level':
        return num(data.level, cond.min);
      case 'ascended':
        return { cond, met: data.ascended, label };
      case 'rebirths':
        return num(data.rebirths, cond.min);
      case 'pureHp':
        return num(pure.hp, cond.min);
      case 'pureMp':
        return num(pure.mp, cond.min);
      case 'exp': {
        const need = cond.min + (cond.consume ? expUsed : 0);
        if (cond.consume) expUsed += cond.min;
        return num(exp, need);
      }
      case 'payHp':
        // 바친 뒤에도 순수 최대 체력이 직업 기본 체력 이상이어야 합니다
        hpPaid += cond.amount;
        return num(pure.hp, base.hp + hpPaid);
      case 'payMp':
        mpPaid += cond.amount;
        return num(pure.mp, base.mp + mpPaid);
      case 'gold': {
        const need = cond.min + (cond.consume ? goldUsed : 0);
        if (cond.consume) goldUsed += cond.min;
        return num(data.gold, need);
      }
      case 'item': {
        const used = itemsUsed.get(cond.item) ?? 0;
        if (cond.consume) itemsUsed.set(cond.item, used + cond.qty);
        return num(countItem(data, cond.item), cond.qty + (cond.consume ? used : 0));
      }
      case 'skillProf': {
        if (!isLearned(data, cond.ability)) return { cond, met: false, label, need: cond.min };
        return num(data.prof[cond.ability] ?? 0, cond.min);
      }
    }
  });
  return { ok: results.every((r) => r.met), results };
}

/**
 * 쓰는 조건을 한꺼번에 씁니다: exp/gold/item(consume), payHp/payMp(bonusHp/bonusMp 에서 뺌).
 * 반드시 checkConditions 가 ok 인 것을 확인한 직후에만 부릅니다. 엔진 트랙.
 */
export function payConditions(data: CharacterData, gd: GameData, conds: readonly Condition[]): void {
  void gd;
  for (const c of conds) {
    switch (c.type) {
      case 'exp':
        if (c.consume) data.exp = Math.max(0, data.exp - c.min);
        break;
      case 'gold':
        if (c.consume) data.gold = Math.max(0, data.gold - c.min);
        break;
      case 'item':
        if (c.consume) removeItemQty(data, c.item, c.qty);
        break;
      case 'payHp':
        data.bonusHp = Math.max(-MAX_BONUS, data.bonusHp - c.amount);
        break;
      case 'payMp':
        data.bonusMp = Math.max(-MAX_BONUS, data.bonusMp - c.amount);
        break;
      default:
        break;
    }
  }
}

// ───────────────────────── 전직 (엔진 트랙) ─────────────────────────

/** 지금 직업에서 전직해 될 수 있는 직업들 (rebirth.targets, 1차 직업이 아니면 빈 배열). 엔진 트랙 */
export function rebirthTargets(data: CharacterData, gd: GameData): FirstClassId[] {
  return isFirstClass(data.classId) ? [...gd.progression.rebirth.targets[data.classId]] : [];
}

/** NPC 가 전직(환골탈태)을 내놓을지: 레벨·승급 여부·갈 수 있는 직업만 봅니다 (조건은 고른 뒤에 보여 줌) */
export function rebirthOffered(data: CharacterData, gd: GameData, target: ClassId): boolean {
  const rb = gd.progression.rebirth;
  if (!isFirstClass(data.classId) || data.level < rb.level || (data.ascended && !rb.allowAfterAscend)) return false;
  return rebirthTargets(data, gd).some((c) => c === target);
}

/**
 * target 으로 전직할 수 있는지: 지금 1차 직업, 레벨 ≥ rebirth.level, 승급했으면 allowAfterAscend,
 * target ∈ rebirth.targets[지금 직업], rebirth.conditions[지금 직업] 모두 채움. 엔진 트랙.
 * 지금 직업이 1차 직업이면 결과에 조건별 확인(check)이 늘 들어 있습니다.
 */
export function checkRebirth(data: CharacterData, gd: GameData, target: ClassId): ProgressionResult {
  const rb = gd.progression.rebirth;
  const cur = data.classId;
  if (!isFirstClass(cur)) return fail(classTier(cur) === 2 ? '2차 직업은 전직할 수 없습니다.' : '1차 직업을 가진 사람만 전직할 수 있습니다.');
  const name = rebirthName(cur, gd.progression);
  const check = checkConditions(data, gd, rb.conditions[cur]);
  if (!isFirstClass(target) || !rb.targets[cur].some((c) => c === target))
    return fail(`${classNameOf(gd, cur)}은(는) ${classNameOf(gd, target)}(으)로 ${name}할 수 없습니다.`, check);
  if (data.ascended && !rb.allowAfterAscend) return fail(`승급한 뒤에는 ${name}할 수 없습니다.`, check);
  if (data.level < rb.level) return fail(`${rb.level}레벨이 되어야 ${name}할 수 있습니다.`, check);
  if (!check.ok) return fail(`${name} 조건이 모자랍니다: ${firstUnmet(check)}`, check);
  return ok(`${classNameOf(gd, target)}(으)로 ${name}할 수 있습니다.`, check);
}

/**
 * 전직(무도가는 환골탈태): checkRebirth 를 통과하면 조건을 쓰고
 * 직업 = target, 레벨 = restartLevel, 경험치 0, 능력치는 모두 START_STAT, 능력치 포인트 = (restartLevel − 1) × statPointsPerLevel,
 * 기술·마법과 숙련도·bonusHp/bonusMp(음수면 0으로)·장비·소지품·골드·창고는 그대로, 새 직업이 못 입는 장비는 소지품으로,
 * rebirths + 1, 체력·마나는 새 최대치로. 엔진 트랙.
 */
export function rebirthOnData(data: CharacterData, gd: GameData, cfg: ServerConfig, target: ClassId): ProgressionResult {
  const r = checkRebirth(data, gd, target);
  if (!r.ok || !isFirstClass(data.classId) || !isFirstClass(target)) return r;
  const rb = gd.progression.rebirth;
  const from = data.classId;
  const name = rebirthName(from, gd.progression);
  payConditions(data, gd, rb.conditions[from]);
  data.classId = target;
  const level = Math.max(1, Math.min(rb.restartLevel, cfg.maxLevel));
  data.level = level;
  data.exp = 0;
  for (const k of STAT_KEYS) data.stats[k] = START_STAT;
  data.statPoints = (level - 1) * cfg.statPointsPerLevel;
  // 산 체력·마나는 그대로 (팔거나 바쳐 음수가 됐으면 0으로)
  data.bonusHp = Math.max(0, data.bonusHp);
  data.bonusMp = Math.max(0, data.bonusMp);
  data.abilityLevel = 0;
  data.abilityExp = 0;
  data.beastType = null;
  data.rebirths += 1;
  unequipUnwearable(data, gd);
  fillVitals(data, gd);
  return ok(`${name}했습니다! ${classNameOf(gd, target)}(으)로 ${level}레벨부터 다시 시작합니다. (${data.rebirths}번째)`, r.check);
}

// ───────────────────────── 승급 (엔진 트랙) ─────────────────────────

/** 승급할 수 있는지: 지금 1차 직업, 아직 승급 전, 레벨 ≥ ascend.level, ascend.conditions[지금 직업] 모두 채움. 엔진 트랙 */
export function checkAscend(data: CharacterData, gd: GameData): ProgressionResult {
  const asc = gd.progression.ascend;
  const cur = data.classId;
  if (!isFirstClass(cur)) return fail(classTier(cur) === 2 ? '2차 직업은 이미 승급을 지났습니다.' : '1차 직업을 가진 사람만 승급할 수 있습니다.');
  const check = checkConditions(data, gd, asc.conditions[cur]);
  if (data.ascended) return fail(`이미 승급한 ${asc.title}입니다.`, check);
  if (data.level < asc.level) return fail(`${asc.level}레벨이 되어야 승급할 수 있습니다.`, check);
  if (!check.ok) return fail(`승급 조건이 모자랍니다: ${firstUnmet(check)}`, check);
  return ok('승급할 수 있습니다.', check);
}

/** 승급: checkAscend 를 통과하면 조건을 쓰고 ascended = true (칭호는 ascend.title). 엔진 트랙 */
export function ascendOnData(data: CharacterData, gd: GameData): ProgressionResult {
  const r = checkAscend(data, gd);
  if (!r.ok || !isFirstClass(data.classId)) return r;
  const asc = gd.progression.ascend;
  payConditions(data, gd, asc.conditions[data.classId]);
  data.ascended = true;
  return ok(`승급했습니다! 이제부터 ${asc.title}(이)라 불립니다.`, r.check);
}

/** 교환 한 번에 고를 수 있는 최대 횟수 */
const MAX_TRADE_TIMES = 1_000_000;

function tradeTimesError(times: number): string | null {
  return Number.isInteger(times) && times >= 1 && times <= MAX_TRADE_TIMES ? null : '교환 횟수가 올바르지 않습니다.';
}

/** 지금 할 수 있는 교환 횟수: 경험치 → 체력·마나, 체력 → 능력치 (레벨이 모자라면 0) */
export function tradeLimits(data: CharacterData, gd: GameData): { hp: number; mp: number; stat: number } {
  const asc = gd.progression.ascend;
  if (data.level < asc.level) return { hp: 0, mp: 0, stat: 0 };
  const byExp = Math.floor(data.exp / asc.expTrade.exp);
  const room = (cur: number, per: number) => (per > 0 ? Math.max(0, Math.floor((MAX_BONUS - cur) / per)) : 0);
  const spare = pureVitals(data, gd).hp - classBaseVitals(data, gd).hp;
  return {
    hp: Math.min(byExp, room(data.bonusHp, asc.expTrade.hp), MAX_TRADE_TIMES),
    mp: Math.min(byExp, room(data.bonusMp, asc.expTrade.mp), MAX_TRADE_TIMES),
    stat: Math.min(
      Math.max(0, Math.floor(spare / asc.hpToStat.hp)),
      Math.floor((data.bonusHp + MAX_BONUS) / asc.hpToStat.hp),
      Math.floor((MAX_STAT_POINTS - data.statPoints) / asc.hpToStat.stat),
      MAX_TRADE_TIMES,
    ),
  };
}

/** 경험치로 최대 체력(kind 'hp')·마나('mp') 사기를 times 번: 레벨 ≥ ascend.level, 경험치 ≥ expTrade.exp × times. 엔진 트랙 */
export function tradeExpOnData(data: CharacterData, gd: GameData, kind: 'hp' | 'mp', times: number): ProgressionResult {
  const asc = gd.progression.ascend;
  const bad = tradeTimesError(times);
  if (bad) return fail(bad);
  if (data.level < asc.level) return fail(`${asc.level}레벨이 되어야 경험치를 바칠 수 있습니다.`);
  const per = kind === 'hp' ? asc.expTrade.hp : asc.expTrade.mp;
  const what = kind === 'hp' ? '체력' : '마나';
  if (per <= 0) return fail(`지금은 경험치로 ${what}을(를) 살 수 없습니다.`);
  const cost = asc.expTrade.exp * times;
  if (data.exp < cost) return fail(`경험치가 부족합니다. (필요 ${bigNumber(cost)}, 보유 ${bigNumber(data.exp)})`);
  const gain = per * times;
  if ((kind === 'hp' ? data.bonusHp : data.bonusMp) + gain > MAX_BONUS) return fail(`최대 ${what}을(를) 더 살 수 없습니다.`);
  data.exp -= cost;
  if (kind === 'hp') data.bonusHp += gain;
  else data.bonusMp += gain;
  return ok(`경험치 ${bigNumber(cost)}을(를) 바쳐 최대 ${what} +${formatNumber(gain)}을(를) 얻었습니다.`);
}

/**
 * 최대 체력으로 능력치 포인트 사기를 times 번: 레벨 ≥ ascend.level (승급 전에도 가능),
 * 판 뒤의 순수 최대 체력 ≥ 직업 기본 체력(classBaseVitals). bonusHp −= hpToStat.hp × times, statPoints += hpToStat.stat × times. 엔진 트랙
 */
export function tradeHpForStatOnData(data: CharacterData, gd: GameData, times: number): ProgressionResult {
  const asc = gd.progression.ascend;
  const bad = tradeTimesError(times);
  if (bad) return fail(bad);
  if (data.level < asc.level) return fail(`${asc.level}레벨이 되어야 체력을 바칠 수 있습니다.`);
  const cost = asc.hpToStat.hp * times;
  const pure = pureVitals(data, gd).hp;
  const base = classBaseVitals(data, gd).hp;
  if (pure - cost < base) {
    const can = Math.max(0, Math.floor((pure - base) / asc.hpToStat.hp));
    return fail(`직업 기본 체력(${formatNumber(base)}) 아래로는 팔 수 없습니다. (지금 순수 체력 ${formatNumber(pure)}, ${can}번까지 가능)`);
  }
  const pts = asc.hpToStat.stat * times;
  if (data.statPoints + pts > MAX_STAT_POINTS || data.bonusHp - cost < -MAX_BONUS) return fail('더 바꿀 수 없습니다.');
  data.bonusHp -= cost;
  data.statPoints += pts;
  return ok(`최대 체력 ${formatNumber(cost)}을(를) 바쳐 능력치 포인트 ${formatNumber(pts)}을(를) 얻었습니다. (G 키: 능력치 창)`);
}

// ───────────────────────── 2차 전직 (엔진 트랙) ─────────────────────────

/** 이 수인 계통 id 가 지금 설정에 있는지 */
function knownBeastType(gd: GameData, id: string | null): boolean {
  return id !== null && gd.progression.second.beastTypes.some((b) => b.id === id);
}

/**
 * target 2차 직업으로 2차 전직할 수 있는지: 지금 1차 직업 ∈ second.from[target], second.conditions[target] 모두 채움,
 * target 이 수인이면 beastType 이 second.beastTypes 중 하나, 아니면 null. 엔진 트랙
 * 갈 수 있는 길이면 결과에 조건별 확인(check)이 늘 들어 있습니다 (계통을 아직 고르지 않았어도).
 */
export function checkSecondJob(data: CharacterData, gd: GameData, target: ClassId, beastType: string | null): ProgressionResult {
  const sc = gd.progression.second;
  if (!isSecondClass(target)) return fail(`${classNameOf(gd, target)}은(는) 2차 직업이 아닙니다.`);
  const cur = data.classId;
  if (classTier(cur) === 2) return fail('이미 2차 직업입니다.');
  if (!isFirstClass(cur) || !sc.from[target].some((c) => c === cur))
    return fail(`${classNameOf(gd, cur)}은(는) ${classNameOf(gd, target)}(으)로 2차 전직할 수 없습니다.`);
  const check = checkConditions(data, gd, sc.conditions[target]);
  if (target === 'beastkin') {
    if (!knownBeastType(gd, beastType)) return fail(`수인의 계통(${sc.beastTypes.map((b) => b.name).join('·')})을 골라야 합니다.`, check);
  } else if (beastType !== null) return fail('계통은 수인만 고릅니다.', check);
  if (!check.ok) return fail(`2차 전직 조건이 모자랍니다: ${firstUnmet(check)}`, check);
  return ok(`${classNameOf(gd, target)}(으)로 2차 전직할 수 있습니다.`, check);
}

/**
 * 2차 전직: checkSecondJob 을 통과하면 조건을 쓰고 직업 = target, abilityLevel 1, abilityExp 0, beastType (수인만),
 * 레벨·능력치·기술과 숙련도는 그대로, 새 직업이 못 입는 장비는 소지품으로. 엔진 트랙
 */
export function secondJobOnData(data: CharacterData, gd: GameData, target: ClassId, beastType: string | null): ProgressionResult {
  const r = checkSecondJob(data, gd, target, beastType);
  if (!r.ok || !isSecondClass(target)) return r;
  payConditions(data, gd, gd.progression.second.conditions[target]);
  data.classId = target;
  data.abilityLevel = 1;
  data.abilityExp = 0;
  data.beastType = target === 'beastkin' ? beastType : null;
  unequipUnwearable(data, gd);
  fillVitals(data, gd);
  const beast = data.beastType ? `${beastTypeName(gd, data.beastType)} 계통의 ` : '';
  return ok(`2차 전직을 마쳤습니다! 이제 ${beast}${classNameOf(gd, target)}입니다. (어빌 1)`, r.check);
}

/** 수인 계통 이름 */
export function beastTypeName(gd: GameData, id: string): string {
  return gd.progression.second.beastTypes.find((b) => b.id === id)?.name ?? id;
}

/**
 * 계통이 없는 수인(이 체계 전에 수인이 된 캐릭터, 관리자가 직업을 바꾼 캐릭터)이 계통을 한 번 고릅니다.
 * 이미 (지금 설정에 있는) 계통이 있으면 바꿀 수 없습니다.
 */
export function chooseBeastTypeOnData(data: CharacterData, gd: GameData, beastType: string): ProgressionResult {
  if (data.classId !== 'beastkin') return fail('계통은 수인만 고릅니다.');
  if (knownBeastType(gd, data.beastType)) return fail(`이미 ${beastTypeName(gd, data.beastType!)} 계통입니다. 계통은 바꿀 수 없습니다.`);
  if (!knownBeastType(gd, beastType)) return fail('알 수 없는 계통입니다.');
  data.beastType = beastType;
  return ok(`${beastTypeName(gd, beastType)} 계통의 수인이 되었습니다.`);
}

// ───────────────────────── 어빌리티 (엔진 트랙) ─────────────────────────

/** 몬스터를 잡아 받은 일반 경험치 amount 중 어빌 경험치로도 받는 양 (2차 직업이 아니거나 어빌 만렙이면 0) */
export function abilityExpShare(data: CharacterData, gd: GameData, amount: number): number {
  const cfg = gd.progression.ability;
  if (data.abilityLevel < 1 || data.abilityLevel >= cfg.maxLevel || !(amount > 0)) return 0;
  return Math.floor(amount * cfg.expRatio);
}

/**
 * 어빌 경험치를 더하고 어빌 레벨업을 처리합니다. 오른 어빌 레벨 수를 돌려줍니다.
 * 2차 직업(abilityLevel ≥ 1)만, 필요 경험치는 abilityExpToNext, 어빌 만렙이면 더 쌓이지 않습니다. 엔진 트랙
 */
export function addAbilityExpToData(data: CharacterData, gd: GameData, amount: number): number {
  const cfg = gd.progression.ability;
  if (data.abilityLevel < 1 || !(amount > 0)) return 0;
  if (data.abilityLevel >= cfg.maxLevel) {
    data.abilityExp = 0;
    return 0;
  }
  data.abilityExp += amount;
  let gained = 0;
  while (data.abilityLevel < cfg.maxLevel) {
    const need = abilityExpToNext(data.abilityLevel, cfg);
    if (need <= 0 || data.abilityExp < need) break;
    data.abilityExp -= need;
    data.abilityLevel++;
    gained++;
  }
  if (data.abilityLevel >= cfg.maxLevel) data.abilityExp = 0;
  return gained;
}

/**
 * 몬스터를 잡아 받은 일반 경험치(배율·그룹 분배 반영)의 ability.expRatio 만큼 어빌 경험치를 줍니다 (combat.ts 의 몬스터 처치에서).
 * 어빌 레벨이 오르면 다시 계산·회복·'abilityLevelUp' 메시지·알림. 오른 어빌 레벨 수를 돌려줍니다. 엔진 트랙
 * (얻은 어빌 경험치는 gainExp 가 'gain' 메시지의 abilityExp 로 함께 알립니다)
 */
export function gainAbilityExp(p: Player, amount: number): number {
  const gd = p.world.data;
  const ab = abilityExpShare(p.data, gd, amount);
  if (ab <= 0) return 0;
  const levels = addAbilityExpToData(p.data, gd, ab);
  if (levels > 0) onAbilityLevelUp(p, levels);
  p.markSelf();
  return levels;
}

/** 어빌 레벨이 오른 직후: 다시 계산(어빌 체력·마나), 체력/마나 회복, 알림 */
export function onAbilityLevelUp(p: Player, levels: number): void {
  p.recompute();
  if (!p.isDead) {
    p.hp = p.maxHp;
    p.mp = p.maxMp;
  }
  const lv = p.data.abilityLevel;
  p.send({ t: 'abilityLevelUp', abilityLevel: lv });
  p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
  p.notice(levels > 1 ? `어빌 ${levels} 상승! 어빌 ${lv}이(가) 되었습니다.` : `어빌 업! 어빌 ${lv}이(가) 되었습니다.`, 'good');
}

// ───────────────────────── 숙련도 (엔진 트랙) ─────────────────────────

/**
 * 기술을 한 번 쓴 뒤 숙련도 오르기 판정: roll < profGainChance(지금 숙련도) 이면 +1 (숙련도 최대까지). 올랐으면 true.
 * 배우지 않은 기술이면 false. 엔진 트랙
 */
export function rollProficiencyOnData(data: CharacterData, gd: GameData, abilityId: string, roll: number): boolean {
  if (!isLearned(data, abilityId)) return false;
  const cfg = gd.progression.proficiency;
  const cur = Math.max(0, data.prof[abilityId] ?? 0);
  if (cur >= cfg.max || !(roll < profGainChance(cur, cfg))) return false;
  data.prof[abilityId] = Math.min(cfg.max, cur + 1);
  return true;
}

/** 플레이어가 기술·마법을 실제로 쓴 뒤(castNow) 부릅니다: 오르면 { t: 'prof' } 를 보내고 저장 표시. 엔진 트랙 */
export function gainProficiency(p: Player, abilityId: string): boolean {
  const gd = p.world.data;
  if (!rollProficiencyOnData(p.data, gd, abilityId, Math.random())) return false;
  const prof = p.data.prof[abilityId]!;
  p.send({ t: 'prof', id: abilityId, prof });
  p.saveDirty = true;
  // 채팅창이 넘치지 않게 10 단위와 최대에서만 알립니다 (한 칸씩은 'prof' 메시지로 화면에 보임)
  const max = gd.progression.proficiency.max;
  const name = gd.abilities.get(abilityId)?.name ?? abilityId;
  if (prof >= max) p.sys(`${name}의 숙련도가 최대(${max})에 이르렀습니다!`);
  else if (prof % 10 === 0) p.sys(`${name}의 숙련도가 ${prof}(으)로 올랐습니다.`);
  return true;
}

/**
 * 이 기술의 위력·상태 이상 확률 배율 = profEffect(숙련도). 피해(물리·마법·희생), 회복(체력·마나),
 * 해로운 상태의 확률(chance 없으면 1로 보고 곱한 뒤 1에서 자름)에 곱합니다. 흡혈은 깎은 체력에 비례하므로 따로 곱하지 않습니다.
 * 몬스터의 기술에는 쓰지 않습니다. 엔진 트랙
 */
export function proficiencyMultiplier(p: Player, abilityId: string): number {
  return profEffect(p.data.prof[abilityId] ?? 0, p.world.data.progression.proficiency);
}

// ───────────────────────── 배우기 (엔진 트랙) ─────────────────────────

/**
 * 스킬트리 조건으로 기술을 배웁니다: 지금 직업(또는 평민) 트리의 노드, learnStatus 가 learnable 이어야 하고,
 * 골드와 재료를 내고 learnOnData(숙련도 0). free 면 골드·재료를 내지 않고 조건도 보지 않습니다(운영자). 엔진 트랙
 */
export function learnFromTree(data: CharacterData, gd: GameData, abilityId: string, opts: { free?: boolean } = {}): ProgressionResult {
  const def = gd.abilities.get(abilityId);
  if (!def || def.classId === 'monster') return fail('알 수 없는 기술입니다.');
  const at = gd.nodeOf(abilityId);
  if (!at) return fail(`${def.name}은(는) 어느 스킬트리에도 없어 배울 수 없습니다.`);
  if (isLearned(data, def.id)) return fail('이미 배운 기술입니다.');
  const kind = def.kind === 'skill' ? '기술' : '마법';
  if (opts.free) {
    if (!learnOnData(data, def)) return fail(`더 배울 자리가 없습니다. (${kind}은 ${MAX_ABILITIES}개까지)`);
    return ok(`${def.name}을(를) 배웠습니다!`);
  }
  const st = learnStatus(at.classId, at.node, learnContextOf(data, gd));
  if (!st.learnable) return fail(st.reason ?? '지금은 배울 수 없습니다.');
  if (!learnOnData(data, def)) return fail(`더 배울 자리가 없습니다. (${kind}은 ${MAX_ABILITIES}개까지)`);
  // 조건을 모두 확인했으므로 골드와 재료는 모자라지 않습니다
  const paid: string[] = [];
  if (at.node.gold > 0) {
    data.gold -= at.node.gold;
    paid.push(`${formatNumber(at.node.gold)} 골드`);
  }
  for (const it of at.node.items) {
    removeItemQty(data, it.item, it.qty);
    paid.push(`${gd.items.get(it.item)?.name ?? it.item} ${formatNumber(it.qty)}개`);
  }
  return ok(`${def.name}을(를) 배웠습니다!${paid.length > 0 ? ` (${paid.join(', ')}을(를) 냈습니다)` : ''}`);
}
