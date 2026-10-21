// 스킬트리 편집 화면의 오른쪽 속성 칸: 고른 노드(배우는 조건 + 기술 기본값), 고른 선수과목 화살표(필요 숙련도),
// 아무것도 고르지 않았을 때는 트리 설정(열 제목, 합계).
import { h } from '../../client/ui/dom';
import { ELEMENT_NAMES, MAX_STAT_VALUE, STAT_KEYS, STAT_NAMES, STATUS_INFO, type ClassId, type StatKey } from '../../shared/constants';
import { bigNumber, classTier, TREE_MAX_COLS, type SkillTreeNode } from '../../shared/progression';
import type { AbilityEffect } from '../../shared/types';
import { issueSlot, type Ctx } from './ctx';
import type { AbilityEdit } from './state';
import { clamp, field, fmtNum, josa, numInput, selectInput, textInput } from './util';

const ITEM_GROUPS: Record<string, string> = { material: '재료', consumable: '소모품', equip: '장비' };

export function renderPanel(ctx: Ctx): (Node | null)[] {
  const s = ctx.store;
  const sel = s.sel;
  if (sel?.type === 'node') {
    const n = s.node(s.cls, sel.id);
    if (n) return nodePanel(ctx, n);
  }
  if (sel?.type === 'edge') {
    const n = s.node(s.cls, sel.to);
    const r = n?.requires.find((x) => x.ability === sel.from);
    if (n && r) return edgePanel(ctx, n, sel.from);
  }
  return treePanel(ctx);
}

/** 노드·선수과목 지우기 (Delete 키와 단추) */
export function nodeActions(ctx: Ctx) {
  const s = ctx.store;
  return {
    deleteSelection(): void {
      const sel = s.sel;
      const cls = s.cls;
      if (!sel) return;
      if (sel.type === 'node') {
        const name = s.abilityName(sel.id);
        s.mutate((d) => {
          const t = d.trees[cls];
          t.nodes = t.nodes.filter((x) => x.ability !== sel.id);
          for (const x of t.nodes) x.requires = x.requires.filter((r) => r.ability !== sel.id);
        });
        const elsewhere = Object.values(s.doc.trees).some((t) => t.nodes.some((x) => x.requires.some((r) => r.ability === sel.id)));
        ctx.toast(`${josa(name, '을', '를')} 트리에서 뺐습니다.${elsewhere ? ' 다른 직업 트리의 선수과목에 남아 있으니 검사 결과를 보세요.' : ''} (되돌리기 Ctrl+Z)`);
      } else {
        s.mutate((d) => {
          const to = d.trees[cls].nodes.find((x) => x.ability === sel.to);
          if (to) to.requires = to.requires.filter((r) => r.ability !== sel.from);
        });
        ctx.toast('선수과목 연결을 지웠습니다. (되돌리기 Ctrl+Z)');
      }
      s.sel = null;
      ctx.render();
    },
  };
}

// ───────────────────────── 노드 ─────────────────────────

