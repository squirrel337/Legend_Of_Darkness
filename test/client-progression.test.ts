// 클라이언트 성장 체계 화면 계산 점검: 클라이언트 상태로 만든 배우기 조건이 서버와 같은 판정을 내는지,
// 길드장 창의 다시 판정·조건 설명, 숙련도 표시, 스킬트리 창(K)의 탭·칸 배치·선수과목 선·수인 계통 열, HUD 글씨.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { ClassId } from '../src/shared/constants';
import {
  learnStatus,
  publicProgression,
  type ProgressionConfig,
  type ProficiencyConfig,
  type SkillTreeConfig,
  type SkillTreeNode,
  type SkillTreesConfig,
} from '../src/shared/progression';
import type { InvSlot, LearnEntry, SelfState } from '../src/shared/protocol';
import {
  TREE_COL_W,
  TREE_GUTTER,
  TREE_HEAD_H,
  TREE_NODE,
  TREE_PAD,
  TREE_ROW_H,
  abilityExpPct,
  abilityExpTitle,
  beastColumns,
  bezierPoint,
  classLabel,
  clientLearnContext,
  countItems,
  edgeGeometry,
  growthParts,
  layoutTree,
  learnEntriesFor,
  nodeLook,
  otherBranch,
  profChanceLine,
  profInfo,
  profLine,
  rebirthWord,
  refreshLearnEntries,
  reqDetail,
  reqText,
  teacherOf,
  treeNote,
  treeTabs,
  type LearnSource,
} from '../src/client/progression';
import { learnContextOf, learnEntries } from '../src/server/systems/progression';
import { GameData } from '../src/server/gamedata';
import { emptyEquipment, normalizeCharacter } from '../src/server/storage';
import { ROOT } from './helpers';

const DIR = path.join(ROOT, 'gamedata');
const gd = GameData.load(DIR);
const PROF: ProficiencyConfig = { max: 100, baseChance: 0.35, slowdown: 0.8, minChance: 0.03, effectMin: 0.7, effectMax: 1.15 };
const BEASTS = [
  { id: 'mammal', name: '포유류' },
  { id: 'bird', name: '조류' },
  { id: 'reptile', name: '파충류' },
];

const node = (ability: string, row: number, col: number, extra: Partial<SkillTreeNode> = {}): SkillTreeNode => ({
  ability,
  row,
  col,
  level: 1,
  gold: 0,
  items: [],
  requires: [],
  ...extra,
});

/** 시험용 이름표 (기술 이름·종류) */
const ABILITIES = new Map<string, { name: string; kind: 'skill' | 'spell' }>([
  ['a', { name: '강타', kind: 'skill' }],
  ['b', { name: '회오리 베기', kind: 'skill' }],
  ['c', { name: '돌진', kind: 'skill' }],
  ['m', { name: '화염', kind: 'spell' }],
]);

function source(over: Omit<Partial<LearnSource>, 'self'> & { self?: Partial<LearnSource['self']> } = {}): LearnSource {
  const { self, ...rest } = over;
  return {
    self: {
      classId: 'warrior',
      level: 20,
      abilityLevel: 0,
      base: { str: 10, int: 3, wis: 3, con: 8, dex: 5 },
      beastType: null,
      prof: { a: 12 },
      ...self,
    },
    gold: 1000,
    skills: ['a'],
    spells: [],
    inventory: [{ item: 'pelt', qty: 2 }, null, { item: 'pelt', qty: 1 }, { item: 'bone', qty: 5 }],
    abilities: ABILITIES,
    items: new Map([
      ['pelt', { name: '늑대 가죽' }],
      ['bone', { name: '뼈' }],
    ]),
    beastTypes: BEASTS,
    ...rest,
  };
}

// ───────────────────────── 배우기 조건 ─────────────────────────

test('소지품 개수: 같은 아이템의 여러 칸을 모두 센다 (빈 칸은 건너뜀)', () => {
  const inv: (InvSlot | null)[] = [{ item: 'pelt', qty: 2 }, null, { item: 'pelt', qty: 3 }, { item: 'bone', qty: 1 }];
  assert.equal(countItems(inv, 'pelt'), 5);
  assert.equal(countItems(inv, 'bone'), 1);
  assert.equal(countItems(inv, 'none'), 0);
});

