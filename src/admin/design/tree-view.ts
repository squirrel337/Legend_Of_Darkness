// 스킬트리 편집 화면: 왼쪽 직업 목록과 트리에 없는 기술, 가운데 격자(줄 = 필요 레벨·어빌 단계, 칸 = 갈래),
// 오른쪽 속성 칸(panels.ts). 노드를 끌어 옮기고, 노드 아래 점을 다른 노드로 끌어 선수과목으로 잇고,
// 화살표를 눌러 필요 숙련도를 고치거나 지웁니다. 미리보기는 preview.ts.
import { h } from '../../client/ui/dom';
import { circleOf, type ClassId } from '../../shared/constants';
import { bigNumber, classTier, FIRST_CLASSES, SECOND_CLASSES, TREE_MAX_COLS, TREE_MAX_ROWS, type SkillTreeConfig, type SkillTreeNode } from '../../shared/progression';
import { card, issueRow, type Ctx } from './ctx';
import { nodeActions, renderPanel } from './panels';
import { renderPreview, renderPreviewSide } from './preview';
import { parseWhere, type DesignStore } from './state';
import { clamp, josa, shortGold, svg } from './util';

// 격자 크기 (px)
export const COLW = 160;
export const ROWH = 112;
export const GUT = 92;
export const TOP = 30;
export const NW = 144;
export const NH = 66;

/** 그릴 줄·칸 수: 놓인 노드보다 한 줄·한 칸 더 (옮길 자리) */
export function gridSize(tree: SkillTreeConfig): { rows: number; cols: number } {
  let maxRow = -1;
  let maxCol = -1;
  for (const n of tree.nodes) {
    maxRow = Math.max(maxRow, n.row);
    maxCol = Math.max(maxCol, n.col);
  }
  return {
    rows: clamp(maxRow + 2, 3, TREE_MAX_ROWS),
    cols: clamp(Math.max(maxCol + 2, tree.columns?.length ?? 0), 4, TREE_MAX_COLS),
  };
}

export const cellPos = (row: number, col: number) => ({ x: GUT + col * COLW + (COLW - NW) / 2, y: TOP + row * ROWH + (ROWH - NH) / 2 });

/** 이 직업 트리의 문제인지 (스킬트리 자리나 이 직업 기술의 값) */
export function classIssue(store: DesignStore, cls: ClassId) {
  return (r: ReturnType<typeof parseWhere>) =>
    (r.file === 'skilltrees' && r.cls === cls) || (r.file === 'abilities' && r.ability !== undefined && store.def(r.ability)?.classId === cls);
}

export function renderTreeView(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  return h(
    'div',
    { class: 'dz-work' },
    classList(ctx),
    h('div', { class: 'dz-center' }, toolbar(ctx), s.preview ? renderPreview(ctx) : board(ctx), s.preview ? null : issuesCard(ctx)),
    h('aside', { class: 'dz-card dz-props', 'aria-label': '속성' }, ...(s.preview ? renderPreviewSide(ctx) : renderPanel(ctx))),
  );
}

// ───────────────────────── 왼쪽: 직업 목록 ─────────────────────────

