// 관리자 "직업·스킬트리" 편집기 전용 형식. 계약(src/shared/progression.ts 의 "관리자 편집기 API 형식")에 덧붙인 것입니다.
//  - PUT /api/admin/design: 편집기가 바꾼 곳(여러 직업의 트리 + 성장 규칙 + 기술 값)을 한 번에 검사·저장합니다.
//    직업 하나·성장 규칙 하나씩 저장하는 계약의 경로와 같은 검사·같은 저장 순서를 거치며, 여러 곳을 고쳤을 때
//    순서 때문에 생기는 거짓 오류(새 수인 계통을 쓰는 트리와 그 계통을 더하는 성장 규칙 같은)가 없습니다.
//  - GET /api/admin/design/history/:id: 판 기록 하나의 설계 (되돌리기 전에 무엇이 바뀌는지 보여 줄 때)
//  - diffDesign: 두 설계의 바뀐 곳을 사람이 읽을 줄로. 서버(판 기록·작업 기록의 한 줄 요약)와 편집기(저장 전 확인,
//    되돌리기 미리보기)가 같이 씁니다.
import type { ClassId } from './constants';
import { CLASS_IDS, STAT_KEYS, STAT_NAMES } from './constants';
import {
  FIRST_CLASSES,
  SECOND_CLASSES,
  classTier,
  type AbilityPatch,
  type Condition,
  type DesignHistoryEntry,
  type ProgressionConfig,
  type SkillTreeConfig,
  type SkillTreeNode,
  type SkillTreesConfig,
} from './progression';

/** PUT /api/admin/design 의 본문: 바꾼 곳만 보냅니다 (주지 않은 부분은 지금 값 그대로) */
export interface DesignSaveBody {
  /** GET /api/admin/design 이나 앞선 저장에서 받은 판 표시. 저장할 때 서버의 판과 다르면 409 */
  rev: string;
  /** 바꾼 직업의 트리들 */
  skillTrees?: Partial<Record<ClassId, SkillTreeConfig>>;
  /** 바꾼 성장 규칙 (통째로) */
  progression?: ProgressionConfig;
  /** 기술의 이름·설명·마나·재사용 대기 수정 */
  abilities?: AbilityPatch[];
  /**
   * true 면 검사만 합니다 (편집기의 실시간 검사). 판이 달라도 검사는 하고 응답의 rev 로 서버의 판을 알려 주며,
   * 설계에 오류가 있어도 HTTP 200 에 ok: false 와 문제 목록으로 답합니다 (요청 자체는 성공이므로).
   */
  dryRun?: boolean;
}

/** 판 기록에 남기는 기술 값: 편집기에서 고치는 값 + 트리에서 맞춰 쓰는 기본값(level·price) */
export interface AbilitySnapshot {
  id: string;
  name: string;
  desc: string;
  mp: number;
  cooldownMs: number;
  level: number;
  price: number;
}

/** 설계 한 판 (판 기록 파일의 design: 그 저장 바로 전에 게임이 쓰던 설계) */
export interface DesignSnapshot {
  progression: ProgressionConfig;
  skillTrees: SkillTreesConfig;
  abilities: AbilitySnapshot[];
}

/** GET /api/admin/design/history/:id 의 응답 */
export interface DesignHistoryDetail {
  ok: true;
  entry: DesignHistoryEntry;
  design: DesignSnapshot;
}

/** 편집기 API 의 한계 (요청 크기, 판 기록 개수) */
export const DESIGN_LIMITS = {
  /** 요청 본문 최대 바이트 (모든 직업의 트리와 성장 규칙을 한 번에 보내도 넉넉함) */
  body: 256 * 1024,
  /** 한 번에 고칠 수 있는 기술 수 */
  patches: 400,
  /** data/design-history/ 에 남기는 판 수 (넘으면 오래된 것부터 지움) */
  historyKeep: 200,
  /** 판 기록 목록에 보여 주는 수 (새것부터) */
  historyList: 100,
} as const;

/** 판 기록 id: <시각(ms)>-<종류>[-<직업>] */
export const HISTORY_ID = /^(\d{13})-(skilltree|progression|restore)(?:-([a-z]+))?$/;

// ───────────────────────── 바뀐 곳 요약 ─────────────────────────

/** 바뀐 곳 하나 */
export interface DesignChange {
  /** 어디가: 직업 트리, 성장 규칙, 기술 값 */
  area: 'tree' | 'progression' | 'ability';
  /** 트리·기술이면 그 직업 */
  classId?: ClassId;
  /** 사람이 읽을 한 줄 (예: "전사 트리: 회오리 베기 조건 (레벨 12→15)") */
  label: string;
}

