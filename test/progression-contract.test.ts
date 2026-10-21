// 성장 체계 계약: 설계 파일(progression.json·skilltrees.json)의 기본값과 검사, 저장 파일 이전(숙련도·어빌),
// 공용 공식과 배우는 조건의 상태, 5레벨 직업 선택과 기술 배우기 창의 메시지 모양을 확인합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { CLASS_IDS } from '../src/shared/constants';
import { expToNext } from '../src/shared/formulas';
import {
  abilityExpToNext,
  abilityVitals,
  bigNumber,
  classTier,
  DEFAULT_SECOND_FROM,
  describeCondition,
  FIRST_CLASSES,
  learnStatus,
  profEffect,
  profGainChance,
  publicProgression,
  SECOND_CLASSES,
  secondClassesOf,
  type LearnContext,
  type ProgressionConfig,
  type SkillTreeNode,
  type SkillTreesConfig,
} from '../src/shared/progression';
import type { DesignIssue } from '../src/shared/progression';
import { startServer, type RunningServer } from '../src/server/app';
import { checkDesign, formatListFile, formatProgression, formatSkillTrees, GameData, GameDataError } from '../src/server/gamedata';
import { emptyEquipment, normalizeCharacter } from '../src/server/storage';
import { learnOnData, setClassOnData } from '../src/server/systems/character';
import { ADMIN_PW, Client, create, httpJson, testConfig } from './helpers';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

/** 설계를 고쳐 검사한 결과의 오류만 */
function errorsOf(edit: (d: { progression: ProgressionConfig; skillTrees: SkillTreesConfig }) => void): DesignIssue[] {
  const d = { progression: readJson('progression.json') as ProgressionConfig, skillTrees: readJson('skilltrees.json') as SkillTreesConfig };
  edit(d);
  return checkDesign(d, gd).filter((i) => i.level === 'error');
}

const has = (list: DesignIssue[], re: RegExp) => list.some((i) => re.test(`${i.where} ${i.msg}`));

// ───────────────────────── 설계 파일 ─────────────────────────