test('클라이언트 배우기 조건: 레벨·골드·재료·선수과목 숙련도·능력치를 SelfState 와 소지품으로 판정한다', () => {
  const ctx = clientLearnContext(source());
  const n = node('b', 1, 0, {
    level: 12,
    gold: 800,
    items: [{ item: 'pelt', qty: 3 }],
    requires: [{ ability: 'a', prof: 30 }],
    stats: { str: 10 },
  });
  const s = learnStatus('warrior', n, ctx);
  assert.equal(s.learned, false);
  assert.equal(s.learnable, false, '강타 숙련도가 12 라 모자람');
  assert.deepEqual(
    s.reqs.map((r) => [r.kind, r.met]),
    [
      ['level', true],
      ['gold', true],
      ['item', true],
      ['requires', false],
      ['stat', true],
    ],
  );
  assert.match(s.reason ?? '', /선수과목/);
  // 숙련도를 올리면 배울 수 있음
  const ok = learnStatus('warrior', n, clientLearnContext(source({ self: { prof: { a: 30 } } })));
  assert.equal(ok.learnable, true);
  assert.equal(ok.reason, undefined);
});

test('클라이언트 배우기 조건은 서버(learnContextOf)와 실제 트리의 모든 칸에서 같은 판정을 낸다', () => {
  // 운영자가 아닌 99레벨 궁사: 도적 기술 몇 개와 재료, 골드가 조금 있음
  const data = normalizeCharacter({
    name: '시험',
    classId: 'archer',
    level: 99,
    abilityLevel: 30,
    gold: 6000,
    skills: ['r_stab', 'r_double', 'a_aimed'],
    prof: { r_stab: 100, r_double: 40, a_aimed: 25 },
    stats: { str: 30, int: 10, wis: 10, con: 30, dex: 70 },
    inventory: [{ item: 'mat_wolf_pelt', qty: 5 }, null, { item: 'mat_orc_tusk', qty: 1 }],
    equipment: emptyEquipment(),
  });
  const server = learnContextOf(data, gd);
  const client = clientLearnContext({
    self: { classId: data.classId, level: data.level, abilityLevel: data.abilityLevel, base: { ...data.stats }, beastType: data.beastType, prof: { ...data.prof } },
    gold: data.gold,
    skills: data.skills,
    spells: data.spells,
    inventory: data.inventory,
    abilities: gd.abilities,
    items: gd.items,
    beastTypes: gd.progression.second.beastTypes,
  });
  let compared = 0;
  for (const [cls, tree] of Object.entries(gd.skillTrees.trees) as [ClassId, SkillTreeConfig][]) {
    for (const n of tree.nodes) {
      assert.deepEqual(learnStatus(cls, n, client), learnStatus(cls, n, server), `${cls}/${n.ability}`);
      compared++;
    }
  }
  assert.ok(compared > 20);
});

test('길드장 창 다시 판정: 골드가 줄면 배우기가 막히고, 이유가 없어지면 reason 도 지운다', () => {
  const tree: SkillTreeConfig = { nodes: [node('c', 2, 0, { level: 30, gold: 50 }), node('b', 1, 0, { level: 12, gold: 800, requires: [{ ability: 'a', prof: 10 }] })] };
  const before: LearnEntry[] = [
    { id: 'b', level: 12, abilityLevel: 0, price: 800, learned: false, learnable: true, reqs: [] },
    { id: 'c', level: 30, abilityLevel: 0, price: 50, learned: false, learnable: false, reason: '조건이 모자랍니다: 레벨 30 이상', reqs: [] },
    // 설계에서 빠진 기술 (트리를 알면 목록에서 사라짐)
    { id: 'zz', level: 1, abilityLevel: 0, price: 0, learned: false, learnable: true, reqs: [] },
  ];
  const poor = refreshLearnEntries('warrior', before, tree, clientLearnContext(source({ gold: 100 })));
  assert.deepEqual(
    poor.map((e) => e.id),
    ['b', 'c'],
    '필요 레벨 순, 트리에 없는 기술은 뺌',
  );
  assert.equal(poor[0]!.learnable, false);
  assert.match(poor[0]!.reason ?? '', /800 골드/);
  assert.equal(poor[1]!.learnable, false);
  // 트리를 모르면 서버가 보낸 목록 그대로
  assert.deepEqual(refreshLearnEntries('warrior', before, undefined, clientLearnContext(source())), before);
  const rich = refreshLearnEntries('warrior', poor, tree, clientLearnContext(source({ gold: 5000, self: { level: 30 } })));
  assert.equal(rich[0]!.learnable, true);
  assert.equal('reason' in rich[0]!, false, '배울 수 있으면 예전 이유가 남지 않음');
  assert.equal(rich[1]!.learnable, true);
  assert.deepEqual(
    rich[1]!.reqs.map((r) => r.label),
    ['레벨 30 이상', '50 골드'],
  );
});

