// 게임 화면 미리보기: 게임 안의 스킬트리 창(가죽·금색)처럼 그리고, 미리보기 캐릭터(레벨·어빌·골드·능력치·재료·계통)를
// 정해 직접 배워 보며 조건이 어떻게 걸리는지 봅니다. 배울 수 있는지는 서버·게임과 같은 learnStatus 로 판단합니다.
import { h } from '../../client/ui/dom';
import { MAX_ABILITIES, STAT_KEYS, type ClassId, type StatKey } from '../../shared/constants';
import { bigNumber, classTier, learnStatus, type LearnContext, type LearnStatus, type SkillTreeNode } from '../../shared/progression';
import type { Ctx } from './ctx';
import { checkInput, field, numInput, selectInput, svg } from './util';

/** 미리보기 캐릭터 (직업마다 따로, 저장하지 않음) */
interface Sim {
  level: number;
  abilityLevel: number;
  gold: number;
  stat: number;
  mats: boolean;
  beastType: string | null;
  /** 배운 기술 → 숙련도 */
  learned: Map<string, number>;
  /** 쓴 골드 */
  spent: number;
  /** 설명을 보여 줄 기술 */
  tip: string | null;
}

const sims = new Map<ClassId, Sim>();

function simOf(ctx: Ctx): Sim {
  const s = ctx.store;
  const cls = s.cls;
  let sim = sims.get(cls);
  if (!sim) {
    const tier = classTier(cls);
    sim = {
      level: tier === 0 ? 5 : s.bundle.maxLevel,
      abilityLevel: tier === 2 ? s.doc.progression.ability.maxLevel : 0,
      gold: 100_000_000,
      stat: 50,
      mats: true,
      beastType: cls === 'beastkin' ? (s.doc.progression.second.beastTypes[0]?.id ?? null) : null,
      learned: new Map(),
      spent: 0,
      tip: null,
    };
    // 다른 직업 트리의 선수과목은 처음에 숙련도 최대로 배운 것으로 (이 트리 안의 흐름을 보기 쉽게)
    for (const n of s.doc.trees[cls].nodes)
      for (const r of n.requires) if (!s.node(cls, r.ability)) sim.learned.set(r.ability, s.doc.progression.proficiency.max);
    sims.set(cls, sim);
  }
  return sim;
}

function learnCtx(ctx: Ctx, sim: Sim): LearnContext {
  const s = ctx.store;
  const cls = s.cls;
  const tier = classTier(cls);
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, sim.stat])) as Record<StatKey, number>;
  return {
    classId: cls,
    level: tier === 2 ? s.bundle.maxLevel : sim.level,
    abilityLevel: tier === 2 ? sim.abilityLevel : 0,
    gold: sim.gold,
    stats,
    beastType: cls === 'beastkin' ? sim.beastType : null,
    learnedCount: (kind) => [...sim.learned.keys()].filter((id) => s.def(id)?.kind === kind).length,
    learned: (id) => sim.learned.has(id),
    prof: (id) => sim.learned.get(id) ?? 0,
    itemCount: () => (sim.mats ? 9999 : 0),
    ability: (id) => {
      const d = s.def(id);
      return d ? { name: s.abilityName(id), kind: d.kind } : undefined;
    },
    itemName: (id) => s.itemName(id),
    beastTypeName: (id) => s.beastName(id),
  };
}

// 미리보기 격자 (px)
const PCW = 98;
const PRH = 102;
const PG = 58;
const PN = 54;

/** 미리보기 자리 (슬라이더를 움직이는 동안에는 이 안만 다시 그림) */
export function renderPreview(ctx: Ctx): HTMLElement {
  return h('div', { class: 'dz-preview-host' }, gameWindow(ctx));
}

function refreshPreview(ctx: Ctx): void {
  const host = document.querySelector('.dz-preview-host');
  host?.replaceChildren(gameWindow(ctx));
}

