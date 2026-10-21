// 직업·스킬트리 편집기의 상태: 편집 중인 설계(doc), 서버에 저장된 설계(base), 되돌리기·다시 하기, 서버 검사 결과, 저장·되돌리기 요청.
// 화면은 이 상태만 보고 그리며, 값을 바꿀 때는 늘 mutate() 를 거칩니다 (되돌리기 기록 + 실시간 검사 예약).
import { CLASS_IDS, isClassId, type ClassId } from '../../shared/constants';
import { diffDesign, stableJson, type DesignChange, type DesignHistoryDetail, type DesignLike, type DesignSaveBody } from '../../shared/design-edit';
import {
  classTier,
  type AbilityPatch,
  type DesignBundle,
  type DesignHistoryList,
  type DesignIssue,
  type DesignSaveResult,
  type ProgressionConfig,
  type SkillTreeConfig,
  type SkillTreeNode,
} from '../../shared/progression';
import type { AbilityDef } from '../../shared/types';

/** 편집기에서 고치는 기술 값 (abilities.json) */
export interface AbilityEdit {
  name: string;
  desc: string;
  mp: number;
  cooldownMs: number;
}

/** 편집 중인 설계 한 벌 */
export interface Doc {
  trees: Record<ClassId, SkillTreeConfig>;
  progression: ProgressionConfig;
  abilities: Record<string, AbilityEdit>;
}

export interface ApiReply<T> {
  status: number;
  json: T & { ok: boolean; msg?: string };
}
/** 관리자 API 호출 (main.ts 가 로그인 토큰을 붙여 줌. 401 이면 로그인 화면으로) */
export type Request = <T>(method: string, path: string, body?: unknown) => Promise<ApiReply<T>>;

export type View = 'tree' | 'lineage' | 'ascend' | 'growth';
export type Selection = { type: 'node'; id: string } | { type: 'edge'; from: string; to: string } | null;

/** 검사 문제가 가리키는 곳 */
export interface IssueRef {
  file: 'skilltrees' | 'progression' | 'abilities' | 'other';
  /** 스킬트리: 직업 */
  cls?: ClassId;
  /** 스킬트리·기술 값: 기술 id */
  ability?: string;
  /** 파일 안의 자리 (예: "rebirth.conditions.warrior[2]", "w_whirl.items[0]") */
  path?: string;
}