test('길드장 창 목록은 서버의 learnEntries 와 실제 트리의 모든 직업에서 같다', () => {
  const data = normalizeCharacter({
    name: '시험2',
    classId: 'wizard',
    level: 45,
    gold: 30000,
    skills: [],
    spells: ['z_fire1', 'z_fire2', 'z_sleep'],
    prof: { z_fire1: 80, z_fire2: 49, z_sleep: 30 },
    inventory: [{ item: 'mat_ecto', qty: 3 }],
  });
  const client = clientLearnContext({
    self: { classId: data.classId, level: data.level, abilityLevel: data.abilityLevel, base: { ...data.stats }, beastType: data.beastType, prof: { ...data.prof } },
    gold: data.gold,
    skills: data.skills,
    spells: data.spells,
    inventory: data.inventory,
    abilities: gd.abilities,
    items: gd.items,
    beastTypes: gd.progression.second.beastTypes,
  });
  for (const [cls, tree] of Object.entries(gd.skillTrees.trees) as [ClassId, SkillTreeConfig][]) {
    assert.deepEqual(learnEntriesFor(cls, tree, client), learnEntries(data, gd, cls), cls);
  }
});

test('조건 설명: 채우지 못한 조건에만 지금 값을 붙인다', () => {
  assert.equal(reqText({ kind: 'level', label: '레벨 12 이상', met: false, have: 8, need: 12 }), '레벨 12 이상 (지금 8)');
  assert.equal(reqText({ kind: 'level', label: '레벨 12 이상', met: true, have: 20, need: 12 }), '레벨 12 이상');
  assert.equal(reqText({ kind: 'gold', label: '12,000 골드', met: false, have: 500, need: 12000 }), '12,000 골드 (가진 골드 500)');
  assert.equal(reqText({ kind: 'item', label: '늑대 가죽 3개', met: false, have: 2, need: 3 }), '늑대 가죽 3개 (2/3개)');
  assert.equal(reqText({ kind: 'requires', label: '강타 숙련도 30 이상', met: false, need: 30 }), '강타 숙련도 30 이상 (배우지 않음)');
  assert.equal(reqText({ kind: 'requires', label: '강타 숙련도 30 이상', met: false, have: 12, need: 30 }), '강타 숙련도 30 이상 (지금 12)');
  assert.equal(reqText({ kind: 'abilityLevel', label: '어빌 25 이상', met: false, have: 3, need: 25 }), '어빌 25 이상 (지금 3)');
  assert.equal(reqDetail({ kind: 'beastType', label: '조류 계통', met: false }), '');
  assert.equal(reqDetail({ kind: 'class', label: '지금 직업의 기술이 아님', met: false }), '');
});

test('배우는 곳: 평민 트리는 수련장, 1차·2차 직업은 그 직업의 길드장', () => {
  assert.equal(teacherOf('peasant', '평민'), '수련장 관리인');
  assert.equal(teacherOf('warrior', '전사'), '전사 길드장');
  assert.equal(teacherOf('archer', '궁사'), '궁사 길드장');
});

// ───────────────────────── 숙련도 ─────────────────────────