/** 요약에 쓰는 이름 찾기 */
export interface DiffNames {
  className(id: ClassId): string;
  abilityName(id: string): string;
  itemName(id: string): string;
}

/** 비교할 설계 (기술 값은 편집기에서 고치는 것만 봄) */
export interface DesignLike {
  progression: ProgressionConfig;
  skillTrees: { trees: Record<ClassId, SkillTreeConfig> };
  abilities: Pick<AbilitySnapshot, 'id' | 'name' | 'desc' | 'mp' | 'cooldownMs'>[];
}

/** 항목 순서와 상관없이 같은 값이면 같은 글자가 되는 JSON (비교용) */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** 노드의 배우는 조건이 어떻게 바뀌었는지 (짧게) */
function nodeReqDiff(a: SkillTreeNode, b: SkillTreeNode, n: DiffNames, tier: number): string[] {
  const out: string[] = [];
  const lvA = tier === 2 ? a.abilityLevel : a.level;
  const lvB = tier === 2 ? b.abilityLevel : b.level;
  if (lvA !== lvB) out.push(`${tier === 2 ? '어빌' : '레벨'} ${lvA ?? '-'}→${lvB ?? '-'}`);
  if (a.gold !== b.gold) out.push(`골드 ${a.gold}→${b.gold}`);
  if (!same(a.items ?? [], b.items ?? [])) out.push(`재료 ${(b.items ?? []).map((x) => `${n.itemName(x.item)}×${x.qty}`).join('·') || '없음'}`);
  if (!same(a.requires ?? [], b.requires ?? []))
    out.push(`선수과목 ${(b.requires ?? []).map((x) => `${n.abilityName(x.ability)} ${x.prof}`).join('·') || '없음'}`);
  if (!same(a.stats ?? {}, b.stats ?? {}))
    out.push(
      `능력치 ${
        STAT_KEYS.filter((k) => b.stats?.[k] !== undefined)
          .map((k) => `${STAT_NAMES[k]} ${b.stats![k]}`)
          .join('·') || '없음'
      }`,
    );
  if ((a.beastType ?? null) !== (b.beastType ?? null)) out.push(`계통 ${b.beastType ?? '없음'}`);
  return out;
}

/** 트리 하나의 바뀐 곳 */
function treeDiff(classId: ClassId, a: SkillTreeConfig | undefined, b: SkillTreeConfig | undefined, n: DiffNames): DesignChange[] {
  const out: DesignChange[] = [];
  const tree = `${n.className(classId)} 트리`;
  const push = (label: string) => out.push({ area: 'tree', classId, label: `${tree}: ${label}` });
  const an = new Map((a?.nodes ?? []).map((x) => [x.ability, x]));
  const bn = new Map((b?.nodes ?? []).map((x) => [x.ability, x]));
  const tier = classTier(classId);
  for (const [id, x] of bn) {
    const y = an.get(id);
    if (!y) {
      push(`${n.abilityName(id)} 넣음`);
      continue;
    }
    const req = nodeReqDiff(y, x, n, tier);
    if (req.length) push(`${n.abilityName(id)} 조건 (${req.join(', ')})`);
    if (y.row !== x.row || y.col !== x.col) push(`${n.abilityName(id)} 자리 (줄 ${y.row}·칸 ${y.col} → 줄 ${x.row}·칸 ${x.col})`);
  }
  for (const id of an.keys()) if (!bn.has(id)) push(`${n.abilityName(id)} 뺌`);
  if (!same(a?.columns ?? [], b?.columns ?? [])) push(`열 제목 (${(b?.columns ?? []).join('·') || '없음'})`);
  return out;
}

/** 직업별 항목이 바뀐 직업들 (예: "전사·도적") */
function changedClasses<K extends ClassId>(keys: readonly K[], a: Record<K, unknown>, b: Record<K, unknown>, n: DiffNames): string {
  return keys
    .filter((k) => !same(a[k], b[k]))
    .map((k) => n.className(k))
    .join('·');
}

