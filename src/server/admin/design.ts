// 관리자 페이지 "직업·스킬트리" 탭의 API (/api/admin/design...). 형식은 src/shared/progression.ts 의 "관리자 편집기 API 형식"과
// src/shared/design-edit.ts (편집기 전용으로 덧붙인 것).
//
//   GET  /api/admin/design                     → DesignBundle (지금 설계 + 편집기가 고를 기술·아이템·직업 + rev)
//   PUT  /api/admin/design                      DesignSaveBody      → DesignSaveResult (여러 트리·성장 규칙·기술 값을 한 번에, 편집기가 씀;
//                                                 검사만(dryRun)이면 설계 오류도 200 + ok:false)
//   PUT  /api/admin/design/skilltree/:classId   SkillTreeSaveBody   → DesignSaveResult
//   PUT  /api/admin/design/progression          ProgressionSaveBody → DesignSaveResult
//   GET  /api/admin/design/history              → DesignHistoryList (data/design-history/, 새것부터)
//   GET  /api/admin/design/history/:id          → DesignHistoryDetail (판 하나의 설계)
//   POST /api/admin/design/restore              DesignRestoreBody   → DesignSaveResult
//
// 저장 순서: 본문 모양 검사(모르는 항목·크기, 400) → rev 비교(다르면 409, 편집기의 실시간 검사(PUT /design 의 dryRun)는 건너뜀)
//   → GameData.checkUpdate 로 검사(오류면 400, dryRun 이면 여기까지) → 실행 중인 게임 데이터에 applyDesign
//     (노드의 level/abilityLevel·gold 를 abilities.json 의 level·price 에도 맞춤)
//   → 바로 전 설계를 data/design-history/<시각>-<종류>[-직업].json 에 남김
//   → gamedata/ 의 정해진 세 파일(skilltrees.json·progression.json·abilities.json) 중 바뀐 것만 임시 파일에 쓰고 이름 바꾸기
//     (판 기록이나 파일 쓰기가 실패하면 파일과 게임 데이터를 바로 전 설계로 되돌리고 500)
//   → 접속자 모두에게 { t: 'design' } 보내고 p.recompute() → 감사 기록(world.audit).
// 반영과 파일 쓰기는 동기로 한 번에 처리하므로 그 사이에 다른 저장이 끼어들지 않습니다.
// 인증은 api.ts 가 이 처리기를 부르기 전에 끝냅니다. 파일 이름은 모두 서버가 정하며, 요청에서 온 글자로 경로를 만들지 않습니다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CLASS_IDS, formatNumber, isClassId, type ClassId } from '../../shared/constants';
import {
  abilityPatch,
  DESIGN_LIMITS,
  diffDesign,
  HISTORY_ID,
  summarizeChanges,
  type AbilitySnapshot,
  type DesignHistoryDetail,
  type DesignSnapshot,
} from '../../shared/design-edit';
import {
  classTier,
  type AbilityPatch,
  type DesignBundle,
  type DesignHistoryEntry,
  type DesignHistoryList,
  type DesignIssue,
  type DesignSaveResult,
  type ProgressionConfig,
  type SkillTreesConfig,
} from '../../shared/progression';
import { formatListFile, formatProgression, formatSkillTrees, normalizeSkillTrees, type DesignUpdate } from '../gamedata';
import { log } from '../log';
import type { World } from '../world/World';

/** 처리한 요청의 응답: HTTP 상태와 JSON 본문 */
export interface DesignReply {
  status: number;
  body: unknown;
}

/** 편집기가 다시 쓸 수 있는 gamedata/ 파일 (이 셋 말고는 쓰지 않음) */
const DESIGN_FILES = ['skilltrees.json', 'progression.json', 'abilities.json'] as const;
type DesignFile = (typeof DESIGN_FILES)[number];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isError = (i: DesignIssue) => i.level === 'error';
const REV = /^[0-9a-f]{16}$/;

const reply = (status: number, body: unknown): DesignReply => ({ status, body });
const failed = (status: number, msg: string, rev: string, issues: DesignIssue[] = []): DesignReply =>
  reply(status, { ok: false, msg, issues, rev } satisfies DesignSaveResult);

/** 본문 모양 오류 (검사 목록 모양으로 돌려줘 편집기가 같은 자리에 보여 줌) */
const bodyIssue = (msg: string): DesignIssue => ({ level: 'error', where: '요청', msg });

