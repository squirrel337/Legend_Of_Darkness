// 성장 규칙 화면 (progression.json): 전직·2차 전직 / 승급·교환 / 어빌·숙련도.
// 조건 목록(전직·승급·2차 전직)은 종류를 골라 값을 넣는 조건 만들기 칸으로 고칩니다.
import { h } from '../../client/ui/dom';
import { type ClassId } from '../../shared/constants';
import {
  abilityExpToNext,
  abilityVitals,
  bigNumber,
  CONDITION_TYPES,
  describeCondition,
  FIRST_CLASSES,
  profEffect,
  profGainChance,
  SECOND_CLASSES,
  type Condition,
  type ConditionType,
  type FirstClassId,
  type ProgressionConfig,
  type SecondClassId,
} from '../../shared/progression';
import { atPath, card, issueRow, issueSlot, type Ctx } from './ctx';
import { parseWhere } from './state';
import { checkInput, field, fmtNum, josa, numInput, parsePercent, pct, selectInput, svg, textInput } from './util';

const COND_LABELS: Record<ConditionType, string> = {
  level: '레벨',
  ascended: '승급을 마침',
  rebirths: '전직 횟수',
  pureHp: '순수 체력',
  pureMp: '순수 마력',
  exp: '경험치',
  payHp: '순수 체력 바침',
  payMp: '순수 마력 바침',
  gold: '골드',
  item: '아이템',
  skillProf: '기술 숙련도',
};

type SetProg = (fn: (p: ProgressionConfig) => void) => void;

function setter(ctx: Ctx): SetProg {
  return (fn) => ctx.store.mutate((d) => fn(d.progression));
}

/** 이 화면에 걸린 문제 목록 (누르면 그 칸으로 스크롤) */
function viewIssues(ctx: Ctx, prefixes: string[]): HTMLElement {
  return ctx.live(h('div', { class: 'dz-issues' }), (el) => {
    const list = ctx.store.issues.filter((i) => {
      const r = parseWhere(i.where);
      return r.file === 'progression' && prefixes.some((p) => r.path === p || r.path?.startsWith(`${p}.`) || r.path?.startsWith(`${p}[`));
    });
    el.replaceChildren(
      ...list.map((i) =>
        issueRow(i, () => {
          const path = parseWhere(i.where).path ?? '';
          const target = [...document.querySelectorAll<HTMLElement>('[data-path]')].find((x) => path === x.dataset.path || path.startsWith(`${x.dataset.path}[`) || path.startsWith(`${x.dataset.path}.`));
          target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target?.classList.add('dz-flash');
          window.setTimeout(() => target?.classList.remove('dz-flash'), 1200);
        }),
      ),
    );
    el.hidden = list.length === 0;
  });
}

// ───────────────────────── 조건 만들기 ─────────────────────────

function defaultCondition(ctx: Ctx, type: ConditionType, cls?: ClassId): Condition {
  const s = ctx.store;
  switch (type) {
    case 'level':
      return { type, min: s.bundle.maxLevel };
    case 'ascended':
      return { type };
    case 'rebirths':
      return { type, min: 1 };
    case 'pureHp':
    case 'pureMp':
      return { type, min: 10_000 };
    case 'exp':
      return { type, min: 100_000_000, consume: true };
    case 'payHp':
    case 'payMp':
      return { type, amount: 500 };
    case 'gold':
      return { type, min: 1_000_000, consume: true };
    case 'item':
      return { type, item: s.bundle.items.find((i) => i.type === 'material')?.id ?? s.bundle.items[0]!.id, qty: 1, consume: true };
    case 'skillProf': {
      const a = s.bundle.abilities.find((x) => x.classId === cls) ?? s.bundle.abilities[0]!;
      return { type, ability: a.id, min: s.doc.progression.proficiency.max };
    }
  }
}

/**
 * 조건 목록 하나를 고치는 칸. path 는 progression.json 안의 자리 (예: "rebirth.conditions.warrior"),
 * get 은 지금 목록을 꺼내는 함수(고칠 때마다 새로 꺼냄).
 */