/** "skilltrees.json(warrior/w_whirl.items[0])" 같은 자리를 풀어 냅니다 */
export function parseWhere(where: string): IssueRef {
  const m = /^(skilltrees|progression|abilities)\.json(?:\((.*)\))?$/.exec(where);
  if (!m) return { file: 'other' };
  const inner = m[2] ?? '';
  if (m[1] === 'skilltrees') {
    const slash = inner.indexOf('/');
    const head = slash < 0 ? inner : inner.slice(0, slash);
    if (!isClassId(head)) return { file: 'skilltrees', path: inner };
    const rest = slash < 0 ? '' : inner.slice(slash + 1);
    const id = rest.split(/[.[]/)[0];
    return { file: 'skilltrees', cls: head, ...(id && !id.startsWith('#') && id !== 'columns' ? { ability: id } : {}), path: rest };
  }
  if (m[1] === 'abilities') return { file: 'abilities', ...(inner && !inner.startsWith('#') ? { ability: inner } : {}), path: inner };
  return { file: 'progression', path: inner };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 오래 걸리는 저장 같은 것을 알리는 화면 쪽 도우미 */
export interface StoreHooks {
  toast(msg: string, ok?: boolean): void;
}

export class DesignStore {
  bundle!: DesignBundle;
  /** 편집 중 */
  doc!: Doc;
  /** 서버에 저장된 것 (마지막으로 불러오거나 저장한 것) */
  base!: Doc;
  /** base 의 판 표시 */
  rev = '';
  /** 실시간 검사가 알려 준 서버의 판 (rev 와 다르면 그사이 누가 저장한 것) */
  serverRev = '';
  issues: DesignIssue[] = [];
  /** 지금 doc 을 검사 중인지 */
  checking = false;
  /** 마지막 검사가 본 doc 의 판 (version) */
  checkedVersion = -1;
  /** doc 이 바뀔 때마다 1씩 */
  version = 0;
  saving = false;
  loaded = false;
  private past: string[] = [];
  private future: string[] = [];
  private checkTimer = 0;
  private onChangeFn: () => void = () => undefined;
  private onIssuesFn: () => void = () => undefined;

  // ── 화면 상태 (되돌리기와 상관없음) ──
  view: View = 'tree';
  cls: ClassId = 'warrior';
  sel: Selection = null;
  preview = false;
  /** 다음에 그릴 때 초점을 줄 입력 칸(data-k) */
  focusNext: string | null = null;

  constructor(
    private readonly request: Request,
    private readonly hooks: StoreHooks,
  ) {}

  // ───────────────────────── 알림 ─────────────────────────

  /** 화면을 붙입니다: onChange 는 화면 전체를, onIssues 는 검사 결과에 따라 바뀌는 자리만 다시 그림 (탭을 다시 열면 바꿔 끼움) */
  bind(onChange: () => void, onIssues: () => void): void {
    this.onChangeFn = onChange;
    this.onIssuesFn = onIssues;
  }
  /** 화면을 다시 그리게 함 */
  changed(): void {
    this.onChangeFn();
  }
  private issuesChanged(): void {
    this.onIssuesFn();
  }
  /** 검사 결과를 바꿔 끼움 (저장·되돌리기가 돌려준 것) */
  setIssues(list: DesignIssue[]): void {
    this.issues = list;
    this.issuesChanged();
  }

  // ───────────────────────── 찾기 ─────────────────────────

  def(id: string): AbilityDef | undefined {
    return this.abilityDefs.get(id);
  }
  private abilityDefs = new Map<string, AbilityDef>();

  abilityName(id: string): string {
    return this.doc?.abilities[id]?.name ?? this.abilityDefs.get(id)?.name ?? id;
  }
  itemName(id: string): string {
    return this.bundle?.items.find((i) => i.id === id)?.name ?? id;
  }
  className(id: ClassId): string {
    return this.bundle?.classes.find((c) => c.id === id)?.name ?? id;
  }
  classColor(id: ClassId): string {
    return this.bundle?.classes.find((c) => c.id === id)?.color ?? '#888';
  }
  beastName(id: string): string {
    return this.doc.progression.second.beastTypes.find((b) => b.id === id)?.name ?? id;
  }
  /** 기술이 놓인 트리의 직업 (편집 중인 설계에서) */
  treeOfAbility(id: string): ClassId | undefined {
    for (const c of CLASS_IDS) if (this.doc.trees[c].nodes.some((n) => n.ability === id)) return c;
    return undefined;
  }
  node(cls: ClassId, id: string): SkillTreeNode | undefined {
    return this.doc.trees[cls].nodes.find((n) => n.ability === id);
  }
  /** 노드의 필요 레벨(2차 직업은 필요 어빌) */
  need(cls: ClassId, n: SkillTreeNode): number {
    return (classTier(cls) === 2 ? n.abilityLevel : n.level) ?? 0;
  }
  /** 모든 트리를 통틀어 from 이 (선수과목을 따라가서) target 을 필요로 하는지 */
  requiresChain(from: string, target: string): boolean {
    const byId = new Map<string, SkillTreeNode>();
    for (const c of CLASS_IDS) for (const n of this.doc.trees[c].nodes) byId.set(n.ability, n);
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of byId.get(id)?.requires ?? []) stack.push(r.ability);
    }
    return false;
  }

  // ───────────────────────── 불러오기 ─────────────────────────

  async load(): Promise<void> {
    const r = await this.request<DesignBundle>('GET', '/design');
    if (!r.json.ok) throw new Error(r.json.msg ?? '설계를 불러오지 못했습니다.');
    this.setBundle(r.json);
  }

  private setBundle(b: DesignBundle): void {
    this.bundle = b;
    this.abilityDefs = new Map(b.abilities.map((a) => [a.id, a]));
    const doc: Doc = {
      trees: clone(b.skillTrees.trees),
      progression: clone(b.progression),
      abilities: Object.fromEntries(b.abilities.map((a) => [a.id, { name: a.name, desc: a.desc, mp: a.mp, cooldownMs: a.cooldownMs }])),
    };
    this.base = doc;
    this.doc = clone(doc);
    this.rev = b.rev;
    this.serverRev = b.rev;
    this.issues = b.warnings;
    this.version++;
    this.checkedVersion = this.version;
    this.checking = false;
    this.loaded = true;
    this.fixSelection();
  }

  // ───────────────────────── 바꾸기 · 되돌리기 ─────────────────────────

  /** doc 을 바꿉니다. 정말 바뀌었으면 되돌리기 기록을 남기고, 검사를 예약하고, 다시 그립니다 */
  mutate(fn: (d: Doc) => void): boolean {
    const before = JSON.stringify(this.doc);
    fn(this.doc);
    const after = JSON.stringify(this.doc);
    if (after === before) {
      this.changed();
      return false;
    }
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.touch();
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev) as Doc;
    this.touch();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next) as Doc;
    this.touch();
    return true;
  }

  /** 편집 중인 것을 버리고 서버에 저장된 것으로 (되돌리기로 다시 살릴 수 있음) */
  discard(): void {
    this.mutate((d) => {
      d.trees = clone(this.base.trees);
      d.progression = clone(this.base.progression);
      d.abilities = clone(this.base.abilities);
    });
  }

  private touch(): void {
    this.version++;
    this.fixSelection();
    this.scheduleCheck();
    this.changed();
  }

  /** 지워진 노드·선수과목을 가리키는 선택은 풉니다 */
  fixSelection(): void {
    const s = this.sel;
    if (!s || !this.doc) return;
    const tree = this.doc.trees[this.cls];
    if (s.type === 'node' && !tree.nodes.some((n) => n.ability === s.id)) this.sel = null;
    if (s.type === 'edge') {
      const to = tree.nodes.find((n) => n.ability === s.to);
      if (!to || !to.requires.some((r) => r.ability === s.from)) this.sel = null;
    }
  }

  // ───────────────────────── 바뀐 곳 ─────────────────────────

  /** 서버의 설계와 다른 기술 값 */
  patches(): AbilityPatch[] {
    const out: AbilityPatch[] = [];
    for (const [id, a] of Object.entries(this.doc.abilities)) {
      const b = this.base.abilities[id];
      if (!b) continue;
      const p: AbilityPatch = { id };
      if (a.name !== b.name) p.name = a.name;
      if (a.desc !== b.desc) p.desc = a.desc;
      if (a.mp !== b.mp) p.mp = a.mp;
      if (a.cooldownMs !== b.cooldownMs) p.cooldownMs = a.cooldownMs;
      if (Object.keys(p).length > 1) out.push(p);
    }
    return out;
  }

  /** 저장할 때 보낼 본문 (바뀐 곳만) */
  saveBody(): DesignSaveBody {
    const body: DesignSaveBody = { rev: this.rev };
    const trees: Partial<Record<ClassId, SkillTreeConfig>> = {};
    for (const c of CLASS_IDS) if (this.treeDirty(c)) trees[c] = this.doc.trees[c];
    if (Object.keys(trees).length) body.skillTrees = trees;
    if (this.progressionDirty()) body.progression = this.doc.progression;
    const patches = this.patches();
    if (patches.length) body.abilities = patches;
    return body;
  }

  treeDirty(c: ClassId): boolean {
    return stableJson(this.doc.trees[c]) !== stableJson(this.base.trees[c]);
  }
  progressionDirty(): boolean {
    return stableJson(this.doc.progression) !== stableJson(this.base.progression);
  }
  /** 저장하지 않은 바뀐 곳이 있는지 */
  get dirty(): boolean {
    return CLASS_IDS.some((c) => this.treeDirty(c)) || this.progressionDirty() || this.patches().length > 0;
  }

  asDesign(d: Doc): DesignLike {
    return {
      progression: d.progression,
      skillTrees: { trees: d.trees },
      abilities: Object.entries(d.abilities).map(([id, a]) => ({ id, ...a })),
    };
  }

  /** 서버 설계 → 편집 중 설계의 바뀐 곳 */
  changes(): DesignChange[] {
    return diffDesign(this.asDesign(this.base), this.asDesign(this.doc), this.diffNames(), (id) => {
      const c = this.def(id)?.classId;
      return c && c !== 'monster' ? c : undefined;
    });
  }

  diffNames() {
    return {
      className: (id: ClassId) => this.className(id),
      abilityName: (id: string) => this.abilityName(id),
      itemName: (id: string) => this.itemName(id),
    };
  }

  // ───────────────────────── 서버 검사 (실시간) ─────────────────────────

  scheduleCheck(delay = 350): void {
    window.clearTimeout(this.checkTimer);
    this.checking = true;
    this.issuesChanged();
    this.checkTimer = window.setTimeout(() => void this.check(), delay);
  }

  /** 편집 중인 설계를 서버의 같은 검사로 확인합니다 (저장하지 않음) */
  async check(): Promise<void> {
    const v = this.version;
    const body: DesignSaveBody = { ...this.saveBody(), dryRun: true };
    try {
      const r = await this.request<DesignSaveResult>('PUT', '/design', body);
      if (v !== this.version) return;
      if (Array.isArray(r.json.issues)) this.issues = r.json.issues;
      else this.issues = [{ level: 'error', where: '요청', msg: r.json.msg ?? `검사하지 못했습니다. (${r.status})` }];
      if (typeof r.json.rev === 'string') this.serverRev = r.json.rev;
    } catch (e) {
      if (v !== this.version) return;
      if ((e as Error).name === 'AuthError') return;
      this.issues = [{ level: 'warn', where: '요청', msg: `서버에 닿지 않아 검사하지 못했습니다. (${(e as Error).message})` }];
    }
    this.checkedVersion = v;
    this.checking = false;
    this.issuesChanged();
  }

  get errorCount(): number {
    return this.issues.filter((i) => i.level === 'error').length;
  }
  /** 다른 곳에서 그사이 저장했는지 */
  get stale(): boolean {
    return this.serverRev !== '' && this.serverRev !== this.rev;
  }

  // ───────────────────────── 저장 · 판 기록 ─────────────────────────

  /** 바뀐 곳을 저장합니다. 결과: 'ok' | 'invalid'(검사 오류) | 'conflict'(그사이 다른 저장) | 'error' */
  async save(force = false): Promise<'ok' | 'invalid' | 'conflict' | 'error' | 'none'> {
    if (!this.dirty) return 'none';
    window.clearTimeout(this.checkTimer);
    this.checking = false;
    this.saving = true;
    this.changed();
    try {
      const body = this.saveBody();
      if (force) {
        // 덮어쓰기: 지금 서버의 판으로 다시 보냄 (내가 고친 곳만 바뀜)
        const now = await this.request<DesignBundle>('GET', '/design');
        body.rev = now.json.rev;
      }
      const v = this.version;
      const r = await this.request<DesignSaveResult>('PUT', '/design', body);
      if (r.status === 409) {
        this.serverRev = r.json.rev;
        return 'conflict';
      }
      if (Array.isArray(r.json.issues)) this.issues = r.json.issues;
      if (r.status === 400) {
        this.checkedVersion = v;
        this.hooks.toast(r.json.msg ?? '검사 오류로 저장하지 않았습니다.', false);
        return 'invalid';
      }
      if (!r.json.ok) {
        this.hooks.toast(r.json.msg ?? `저장하지 못했습니다. (${r.status})`, false);
        return 'error';
      }
      // 서버가 맞춘 값(기술의 레벨·가격 등)까지 같게 하려고 다시 불러와 기준으로 삼음 (편집 중이던 것은 그대로)
      const fresh = await this.request<DesignBundle>('GET', '/design');
      const keep = v === this.version ? null : JSON.stringify(this.doc);
      this.setBundle(fresh.json);
      this.issues = r.json.issues;
      if (keep) {
        // 저장하는 동안 더 고친 것은 그대로 두고 다시 검사
        this.doc = JSON.parse(keep) as Doc;
        this.version++;
        this.scheduleCheck();
      }
      this.hooks.toast(r.json.msg ?? '저장했습니다.', true);
      return 'ok';
    } catch (e) {
      if ((e as Error).name !== 'AuthError') this.hooks.toast(`저장하지 못했습니다: ${(e as Error).message}`, false);
      return 'error';
    } finally {
      this.saving = false;
      this.changed();
      this.issuesChanged();
    }
  }

  /** 편집 중인 것을 버리고 서버에서 새로 불러옵니다 (되돌리기 기록도 비움) */
  async reload(): Promise<void> {
    await this.load();
    this.past = [];
    this.future = [];
    this.changed();
    this.issuesChanged();
  }

  async history(): Promise<DesignHistoryList> {
    const r = await this.request<DesignHistoryList>('GET', '/design/history');
    if (!r.json.ok) throw new Error(r.json.msg ?? '판 기록을 불러오지 못했습니다.');
    return r.json;
  }

  async historyDetail(id: string): Promise<DesignHistoryDetail> {
    const r = await this.request<DesignHistoryDetail>('GET', `/design/history/${encodeURIComponent(id)}`);
    if (!r.json.ok) throw new Error(r.json.msg ?? '그 판을 불러오지 못했습니다.');
    return r.json;
  }

  /** 판 기록 하나로 되돌립니다 (편집 중이던 것은 버림) */
  async restore(id: string): Promise<DesignSaveResult & { status: number }> {
    const r = await this.request<DesignSaveResult>('POST', '/design/restore', { id, rev: this.rev });
    if (r.status === 200 && r.json.ok) await this.reload();
    return { ...r.json, status: r.status };
  }
}
