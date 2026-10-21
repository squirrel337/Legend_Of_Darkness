// 스킬트리 창 (K): 직업마다 기술 칸 배치(gamedata/skilltrees.json) 위에 배운 기술과 숙련도, 지금 배울 수 있는 기술,
// 잠긴 기술의 모자란 조건을 원작의 가죽·금색 창으로 보여 줍니다. 이 창은 보기만 하고, 배우기는 길드장에게서 합니다.
// 판정은 길드장 창과 같은 learnStatus (클라이언트 상태로 만든 LearnContext) 를 씁니다.
import { CLASS_IDS, MAX_ABILITIES, type ClassId } from '../../shared/constants';
import { learnStatus, type LearnContext, type LearnStatus, type SkillTreeConfig, type SkillTreeNode } from '../../shared/progression';
import type { Game } from '../game';
import { abilityIconUrl } from '../render/icons';
import {
  TREE_NODE,
  beastTypeName,
  classLabel,
  layoutTree,
  nodeLook,
  otherBranch,
  profChanceLine,
  profInfo,
  reqText,
  teacherOf,
  treeNote,
  treeTabs,
  type TreeCell,
  type TreeLayout,
} from '../progression';
import { fmt, h } from './dom';
import { Win } from './windows';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 수인 계통 표시 색 (칸 귀퉁이 점·열 제목) */
const BEAST_COLORS: Record<string, string> = { mammal: '#e0a060', bird: '#8fd0ff', reptile: '#8fe08a' };
const beastColor = (id: string) => BEAST_COLORS[id] ?? '#d9b45a';
/** 창 너비 (px): 트리 너비에 맞추되 이 범위 안에서 */
const TREE_WIN_MIN_W = 620;
const TREE_WIN_MAX_W = 880;