function nodePanel(ctx: Ctx, n: SkillTreeNode): (Node | null)[] {
  const s = ctx.store;
  const cls = s.cls;
  const tier = classTier(cls);
  const def = s.def(n.ability);
  const ed = s.doc.abilities[n.ability];
  const id = n.ability;
  const err = (m: string) => ctx.toast(m, false);
  const upd = (fn: (x: SkillTreeNode) => void) =>
    s.mutate((d) => {
      const x = d.trees[cls].nodes.find((y) => y.ability === id);
      if (x) fn(x);
    });
  const updAb = (fn: (x: AbilityEdit) => void) =>
    s.mutate((d) => {
      const x = d.abilities[id];
      if (x) fn(x);
    });
  const prog = s.doc.progression;
  const needMax = tier === 2 ? prog.ability.maxLevel : s.bundle.maxLevel;
  const profMax = prog.proficiency.max;
  const mine = (r: { file: string; cls?: ClassId; ability?: string }) => (r.file === 'skilltrees' && r.cls === cls && r.ability === id) || (r.file === 'abilities' && r.ability === id);

  // 재료
  const items = n.items.map((it, i) =>
    h(
      'div',
      { class: 'dz-line' },
      selectInput(`node.items.${i}.item`, it.item, itemOptions(ctx), (v) =>
        upd((x) => {
          if (x.items.some((o, j) => j !== i && o.item === v)) return err('같은 재료가 이미 있습니다. 개수를 늘려 주세요.');
          x.items[i]!.item = v;
        }),
      ),
      numInput(`node.items.${i}.qty`, it.qty, (v) => upd((x) => (x.items[i]!.qty = v ?? 1)), { min: 1, max: 1000, width: '64px', title: '개수' }, err),
      h('span', { class: 'dz-unit' }, '개'),
      h('button', { class: 'dz-x', type: 'button', title: '재료 빼기', onclick: () => upd((x) => x.items.splice(i, 1)) }, '×'),
    ),
  );
  const addItem = selectInput('node.items.add', '', [{ value: '', label: '+ 재료 더하기…' }, ...itemOptions(ctx)], (v) => {
    if (!v) return;
    if (n.items.some((o) => o.item === v)) return err('같은 재료가 이미 있습니다.');
    upd((x) => x.items.push({ item: v, qty: 1 }));
  });

  // 선수과목
  const reqs = n.requires.map((r, i) => {
    const other = s.treeOfAbility(r.ability);
    const sameTree = other === cls;
    return h(
      'div',
      { class: 'dz-line' },
      h(
        'button',
        {
          class: 'dz-link',
          type: 'button',
          title: sameTree ? '이 기술로 가기' : other ? `${s.className(other)} 트리로 가기` : '어느 트리에도 없는 기술',
          onclick: () => {
            if (other) {
              s.cls = other;
              s.sel = { type: 'node', id: r.ability };
              ctx.render();
            }
          },
        },
        s.abilityName(r.ability),
        sameTree ? null : h('small', null, other ? ` (${s.className(other)})` : ' (트리에 없음)'),
      ),
      h('span', { class: 'dz-unit' }, '숙련도'),
      numInput(`node.req.${i}.prof`, r.prof, (v) => upd((x) => (x.requires[i]!.prof = v ?? 0)), { min: 0, max: profMax, width: '56px', title: `필요 숙련도 (0 ~ ${profMax}, 0 이면 배우기만 하면 됨)` }, err),
      h('span', { class: 'dz-unit' }, '이상'),
      h('button', { class: 'dz-x', type: 'button', title: '선수과목 빼기', onclick: () => upd((x) => x.requires.splice(i, 1)) }, '×'),
    );
  });
  const reqOptions: { value: string; label: string; group?: string; disabled?: boolean }[] = [{ value: '', label: '+ 선수과목 더하기…' }];
  const order: ClassId[] = [cls, ...(s.bundle.classes.map((c) => c.id).filter((c) => c !== cls) as ClassId[])];
  for (const c of order) {
    for (const a of s.bundle.abilities.filter((x) => x.classId === c)) {
      if (a.id === id || n.requires.some((r) => r.ability === a.id)) continue;
      const placed = s.treeOfAbility(a.id);
      const cycle = s.requiresChain(a.id, id);
      reqOptions.push({
        value: a.id,
        label: `${s.abilityName(a.id)}${cycle ? ' (돌고 돎)' : !placed ? ' (트리에 없음)' : ''}`,
        group: `${s.className(c)}${c === cls ? ' (이 트리)' : ''}`,
        disabled: cycle,
      });
    }
  }
  const addReq = selectInput('node.req.add', '', reqOptions, (v) => {
    if (!v) return;
    if (s.requiresChain(v, id)) return err('이으면 선수과목이 돌고 돕니다.');
    upd((x) => x.requires.push({ ability: v, prof: 0 }));
    s.focusNext = `node.req.${n.requires.length}.prof`;
  });

  // 능력치
  const stats = h(
    'div',
    { class: 'dz-stats' },
    ...STAT_KEYS.map((k) =>
      h(
        'label',
        { class: 'dz-stat' },
        h('span', null, STAT_NAMES[k]),
        numInput(
          `node.stats.${k}`,
          n.stats?.[k] ?? null,
          (v) =>
            upd((x) => {
              const st: Partial<Record<StatKey, number>> = { ...(x.stats ?? {}) };
              if (v === null) delete st[k];
              else st[k] = v;
              if (Object.keys(st).length) x.stats = st;
              else delete x.stats;
            }),
          { min: 1, max: MAX_STAT_VALUE, optional: true, placeholder: '-', width: '100%', title: `필요 ${STAT_NAMES[k]} (비우면 조건 없음, 장비를 뺀 기본 능력치와 비교)` },
          err,
        ),
      ),
    ),
  );

  const kind = def?.kind === 'spell' ? '마법' : '기술';
  return [
    h(
      'div',
      { class: 'dz-phead' },
      h('span', { class: 'dz-ico big', style: `--ic:${def?.icon.color ?? '#777'}` }, (ed?.name ?? id).slice(0, 1)),
      h('div', null, h('h3', null, ed?.name ?? id), h('div', { class: 'dz-hint' }, `${s.className(cls)} ${kind} · ${id} · 줄 ${n.row} · 칸 ${n.col}`)),
    ),
    issueSlot(ctx, (_i, r) => mine(r)),
    h(
      'section',
      { class: 'dz-sec' },
      h('h4', null, '배우는 조건'),
      h(
        'div',
        { class: 'dz-row2' },
        field(
          tier === 2 ? '필요 어빌' : '필요 레벨',
          numInput('node.need', s.need(cls, n), (v) => upd((x) => (tier === 2 ? (x.abilityLevel = v ?? 1) : (x.level = v ?? 1))), { min: 1, max: needMax }, err),
          tier === 2 ? `1 ~ ${needMax}` : `1 ~ ${needMax} (${s.className(cls)} 레벨)`,
        ),
        field('가격 (골드)', numInput('node.gold', n.gold, (v) => upd((x) => (x.gold = v ?? 0)), { min: 0, max: 1_000_000_000_000, big: true }, err), `${bigNumber(n.gold)} 골드`),
      ),
      h('div', { class: 'dz-field' }, h('span', { class: 'dz-label' }, '재료 (배울 때 써서 없어짐)'), ...items, addItem),
      h(
        'div',
        { class: 'dz-field' },
        h('span', { class: 'dz-label' }, '선수과목 (먼저 배워 숙련도를 올려 둘 기술)'),
        ...(reqs.length ? reqs : [h('p', { class: 'dz-hint' }, '없음 — 조건만 채우면 바로 배울 수 있습니다.')]),
        addReq,
      ),
      h('div', { class: 'dz-field' }, h('span', { class: 'dz-label' }, '필요 능력치 (장비를 뺀 기본 능력치)'), stats),
      cls === 'beastkin'
        ? field(
            '수인 계통 전용',
            selectInput(
              'node.beast',
              n.beastType ?? '',
              [{ value: '', label: '공통 (모든 계통)' }, ...prog.second.beastTypes.map((b) => ({ value: b.id, label: b.name }))],
              (v) =>
                upd((x) => {
                  if (v) x.beastType = v;
                  else delete x.beastType;
                }),
            ),
            '고른 계통의 수인만 배웁니다.',
          )
        : null,
    ),
    abilitySection(ctx, id, ed, updAb, err),
    h(
      'div',
      { class: 'dz-actions' },
      h('button', { class: 'btn danger', type: 'button', onclick: () => nodeActions(ctx).deleteSelection() }, '트리에서 빼기'),
      h('span', { class: 'dz-hint' }, 'Delete 키 · 화살표로 한 칸씩 옮기기'),
    ),
  ];
}