function gameWindow(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const cls = s.cls;
  const tree = s.doc.trees[cls];
  const tier = classTier(cls);
  const sim = simOf(ctx);
  const lc = learnCtx(ctx, sim);
  const status = new Map<string, LearnStatus>(tree.nodes.map((n) => [n.ability, learnStatus(cls, n, lc)]));
  const rows = Math.max(1, ...tree.nodes.map((n) => n.row + 1));
  const cols = Math.max(1, tree.columns?.length ?? 0, ...tree.nodes.map((n) => n.col + 1));
  const top = tree.columns?.length ? 34 : 14;
  const W = PG + cols * PCW + 12;
  const H = top + rows * PRH + 8;
  const pos = (n: SkillTreeNode) => ({ x: PG + n.col * PCW + (PCW - PN) / 2, y: top + n.row * PRH });
  const board = h('div', { class: 'dz-gboard', style: `width:${W}px;height:${H}px` });
  const edges = svg('svg', { width: W, height: H, 'aria-hidden': 'true' });
  for (const n of tree.nodes)
    for (const r of n.requires) {
      const p = tree.nodes.find((x) => x.ability === r.ability);
      if (!p) continue;
      const a = pos(p);
      const b = pos(n);
      const met = sim.learned.has(p.ability) && (sim.learned.get(p.ability) ?? 0) >= r.prof;
      // 이름표(노드 아래 16px) 밑에서 시작
      const sy = a.y + PN + 18;
      edges.append(svg('path', { d: `M ${a.x + PN / 2} ${sy} C ${a.x + PN / 2} ${sy + 22}, ${b.x + PN / 2} ${b.y - 22}, ${b.x + PN / 2} ${b.y}`, class: met ? 'on' : '' }));
    }
  board.append(edges);
  (tree.columns ?? []).forEach((c, i) => board.append(h('div', { class: 'dz-gcol', style: `left:${PG + i * PCW}px;width:${PCW}px` }, c)));
  for (let r = 0; r < rows; r++) {
    const needs = [...new Set(tree.nodes.filter((n) => n.row === r).map((n) => s.need(cls, n)))].sort((a, b) => a - b);
    if (needs.length) board.append(h('div', { class: 'dz-gtier', style: `top:${top + r * PRH + 18}px` }, `${tier === 2 ? '어빌' : 'Lv'}${needs.join('·')}`));
  }
  for (const n of tree.nodes) {
    const st = status.get(n.ability)!;
    const def = s.def(n.ability);
    const p = pos(n);
    const has = sim.learned.has(n.ability);
    const cls2 = has ? 'has' : st.learnable ? 'avail' : 'lock';
    const name = s.abilityName(n.ability);
    const el = h(
      'button',
      {
        type: 'button',
        class: `dz-gnode ${cls2}${sim.tip === n.ability ? ' tip' : ''}`,
        style: `left:${p.x}px;top:${p.y}px;--ic:${def?.icon.color ?? '#6b4a2a'}`,
        'aria-label': `${name}: ${has ? `배움, 숙련도 ${sim.learned.get(n.ability)}` : st.learnable ? '배울 수 있음' : (st.reason ?? '배울 수 없음')}`,
        onclick: () => {
          sim.tip = n.ability;
          if (has) return ctx.render();
          if (!st.learnable) {
            ctx.toast(st.reason ?? '배울 수 없습니다.', false);
            return ctx.render();
          }
          sim.learned.set(n.ability, 0);
          sim.gold -= n.gold;
          sim.spent += n.gold;
          ctx.render();
        },
        oncontextmenu: (e: Event) => {
          e.preventDefault();
          if (!has) return;
          sim.learned.delete(n.ability);
          sim.gold += n.gold;
          sim.spent -= n.gold;
          ctx.render();
        },
        onpointerenter: () => showTip(ctx, n.ability),
        onfocus: () => showTip(ctx, n.ability),
      },
      name.slice(0, 1),
      h('span', { class: 'dz-grk' }, has ? `숙련 ${sim.learned.get(n.ability)}` : `${tier === 2 ? '어빌' : 'Lv'}${s.need(cls, n)}`),
      h('span', { class: 'dz-gl' }, name),
    );
    board.append(el);
  }
  const tip = h('div', { class: 'dz-gtip', id: 'dz-gtip' });
  fillTip(ctx, tip, sim.tip);
  return h(
    'div',
    { class: 'dz-game' },
    h(
      'div',
      { class: 'dz-ghead' },
      h('b', null, `${s.className(cls)} 기술`),
      h('span', null, tier === 2 ? `어빌 ${sim.abilityLevel}` : `레벨 ${sim.level}`),
      h('span', null, `골드 ${bigNumber(Math.max(0, sim.gold))}`),
      h('span', { class: 'dz-gpts' }, `배운 기술 `, h('em', null, String(tree.nodes.filter((n) => sim.learned.has(n.ability)).length)), ` / ${tree.nodes.length}`),
    ),
    h('div', { class: 'dz-gboard-wrap', 'data-scroll': `preview-${cls}` }, board),
    tip,
  );
}