/** 저장 하나 (어느 경로로 왔든 같은 순서를 거침) */
interface CommitOptions {
  update: DesignUpdate;
  /** 요청의 판 표시 (null 이면 비교하지 않음) */
  rev: string | null;
  dryRun: boolean;
  /** 판 기록의 종류와 직업. 주지 않으면 실제로 바뀐 곳에서 정합니다 (트리·기술 값이 한 직업만 바뀌었으면 그 직업) */
  kind?: DesignHistoryEntry['kind'];
  classId?: ClassId;
  actor: string;
  /** 판 기록·작업 기록 요약 앞에 붙일 말 (되돌리기) */
  prefix?: string;
  /** 검사만 할 때 설계에 오류가 있어도 HTTP 200 (ok: false) 으로 답함 (편집기의 실시간 검사가 브라우저 콘솔에 오류를 남기지 않게) */
  softCheck?: boolean;
}

export class DesignApi {
  private readonly historyDir: string;
  private readonly gamedataDir: string;
  /** 판 기록 머리 (파일은 한 번 쓰면 바뀌지 않으므로 읽은 것을 기억) */
  private readonly historyCache = new Map<string, DesignHistoryEntry>();
  private lastAt = 0;
  /**
   * 서버가 마지막으로 읽었거나(켜질 때) 쓴 세 파일 내용의 해시. 서버가 켜져 있는 동안 누가 파일을 직접 고쳤으면
   * (예: abilities.json 에 새 기술을 더함) 그 파일에 쓰게 되는 저장을 거절해, 손으로 고친 내용을 덮어쓰지 않습니다.
   */
  private readonly diskBase = new Map<DesignFile, string>();

  constructor(private readonly world: World) {
    this.historyDir = path.join(world.config.dataDir, 'design-history');
    this.gamedataDir = path.resolve(world.config.gamedataDir);
    for (const f of DESIGN_FILES) this.diskBase.set(f, this.diskHash(f));
  }

  /**
   * /design 으로 시작하는 요청이면 처리해 응답을 돌려주고, 아니면 null.
   * path 는 '/api/admin' 을 뗀 경로(이미 한 번 풀어 쓴 것), readBody 는 본문 JSON 을 읽는 함수, actor 는 감사 기록에 남길 이름입니다.
   */
  async handle(method: string, path: string, readBody: () => Promise<Record<string, unknown>>, actor: string): Promise<DesignReply | null> {
    if (path !== '/design' && !path.startsWith('/design/')) return null;
    const wrongMethod = reply(405, { ok: false, msg: '이 주소에는 쓸 수 없는 요청 방식입니다.' });
    if (path === '/design') {
      if (method === 'GET') return reply(200, this.bundle());
      if (method === 'PUT') return this.saveAll(await readBody(), actor);
      return wrongMethod;
    }
    const tree = /^\/design\/skilltree\/([^/]+)$/.exec(path);
    if (tree) {
      const classId = tree[1]!;
      if (!isClassId(classId)) return reply(404, { ok: false, msg: '알 수 없는 직업입니다.' });
      if (method !== 'PUT') return wrongMethod;
      return this.saveTree(classId, await readBody(), actor);
    }
    if (path === '/design/progression') return method === 'PUT' ? this.saveProgression(await readBody(), actor) : wrongMethod;
    if (path === '/design/history') return method === 'GET' ? reply(200, { ok: true, entries: this.listHistory() } satisfies DesignHistoryList) : wrongMethod;
    const one = /^\/design\/history\/([^/]+)$/.exec(path);
    if (one) return method === 'GET' ? this.historyDetail(one[1]!) : wrongMethod;
    if (path === '/design/restore') return method === 'POST' ? this.restore(await readBody(), actor) : wrongMethod;
    return reply(404, { ok: false, msg: '알 수 없는 요청입니다.' });
  }

  // ───────────────────────── 읽기 ─────────────────────────

  /** 지금 설계의 판 표시: 세 파일에 쓸 내용(편집기가 고치는 기술 값 포함)의 해시 */
  rev(): string {
    const gd = this.world.data;
    const h = crypto.createHash('sha256');
    h.update(formatSkillTrees(gd.skillTrees));
    h.update('\0');
    h.update(formatProgression(gd.progression));
    h.update('\0');
    h.update(JSON.stringify(this.abilitySnapshots()));
    return h.digest('hex').slice(0, 16);
  }

  private bundle(): DesignBundle {
    const gd = this.world.data;
    const cfg = this.world.config;
    return {
      ok: true,
      rev: this.rev(),
      skillTrees: gd.skillTrees,
      progression: gd.progression,
      abilities: [...gd.abilities.values()].filter((a) => a.classId !== 'monster'),
      items: [...gd.items.values()].map((i) => ({ id: i.id, name: i.name, type: i.type })),
      classes: CLASS_IDS.map((id) => {
        const c = gd.classes.get(id)!;
        return { id, name: c.name, color: c.color, tier: classTier(id) };
      }),
      maxLevel: cfg.maxLevel,
      statCap: cfg.statCap,
      warnings: [...gd.designWarnings, ...this.serverIssues(gd.skillTrees, gd.progression), ...this.diskIssues()],
    };
  }