test('숙련도 표시: 막대 비율, 위력 70% → 115%, 오를 확률은 높을수록 낮고 최대면 0', () => {
  const zero = profInfo(0, PROF);
  assert.deepEqual([zero.ratio, zero.effectPct, zero.chancePct, zero.maxed], [0, 70, 35, false]);
  const half = profInfo(50, PROF);
  assert.equal(half.effectPct, 93);
  assert.equal(half.chancePct, 21);
  const max = profInfo(100, PROF);
  assert.deepEqual([max.ratio, max.effectPct, max.chancePct, max.maxed], [1, 115, 0, true]);
  // 범위를 벗어난 값은 잘라서 보여 줌
  assert.equal(profInfo(140, PROF).prof, 100);
  assert.equal(profInfo(-3, PROF).prof, 0);
  assert.equal(profLine(45, PROF), '숙련도 45 / 100 · 위력 90%');
  assert.equal(profChanceLine(100, PROF), '숙련도가 최대입니다.');
  assert.equal(profChanceLine(99, PROF), '한 번 쓸 때 숙련도가 오를 확률 7.3%');
});

// ───────────────────────── 스킬트리 창 ─────────────────────────

test('스킬트리 탭: 지금 직업 → 2차 전직해 온 1차 직업 → 배운 기술이 있는 다른 직업 → 평민', () => {
  const trees = Object.fromEntries((['peasant', 'warrior', 'rogue', 'wizard', 'archer'] as ClassId[]).map((c) => [c, { nodes: [node(`${c}_1`, 0, 0)] }])) as Partial<
    Record<ClassId, SkillTreeConfig>
  >;
  const from = { archer: ['rogue'] as ClassId[] };
  // 전사로 전직했던 궁사: 전사 기술을 배워 두었음
  const learned = new Set(['warrior_1', 'archer_1']);
  assert.deepEqual(treeTabs('archer', (id) => learned.has(id), trees, from), ['archer', 'rogue', 'warrior', 'peasant']);
  // 갈 수 있는 1차 직업이 여럿이면 (어디서 왔는지 모르므로) 배운 기술이 있는 직업만
  const many = { archer: ['rogue', 'wizard'] as ClassId[] };
  assert.deepEqual(treeTabs('archer', (id) => learned.has(id), trees, many), ['archer', 'warrior', 'peasant']);
  assert.deepEqual(treeTabs('wizard', () => false, trees, from), ['wizard', 'peasant']);
  assert.deepEqual(treeTabs('peasant', () => false, trees, from), ['peasant']);
  // 트리가 없는 직업은 넣지 않음
  assert.deepEqual(treeTabs('monk', () => false, trees, from), ['peasant']);
});

test('스킬트리 배치: 빈 줄은 접고 열은 그대로, 줄 표시는 그 줄의 가장 낮은 필요 레벨', () => {
  const tree: SkillTreeConfig = {
    columns: ['베기', '돌격'],
    nodes: [node('a', 0, 0, { level: 5 }), node('b', 4, 1, { level: 12, requires: [{ ability: 'a', prof: 20 }] }), node('c', 4, 0, { level: 15 })],
  };
  const lay = layoutTree(tree);
  assert.equal(lay.cols, 2);
  assert.deepEqual(
    lay.rows.map((r) => [r.row, r.label]),
    [
      [0, 'Lv5'],
      [4, 'Lv12'],
    ],
  );
  const at = (id: string) => lay.cells.find((c) => c.node.ability === id)!;
  assert.equal(at('a').x, TREE_GUTTER + (TREE_COL_W - TREE_NODE) / 2);
  assert.equal(at('a').y, TREE_PAD + TREE_HEAD_H);
  assert.equal(at('b').y, TREE_PAD + TREE_HEAD_H + TREE_ROW_H, '줄 1~3 은 비어 있어 접힘');
  assert.equal(at('b').x, at('a').x + TREE_COL_W);
  assert.deepEqual(
    lay.heads.map((x) => x.title),
    ['베기', '돌격'],
  );
  assert.equal(lay.edges.length, 1);
  assert.deepEqual([lay.edges[0]!.from, lay.edges[0]!.to, lay.edges[0]!.prof], ['a', 'b', 20]);
  assert.ok(lay.width >= TREE_GUTTER + 2 * TREE_COL_W);
  assert.ok(lay.height > at('b').y + TREE_NODE);
});

