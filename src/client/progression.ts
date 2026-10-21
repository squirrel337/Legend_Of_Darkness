// 성장 체계의 화면 계산 (DOM 없이, test/client-progression.test.ts 가 확인):
// 클라이언트 상태로 만든 배우기 조건(LearnContext), 숙련도 표시, 길드장 배우기 창의 조건 설명,
// 스킬트리 창(K)의 탭·칸 배치·선수과목 선, HUD·캐릭터 창의 성장 글씨. 규칙은 docs/progression.md
import { CLASS_IDS, formatNumber, type ClassId } from '../shared/constants';
import {
  isFirstClass,
  isSecondClass,
  learnStatus,
  profEffect,
  profGainChance,
  type BeastTypeDef,
  type LearnContext,
  type LearnPrereq,
  type LearnStatus,
  type ProficiencyConfig,
  type PublicProgression,
  type ReqStatus,
  type SkillTreeConfig,
  type SkillTreeNode,
} from '../shared/progression';
import type { InvSlot, LearnEntry, SelfState } from '../shared/protocol';
import { detourPoints, pathHits, roundedPath, type Box, type Pt } from '../shared/tree-route';
import type { AbilityDef, ItemDef } from '../shared/types';

// ───────────────────────── 배우기 조건 (서버와 같은 learnStatus) ─────────────────────────

/** 배우기 조건을 확인할 때 쓰는 클라이언트 상태 (ClientState 가 이 모양을 채움) */
export interface LearnSource {
  self: Pick<SelfState, 'classId' | 'level' | 'abilityLevel' | 'base' | 'beastType' | 'prof'>;
  gold: number;
  skills: readonly string[];
  spells: readonly string[];
  inventory: readonly (InvSlot | null)[];
  abilities: ReadonlyMap<string, Pick<AbilityDef, 'name' | 'kind'>>;
  items: ReadonlyMap<string, Pick<ItemDef, 'name'>>;
  beastTypes: readonly BeastTypeDef[];
}

/** 소지품에 있는 이 아이템의 개수 (서버의 countItem 과 같음: 장비·창고는 세지 않음) */
export function countItems(inventory: readonly (InvSlot | null)[], itemId: string): number {
  let n = 0;
  for (const s of inventory) if (s && s.item === itemId) n += s.qty;
  return n;
}

/**
 * 서버의 learnContextOf 와 같은 값을 SelfState·소지품에서 만듭니다.
 * 길드장 창과 스킬트리 창(K)이 이것으로 learnStatus 를 불러, 화면의 판정이 서버와 어긋나지 않습니다.
 */
export function clientLearnContext(s: LearnSource): LearnContext {
  const learned = new Set([...s.skills, ...s.spells]);
  return {
    classId: s.self.classId,
    level: s.self.level,
    abilityLevel: s.self.abilityLevel,
    gold: s.gold,
    stats: s.self.base,
    beastType: s.self.beastType,
    learnedCount: (kind) => (kind === 'skill' ? s.skills : s.spells).length,
    learned: (id) => learned.has(id),
    prof: (id) => s.self.prof[id] ?? 0,
    itemCount: (id) => countItems(s.inventory, id),
    ability: (id) => s.abilities.get(id),
    itemName: (id) => s.items.get(id)?.name ?? id,
    beastTypeName: (id) => beastTypeName(id, s.beastTypes),
  };
}

/**
 * 길드장 창 목록 (서버 progression.ts 의 learnEntries 와 같은 순서·값): classId 트리의 기술마다 배우는 조건의 상태,
 * 필요 레벨(어빌) → 줄 → 칸 순서. 기술 정의를 모르는 칸은 뺍니다.
 */
export function learnEntriesFor(classId: ClassId, tree: SkillTreeConfig, ctx: LearnContext): LearnEntry[] {
  const need = (n: { level?: number; abilityLevel?: number }) => n.abilityLevel ?? n.level ?? 0;
  return tree.nodes
    .filter((n) => ctx.ability(n.ability) !== undefined)
    .sort((a, b) => need(a) - need(b) || a.row - b.row || a.col - b.col)
    .map((n) => {
      const s = learnStatus(classId, n, ctx);
      return {
        id: n.ability,
        level: n.level ?? 0,
        abilityLevel: n.abilityLevel ?? 0,
        price: n.gold,
        learned: s.learned,
        learnable: s.learnable,
        ...(s.reason !== undefined ? { reason: s.reason } : {}),
        reqs: s.reqs,
      };
    });
}