function conditionsEditor(ctx: Ctx, path: string, list: Condition[], get: (p: ProgressionConfig) => Condition[], cls?: ClassId): HTMLElement {
  const s = ctx.store;
  const setP = setter(ctx);
  const err = (m: string) => ctx.toast(m, false);
  const edit = (fn: (l: Condition[]) => void) => setP((p) => fn(get(p)));
  const names = { abilityName: (id: string) => s.abilityName(id), itemName: (id: string) => s.itemName(id) };
  const itemOpts = [...s.bundle.items]
    .sort((a, b) => Number(b.type === 'material') - Number(a.type === 'material'))
    .map((i) => ({ value: i.id, label: i.name, group: i.type === 'material' ? '재료' : i.type === 'consumable' ? '소모품' : '장비' }));
  const abilityOpts = (cur: string) => {
    const order = cls ? [cls, ...s.bundle.classes.map((c) => c.id).filter((c) => c !== cls)] : s.bundle.classes.map((c) => c.id);
    return order.flatMap((c) =>
      s.bundle.abilities.filter((a) => a.classId === c || a.id === cur).map((a) => ({ value: a.id, label: s.abilityName(a.id), group: s.className(c as ClassId) })),
    );
  };
  const rows = list.map((c, i) => {
    const k = `${path}[${i}]`;
    const set = (next: Condition) => edit((l) => (l[i] = next));
    const parts: Node[] = [
      selectInput(`${k}.type`, c.type, CONDITION_TYPES.map((t) => ({ value: t, label: COND_LABELS[t] })), (v) => set(defaultCondition(ctx, v as ConditionType, cls)), '조건 종류'),
    ];
    const unit = (t: string) => h('span', { class: 'dz-unit' }, t);
    switch (c.type) {
      case 'level':
        parts.push(numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 1 }), { min: 1, max: 999, width: '72px' }, err), unit('이상'));
        break;
      case 'ascended':
        break;
      case 'rebirths':
        parts.push(numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 0 }), { min: 0, max: 1_000_000, width: '72px' }, err), unit('번 이상'));
        break;
      case 'pureHp':
      case 'pureMp':
        parts.push(numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 0 }), { min: 0, max: 1_000_000_000, big: true }, err), unit('이상'));
        break;
      case 'exp':
        parts.push(
          numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 0 }), { min: 0, max: 1e15, big: true }, err),
          checkInput(`${k}.consume`, c.consume, '써서 없어짐', (v) => set({ ...c, consume: v })),
        );
        break;
      case 'payHp':
      case 'payMp':
        parts.push(numInput(`${k}.amount`, c.amount, (v) => set({ ...c, amount: v ?? 1 }), { min: 1, max: 1_000_000_000, big: true }, err), unit('바침'));
        break;
      case 'gold':
        parts.push(
          numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 0 }), { min: 0, max: Number.MAX_SAFE_INTEGER, big: true }, err),
          checkInput(`${k}.consume`, c.consume, '냄', (v) => set({ ...c, consume: v })),
        );
        break;
      case 'item':
        parts.push(
          selectInput(`${k}.item`, c.item, itemOpts, (v) => set({ ...c, item: v }), '아이템'),
          numInput(`${k}.qty`, c.qty, (v) => set({ ...c, qty: v ?? 1 }), { min: 1, max: 1_000_000, width: '64px' }, err),
          unit('개'),
          checkInput(`${k}.consume`, c.consume, '냄', (v) => set({ ...c, consume: v })),
        );
        break;
      case 'skillProf':
        parts.push(
          selectInput(`${k}.ability`, c.ability, abilityOpts(c.ability), (v) => set({ ...c, ability: v }), '기술'),
          unit('숙련도'),
          numInput(`${k}.min`, c.min, (v) => set({ ...c, min: v ?? 0 }), { min: 0, max: s.doc.progression.proficiency.max, width: '60px' }, err),
          unit('이상'),
        );
        break;
    }
    return h(
      'div',
      { class: 'dz-cond', 'data-path': k },
      h('div', { class: 'dz-cv' }, ...parts),
      h(
        'div',
        { class: 'dz-cbtns' },
        h('button', { type: 'button', title: '위로', disabled: i === 0, onclick: () => edit((l) => l.splice(i - 1, 0, ...l.splice(i, 1))) }, '↑'),
        h('button', { type: 'button', title: '아래로', disabled: i === list.length - 1, onclick: () => edit((l) => l.splice(i + 1, 0, ...l.splice(i, 1))) }, '↓'),
        h('button', { type: 'button', title: '조건 지우기', class: 'dz-x', onclick: () => edit((l) => l.splice(i, 1)) }, '×'),
      ),
      h('div', { class: 'dz-cdesc' }, describeCondition(c, names)),
      issueSlot(ctx, atPath(k)),
    );
  });
  const add = selectInput(`${path}.add`, '', [{ value: '', label: '+ 조건 더하기…' }, ...CONDITION_TYPES.map((t) => ({ value: t, label: COND_LABELS[t] }))], (v) => {
    if (!v) return;
    edit((l) => l.push(defaultCondition(ctx, v as ConditionType, cls)));
    s.focusNext = `${path}[${list.length}].type`;
  });
  return h(
    'div',
    { class: 'dz-conds', 'data-path': path },
    issueSlot(ctx, atPath(path)),
    ...(rows.length ? rows : [h('p', { class: 'dz-hint' }, '조건 없음 — 레벨만 되면 됩니다.')]),
    add,
  );
}