test('progression.json 의 기본값은 설계 문서(원작 수치)와 같다', () => {
  const p = gd.progression;
  assert.equal(p.rebirth.level, 99);
  assert.equal(p.rebirth.restartLevel, 1);
  assert.equal(p.rebirth.allowAfterAscend, false);
  assert.equal(p.rebirth.names.monk, '환골탈태');
  assert.equal(p.rebirth.names.warrior, '전직');
  // 무도가는 무도가로만, 다른 직업은 무도가로 갈 수 없고 같은 직업으로는 갈 수 있음
  assert.deepEqual(p.rebirth.targets.monk, ['monk']);
  for (const c of FIRST_CLASSES.filter((x) => x !== 'monk')) {
    assert.ok(!p.rebirth.targets[c].includes('monk'), c);
    assert.ok(p.rebirth.targets[c].includes(c), c);
  }
  const pure = (list: ProgressionConfig['rebirth']['conditions']['warrior']) =>
    list.flatMap((c) => (c.type === 'pureHp' || c.type === 'pureMp' ? [c.min] : []));
  assert.deepEqual(pure(p.rebirth.conditions.warrior), [14000, 3500]);
  assert.deepEqual(pure(p.rebirth.conditions.priest), [11000, 12000]);
  assert.deepEqual(pure(p.ascend.conditions.wizard), [12000, 13000]);
  assert.deepEqual(pure(p.ascend.conditions.monk), [16000, 7000]);
  for (const c of FIRST_CLASSES) {
    assert.ok(p.rebirth.conditions[c].some((x) => x.type === 'exp' && x.min === 100_000_000 && x.consume), c);
    assert.ok(p.ascend.conditions[c].some((x) => x.type === 'exp' && x.min === 250_000_000 && x.consume), c);
    // 승급: 그 직업의 핵심 기술 2개를 숙련도 100 으로
    const core = p.ascend.conditions[c].filter((x) => x.type === 'skillProf');
    assert.equal(core.length, 2, c);
    for (const x of core) {
      assert.ok(x.type === 'skillProf' && x.min === 100 && gd.abilities.get(x.ability)?.classId === c, `${c}: ${JSON.stringify(x)}`);
    }
  }
  const core = (c: (typeof FIRST_CLASSES)[number]) =>
    p.ascend.conditions[c].flatMap((x) => (x.type === 'skillProf' ? [gd.abilities.get(x.ability)!.name] : []));
  assert.deepEqual(core('warrior'), ['철벽', '필살']);
  assert.deepEqual(core('rogue'), ['은신', '그림자 일격']);
  assert.deepEqual(core('wizard'), ['마력 집중', '순간이동']);
  assert.deepEqual(core('priest'), ['대치유', '부활']);
  assert.deepEqual(core('monk'), ['명상', '금강불괴']);
  assert.deepEqual(p.ascend.expTrade, { exp: 500_000, hp: 100, mp: 50 });
  assert.deepEqual(p.ascend.hpToStat, { hp: 150, stat: 1 });
  assert.equal(p.ascend.title, '마스터');
  // 2차 전직: 승급 + 경험치 10억 + 순수 체력·마력 500 씩
  assert.deepEqual(p.second.from, DEFAULT_SECOND_FROM);
  for (const c of SECOND_CLASSES) {
    assert.deepEqual(p.second.conditions[c], [
      { type: 'ascended' },
      { type: 'exp', min: 1_000_000_000, consume: true },
      { type: 'payHp', amount: 500 },
      { type: 'payMp', amount: 500 },
    ]);
  }
  assert.deepEqual(
    p.second.beastTypes.map((b) => b.name),
    ['포유류', '조류', '파충류'],
  );
  assert.deepEqual(p.ability, { maxLevel: 99, expRatio: 0.25, hpPerLevel: 30, mpPerLevel: 15 });
  assert.deepEqual(p.proficiency, { max: 100, baseChance: 0.35, slowdown: 0.8, minChance: 0.03, effectMin: 0.7, effectMax: 1.15 });
});

test('skilltrees.json: 모든 직업의 트리가 있고, 플레이어 기술은 자기 직업 트리에 한 번씩, 2차 직업은 필요 어빌로 배운다', () => {
  assert.equal(gd.designWarnings.length, 0, JSON.stringify(gd.designWarnings.slice(0, 3)));
  for (const c of CLASS_IDS) assert.ok(gd.treeOf(c), c);
  for (const a of gd.abilities.values()) {
    const at = gd.nodeOf(a.id);
    if (a.classId === 'monster') {
      assert.equal(at, undefined, a.id);
      continue;
    }
    assert.ok(at, `${a.id}: 트리에 없음`);
    assert.equal(at.classId, a.classId);
    // 처음 트리는 지금의 배우는 레벨·가격 그대로
    assert.equal(at.node.gold, a.price, a.id);
    if (classTier(a.classId) === 2) {
      assert.equal(at.node.abilityLevel, a.level, a.id);
      assert.equal(at.node.level, undefined, a.id);
    } else {
      assert.equal(at.node.level, a.level, a.id);
      assert.equal(at.node.abilityLevel, undefined, a.id);
    }
  }
  // 아르처의 이름은 궁사, 길드장 칭호도
  assert.equal(gd.classes.get('archer')!.name, '궁사');
  assert.equal(gd.npcs.get('archer_master')!.title, '궁사 길드장');
});