/**
 * 열린 길드장 창의 목록을 지금 클라이언트 상태로 다시 만듭니다 (창이 열린 채로 골드·재료·숙련도·설계가 바뀔 때).
 * 트리를 알면 트리에서 다시 만들고(설계에서 빠진 기술은 사라지고 새 기술이 보임), 모르면 서버가 보낸 목록 그대로.
 */
export function refreshLearnEntries(classId: ClassId, list: readonly LearnEntry[], tree: SkillTreeConfig | undefined, ctx: LearnContext): LearnEntry[] {
  return tree ? learnEntriesFor(classId, tree, ctx) : [...list];
}

/** 채우지 못한 조건 옆에 붙일 지금 값: "지금 8", "2/3개", "배우지 않음" (채웠으면 빈 문자열) */
export function reqDetail(r: ReqStatus): string {
  if (r.met) return '';
  switch (r.kind) {
    case 'level':
    case 'abilityLevel':
    case 'stat':
      return r.have !== undefined ? `지금 ${formatNumber(r.have)}` : '';
    case 'gold':
      return r.have !== undefined ? `가진 골드 ${formatNumber(r.have)}` : '';
    case 'item':
      return `${formatNumber(r.have ?? 0)}/${formatNumber(r.need ?? 0)}개`;
    case 'requires':
      return r.have === undefined ? '배우지 않음' : `지금 ${formatNumber(r.have)}`;
    default:
      return '';
  }
}

/** 조건 한 줄: "강타 숙련도 30 이상 (지금 12)" */
export function reqText(r: ReqStatus): string {
  const d = reqDetail(r);
  return d ? `${r.label} (${d})` : r.label;
}

/** 배우는 곳 (평민 트리는 수련장, 다른 트리는 그 직업의 길드장. 2차 직업의 스승도 마을에서는 길드장) */
export function teacherOf(treeClass: ClassId, className: string): string {
  return treeClass === 'peasant' ? '수련장 관리인' : `${className} 길드장`;
}

// ───────────────────────── 숙련도 ─────────────────────────

export interface ProfInfo {
  prof: number;
  max: number;
  /** 0 ~ 1 (막대 길이) */
  ratio: number;
  /** 위력·상태 이상 확률 배율 (%) */
  effectPct: number;
  /** 한 번 쓸 때 1 오를 확률 (%, 최대면 0) */
  chancePct: number;
  maxed: boolean;
}

export function profInfo(prof: number, c: ProficiencyConfig): ProfInfo {
  const p = Math.max(0, Math.min(c.max, Math.floor(prof)));
  return {
    prof: p,
    max: c.max,
    ratio: c.max > 0 ? p / c.max : 1,
    effectPct: Math.round(profEffect(p, c) * 100),
    chancePct: Math.round(profGainChance(p, c) * 1000) / 10,
    maxed: p >= c.max,
  };
}

/** "숙련도 45 / 100 · 위력 90%" */
export function profLine(prof: number, c: ProficiencyConfig): string {
  const i = profInfo(prof, c);
  return `숙련도 ${i.prof} / ${i.max} · 위력 ${i.effectPct}%`;
}

/** 다음에 쓸 때 오를 확률 안내 (최대면 그렇다고) */
export function profChanceLine(prof: number, c: ProficiencyConfig): string {
  const i = profInfo(prof, c);
  return i.maxed ? '숙련도가 최대입니다.' : `한 번 쓸 때 숙련도가 오를 확률 ${i.chancePct}%`;
}

// ───────────────────────── 스킬트리 창 (K) ─────────────────────────

/**
 * 스킬트리 창의 탭: 지금 직업 → (2차 직업이면) 2차 전직해 온 1차 직업 → 배운 기술이 있는 다른 직업(전직 전 직업) → 평민.
 * 2차 전직해 온 직업은 저장하지 않으므로, 갈 수 있는 1차 직업이 하나뿐일 때만 그 직업을 넣고(기본 설정),
 * 여럿이면 배운 기술이 있는 직업만 넣습니다. 트리가 없는 직업은 뺍니다.
 */
export function treeTabs(
  classId: ClassId,
  learned: (abilityId: string) => boolean,
  trees: Partial<Record<ClassId, SkillTreeConfig>>,
  secondFrom: Partial<Record<ClassId, readonly ClassId[]>>,
): ClassId[] {
  const out: ClassId[] = [];
  const add = (c: ClassId) => {
    if (!out.includes(c) && trees[c]) out.push(c);
  };
  add(classId);
  const from = isSecondClass(classId) ? (secondFrom[classId] ?? []) : [];
  if (from.length === 1) add(from[0]!);
  for (const c of CLASS_IDS) {
    if (c === 'peasant' || !trees[c]) continue;
    if (trees[c]!.nodes.some((n) => learned(n.ability))) add(c);
  }
  if ((trees.peasant?.nodes.length ?? 0) > 0) add('peasant');
  return out;
}