test('스킬트리 배치: 2차 직업 트리는 어빌, 다른 트리의 선수과목은 선 대신 칸 귀퉁이 표시, 열 제목이 없으면 머리 줄도 없음', () => {
  const tree: SkillTreeConfig = {
    nodes: [
      node('s1', 0, 0, { level: undefined, abilityLevel: 5, requires: [{ ability: 'z_focus', prof: 50 }] }),
      node('s2', 1, 0, { level: undefined, abilityLevel: 12, requires: [{ ability: 's1', prof: 20 }, { ability: 'z_blink', prof: 0 }] }),
    ],
  };
  const lay = layoutTree(tree);
  assert.deepEqual(
    lay.rows.map((r) => r.label),
    ['어빌 5', '어빌 12'],
  );
  assert.equal(lay.heads.length, 0);
  assert.equal(lay.cells[0]!.y, TREE_PAD, '열 제목이 없으면 머리 줄 높이를 쓰지 않음');
  assert.deepEqual(lay.external, { s1: [{ ability: 'z_focus', prof: 50 }], s2: [{ ability: 'z_blink', prof: 0 }] });
  assert.deepEqual(
    lay.edges.map((e) => `${e.from}>${e.to}`),
    ['s1>s2'],
  );
});

test('선수과목 선: 위 줄 → 아래 줄은 이름표 밑에서 휘어 내려오고, 같은 줄은 옆면끼리 곧게', () => {
  const down = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 200 });
  assert.match(down.d, /^M 22 \d+(\.\d)? C /);
  assert.ok(down.d.endsWith('122 200'), down.d);
  // 숙련도 표시는 아래 칸 가까이 (곡선의 72% 지점)
  assert.ok(down.badge.y > 100 && down.badge.y < 200);
  const side = edgeGeometry({ x: 0, y: 50 }, { x: 200, y: 50 });
  assert.equal(side.d, `M ${TREE_NODE} 72 L 200 72`);
  const back = edgeGeometry({ x: 200, y: 50 }, { x: 0, y: 50 });
  assert.equal(back.d, `M 200 72 L ${TREE_NODE} 72`);
  const p = bezierPoint({ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, 0.5);
  assert.deepEqual(p, { x: 50, y: 50 });
});

test('선수과목 선: 같은 열에서 사이 칸을 건너뛰면 열 사이의 빈 길로 비켜 간다 (마지막 열은 왼쪽 길)', () => {
  const tree: SkillTreeConfig = {
    nodes: [
      node('a', 0, 0),
      node('b', 1, 0, { requires: [{ ability: 'a', prof: 20 }] }),
      node('c', 2, 0, { requires: [{ ability: 'a', prof: 30 }, { ability: 'b', prof: 10 }] }),
      node('d', 0, 1),
      node('e', 2, 1, { requires: [{ ability: 'd', prof: 0 }] }),
    ],
  };
  const lay = layoutTree(tree);
  const edge = (from: string, to: string) => lay.edges.find((e) => e.from === from && e.to === to)!;
  const ax = lay.cells.find((c) => c.node.ability === 'a')!.x;
  const lane = ax + TREE_NODE / 2 + TREE_COL_W / 2;
  // a → c 는 b 를 가로지르므로 오른쪽 길, a → b·b → c 는 바로 아래라 곧은 곡선
  assert.ok(edge('a', 'c').d.includes(`L ${lane} `), edge('a', 'c').d);
  assert.equal(edge('a', 'c').badge.x, lane);
  assert.ok(!edge('a', 'b').d.includes('L '));
  assert.ok(!edge('b', 'c').d.includes('L '));
  // 마지막 열(1)의 d → e 는 사이 칸이 없으니 곧은 곡선
  assert.ok(!edge('d', 'e').d.includes('L '));
  // 마지막 열에서 막히면 왼쪽 길
  const last = layoutTree({ nodes: [node('p', 0, 1), node('q', 1, 1), node('r', 2, 1, { requires: [{ ability: 'p', prof: 5 }] }), node('s', 0, 0)] });
  const px = last.cells.find((c) => c.node.ability === 'p')!.x;
  assert.ok(last.edges[0]!.d.includes(`L ${px + TREE_NODE / 2 - TREE_COL_W / 2} `), last.edges[0]!.d);
});

