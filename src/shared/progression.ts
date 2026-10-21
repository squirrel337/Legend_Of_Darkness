// 성장 체계: 1차·2차 직업, 전직(무도가는 환골탈태), 승급, 2차 전직, 어빌리티 레벨, 숙련도, 스킬트리.
// gamedata/progression.json · gamedata/skilltrees.json 의 형식, 서버·클라이언트·관리자 페이지가 함께 쓰는 공식,
// 관리자 편집기("직업·스킬트리" 탭) API 의 형식을 모아 둡니다. 규칙은 docs/progression.md 를 보세요.
import { formatNumber, MAX_ABILITIES, STAT_KEYS, STAT_NAMES, type ClassId, type StatKey } from './constants';
import { expToNext } from './formulas';
import type { AbilityDef, ItemDef } from './types';

// ───────────────────────── 직업 단계 ─────────────────────────

/** 1차 직업: 5레벨에 길드에서 고르고, 99레벨에 전직·승급합니다 */
export const FIRST_CLASSES = ['warrior', 'rogue', 'wizard', 'priest', 'monk'] as const satisfies readonly ClassId[];
export type FirstClassId = (typeof FIRST_CLASSES)[number];

/** 2차 직업: 승급한 뒤 2차 전직으로만 얻습니다 (레벨은 99 그대로, 어빌리티 레벨이 1부터) */
export const SECOND_CLASSES = ['gladiator', 'archer', 'summoner', 'bard', 'beastkin'] as const satisfies readonly ClassId[];
export type SecondClassId = (typeof SECOND_CLASSES)[number];

/** 직업 단계: 0 = 평민, 1 = 1차 직업, 2 = 2차 직업 */
export type ClassTier = 0 | 1 | 2;

export function isFirstClass(v: unknown): v is FirstClassId {
  return typeof v === 'string' && (FIRST_CLASSES as readonly string[]).includes(v);
}

export function isSecondClass(v: unknown): v is SecondClassId {
  return typeof v === 'string' && (SECOND_CLASSES as readonly string[]).includes(v);
}

export function classTier(id: ClassId): ClassTier {
  return isFirstClass(id) ? 1 : isSecondClass(id) ? 2 : 0;
}

/** 기본 연결: 2차 직업 ← 2차 전직할 수 있는 1차 직업 (progression.json 의 second.from 기본값) */
export const DEFAULT_SECOND_FROM: Readonly<Record<SecondClassId, readonly FirstClassId[]>> = {
  gladiator: ['warrior'],
  archer: ['rogue'],
  summoner: ['wizard'],
  bard: ['priest'],
  beastkin: ['monk'],
};

/** 이 1차 직업에서 2차 전직해 갈 수 있는 2차 직업들 (second.from 을 거꾸로 봄) */
export function secondClassesOf(first: ClassId, from: Readonly<Record<SecondClassId, readonly FirstClassId[]>>): SecondClassId[] {
  return SECOND_CLASSES.filter((c) => from[c].some((f) => f === first));
}

// ───────────────────────── 조건 ─────────────────────────

/**
 * 전직·승급·2차 전직의 조건 하나. 모두 채워야 하고, 쓰는 조건(consume, pay)은 모든 조건을 확인한 뒤에만 한꺼번에 씁니다.
 * "순수 체력·마력"은 장비와 상태 효과를 뺀 최대 체력·마나입니다 (직업 기본 + 레벨 + 건강/지혜 + 승급 장인에게 산 값 + 어빌 보너스).
 */
export type Condition =
  /** 레벨 min 이상 */
  | { type: 'level'; min: number }
  /** 승급을 마쳤음 */
  | { type: 'ascended' }
  /** 전직(환골탈태) 횟수 min 이상 */
  | { type: 'rebirths'; min: number }
  /** 순수 최대 체력 min 이상 */
  | { type: 'pureHp'; min: number }
  /** 순수 최대 마나 min 이상 */
  | { type: 'pureMp'; min: number }
  /** 보유 경험치 min 이상. consume 이면 min 만큼 써서 없어짐 */
  | { type: 'exp'; min: number; consume: boolean }
  /**
   * 순수 최대 체력 amount 를 바침 (bonusHp 에서 빼며, bonusHp 는 음수가 될 수 있음).
   * 바친 뒤에도 순수 최대 체력이 직업 기본 체력(직업 기본 + 레벨 몫) 이상이어야 채운 것으로 칩니다.
   */
  | { type: 'payHp'; amount: number }
  /** 순수 최대 마나 amount 를 바침 (bonusMp 에서 뺌, 직업 기본 마나 이상 남아야 함) */
  | { type: 'payMp'; amount: number }
  /** 골드 min 이상. consume 이면 min 만큼 냄 */
  | { type: 'gold'; min: number; consume: boolean }
  /** 소지품에 아이템 qty 개 이상. consume 이면 냄 */
  | { type: 'item'; item: string; qty: number; consume: boolean }
  /** 기술·마법을 배웠고 숙련도가 min 이상 */
  | { type: 'skillProf'; ability: string; min: number };