function showTip(ctx: Ctx, id: string): void {
  const el = document.getElementById('dz-gtip');
  if (el) fillTip(ctx, el, id);
}

function fillTip(ctx: Ctx, el: HTMLElement, id: string | null): void {
  const s = ctx.store;
  const cls = s.cls;
  const n = id ? s.node(cls, id) : undefined;
  if (!n) {
    el.replaceChildren('기술을 누르면 배우고(골드를 내고), 오른쪽 단추로 누르면 잊습니다. 마우스를 올리면 배우는 조건을 봅니다.');
    return;
  }
  const sim = simOf(ctx);
  const st = learnStatus(cls, n, learnCtx(ctx, sim));
  const def = s.def(n.ability);
  el.replaceChildren(
    h('b', null, s.abilityName(n.ability)),
    ` · ${def?.kind === 'spell' ? '마법' : '기술'} · 마나 ${s.doc.abilities[n.ability]?.mp ?? def?.mp ?? 0} · 재사용 ${(s.doc.abilities[n.ability]?.cooldownMs ?? 0) / 1000}초`,
    h(
      'ul',
      { class: 'dz-greqs' },
      ...st.reqs.map((r) =>
        h('li', { class: r.met ? 'met' : 'unmet' }, r.met ? '✓ ' : '✗ ', r.label, r.have !== undefined && r.kind !== 'level' && r.kind !== 'abilityLevel' && !r.met ? ` (지금 ${bigNumber(r.have)})` : ''),
      ),
    ),
    h('div', { class: 'dz-gdesc' }, s.doc.abilities[n.ability]?.desc ?? ''),
    sim.learned.has(n.ability) ? h('div', { class: 'dz-gnote' }, `배웠습니다 · 숙련도 ${sim.learned.get(n.ability)}`) : st.learnable ? h('div', { class: 'dz-gnote ok' }, '지금 배울 수 있습니다') : h('div', { class: 'dz-gnote' }, st.reason ?? ''),
  );
}