function classList(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const pick = (c: ClassId) => {
    s.cls = c;
    s.sel = null;
    ctx.render();
  };
  const item = (c: ClassId) => {
    const from = classTier(c) === 2 ? s.doc.progression.second.from[c as (typeof SECOND_CLASSES)[number]].map((f) => s.className(f)).join('·') : '';
    const inIssue = classIssue(s, c);
    const badge = ctx.live(h('span', { class: 'dz-count' }), (el) => {
      const list = s.issues.filter((i) => inIssue(parseWhere(i.where)));
      const errors = list.filter((i) => i.level === 'error').length;
      el.textContent = errors ? String(errors) : list.length ? String(list.length) : '';
      el.className = `dz-count${errors ? ' error' : list.length ? ' warn' : ''}`;
      el.title = errors ? `오류 ${errors}개` : list.length ? `경고 ${list.length}개` : '';
    });
    return h(
      'button',
      { class: 'dz-cbtn', type: 'button', 'aria-current': s.cls === c ? 'true' : 'false', onclick: () => pick(c) },
      h('span', { class: 'dz-dot', style: `background:${s.classColor(c)}` }),
      h('span', { class: 'dz-cname' }, s.className(c)),
      s.treeDirty(c) ? h('span', { class: 'dz-dirty', title: '저장하지 않은 변경이 있습니다' }, '●') : null,
      badge,
      from ? h('span', { class: 'dz-from' }, `← ${from}`) : null,
    );
  };
  const placed = new Set(s.doc.trees[s.cls].nodes.map((n) => n.ability));
  const unplaced = s.bundle.abilities.filter((a) => a.classId === s.cls && !placed.has(a.id));
  return h(
    'div',
    { class: 'dz-card dz-classes' },
    h('h4', null, '평민'),
    h('div', { class: 'dz-clist' }, item('peasant')),
    h('h4', null, '1차 직업'),
    h('div', { class: 'dz-clist' }, ...FIRST_CLASSES.map(item)),
    h('h4', null, '2차 직업'),
    h('div', { class: 'dz-clist' }, ...SECOND_CLASSES.map(item)),
    h('h4', null, `트리에 없는 ${s.className(s.cls)} 기술`),
    unplaced.length
      ? h(
          'div',
          { class: 'dz-palette' },
          ...unplaced.map((a) =>
            h(
              'div',
              { class: 'dz-pal' },
              h('span', null, `${s.abilityName(a.id)} · ${classTier(s.cls) === 2 ? '어빌' : 'Lv'} ${a.level}`),
              h('button', { class: 'btn small', type: 'button', onclick: () => placeAbility(ctx, a.id) }, '놓기'),
            ),
          ),
        )
      : h('p', { class: 'dz-hint' }, '이 직업의 기술이 모두 트리에 있습니다.'),
    h('p', { class: 'dz-hint' }, '새 기술은 gamedata/abilities.json 에 효과와 함께 만든 뒤 여기서 트리에 놓습니다.'),
  );
}

// ───────────────────────── 위: 도구 줄 ─────────────────────────