  private diskHash(f: DesignFile): string {
    const text = readOrNull(path.join(this.gamedataDir, f));
    return text === null ? '' : sha256(text);
  }

  /** 서버가 켜진(또는 마지막으로 저장한) 뒤 서버 밖에서 바뀐 파일 */
  private changedOutside(files: readonly DesignFile[] = DESIGN_FILES): DesignFile[] {
    return files.filter((f) => this.diskHash(f) !== this.diskBase.get(f));
  }

  private diskIssues(): DesignIssue[] {
    return this.changedOutside().map((f) => ({
      level: 'warn' as const,
      where: 'gamedata',
      msg: `gamedata/${f} 이(가) 서버가 켜진 뒤 서버 밖에서 바뀌었습니다. 그 내용을 덮어쓰지 않도록 이 파일에 쓰게 되는 저장은 거절합니다. 서버를 다시 켜서 불러온 뒤 고쳐 주세요.`,
    }));
  }

  private abilitySnapshots(): AbilitySnapshot[] {
    const out: AbilitySnapshot[] = [];
    for (const a of this.world.data.abilities.values()) {
      if (a.classId === 'monster') continue;
      out.push({ id: a.id, name: a.name, desc: a.desc, mp: a.mp, cooldownMs: a.cooldownMs, level: a.level, price: a.price });
    }
    return out;
  }

  /** 지금 게임이 쓰는 설계 (깊은 복사) */
  private snapshot(): DesignSnapshot {
    const gd = this.world.data;
    return clone({ progression: gd.progression, skillTrees: gd.skillTrees, abilities: this.abilitySnapshots() });
  }

  /**
   * 서버 설정에 따라 달라지는 알림 (gamedata 검사는 서버 최대 레벨을 모르므로 여기서 덧붙임):
   * 서버 최대 레벨보다 높은 필요 레벨·전직 레벨·승급 레벨은 아무도 닿을 수 없습니다.
   */
  private serverIssues(trees: SkillTreesConfig, prog: ProgressionConfig): DesignIssue[] {
    const max = this.world.config.maxLevel;
    const out: DesignIssue[] = [];
    const tooHigh = (what: string, v: number) => `${what} ${v} 이(가) 서버 최대 레벨(${max})보다 높아 아무도 닿을 수 없습니다. (.env 의 MAX_LEVEL)`;
    for (const c of CLASS_IDS) {
      if (classTier(c) === 2) continue;
      for (const n of trees.trees[c].nodes)
        if (n.level !== undefined && n.level > max) out.push({ level: 'warn', where: `skilltrees.json(${c}/${n.ability})`, msg: tooHigh('필요 레벨', n.level) });
    }
    if (prog.rebirth.level > max) out.push({ level: 'warn', where: 'progression.json(rebirth)', msg: tooHigh('전직 레벨', prog.rebirth.level) });
    if (prog.ascend.level > max) out.push({ level: 'warn', where: 'progression.json(ascend)', msg: tooHigh('승급 레벨', prog.ascend.level) });
    const lists: [string, Record<string, { type: string; min?: number }[]>][] = [
      ['rebirth.conditions', prog.rebirth.conditions],
      ['ascend.conditions', prog.ascend.conditions],
      ['second.conditions', prog.second.conditions],
    ];
    for (const [w, byClass] of lists)
      for (const [c, list] of Object.entries(byClass))
        list.forEach((x, i) => {
          if (x.type === 'level' && x.min !== undefined && x.min > max)
            out.push({ level: 'warn', where: `progression.json(${w}.${c}[${i}])`, msg: tooHigh('필요 레벨', x.min) });
        });
    return out;
  }

  /**
   * 캐릭터가 이미 고른 수인 계통의 id 를 새 설계가 지우거나 바꾸면 오류 (계통 이름만 바꿀 수 있음).
   * 계통 id 는 캐릭터 저장과 수인 트리 노드가 함께 쓰므로, 고른 수인이 있는 id 가 없어지면 그 수인은 계통 전용 기술을
   * 더 배울 수 없게 됩니다 (다시 고르게 하지는 않음). 고른 캐릭터가 없는 id 는 지우거나 바꿔도 됩니다.
   */
  private beastTypeIssues(update: DesignUpdate): DesignIssue[] {
    const next = update.progression;
    const list = isObj(next) && isObj(next.second) && Array.isArray(next.second.beastTypes) ? next.second.beastTypes : null;
    if (!list) return []; // 모양이 틀리면 설계 검사가 알려 줌
    const ids = new Set(list.flatMap((b) => (isObj(b) && typeof b.id === 'string' ? [b.id] : [])));
    const out: DesignIssue[] = [];
    for (const t of this.world.data.progression.second.beastTypes) {
      if (ids.has(t.id)) continue;
      const users = this.world.store
        .all()
        .filter((d) => d.beastType === t.id)
        .map((d) => d.name);
      if (users.length === 0) continue;
      const who = `${users.slice(0, 3).join(', ')}${users.length > 3 ? ` 외 ${users.length - 3}명` : ''}`;
      out.push({
        level: 'error',
        where: 'progression.json(second.beastTypes)',
        msg: `${t.name}(${t.id}) 계통을 고른 수인이 있어(${who}) 그 id 를 지우거나 바꿀 수 없습니다. 계통의 이름만 바꾸세요.`,
      });
    }
    return out;
  }