export type ConditionType = Condition['type'];

export const CONDITION_TYPES: readonly ConditionType[] = [
  'level',
  'ascended',
  'rebirths',
  'pureHp',
  'pureMp',
  'exp',
  'payHp',
  'payMp',
  'gold',
  'item',
  'skillProf',
];

/** 조건 하나를 확인한 결과 (NPC 대화창이 줄마다 보여 주고, 관리자 편집기가 미리보기로 씀) */
export interface ConditionResult {
  /** 설정에 적힌 조건 그대로 */
  cond: Condition;
  /** 채웠는지 */
  met: boolean;
  /** 화면에 보일 설명 (describeCondition) */
  label: string;
  /** 지금 값 (숫자로 비교하는 조건만) */
  have?: number;
  /** 필요한 값 (숫자로 비교하는 조건만) */
  need?: number;
}

/** 조건 목록을 확인한 결과 */
export interface ConditionCheck {
  /** 모두 채웠는지 */
  ok: boolean;
  /** 설정 순서 그대로 조건마다 하나 */
  results: ConditionResult[];
}

// ───────────────────────── 성장 규칙 (gamedata/progression.json) ─────────────────────────

/** 수인 계통 (포유류·조류·파충류) */
export interface BeastTypeDef {
  /** 영문 소문자 id (스킬트리 노드의 beastType, 캐릭터의 beastType 에 씀) */
  id: string;
  /** 게임에 보일 이름 */
  name: string;
}

/** 전직: 1차 직업 99레벨에서 1레벨로 다시 시작 (능력치만 1레벨 값으로, 기술·마법과 숙련도·산 체력/마나·장비·골드는 그대로) */
export interface RebirthConfig {
  /** 전직할 수 있는 레벨 (원작 99) */
  level: number;
  /** 전직하면 돌아가는 레벨 (원작 1). 1보다 크면 그 레벨까지의 능력치 포인트를 받습니다 */
  restartLevel: number;
  /** 승급한 뒤에도 전직할 수 있는지 (원작: false) */
  allowAfterAscend: boolean;
  /** 지금 직업 → 전직해서 될 수 있는 직업 (같은 직업 포함). 기본: 무도가는 무도가만, 다른 직업은 무도가를 뺀 넷 */
  targets: Record<FirstClassId, FirstClassId[]>;
  /** 지금 직업별 전직 조건 (레벨은 level 로 따로 확인) */
  conditions: Record<FirstClassId, Condition[]>;
  /** 지금 직업별로 이 행동을 부르는 이름 (대화창·알림). 기본 '전직', 무도가 '환골탈태' */
  names: Record<FirstClassId, string>;
}

/** 승급: 1차 직업 99레벨에서 승급 장인에게 (교환은 레벨만 되면 누구나) */
export interface AscendConfig {
  /** 승급 장인의 교환·승급을 쓸 수 있는 레벨 (원작 99) */
  level: number;
  /** 경험치로 최대 체력·마나 사기: 경험치 exp 를 내면 최대 체력 +hp 또는 최대 마나 +mp (bonusHp/bonusMp 에 더함) */
  expTrade: { exp: number; hp: number; mp: number };
  /**
   * 최대 체력으로 능력치 사기: 순수 최대 체력 hp 를 내면 능력치 포인트(statPoints) +stat.
   * bonusHp 에서 빼며(음수 가능), 순수 최대 체력이 직업 기본 체력(직업 기본 + 레벨 몫) 아래로 내려가게는 팔 수 없습니다.
   */
  hpToStat: { hp: number; stat: number };
  /** 1차 직업별 승급 조건 */
  conditions: Record<FirstClassId, Condition[]>;
  /** 승급하면 붙는 칭호 */
  title: string;
}