/** 직업마다 조건 목록 하나씩 */
function conditionGrid<K extends ClassId>(ctx: Ctx, base: string, classes: readonly K[], get: (p: ProgressionConfig, c: K) => Condition[], sub?: (c: K) => string): HTMLElement {
  const s = ctx.store;
  return h(
    'div',
    { class: 'dz-condgrid' },
    ...classes.map((c) =>
      h(
        'div',
        { class: 'dz-condcol' },
        h('div', { class: 'dz-cname' }, h('span', { class: 'dz-dot', style: `background:${s.classColor(c)}` }), s.className(c), sub ? h('small', null, sub(c)) : null),
        conditionsEditor(ctx, `${base}.${c}`, get(s.doc.progression, c), (p) => get(p, c), c),
      ),
    ),
  );
}

// ───────────────────────── 전직 · 2차 전직 ─────────────────────────

export function renderLineage(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const p = s.doc.progression;
  const setP = setter(ctx);
  const err = (m: string) => ctx.toast(m, false);
  const firstName = (c: FirstClassId) => s.className(c);

  // 전직 갈 수 있는 직업 (무도가는 잠금)
  const matrix = h(
    'table',
    { class: 'dz-matrix' },
    h('thead', null, h('tr', null, h('th', null, '지금 → 새'), ...FIRST_CLASSES.map((t) => h('th', null, firstName(t))))),
    h(
      'tbody',
      null,
      ...FIRST_CLASSES.map((f) =>
        h(
          'tr',
          null,
          h('th', null, firstName(f)),
          ...FIRST_CLASSES.map((t) => {
            if (f === 'monk') return h('td', { class: 'lock', title: '무도가는 환골탈태로 무도가로만 다시 태어납니다 (잠김)' }, t === 'monk' ? p.rebirth.names.monk || '환골탈태' : '불가');
            if (t === 'monk') return h('td', { class: 'lock', title: '다른 직업은 무도가로 전직할 수 없습니다 (잠김)' }, '불가');
            const on = p.rebirth.targets[f].includes(t);
            const box = h('input', { type: 'checkbox', checked: on, 'data-k': `rb.t.${f}.${t}`, 'aria-label': `${firstName(f)}에서 ${josa(firstName(t), '으로', '로')}` });
            box.addEventListener('change', () =>
              setP((x) => {
                const list = x.rebirth.targets[f].filter((y) => y !== t);
                if (box.checked) list.push(t);
                x.rebirth.targets[f] = FIRST_CLASSES.filter((y) => list.includes(y));
              }),
            );
            return h('td', null, box, f === t ? h('small', { class: 'dz-hint' }, ' 같은 직업') : null);
          }),
        ),
      ),
    ),
  );
  const monkBroken =
    p.rebirth.targets.monk.join(',') !== 'monk' || FIRST_CLASSES.some((c) => c !== 'monk' && p.rebirth.targets[c].includes('monk'));

  // 2차 전직 연결
  const secondMatrix = h(
    'table',
    { class: 'dz-matrix' },
    h('thead', null, h('tr', null, h('th', null, '2차 ← 1차'), ...FIRST_CLASSES.map((f) => h('th', null, firstName(f))))),
    h(
      'tbody',
      null,
      ...SECOND_CLASSES.map((c) =>
        h(
          'tr',
          null,
          h('th', null, s.className(c)),
          ...FIRST_CLASSES.map((f) => {
            const box = h('input', { type: 'checkbox', checked: p.second.from[c].includes(f), 'data-k': `sc.f.${c}.${f}`, 'aria-label': `${firstName(f)}에서 ${josa(s.className(c), '으로', '로')}` });
            box.addEventListener('change', () =>
              setP((x) => {
                const list = x.second.from[c].filter((y) => y !== f);
                if (box.checked) list.push(f);
                x.second.from[c] = FIRST_CLASSES.filter((y) => list.includes(y));
              }),
            );
            return h('td', null, box);
          }),
        ),
      ),
    ),
  );

  // 수인 계통
  const used = (id: string) => s.doc.trees.beastkin.nodes.filter((n) => n.beastType === id).length;
  const beasts = p.second.beastTypes.map((b, i) =>
    h(
      'div',
      { class: 'dz-line', 'data-path': `second.beastTypes[${i}]` },
      textInput(
        `sc.b.${i}.id`,
        b.id,
        (v) =>
          s.mutate((d) => {
            // 계통 id 를 바꾸면 수인 트리의 계통 전용 기술도 함께 (이미 고른 캐릭터의 저장값은 그대로이므로 되도록 바꾸지 않기)
            const old = d.progression.second.beastTypes[i]!.id;
            const next = v.trim();
            d.progression.second.beastTypes[i]!.id = next;
            for (const n of d.trees.beastkin.nodes) if (n.beastType === old) n.beastType = next;
          }),
        { maxLength: 24, width: '96px', placeholder: 'id (영문)' },
      ),
      textInput(`sc.b.${i}.name`, b.name, (v) => setP((x) => (x.second.beastTypes[i]!.name = v.trim())), { maxLength: 12, width: '96px', placeholder: '이름' }),
      used(b.id) ? h('small', { class: 'dz-hint' }, `기술 ${used(b.id)}개`) : null,
      h(
        'button',
        {
          class: 'dz-x',
          type: 'button',
          title: '계통 지우기',
          onclick: () => {
            if (used(b.id) && !window.confirm(`${b.name} 계통 전용 기술이 ${used(b.id)}개 있습니다. 지우면 그 기술들의 계통도 고쳐야 저장할 수 있습니다. 지울까요?`)) return;
            setP((x) => x.second.beastTypes.splice(i, 1));
          },
        },
        '×',
      ),
      issueSlot(ctx, atPath(`second.beastTypes[${i}]`)),
    ),
  );

  return h(
    'div',
    { class: 'dz-stack' },
    card(
      '성장 흐름',
      h(
        'div',
        { class: 'dz-flow' },
        h('div', { class: 'dz-step' }, h('b', null, '평민'), h('small', null, '처음 시작')),
        h('span', { class: 'dz-arrow' }, '→'),
        h('div', { class: 'dz-step' }, h('b', null, '1차 직업'), h('small', null, `길드에서 고름 · ${p.rebirth.level}레벨에서 전직하면 ${p.rebirth.restartLevel}레벨부터 다시 (같은 직업도) · 무도가는 ${p.rebirth.names.monk}`)),
        h('span', { class: 'dz-arrow' }, '→'),
        h('div', { class: 'dz-step' }, h('b', null, `승급 (${p.ascend.level}레벨)`), h('small', null, `칭호 "${p.ascend.title}" · 경험치로 체력·마나, 체력으로 능력치`)),
        h('span', { class: 'dz-arrow' }, '→'),
        h('div', { class: 'dz-step' }, h('b', null, '2차 전직'), h('small', null, `${SECOND_CLASSES.map((c) => s.className(c)).join(' / ')} · 레벨 그대로, 어빌 1~${p.ability.maxLevel}`)),
      ),
    ),
    viewIssues(ctx, ['rebirth', 'second']),
    h(
      'div',
      { class: 'dz-grid2' },
      card(
        '전직 (1차 직업 만렙 → 다시 시작)',
        h('div', { 'data-path': 'rebirth' }, issueSlot(ctx, atPath('rebirth'))),
        h(
          'div',
          { class: 'dz-row2' },
          field('전직할 수 있는 레벨', numInput('rb.level', p.rebirth.level, (v) => setP((x) => (x.rebirth.level = v ?? 99)), { min: 1, max: 999 }, err), `서버 최대 레벨 ${s.bundle.maxLevel}`),
          field('다시 시작하는 레벨', numInput('rb.restart', p.rebirth.restartLevel, (v) => setP((x) => (x.rebirth.restartLevel = v ?? 1)), { min: 1, max: p.rebirth.level }, err), '1 보다 크면 그 레벨까지의 능력치 포인트를 줌'),
        ),
        checkInput('rb.after', p.rebirth.allowAfterAscend, '승급한 뒤에도 전직할 수 있음 (원작: 안 됨)', (v) => setP((x) => (x.rebirth.allowAfterAscend = v))),
        h(
          'div',
          { class: 'dz-field', 'data-path': 'rebirth.names' },
          h('span', { class: 'dz-label' }, '부르는 이름 (대화창·알림)'),
          h(
            'div',
            { class: 'dz-names' },
            ...FIRST_CLASSES.map((c) =>
              h('label', null, h('span', null, firstName(c)), textInput(`rb.name.${c}`, p.rebirth.names[c], (v) => setP((x) => (x.rebirth.names[c] = v.trim())), { maxLength: 12, width: '100%' })),
            ),
          ),
          issueSlot(ctx, (_i, r) => r.file === 'progression' && (r.path ?? '').startsWith('rebirth.names')),
        ),
        h('p', { class: 'dz-note' }, '전직하면 레벨·경험치·능력치만 처음으로 돌아가고, 배운 기술·마법과 숙련도, 산 체력·마나, 장비·골드·창고는 그대로입니다. 새 직업·레벨로 입을 수 없는 장비(직업 제한, 레벨 제한)는 벗겨 소지품(가득하면 창고)에 넣습니다.'),
      ),
      card(
        '전직해서 될 수 있는 직업',
        h('p', { class: 'dz-hint' }, '행: 지금 직업, 열: 새 직업. 같은 직업으로도 전직할 수 있습니다.'),
        h('div', { class: 'dz-tablewrap', 'data-path': 'rebirth.targets' }, matrix),
        issueSlot(ctx, (_i, r) => r.file === 'progression' && (r.path ?? '').startsWith('rebirth.targets')),
        h('p', { class: 'dz-hint' }, `무도가는 ${p.rebirth.names.monk}로 무도가로만 다시 태어나고, 다른 직업은 무도가로 전직할 수 없습니다. (정해진 규칙이라 잠겨 있음)`),
        monkBroken
          ? h(
              'div',
              { class: 'dz-warnbox' },
              '지금 설정이 무도가 규칙과 다릅니다. ',
              h(
                'button',
                {
                  class: 'btn small',
                  type: 'button',
                  onclick: () =>
                    setP((x) => {
                      x.rebirth.targets.monk = ['monk'];
                      for (const c of FIRST_CLASSES) if (c !== 'monk') x.rebirth.targets[c] = x.rebirth.targets[c].filter((t) => t !== 'monk');
                    }),
                },
                '규칙대로 맞추기',
              ),
            )
          : null,
      ),
    ),
    card(
      '전직 조건 (지금 직업별)',
      h('p', { class: 'dz-hint' }, `레벨은 위의 "전직할 수 있는 레벨"로 따로 확인합니다. 쓰는 조건(써서 없어짐·냄·바침)은 모든 조건을 채운 것을 확인한 뒤에만 한꺼번에 씁니다.`),
      conditionGrid(ctx, 'rebirth.conditions', FIRST_CLASSES, (x, c) => x.rebirth.conditions[c]),
    ),
    h(
      'div',
      { class: 'dz-grid2' },
      card(
        '2차 전직 연결',
        h('p', { class: 'dz-hint' }, '행: 2차 직업, 열: 그 2차 직업으로 전직할 수 있는 1차 직업.'),
        h('div', { class: 'dz-tablewrap', 'data-path': 'second.from' }, secondMatrix),
        issueSlot(ctx, (_i, r) => r.file === 'progression' && (r.path ?? '').startsWith('second.from')),
      ),
      card(
        '수인 계통',
        h(
          'p',
          { class: 'dz-hint' },
          '수인으로 2차 전직할 때 하나 고르고 바꿀 수 없습니다. id 는 스킬트리 노드의 계통과 캐릭터 저장에 쓰는 영문 소문자라, 바꾸면 수인 트리의 계통 전용 기술도 함께 바뀌지만 이미 고른 캐릭터의 저장값은 그대로입니다 (이름만 바꾸기를 권함).',
        ),
        h('div', { 'data-path': 'second.beastTypes' }, issueSlot(ctx, atPath('second.beastTypes')), ...beasts),
        h(
          'button',
          {
            class: 'btn small',
            type: 'button',
            onclick: () => {
              let k = 1;
              while (p.second.beastTypes.some((b) => b.id === `type${k}`)) k++;
              setP((x) => x.second.beastTypes.push({ id: `type${k}`, name: '새 계통' }));
              s.focusNext = `sc.b.${p.second.beastTypes.length}.id`;
            },
          },
          '+ 계통',
        ),
      ),
    ),
    card(
      '2차 전직 조건 (2차 직업별)',
      h('p', { class: 'dz-hint' }, '2차 직업 인도자에게서 합니다. 조건을 모두 채운 것을 먼저 확인한 뒤에만 경험치·체력·마력을 씁니다.'),
      conditionGrid(ctx, 'second.conditions', SECOND_CLASSES, (x, c: SecondClassId) => x.second.conditions[c], (c) => ` ← ${p.second.from[c].map((f) => firstName(f)).join('·') || '없음'}`),
    ),
  );
}