test('수인 계통 열: 한 열의 기술이 모두 같은 계통이면 그 계통, 섞였거나 계통이 없으면 아님', () => {
  const tree: SkillTreeConfig = {
    columns: ['발톱', '야성', '포유류', '조류', '혼합'],
    nodes: [
      node('k1', 0, 0),
      node('k2', 1, 2, { beastType: 'mammal' }),
      node('k3', 2, 2, { beastType: 'mammal' }),
      node('k4', 1, 3, { beastType: 'bird' }),
      node('k5', 1, 4, { beastType: 'reptile' }),
      node('k6', 2, 4),
    ],
  };
  assert.deepEqual([...beastColumns(tree)].sort(), [
    [2, 'mammal'],
    [3, 'bird'],
  ]);
  const heads = layoutTree(tree).heads;
  assert.deepEqual(
    heads.map((x) => [x.title, x.beastType ?? '']),
    [
      ['발톱', ''],
      ['야성', ''],
      ['포유류', 'mammal'],
      ['조류', 'bird'],
      ['혼합', ''],
    ],
  );
  // 내 계통을 골랐을 때만 다른 계통을 흐리게
  assert.equal(otherBranch('bird', 'mammal'), true);
  assert.equal(otherBranch('mammal', 'mammal'), false);
  assert.equal(otherBranch(undefined, 'mammal'), false);
  assert.equal(otherBranch('bird', null), false);
});

test('실제 스킬트리: 모든 직업의 칸이 서로 겹치지 않고, 같은 트리의 선수과목은 모두 선으로 그린다', () => {
  const trees = JSON.parse(fs.readFileSync(path.join(DIR, 'skilltrees.json'), 'utf8')) as SkillTreesConfig;
  for (const [cls, raw] of Object.entries(trees.trees)) {
    const tree = { ...raw, nodes: raw.nodes.map((n) => ({ ...n, items: n.items ?? [], requires: n.requires ?? [] })) };
    const lay = layoutTree(tree);
    const spots = new Set(lay.cells.map((c) => `${c.x},${c.y}`));
    assert.equal(spots.size, tree.nodes.length, `${cls}: 칸이 겹침`);
    const ids = new Set(tree.nodes.map((n) => n.ability));
    const inTree = tree.nodes.reduce((s, n) => s + n.requires.filter((r) => ids.has(r.ability)).length, 0);
    assert.equal(lay.edges.length, inTree, `${cls}: 선 개수`);
    for (const c of lay.cells) {
      assert.ok(c.x >= TREE_GUTTER && c.x + TREE_NODE <= lay.width, `${cls}/${c.node.ability}: 가로`);
      assert.ok(c.y >= TREE_PAD && c.y + TREE_NODE <= lay.height, `${cls}/${c.node.ability}: 세로`);
    }
  }
});

test('칸 모양: 배움 / 배울 수 있음 / 잠김', () => {
  assert.equal(nodeLook({ learned: true, learnable: false, reqs: [] }), 'learned');
  assert.equal(nodeLook({ learned: false, learnable: true, reqs: [] }), 'learnable');
  assert.equal(nodeLook({ learned: false, learnable: false, reason: 'x', reqs: [] }), 'locked');
});

// ───────────────────────── HUD · 캐릭터 창 ─────────────────────────

const PROG = publicProgression(JSON.parse(fs.readFileSync(path.join(DIR, 'progression.json'), 'utf8')) as ProgressionConfig);

function self(over: Partial<SelfState>): Pick<SelfState, 'classId' | 'title' | 'rebirths' | 'abilityLevel' | 'abilityExp' | 'abilityExpNext' | 'beastType'> {
  return { classId: 'warrior', title: '', rebirths: 0, abilityLevel: 0, abilityExp: 0, abilityExpNext: 0, beastType: null, ...over };
}

test('성장 글씨: 칭호·전직 횟수(무도가와 수인은 환골탈태)·어빌', () => {
  assert.deepEqual(growthParts(self({}), PROG), []);
  assert.deepEqual(growthParts(self({ rebirths: 2 }), PROG), ['전직 2회']);
  assert.deepEqual(growthParts(self({ classId: 'monk', rebirths: 1, title: '마스터' }), PROG), ['마스터', '환골탈태 1회']);
  assert.deepEqual(growthParts(self({ classId: 'beastkin', rebirths: 3, title: '마스터', abilityLevel: 12 }), PROG), ['마스터', '환골탈태 3회', '어빌 12']);
  assert.deepEqual(growthParts(self({ classId: 'archer', rebirths: 1, title: '마스터', abilityLevel: 1 }), PROG), ['마스터', '전직 1회', '어빌 1']);
  assert.equal(rebirthWord('peasant', PROG), '전직');
});