function toolbar(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const seg = (on: boolean, label: string, fn: () => void) => h('button', { type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label);
  return h(
    'div',
    { class: 'dz-toolbar' },
    h(
      'div',
      { class: 'dz-seg', role: 'group', 'aria-label': '편집 또는 미리보기' },
      seg(!s.preview, '편집', () => {
        s.preview = false;
        ctx.render();
      }),
      seg(s.preview, '게임 화면 미리보기', () => {
        s.preview = true;
        ctx.render();
      }),
    ),
    h('span', { class: 'dz-spacer' }),
    s.preview
      ? null
      : h('button', { class: 'btn small', type: 'button', title: '줄을 필요 레벨(어빌) 순서의 단계로 다시 나눕니다 (칸은 되도록 그대로)', onclick: () => arrangeByLevel(ctx) }, '레벨 순으로 줄 정리'),
    s.preview ? null : h('span', { class: 'dz-hint' }, '끌어서 옮기기 · 아래 점을 다른 기술로 끌면 선수과목 · 화살표를 누르면 숙련도'),
  );
}

// ───────────────────────── 가운데: 격자 ─────────────────────────

function board(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const cls = s.cls;
  const tree = s.doc.trees[cls];
  const tier = classTier(cls);
  const { rows, cols } = gridSize(tree);
  const W = GUT + cols * COLW + 16;
  const H = TOP + rows * ROWH + 12;
  const el = h('div', { class: 'dz-board', style: `width:${W}px;height:${H}px` });
  for (let r = 0; r < rows; r++) {
    el.append(h('div', { class: `dz-band${r % 2 ? ' odd' : ''}`, style: `top:${TOP + r * ROWH}px;height:${ROWH}px` }));
    const inRow = tree.nodes.filter((n) => n.row === r);
    const needs = [...new Set(inRow.map((n) => s.need(cls, n)))].sort((a, b) => a - b);
    const label = needs.length ? `${tier === 2 ? '어빌' : 'Lv'} ${needs.join('·')}` : '';
    const sub = needs.length === 1 && tier !== 2 ? `${circleOf(needs[0]!)}서클 · 줄 ${r}` : `줄 ${r}`;
    el.append(
      h(
        'div',
        {
          class: `dz-rowlabel${needs.length > 1 ? ' mixed' : ''}`,
          style: `top:${TOP + r * ROWH}px;height:${ROWH}px`,
          title: needs.length > 1 ? '이 줄에 필요 레벨이 다른 기술이 섞여 있습니다. 끌어 옮기면 그 줄의 레벨로 맞춥니다.' : '',
        },
        h('b', null, label || '—'),
        h('small', null, sub),
        h(
          'span',
          { class: 'dz-rowtools' },
          h('button', { type: 'button', title: '이 줄 위에 빈 줄 넣기', 'data-rowtool': 'insert', 'data-row': String(r) }, '+'),
          inRow.length === 0 ? h('button', { type: 'button', title: '빈 줄 지우기', 'data-rowtool': 'remove', 'data-row': String(r) }, '−') : null,
        ),
      ),
    );
  }
  for (let c = 0; c < cols; c++) {
    const title = tree.columns?.[c];
    if (title) el.append(h('div', { class: 'dz-colhead', style: `left:${GUT + c * COLW}px;width:${COLW}px` }, title));
  }
  const edges = svg('svg', { class: 'dz-edges', width: W, height: H, 'aria-hidden': 'true' });
  el.append(edges);
  drawEdges(ctx, edges, tree);
  for (const n of tree.nodes) el.append(nodeEl(ctx, n));
  const wrap = h('div', { class: 'dz-board-wrap', 'data-scroll': `board-${cls}` }, el);
  wrap.addEventListener('pointerdown', (e) => onPointerDown(ctx, e, wrap));
  wrap.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rowtool]');
    if (b) rowTool(ctx, b.dataset.rowtool!, Number(b.dataset.row));
  });
  return wrap;
}

