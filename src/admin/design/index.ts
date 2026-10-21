// 관리자 페이지 "직업·스킬트리" 탭: 스킬트리 편집(격자·속성·게임 화면 미리보기)과 성장 규칙(전직·2차 전직, 승급·교환, 어빌·숙련도).
// 고칠 때마다 서버의 검사를 실시간으로 돌려 문제를 그 자리에 보여 주고, 저장하면 서버가 파일에 쓰고 판 기록을 남기며 바로 반영합니다.
// 편집 중인 상태는 탭을 옮겨도 남아 있습니다 (새로 고침·창 닫기 전에는 묻습니다).
import { h } from '../../client/ui/dom';
import { CLASS_IDS } from '../../shared/constants';
import { issueRow, type Ctx } from './ctx';
import { showChanges, showConflict, showHistory } from './dialogs';
import { renderAscend, renderGrowth, renderLineage } from './prog-view';
import { DesignStore, parseWhere, type Request, type View } from './state';
import { renderTreeView, treeKey } from './tree-view';
import { keepFocus } from './util';

export interface DesignDeps {
  request: Request;
  toast(msg: string, ok?: boolean): void;
}

let store: DesignStore | null = null;
let current: Ctx | null = null;

/** 탭을 열 때마다 부름 (처음이면 서버에서 불러오고, 저장하지 않은 바뀐 곳이 없으면 새로 불러옴) */
export async function renderDesign(main: HTMLElement, deps: DesignDeps): Promise<void> {
  if (!store) {
    store = new DesignStore(deps.request, { toast: deps.toast });
    await store.load();
    installGlobalKeys();
  } else if (!store.dirty && !store.saving) {
    await store.reload();
  }
  mount(main, store, deps);
}

/** 저장하지 않은 바뀐 곳이 있는지 (다른 탭으로 갈 때 알림용) */
export function designDirty(): boolean {
  return store?.dirty ?? false;
}

function mount(main: HTMLElement, s: DesignStore, deps: DesignDeps): void {
  const root = h('div', { class: 'dz' });
  main.replaceChildren(root);
  let lives: { el: HTMLElement | SVGElement; update: (el: never) => void }[] = [];
  let raf = 0;
  const ctx: Ctx = {
    store: s,
    toast: deps.toast,
    render: () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    },
    live: (el, update) => {
      lives.push({ el, update: update as (el: never) => void });
      update(el);
      return el;
    },
  };
  current = ctx;
  const draw = () => {
    if (!root.isConnected) return;
    lives = [];
    keepFocus(root, () => root.replaceChildren(subbar(ctx), banner(ctx), body(ctx)));
    if (s.focusNext) {
      const el = root.querySelector<HTMLElement>(`[data-k="${CSS.escape(s.focusNext)}"]`);
      s.focusNext = null;
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      }
    }
  };
  s.bind(
    () => ctx.render(),
    () => {
      for (const l of lives) if (l.el.isConnected) l.update(l.el as never);
    },
  );
  draw();
}

function body(ctx: Ctx): HTMLElement {
  switch (ctx.store.view) {
    case 'tree':
      return renderTreeView(ctx);
    case 'lineage':
      return renderLineage(ctx);
    case 'ascend':
      return renderAscend(ctx);
    case 'growth':
      return renderGrowth(ctx);
  }
}