  // ───────────────────────── 저장 경로 ─────────────────────────

  /** PUT /design: 편집기가 바꾼 곳을 한 번에 */
  private saveAll(body: Record<string, unknown>, actor: string): DesignReply {
    const rev = this.rev();
    const bad = onlyKeys(body, ['rev', 'skillTrees', 'progression', 'abilities', 'dryRun']) ?? dryRunError(body) ?? textError(body);
    if (bad) return failed(400, bad.msg, rev, [bad]);
    const dryRun = body.dryRun === true;
    if (!dryRun && !validRev(body.rev)) return failed(400, 'rev(판 표시)가 필요합니다.', rev, [bodyIssue('rev 는 GET /api/admin/design 에서 받은 판 표시여야 합니다.')]);
    const update: DesignUpdate = { syncAbilityDefaults: true };
    if (body.skillTrees !== undefined) {
      if (!isObj(body.skillTrees)) return failed(400, 'skillTrees 는 직업별 트리 객체여야 합니다.', rev, [bodyIssue('skillTrees 는 { "warrior": { "nodes": [...] } } 모양이어야 합니다.')]);
      const trees: Record<string, unknown> = { ...this.world.data.skillTrees.trees };
      for (const [k, t] of Object.entries(body.skillTrees)) {
        if (!isClassId(k)) return failed(400, `알 수 없는 직업 '${k.slice(0, 40)}' 의 트리입니다.`, rev, [bodyIssue(`알 수 없는 직업 '${k.slice(0, 40)}'`)]);
        trees[k] = t;
      }
      update.skillTrees = { version: 1, trees };
    }
    if (body.progression !== undefined) update.progression = body.progression;
    if (body.abilities !== undefined) {
      const p = patchList(body.abilities);
      if (typeof p === 'string') return failed(400, p, rev, [bodyIssue(p)]);
      update.abilities = p;
    }
    return this.commit({ update, rev: dryRun ? null : (body.rev as string), dryRun, actor, softCheck: dryRun }, rev);
  }

  /** PUT /design/skilltree/:classId: 직업 하나의 트리 (+ 그 직업 기술의 값) */
  private saveTree(classId: ClassId, body: Record<string, unknown>, actor: string): DesignReply {
    const rev = this.rev();
    const bad = onlyKeys(body, ['rev', 'tree', 'abilities', 'dryRun']) ?? dryRunError(body) ?? textError(body);
    if (bad) return failed(400, bad.msg, rev, [bad]);
    if (!validRev(body.rev)) return failed(400, 'rev(판 표시)가 필요합니다.', rev, [bodyIssue('rev 는 GET /api/admin/design 에서 받은 판 표시여야 합니다.')]);
    if (!isObj(body.tree)) return failed(400, 'tree 는 { "nodes": [...] } 모양의 객체여야 합니다.', rev, [bodyIssue('tree 가 필요합니다.')]);
    const update: DesignUpdate = { skillTrees: { version: 1, trees: { ...this.world.data.skillTrees.trees, [classId]: body.tree } }, syncAbilityDefaults: true };
    if (body.abilities !== undefined) {
      const p = patchList(body.abilities);
      if (typeof p === 'string') return failed(400, p, rev, [bodyIssue(p)]);
      const other = p.find((x) => this.world.data.abilities.get(x.id)?.classId !== classId);
      if (other) {
        const msg = `${other.id} 은(는) 이 직업의 기술이 아니라 여기서 고칠 수 없습니다.`;
        return failed(400, msg, rev, [{ level: 'error', where: `abilities.json(${other.id})`, msg }]);
      }
      update.abilities = p;
    }
    return this.commit({ update, rev: body.rev as string, dryRun: body.dryRun === true, kind: 'skilltree', classId, actor }, rev);
  }

  /** PUT /design/progression: 성장 규칙 통째로 */
  private saveProgression(body: Record<string, unknown>, actor: string): DesignReply {
    const rev = this.rev();
    const bad = onlyKeys(body, ['rev', 'progression', 'dryRun']) ?? dryRunError(body) ?? textError(body);
    if (bad) return failed(400, bad.msg, rev, [bad]);
    if (!validRev(body.rev)) return failed(400, 'rev(판 표시)가 필요합니다.', rev, [bodyIssue('rev 는 GET /api/admin/design 에서 받은 판 표시여야 합니다.')]);
    if (body.progression === undefined) return failed(400, 'progression 이 필요합니다.', rev, [bodyIssue('progression 이 필요합니다.')]);
    return this.commit(
      {
        update: { progression: body.progression, syncAbilityDefaults: true },
        rev: body.rev as string,
        dryRun: body.dryRun === true,
        kind: 'progression',
        actor,
      },
      rev,
    );
  }