function nodeEl(ctx: Ctx, n: SkillTreeNode): HTMLElement {
  const s = ctx.store;
  const cls = s.cls;
  const def = s.def(n.ability);
  const name = s.abilityName(n.ability);
  const p = cellPos(n.row, n.col);
  const sel = s.sel?.type === 'node' && s.sel.id === n.ability;
  const cross = n.requires.filter((r) => !s.node(cls, r.ability));
  const tags: HTMLElement[] = [];
  if (def?.kind === 'spell') tags.push(h('span', { class: 'dz-tag spell' }, '마법'));
  if (n.items.length) tags.push(h('span', { class: 'dz-tag', title: n.items.map((x) => `${s.itemName(x.item)} ${x.qty}개`).join(', ') }, `재료 ${n.items.length}`));
  if (n.stats && Object.keys(n.stats).length) tags.push(h('span', { class: 'dz-tag' }, '능력치'));
  if (n.beastType) tags.push(h('span', { class: 'dz-tag beast' }, s.beastName(n.beastType)));
  const need = s.need(cls, n);
  const el = h(
    'div',
    {
      class: `dz-node${sel ? ' sel' : ''}`,
      'data-id': n.ability,
      style: `left:${p.x}px;top:${p.y}px`,
      tabindex: '0',
      role: 'button',
      'data-k': `node:${n.ability}`,
      'aria-label': `${name}, ${classTier(cls) === 2 ? '어빌' : '레벨'} ${need}`,
    },
    h('span', { class: 'dz-ico', style: `--ic:${def?.icon.color ?? '#777'}` }, name.slice(0, 1)),
    h('div', { class: 'dz-nm', title: name }, name),
    h('div', { class: 'dz-meta', title: `${classTier(cls) === 2 ? '필요 어빌' : '필요 레벨'} ${need}, ${bigNumber(n.gold)} 골드` }, `${classTier(cls) === 2 ? '어빌' : 'Lv'} ${need} · ${shortGold(n.gold)}골드`),
    tags.length ? h('div', { class: 'dz-tags' }, ...tags) : null,
    cross.length
      ? h(
          'span',
          { class: 'dz-cross', title: `다른 직업의 선수과목: ${cross.map((r) => `${s.abilityName(r.ability)} 숙련도 ${r.prof}`).join(', ')}` },
          `↖ ${s.abilityName(cross[0]!.ability)} ${cross[0]!.prof}${cross.length > 1 ? ` +${cross.length - 1}` : ''}`,
        )
      : null,
    h('span', { class: 'dz-handle', 'data-handle': n.ability, title: '끌어서 다른 기술에 놓으면 이 기술이 그 기술의 선수과목이 됩니다' }),
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      s.sel = { type: 'node', id: n.ability };
      ctx.render();
    }
  });
  const mine = (r: ReturnType<typeof parseWhere>) => (r.file === 'skilltrees' && r.cls === cls && r.ability === n.ability) || (r.file === 'abilities' && r.ability === n.ability);
  return ctx.live(el, (e) => {
    const list = s.issues.filter((i) => mine(parseWhere(i.where)));
    e.classList.toggle('err', list.some((i) => i.level === 'error'));
    e.classList.toggle('warn', !list.some((i) => i.level === 'error') && list.length > 0);
  });
}

/** 선수과목 화살표의 베지어 조절점: 앞 노드 아래의 잇는 점 밑에서 시작해 뒤 노드 위쪽 가운데로 */
function edgeCurve(a: { x: number; y: number }, b: { x: number; y: number }): [number, number][] {
  const sx = a.x + NW / 2;
  const sy = a.y + NH + 8;
  const tx = b.x + NW / 2;
  const ty = b.y - 1;
  const dy = Math.max(28, Math.abs(ty - sy) / 2);
  return [
    [sx, sy],
    [sx, sy + dy],
    [tx, ty - dy],
    [tx, ty],
  ];
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const [p0, p1, p2, p3] = edgeCurve(a, b);
  return `M ${p0![0]} ${p0![1]} C ${p1![0]} ${p1![1]}, ${p2![0]} ${p2![1]}, ${p3![0]} ${p3![1]}`;
}

/** 곡선 위 t (0~1) 자리: 숙련도 글씨를 뒤 노드 쪽에 두어, 한 기술에서 여러 갈래로 나가도 글씨가 겹치지 않게 */
function edgePoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): [number, number] {
  const [p0, p1, p2, p3] = edgeCurve(a, b) as [[number, number], [number, number], [number, number], [number, number]];
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [f(0), f(1)];
}