export class SkillTreeWindow {
  private readonly win: Win;
  /** 보고 있는 트리 (null 이면 지금 직업의 트리) */
  private view: ClassId | null = null;
  /** 눌러서 고정한 칸 (기술 id) */
  private pinned: string | null = null;
  /** 마우스를 올린 칸 */
  private hover: string | null = null;
  /** 마지막으로 그린 트리 */
  private treeClass: ClassId | null = null;
  private statuses = new Map<string, LearnStatus>();
  private nodes = new Map<string, SkillTreeNode>();
  private ctx: LearnContext | null = null;
  private info: HTMLElement | null = null;
  private boardWrap: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  /** 다시 그릴 필요가 있는지 가리는 표시 (상태가 같으면 그대로 둠: 마우스 아래 칸이 바뀌지 않게) */
  private drawnKey = '';

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.win = new Win(root, 'win-tree', () => {
      this.hover = null;
      this.drawnKey = '';
    });
  }

  get open(): boolean {
    return this.win.open;
  }

  /** K: 열면 지금 직업의 트리부터 */
  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    if (!on) return this.win.close();
    if (!this.open) {
      this.view = null;
      this.pinned = null;
    }
    this.render(true);
  }

  close(): void {
    this.win.close();
  }

  /** 상태가 바뀌었을 때 (열려 있고 보이는 것이 달라졌으면 다시 그림) */
  refresh(force = false): void {
    if (this.open) this.render(force);
  }

  /** 다른 직업의 트리 보기 */
  private showTree(cls: ClassId): void {
    this.view = cls;
    this.pinned = null;
    this.hover = null;
    this.render(true);
  }

  private render(force: boolean): void {
    const st = this.game.state;
    const s = st.self;
    const ctx = st.learnContext();
    if (!s || !ctx) return;
    const trees = st.data.skillTrees;
    const prog = st.data.progression;
    const tabs = treeTabs(s.classId, ctx.learned, trees, prog.second.from);
    const cls = this.view && trees[this.view] ? this.view : (tabs[0] ?? s.classId);
    const tree: SkillTreeConfig = trees[cls] ?? { nodes: [] };
    // 보이는 것을 정하는 값이 모두 같으면 다시 그리지 않음
    const key = JSON.stringify([cls, s.classId, s.level, s.abilityLevel, s.beastType, s.base, s.prof, st.gold, st.skills, st.spells, st.inventory, tree]);
    if (!force && key === this.drawnKey) return;
    this.drawnKey = key;
    const keep = this.treeClass === cls && this.boardWrap ? { left: this.boardWrap.scrollLeft, top: this.boardWrap.scrollTop } : null;
    this.treeClass = cls;
    this.ctx = ctx;
    this.nodes = new Map(tree.nodes.map((n) => [n.ability, n]));
    this.statuses = new Map(tree.nodes.map((n) => [n.ability, learnStatus(cls, n, ctx)]));
    if (this.pinned && !this.nodes.has(this.pinned)) this.pinned = null;
    if (this.hover && !this.nodes.has(this.hover)) this.hover = null;

    const lay = layoutTree(tree);
    // 창 너비는 트리에 맞춤 (탭·요약 줄이 들어갈 만큼은 넓게, 너무 넓은 트리는 칸 안에서 스크롤)
    this.win.el.style.width = `${Math.min(TREE_WIN_MAX_W, Math.max(TREE_WIN_MIN_W, lay.width + 26))}px`;
    const board = h('div', { class: 'gt-board', style: { width: `${lay.width}px`, height: `${lay.height}px` } });
    this.svg = this.edges(lay, ctx);
    board.appendChild(this.svg);
    for (const hd of lay.heads) {
      const bt = hd.beastType;
      const mine = bt !== undefined && s.beastType === bt;
      const other = bt !== undefined && otherBranch(bt, s.beastType);
      board.appendChild(
        h(
          'div',
          {
            class: `gt-colhead${bt !== undefined ? ' beast' : ''}${mine ? ' mine' : ''}${other ? ' other' : ''}`,
            style: { left: `${hd.x}px`, ...(bt !== undefined ? { borderColor: beastColor(bt), color: beastColor(bt) } : {}) },
            title: bt !== undefined ? `${beastTypeName(bt, prog.second.beastTypes)} 계통 전용${mine ? ' (내 계통)' : ''}` : '',
          },
          hd.title || (bt !== undefined ? beastTypeName(bt, prog.second.beastTypes) : ''),
          mine ? h('small', null, ' ★') : null,
        ),
      );
    }
    for (const r of lay.rows) board.appendChild(h('div', { class: 'gt-rowlabel', style: { top: `${r.y}px` } }, r.label));
    for (const c of lay.cells) board.appendChild(this.nodeEl(c, lay, ctx));
    for (const e of lay.edges) {
      if (e.prof <= 0) continue;
      const has = ctx.learned(e.from);
      const met = has && ctx.prof(e.from) >= e.prof;
      const name = st.abilities.get(e.from)?.name ?? e.from;
      board.appendChild(
        h(
          'div',
          {
            class: `gt-req ${met ? 'on' : has ? 'short' : ''}`,
            style: { left: `${e.badge.x}px`, top: `${e.badge.y}px` },
            title: `${name} 숙련도 ${e.prof} 이상${has ? ` (지금 ${ctx.prof(e.from)})` : ' (배우지 않음)'}`,
          },
          String(e.prof),
        ),
      );
    }
    this.boardWrap = h('div', { class: 'gt-board-wrap' }, board);
    this.info = h('div', { class: 'gt-info' });

    const className = st.className(cls);
    const current = cls === s.classId;
    const learnedN = st.skills.length;
    const spellN = st.spells.length;
    const tabEls = tabs.map((c) =>
      h(
        'button',
        { class: `gt-tab${c === cls ? ' active' : ''}`, onclick: () => this.showTree(c), title: c === s.classId ? '지금 직업' : '' },
        st.className(c),
        c === s.classId ? h('small', null, ' (지금)') : null,
      ),
    );
    // 탭에 없는 직업의 트리도 미리 볼 수 있게 (전직할 직업 고르기 등)
    const others = CLASS_IDS.filter((c) => !tabs.includes(c) && trees[c] && trees[c]!.nodes.length > 0);
    const pick = h(
      'select',
      {
        class: 'gt-other',
        title: '다른 직업의 트리 보기',
        onchange: (e: Event) => {
          const sel = e.target as HTMLSelectElement;
          const v = sel.value as ClassId;
          // 고른 뒤에는 초점을 풀어 K·Esc 가 다시 게임으로 가게
          sel.blur();
          if (v) this.showTree(v);
        },
      },
      h('option', { value: '' }, '다른 직업 보기…'),
      ...others.map((c) => h('option', { value: c, selected: c === cls }, st.className(c))),
    );
    pick.addEventListener('keydown', (e) => e.stopPropagation());
    const summary = [`Lv.${s.level}`, ...(s.abilityLevel > 0 ? [`어빌 ${s.abilityLevel}`] : []), `금화 ${fmt(st.gold)}`, `기술 ${learnedN}/${MAX_ABILITIES}`, `마법 ${spellN}/${MAX_ABILITIES}`];
    const note = treeNote(cls, s, prog, tree, (c) => st.className(c));
    this.win.show(
      `${current ? classLabel(className, s, prog.second.beastTypes) : className} 기술 트리`,
      h('div', { class: 'gt-head' }, h('div', { class: 'gt-tabs' }, ...tabEls), others.length ? pick : null),
      h(
        'div',
        { class: 'gt-sum' },
        h('span', null, summary.join(' · ')),
        h(
          'span',
          { class: 'gt-legend' },
          h('i', { class: 'lg learned' }),
          '배움',
          h('i', { class: 'lg learnable' }),
          '배울 수 있음',
          h('i', { class: 'lg locked' }),
          '잠김',
        ),
      ),
      note ? h('div', { class: 'gt-note' }, note) : null,
      tree.nodes.length ? this.boardWrap : h('div', { class: 'gt-empty' }, '이 직업에는 배울 기술이 없습니다.'),
      this.info,
    );
    if (keep) {
      this.boardWrap.scrollLeft = keep.left;
      this.boardWrap.scrollTop = keep.top;
    }
    this.renderInfo();
    this.highlight();
  }

  /** 선수과목 선 (같은 트리 안): 채웠으면 금색, 아니면 어둡게 */
  private edges(lay: TreeLayout, ctx: LearnContext): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(lay.width));
    svg.setAttribute('height', String(lay.height));
    svg.setAttribute('class', 'gt-lines');
    for (const e of lay.edges) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', e.d);
      const met = ctx.learned(e.from) && ctx.prof(e.from) >= e.prof;
      if (met) path.classList.add('on');
      path.dataset.from = e.from;
      path.dataset.to = e.to;
      svg.appendChild(path);
    }
    return svg;
  }

  private nodeEl(c: TreeCell, lay: TreeLayout, ctx: LearnContext): HTMLElement {
    const st = this.game.state;
    const s = st.self!;
    const id = c.node.ability;
    const def = st.abilities.get(id);
    const status = this.statuses.get(id)!;
    const look = nodeLook(status);
    const other = otherBranch(c.node.beastType, s.beastType);
    const p = profInfo(ctx.prof(id), st.data.progression.proficiency);
    const ext = lay.external[id] ?? [];
    const extMet = ext.every((r) => ctx.learned(r.ability) && ctx.prof(r.ability) >= r.prof);
    const firstExt = ext[0] ? st.abilities.get(ext[0].ability) : undefined;
    const el = h(
      'button',
      {
        class: `gt-node ${look}${other ? ' other' : ''}${this.pinned === id ? ' pinned' : ''}`,
        style: { left: `${c.x}px`, top: `${c.y}px` },
        'aria-label': `${def?.name ?? id} (${look === 'learned' ? `배움, 숙련도 ${p.prof}` : look === 'learnable' ? '배울 수 있음' : '잠김'})`,
        dataset: { id },
        onclick: () => this.pin(id),
        onmouseenter: () => this.setHover(id),
        onmouseleave: () => this.setHover(null),
        onfocus: () => this.setHover(id),
        onblur: () => this.setHover(null),
      },
      def ? h('img', { src: abilityIconUrl(def.icon, TREE_NODE - 4), alt: '', draggable: false }) : h('span', { class: 'gt-missing' }, '?'),
      look === 'learned' ? h('span', { class: `gt-profbar${p.maxed ? ' max' : ''}` }, h('i', { style: { width: `${p.ratio * 100}%` } })) : null,
      look === 'learned' ? h('span', { class: `gt-prof${p.maxed ? ' max' : ''}` }, String(p.prof)) : null,
      c.node.beastType !== undefined ? h('span', { class: 'gt-beast', style: { background: beastColor(c.node.beastType) } }) : null,
      firstExt
        ? h(
            'span',
            { class: `gt-ext ${extMet ? 'on' : 'off'}` },
            h('img', { src: abilityIconUrl(firstExt.icon, 16), alt: '', draggable: false }),
            ext.length > 1 ? h('b', null, `+${ext.length - 1}`) : null,
          )
        : null,
      h('span', { class: 'gt-name' }, def?.name ?? id),
    );
    return el;
  }

  /** 칸을 누르면 그 칸의 정보를 고정 (다시 누르면 풀기) */
  private pin(id: string): void {
    this.pinned = this.pinned === id ? null : id;
    this.boardWrap?.querySelectorAll('.gt-node.pinned').forEach((n) => n.classList.remove('pinned'));
    if (this.pinned) this.boardWrap?.querySelector(`.gt-node[data-id="${CSS.escape(this.pinned)}"]`)?.classList.add('pinned');
    this.renderInfo();
    this.highlight();
  }

  private setHover(id: string | null): void {
    if (this.hover === id) return;
    this.hover = id;
    this.renderInfo();
    this.highlight();
  }

  /** 보고 있는 칸으로 들어오고 나가는 선을 밝게 */
  private highlight(): void {
    const id = this.hover ?? this.pinned;
    if (!this.svg) return;
    for (const p of this.svg.querySelectorAll('path')) {
      const on = id !== null && (p.dataset.from === id || p.dataset.to === id);
      p.classList.toggle('hl', on);
    }
  }

  /** 아래 정보 칸: 마우스를 올린(없으면 고정한) 기술의 상태·조건·숙련도·설명, 아무것도 없으면 안내 */
  private renderInfo(): void {
    const el = this.info;
    const ctx = this.ctx;
    const cls = this.treeClass;
    if (!el || !ctx || !cls) return;
    const st = this.game.state;
    const id = this.hover ?? this.pinned;
    const node = id ? this.nodes.get(id) : undefined;
    const status = id ? this.statuses.get(id) : undefined;
    const teacher = teacherOf(cls, st.className(cls));
    if (!id || !node || !status) {
      el.replaceChildren(
        h(
          'div',
          { class: 'gt-hint' },
          h('div', null, `기술·마법은 ${teacher}에게서 배웁니다. 조건(레벨·골드·재료·선수과목의 숙련도)을 모두 채우면 배울 수 있습니다.`),
          h('div', null, '숙련도는 기술을 쓸 때마다 확률로 1씩 올라 최대 100 이 되고, 높을수록 위력과 상태 이상 확률이 커집니다.'),
          h('div', { class: 'dim' }, '칸에 마우스를 올리면 조건을 보여 주고, 누르면 고정합니다. 오른쪽 아래 숫자는 숙련도, 선 위의 숫자는 필요 숙련도입니다.'),
        ),
      );
      return;
    }
    const def = st.abilities.get(id);
    const prof = st.data.progression.proficiency;
    const look = nodeLook(status);
    const need = node.abilityLevel !== undefined ? `어빌 ${node.abilityLevel}` : node.level !== undefined ? `Lv.${node.level}` : '';
    const head = [def?.kind === 'spell' ? '마법' : '기술', need, node.gold > 0 ? `${fmt(node.gold)} 골드` : '무료'].filter(Boolean).join(' · ');
    let state: HTMLElement;
    if (look === 'learned') {
      const p = profInfo(ctx.prof(id), prof);
      state = h(
        'div',
        { class: 'gt-state learned' },
        h('b', null, '배웠습니다'),
        ` · 숙련도 ${p.prof} / ${p.max} `,
        h('span', { class: `gt-bar${p.maxed ? ' max' : ''}` }, h('i', { style: { width: `${p.ratio * 100}%` } })),
        ` · 위력 ${p.effectPct}% · ${profChanceLine(p.prof, prof)}`,
      );
    } else if (look === 'learnable') state = h('div', { class: 'gt-state learnable' }, h('b', null, '지금 배울 수 있습니다'), ` — ${teacher}에게 가세요.`);
    else state = h('div', { class: 'gt-state locked' }, h('b', null, '잠김'), ` — ${status.reason ?? ''}`);
    el.replaceChildren(
      def ? h('img', { class: 'gt-info-icon', src: abilityIconUrl(def.icon, 40), alt: '', draggable: false }) : h('span', { class: 'gt-info-icon' }),
      h(
        'div',
        { class: 'gt-info-main' },
        h('div', { class: 'gt-info-title' }, def?.name ?? id, h('small', null, `  ${head}`)),
        state,
        status.reqs.length ? h('div', { class: 'gt-reqs' }, ...status.reqs.map((r) => h('span', { class: `req ${r.met ? 'met' : 'unmet'}` }, `${r.met ? '✓' : '✗'} ${reqText(r)}`))) : null,
        def
          ? h(
              'div',
              { class: 'gt-desc' },
              def.desc,
              def.mp ? h('small', null, ` · 마나 ${def.mp}`) : null,
              def.cooldownMs ? h('small', null, ` · 재사용 ${(def.cooldownMs / 1000).toFixed(1)}초`) : null,
            )
          : null,
      ),
    );
  }
}