  /** POST /design/restore: 판 기록 하나의 설계로 되돌림 (지금 판도 기록에 남김) */
  private restore(body: Record<string, unknown>, actor: string): DesignReply {
    const rev = this.rev();
    const bad = onlyKeys(body, ['id', 'rev']);
    if (bad) return failed(400, bad.msg, rev, [bad]);
    if (!validRev(body.rev)) return failed(400, 'rev(판 표시)가 필요합니다.', rev, [bodyIssue('rev 가 필요합니다.')]);
    if (typeof body.id !== 'string') return failed(400, '되돌릴 판 id 가 필요합니다.', rev);
    const found = this.readHistory(body.id);
    if (!found) return failed(404, '그 판 기록을 찾을 수 없습니다.', rev);
    const { entry, design } = found;
    const gd = this.world.data;
    // 기술 값은 지금도 있는 기술의, 지금과 다른 값만 (그 사이 abilities.json 에서 빠진 기술은 트리 검사가 알려 줌)
    const patches: AbilityPatch[] = [];
    for (const s of design.abilities) {
      const a = gd.abilities.get(s.id);
      const p = a && a.classId !== 'monster' ? abilityPatch(s.id, a, s) : null;
      if (p) patches.push(p);
    }
    return this.commit(
      {
        update: { progression: design.progression, skillTrees: design.skillTrees, abilities: patches, syncAbilityDefaults: true },
        rev: body.rev,
        dryRun: false,
        kind: 'restore',
        actor,
        prefix: `${new Date(entry.at).toLocaleString('ko-KR')} 판으로 되돌림`,
      },
      rev,
    );
  }

  private stale(rev: string): DesignReply {
    return failed(409, '그사이 다른 곳에서 설계를 저장했습니다. 새로 불러온 뒤 다시 저장해 주세요.', rev);
  }

  // ───────────────────────── 저장 (검사 → 반영 → 판 기록 → 파일 → 알림) ─────────────────────────