function itemOptions(ctx: Ctx): { value: string; label: string; group?: string }[] {
  const order = ['material', 'consumable', 'equip'];
  return [...ctx.store.bundle.items]
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .map((i) => ({ value: i.id, label: i.name, group: ITEM_GROUPS[i.type] ?? i.type }));
}

/** 기술의 이름·설명·마나·재사용 대기 (abilities.json) */
function abilitySection(ctx: Ctx, id: string, ed: AbilityEdit | undefined, updAb: (fn: (x: AbilityEdit) => void) => void, err: (m: string) => void): HTMLElement {
  const s = ctx.store;
  const def = s.def(id);
  if (!ed || !def) return h('section', { class: 'dz-sec' }, h('p', { class: 'dz-hint' }, 'abilities.json 에 없는 기술입니다.'));
  const desc = h('textarea', { 'data-k': 'ab.desc', maxLength: 300, rows: 3 }, ed.desc);
  desc.addEventListener('change', () => updAb((x) => (x.desc = desc.value)));
  const cd = h('input', { type: 'text', inputmode: 'decimal', class: 'dz-num', value: String(ed.cooldownMs / 1000), 'data-k': 'ab.cd', autocomplete: 'off' });
  cd.addEventListener('change', () => {
    const v = Number(cd.value.replace(/[초s\s]/g, ''));
    if (!Number.isFinite(v) || v < 0) {
      cd.value = String(ed.cooldownMs / 1000);
      return err('재사용 대기는 0 이상의 초여야 합니다.');
    }
    const ms = clamp(Math.round(v * 1000), 0, 3_600_000);
    if (ms !== ed.cooldownMs) updAb((x) => (x.cooldownMs = ms));
    else cd.value = String(ed.cooldownMs / 1000);
  });
  cd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cd.blur();
  });
  return h(
    'section',
    { class: 'dz-sec' },
    h('h4', null, '기술 기본값 ', h('small', null, 'abilities.json')),
    field(
      '이름',
      textInput('ab.name', ed.name, (v) => {
        const t = v.trim();
        if (!t || t.length > 20) {
          err(t ? '이름은 20자까지입니다.' : '이름을 비울 수 없습니다.');
          return ctx.render();
        }
        updAb((x) => (x.name = t));
      }, { maxLength: 20 }),
    ),
    field('설명 (게임 툴팁)', desc, `${ed.desc.length}/300`),
    h(
      'div',
      { class: 'dz-row2' },
      field('마나', numInput('ab.mp', ed.mp, (v) => updAb((x) => (x.mp = v ?? 0)), { min: 0, max: 100_000 }, err)),
      field('재사용 대기 (초)', cd),
    ),
    h('div', { class: 'dz-field' }, h('span', { class: 'dz-label' }, '효과 (abilities.json 에서 고침)'), h('ul', { class: 'dz-effects' }, ...def.effects.map((e) => h('li', null, effectText(e))))),
    h('p', { class: 'dz-hint' }, `대상: ${TARGETING[def.targeting] ?? def.targeting}${def.range ? ` · 사거리 ${def.range}` : ''}${def.element && def.element !== 'weapon' ? ` · ${ELEMENT_NAMES[def.element]} 속성` : ''}`),
  );
}