function drawEdges(ctx: Ctx, el: SVGSVGElement, tree: SkillTreeConfig): void {
  const s = ctx.store;
  const cls = s.cls;
  const defs = svg('defs');
  for (const [id, cls2] of [
    ['dz-ar', 'dz-arrow'],
    ['dz-ar-sel', 'dz-arrow sel'],
    ['dz-ar-late', 'dz-arrow late'],
  ] as const) {
    defs.append(
      svg(
        'marker',
        { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
        svg('path', { d: 'M0,0 L10,5 L0,10 z', class: cls2 }),
      ),
    );
  }
  el.append(defs);
  for (const n of tree.nodes) {
    for (const r of n.requires) {
      const p = tree.nodes.find((x) => x.ability === r.ability);
      if (!p) continue;
      const a = cellPos(p.row, p.col);
      const b = cellPos(n.row, n.col);
      const d = edgePath(a, b);
      const sel = s.sel?.type === 'edge' && s.sel.from === p.ability && s.sel.to === n.ability;
      const late = s.need(cls, p) > s.need(cls, n);
      el.append(svg('path', { d, class: `dz-e${sel ? ' sel' : ''}${late ? ' late' : ''}`, 'marker-end': `url(#${sel ? 'dz-ar-sel' : late ? 'dz-ar-late' : 'dz-ar'})` }));
      const hit = svg('path', { d, class: 'dz-hit' });
      hit.append(svg('title', {}, `${s.abilityName(p.ability)} → ${s.abilityName(n.ability)}: 숙련도 ${r.prof} 이상${late ? ' (선수과목이 더 늦게 열림)' : ''}`));
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        s.sel = { type: 'edge', from: p.ability, to: n.ability };
        ctx.render();
      });
      el.append(hit);
      if (r.prof > 0 || sel) {
        const [mx, my] = edgePoint(a, b, 0.66);
        el.append(svg('text', { x: mx + 7, y: my + 4, class: `dz-elabel${sel ? ' sel' : ''}` }, r.prof > 0 ? `숙련 ${r.prof}` : '배움'));
      }
    }
  }
}

// ───────────────────────── 끌기: 옮기기와 잇기 ─────────────────────────

interface Drag {
  kind: 'move' | 'link';
  id: string;
  start: { x: number; y: number };
  el: HTMLElement;
  ox: number;
  oy: number;
  moved: boolean;
  ghost?: HTMLElement;
  line?: SVGPathElement;
}

function boardPoint(wrap: HTMLElement, e: PointerEvent): { x: number; y: number } {
  const r = wrap.getBoundingClientRect();
  return { x: e.clientX - r.left + wrap.scrollLeft, y: e.clientY - r.top + wrap.scrollTop };
}

/** 노드 왼쪽 위 좌표 → 놓일 칸 */
function cellAt(ctx: Ctx, x: number, y: number): { row: number; col: number } {
  const { rows, cols } = gridSize(ctx.store.doc.trees[ctx.store.cls]);
  return {
    col: clamp(Math.floor((x + NW / 2 - GUT) / COLW), 0, Math.min(TREE_MAX_COLS - 1, cols - 1)),
    row: clamp(Math.floor((y + NH / 2 - TOP) / ROWH), 0, Math.min(TREE_MAX_ROWS - 1, rows - 1)),
  };
}