  /** rev 는 요청을 받을 때 계산한 지금 판 표시 */
  private commit(o: CommitOptions, rev: string): DesignReply {
    const gd = this.world.data;
    if (o.rev !== null && o.rev !== rev) return this.stale(rev);
    const invalid = (issues: DesignIssue[]) =>
      failed(o.dryRun && o.softCheck ? 200 : 400, `검사에서 오류 ${issues.filter(isError).length}개가 나와 ${o.dryRun ? '저장할 수 없습니다' : '저장하지 않았습니다'}.`, rev, issues);
    if (o.dryRun) {
      const issues = [...gd.checkUpdate(o.update), ...this.beastTypeIssues(o.update)];
      if (issues.some(isError)) return invalid(issues);
      const trees = o.update.skillTrees ? normalizeSkillTrees(o.update.skillTrees) : gd.skillTrees;
      const prog = (o.update.progression as ProgressionConfig | undefined) ?? gd.progression;
      return reply(200, { ok: true, msg: '검사를 통과했습니다.', issues: [...issues, ...this.serverIssues(trees, prog), ...this.diskIssues()], rev } satisfies DesignSaveResult);
    }

    // 고른 수인이 있는 계통 id 를 지우거나 바꾸면 반영하기 전에 거절
    const beast = this.beastTypeIssues(o.update);
    if (beast.length) return invalid([...gd.checkUpdate(o.update), ...beast]);
    // 검사와 반영을 한 번에 (오류가 하나라도 있으면 아무것도 바꾸지 않음)
    const before = this.snapshot();
    const oldTexts = this.texts();
    const applied = gd.applyDesign(o.update);
    if (applied.some(isError)) return invalid(applied);
    const after = this.snapshot();
    const names = {
      className: (id: ClassId) => gd.classes.get(id)?.name ?? id,
      abilityName: (id: string) => gd.abilities.get(id)?.name ?? id,
      itemName: (id: string) => gd.items.get(id)?.name ?? id,
    };
    const changes = diffDesign(before, after, names, (id) => {
      const c = gd.abilities.get(id)?.classId;
      return c && c !== 'monster' ? c : undefined;
    });
    const warnings = [...applied, ...this.serverIssues(gd.skillTrees, gd.progression)];
    const newRev = this.rev();
    const newTexts = this.texts();
    const changedFiles = DESIGN_FILES.filter((f) => newTexts[f] !== oldTexts[f]);
    if (changes.length === 0 && changedFiles.length === 0)
      return reply(200, { ok: true, msg: '바뀐 것이 없습니다.', issues: warnings, rev: newRev } satisfies DesignSaveResult);
    // 손으로 고친 파일 때문에 기술의 레벨·가격만 트리와 달랐던 경우에도 맞춘 파일은 남김
    const base = changes.length ? summarizeChanges(changes, o.prefix ? 3 : 4) : '기술 파일의 레벨·가격을 스킬트리에 맞춤';
    const summary = o.prefix ? `${o.prefix}: ${base}` : base;
    // 트리·기술 값이 바뀐 직업이 하나뿐이고 성장 규칙은 그대로면 그 직업의 트리 저장으로 남김
    const classes = new Set(changes.flatMap((c) => (c.classId ? [c.classId] : [])));
    const progChanged = changes.some((c) => c.area === 'progression');
    if (!o.kind) {
      o.kind = !progChanged || classes.size > 0 ? 'skilltree' : 'progression';
      if (classes.size === 1 && !progChanged) o.classId = [...classes][0];
    }
    const outside = this.changedOutside(changedFiles);
    if (outside.length) {
      this.rollback(before);
      const msg = `gamedata/${outside.join('·')} 이(가) 서버가 켜진 뒤 서버 밖에서 바뀌어, 그 내용을 덮어쓰지 않도록 저장하지 않았습니다. 서버를 다시 켜서 바뀐 파일을 불러온 뒤 다시 저장해 주세요.`;
      return failed(412, msg, rev, [{ level: 'error', where: 'gamedata', msg }]);
    }

    let entry: DesignHistoryEntry;
    try {
      entry = this.writeHistory(o, summary, before);
    } catch (e) {
      log.error('설계 판 기록을 남기지 못했습니다:', (e as Error).message);
      this.rollback(before);
      return failed(500, `판 기록을 남기지 못해 저장하지 않았습니다. (${(e as Error).message})`, rev);
    }
    try {
      this.writeFiles(changedFiles.map((f) => [f, newTexts[f]]));
      for (const f of changedFiles) this.diskBase.set(f, sha256(newTexts[f]));
    } catch (e) {
      log.error('설계 파일을 쓰지 못했습니다:', (e as Error).message);
      this.rollback(before);
      this.forgetHistory(entry.id);
      return failed(500, `gamedata 파일을 쓰지 못해 저장하지 않았습니다. (${(e as Error).message})`, rev);
    }
    this.pruneHistory();
    this.publish();
    const trees = [...classes].map((c) => names.className(c)).join('·');
    const target =
      o.kind === 'restore'
        ? '설계 전체'
        : o.classId
          ? `${names.className(o.classId)} 트리`
          : progChanged && classes.size
            ? `${trees} 트리·성장 규칙`
            : progChanged
              ? '성장 규칙'
              : classes.size
                ? `${trees} 트리`
                : '기술 파일';
    this.world.audit.write(o.actor, o.kind === 'restore' ? 'restoreDesign' : 'saveDesign', target, summary);
    log.info(`[관리자] ${o.actor} 직업·스킬트리 ${o.kind === 'restore' ? '되돌리기' : '저장'}: ${summary} (파일: ${changedFiles.join(', ') || '없음'})`);
    const msg = `${o.kind === 'restore' ? '되돌렸습니다' : '저장했습니다'}. 게임에 바로 반영했습니다.${changes.length ? ` (${changes.length}곳)` : ''}`;
    return reply(200, { ok: true, msg, issues: warnings, rev: newRev } satisfies DesignSaveResult);
  }

  /** 세 파일에 쓸 내용 (지금 게임 데이터 그대로, 지금 파일과 같은 모양) */
  private texts(): Record<DesignFile, string> {
    const gd = this.world.data;
    return {
      'skilltrees.json': formatSkillTrees(gd.skillTrees),
      'progression.json': formatProgression(gd.progression),
      'abilities.json': formatListFile([...gd.abilities.values()]),
    };
  }

  /** 저장이 중간에 실패했을 때 게임 데이터를 바로 전 설계로 (기술 값은 직접, 트리·성장 규칙은 applyDesign 으로) */
  private rollback(before: DesignSnapshot): void {
    const gd = this.world.data;
    for (const s of before.abilities) {
      const a = gd.abilities.get(s.id);
      if (!a) continue;
      a.name = s.name;
      a.desc = s.desc;
      a.mp = s.mp;
      a.cooldownMs = s.cooldownMs;
      a.level = s.level;
      a.price = s.price;
    }
    const issues = gd.applyDesign({ progression: before.progression, skillTrees: before.skillTrees });
    if (issues.some(isError)) log.error('설계를 되돌리지 못했습니다:', issues.filter(isError).map((i) => `${i.where}: ${i.msg}`).join(' / '));
  }