// ───────────────────────── 승급 · 교환 ─────────────────────────

/** 교환 계산기 입력 (화면을 다시 그려도 남도록) */
const calc = { exp: 300_000_000, hp: 20_000, base: 4_000 };

export function renderAscend(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const p = s.doc.progression;
  const setP = setter(ctx);
  const err = (m: string) => ctx.toast(m, false);
  const a = p.ascend;
  const trades = Math.floor(calc.exp / a.expTrade.exp);
  const sellable = Math.max(0, calc.hp - calc.base);
  const statGain = Math.floor(sellable / a.hpToStat.hp) * a.hpToStat.stat;
  const calcIn = (key: 'exp' | 'hp' | 'base') =>
    numInput(
      `calc.${key}`,
      calc[key],
      (v) => {
        calc[key] = v ?? 0;
        ctx.render();
      },
      { min: 0, max: 1e15, big: true },
      err,
    );
  return h(
    'div',
    { class: 'dz-stack' },
    viewIssues(ctx, ['ascend']),
    h(
      'div',
      { class: 'dz-grid2' },
      card(
        '승급',
        h('div', { 'data-path': 'ascend' }, issueSlot(ctx, atPath('ascend'))),
        h(
          'div',
          { class: 'dz-row2' },
          field('승급 장인을 쓸 수 있는 레벨', numInput('as.level', a.level, (v) => setP((x) => (x.ascend.level = v ?? 99)), { min: 1, max: 999 }, err), '1차 직업 만렙에서 바로'),
          h('div', { 'data-path': 'ascend.title' }, field('승급 칭호', textInput('as.title', a.title, (v) => setP((x) => (x.ascend.title = v.trim())), { maxLength: 12 })), issueSlot(ctx, atPath('ascend.title'))),
        ),
        h('p', { class: 'dz-note' }, '승급하면 칭호가 붙고 2차 전직을 할 수 있습니다. 경험치·체력 교환은 레벨만 되면 승급 전후·2차 직업 누구나 씁니다.'),
      ),
      card(
        '교환 (승급 장인)',
        h(
          'div',
          { class: 'dz-field', 'data-path': 'ascend.expTrade' },
          h('span', { class: 'dz-label' }, '경험치 팔기: 경험치를 내면 최대 체력 또는 최대 마나'),
          h(
            'div',
            { class: 'dz-line' },
            numInput('as.et.exp', a.expTrade.exp, (v) => setP((x) => (x.ascend.expTrade.exp = v ?? 1)), { min: 1, max: 1e15, big: true }, err),
            h('span', { class: 'dz-unit' }, '→ 체력'),
            numInput('as.et.hp', a.expTrade.hp, (v) => setP((x) => (x.ascend.expTrade.hp = v ?? 0)), { min: 0, max: 1_000_000, width: '72px' }, err),
            h('span', { class: 'dz-unit' }, '또는 마나'),
            numInput('as.et.mp', a.expTrade.mp, (v) => setP((x) => (x.ascend.expTrade.mp = v ?? 0)), { min: 0, max: 1_000_000, width: '72px' }, err),
          ),
          issueSlot(ctx, atPath('ascend.expTrade')),
        ),
        h(
          'div',
          { class: 'dz-field', 'data-path': 'ascend.hpToStat' },
          h('span', { class: 'dz-label' }, '체력 팔기: 순수 최대 체력을 내면 능력치 포인트 (직업 기본 체력 아래로는 팔 수 없음)'),
          h(
            'div',
            { class: 'dz-line' },
            numInput('as.hs.hp', a.hpToStat.hp, (v) => setP((x) => (x.ascend.hpToStat.hp = v ?? 1)), { min: 1, max: 1_000_000_000, big: true }, err),
            h('span', { class: 'dz-unit' }, '→ 능력치'),
            numInput('as.hs.stat', a.hpToStat.stat, (v) => setP((x) => (x.ascend.hpToStat.stat = v ?? 1)), { min: 1, max: 1000, width: '64px' }, err),
          ),
          issueSlot(ctx, atPath('ascend.hpToStat')),
        ),
      ),
    ),
    h(
      'div',
      { class: 'dz-grid2' },
      card(
        '계산해 보기',
        h('div', { class: 'dz-row3' }, field('모은 경험치', calcIn('exp')), field('지금 순수 최대 체력', calcIn('hp')), field('직업 기본 체력', calcIn('base'))),
        h(
          'div',
          { class: 'dz-out' },
          `경험치 ${josa(bigNumber(calc.exp), '은', '는')} ${fmtNum(trades)}번 팔 수 있어 → 최대 체력 `,
          h('b', null, `+${fmtNum(trades * a.expTrade.hp)}`),
          ' 또는 최대 마나 ',
          h('b', null, `+${fmtNum(trades * a.expTrade.mp)}`),
          h('br'),
          `최대 체력 ${fmtNum(calc.hp)} 중 ${fmtNum(sellable)}만큼 팔 수 있어 → 능력치 `,
          h('b', null, `+${fmtNum(statGain)}`),
          ` (체력 ${fmtNum(a.hpToStat.hp)}당 ${a.hpToStat.stat})`,
        ),
        h('p', { class: 'dz-hint' }, '"직업 기본 체력"은 직업 기본값 + 레벨 몫입니다 (건강·산 체력·어빌 보너스 제외).'),
      ),
      card(
        '승급 조건 한눈에',
        h(
          'table',
          { class: 'dz-matrix wide' },
          h('thead', null, h('tr', null, h('th', null, '직업'), h('th', null, '조건'))),
          h(
            'tbody',
            null,
            ...FIRST_CLASSES.map((c) =>
              h(
                'tr',
                null,
                h('th', null, s.className(c)),
                h('td', { class: 'left' }, a.conditions[c].map((x) => describeCondition(x, { abilityName: (id) => s.abilityName(id), itemName: (id) => s.itemName(id) })).join(' · ') || '없음'),
              ),
            ),
          ),
        ),
      ),
    ),
    card(
      '승급 조건 (1차 직업별)',
      h('p', { class: 'dz-hint' }, '원작: 순수 체력·마력, 보유 경험치 2억 5천만(써서 없어짐), 그 직업 핵심 기술 2개 숙련도 100.'),
      conditionGrid(ctx, 'ascend.conditions', FIRST_CLASSES, (x, c) => x.ascend.conditions[c]),
    ),
  );
}