/** 2차 전직: 승급한 1차 직업이 2차 직업 인도자에게 */
export interface SecondJobConfig {
  /** 2차 직업 ← 2차 전직할 수 있는 1차 직업들 */
  from: Record<SecondClassId, FirstClassId[]>;
  /** 2차 직업별 2차 전직 조건 (모두 채운 것을 먼저 확인한 뒤에만 씀) */
  conditions: Record<SecondClassId, Condition[]>;
  /** 수인 계통. 수인으로 2차 전직할 때 하나 고르고 바꿀 수 없습니다 */
  beastTypes: BeastTypeDef[];
}

/** 어빌리티 레벨 (2차 직업 전용, 1부터 maxLevel 까지) */
export interface AbilityLevelConfig {
  /** 어빌 최대 레벨 (99) */
  maxLevel: number;
  /** 몬스터를 잡아 받은 일반 경험치 중 어빌 경험치로도 받는 비율 (0.25) */
  expRatio: number;
  /** 어빌 레벨이 오를 때마다 늘어나는 최대 체력 (30) */
  hpPerLevel: number;
  /** 어빌 레벨이 오를 때마다 늘어나는 최대 마나 (15) */
  mpPerLevel: number;
}

/** 숙련도: 배운 기술·마법마다 0 ~ max, 쓸 때마다 확률로 1씩 오름 */
export interface ProficiencyConfig {
  /** 숙련도 최대 (100) */
  max: number;
  /** 숙련도 0 일 때 한 번 쓰면 오를 확률 (0.35) */
  baseChance: number;
  /** 숙련도가 높을수록 줄어드는 정도 (0.8): 확률 = max(minChance, baseChance × (1 − slowdown × 숙련도/max)) */
  slowdown: number;
  /** 오를 확률의 바닥 (0.03) */
  minChance: number;
  /** 숙련도 0 일 때의 위력·상태 이상 확률 배율 (0.7) */
  effectMin: number;
  /** 숙련도 max 일 때의 배율 (1.15). 그 사이는 직선 */
  effectMax: number;
}

/** gamedata/progression.json */
export interface ProgressionConfig {
  version: 1;
  rebirth: RebirthConfig;
  ascend: AscendConfig;
  second: SecondJobConfig;
  ability: AbilityLevelConfig;
  proficiency: ProficiencyConfig;
}

/** 클라이언트에 보내는 성장 규칙 (조건 목록은 서버의 NPC 대화가 보여 주므로 뺌) */
export interface PublicProgression {
  rebirth: Omit<RebirthConfig, 'conditions'>;
  ascend: Omit<AscendConfig, 'conditions'>;
  second: Omit<SecondJobConfig, 'conditions'>;
  ability: AbilityLevelConfig;
  proficiency: ProficiencyConfig;
}

export function publicProgression(cfg: ProgressionConfig): PublicProgression {
  const { conditions: _r, ...rebirth } = cfg.rebirth;
  const { conditions: _a, ...ascend } = cfg.ascend;
  const { conditions: _s, ...second } = cfg.second;
  void _r;
  void _a;
  void _s;
  return { rebirth, ascend, second, ability: cfg.ability, proficiency: cfg.proficiency };
}

// ───────────────────────── 스킬트리 (gamedata/skilltrees.json) ─────────────────────────

/** 트리 칸의 한계 (편집기와 게임 안 스킬트리 창이 그릴 수 있는 크기) */
export const TREE_MAX_ROWS = 40;
export const TREE_MAX_COLS = 12;

/** 배울 때 내는 재료 아이템 (써서 없어짐) */
export interface LearnItem {
  item: string;
  qty: number;
}

/** 선수과목: 먼저 배워 숙련도를 prof 이상 올려 둬야 하는 기술·마법 (prof 0 이면 배우기만 하면 됨) */
export interface LearnPrereq {
  ability: string;
  prof: number;
}

/**
 * 기술 하나를 배우는 조건 (원작처럼 길드장에게서, 선수과목 + 숙련도).
 * 1차 직업·평민 트리는 level, 2차 직업 트리는 abilityLevel 을 씁니다.
 */