  /**
   * gamedata/ 의 정해진 파일들을 바꿉니다: 모두 임시 파일에 먼저 쓰고, 그다음 이름을 바꿉니다.
   * 이름 바꾸기 도중에 실패하면 이미 바꾼 파일을 원래 내용으로 돌려놓고 오류를 다시 던집니다.
   */
  private writeFiles(files: [DesignFile, string][]): void {
    if (files.length === 0) return;
    const tmps: { file: string; tmp: string; prev: string | null }[] = [];
    try {
      for (const [name, text] of files) {
        if (!(DESIGN_FILES as readonly string[]).includes(name)) throw new Error(`쓸 수 없는 파일: ${name}`);
        const file = path.join(this.gamedataDir, name);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, text);
        tmps.push({ file, tmp, prev: readOrNull(file) });
      }
    } catch (e) {
      for (const t of tmps) fs.rmSync(t.tmp, { force: true });
      throw e;
    }
    const done: typeof tmps = [];
    try {
      for (const t of tmps) {
        fs.renameSync(t.tmp, t.file);
        done.push(t);
      }
    } catch (e) {
      for (const t of tmps) if (!done.includes(t)) fs.rmSync(t.tmp, { force: true });
      for (const t of done.reverse()) {
        if (t.prev === null) continue;
        try {
          atomicWrite(t.file, t.prev);
        } catch (e2) {
          log.error(`${t.file} 을(를) 되돌리지 못했습니다:`, (e2 as Error).message);
        }
      }
      throw e;
    }
  }

  /** 접속 중인 모두에게 새 설계를 보내고 능력치(어빌 체력·마나, 칭호 등)를 다시 계산합니다 */
  private publish(): void {
    const w = this.world;
    const data = w.data.clientData(w.publicInfo());
    w.broadcastAll({ t: 'design', abilities: data.abilities, skillTrees: data.skillTrees, progression: data.progression });
    for (const p of w.players.values()) {
      p.recompute();
      p.markAbilities();
    }
  }

  // ───────────────────────── 판 기록 (data/design-history/) ─────────────────────────

  private writeHistory(o: CommitOptions, summary: string, before: DesignSnapshot): DesignHistoryEntry {
    fs.mkdirSync(this.historyDir, { recursive: true });
    const kind = o.kind ?? 'skilltree';
    let at = Math.max(Date.now(), this.lastAt + 1);
    const idOf = (t: number) => `${t}-${kind}${o.classId ? `-${o.classId}` : ''}`;
    while (fs.existsSync(path.join(this.historyDir, `${idOf(at)}.json`))) at++;
    this.lastAt = at;
    const entry: DesignHistoryEntry = { id: idOf(at), at, actor: o.actor, kind, ...(o.classId ? { classId: o.classId } : {}), summary };
    atomicWrite(path.join(this.historyDir, `${entry.id}.json`), `${JSON.stringify({ version: 1, ...entry, design: before })}\n`);
    this.historyCache.set(entry.id, entry);
    return entry;
  }

  private forgetHistory(id: string): void {
    this.historyCache.delete(id);
    fs.rmSync(path.join(this.historyDir, `${id}.json`), { force: true });
  }

  /** 판 기록 파일들의 id (새것부터). 이름이 규칙에 맞는 파일만 */
  private historyIds(): string[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.historyDir);
    } catch {
      return [];
    }
    const ids: { id: string; at: number }[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const m = HISTORY_ID.exec(id);
      if (!m || (m[3] !== undefined && !isClassId(m[3]))) continue;
      ids.push({ id, at: Number(m[1]) });
    }
    return ids.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).map((x) => x.id);
  }

  private listHistory(): DesignHistoryEntry[] {
    const out: DesignHistoryEntry[] = [];
    for (const id of this.historyIds()) {
      if (out.length >= DESIGN_LIMITS.historyList) break;
      const entry = this.historyCache.get(id) ?? this.readHistoryFile(id)?.entry;
      if (entry) out.push(entry);
    }
    return out;
  }

  /**
   * 판 기록 하나를 읽습니다. id 는 디렉터리에 실제로 있는 파일 이름 중에서만 찾으므로
   * 요청의 글자로 경로를 만들지 않습니다. 없거나 망가졌으면 null.
   */
  private readHistory(id: string): { entry: DesignHistoryEntry; design: DesignSnapshot } | null {
    if (!HISTORY_ID.test(id)) return null;
    const name = this.historyIds().find((x) => x === id);
    return name ? this.readHistoryFile(name) : null;
  }

  /** historyIds() 가 돌려준 이름의 판 기록 파일을 읽습니다 */
  private readHistoryFile(name: string): { entry: DesignHistoryEntry; design: DesignSnapshot } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.historyDir, `${name}.json`), 'utf8')) as Record<string, unknown>;
      const m = HISTORY_ID.exec(name)!;
      const d = raw.design;
      if (!isObj(d) || !isObj(d.progression) || !isObj(d.skillTrees) || !Array.isArray(d.abilities)) return null;
      const entry: DesignHistoryEntry = {
        id: name,
        at: Number(m[1]),
        actor: typeof raw.actor === 'string' ? raw.actor.slice(0, 80) : '?',
        kind: m[2] as DesignHistoryEntry['kind'],
        ...(m[3] ? { classId: m[3] as ClassId } : {}),
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 400) : '',
      };
      this.historyCache.set(name, entry);
      const abilities = (d.abilities as unknown[]).filter(isAbilitySnapshot);
      return { entry, design: { progression: d.progression as unknown as ProgressionConfig, skillTrees: d.skillTrees as unknown as SkillTreesConfig, abilities } };
    } catch (e) {
      log.warn(`설계 판 기록 ${name} 을(를) 읽지 못했습니다: ${(e as Error).message}`);
      return null;
    }
  }

  private historyDetail(id: string): DesignReply {
    const r = this.readHistory(id);
    if (!r) return reply(404, { ok: false, msg: '그 판 기록을 찾을 수 없습니다.' });
    return reply(200, { ok: true, entry: r.entry, design: r.design } satisfies DesignHistoryDetail);
  }

  /** 오래된 판 기록을 지워 DESIGN_LIMITS.historyKeep 개만 남깁니다 */
  private pruneHistory(): void {
    const ids = this.historyIds();
    for (const id of ids.slice(DESIGN_LIMITS.historyKeep)) {
      try {
        this.forgetHistory(id);
      } catch (e) {
        log.warn(`오래된 판 기록 ${id} 을(를) 지우지 못했습니다: ${(e as Error).message}`);
      }
    }
  }
}