test('스킬트리 안내: 지금 직업이 아닌 트리는 전직·2차 전직으로 배울 수 있게 되는지 알려 준다', () => {
  const names: Record<string, string> = { warrior: '전사', rogue: '도적', monk: '무도가', gladiator: '검투사', beastkin: '수인', archer: '궁사' };
  const cn = (c: ClassId) => names[c] ?? c;
  const plain: SkillTreeConfig = { nodes: [node('x', 0, 0)] };
  const beasty: SkillTreeConfig = { nodes: [node('k', 0, 0, { beastType: 'bird' })] };
  const me = (classId: ClassId, ascended = false, beastType: string | null = null) => ({ classId, ascended, beastType });
  assert.equal(treeNote('peasant', me('warrior'), PROG, plain, cn), '평민 기술은 누구나 수련장 관리인에게서 배웁니다.');
  assert.equal(treeNote('warrior', me('warrior'), PROG, plain, cn), '', '지금 직업의 트리');
  assert.match(treeNote('rogue', me('warrior'), PROG, plain, cn), /도적\(으\)로 전직하면 배울 수 있습니다/);
  // 무도가는 환골탈태로 무도가만, 다른 직업은 무도가가 될 수 없음
  assert.doesNotMatch(treeNote('monk', me('warrior'), PROG, plain, cn), /배울 수 있습니다\./);
  assert.doesNotMatch(treeNote('warrior', me('monk'), PROG, plain, cn), /전직하면/);
  // 승급한 뒤에는 전직할 수 없음 (설정 allowAfterAscend: false), 2차 전직은 승급 뒤
  assert.doesNotMatch(treeNote('rogue', me('warrior', true), PROG, plain, cn), /전직하면/);
  assert.match(treeNote('gladiator', me('warrior'), PROG, plain, cn), /승급한 뒤 검투사\(으\)로 2차 전직하면 배울 수 있습니다/);
  assert.match(treeNote('gladiator', me('warrior', true), PROG, plain, cn), /^지금 직업의 기술이 아니라 배울 수 없습니다\. 검투사\(으\)로 2차 전직하면/);
  assert.doesNotMatch(treeNote('archer', me('warrior', true), PROG, plain, cn), /2차 전직하면/);
  // 수인 계통
  assert.match(treeNote('beastkin', me('monk'), PROG, beasty, cn), /포유류·조류·파충류 중 한 계통을 고릅니다/);
  assert.match(treeNote('beastkin', me('beastkin'), PROG, beasty, cn), /^아직 수인 계통을 고르지 않았습니다/);
  assert.equal(treeNote('beastkin', me('beastkin', true, 'bird'), PROG, beasty, cn), '조류 계통입니다. 다른 계통의 기술은 배울 수 없습니다.');
});

test('수인 이름에는 계통을 붙인다', () => {
  assert.equal(classLabel('수인', { classId: 'beastkin', beastType: 'bird' }, BEASTS), '조류 수인');
  assert.equal(classLabel('수인', { classId: 'beastkin', beastType: null }, BEASTS), '수인');
  assert.equal(classLabel('궁사', { classId: 'archer', beastType: null }, BEASTS), '궁사');
});

test('어빌 경험치 막대: 2차 직업이 아니면 없음, 만렙이면 가득', () => {
  assert.equal(abilityExpPct(self({})), null);
  assert.equal(abilityExpPct(self({ abilityLevel: 3, abilityExp: 50, abilityExpNext: 200 })), 25);
  assert.equal(abilityExpPct(self({ abilityLevel: 99, abilityExp: 0, abilityExpNext: 0 })), 100);
  assert.equal(abilityExpTitle(self({ abilityLevel: 3, abilityExp: 1234, abilityExpNext: 5678 })), '어빌 경험치 1,234 / 5,678');
  assert.equal(abilityExpTitle(self({ abilityLevel: 99 })), '어빌 99 (만렙)');
  assert.equal(abilityExpTitle(self({})), '');
});