test('설계 검사는 없는 id, 선수과목 순환, 범위 밖 값, 알 수 없는 조건, 빠진 트리를 한국어로 알려 준다', () => {
  const node = (d: { skillTrees: SkillTreesConfig }, cls: keyof SkillTreesConfig['trees'], id: string) =>
    d.skillTrees.trees[cls].nodes.find((n) => n.ability === id)!;
  assert.deepEqual(errorsOf(() => {}), []);
  assert.ok(has(errorsOf((d) => d.skillTrees.trees.warrior.nodes.push({ ability: 'no_such', row: 30, col: 0, level: 5, gold: 0, items: [], requires: [] })), /no_such/));
  assert.ok(has(errorsOf((d) => node(d, 'warrior', 'w_whirl').items.push({ item: 'no_item', qty: 1 })), /no_item.*items\.json/));
  const cycle = errorsOf((d) => {
    node(d, 'warrior', 'w_whirl').requires.push({ ability: 'w_strike', prof: 30 });
    node(d, 'warrior', 'w_strike').requires.push({ ability: 'w_whirl', prof: 0 });
  });
  assert.ok(has(cycle, /돌고 돕니다.*(강타.*회오리 베기|회오리 베기.*강타)/), JSON.stringify(cycle));
  assert.ok(has(errorsOf((d) => node(d, 'warrior', 'w_whirl').requires.push({ ability: 'w_strike', prof: 101 })), /prof/));
  assert.ok(has(errorsOf((d) => (d.progression.proficiency.max = 0)), /proficiency.*max/));
  assert.ok(has(errorsOf((d) => (d.progression.ability.expRatio = -1)), /expRatio/));
  assert.ok(has(errorsOf((d) => d.progression.rebirth.conditions.warrior.push({ type: 'boss' } as never)), /알 수 없는 조건 종류 'boss'/));
  assert.ok(has(errorsOf((d) => d.progression.ascend.conditions.rogue.push({ type: 'skillProf', ability: 'nope', min: 100 })), /nope/));
  assert.ok(has(errorsOf((d) => delete (d.skillTrees.trees as Partial<SkillTreesConfig['trees']>).bard), /skilltrees\.json\(bard\).*트리가 없습니다/));
  assert.ok(has(errorsOf((d) => (d.progression.rebirth as unknown as Record<string, unknown>).allowAfterAscended = true), /allowAfterAscended/));
  // 2차 직업 트리는 필요 어빌, 계통은 수인 트리에서만, 같은 칸에 두 기술은 안 됨
  assert.ok(
    has(
      errorsOf((d) => {
        const n = node(d, 'gladiator', 'g_twin');
        delete n.abilityLevel;
        n.level = 5;
      }),
      /필요 어빌/,
    ),
  );
  assert.ok(has(errorsOf((d) => (node(d, 'warrior', 'w_strike').beastType = 'mammal')), /수인 트리에서만/));
  assert.ok(has(errorsOf((d) => (node(d, 'beastkin', 'k_rend').beastType = 'fish')), /알 수 없는 수인 계통 'fish'/));
  assert.ok(has(errorsOf((d) => (node(d, 'warrior', 'w_whirl').row = node(d, 'warrior', 'w_strike').row)), /이미 강타/));
  assert.ok(has(errorsOf((d) => d.skillTrees.trees.warrior.nodes.push({ ...node(d, 'rogue', 'r_stab') })), /도적의 기술/));
});