export interface LearnReq {
  /** 필요 레벨 (1차 직업·평민 트리) */
  level?: number;
  /** 필요 어빌리티 레벨 (2차 직업 트리) */
  abilityLevel?: number;
  /** 내는 골드 (0 이면 무료) */
  gold: number;
  /** 내는 재료 (JSON 에서 생략하면 빈 배열) */
  items: LearnItem[];
  /** 선수과목 (JSON 에서 생략하면 빈 배열) */
  requires: LearnPrereq[];
  /** 필요 능력치 (장비를 뺀 기본 능력치로 비교) */
  stats?: Partial<Record<StatKey, number>>;
  /** 수인 계통 전용 기술 (수인 트리에서만) */
  beastType?: string;
}

/** 스킬트리의 칸 하나 = 기술 하나 */
export interface SkillTreeNode extends LearnReq {
  /** abilities.json 의 기술 id (그 직업의 기술이어야 함) */
  ability: string;
  /** 줄 (0부터, 위에서 아래로) */
  row: number;
  /** 칸 (0부터, 왼쪽에서 오른쪽으로) */
  col: number;
}

/** 직업 하나의 스킬트리 */
export interface SkillTreeConfig {
  /** 칸 위에 보일 열 제목 (선택, 예: ["공격", "수호"]) */
  columns?: string[];
  nodes: SkillTreeNode[];
}

/** gamedata/skilltrees.json. 모든 직업(평민 포함)의 트리가 있어야 합니다 (배울 것이 없으면 nodes: []) */
export interface SkillTreesConfig {
  version: 1;
  trees: Record<ClassId, SkillTreeConfig>;
}

// ───────────────────────── 공식 ─────────────────────────

/**
 * 이 체계를 넣기 전에 배운 기술의 숙련도: 최대로 옮김 (위력 effectMax = 115%, 이 체계 전보다 15% 셈).
 * 예전 위력(100%)은 숙련도 약 67 이고, 새로 배운 기술은 0(70%) 에서 시작합니다.
 */
export const PROF_MIGRATED = 100;

/** 숙련도가 한 번 쓸 때 1 오를 확률. 이미 최대면 0 */
export function profGainChance(prof: number, c: ProficiencyConfig): number {
  if (prof >= c.max) return 0;
  const t = Math.max(0, prof) / c.max;
  return Math.max(c.minChance, c.baseChance * (1 - c.slowdown * t));
}

/** 숙련도에 따른 위력(피해·회복·흡혈)과 상태 이상 확률의 배율: 0 → effectMin, max → effectMax, 그 사이는 직선 */
export function profEffect(prof: number, c: ProficiencyConfig): number {
  const t = Math.min(1, Math.max(0, prof / c.max));
  return c.effectMin + (c.effectMax - c.effectMin) * t;
}

/** 어빌리티 레벨로 늘어난 최대 체력·마나 (어빌 1 은 0, 한 레벨 오를 때마다 hpPerLevel·mpPerLevel) */
export function abilityVitals(abilityLevel: number, c: AbilityLevelConfig): { hp: number; mp: number } {
  const n = Math.max(0, Math.floor(abilityLevel) - 1);
  return { hp: n * c.hpPerLevel, mp: n * c.mpPerLevel };
}

/** 어빌 레벨 L → L+1 에 필요한 어빌 경험치 (일반 레벨 표와 같음). 2차 직업이 아니거나(0) 만렙이면 0 */
export function abilityExpToNext(abilityLevel: number, c: AbilityLevelConfig): number {
  if (abilityLevel < 1 || abilityLevel >= c.maxLevel) return 0;
  return expToNext(abilityLevel);
}

/** 칭호 (승급하면 ascend.title, 아니면 빈 문자열) */
export function titleOf(ascended: boolean, cfg: { ascend: { title: string } }): string {
  return ascended ? cfg.ascend.title : '';
}

/** 이 직업에서 전직을 부르는 이름 (무도가 '환골탈태', 그 밖 '전직') */
export function rebirthName(classId: ClassId, cfg: { rebirth: { names: Record<FirstClassId, string> } }): string {
  return isFirstClass(classId) ? cfg.rebirth.names[classId] : '전직';
}