// ───────────────────────── 어빌 · 숙련도 ─────────────────────────

export function renderGrowth(ctx: Ctx): HTMLElement {
  const s = ctx.store;
  const p = s.doc.progression;
  const setP = setter(ctx);
  const err = (m: string) => ctx.toast(m, false);
  const ab = p.ability;
  const pf = p.proficiency;
  const pctInput = (key: string, v: number, onCommit: (x: number) => void, lo: number, hi: number) => {
    const el = h('input', { type: 'text', inputmode: 'decimal', class: 'dz-num', value: pct(v), 'data-k': key, autocomplete: 'off', style: 'width:84px' });
    el.addEventListener('change', () => {
      const x = parsePercent(el.value);
      if (!Number.isFinite(x) || x < lo || x > hi) {
        el.value = pct(v);
        return err(`${Math.round(lo * 100)}% ~ ${Math.round(hi * 100)}% 사이로 넣어 주세요.`);
      }
      if (x !== v) onCommit(x);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
    });
    return h('span', { class: 'dz-line' }, el, h('span', { class: 'dz-unit' }, '%'));
  };
  const top = abilityVitals(ab.maxLevel, ab);
  let totalAbExp = 0;
  for (let l = 1; l < ab.maxLevel; l++) totalAbExp += abilityExpToNext(l, ab);
  const sample = [1, 10, 30, 50, 70, 90, ab.maxLevel - 1].filter((l, i, arr) => l >= 1 && l < ab.maxLevel && arr.indexOf(l) === i);
  // 숙련도 0 → 최대까지 평균 몇 번 써야 하는지
  let uses = 0;
  for (let k = 0; k < pf.max; k++) {
    const c = profGainChance(k, pf);
    uses += c > 0 ? 1 / c : 0;
  }
  return h(
    'div',
    { class: 'dz-stack' },
    viewIssues(ctx, ['ability', 'proficiency']),
    h(
      'div',
      { class: 'dz-grid2' },
      card(
        '어빌리티 레벨 (2차 직업)',
        h('div', { 'data-path': 'ability' }, issueSlot(ctx, atPath('ability'))),
        h(
          'div',
          { class: 'dz-row2' },
          field('어빌 최대', numInput('ab.max', ab.maxLevel, (v) => setP((x) => (x.ability.maxLevel = v ?? 99)), { min: 1, max: 999 }, err)),
          field('어빌 경험치 비율', pctInput('ab.ratio', ab.expRatio, (v) => setP((x) => (x.ability.expRatio = v)), 0, 10), '몬스터를 잡아 받은 경험치 중 어빌 경험치로도 받는 몫'),
          field('어빌이 오를 때 최대 체력', numInput('ab.hp', ab.hpPerLevel, (v) => setP((x) => (x.ability.hpPerLevel = v ?? 0)), { min: 0, max: 100_000 }, err)),
          field('어빌이 오를 때 최대 마나', numInput('ab.mp', ab.mpPerLevel, (v) => setP((x) => (x.ability.mpPerLevel = v ?? 0)), { min: 0, max: 100_000 }, err)),
        ),
        h('div', { class: 'dz-out' }, `어빌 ${ab.maxLevel} 이면 최대 체력 `, h('b', null, `+${fmtNum(top.hp)}`), ', 최대 마나 ', h('b', null, `+${fmtNum(top.mp)}`), ` (어빌 1 은 +0)`),
        h(
          'table',
          { class: 'dz-matrix wide' },
          h('thead', null, h('tr', null, h('th', null, '어빌'), h('th', null, '다음 어빌까지 어빌 경험치'), h('th', null, '몬스터 경험치로 치면'))),
          h(
            'tbody',
            null,
            ...sample.map((l) => {
              const need = abilityExpToNext(l, ab);
              return h('tr', null, h('th', null, `${l} → ${l + 1}`), h('td', null, bigNumber(need)), h('td', null, ab.expRatio > 0 ? bigNumber(need / ab.expRatio) : '—'));
            }),
            h('tr', null, h('th', null, `1 → ${ab.maxLevel}`), h('td', null, bigNumber(totalAbExp)), h('td', null, ab.expRatio > 0 ? bigNumber(totalAbExp / ab.expRatio) : '—')),
          ),
        ),
      ),
      card(
        '숙련도',
        h('div', { 'data-path': 'proficiency' }, issueSlot(ctx, atPath('proficiency'))),
        h(
          'div',
          { class: 'dz-row3' },
          field('최대', numInput('pf.max', pf.max, (v) => setP((x) => (x.proficiency.max = v ?? 100)), { min: 1, max: 1000 }, err)),
          field('처음 오를 확률', pctInput('pf.base', pf.baseChance, (v) => setP((x) => (x.proficiency.baseChance = v)), 0, 1)),
          field('느려지는 정도', pctInput('pf.slow', pf.slowdown, (v) => setP((x) => (x.proficiency.slowdown = v)), 0, 1)),
          field('오를 확률 바닥', pctInput('pf.min', pf.minChance, (v) => setP((x) => (x.proficiency.minChance = v)), 0, 1)),
          field('숙련도 0 의 위력', pctInput('pf.emin', pf.effectMin, (v) => setP((x) => (x.proficiency.effectMin = v)), 0.01, 10)),
          field('숙련도 최대의 위력', pctInput('pf.emax', pf.effectMax, (v) => setP((x) => (x.proficiency.effectMax = v)), 0.01, 10)),
        ),
        h('p', { class: 'dz-hint' }, `오를 확률 = max(바닥, 처음 확률 × (1 − 느려짐 × 숙련도/최대)). 위력(피해·회복)과 해로운 상태 확률은 숙련도에 따라 ${pct(pf.effectMin)}% → ${pct(pf.effectMax)}%.`),
        profChart(pf),
        h('div', { class: 'dz-out' }, `숙련도 0 → ${pf.max} 까지 평균 `, h('b', null, `${fmtNum(Math.round(uses))}번`), ' 쓰면 됩니다.'),
        h('p', { class: 'dz-note' }, '이 체계 전에 배운 기술은 숙련도 최대로 옮겨 지금의 위력을 유지합니다.'),
      ),
    ),
  );
}