function onPointerDown(ctx: Ctx, e: PointerEvent, wrap: HTMLElement): void {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest('[data-rowtool]')) return;
  const nodeEl = t.closest<HTMLElement>('.dz-node');
  const s = ctx.store;
  if (!nodeEl) {
    if (!t.closest('.dz-hit') && s.sel) {
      s.sel = null;
      ctx.render();
    }
    return;
  }
  e.preventDefault();
  const id = nodeEl.dataset.id!;
  // 속성 칸에서 고치던 값이 있으면 먼저 반영하고(change), 이번 누름은 고르기만 (다시 그리면 끌던 노드가 바뀌므로)
  const v = s.version;
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== nodeEl && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur();
  if (s.version !== v) {
    s.sel = { type: 'node', id };
    return ctx.render();
  }
  const n = s.node(s.cls, id);
  if (!n) return;
  const start = boardPoint(wrap, e);
  const pos = cellPos(n.row, n.col);
  const drag: Drag = { kind: t.closest('[data-handle]') ? 'link' : 'move', id, start, el: nodeEl, ox: start.x - pos.x, oy: start.y - pos.y, moved: false };
  nodeEl.setPointerCapture(e.pointerId);
  const board = wrap.firstElementChild as HTMLElement;
  const move = (ev: PointerEvent) => {
    const pt = boardPoint(wrap, ev);
    // 가장자리 가까이에서는 저절로 스크롤
    const r = wrap.getBoundingClientRect();
    if (ev.clientY > r.bottom - 36) wrap.scrollTop += 14;
    else if (ev.clientY < r.top + 36) wrap.scrollTop -= 14;
    if (ev.clientX > r.right - 36) wrap.scrollLeft += 14;
    else if (ev.clientX < r.left + 36) wrap.scrollLeft -= 14;
    if (!drag.moved && Math.hypot(pt.x - start.x, pt.y - start.y) < 5) return;
    drag.moved = true;
    if (drag.kind === 'move') {
      nodeEl.classList.add('dragging');
      nodeEl.style.left = `${pt.x - drag.ox}px`;
      nodeEl.style.top = `${pt.y - drag.oy}px`;
      const cell = cellAt(ctx, pt.x - drag.ox, pt.y - drag.oy);
      const g = cellPos(cell.row, cell.col);
      if (!drag.ghost) {
        drag.ghost = h('div', { class: 'dz-drop' });
        board.insertBefore(drag.ghost, board.firstChild?.nextSibling ?? null);
      }
      drag.ghost.style.left = `${g.x}px`;
      drag.ghost.style.top = `${g.y}px`;
    } else {
      const svgEl = board.querySelector<SVGSVGElement>('svg.dz-edges')!;
      if (!drag.line) {
        drag.line = svg('path', { class: 'dz-tmp' });
        svgEl.append(drag.line);
      }
      drag.line.setAttribute('d', `M ${pos.x + NW / 2} ${pos.y + NH + 8} L ${pt.x} ${pt.y}`);
      for (const o of board.querySelectorAll('.dz-node.target')) o.classList.remove('target');
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.dz-node');
      if (under && under !== nodeEl) under.classList.add('target');
    }
  };
  const end = (ev: PointerEvent, cancelled: boolean) => {
    nodeEl.removeEventListener('pointermove', move);
    nodeEl.removeEventListener('pointerup', up);
    nodeEl.removeEventListener('pointercancel', cancel);
    try {
      nodeEl.releasePointerCapture(ev.pointerId);
    } catch {
      /* 이미 풀림 */
    }
    if (cancelled) return ctx.render();
    if (!drag.moved) {
      s.sel = { type: 'node', id };
      return ctx.render();
    }
    if (drag.kind === 'move') {
      const pt = boardPoint(wrap, ev);
      const cell = cellAt(ctx, pt.x - drag.ox, pt.y - drag.oy);
      moveNode(ctx, id, cell.row, cell.col);
      s.sel = { type: 'node', id };
      return ctx.render();
    }
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.dz-node');
    if (!under || under.dataset.id === id) return ctx.render();
    link(ctx, id, under.dataset.id!);
  };
  const up = (ev: PointerEvent) => end(ev, false);
  const cancel = (ev: PointerEvent) => end(ev, true);
  nodeEl.addEventListener('pointermove', move);
  nodeEl.addEventListener('pointerup', up);
  nodeEl.addEventListener('pointercancel', cancel);
}

/** from 을 to 의 선수과목으로 잇습니다 (돌고 도는 연결은 막음) */
export function link(ctx: Ctx, from: string, to: string): void {
  const s = ctx.store;
  const cls = s.cls;
  const target = s.node(cls, to);
  if (!target) return ctx.render();
  if (target.requires.some((r) => r.ability === from)) {
    ctx.toast('이미 이어져 있습니다.', false);
    return ctx.render();
  }
  if (s.requiresChain(from, to)) {
    ctx.toast(`${josa(s.abilityName(from), '은', '는')} 이미 ${josa(s.abilityName(to), '을', '를')} 거쳐야 배울 수 있어서, 이으면 선수과목이 돌고 돕니다.`, false);
    return ctx.render();
  }
  s.mutate((d) => d.trees[cls].nodes.find((n) => n.ability === to)!.requires.push({ ability: from, prof: 0 }));
  s.sel = { type: 'edge', from, to };
  s.focusNext = 'edge.prof';
  ctx.toast(`${s.abilityName(to)}의 선수과목으로 ${josa(s.abilityName(from), '을', '를')} 이었습니다. 필요 숙련도를 정해 주세요.`);
  ctx.render();
}

