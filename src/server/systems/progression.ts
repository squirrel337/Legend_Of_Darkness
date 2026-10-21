// 경험치/레벨업/능력치 분배 (접속 중인 플레이어용)와 성장 체계(전직·승급·2차 전직·어빌리티·숙련도·스킬트리 배우기).
// 성장 체계 함수의 모양(이름·인자·돌려주는 값·뜻)은 확정입니다. "엔진 트랙" 이라고 적힌 함수의 몸통은 엔진 트랙이 채웁니다.
// 규칙과 기본값은 docs/progression.md, 데이터 형식은 src/shared/progression.ts 를 보세요.
import { isStatKey, type ClassId, type StatKey } from '../../shared/constants';
import { computeDerived } from '../../shared/formulas';
import {
  abilityVitals,
  describeCondition,
  learnStatus,
  type Condition,
  type ConditionCheck,
  type FirstClassId,
  type LearnContext,
  type NameLookup,
} from '../../shared/progression';
import type { LearnEntry } from '../../shared/protocol';
import type { ServerConfig } from '../config';
import type { GameData } from '../gamedata';
import type { CharacterData } from '../storage';
import type { Player } from '../world/Player';
import { addExpToData, countItem } from './character';

/** 경험치를 주고, 레벨이 오르면 축하 효과와 함께 알립니다 */
export function gainExp(p: Player, amount: number, opts: { showGain?: boolean } = {}): number {
  if (!(amount > 0)) return 0;
  const world = p.world;
  const amt = Math.floor(amount);
  const gained = addExpToData(p.data, world.config, amt);
  if (opts.showGain !== false) p.send({ t: 'gain', exp: amt, gold: 0 });
  if (gained > 0) onLevelUp(p, gained);
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

// ───────────────────────── 성장 체계: 조건 (엔진 트랙) ─────────────────────────

const NOT_YET = '아직 준비 중인 기능입니다.';

/**
 * 조건 목록을 확인합니다 (값을 바꾸지 않음). 결과는 설정 순서대로 조건마다 하나, label 은 describeCondition.
 * pureHp/pureMp 는 pureVitals, payHp/payMp 는 바친 뒤에도 classBaseVitals 이상인지, skillProf 는 배웠고 숙련도가 min 이상인지.
 * 엔진 트랙.
 */
export function checkConditions(data: CharacterData, gd: GameData, conds: readonly Condition[]): ConditionCheck {
  void data;
  // 틀: 모든 조건을 채우지 못한 것으로 봅니다 (엔진 트랙이 실제 값과 비교하도록 채움)
  const names = namesOf(gd);
  const results = conds.map((cond) => ({ cond, met: false, label: describeCondition(cond, names) }));
  return { ok: results.length === 0, results };
}

/**
 * 쓰는 조건을 한꺼번에 씁니다: exp/gold/item(consume), payHp/payMp(bonusHp/bonusMp 에서 뺌).
 * 반드시 checkConditions 가 ok 인 것을 확인한 직후에만 부릅니다. 엔진 트랙.
 */
export function payConditions(data: CharacterData, gd: GameData, conds: readonly Condition[]): void {
  void data;
  void gd;
  void conds;
}

// ───────────────────────── 전직 (엔진 트랙) ─────────────────────────

/** 지금 직업에서 전직해 될 수 있는 직업들 (rebirth.targets, 1차 직업이 아니면 빈 배열). 엔진 트랙 */
export function rebirthTargets(data: CharacterData, gd: GameData): FirstClassId[] {
  void data;
  void gd;
  return [];
}

/**
 * target 으로 전직할 수 있는지: 지금 1차 직업, 레벨 ≥ rebirth.level, 승급했으면 allowAfterAscend,
 * target ∈ rebirth.targets[지금 직업], rebirth.conditions[지금 직업] 모두 채움. 엔진 트랙.
 */
export function checkRebirth(data: CharacterData, gd: GameData, target: ClassId): ProgressionResult {
  void data;
  void gd;
  void target;
  return { ok: false, msg: NOT_YET };
}

/**
 * 전직(무도가는 환골탈태): checkRebirth 를 통과하면 조건을 쓰고
 * 직업 = target, 레벨 = restartLevel, 경험치 0, 능력치는 모두 START_STAT, 능력치 포인트 = (restartLevel − 1) × statPointsPerLevel,
 * 기술·마법과 숙련도·bonusHp/bonusMp(음수면 0으로)·장비·소지품·골드·창고는 그대로, 새 직업이 못 입는 장비는 소지품으로,
 * rebirths + 1, 체력·마나는 새 최대치로. 엔진 트랙.
 */
export function rebirthOnData(data: CharacterData, gd: GameData, cfg: ServerConfig, target: ClassId): ProgressionResult {
  void data;
  void gd;
  void cfg;
  void target;
  return { ok: false, msg: NOT_YET };
}

// ───────────────────────── 승급 (엔진 트랙) ─────────────────────────

/** 승급할 수 있는지: 지금 1차 직업, 아직 승급 전, 레벨 ≥ ascend.level, ascend.conditions[지금 직업] 모두 채움. 엔진 트랙 */
export function checkAscend(data: CharacterData, gd: GameData): ProgressionResult {
  void data;
  void gd;
  return { ok: false, msg: NOT_YET };
}

/** 승급: checkAscend 를 통과하면 조건을 쓰고 ascended = true (칭호는 ascend.title). 엔진 트랙 */
export function ascendOnData(data: CharacterData, gd: GameData): ProgressionResult {
  void data;
  void gd;
  return { ok: false, msg: NOT_YET };
}

/** 경험치로 최대 체력(kind 'hp')·마나('mp') 사기를 times 번: 레벨 ≥ ascend.level, 경험치 ≥ expTrade.exp × times. 엔진 트랙 */
export function tradeExpOnData(data: CharacterData, gd: GameData, kind: 'hp' | 'mp', times: number): ProgressionResult {
  void data;
  void gd;
  void kind;
  void times;
  return { ok: false, msg: NOT_YET };
}

/**
 * 최대 체력으로 능력치 포인트 사기를 times 번: 레벨 ≥ ascend.level (승급 전에도 가능),
 * 판 뒤의 순수 최대 체력 ≥ 직업 기본 체력(classBaseVitals). bonusHp −= hpToStat.hp × times, statPoints += hpToStat.stat × times. 엔진 트랙
 */
export function tradeHpForStatOnData(data: CharacterData, gd: GameData, times: number): ProgressionResult {
  void data;
  void gd;
  void times;
  return { ok: false, msg: NOT_YET };
}

// ───────────────────────── 2차 전직 (엔진 트랙) ─────────────────────────

/**
 * target 2차 직업으로 2차 전직할 수 있는지: 지금 1차 직업 ∈ second.from[target], second.conditions[target] 모두 채움,
 * target 이 수인이면 beastType 이 second.beastTypes 중 하나, 아니면 null. 엔진 트랙
 */
export function checkSecondJob(data: CharacterData, gd: GameData, target: ClassId, beastType: string | null): ProgressionResult {
  void data;
  void gd;
  void target;
  void beastType;
  return { ok: false, msg: NOT_YET };
}

/**
 * 2차 전직: checkSecondJob 을 통과하면 조건을 쓰고 직업 = target, abilityLevel 1, abilityExp 0, beastType (수인만),
 * 레벨·능력치·기술과 숙련도는 그대로, 새 직업이 못 입는 장비는 소지품으로. 엔진 트랙
 */
export function secondJobOnData(data: CharacterData, gd: GameData, target: ClassId, beastType: string | null): ProgressionResult {
  void data;
  void gd;
  void target;
  void beastType;
  return { ok: false, msg: NOT_YET };
}

// ───────────────────────── 어빌리티 (엔진 트랙) ─────────────────────────

/**
 * 어빌 경험치를 더하고 어빌 레벨업을 처리합니다. 오른 어빌 레벨 수를 돌려줍니다.
 * 2차 직업(abilityLevel ≥ 1)만, 필요 경험치는 abilityExpToNext, 어빌 만렙이면 더 쌓이지 않습니다. 엔진 트랙
 */
export function addAbilityExpToData(data: CharacterData, gd: GameData, amount: number): number {
  void data;
  void gd;
  void amount;
  return 0;
}

/**
 * 몬스터를 잡아 받은 일반 경험치(배율·그룹 분배 반영)의 ability.expRatio 만큼 어빌 경험치를 줍니다 (combat.ts 의 몬스터 처치에서).
 * 어빌 레벨이 오르면 다시 계산·회복·'abilityLevelUp' 메시지·알림. 오른 어빌 레벨 수를 돌려줍니다. 엔진 트랙
 */
export function gainAbilityExp(p: Player, amount: number): number {
  void p;
  void amount;
  return 0;
}

// ───────────────────────── 숙련도 (엔진 트랙) ─────────────────────────

/**
 * 기술을 한 번 쓴 뒤 숙련도 오르기 판정: roll < profGainChance(지금 숙련도) 이면 +1 (숙련도 최대까지). 올랐으면 true.
 * 배우지 않은 기술이면 false. 엔진 트랙
 */
export function rollProficiencyOnData(data: CharacterData, gd: GameData, abilityId: string, roll: number): boolean {
  void data;
  void gd;
  void abilityId;
  void roll;
  return false;
}

/** 플레이어가 기술·마법을 실제로 쓴 뒤(castNow) 부릅니다: 오르면 { t: 'prof' } 를 보내고 저장 표시. 엔진 트랙 */
export function gainProficiency(p: Player, abilityId: string): boolean {
  void p;
  void abilityId;
  return false;
}

/**
 * 이 기술의 위력·상태 이상 확률 배율 = profEffect(숙련도). 피해(물리·마법·희생), 회복(체력·마나),
 * 해로운 상태의 확률(chance 없으면 1로 보고 곱한 뒤 1에서 자름)에 곱합니다. 흡혈은 깎은 체력에 비례하므로 따로 곱하지 않습니다.
 * 몬스터의 기술에는 쓰지 않습니다. 엔진 트랙 (지금은 1)
 */
export function proficiencyMultiplier(p: Player, abilityId: string): number {
  void p;
  void abilityId;
  return 1;
}

// ───────────────────────── 배우기 (엔진 트랙) ─────────────────────────

/**
 * 스킬트리 조건으로 기술을 배웁니다: 지금 직업(또는 평민) 트리의 노드, learnStatus 가 learnable 이어야 하고,
 * 골드와 재료를 내고 learnOnData(숙련도 0). free 면 골드·재료를 내지 않고 조건도 보지 않습니다(운영자). 엔진 트랙
 */
export function learnFromTree(data: CharacterData, gd: GameData, abilityId: string, opts: { free?: boolean } = {}): ProgressionResult {
  void data;
  void gd;
  void abilityId;
  void opts;
  return { ok: false, msg: NOT_YET };
}