/** 큰 수를 한글 단위로 (예: 100000000 → "1억", 250000000 → "2억 5,000만", 14000 → "14,000") */
export function bigNumber(n: number): string {
  const v = Math.floor(n);
  if (Math.abs(v) < 100_000) return formatNumber(v);
  const eok = Math.floor(v / 100_000_000);
  const man = Math.floor((v % 100_000_000) / 10_000);
  const rest = v % 10_000;
  const parts: string[] = [];
  if (eok) parts.push(`${formatNumber(eok)}억`);
  if (man) parts.push(`${formatNumber(man)}만`);
  if (rest) parts.push(formatNumber(rest));
  return parts.join(' ');
}

/** 이름 찾기 (서버는 GameData, 클라이언트·관리자 페이지는 받은 데이터로 만듦) */
export interface NameLookup {
  abilityName(id: string): string;
  itemName(id: string): string;
}

/** 조건을 사람이 읽을 말로 (예: "순수 체력 14,000 이상", "경험치 1억 (써서 없어짐)") */
export function describeCondition(c: Condition, n: NameLookup): string {
  switch (c.type) {
    case 'level':
      return `레벨 ${c.min} 이상`;
    case 'ascended':
      return '승급을 마침';
    case 'rebirths':
      return `전직 ${formatNumber(c.min)}번 이상`;
    case 'pureHp':
      return `순수 체력 ${bigNumber(c.min)} 이상`;
    case 'pureMp':
      return `순수 마력 ${bigNumber(c.min)} 이상`;
    case 'exp':
      return c.consume ? `경험치 ${bigNumber(c.min)} (써서 없어짐)` : `경험치 ${bigNumber(c.min)} 이상`;
    case 'payHp':
      return `순수 체력 ${bigNumber(c.amount)} 바침`;
    case 'payMp':
      return `순수 마력 ${bigNumber(c.amount)} 바침`;
    case 'gold':
      return c.consume ? `${bigNumber(c.min)} 골드 (냄)` : `${bigNumber(c.min)} 골드 이상`;
    case 'item':
      return `${n.itemName(c.item)} ${formatNumber(c.qty)}개${c.consume ? ' (냄)' : ''}`;
    case 'skillProf':
      return `${n.abilityName(c.ability)} 숙련도 ${c.min} 이상`;
  }
}

// ───────────────────────── 배우는 조건의 상태 ─────────────────────────

/**
 * 배우는 조건을 확인할 때 필요한 캐릭터 정보.
 * 서버는 CharacterData 에서(progression.ts 의 learnContextOf), 클라이언트는 SelfState·소지품에서 만들어
 * 같은 learnStatus 로 확인하므로, 길드장 창과 스킬트리 창(K)의 표시가 서버 판정과 어긋나지 않습니다.
 */
export interface LearnContext {
  /** 지금 직업 */
  classId: ClassId;
  level: number;
  /** 어빌리티 레벨 (2차 직업이 아니면 0) */
  abilityLevel: number;
  gold: number;
  /** 장비를 뺀 기본 능력치 */
  stats: Readonly<Record<StatKey, number>>;
  /** 수인 계통 (없으면 null) */
  beastType: string | null;
  /** 배운 기술 수(kind 'skill') 또는 마법 수('spell') */
  learnedCount(kind: 'skill' | 'spell'): number;
  /** 이 기술·마법을 배웠는지 */
  learned(abilityId: string): boolean;
  /** 숙련도 (배우지 않았으면 0) */
  prof(abilityId: string): number;
  /** 소지품에 있는 이 아이템의 개수 */
  itemCount(itemId: string): number;
  /** 기술 정의 (없으면 undefined) */
  ability(abilityId: string): Pick<AbilityDef, 'name' | 'kind'> | undefined;
  itemName(itemId: string): string;
  beastTypeName(id: string): string;
}

/** 배우는 조건의 종류 */
export type ReqKind = 'class' | 'slots' | 'level' | 'abilityLevel' | 'gold' | 'item' | 'requires' | 'stat' | 'beastType';

/** 배우는 조건 하나의 상태 */
export interface ReqStatus {
  kind: ReqKind;
  /** 화면에 보일 조건 (예: "레벨 12 이상", "강타 숙련도 30 이상", "늑대 가죽 3개") */
  label: string;
  met: boolean;
  /** 관련된 기술·아이템·능력치·계통 id (화면에서 강조할 때) */
  id?: string;
  /** 지금 값 (숫자 조건만, 선수과목은 배웠을 때의 숙련도) */
  have?: number;
  /** 필요한 값 (숫자 조건만) */
  need?: number;
}