/**
 * 스킬트리 창 위의 안내 한 줄: 평민 트리, 지금 직업이 아닌 트리(전직·2차 전직으로 배울 수 있게 되는지), 수인 계통.
 * 안내할 것이 없으면 빈 문자열.
 */
export function treeNote(
  viewed: ClassId,
  self: Pick<SelfState, 'classId' | 'beastType' | 'ascended'>,
  prog: Pick<PublicProgression, 'rebirth' | 'second'>,
  tree: SkillTreeConfig,
  className: (c: ClassId) => string,
): string {
  const hasBeast = tree.nodes.some((n) => n.beastType !== undefined);
  const names = prog.second.beastTypes.map((b) => b.name).join('·');
  const cur = self.classId;
  if (viewed === 'peasant') return '평민 기술은 누구나 수련장 관리인에게서 배웁니다.';
  if (viewed !== cur) {
    let how = '';
    // 전직(무도가는 환골탈태)으로 그 직업이 될 수 있으면, 승급한 1차 직업이 2차 전직으로 갈 수 있으면 그 길을 알려 줌
    const canRebirth = !self.ascended || prog.rebirth.allowAfterAscend;
    if (isFirstClass(cur) && isFirstClass(viewed) && canRebirth && (prog.rebirth.targets[cur] ?? []).includes(viewed))
      how = ` ${className(viewed)}(으)로 ${prog.rebirth.names[cur] ?? '전직'}하면 배울 수 있습니다.`;
    else if (isFirstClass(cur) && isSecondClass(viewed) && (prog.second.from[viewed] ?? []).includes(cur))
      how = ` ${self.ascended ? '' : '승급한 뒤 '}${className(viewed)}(으)로 2차 전직하면 배울 수 있습니다.`;
    const beast = hasBeast ? ` 수인은 2차 전직 때 ${names} 중 한 계통을 고릅니다.` : '';
    return `지금 직업의 기술이 아니라 배울 수 없습니다.${how} 이미 배운 기술은 그대로 쓸 수 있습니다.${beast}`;
  }
  if (hasBeast && self.beastType === null) return `아직 수인 계통을 고르지 않았습니다. 2차 직업 인도자에게서 ${names} 중 하나를 고르면 그 계통의 기술을 배울 수 있습니다.`;
  if (hasBeast && self.beastType) return `${beastTypeName(self.beastType, prog.second.beastTypes)} 계통입니다. 다른 계통의 기술은 배울 수 없습니다.`;
  return '';
}

/** 칸 크기 (px). 창의 CSS(.gt-node 등)와 같아야 합니다 */
export const TREE_NODE = 44;
export const TREE_COL_W = 96;
export const TREE_ROW_H = 76;
export const TREE_GUTTER = 54;
export const TREE_HEAD_H = 26;
export const TREE_PAD = 14;
/** 칸 아래 이름표까지의 높이 */
export const TREE_LABEL_H = 20;

export interface TreeCell {
  node: SkillTreeNode;
  /** 칸(아이콘) 왼쪽 위 */
  x: number;
  y: number;
}

/** 같은 트리 안의 선수과목 선: from(먼저 배울 기술) → to */
export interface TreeEdge {
  from: string;
  to: string;
  /** 필요 숙련도 (0 이면 배우기만) */
  prof: number;
  /** SVG path */
  d: string;
  /** 필요 숙련도 표시 자리 */
  badge: { x: number; y: number };
}

export interface TreeLayout {
  width: number;
  height: number;
  cols: number;
  /** 왼쪽 줄 표시: 그 줄의 가장 낮은 필요 레벨("Lv12") 또는 필요 어빌("어빌 5") */
  rows: { row: number; y: number; label: string }[];
  /** 위의 열 제목 (제목이 하나도 없으면 빈 배열). beastType 은 그 열이 한 수인 계통 전용일 때 */
  heads: { col: number; x: number; title: string; beastType?: string }[];
  cells: TreeCell[];
  edges: TreeEdge[];
  /** 다른 트리에 있는 선수과목 (칸 귀퉁이에 작게 표시) */
  external: Record<string, LearnPrereq[]>;
}