test('잘못된 설계 파일이 있으면 서버가 어디가 틀렸는지 알려 주고 시작하지 않는다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-prog-'));
  try {
    fs.cpSync(DIR, tmp, { recursive: true });
    const trees = readJson('skilltrees.json') as SkillTreesConfig;
    trees.trees.priest.nodes.find((n) => n.ability === 'p_heal')!.requires = [{ ability: 'p_heal2', prof: 0 }];
    trees.trees.priest.nodes.find((n) => n.ability === 'p_heal2')!.requires = [{ ability: 'p_heal', prof: 50 }];
    fs.writeFileSync(path.join(tmp, 'skilltrees.json'), JSON.stringify(trees));
    assert.throws(() => GameData.load(tmp), (e: unknown) => e instanceof GameDataError && /skilltrees\.json.*돌고 돕니다/.test(e.message));
    fs.writeFileSync(path.join(tmp, 'skilltrees.json'), JSON.stringify(readJson('skilltrees.json')));
    fs.rmSync(path.join(tmp, 'progression.json'));
    assert.throws(() => GameData.load(tmp), (e: unknown) => e instanceof GameDataError && e.message.includes('progression.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('applyDesign: 올바른 설계는 서버를 끄지 않고 바로 반영하고, 틀린 설계는 아무것도 바꾸지 않는다', () => {
  const live = GameData.load(DIR);
  const server = { name: 'x', motd: '', expRate: 1, goldRate: 1, dropRate: 1, maxLevel: 99, statCap: 255, classLevel: 5, registration: 'open' as const };
  const before = live.clientData(server);
  const trees = JSON.parse(JSON.stringify(live.skillTrees)) as SkillTreesConfig;
  trees.trees.warrior.nodes.find((n) => n.ability === 'w_whirl')!.requires.push({ ability: 'w_strike', prof: 30 });
  const prog = JSON.parse(JSON.stringify(live.progression)) as ProgressionConfig;
  prog.ascend.title = '대가';
  // 미리 검사(dryRun)는 아무것도 바꾸지 않음
  assert.deepEqual(live.checkUpdate({ skillTrees: trees, progression: prog, abilities: [{ id: 'w_whirl', name: '큰 회오리' }] }), []);
  assert.equal(live.abilities.get('w_whirl')!.name, '회오리 베기');
  assert.equal(live.progression.ascend.title, '마스터');
  const ok = live.applyDesign({ skillTrees: trees, progression: prog, abilities: [{ id: 'w_whirl', name: '큰 회오리', mp: 7 }] });
  assert.deepEqual(ok.filter((i) => i.level === 'error'), []);
  assert.deepEqual(live.nodeOf('w_whirl')!.node.requires, [{ ability: 'w_strike', prof: 30 }]);
  assert.equal(live.abilities.get('w_whirl')!.name, '큰 회오리');
  assert.equal(live.abilities.get('w_whirl')!.mp, 7);
  assert.equal(live.progression.ascend.title, '대가');
  // 넘긴 객체를 나중에 바꿔도 게임 데이터는 그대로 (깊은 복사)
  trees.trees.warrior.nodes.length = 0;
  assert.ok(live.treeOf('warrior').nodes.length > 0);
  // 클라이언트에 보낼 데이터도 새로 만듦
  const after1 = live.clientData(server);
  assert.notEqual(after1, before);
  assert.equal(after1.progression.ascend.title, '대가');

  const snapshot = JSON.stringify([live.skillTrees, live.progression, live.abilities.get('w_strike')]);
  const bad = JSON.parse(JSON.stringify(live.skillTrees)) as SkillTreesConfig;
  bad.trees.warrior.nodes.find((n) => n.ability === 'w_strike')!.requires.push({ ability: 'w_whirl', prof: 0 });
  const res = live.applyDesign({ skillTrees: bad, abilities: [{ id: 'w_strike', name: '바뀌면 안 됨' }] });
  assert.ok(has(res.filter((i) => i.level === 'error'), /돌고 돕니다/));
  assert.equal(JSON.stringify([live.skillTrees, live.progression, live.abilities.get('w_strike')]), snapshot);
  const badPatch = live.applyDesign({ abilities: [{ id: 'mon_poison', name: '독' }] });
  assert.ok(has(badPatch, /몬스터 전용/));
  assert.equal(live.abilities.get('mon_poison')!.name, '독침');
});

test('설계 파일 쓰기 모양: 지금 gamedata 파일을 글자 하나 다르지 않게 다시 만든다 (관리자 저장의 차이를 바꾼 줄로 줄이려고)', () => {
  const text = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
  assert.equal(formatSkillTrees(gd.skillTrees), text('skilltrees.json'));
  assert.equal(formatProgression(gd.progression), text('progression.json'));
  assert.equal(formatListFile([...gd.abilities.values()]), text('abilities.json'));
  // 항목 순서가 달라도 같은 모양으로
  const reverse = (o: object) => Object.fromEntries(Object.entries(o).reverse());
  const shuffled = JSON.parse(JSON.stringify(gd.progression)) as ProgressionConfig;
  const reordered = { ...reverse(shuffled), ascend: reverse(shuffled.ascend) } as ProgressionConfig;
  assert.equal(formatProgression(reordered), text('progression.json'));
});

// ───────────────────────── 저장 파일 이전 ─────────────────────────

test('저장 파일 이전: 이미 배운 기술은 숙련도 100, 2차 직업은 어빌 1, 새 항목은 기본값', () => {
  const old = normalizeCharacter({
    name: '옛사람',
    classId: 'warrior',
    level: 40,
    skills: ['first_aid', 'w_strike'],
    spells: [],
    prof: { w_strike: 37, z_fire1: 50 },
    bonusHp: -300,
  });
  assert.deepEqual(old.prof, { first_aid: 100, w_strike: 37 });
  assert.equal(old.rebirths, 0);
  assert.equal(old.ascended, false);
  assert.equal(old.abilityLevel, 0);
  assert.equal(old.abilityExp, 0);
  assert.equal(old.beastType, null);
  assert.equal(old.bonusHp, -300, '체력을 팔거나 바치면 음수가 될 수 있음');
  const archer = normalizeCharacter({ name: '옛궁수', classId: 'archer', level: 30, skills: ['a_aimed'], abilityLevel: 0 });
  assert.equal(archer.abilityLevel, 1);
  assert.deepEqual(archer.prof, { a_aimed: 100 });
  const beast = normalizeCharacter({ name: '옛수인', classId: 'beastkin', abilityLevel: 12, abilityExp: 345, beastType: 'bird', rebirths: 2, ascended: true });
  assert.equal(beast.abilityLevel, 12);
  assert.equal(beast.abilityExp, 345);
  assert.equal(beast.beastType, 'bird');
  assert.equal(beast.rebirths, 2);
  assert.equal(beast.ascended, true);
  // 2차 직업이 아니면 어빌·계통이 남아 있지 않음
  const odd = normalizeCharacter({ name: '이상함', classId: 'monk', abilityLevel: 5, beastType: 'bird' });
  assert.equal(odd.abilityLevel, 0);
  assert.equal(odd.beastType, null);
});

test('새로 배운 기술은 숙련도 0 이고, 저장했다 다시 읽어도 0 이다', () => {
  const d = normalizeCharacter({ name: '새내기', passwordHash: 'x', inventory: [], equipment: emptyEquipment() });
  assert.ok(learnOnData(d, gd.abilities.get('first_aid')!));
  assert.equal(d.prof.first_aid, 0);
  const again = normalizeCharacter(JSON.parse(JSON.stringify(d)));
  assert.equal(again.prof.first_aid, 0);
});

test('직업 변경: 2차 직업이 되면 어빌 1 이상, 1차 직업이면 0, 수인이 아니면 계통이 없고 잊은 기술의 숙련도는 지운다', () => {
  const d = normalizeCharacter({ name: '변신', classId: 'warrior', level: 50, skills: ['first_aid', 'w_strike'] });
  setClassOnData(d, gd, 'beastkin');
  assert.equal(d.abilityLevel, 1);
  assert.deepEqual(d.skills, ['first_aid']);
  assert.deepEqual(d.prof, { first_aid: 100 });
  d.beastType = 'mammal';
  setClassOnData(d, gd, 'monk');
  assert.equal(d.abilityLevel, 0);
  assert.equal(d.beastType, null);
});

// ───────────────────────── 공용 공식 ─────────────────────────

test('숙련도·어빌리티 공식과 직업 단계', () => {
  const P = gd.progression.proficiency;
  assert.equal(profGainChance(0, P), 0.35);
  assert.ok(Math.abs(profGainChance(50, P) - 0.21) < 1e-9);
  assert.ok(Math.abs(profGainChance(99, P) - 0.35 * (1 - 0.8 * 0.99)) < 1e-9);
  assert.equal(profGainChance(100, P), 0, '최대면 더 오르지 않음');
  assert.equal(profGainChance(99, { ...P, slowdown: 1 }), 0.03, '바닥은 minChance');
  assert.equal(profEffect(0, P), 0.7);
  assert.equal(profEffect(100, P), 1.15);
  assert.ok(Math.abs(profEffect(50, P) - 0.925) < 1e-9);
  assert.equal(profEffect(500, P), 1.15);
  const A = gd.progression.ability;
  assert.deepEqual(abilityVitals(0, A), { hp: 0, mp: 0 });
  assert.deepEqual(abilityVitals(1, A), { hp: 0, mp: 0 });
  assert.deepEqual(abilityVitals(2, A), { hp: 30, mp: 15 });
  assert.deepEqual(abilityVitals(99, A), { hp: 98 * 30, mp: 98 * 15 });
  assert.equal(abilityExpToNext(0, A), 0);
  assert.equal(abilityExpToNext(1, A), expToNext(1));
  assert.equal(abilityExpToNext(50, A), expToNext(50));
  assert.equal(abilityExpToNext(99, A), 0);
  assert.equal(classTier('peasant'), 0);
  assert.equal(classTier('monk'), 1);
  assert.equal(classTier('archer'), 2);
  assert.deepEqual(secondClassesOf('rogue', DEFAULT_SECOND_FROM), ['archer']);
  assert.deepEqual(secondClassesOf('archer', DEFAULT_SECOND_FROM), []);
  assert.equal(bigNumber(14_000), '14,000');
  assert.equal(bigNumber(500_000), '50만');
  assert.equal(bigNumber(100_000_000), '1억');
  assert.equal(bigNumber(250_000_000), '2억 5,000만');
  assert.equal(bigNumber(1_000_000_000), '10억');
  const names = { abilityName: (id: string) => gd.abilities.get(id)?.name ?? id, itemName: (id: string) => gd.items.get(id)?.name ?? id };
  assert.equal(describeCondition({ type: 'exp', min: 100_000_000, consume: true }, names), '경험치 1억 (써서 없어짐)');
  assert.equal(describeCondition({ type: 'pureHp', min: 14_000 }, names), '순수 체력 14,000 이상');
  assert.equal(describeCondition({ type: 'skillProf', ability: 'w_ironwall', min: 100 }, names), '철벽 숙련도 100 이상');
  const pub = publicProgression(gd.progression);
  assert.ok(!('conditions' in pub.rebirth) && !('conditions' in pub.ascend) && !('conditions' in pub.second));
  assert.equal(pub.rebirth.names.monk, '환골탈태');
});

test('배우는 조건의 상태: 레벨·골드·재료·선수과목(숙련도)·능력치·계통·지금 직업', () => {
  const node: SkillTreeNode = {
    ability: 'w_whirl',
    row: 1,
    col: 0,
    level: 12,
    gold: 800,
    items: [{ item: 'pot_hp_1', qty: 2 }],
    requires: [{ ability: 'w_strike', prof: 30 }],
    stats: { str: 20 },
  };
  const ctx = (o: Partial<LearnContext> & { profs?: Record<string, number> } = {}): LearnContext => {
    const profs = o.profs ?? { w_strike: 30 };
    return {
      classId: 'warrior',
      level: 12,
      abilityLevel: 0,
      gold: 1000,
      stats: { str: 20, int: 3, wis: 3, con: 3, dex: 3 },
      beastType: null,
      learnedCount: () => 2,
      learned: (id) => id in profs,
      prof: (id) => profs[id] ?? 0,
      itemCount: (id) => (id === 'pot_hp_1' ? 2 : 0),
      ability: (id) => gd.abilities.get(id),
      itemName: (id) => gd.items.get(id)?.name ?? id,
      beastTypeName: (id) => gd.progression.second.beastTypes.find((b) => b.id === id)?.name ?? id,
      ...o,
    };
  };
  const okNow = learnStatus('warrior', node, ctx());
  assert.equal(okNow.learnable, true, JSON.stringify(okNow));
  assert.deepEqual(
    okNow.reqs.map((r) => r.kind),
    ['level', 'gold', 'item', 'requires', 'stat'],
  );
  const lowProf = learnStatus('warrior', node, ctx({ profs: { w_strike: 29 } }));
  assert.equal(lowProf.learnable, false);
  assert.match(lowProf.reason!, /강타 숙련도 30/);
  assert.equal(lowProf.reqs.find((r) => r.kind === 'requires')!.have, 29);
  assert.equal(learnStatus('warrior', node, ctx({ profs: {} })).reqs.find((r) => r.kind === 'requires')!.met, false);
  assert.match(learnStatus('warrior', node, ctx({ level: 11 })).reason!, /레벨 12/);
  assert.match(learnStatus('warrior', node, ctx({ gold: 799 })).reason!, /800 골드/);
  assert.ok(learnStatus('warrior', node, ctx({ itemCount: () => 1 })).reason!.includes(`${gd.items.get('pot_hp_1')!.name} 2개`));
  const other = learnStatus('warrior', node, ctx({ classId: 'rogue' }));
  assert.equal(other.reqs[0]!.kind, 'class');
  assert.match(other.reason!, /지금 직업의 기술만/);
  const learned = learnStatus('warrior', node, ctx({ profs: { w_strike: 30, w_whirl: 0 } }));
  assert.equal(learned.learned, true);
  assert.equal(learned.learnable, false);
  // 평민 트리는 누구나, 수인 계통 전용 기술은 그 계통만
  const aid: SkillTreeNode = { ability: 'first_aid', row: 0, col: 0, level: 1, gold: 0, items: [], requires: [] };
  assert.equal(learnStatus('peasant', aid, ctx({ profs: {} })).learnable, true);
  const claw: SkillTreeNode = { ability: 'k_rend', row: 0, col: 0, abilityLevel: 1, gold: 0, items: [], requires: [], beastType: 'mammal' };
  const beast = (beastType: string | null) => learnStatus('beastkin', claw, ctx({ classId: 'beastkin', abilityLevel: 1, beastType, profs: {} }));
  assert.equal(beast('mammal').learnable, true);
  assert.equal(beast('bird').learnable, false);
  assert.match(beast('bird').reason!, /포유류 계통/);
});

// ───────────────────────── 서버: 직업 선택·기술 배우기 창·메시지 모양 ─────────────────────────

let dataDir = '';
let srv: RunningServer;
let admin: Client;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-prog-srv-'));
  srv = await startServer(testConfig(dataDir));
  admin = await Client.connect(srv.port);
  create(admin, '관리자');
  await admin.waitFor('welcome');
});