/** 기술 하나를 지금 배울 수 있는지 */
export interface LearnStatus {
  /** 이미 배웠는지 */
  learned: boolean;
  /** 지금 배울 수 있는지 (배웠으면 false) */
  learnable: boolean;
  /** 배울 수 없는 첫 번째 이유 (배울 수 있으면 없음) */
  reason?: string;
  /**
   * 조건마다 하나: 레벨/어빌 → 골드(0이면 없음) → 재료 → 선수과목 → 능력치 → 수인 계통 순서.
   * 지금 직업의 트리가 아니거나('class') 더 배울 자리가 없으면('slots') 그 항목이 맨 앞에 붙습니다.
   */
  reqs: ReqStatus[];
}

/**
 * treeClass 직업 트리의 칸 node 를 지금 배울 수 있는지 확인합니다 (서버·클라이언트 공용, 값을 바꾸지 않음).
 * 평민 트리의 기술은 누구나, 다른 트리는 지금 직업의 것만 배울 수 있습니다.
 */
export function learnStatus(treeClass: ClassId, node: SkillTreeNode, ctx: LearnContext): LearnStatus {
  const reqs: ReqStatus[] = [];
  const def = ctx.ability(node.ability);
  const learned = ctx.learned(node.ability);
  if (treeClass !== 'peasant' && treeClass !== ctx.classId) reqs.push({ kind: 'class', label: '지금 직업의 기술이 아님', met: false });
  if (!learned && def && ctx.learnedCount(def.kind) >= MAX_ABILITIES)
    reqs.push({ kind: 'slots', label: `${def.kind === 'skill' ? '기술' : '마법'}은 ${MAX_ABILITIES}개까지`, met: false });
  if (node.level !== undefined) reqs.push({ kind: 'level', label: `레벨 ${node.level} 이상`, met: ctx.level >= node.level, have: ctx.level, need: node.level });
  if (node.abilityLevel !== undefined)
    reqs.push({ kind: 'abilityLevel', label: `어빌 ${node.abilityLevel} 이상`, met: ctx.abilityLevel >= node.abilityLevel, have: ctx.abilityLevel, need: node.abilityLevel });
  if (node.gold > 0) reqs.push({ kind: 'gold', label: `${formatNumber(node.gold)} 골드`, met: ctx.gold >= node.gold, have: ctx.gold, need: node.gold });
  for (const it of node.items) {
    const have = ctx.itemCount(it.item);
    reqs.push({ kind: 'item', id: it.item, label: `${ctx.itemName(it.item)} ${formatNumber(it.qty)}개`, met: have >= it.qty, have, need: it.qty });
  }
  for (const r of node.requires) {
    const name = ctx.ability(r.ability)?.name ?? r.ability;
    const has = ctx.learned(r.ability);
    const prof = has ? ctx.prof(r.ability) : undefined;
    reqs.push({
      kind: 'requires',
      id: r.ability,
      label: r.prof > 0 ? `${name} 숙련도 ${r.prof} 이상` : `${name} 배움`,
      met: has && (prof ?? 0) >= r.prof,
      ...(prof !== undefined ? { have: prof } : {}),
      need: r.prof,
    });
  }
  for (const k of STAT_KEYS) {
    const need = node.stats?.[k];
    if (need === undefined) continue;
    reqs.push({ kind: 'stat', id: k, label: `${STAT_NAMES[k]} ${need} 이상`, met: ctx.stats[k] >= need, have: ctx.stats[k], need });
  }
  if (node.beastType !== undefined)
    reqs.push({ kind: 'beastType', id: node.beastType, label: `${ctx.beastTypeName(node.beastType)} 계통`, met: ctx.beastType === node.beastType });
  if (learned) return { learned, learnable: false, reason: '이미 배웠습니다.', reqs };
  if (!def) return { learned, learnable: false, reason: '알 수 없는 기술입니다.', reqs };
  const unmet = reqs.find((r) => !r.met);
  if (!unmet) return { learned, learnable: true, reqs };
  return { learned, learnable: false, reason: reqReason(unmet), reqs };
}