/**
 * 노드를 (row, col) 칸으로 옮깁니다. 그 칸에 다른 노드가 있으면 자리를 바꿉니다.
 * 줄은 필요 레벨(어빌) 단계이므로, 옮긴 줄의 다른 기술들이 모두 같은 레벨이면 그 레벨로 맞춥니다.
 */
export function moveNode(ctx: Ctx, id: string, row: number, col: number): void {
  const s = ctx.store;
  const cls = s.cls;
  const tier = classTier(cls);
  const notes: string[] = [];
  s.mutate((d) => {
    const t = d.trees[cls];
    const n = t.nodes.find((x) => x.ability === id);
    if (!n || (n.row === row && n.col === col)) return;
    const other = t.nodes.find((x) => x !== n && x.row === row && x.col === col);
    if (other) {
      other.row = n.row;
      other.col = n.col;
    }
    n.row = row;
    n.col = col;
    for (const x of other ? [n, other] : [n]) {
      const needs = new Set(t.nodes.filter((o) => o !== x && o.row === x.row).map((o) => s.need(cls, o)));
      if (needs.size !== 1) continue;
      const v = [...needs][0]!;
      if (s.need(cls, x) === v) continue;
      if (tier === 2) x.abilityLevel = v;
      else x.level = v;
      notes.push(`${s.abilityName(x.ability)} → ${tier === 2 ? '어빌' : '레벨'} ${v}`);
    }
  });
  if (notes.length) ctx.toast(`줄의 단계에 맞춰 필요 ${tier === 2 ? '어빌' : '레벨'}을 바꿨습니다: ${notes.join(', ')} (되돌리기 Ctrl+Z)`);
}

/** 줄 넣기·빈 줄 지우기 */
function rowTool(ctx: Ctx, tool: string, row: number): void {
  const s = ctx.store;
  const cls = s.cls;
  const tree = s.doc.trees[cls];
  if (tool === 'insert') {
    if (tree.nodes.some((n) => n.row >= TREE_MAX_ROWS - 1)) return ctx.toast(`줄은 ${TREE_MAX_ROWS}개까지입니다.`, false);
    s.mutate((d) => {
      for (const n of d.trees[cls].nodes) if (n.row >= row) n.row++;
    });
  } else if (tool === 'remove') {
    if (tree.nodes.some((n) => n.row === row)) return;
    s.mutate((d) => {
      for (const n of d.trees[cls].nodes) if (n.row > row) n.row--;
    });
  }
}

/** 줄을 필요 레벨(어빌) 순서의 단계로 다시 나눕니다 (같은 레벨은 한 줄, 칸은 되도록 그대로) */
function arrangeByLevel(ctx: Ctx): void {
  const s = ctx.store;
  const cls = s.cls;
  const changed = s.mutate((d) => {
    const t = d.trees[cls];
    const needs = [...new Set(t.nodes.map((n) => s.need(cls, n)))].sort((a, b) => a - b);
    const taken = new Set<string>();
    for (const n of [...t.nodes].sort((a, b) => a.row - b.row || a.col - b.col)) {
      const row = Math.min(TREE_MAX_ROWS - 1, needs.indexOf(s.need(cls, n)));
      let col = n.col;
      while (taken.has(`${row},${col}`) && col < TREE_MAX_COLS - 1) col++;
      if (taken.has(`${row},${col}`)) {
        col = 0;
        while (taken.has(`${row},${col}`)) col++;
      }
      taken.add(`${row},${col}`);
      n.row = row;
      n.col = col;
    }
  });
  ctx.toast(changed ? '줄을 레벨 순서로 정리했습니다. (되돌리기 Ctrl+Z)' : '이미 레벨 순서대로입니다.');
}