after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('접속하면 스킬트리와 성장 규칙을 받고, 내 상태에 어빌·숙련도·칭호가 있다', async () => {
  const c = await Client.connect(srv.port);
  create(c, '새싹');
  const w = await c.waitFor('welcome');
  assert.equal(w.data.skillTrees.warrior.nodes.length, gd.treeOf('warrior').nodes.length);
  assert.equal(w.data.progression.rebirth.names.monk, '환골탈태');
  assert.equal(w.data.progression.proficiency.max, 100);
  assert.ok(!('conditions' in w.data.progression.ascend));
  assert.equal(w.data.classes.find((x) => x.id === 'archer')!.name, '궁사');
  const s = await c.self();
  assert.equal(s.rebirths, 0);
  assert.equal(s.ascended, false);
  assert.equal(s.title, '');
  assert.equal(s.abilityLevel, 0);
  assert.equal(s.abilityExpNext, 0);
  assert.equal(s.beastType, null);
  assert.deepEqual(s.prof, { first_aid: 0 });
  c.close();
});

test('5레벨 직업 선택은 1차 직업 길드장만 내놓고, 길드장의 기술 배우기 창은 스킬트리 조건을 보낸다', async () => {
  const c = await Client.connect(srv.port);
  create(c, '견습생');
  await c.waitFor('welcome');
  const town = await c.waitFor('map', (m) => m.map.id === 'town');
  const npcAt = (def: string) => town.entities.find((e) => e.type === 'npc' && e.def === def)!;
  await admin.chat('/레벨 @견습생 5');
  await c.self((s) => s.level === 5);
  const talkTo = async (def: string) => {
    const npc = npcAt(def);
    await admin.chat(`/보내기 @견습생 town ${npc.x + 1} ${npc.y}`);
    const p = srv.world.findPlayer('견습생')!;
    assert.ok(Math.abs(p.x - npc.x) <= 4 && Math.abs(p.y - npc.y) <= 4, `${def} 근처로 가지 못함`);
    const mark = c.mark;
    c.send({ t: 'talk', npc: npc.id });
    return { npc, dialog: await c.waitFor('dialog', () => true, mark) };
  };
  // 2차 직업 스승은 직업을 고르게 하지 않고, 골라 달라고 해도 거절
  for (const def of ['archer_master', 'gladiator_master', 'summoner_master', 'bard_master', 'beastkin_master']) {
    const { npc, dialog } = await talkTo(def);
    assert.ok(!dialog.options.some((o) => o.key.startsWith('class:')), `${def}: ${dialog.options.map((o) => o.key).join(',')}`);
    const cls = npc.type === 'npc' ? srv.world.data.npcs.get(npc.def)!.services.find((x) => x.type === 'class')! : null;
    assert.ok(cls && cls.type === 'class');
    c.send({ t: 'pick', npc: npc.id, key: `class:${cls.classId}:yes` });
  }
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(srv.world.findPlayer('견습생')!.data.classId, 'peasant');
  // 1차 직업 길드장은 직업 선택을 내놓음
  const { npc: master, dialog } = await talkTo('warrior_master');
  assert.ok(dialog.options.some((o) => o.key === 'class:warrior'));
  let mark = c.mark;
  c.send({ t: 'pick', npc: master.id, key: 'class:warrior:yes' });
  await c.self((s) => s.classId === 'warrior', mark);
  mark = c.mark;
  c.send({ t: 'pick', npc: master.id, key: 'learn:warrior' });
  const learn = await c.waitFor('learn', () => true, mark);
  assert.equal(learn.classId, 'warrior');
  // 트리의 기술이 모두, 필요 레벨 순으로
  const tree = gd.treeOf('warrior').nodes;
  assert.deepEqual(learn.list.map((e) => e.id).sort(), tree.map((n) => n.ability).sort());
  for (let i = 1; i < learn.list.length; i++) assert.ok(learn.list[i]!.level >= learn.list[i - 1]!.level, '필요 레벨 순');
  for (const e of learn.list) {
    const node = tree.find((n) => n.ability === e.id)!;
    assert.equal(e.level, node.level);
    assert.equal(e.price, node.gold);
    assert.equal(e.learned, false);
    // 배울 수 있는지는 조건을 모두 채웠는지와 같고, 아니면 첫 번째로 모자란 조건이 이유
    assert.equal(e.learnable, e.reqs.every((r) => r.met), e.id);
    if (!e.learnable) assert.ok(e.reason && e.reqs.some((r) => !r.met && e.reason!.includes(r.label)), `${e.id}: ${e.reason}`);
  }
  const high = learn.list.find((e) => e.level > 5)!;
  assert.equal(high.learnable, false);
  assert.ok(high.reqs.some((r) => r.kind === 'level' && !r.met && r.need === high.level && r.have === 5));
  c.close();
});

test('관리자 편집기 API 경로는 로그인 뒤에만 열리고, 아직은 준비 중(501)이라고 답한다', async () => {
  assert.equal((await httpJson(srv.port, '/api/admin/design')).status, 401);
  const login = await httpJson(srv.port, '/api/admin/login', { password: ADMIN_PW });
  const token = String(login.json.token);
  const call = async (method: string, p: string) => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/admin${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
    return res.status;
  };
  assert.equal(await call('GET', '/design'), 501);
  assert.equal(await call('PUT', '/design/skilltree/warrior'), 501);
  assert.equal(await call('PUT', '/design/skilltree/pirate'), 404);
  assert.equal(await call('PUT', '/design/progression'), 501);
  assert.equal(await call('GET', '/design/history'), 501);
  assert.equal(await call('POST', '/design/restore'), 501);
});