/** 한 수인 계통 전용인 열: 열의 기술이 모두 같은 beastType 이면 그 계통 */
export function beastColumns(tree: SkillTreeConfig): Map<number, string> {
  const by = new Map<number, (string | undefined)[]>();
  for (const n of tree.nodes) {
    const list = by.get(n.col) ?? [];
    list.push(n.beastType);
    by.set(n.col, list);
  }
  const out = new Map<number, string>();
  for (const [col, types] of by) {
    const first = types[0];
    if (first !== undefined && types.every((t) => t === first)) out.set(col, first);
  }
  return out;
}

/** 3차 베지어 곡선 위의 점 (t: 0 ~ 1) */
export function bezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * 선수과목 선: 위 줄의 칸이면 아래 가운데에서 이 칸 위 가운데로 휘어 내려오고, 같은 줄이면 옆면끼리,
 * (편집기에서 거꾸로 놓은) 아래 줄의 칸이면 위 가운데에서 이 칸 아래로 올라갑니다.
 * 이 곡선이 다른 칸을 지나가면 layoutTree 가 detourGeometry 로 바꿉니다.
 */
export function edgeGeometry(a: { x: number; y: number }, b: { x: number; y: number }, node = TREE_NODE): { d: string; badge: { x: number; y: number } } {
  const r = (v: number) => Math.round(v * 10) / 10;
  const half = node / 2;
  if (a.y === b.y) {
    const leftToRight = a.x < b.x;
    const p0 = { x: leftToRight ? a.x + node : a.x, y: a.y + half };
    const p3 = { x: leftToRight ? b.x : b.x + node, y: b.y + half };
    return { d: `M ${r(p0.x)} ${r(p0.y)} L ${r(p3.x)} ${r(p3.y)}`, badge: { x: r((p0.x + p3.x) / 2), y: r(p0.y - 9) } };
  }
  const down = a.y < b.y;
  // 위 줄 → 아래 줄: 이름표 밑에서 출발 (선이 이름을 가로지르지 않게)
  const p0 = { x: a.x + half, y: down ? a.y + node + TREE_LABEL_H - 4 : a.y };
  const p3 = { x: b.x + half, y: down ? b.y : b.y + node + TREE_LABEL_H - 4 };
  const bend = (p3.y - p0.y) / 2;
  const p1 = { x: p0.x, y: p0.y + bend };
  const p2 = { x: p3.x, y: p3.y - bend };
  const m = bezierPoint(p0, p1, p2, p3, 0.72);
  return {
    d: `M ${r(p0.x)} ${r(p0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(p3.x)} ${r(p3.y)}`,
    badge: { x: r(m.x), y: r(m.y) },
  };
}

/** 줄 사이 틈의 가운데까지 (이름표 밑 ~ 다음 줄 칸 위) */
const TREE_GAP_MID = (TREE_ROW_H - TREE_NODE - TREE_LABEL_H) / 2;

/**
 * 곧은 곡선이 다른 칸에 걸릴 때 돌아가는 선: 출발 칸 밑의 줄 사이 틈 → 도착 칸 옆의 열 사이 길 → 도착 칸 위의 틈 → 도착 칸 위 가운데.
 * 틈과 길에는 칸이 없어 다른 칸을 지나지 않습니다. 필요 숙련도는 도착 칸 가까운 길 위(길이 없으면 틈 위)에.
 * 길은 도착 칸의 옆 중 출발 칸 쪽 (같은 열이면 side: 1 오른쪽, -1 왼쪽).
 * 같은 줄이면 줄 위의 틈으로, 아래 줄에서 위 줄로(편집기에서 거꾸로 놓은 경우)는 위아래를 바꿔 갑니다.
 */