const TARGETING: Record<string, string> = {
  front: '앞 칸',
  around: '주변 4칸',
  around8: '주변 8칸',
  self: '자기 자신',
  enemy: '적 하나',
  ally: '아군 하나',
  enemyArea: '적 주변 범위',
  line: '앞 일직선',
  party: '그룹 전체',
};

/** 효과 한 줄 설명 (편집기에서는 읽기만) */
function effectText(e: AbilityEffect): string {
  const p = (v: number) => `${Math.round(v * 100)}%`;
  switch (e.type) {
    case 'physical':
      return `물리 피해 ×${e.mult}${e.bonus ? ` +${e.bonus}` : ''}${e.hits && e.hits > 1 ? `, ${e.hits}번` : ''}${e.lifesteal ? `, 흡혈 ${p(e.lifesteal)}` : ''}`;
    case 'magic':
      return `마법 피해 ${e.base} + ${e.stat ? STAT_NAMES[e.stat] : '능력치'} ×${e.ratio}`;
    case 'heal':
      return `체력 회복 ${e.base} + ${e.stat ? STAT_NAMES[e.stat] : '능력치'} ×${e.ratio}`;
    case 'status':
      return `상태: ${STATUS_INFO[e.status]?.name ?? e.status} ${e.durationMs / 1000}초${e.chance !== undefined ? ` (확률 ${p(e.chance)})` : ''}`;
    case 'cleanse':
      return '해로운 상태 풀기';
    case 'revive':
      return `부활 (체력 ${p(e.hpPct)})`;
    case 'restoreMp':
      return `마나 회복 (최대치의 ${p(e.pct)})`;
    case 'sacrifice':
      return `체력 ${p(e.hpPct)} 를 바쳐 피해 ×${e.mult}`;
    case 'dash':
      return `${e.distance}칸 돌진`;
    case 'summon':
      return `소환: ${e.monster} ${e.durationMs / 1000}초, 최대 ${e.max}마리${e.count ? `, 한 번에 ${e.count}` : ''}`;
  }
}