/** 숙련도에 따른 오를 확률과 위력 그래프 */
function profChart(pf: ProgressionConfig['proficiency']): SVGSVGElement {
  const W = 360;
  const H = 150;
  const L = 34;
  const R = 34;
  const T = 10;
  const B = 24;
  const x = (k: number) => L + ((W - L - R) * k) / pf.max;
  const maxChance = Math.max(0.01, pf.baseChance, pf.minChance);
  const yc = (c: number) => T + (H - T - B) * (1 - c / maxChance);
  const eLo = Math.min(pf.effectMin, pf.effectMax);
  const eHi = Math.max(pf.effectMin, pf.effectMax, eLo + 0.01);
  const ye = (e: number) => T + (H - T - B) * (1 - (e - eLo) / (eHi - eLo));
  let chance = '';
  let effect = '';
  const steps = Math.min(200, pf.max);
  for (let i = 0; i <= steps; i++) {
    const k = (pf.max * i) / steps;
    chance += `${i ? 'L' : 'M'} ${x(k).toFixed(1)} ${yc(profGainChance(Math.min(k, pf.max - 1e-9), pf)).toFixed(1)} `;
    effect += `${i ? 'L' : 'M'} ${x(k).toFixed(1)} ${ye(profEffect(k, pf)).toFixed(1)} `;
  }
  return svg(
    'svg',
    { class: 'dz-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '숙련도에 따른 오를 확률과 위력' },
    svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis' }),
    svg('path', { d: chance, class: 'chance' }),
    svg('path', { d: effect, class: 'effect' }),
    svg('text', { x: L - 4, y: yc(maxChance) + 4, class: 'lbl chance', 'text-anchor': 'end' }, `${pct(maxChance)}%`),
    svg('text', { x: L - 4, y: H - B, class: 'lbl chance', 'text-anchor': 'end' }, '0%'),
    svg('text', { x: W - R + 4, y: ye(eHi) + 4, class: 'lbl effect' }, `${pct(eHi)}%`),
    svg('text', { x: W - R + 4, y: ye(eLo) + 4, class: 'lbl effect' }, `${pct(eLo)}%`),
    svg('text', { x: L, y: H - 6, class: 'lbl' }, '숙련도 0'),
    svg('text', { x: W - R, y: H - 6, class: 'lbl', 'text-anchor': 'end' }, `${pf.max}`),
    svg('text', { x: (W + L - R) / 2, y: T + 10, class: 'lbl chance', 'text-anchor': 'middle' }, '— 오를 확률'),
    svg('text', { x: (W + L - R) / 2, y: T + 24, class: 'lbl effect', 'text-anchor': 'middle' }, '— 위력·상태 확률'),
  );
}