/** 성장 규칙의 바뀐 곳 */
function progressionDiff(a: ProgressionConfig, b: ProgressionConfig, n: DiffNames): DesignChange[] {
  const out: DesignChange[] = [];
  const push = (label: string) => out.push({ area: 'progression', label });
  const cond = (list: Condition[] | undefined) => list ?? [];
  const r1 = a.rebirth;
  const r2 = b.rebirth;
  if (r1.level !== r2.level || r1.restartLevel !== r2.restartLevel)
    push(`전직 레벨 (${r1.level}→${r2.level}, 다시 시작 ${r1.restartLevel}→${r2.restartLevel})`);
  if (r1.allowAfterAscend !== r2.allowAfterAscend) push(`승급 뒤 전직 ${r2.allowAfterAscend ? '허용' : '금지'}`);
  if (!same(r1.names, r2.names)) push(`전직 이름 (${changedClasses(FIRST_CLASSES, r1.names, r2.names, n)})`);
  if (!same(r1.targets, r2.targets)) push(`전직해 갈 수 있는 직업 (${changedClasses(FIRST_CLASSES, r1.targets, r2.targets, n)})`);
  const rc = FIRST_CLASSES.filter((c) => !same(cond(r1.conditions[c]), cond(r2.conditions[c])));
  if (rc.length) push(`전직 조건 (${rc.map((c) => n.className(c)).join('·')})`);
  const s1 = a.ascend;
  const s2 = b.ascend;
  if (s1.level !== s2.level) push(`승급 레벨 ${s1.level}→${s2.level}`);
  if (s1.title !== s2.title) push(`승급 칭호 ${s1.title}→${s2.title}`);
  if (!same(s1.expTrade, s2.expTrade)) push(`경험치 교환 (${s2.expTrade.exp} → 체력 ${s2.expTrade.hp} / 마나 ${s2.expTrade.mp})`);
  if (!same(s1.hpToStat, s2.hpToStat)) push(`체력→능력치 교환 (체력 ${s2.hpToStat.hp} → ${s2.hpToStat.stat})`);
  const ac = FIRST_CLASSES.filter((c) => !same(cond(s1.conditions[c]), cond(s2.conditions[c])));
  if (ac.length) push(`승급 조건 (${ac.map((c) => n.className(c)).join('·')})`);
  if (!same(a.second.from, b.second.from)) push(`2차 전직 연결 (${changedClasses(SECOND_CLASSES, a.second.from, b.second.from, n)})`);
  const sc = SECOND_CLASSES.filter((c) => !same(cond(a.second.conditions[c]), cond(b.second.conditions[c])));
  if (sc.length) push(`2차 전직 조건 (${sc.map((c) => n.className(c)).join('·')})`);
  if (!same(a.second.beastTypes, b.second.beastTypes)) push(`수인 계통 (${b.second.beastTypes.map((x) => x.name).join('·')})`);
  if (!same(a.ability, b.ability)) push('어빌리티 규칙');
  if (!same(a.proficiency, b.proficiency)) push('숙련도 규칙');
  return out;
}

/** 두 설계의 바뀐 곳: 직업 순서대로 트리 → 기술 값 → 성장 규칙 */
export function diffDesign(a: DesignLike, b: DesignLike, n: DiffNames, classOf: (abilityId: string) => ClassId | undefined = () => undefined): DesignChange[] {
  const out: DesignChange[] = [];
  for (const c of CLASS_IDS) if (!same(a.skillTrees.trees[c], b.skillTrees.trees[c])) out.push(...treeDiff(c, a.skillTrees.trees[c], b.skillTrees.trees[c], n));
  const before = new Map(a.abilities.map((x) => [x.id, x]));
  for (const x of b.abilities) {
    const y = before.get(x.id);
    if (!y) continue;
    const parts: string[] = [];
    if (y.name !== x.name) parts.push(`이름 ${y.name}→${x.name}`);
    if (y.desc !== x.desc) parts.push('설명');
    if (y.mp !== x.mp) parts.push(`마나 ${y.mp}→${x.mp}`);
    if (y.cooldownMs !== x.cooldownMs) parts.push(`재사용 ${y.cooldownMs / 1000}초→${x.cooldownMs / 1000}초`);
    const classId = classOf(x.id);
    if (parts.length) out.push({ area: 'ability', ...(classId ? { classId } : {}), label: `${x.name}: ${parts.join(', ')}` });
  }
  if (!same(a.progression, b.progression)) out.push(...progressionDiff(a.progression, b.progression, n));
  return out;
}

/** 바뀐 곳들을 한 줄로 (판 기록·작업 기록) */
export function summarizeChanges(list: readonly DesignChange[], max = 4): string {
  if (list.length === 0) return '바뀐 것 없음';
  const shown = list.slice(0, max).map((c) => c.label);
  const s = shown.join(' / ') + (list.length > max ? ` 외 ${list.length - max}건` : '');
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}