/** 트리에 없는 기술을 놓습니다: 그 기술의 기본 레벨과 같은 줄이 있으면 그 줄의 빈칸, 없으면 맨 아래 */
function placeAbility(ctx: Ctx, id: string): void {
  const s = ctx.store;
  const cls = s.cls;
  const def = s.def(id);
  if (!def) return;
  const tier = classTier(cls);
  const level = Math.max(1, def.level);
  s.mutate((d) => {
    const t = d.trees[cls];
    const rows = new Map<number, Set<number>>();
    for (const n of t.nodes) {
      if (!rows.has(n.row)) rows.set(n.row, new Set());
      rows.get(n.row)!.add(s.need(cls, n));
    }
    let row = [...rows].filter(([, v]) => v.size === 1 && v.has(level)).map(([r]) => r)[0];
    if (row === undefined) row = Math.min(TREE_MAX_ROWS - 1, Math.max(-1, ...t.nodes.map((n) => n.row)) + 1);
    let col = 0;
    while (t.nodes.some((n) => n.row === row && n.col === col) && col < TREE_MAX_COLS - 1) col++;
    t.nodes.push({ ability: id, row, col, ...(tier === 2 ? { abilityLevel: level } : { level }), gold: def.price, items: [], requires: [] });
  });
  s.sel = { type: 'node', id };
  ctx.toast(`${josa(s.abilityName(id), '을', '를')} 트리에 놓았습니다.`);
  ctx.render();
}

// ───────────────────────── 아래: 검사 결과 ─────────────────────────

function issuesCard(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const cls = s.cls;
  const inClass = classIssue(s, cls);
  const head = h('h3', null);
  const list = h('div', { class: 'dz-issues' });
  return card(
    null,
    ctx.live(head, (el) => {
      const mine = s.issues.filter((i) => inClass(parseWhere(i.where)));
      const errors = mine.filter((i) => i.level === 'error').length;
      el.replaceChildren(
        `${s.className(cls)} 트리 검사 · 오류 ${errors} · 경고 ${mine.length - errors}`,
        ...(s.checking ? [h('span', { class: 'dz-checking' }, ' 서버에서 검사하는 중…')] : []),
      );
    }),
    ctx.live(list, (el) => {
      const mine = s.issues.filter((i) => inClass(parseWhere(i.where))).sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
      const go = (where: string) => () => {
        const r = parseWhere(where);
        const id = r.ability;
        if (id && s.node(cls, id)) {
          s.sel = { type: 'node', id };
          ctx.render();
        }
      };
      el.replaceChildren(
        ...(mine.length === 0
          ? [h('div', { class: 'dz-issue ok' }, h('b', null, '통과'), h('span', null, '서버의 검사(없는 기술·아이템, 선수과목 순환, 범위, 칸 겹침, 계통)에 걸리는 것이 없습니다.'))]
          : mine.map((i) => issueRow(i, go(i.where)))),
      );
    }),
  );
}

/** 키보드: 고른 노드를 화살표로 옮기기, Delete 로 빼기 (편집 화면에서만) */
export function treeKey(ctx: Ctx, e: KeyboardEvent): boolean {
  const s = ctx.store;
  if (s.view !== 'tree' || s.preview || !s.sel) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    nodeActions(ctx).deleteSelection();
    return true;
  }
  if (s.sel.type !== 'node') return false;
  const dir = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!dir) return false;
  const n = s.node(s.cls, s.sel.id);
  if (!n) return false;
  const row = clamp(n.row + dir[0]!, 0, TREE_MAX_ROWS - 1);
  const col = clamp(n.col + dir[1]!, 0, TREE_MAX_COLS - 1);
  if (row !== n.row || col !== n.col) moveNode(ctx, n.ability, row, col);
  s.focusNext = `node:${n.ability}`;
  ctx.render();
  return true;
}