// ───────────────────────── 선수과목 화살표 ─────────────────────────

function edgePanel(ctx: Ctx, to: SkillTreeNode, from: string): (Node | null)[] {
  const s = ctx.store;
  const cls = s.cls;
  const r = to.requires.find((x) => x.ability === from)!;
  const max = s.doc.progression.proficiency.max;
  const fromNode = s.node(cls, from);
  const late = fromNode && s.need(cls, fromNode) > s.need(cls, to);
  return [
    h('h3', null, '선수과목'),
    h(
      'p',
      null,
      h('b', null, s.abilityName(to.ability)),
      josa(s.abilityName(to.ability), '을', '를').slice(s.abilityName(to.ability).length),
      ' 배우려면 먼저 ',
      h('b', null, s.abilityName(from)),
      josa(s.abilityName(from), '을', '를').slice(s.abilityName(from).length),
      ' 배워 숙련도를 올려 두어야 합니다.',
    ),
    field(
      `${s.abilityName(from)} 필요 숙련도`,
      numInput(
        'edge.prof',
        r.prof,
        (v) =>
          s.mutate((d) => {
            const x = d.trees[cls].nodes.find((y) => y.ability === to.ability)?.requires.find((y) => y.ability === from);
            if (x) x.prof = v ?? 0;
          }),
        { min: 0, max },
        (m) => ctx.toast(m, false),
      ),
      `0 ~ ${max}. 0 이면 배우기만 하면 됩니다.`,
    ),
    late ? h('p', { class: 'dz-warnbox' }, `${josa(s.abilityName(from), '이', '가')} 이 기술보다 늦게 열립니다 (필요 ${classTier(cls) === 2 ? '어빌' : '레벨'} ${s.need(cls, fromNode!)} > ${s.need(cls, to)}).`) : null,
    h(
      'div',
      { class: 'dz-actions' },
      h('button', { class: 'btn danger', type: 'button', onclick: () => nodeActions(ctx).deleteSelection() }, '연결 지우기'),
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          onclick: () => {
            s.sel = { type: 'node', id: to.ability };
            ctx.render();
          },
        },
        `${s.abilityName(to.ability)} 보기`,
      ),
      h('span', { class: 'dz-hint' }, 'Delete 키'),
    ),
  ];
}

// ───────────────────────── 트리 설정 ─────────────────────────