/** 보기 고르기 + 저장 상태 + 되돌리기·다시 하기·바뀐 곳·판 기록·저장 */
function subbar(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const seg = (v: View, label: string, prefixes: string[] | null) => {
    const count = ctx.live(h('span', { class: 'dz-count' }), (el) => {
      const list = s.issues.filter((i) => {
        const r = parseWhere(i.where);
        if (prefixes === null) return r.file === 'skilltrees' || r.file === 'abilities';
        return r.file === 'progression' && prefixes.some((p) => r.path === p || r.path?.startsWith(`${p}.`) || r.path?.startsWith(`${p}[`));
      });
      const errors = list.filter((i) => i.level === 'error').length;
      el.textContent = errors ? String(errors) : '';
      el.className = `dz-count${errors ? ' error' : ''}`;
      el.title = errors ? `오류 ${errors}개` : '';
    });
    const dirty = v === 'tree' ? CLASS_IDS.some((c) => s.treeDirty(c)) || s.patches().length > 0 : s.progressionDirty() && sectionDirty(ctx, prefixes ?? []);
    return h(
      'button',
      {
        type: 'button',
        'aria-pressed': s.view === v ? 'true' : 'false',
        onclick: () => {
          s.view = v;
          s.sel = null;
          ctx.render();
        },
      },
      label,
      dirty ? h('span', { class: 'dz-dirty', title: '저장하지 않은 변경' }, ' ●') : null,
      count,
    );
  };
  const status = ctx.live(h('span', { class: 'dz-status' }), (el) => {
    const n = s.changes().length;
    el.className = `dz-status${s.saving ? ' busy' : n ? ' dirty' : ''}`;
    el.textContent = s.saving ? '저장하는 중…' : n ? `저장하지 않은 바뀐 곳 ${n}` : '저장됨';
  });
  const save = ctx.live(
    h('button', { class: 'btn primary', type: 'button', title: '저장 (Ctrl+S)', onclick: () => void doSave(ctx) }, '저장'),
    (el) => {
      const errors = s.errorCount;
      el.disabled = s.saving || !s.dirty || errors > 0;
      el.title = errors > 0 ? `검사 오류 ${errors}개를 먼저 고쳐 주세요` : s.dirty ? '저장하고 게임에 바로 반영 (Ctrl+S)' : '바뀐 곳이 없습니다';
    },
  );
  return h(
    'div',
    { class: 'dz-subbar' },
    h('div', { class: 'dz-seg', role: 'group', 'aria-label': '보기' }, seg('tree', '스킬트리', null), seg('lineage', '전직·2차 전직', ['rebirth', 'second']), seg('ascend', '승급·교환', ['ascend']), seg('growth', '어빌·숙련도', ['ability', 'proficiency'])),
    h('span', { class: 'dz-spacer' }),
    status,
    h('button', { class: 'btn', type: 'button', title: '되돌리기 (Ctrl+Z)', disabled: !s.canUndo, onclick: () => s.undo() || ctx.toast('되돌릴 것이 없습니다.') }, '되돌리기'),
    h('button', { class: 'btn', type: 'button', title: '다시 하기 (Ctrl+Y)', disabled: !s.canRedo, onclick: () => s.redo() || ctx.toast('다시 할 것이 없습니다.') }, '다시 하기'),
    h('button', { class: 'btn', type: 'button', onclick: () => showChanges(ctx) }, '바뀐 곳 보기'),
    h('button', { class: 'btn', type: 'button', onclick: () => void showHistory(ctx) }, '판 기록'),
    save,
  );
}

/** 성장 규칙의 이 부분(prefixes)이 바뀌었는지 */
function sectionDirty(ctx: Ctx, prefixes: string[]): boolean {
  const s = ctx.store;
  const a = s.base.progression as unknown as Record<string, unknown>;
  const b = s.doc.progression as unknown as Record<string, unknown>;
  return prefixes.some((p) => JSON.stringify(a[p]) !== JSON.stringify(b[p]));
}

/** 그사이 다른 저장, 어느 칸에도 속하지 않는 문제 */
function banner(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  return ctx.live(h('div', { class: 'dz-banner' }), (el) => {
    const general = s.issues.filter((i) => {
      const r = parseWhere(i.where);
      return r.file === 'other' || (r.file === 'skilltrees' && !r.cls) || (r.file === 'progression' && !r.path) || (r.file === 'abilities' && !r.ability);
    });
    el.replaceChildren(
      ...(s.stale
        ? [
            h(
              'div',
              { class: 'dz-issue warn' },
              h('b', null, '알림'),
              h('span', null, '이 편집기를 연 뒤에 다른 곳에서 설계를 저장했습니다. 저장하면 겹쳤다고 알려 드립니다.'),
              h('button', { class: 'btn small', type: 'button', onclick: () => void reloadAsk(ctx) }, '새로 불러오기'),
            ),
          ]
        : []),
      ...general.map((i) => issueRow(i)),
    );
    el.hidden = el.childElementCount === 0;
  });
}

async function reloadAsk(ctx: Ctx): Promise<void> {
  const s = ctx.store;
  if (s.dirty && !window.confirm('저장하지 않은 바뀐 곳을 버리고 서버의 설계를 새로 불러올까요?')) return;
  await s.reload();
  ctx.toast('서버의 설계를 새로 불러왔습니다.');
}

async function doSave(ctx: Ctx): Promise<void> {
  const s = ctx.store;
  // 입력 중이던 칸의 값을 먼저 반영 (change 이벤트)
  (document.activeElement as HTMLElement | null)?.blur();
  await new Promise((r) => setTimeout(r, 0));
  if (!s.dirty) return ctx.toast('저장할 바뀐 곳이 없습니다.');
  if (s.errorCount > 0) return ctx.toast(`검사 오류 ${s.errorCount}개를 먼저 고쳐 주세요.`, false);
  const r = await s.save();
  if (r === 'conflict') showConflict(ctx);
}

/** 단축키: Ctrl+Z 되돌리기, Ctrl+Y·Ctrl+Shift+Z 다시 하기, Ctrl+S 저장, Delete·화살표(스킬트리) */
function installGlobalKeys(): void {
  document.addEventListener('keydown', (e) => {
    const ctx = current;
    if (!ctx || !document.querySelector('.dz') || document.querySelector('dialog.dz-dialog[open]')) return;
    const t = e.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') {
      e.preventDefault();
      void doSave(ctx);
      return;
    }
    if (typing) return;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) ctx.store.redo();
      else ctx.store.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      ctx.store.redo();
      return;
    }
    if (!mod && treeKey(ctx, e)) e.preventDefault();
  });
  window.addEventListener('beforeunload', (e) => {
    if (store?.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