/** 미리보기 옆 칸: 미리보기 캐릭터 설정과 배운 기술의 숙련도 */
export function renderPreviewSide(ctx: Ctx): (Node | null)[] {
  const s = ctx.store;
  const cls = s.cls;
  const tier = classTier(cls);
  const sim = simOf(ctx);
  const tree = s.doc.trees[cls];
  const profMax = s.doc.progression.proficiency.max;
  const set = (fn: () => void) => {
    fn();
    ctx.render();
  };
  /** 슬라이더: 움직이는 동안에는 이름표와 미리보기만, 놓으면 전체를 다시 그림 */
  const slider = (key: string, label: (v: number) => string, value: number, min: number, max: number, onInput: (v: number) => void, hint?: string) => {
    const name = h('span', { class: 'dz-label' }, label(value));
    const el = h('input', { type: 'range', min, max, value: String(value), 'data-k': key, 'aria-label': label(value) });
    el.addEventListener('input', () => {
      onInput(Number(el.value));
      name.textContent = label(Number(el.value));
      refreshPreview(ctx);
    });
    el.addEventListener('change', () => ctx.render());
    return h('label', { class: 'dz-field' }, name, el, hint ? h('small', { class: 'dz-hint' }, hint) : null);
  };
  const cross = new Set<string>();
  for (const n of tree.nodes) for (const r of n.requires) if (!s.node(cls, r.ability)) cross.add(r.ability);
  const learnedHere = tree.nodes.filter((n) => sim.learned.has(n.ability));
  return [
    h('h3', null, '미리보기 캐릭터'),
    h('p', { class: 'dz-hint' }, '게임 안의 스킬트리 창처럼 보여 줍니다. 배울 수 있는지는 게임과 같은 판정(learnStatus)으로 정합니다. 여기서 바꾸는 값은 저장되지 않습니다.'),
    tier === 2
      ? slider('sim.ab', (v) => `어빌 ${v}`, sim.abilityLevel, 1, s.doc.progression.ability.maxLevel, (v) => (sim.abilityLevel = v), `레벨은 ${s.bundle.maxLevel} 그대로`)
      : slider('sim.lv', (v) => `레벨 ${v}`, sim.level, 1, s.bundle.maxLevel, (v) => (sim.level = v)),
    field(
      '가진 골드',
      numInput('sim.gold', Math.max(0, sim.gold), (v) => set(() => (sim.gold = v ?? 0)), { min: 0, max: 1e15, big: true }, (m) => ctx.toast(m, false)),
      `배우느라 쓴 골드 ${bigNumber(sim.spent)}`,
    ),
    slider('sim.stat', (v) => `기본 능력치 (모두 ${v})`, sim.stat, 1, s.bundle.statCap, (v) => (sim.stat = v)),
    checkInput('sim.mats', sim.mats, '재료를 모두 가지고 있음', (v) => set(() => (sim.mats = v))),
    cls === 'beastkin'
      ? field(
          '수인 계통',
          selectInput('sim.beast', sim.beastType ?? '', [{ value: '', label: '아직 고르지 않음' }, ...s.doc.progression.second.beastTypes.map((b) => ({ value: b.id, label: b.name }))], (v) =>
            set(() => (sim.beastType = v || null)),
          ),
        )
      : null,
    cross.size
      ? h(
          'div',
          { class: 'dz-field' },
          h('span', { class: 'dz-label' }, '다른 직업의 선수과목'),
          ...[...cross].map((id) =>
            h(
              'div',
              { class: 'dz-line' },
              checkInput(`sim.x.${id}`, sim.learned.has(id), s.abilityName(id), (v) => set(() => (v ? sim.learned.set(id, profMax) : sim.learned.delete(id)))),
              sim.learned.has(id)
                ? numInput(`sim.xp.${id}`, sim.learned.get(id)!, (v) => set(() => sim.learned.set(id, v ?? 0)), { min: 0, max: profMax, width: '56px', title: '숙련도' })
                : null,
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'dz-actions' },
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          title: '지금 조건으로 배울 수 있는 기술을 차례로 모두 배우고, 배운 기술의 숙련도를 최대로 올립니다',
          onclick: () =>
            set(() => {
              for (let guard = 0; guard < 200; guard++) {
                const lc = learnCtx(ctx, sim);
                const next = tree.nodes.find((n) => !sim.learned.has(n.ability) && learnStatus(cls, n, lc).learnable);
                if (!next || sim.learned.size >= MAX_ABILITIES * 2) break;
                sim.learned.set(next.ability, profMax);
                sim.gold -= next.gold;
                sim.spent += next.gold;
              }
            }),
        },
        '배울 수 있는 것 모두 (숙련도 최대)',
      ),
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          onclick: () =>
            set(() => {
              for (const n of tree.nodes) {
                if (!sim.learned.has(n.ability)) continue;
                sim.learned.delete(n.ability);
                sim.gold += n.gold;
                sim.spent -= n.gold;
              }
            }),
        },
        '모두 잊기',
      ),
    ),
    learnedHere.length
      ? h(
          'div',
          { class: 'dz-field' },
          h('span', { class: 'dz-label' }, '배운 기술의 숙련도 (쓰면 오르는 값)'),
          ...learnedHere.map((n) =>
            h(
              'div',
              { class: 'dz-line' },
              h('span', { class: 'dz-grow' }, s.abilityName(n.ability)),
              numInput(`sim.p.${n.ability}`, sim.learned.get(n.ability)!, (v) => set(() => sim.learned.set(n.ability, v ?? 0)), { min: 0, max: profMax, width: '56px', title: '숙련도' }),
            ),
          ),
        )
      : h('p', { class: 'dz-hint' }, '아직 배운 기술이 없습니다.'),
  ];
}