function treePanel(ctx: Ctx): (Node | null)[] {
  const s = ctx.store;
  const cls = s.cls;
  const tree = s.doc.trees[cls];
  const tier = classTier(cls);
  const cols = tree.columns ?? [];
  const setCols = (fn: (c: string[]) => void) =>
    s.mutate((d) => {
      const c = [...(d.trees[cls].columns ?? [])];
      fn(c);
      while (c.length && !c[c.length - 1]) c.pop();
      if (c.length) d.trees[cls].columns = c;
      else delete d.trees[cls].columns;
    });
  const gold = tree.nodes.reduce((a, n) => a + n.gold, 0);
  const mats = new Map<string, number>();
  for (const n of tree.nodes) for (const it of n.items) mats.set(it.item, (mats.get(it.item) ?? 0) + it.qty);
  const links = tree.nodes.reduce((a, n) => a + n.requires.length, 0);
  const cross = tree.nodes.reduce((a, n) => a + n.requires.filter((r) => !s.node(cls, r.ability)).length, 0);
  const from = tier === 2 ? s.doc.progression.second.from[cls as 'gladiator'] : [];
  return [
    h('h3', null, `${s.className(cls)} 트리`),
    h(
      'p',
      { class: 'dz-hint' },
      tier === 0
        ? '평민 트리의 기술은 누구나 수련장 관리인에게서 배웁니다.'
        : tier === 1
          ? `${s.className(cls)} 길드장이 지금 ${s.className(cls)}인 사람에게 가르칩니다. 줄은 필요 레벨 단계입니다.`
          : `${s.className(cls)} 스승이 가르치고, 필요 레벨 대신 필요 어빌로 배웁니다. ${from.length ? `${from.map((f) => s.className(f)).join('·')}에서 2차 전직합니다.` : ''}`,
    ),
    h('p', { class: 'dz-hint' }, '기술을 누르면 배우는 조건과 기술 값을, 화살표를 누르면 필요 숙련도를 고칩니다.'),
    h(
      'div',
      { class: 'dz-field' },
      h('span', { class: 'dz-label' }, `열 제목 (갈래 이름, ${TREE_MAX_COLS}개까지)`),
      h(
        'div',
        { class: 'dz-chips' },
        ...cols.map((c, i) =>
          h(
            'span',
            { class: 'dz-chip' },
            h('small', null, `${i}`),
            textInput(`cols.${i}`, c, (v) => setCols((x) => (x[i] = v.trim().slice(0, 12))), { maxLength: 12, width: '84px' }),
            h('button', { type: 'button', title: '열 제목 지우기', onclick: () => setCols((x) => x.splice(i, 1)) }, '×'),
          ),
        ),
        cols.length < TREE_MAX_COLS
          ? h(
              'button',
              {
                class: 'btn small',
                type: 'button',
                onclick: () => {
                  setCols((x) => x.push('새 갈래'));
                  s.focusNext = `cols.${cols.length}`;
                },
              },
              '+ 열 제목',
            )
          : null,
      ),
    ),
    h(
      'div',
      { class: 'dz-kv' },
      h('div', null, h('span', null, '기술'), h('b', null, `${tree.nodes.length}개`)),
      h('div', null, h('span', null, '모두 배우는 골드'), h('b', null, bigNumber(gold))),
      h('div', null, h('span', null, '선수과목 연결'), h('b', null, `${links}개${cross ? ` (다른 트리 ${cross})` : ''}`)),
      h('div', null, h('span', null, '재료 종류'), h('b', null, `${mats.size}가지`)),
    ),
    mats.size
      ? h(
          'details',
          { class: 'dz-details' },
          h('summary', null, '모두 배우는 데 드는 재료'),
          h('ul', null, ...[...mats].map(([id, q]) => h('li', null, `${s.itemName(id)} ${fmtNum(q)}개`))),
        )
      : null,
    cls === 'beastkin'
      ? h(
          'p',
          { class: 'dz-note' },
          `수인은 2차 전직 때 ${s.doc.progression.second.beastTypes.map((b) => b.name).join('·')} 중 하나를 고르고, 계통 전용 기술은 그 계통만 배웁니다. 노드의 "수인 계통 전용"에서 정합니다.`,
        )
      : null,
    h('p', { class: 'dz-note' }, '저장하면 검사를 거쳐 gamedata/skilltrees.json·abilities.json 에 쓰고, 서버를 끄지 않고 바로 게임에 반영합니다. 이전 판은 판 기록에 남습니다.'),
    h(
      'div',
      { class: 'dz-actions' },
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          onclick: () => {
            s.preview = true;
            ctx.render();
          },
        },
        '게임 화면 미리보기',
      ),
    ),
  ];
}