function reqReason(r: ReqStatus): string {
  switch (r.kind) {
    case 'class':
      return '지금 직업의 기술만 배울 수 있습니다.';
    case 'slots':
      return `더 배울 자리가 없습니다. (${r.label})`;
    case 'requires':
      return `선수과목이 필요합니다: ${r.label}`;
    default:
      return `조건이 모자랍니다: ${r.label}`;
  }
}

// ───────────────────────── 관리자 편집기 API 형식 ─────────────────────────
// 경로는 src/server/admin/design.ts 머리 주석을 보세요. 몸통(파일 쓰기·판 기록·바로 반영)은 관리자 트랙이 구현합니다.

/** 설계 검사에서 나온 문제 하나 */
export interface DesignIssue {
  /** 'error' 는 저장·서버 시작을 막고, 'warn' 은 알리기만 합니다 */
  level: 'error' | 'warn';
  /** 어느 파일의 어디 (예: "skilltrees.json(warrior/w_whirl)", "progression.json(ascend.conditions.warrior[3])") */
  where: string;
  /** 한국어 설명 */
  msg: string;
}

/** 편집기에서 고칠 수 있는 기술 값 (abilities.json 에 씀). 가격·필요 레벨은 스킬트리 노드(gold, level/abilityLevel)에서 고칩니다 */
export interface AbilityPatch {
  id: string;
  name?: string;
  desc?: string;
  mp?: number;
  cooldownMs?: number;
}

/** GET /api/admin/design 의 응답 */
export interface DesignBundle {
  ok: true;
  /** 지금 설계 파일들의 판 표시 (내용의 해시). 저장할 때 같이 보내, 그사이 다른 사람이 바꿨으면 409 로 거절 */
  rev: string;
  skillTrees: SkillTreesConfig;
  progression: ProgressionConfig;
  /** 몬스터 전용을 뺀 기술 전체 */
  abilities: AbilityDef[];
  /** 재료·조건에 고를 수 있는 아이템 */
  items: Pick<ItemDef, 'id' | 'name' | 'type'>[];
  classes: { id: ClassId; name: string; color: string; tier: ClassTier }[];
  /** 서버 최대 레벨 */
  maxLevel: number;
  /** 능력치 최대 */
  statCap: number;
  /** 지금 설계의 경고 (오류는 저장되지 않으므로 없음) */
  warnings: DesignIssue[];
}

/** PUT /api/admin/design/skilltree/:classId 의 본문 */
export interface SkillTreeSaveBody {
  rev: string;
  tree: SkillTreeConfig;
  /** 이 직업 기술의 이름·설명·마나·재사용 대기 수정 (선택) */
  abilities?: AbilityPatch[];
  /** true 면 검사만 하고 저장하지 않음 */
  dryRun?: boolean;
}

/** PUT /api/admin/design/progression 의 본문 */
export interface ProgressionSaveBody {
  rev: string;
  progression: ProgressionConfig;
  dryRun?: boolean;
}

/** POST /api/admin/design/restore 의 본문: 판 기록 id 의 설계로 되돌림 (지금 판도 기록에 남김) */
export interface DesignRestoreBody {
  id: string;
  rev: string;
}

/** 저장·되돌리기의 응답 (검사 오류면 HTTP 400, 판이 어긋나면 409) */
export interface DesignSaveResult {
  ok: boolean;
  msg: string;
  /** 검사 결과 (오류와 경고) */
  issues: DesignIssue[];
  /** 저장 뒤의 판 표시 (실패하면 지금 판) */
  rev: string;
}

/** data/design-history/<id>.json 하나 = 저장하기 직전의 설계 파일들 */
export interface DesignHistoryEntry {
  /** 파일 이름에서 .json 을 뺀 것 (시각-종류[-직업], 예: "1761000000000-skilltree-warrior") */
  id: string;
  /** 저장한 시각 (ms) */
  at: number;
  /** 누가 (관리자 감사 기록의 actor 와 같은 형식, 예: "web(127.0.0.1)") */
  actor: string;
  kind: 'skilltree' | 'progression' | 'restore';
  /** 스킬트리 저장이면 그 직업 */
  classId?: ClassId;
  /** 한 줄 요약 */
  summary: string;
}

/** GET /api/admin/design/history 의 응답 (새것부터) */
export interface DesignHistoryList {
  ok: true;
  entries: DesignHistoryEntry[];
}