export function detourGeometry(a: Pt, b: Pt, node = TREE_NODE, side: 1 | -1 = 1): { d: string; badge: Pt } {
  const half = node / 2;
  const ax = a.x + half;
  const bx = b.x + half;
  const bottom = (y: number) => y + node + TREE_LABEL_H - 4;
  let start: Pt;
  let end: Pt;
  let gapA: number;
  let gapB: number;
  if (a.y === b.y) {
    start = { x: ax, y: a.y };
    end = { x: bx, y: b.y };
    gapA = gapB = a.y - TREE_GAP_MID;
  } else if (a.y < b.y) {
    start = { x: ax, y: bottom(a.y) };
    end = { x: bx, y: b.y };
    gapA = a.y + node + TREE_LABEL_H + TREE_GAP_MID;
    gapB = b.y - TREE_GAP_MID;
  } else {
    start = { x: ax, y: a.y };
    end = { x: bx, y: bottom(b.y) };
    gapA = a.y - TREE_GAP_MID;
    gapB = b.y + node + TREE_LABEL_H + TREE_GAP_MID;
  }
  const lane = bx + (ax < bx ? -1 : ax > bx ? 1 : side) * (TREE_COL_W / 2);
  const d = roundedPath(detourPoints(start, gapA, end, gapB, lane), 6);
  const badge = gapA === gapB ? { x: (ax + bx) / 2, y: gapA } : { x: lane, y: gapB + (gapB > gapA ? -14 : 14) };
  return { d, badge: { x: Math.round(badge.x * 10) / 10, y: Math.round(badge.y * 10) / 10 } };
}

/** 선이 피해야 할 칸의 자리: 아이콘과 그 밑의 이름표 (이름표는 가운데 맞춤이라 아이콘보다 넓을 수 있음) */
function cellBoxes(c: TreeCell): Box[] {
  return [
    { x: c.x - 2, y: c.y - 2, w: TREE_NODE + 4, h: TREE_NODE + 4 },
    { x: c.x + TREE_NODE / 2 - 34, y: c.y + TREE_NODE, w: 68, h: TREE_LABEL_H - 3 },
  ];
}

/**
 * 스킬트리 창의 칸 배치. 비어 있는 줄은 접어서(순서는 그대로) 창이 길어지지 않게 하고, 열은 그대로 둡니다
 * (열 제목과 수인 계통 열이 편집기와 같은 자리에 있도록).
 */
export function layoutTree(tree: SkillTreeConfig): TreeLayout {
  const rowsUsed = [...new Set(tree.nodes.map((n) => n.row))].sort((a, b) => a - b);
  const rowIndex = new Map(rowsUsed.map((r, i) => [r, i]));
  const maxCol = tree.nodes.reduce((m, n) => Math.max(m, n.col), -1);
  const cols = Math.max(1, maxCol + 1, tree.columns?.length ?? 0);
  const beast = beastColumns(tree);
  const titled = (tree.columns ?? []).some((t) => t.trim() !== '') || beast.size > 0;
  const headH = titled ? TREE_HEAD_H : 0;
  const colX = (c: number) => TREE_GUTTER + c * TREE_COL_W + (TREE_COL_W - TREE_NODE) / 2;
  const rowY = (i: number) => TREE_PAD + headH + i * TREE_ROW_H;
  const cells: TreeCell[] = tree.nodes.map((node) => ({ node, x: colX(node.col), y: rowY(rowIndex.get(node.row) ?? 0) }));
  const at = new Map(cells.map((c) => [c.node.ability, c]));

  const rows = rowsUsed.map((row, i) => {
    const inRow = tree.nodes.filter((n) => n.row === row);
    const ab = inRow.map((n) => n.abilityLevel).filter((v): v is number => v !== undefined);
    const lv = inRow.map((n) => n.level).filter((v): v is number => v !== undefined);
    const label = ab.length ? `어빌 ${Math.min(...ab)}` : lv.length ? `Lv${Math.min(...lv)}` : '';
    return { row, y: rowY(i) + TREE_NODE / 2, label };
  });

  const heads: TreeLayout['heads'] = [];
  if (titled) {
    for (let c = 0; c < cols; c++) {
      const title = tree.columns?.[c]?.trim() ?? '';
      const bt = beast.get(c);
      if (!title && bt === undefined) continue;
      heads.push({ col: c, x: TREE_GUTTER + c * TREE_COL_W + TREE_COL_W / 2, title, ...(bt !== undefined ? { beastType: bt } : {}) });
    }
  }

  const edges: TreeEdge[] = [];
  const external: Record<string, LearnPrereq[]> = {};
  for (const c of cells) {
    for (const r of c.node.requires) {
      const from = at.get(r.ability);
      if (!from || from === c) {
        (external[c.node.ability] ??= []).push(r);
        continue;
      }
      // 곧은 곡선이 다른 칸(아이콘·이름표) 뒤로 지나가면 그 칸에서 나온 선처럼 보이므로, 칸이 없는 줄 사이 틈과
      // 열 사이 길로 돌아감 (같은 열에서 사이 칸을 건너뛸 때 포함, 길은 오른쪽이고 마지막 열이면 왼쪽)
      let g = edgeGeometry(from, c, TREE_NODE);
      const others = cells.filter((o) => o !== from && o !== c).flatMap(cellBoxes);
      if (pathHits(g.d, others)) g = detourGeometry(from, c, TREE_NODE, c.node.col < cols - 1 ? 1 : -1);
      edges.push({ from: r.ability, to: c.node.ability, prof: r.prof, d: g.d, badge: g.badge });
    }
  }

  const lastY = rowsUsed.length ? rowY(rowsUsed.length - 1) : TREE_PAD + headH;
  return {
    width: TREE_GUTTER + cols * TREE_COL_W + TREE_PAD,
    height: lastY + TREE_NODE + TREE_LABEL_H + TREE_PAD,
    cols,
    rows,
    heads,
    cells,
    edges,
    external,
  };
}