// ───────────────────────── 도우미 ─────────────────────────

/**
 * 본문의 모든 글자(항목 이름 포함)에 줄바꿈·제어 문자가 없는지, 너무 깊게 겹치지 않았는지.
 * 기술 이름·설명·칭호·계통 이름·열 제목은 게임 화면과 서버 기록에 그대로 나가므로 한 줄 글자만 받습니다.
 * 재귀하지 않고 쌓아 가며 봅니다 (일부러 깊게 겹친 본문에도 안전).
 */
function textError(body: unknown): DesignIssue | null {
  const bad = /[\u0000-\u001f\u007f]/;
  const stack: [unknown, number][] = [[body, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (depth > 12) return bodyIssue('본문이 너무 깊게 겹쳐 있습니다.');
    if (typeof v === 'string') {
      if (bad.test(v)) return bodyIssue(`글자에 줄바꿈이나 제어 문자를 쓸 수 없습니다. ('${v.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 30)}')`);
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push([x, depth + 1]);
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (bad.test(k)) return bodyIssue('항목 이름에 제어 문자를 쓸 수 없습니다.');
        stack.push([x, depth + 1]);
      }
    }
  }
  return null;
}

/** 정해진 항목 말고 다른 것이 있으면 문제 하나 */
function onlyKeys(body: Record<string, unknown>, keys: readonly string[]): DesignIssue | null {
  const extra = Object.keys(body).filter((k) => !keys.includes(k));
  return extra.length ? bodyIssue(`알 수 없는 항목 ${extra.map((k) => `'${k.slice(0, 40)}'`).join(', ')} (쓸 수 있는 항목: ${keys.join(', ')})`) : null;
}

function dryRunError(body: Record<string, unknown>): DesignIssue | null {
  return body.dryRun === undefined || typeof body.dryRun === 'boolean' ? null : bodyIssue('dryRun 은 true 또는 false 여야 합니다.');
}

function validRev(v: unknown): v is string {
  return typeof v === 'string' && REV.test(v);
}

/** 기술 수정 목록의 겉모양 (속 내용은 GameData 의 checkAbilityPatches 가 검사) */
function patchList(v: unknown): AbilityPatch[] | string {
  if (!Array.isArray(v)) return 'abilities 는 기술 수정의 배열이어야 합니다.';
  if (v.length > DESIGN_LIMITS.patches) return `기술 수정은 한 번에 ${formatNumber(DESIGN_LIMITS.patches)}개까지입니다.`;
  if (!v.every((x) => isObj(x) && typeof x.id === 'string')) return '기술 수정은 { "id": 기술 id, ... } 모양의 객체여야 합니다.';
  return v as AbilityPatch[];
}

function isAbilitySnapshot(v: unknown): v is AbilitySnapshot {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.desc === 'string' &&
    typeof v.mp === 'number' &&
    typeof v.cooldownMs === 'number' &&
    typeof v.level === 'number' &&
    typeof v.price === 'number'
  );
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 임시 파일에 쓰고 이름을 바꿔, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 합니다 */
function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