/** 칸의 모양: 배움 / 지금 배울 수 있음 / 잠김 */
export type NodeLook = 'learned' | 'learnable' | 'locked';

export function nodeLook(s: LearnStatus): NodeLook {
  return s.learned ? 'learned' : s.learnable ? 'learnable' : 'locked';
}

/**
 * 수인 계통 칸이 내 계통과 다른지 (내 계통을 이미 골랐을 때만). 다른 계통의 칸은 흐리게 그립니다.
 * 계통을 아직 고르지 않았으면(수인이 아니거나 고르기 전) 모든 갈래를 똑같이 보여 줍니다.
 */
export function otherBranch(beastType: string | undefined, mine: string | null): boolean {
  return beastType !== undefined && mine !== null && beastType !== mine;
}

// ───────────────────────── HUD · 캐릭터 창 ─────────────────────────

export function beastTypeName(id: string, types: readonly BeastTypeDef[]): string {
  return types.find((b) => b.id === id)?.name ?? id;
}

/** 직업 이름 (수인은 계통을 붙여 "포유류 수인") */
export function classLabel(className: string, self: Pick<SelfState, 'classId' | 'beastType'>, types: readonly BeastTypeDef[]): string {
  if (self.classId === 'beastkin' && self.beastType) return `${beastTypeName(self.beastType, types)} ${className}`;
  return className;
}

/** 이 직업이 거쳐 온 전직의 이름: 무도가(와 무도가에서 온 수인)는 환골탈태, 그 밖은 전직 */
export function rebirthWord(classId: ClassId, prog: Pick<PublicProgression, 'rebirth' | 'second'>): string {
  if (isFirstClass(classId)) return prog.rebirth.names[classId];
  if (isSecondClass(classId)) {
    const names = new Set((prog.second.from[classId] ?? []).map((f) => prog.rebirth.names[f]));
    if (names.size === 1) return [...names][0]!;
  }
  return '전직';
}

/** 성장 표시 조각: 칭호, 전직 횟수, 어빌 (없는 것은 뺌). 예: ["마스터", "전직 2회", "어빌 12"] */
export function growthParts(self: Pick<SelfState, 'classId' | 'title' | 'rebirths' | 'abilityLevel'>, prog: Pick<PublicProgression, 'rebirth' | 'second'>): string[] {
  const out: string[] = [];
  if (self.title) out.push(self.title);
  if (self.rebirths > 0) out.push(`${rebirthWord(self.classId, prog)} ${formatNumber(self.rebirths)}회`);
  if (self.abilityLevel > 0) out.push(`어빌 ${self.abilityLevel}`);
  return out;
}

/**
 * 어빌 경험치 막대 (%): 2차 직업이 아니면 null, 어빌 만렙이면 100.
 * abilityExpNext 는 서버가 abilityExpToNext 로 보낸 값입니다.
 */
export function abilityExpPct(self: Pick<SelfState, 'abilityLevel' | 'abilityExp' | 'abilityExpNext'>): number | null {
  if (self.abilityLevel < 1) return null;
  if (self.abilityExpNext <= 0) return 100;
  return Math.max(0, Math.min(100, (self.abilityExp / self.abilityExpNext) * 100));
}

/** 어빌 경험치 막대의 설명: "어빌 경험치 1,234 / 5,678" (만렙이면 "어빌 만렙") */
export function abilityExpTitle(self: Pick<SelfState, 'abilityLevel' | 'abilityExp' | 'abilityExpNext'>): string {
  if (self.abilityLevel < 1) return '';
  if (self.abilityExpNext <= 0) return `어빌 ${self.abilityLevel} (만렙)`;
  return `어빌 경험치 ${formatNumber(self.abilityExp)} / ${formatNumber(self.abilityExpNext)}`;
}
