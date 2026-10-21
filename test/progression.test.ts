// 성장 체계 엔진: 조건 확인·쓰기, 전직(환골탈태), 승급과 교환, 2차 전직, 어빌리티, 숙련도, 스킬트리로 배우기, 옛 저장 파일 이전.
// 캐릭터 데이터(CharacterData)만 다루는 함수들을 실제 게임 데이터로 확인합니다 (서버를 띄워 NPC 대화·전투로 확인하는 시험은 progression-engine.test.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { STAT_KEYS } from '../src/shared/constants';
import { expToNext, START_STAT } from '../src/shared/formulas';
import { profGainChance, titleOf, type Condition, type SkillTreesConfig } from '../src/shared/progression';
import { loadConfig } from '../src/server/config';
import { GameData } from '../src/server/gamedata';
import { CharacterStore, emptyEquipment, normalizeCharacter, type CharacterData } from '../src/server/storage';
import { addItem, countItem, equipError } from '../src/server/systems/character';
import {
  abilityExpShare,
  addAbilityExpToData,
  ascendOnData,
  checkAscend,
  checkConditions,
  checkRebirth,
  checkSecondJob,
  chooseBeastTypeOnData,
  classBaseVitals,
  learnFromTree,
  payConditions,
  proficiencyMultiplier,
  pureVitals,
  rebirthOnData,
  rebirthTargets,
  rollProficiencyOnData,
  secondJobOnData,
  tradeExpOnData,
  tradeHpForStatOnData,
  tradeLimits,
} from '../src/server/systems/progression';
import type { Player } from '../src/server/world/Player';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);
const cfg = loadConfig({ ADMIN_PASSWORD: 'x', DATA_DIR: os.tmpdir() } as NodeJS.ProcessEnv);
const clone = <T>(v: T): T => structuredClone(v);

/** 저장 파일처럼 만든 캐릭터에 값을 덮어씁니다 */
function char(o: Partial<CharacterData> = {}): CharacterData {
  const d = normalizeCharacter({ name: '시험', passwordHash: 'x', inventory: [], equipment: emptyEquipment() });
  return Object.assign(d, clone(o));
}

const stats = (str: number, int: number, wis: number, con: number, dex: number) => ({ str, int, wis, con, dex });

/**
 * 전직 조건을 모두 채운 99레벨 전사: 순수 체력 3980 + 건강 255×10 + 8000 = 14,530 (≥ 14,000),
 * 순수 마력 804 + 지혜 50×6 + 2500 = 3,604 (≥ 3,500), 경험치 1억 5천만
 */
function readyWarrior(o: Partial<CharacterData> = {}): CharacterData {
  const d = char({
    classId: 'warrior',
    level: 99,
    exp: 150_000_000,
    stats: stats(200, 3, 50, 255, 80),
    statPoints: 4,
    bonusHp: 8000,
    bonusMp: 2500,
    gold: 12_345,
    skills: ['first_aid', 'w_strike', 'w_ironwall'],
    spells: [],
    prof: { first_aid: 100, w_strike: 37, w_ironwall: 100 },
    storage: [{ item: 'mat_bone', qty: 7 }],
    storageGold: 999,
    ...o,
  });
  addItem(d, gd.items.get('pot_hp_1')!, 20);
  d.equipment.weapon = 'w_warrior_1';
  d.equipment.armor = 'a_warrior_1';
  d.equipment.helmet = 'helm_6';
  return d;
}

/** 승급 조건을 모두 채운 99레벨 전사: 순수 체력 6530 + 11000 = 17,530, 순수 마력 1104 + 4000 = 5,104, 경험치 3억, 철벽·필살 숙련도 100 */
function readyToAscend(o: Partial<CharacterData> = {}): CharacterData {
  return readyWarrior({
    exp: 300_000_000,
    bonusHp: 11_000,
    bonusMp: 4000,
    skills: ['first_aid', 'w_strike', 'w_ironwall', 'w_crash'],
    prof: { first_aid: 100, w_strike: 50, w_ironwall: 100, w_crash: 100 },
    ...o,
  });
}

/** 2차 전직(궁사) 조건을 모두 채운 승급한 99레벨 도적: 경험치 12억, 바친 뒤에도 직업 기본 체력·마나가 남음 */
function readyRogue(o: Partial<CharacterData> = {}): CharacterData {
  const d = char({
    classId: 'rogue',
    level: 99,
    exp: 1_200_000_000,
    ascended: true,
    stats: stats(100, 3, 100, 100, 200),
    bonusHp: 300,
    bonusMp: 0,
    skills: ['first_aid', 'r_stab', 'r_hide'],
    prof: { first_aid: 100, r_stab: 100, r_hide: 64 },
    ...o,
  });
  d.equipment.weapon = 'w_rogue_1';
  d.equipment.boots = 'boots_5';
  return d;
}

// ───────────────────────── 조건 ─────────────────────────

test('조건: 종류마다 채움/모자람을 따로 판정하고, 확인만으로는 아무것도 바뀌지 않는다', () => {
  const base = { hp: 3980, mp: 804 }; // 99레벨 전사의 직업 기본 체력·마나
  assert.deepEqual(classBaseVitals(readyWarrior(), gd), base);
  const conds: Condition[] = [
    { type: 'level', min: 99 },
    { type: 'ascended' },
    { type: 'rebirths', min: 1 },
    { type: 'pureHp', min: 14_000 },
    { type: 'pureMp', min: 3500 },
    { type: 'exp', min: 1000, consume: true },
    { type: 'payHp', amount: 100 },
    { type: 'payMp', amount: 50 },
    { type: 'gold', min: 500, consume: true },
    { type: 'item', item: 'mat_bone', qty: 2, consume: true },
    { type: 'skillProf', ability: 'w_strike', min: 40 },
  ];
  const good = (): CharacterData => {
    const d = readyWarrior({ ascended: true, rebirths: 1, prof: { first_aid: 100, w_strike: 40, w_ironwall: 100 } });
    addItem(d, gd.items.get('mat_bone')!, 2);
    return d;
  };
  const d = good();
  const before = clone(d);
  const all = checkConditions(d, gd, conds);
  assert.equal(all.ok, true, JSON.stringify(all.results.filter((r) => !r.met)));
  assert.deepEqual(d, before, '확인만으로는 바뀌지 않음');
  assert.equal(all.results.length, conds.length);
  assert.deepEqual(
    all.results.map((r) => r.label),
    ['레벨 99 이상', '승급을 마침', '전직 1번 이상', '순수 체력 14,000 이상', '순수 마력 3,500 이상', '경험치 1,000 (써서 없어짐)', '순수 체력 100 바침', '순수 마력 50 바침', '500 골드 (냄)', '뼛조각 2개 (냄)', '강타 숙련도 40 이상'],
  );
  const pure = pureVitals(d, gd);
  assert.deepEqual(pure, { hp: 14_530, mp: 3604 });
  assert.equal(all.results[3]!.have, 14_530);
  // 바치는 조건은 바친 뒤에도 직업 기본 체력·마나가 남아야 함
  assert.equal(all.results[6]!.need, base.hp + 100);
  assert.equal(all.results[7]!.need, base.mp + 50);

  // 조건 하나씩만 모자라게 만들면 그 조건만 모자람
  const breakers: ((x: CharacterData) => void)[] = [
    (x) => (x.level = 98), // 레벨 몫이 줄어도 순수 체력·마력 조건은 채움
    (x) => (x.ascended = false),
    (x) => (x.rebirths = 0),
    (x) => (x.bonusHp = 7469), // 순수 체력 13,999
    (x) => (x.bonusMp = 2395), // 순수 마력 3,499
    (x) => (x.exp = 999),
    (x) => {
      // 순수 체력이 직업 기본 체력 + 99 → 100 을 바치면 기본 아래로 내려감 (그래도 14,000 조건과 겹치지 않게 그 조건은 따로)
      x.stats.con = 3;
      x.bonusHp = 99 - 30;
    },
    (x) => {
      x.stats.wis = 3;
      x.bonusMp = 49 - 18;
    },
    (x) => (x.gold = 499),
    (x) => {
      for (let i = 0; i < x.inventory.length; i++) if (x.inventory[i]?.item === 'mat_bone') x.inventory[i]!.qty = 1;
    },
    (x) => (x.prof.w_strike = 39),
  ];
  breakers.forEach((brk, i) => {
    const x = good();
    brk(x);
    const r = checkConditions(x, gd, conds);
    assert.equal(r.ok, false, `${i}`);
    assert.equal(r.results[i]!.met, false, `${i}: ${r.results[i]!.label}`);
    // payHp/payMp 를 깨려고 순수 체력·마력을 낮추면 pureHp/pureMp 도 모자라므로 그 둘은 빼고 봄
    const others = r.results.filter((_, j) => j !== i && !(i === 6 && j === 3) && !(i === 7 && j === 4));
    assert.ok(others.every((o) => o.met), `${i}: ${others.filter((o) => !o.met).map((o) => o.label).join(', ')}`);
  });
  // 배우지 않은 기술의 숙련도 조건은 모자람 (지금 값 없음)
  const unlearned = checkConditions(d, gd, [{ type: 'skillProf', ability: 'w_crash', min: 0 }]);
  assert.equal(unlearned.ok, false);
  assert.equal(unlearned.results[0]!.have, undefined);
  // 쓰는 조건을 한꺼번에: 경험치·체력 바치기 등이 깎임, 나머지는 그대로
  payConditions(d, gd, conds);
  assert.equal(d.exp, before.exp - 1000);
  assert.equal(d.bonusHp, before.bonusHp - 100);
  assert.equal(d.bonusMp, before.bonusMp - 50);
  assert.equal(d.gold, before.gold - 500);
  assert.equal(countItem(d, 'mat_bone'), 0);
  assert.equal(d.level, before.level);
  assert.deepEqual(d.prof, before.prof);
  assert.deepEqual(d.stats, before.stats);
});

test('조건: 행동(승급)에 모든 종류의 조건을 걸면, 하나라도 모자랄 때 아무것도 쓰지 않고 다 채우면 쓰는 것만 한 번 쓴다', () => {
  const local = GameData.load(DIR);
  local.progression.ascend.conditions.warrior = [
    { type: 'level', min: 99 },
    { type: 'rebirths', min: 2 },
    { type: 'pureHp', min: 14_000 },
    { type: 'pureMp', min: 3500 },
    { type: 'exp', min: 7000, consume: true },
    { type: 'payHp', amount: 300 },
    { type: 'payMp', amount: 200 },
    { type: 'gold', min: 5000, consume: true },
    { type: 'gold', min: 1000, consume: false },
    { type: 'item', item: 'mat_bone', qty: 3, consume: true },
    { type: 'item', item: 'mat_web', qty: 1, consume: false },
    { type: 'skillProf', ability: 'w_strike', min: 60 },
  ];
  const good = (): CharacterData => {
    const d = readyWarrior({ exp: 7000, gold: 5000, rebirths: 2, prof: { first_aid: 100, w_strike: 60, w_ironwall: 100 } });
    addItem(d, gd.items.get('mat_bone')!, 3);
    addItem(d, gd.items.get('mat_web')!, 1);
    return d;
  };
  const breakers: [string, (x: CharacterData) => void][] = [
    ['레벨', (x) => (x.level = 98)],
    ['전직 횟수', (x) => (x.rebirths = 1)],
    ['순수 체력', (x) => (x.bonusHp = 7000)],
    ['순수 마력', (x) => (x.bonusMp = 2000)],
    ['경험치', (x) => (x.exp = 6999)],
    ['바칠 체력', (x) => ((x.stats.con = 3), (x.bonusHp = 0))],
    ['바칠 마력', (x) => ((x.stats.wis = 3), (x.bonusMp = 0))],
    ['골드', (x) => (x.gold = 4999)],
    ['재료', (x) => (x.inventory = x.inventory.map((s) => (s?.item === 'mat_bone' ? { ...s, qty: 2 } : s)))],
    ['보여 줄 아이템', (x) => (x.inventory = x.inventory.map((s) => (s?.item === 'mat_web' ? null : s)))],
    ['숙련도', (x) => (x.prof.w_strike = 59)],
  ];
  for (const [what, brk] of breakers) {
    const d = good();
    brk(d);
    const before = clone(d);
    const r = ascendOnData(d, local);
    assert.equal(r.ok, false, what);
    assert.deepEqual(d, before, `${what}: 아무것도 쓰지 않음`);
  }
  const d = good();
  const before = clone(d);
  const r = ascendOnData(d, local);
  assert.equal(r.ok, true, r.msg);
  assert.equal(d.exp, 0);
  assert.equal(d.bonusHp, before.bonusHp - 300);
  assert.equal(d.bonusMp, before.bonusMp - 200);
  assert.equal(d.gold, 0, '쓰는 골드 조건만 냄');
  assert.equal(countItem(d, 'mat_bone'), 0);
  assert.equal(countItem(d, 'mat_web'), 1, '쓰지 않는 아이템 조건은 그대로');
  assert.equal(d.prof.w_strike, 60);
  assert.equal(d.rebirths, 2);
  assert.equal(d.level, 99);
});

test('조건: 같은 종류의 쓰는 조건이 여럿이면 합친 양을 채워야 한다 (한꺼번에 써도 음수가 되지 않게)', () => {
  const d = readyWarrior({ exp: 1200, gold: 1000 });
  const twice: Condition[] = [
    { type: 'exp', min: 1000, consume: true },
    { type: 'exp', min: 200, consume: true },
    { type: 'exp', min: 1100, consume: false },
  ];
  assert.equal(checkConditions(d, gd, twice).ok, true);
  const more = checkConditions(d, gd, [...twice, { type: 'exp', min: 1, consume: true }]);
  assert.equal(more.ok, false);
  assert.equal(more.results[3]!.need, 1201);
  // 바치는 체력도 합쳐서: 순수 체력 = 기본 + 30 + bonus
  const h = readyWarrior({ stats: stats(3, 3, 3, 3, 3), bonusHp: 270 }); // 여유 300
  assert.equal(checkConditions(h, gd, [{ type: 'payHp', amount: 200 }, { type: 'payHp', amount: 100 }]).ok, true);
  assert.equal(checkConditions(h, gd, [{ type: 'payHp', amount: 200 }, { type: 'payHp', amount: 101 }]).ok, false);
  const g = checkConditions(d, gd, [
    { type: 'gold', min: 600, consume: true },
    { type: 'gold', min: 500, consume: true },
  ]);
  assert.equal(g.ok, false);
  assert.equal(g.results[1]!.need, 1100);
});

// ───────────────────────── 전직 ─────────────────────────

test('전직: 1레벨·경험치 0·능력치 처음으로, 기술·마법·숙련도·산 체력/마나·소지품·골드·창고는 그대로, 전직 횟수 +1', () => {
  const d = readyWarrior();
  d.spells.push('z_fire1'); // 예전 직업에서 배운 마법도 그대로 가짐
  d.prof.z_fire1 = 55;
  const before = clone(d);
  const r = rebirthOnData(d, gd, cfg, 'rogue');
  assert.equal(r.ok, true, r.msg);
  assert.match(r.msg, /전직했습니다/);
  assert.equal(d.classId, 'rogue');
  assert.equal(d.level, 1);
  assert.equal(d.exp, 0);
  for (const k of STAT_KEYS) assert.equal(d.stats[k], START_STAT, k);
  assert.equal(d.statPoints, 0);
  assert.equal(d.rebirths, 1);
  // 그대로인 것
  assert.deepEqual(d.skills, before.skills);
  assert.deepEqual(d.spells, before.spells);
  assert.deepEqual(d.prof, before.prof);
  assert.equal(d.bonusHp, before.bonusHp);
  assert.equal(d.bonusMp, before.bonusMp);
  assert.equal(d.gold, before.gold);
  assert.deepEqual(d.storage, before.storage);
  assert.equal(d.storageGold, before.storageGold);
  assert.equal(countItem(d, 'pot_hp_1'), 20);
  // 장비는 그대로 가지되, 새 직업·레벨로 입을 수 없는 것(전사 전용 무기·갑옷, 90레벨 투구)은 벗겨 소지품으로
  assert.equal(d.equipment.weapon, null);
  assert.equal(d.equipment.armor, null);
  assert.equal(d.equipment.helmet, null, '누구나 입는 투구라도 90레벨 것은 1레벨로 입을 수 없음');
  assert.equal(countItem(d, 'w_warrior_1'), 1);
  assert.equal(countItem(d, 'a_warrior_1'), 1);
  assert.equal(countItem(d, 'helm_6'), 1);
  assert.match(r.msg, /입을 수 없는 장비 3개는 소지품\(가득하면 창고\)으로 옮겼습니다/);
  // 경험치 1억을 쓰고 남은 5천만도 1레벨이 되면서 0
  assert.equal(d.ascended, false);
  assert.equal(d.abilityLevel, 0);
  // 체력·마나는 새 최대치로 (산 체력은 그대로이므로 1레벨이어도 큼)
  const pure = pureVitals(d, gd);
  assert.ok(pure.hp > 8000, `${pure.hp}`);
  assert.equal(d.hp, pure.hp);
  assert.equal(d.mp, pure.mp);
});

test('전직: 1레벨로 입을 수 없는 장비는 같은 직업이어도 소지품(가득하면 창고)으로, 1레벨 장비는 그대로 입는다', () => {
  const d = readyWarrior();
  d.equipment.weapon = 'w_common_1'; // 누구나 입는 1레벨 무기
  d.equipment.boots = 'boots_5'; // 85레벨 장화
  // 소지품을 꽉 채워 둠: 벗긴 장비는 창고로 가고 사라지지 않음
  for (let i = 0; i < d.inventory.length; i++) d.inventory[i] ??= { item: 'mat_bone', qty: 1 };
  const storage0 = d.storage.length;
  const r = rebirthOnData(d, gd, cfg, 'warrior');
  assert.equal(r.ok, true, r.msg);
  assert.equal(d.equipment.weapon, 'w_common_1', '1레벨로도 입을 수 있는 장비는 그대로');
  for (const s of ['armor', 'helmet', 'boots'] as const) assert.equal(d.equipment[s], null, s);
  assert.deepEqual(
    d.storage.slice(storage0).map((x) => x.item).sort(),
    ['a_warrior_1', 'boots_5', 'helm_6'],
    '소지품이 가득하면 창고로',
  );
  // 입은 채로 남은 장비는 모두 서버의 장비 규칙(직업·레벨)에 맞음 (벗긴 장비는 그 레벨이 되면 다시 입을 수 있음)
  for (const id of Object.values(d.equipment)) if (id) assert.equal(equipError(d, gd.items.get(id)!), null, id);
});

test('전직: 같은 직업으로도 할 수 있고, restartLevel 이 1보다 크면 그 레벨까지의 능력치 포인트를 받는다', () => {
  const d = readyWarrior();
  const r = rebirthOnData(d, gd, cfg, 'warrior');
  assert.equal(r.ok, true, r.msg);
  assert.equal(d.classId, 'warrior');
  assert.equal(d.rebirths, 1);
  const local = GameData.load(DIR);
  local.progression.rebirth.restartLevel = 10;
  const e = readyWarrior();
  e.equipment.helmet = 'helm_1'; // 3레벨 투구
  assert.equal(rebirthOnData(e, local, cfg, 'warrior').ok, true);
  assert.equal(e.level, 10);
  assert.equal(e.statPoints, 9 * cfg.statPointsPerLevel);
  assert.equal(e.equipment.weapon, 'w_warrior_1', '같은 직업의 10레벨 아래 장비는 그대로 입음');
  assert.equal(e.equipment.helmet, 'helm_1');
});

test('전직: 무도가는 환골탈태로 무도가로만, 다른 직업은 무도가로 갈 수 없다', () => {
  // 무도가: 순수 체력 3588 + 2550 + 8000, 순수 마력 1402 + 400 + 4500
  const monk = char({ classId: 'monk', level: 99, exp: 100_000_000, stats: stats(100, 3, 50, 255, 100), bonusHp: 8000, bonusMp: 4500, skills: ['m_punch'], prof: { m_punch: 80 } });
  assert.deepEqual(rebirthTargets(monk, gd), ['monk']);
  const no = checkRebirth(monk, gd, 'warrior');
  assert.equal(no.ok, false);
  assert.match(no.msg, /무도가은\(는\) 전사\(으\)로 환골탈태할 수 없습니다/);
  const before = clone(monk);
  assert.equal(rebirthOnData(monk, gd, cfg, 'warrior').ok, false);
  assert.deepEqual(monk, before, '거절되면 아무것도 바뀌지 않음');
  const yes = rebirthOnData(monk, gd, cfg, 'monk');
  assert.equal(yes.ok, true, yes.msg);
  assert.match(yes.msg, /환골탈태했습니다/);
  assert.equal(monk.classId, 'monk');
  assert.equal(monk.level, 1);
  assert.equal(monk.exp, 0, '경험치 1억을 다 씀');
  assert.deepEqual(monk.prof, { m_punch: 80 });
  // 다른 직업은 무도가로 전직할 수 없음
  for (const c of ['warrior', 'rogue', 'wizard', 'priest'] as const) {
    const d = readyWarrior({ classId: c });
    assert.ok(!rebirthTargets(d, gd).includes('monk'), c);
    assert.equal(checkRebirth(d, gd, 'monk').ok, false, c);
  }
  // 2차 직업·평민·2차 직업으로는 전직 없음
  assert.equal(checkRebirth(char({ classId: 'archer', level: 99 }), gd, 'rogue').ok, false);
  assert.equal(checkRebirth(char({ classId: 'peasant', level: 99 }), gd, 'warrior').ok, false);
  assert.equal(checkRebirth(readyWarrior(), gd, 'gladiator').ok, false);
  assert.deepEqual(rebirthTargets(char({ classId: 'archer' }), gd), []);
});

test('전직: 승급한 뒤에는 할 수 없고(설정으로 허용 가능), 레벨·조건이 모자라면 아무것도 쓰지 않는다', () => {
  const asc = readyWarrior({ ascended: true });
  const r = checkRebirth(asc, gd, 'warrior');
  assert.equal(r.ok, false);
  assert.match(r.msg, /승급한 뒤에는 전직할 수 없습니다/);
  assert.ok(r.check && r.check.ok, '조건 자체는 채웠어도');
  const local = GameData.load(DIR);
  local.progression.rebirth.allowAfterAscend = true;
  const again = readyWarrior({ ascended: true });
  assert.equal(rebirthOnData(again, local, cfg, 'wizard').ok, true);
  assert.equal(again.ascended, true, '승급 표시는 그대로');

  const cases: [string, Partial<CharacterData>, RegExp][] = [
    ['레벨', { level: 98 }, /99레벨이 되어야 전직/],
    ['체력', { bonusHp: 7000 }, /순수 체력 14,000/],
    ['마력', { bonusMp: 2000 }, /순수 마력 3,500/],
    ['경험치', { exp: 99_999_999 }, /경험치 1억/],
  ];
  for (const [what, o, re] of cases) {
    const d = readyWarrior(o);
    const before = clone(d);
    const res = rebirthOnData(d, gd, cfg, 'rogue');
    assert.equal(res.ok, false, what);
    assert.match(res.msg, re, what);
    assert.deepEqual(d, before, `${what}: 아무것도 쓰지 않음`);
  }
  // 바쳐서 산 마나가 음수였으면 전직하면서 0 으로 (지혜 500 으로 마력 조건은 채움: 804 + 3000 − 100)
  const n = readyWarrior({ bonusMp: -100, stats: stats(200, 3, 500, 255, 80) });
  assert.equal(checkRebirth(n, gd, 'rogue').ok, true);
  assert.equal(rebirthOnData(n, gd, cfg, 'rogue').ok, true);
  assert.equal(n.bonusMp, 0);
  assert.equal(n.bonusHp, 8000);
});

// ───────────────────────── 승급과 교환 ─────────────────────────

test('승급: 순수 체력·마력, 경험치 2억 5천만(씀), 핵심 기술 2개 숙련도 100 → 승급, 칭호는 마스터', () => {
  const d = readyToAscend();
  assert.equal(checkAscend(d, gd).ok, true, checkAscend(d, gd).msg);
  const r = ascendOnData(d, gd);
  assert.equal(r.ok, true, r.msg);
  assert.equal(d.ascended, true);
  assert.equal(d.exp, 50_000_000);
  assert.equal(d.level, 99);
  assert.equal(d.classId, 'warrior');
  assert.equal(titleOf(d.ascended, gd.progression), '마스터');
  assert.match(r.msg, /마스터/);
  // 다시 승급할 수 없음
  assert.equal(ascendOnData(d, gd).ok, false);
  // 핵심 기술 숙련도 99 이면 거절, 아무것도 쓰지 않음
  for (const o of [{ prof: { first_aid: 100, w_strike: 50, w_ironwall: 99, w_crash: 100 } }, { skills: ['first_aid', 'w_strike', 'w_ironwall'] }, { bonusHp: 10_000 }, { exp: 249_999_999 }, { level: 98 }]) {
    const x = readyToAscend(o as Partial<CharacterData>);
    const before = clone(x);
    const res = ascendOnData(x, gd);
    assert.equal(res.ok, false, JSON.stringify(o));
    assert.deepEqual(x, before, JSON.stringify(o));
  }
  assert.equal(checkAscend(char({ classId: 'archer', level: 99 }), gd).ok, false, '2차 직업');
  assert.equal(checkAscend(char({ classId: 'peasant', level: 99 }), gd).ok, false, '평민');
});

test('교환: 경험치 50만 → 체력 +100 / 마나 +50 (99레벨이면 승급 전후·2차 직업 누구나), 모자라면 그대로', () => {
  const d = readyWarrior({ exp: 1_200_000, bonusHp: 0, bonusMp: 0 });
  assert.deepEqual(tradeLimits(d, gd).hp, 2);
  assert.equal(tradeExpOnData(d, gd, 'hp', 2).ok, true);
  assert.equal(d.exp, 200_000);
  assert.equal(d.bonusHp, 200);
  const before = clone(d);
  const r = tradeExpOnData(d, gd, 'mp', 1);
  assert.equal(r.ok, false);
  assert.match(r.msg, /경험치가 부족합니다/);
  assert.deepEqual(d, before);
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.equal(tradeExpOnData(d, gd, 'hp', bad).ok, false, String(bad));
  const low = readyWarrior({ level: 98, exp: 10_000_000 });
  assert.equal(tradeExpOnData(low, gd, 'hp', 1).ok, false);
  assert.equal(tradeLimits(low, gd).hp, 0);
  const archer = readyRogue({ classId: 'archer', abilityLevel: 3, exp: 600_000 });
  assert.equal(tradeExpOnData(archer, gd, 'mp', 1).ok, true);
  assert.equal(archer.bonusMp, 50);
});

test('교환: 최대 체력 150 → 능력치 1, 순수 체력이 직업 기본 체력 아래로 내려가게는 팔 수 없다 (산 체력은 음수가 될 수 있음)', () => {
  // 순수 체력 = 3980 + 건강 3×10 + 300 = 4,310 → 여유 330 → 2번
  const d = readyWarrior({ stats: stats(3, 3, 3, 3, 3), bonusHp: 300, statPoints: 0 });
  assert.equal(tradeLimits(d, gd).stat, 2);
  const three = clone(d);
  const no = tradeHpForStatOnData(three, gd, 3);
  assert.equal(no.ok, false);
  assert.match(no.msg, /직업 기본 체력\(3,980\) 아래로는 팔 수 없습니다.*2번까지/);
  assert.deepEqual(three, d, '거절되면 그대로');
  assert.equal(tradeHpForStatOnData(d, gd, 2).ok, true);
  assert.equal(d.statPoints, 2);
  assert.equal(d.bonusHp, 0);
  assert.equal(pureVitals(d, gd).hp, 4010);
  assert.equal(tradeHpForStatOnData(d, gd, 1).ok, false);
  // 건강으로 늘어난 체력도 팔 수 있어서 산 체력이 음수가 됨
  const con = readyWarrior({ stats: stats(3, 3, 3, 100, 3), bonusHp: 0, statPoints: 0 });
  assert.equal(tradeHpForStatOnData(con, gd, 6).ok, true);
  assert.equal(con.bonusHp, -900);
  assert.equal(con.statPoints, 6);
  assert.equal(pureVitals(con, gd).hp, 3980 + 1000 - 900);
  // 승급 전에도 99레벨이면 됨, 98레벨은 안 됨
  assert.equal(tradeHpForStatOnData(readyWarrior({ level: 98 }), gd, 1).ok, false);
});

// ───────────────────────── 2차 전직 ─────────────────────────

test('2차 전직: 승급 + 경험치 10억(씀) + 순수 체력·마력 500 을 바침 → 레벨 99 그대로, 어빌 1, 1차 직업 장비는 소지품으로', () => {
  const d = readyRogue();
  const before = clone(d);
  const ok = checkSecondJob(d, gd, 'archer', null);
  assert.equal(ok.ok, true, ok.msg);
  const r = secondJobOnData(d, gd, 'archer', null);
  assert.equal(r.ok, true, r.msg);
  assert.equal(d.classId, 'archer');
  assert.equal(d.level, 99);
  assert.equal(d.abilityLevel, 1);
  assert.equal(d.abilityExp, 0);
  assert.equal(d.beastType, null);
  assert.equal(d.exp, before.exp - 1_000_000_000);
  assert.equal(d.bonusHp, before.bonusHp - 500);
  assert.equal(d.bonusMp, before.bonusMp - 500, '산 마나는 음수가 될 수 있음');
  assert.deepEqual(d.stats, before.stats);
  assert.deepEqual(d.skills, before.skills);
  assert.deepEqual(d.prof, before.prof);
  assert.equal(d.ascended, true);
  assert.equal(d.equipment.weapon, null, '도적 전용 무기는 소지품으로');
  assert.equal(countItem(d, 'w_rogue_1'), 1);
  assert.equal(d.equipment.boots, 'boots_5');
  assert.equal(d.hp, pureVitals(d, gd).hp);
  // 2차 직업이 다시 2차 전직할 수는 없음
  assert.equal(checkSecondJob(d, gd, 'archer', null).ok, false);
});

test('2차 전직: 조건이 하나라도 모자라면 아무것도 쓰지 않고(체력·마력만 잃는 일 없음), 갈 수 없는 길은 거절', () => {
  const cases: [string, Partial<CharacterData>, RegExp][] = [
    ['승급 전', { ascended: false }, /승급을 마침/],
    ['경험치', { exp: 999_999_999 }, /경험치 10억/],
    // 순수 체력 = 3191 + 건강 3×9 + bonus 0 → 바치면 직업 기본 아래로
    ['체력', { stats: stats(100, 3, 100, 3, 200), bonusHp: 0 }, /순수 체력 500 바침/],
    ['마력', { stats: stats(100, 3, 3, 100, 200), bonusMp: 0 }, /순수 마력 500 바침/],
  ];
  for (const [what, o, re] of cases) {
    const d = readyRogue(o);
    const before = clone(d);
    const r = secondJobOnData(d, gd, 'archer', null);
    assert.equal(r.ok, false, what);
    assert.match(r.msg, re, what);
    assert.deepEqual(d, before, `${what}: 아무것도 쓰지 않음`);
  }
  const d = readyRogue();
  assert.equal(checkSecondJob(d, gd, 'gladiator', null).ok, false, '도적은 검투사로 갈 수 없음');
  assert.equal(checkSecondJob(d, gd, 'warrior', null).ok, false, '1차 직업으로는 2차 전직 없음');
  assert.equal(checkSecondJob(d, gd, 'archer', 'bird').ok, false, '계통은 수인만');
  assert.equal(checkSecondJob(char({ classId: 'peasant', level: 99, ascended: true }), gd, 'archer', null).ok, false);
});

test('2차 전직: 수인은 계통을 골라야 하고, 고른 계통은 바꿀 수 없다', () => {
  // 무도가: 순수 체력 3588 + 2550, 마력 1402 + 400 + 1000
  const monk = (): CharacterData =>
    char({ classId: 'monk', level: 99, exp: 1_000_000_000, ascended: true, stats: stats(100, 3, 50, 255, 100), bonusMp: 1000, skills: ['m_punch'], prof: { m_punch: 100 } });
  const noType = checkSecondJob(monk(), gd, 'beastkin', null);
  assert.equal(noType.ok, false);
  assert.match(noType.msg, /계통\(포유류·조류·파충류\)을 골라야/);
  assert.ok(noType.check?.ok, '조건은 채웠고 계통만 남음');
  assert.equal(checkSecondJob(monk(), gd, 'beastkin', 'fish').ok, false);
  const d = monk();
  const r = secondJobOnData(d, gd, 'beastkin', 'bird');
  assert.equal(r.ok, true, r.msg);
  assert.match(r.msg, /조류 계통의 수인/);
  assert.equal(d.classId, 'beastkin');
  assert.equal(d.beastType, 'bird');
  assert.equal(d.exp, 0);
  const again = chooseBeastTypeOnData(d, gd, 'mammal');
  assert.equal(again.ok, false);
  assert.match(again.msg, /바꿀 수 없습니다/);
  assert.equal(d.beastType, 'bird');
  // 계통이 없는 옛 수인은 한 번 고름
  const old = normalizeCharacter({ name: '옛수인', classId: 'beastkin', level: 99 });
  assert.equal(old.beastType, null);
  assert.equal(chooseBeastTypeOnData(old, gd, 'fish').ok, false);
  assert.equal(chooseBeastTypeOnData(old, gd, 'reptile').ok, true);
  assert.equal(old.beastType, 'reptile');
  assert.equal(chooseBeastTypeOnData(old, gd, 'bird').ok, false);
  assert.equal(chooseBeastTypeOnData(char({ classId: 'monk' }), gd, 'bird').ok, false, '수인이 아니면 고를 수 없음');
});

// ───────────────────────── 어빌리티 ─────────────────────────

test('어빌리티: 몬스터 경험치의 25% 를 어빌 경험치로, expToNext 만큼 모이면 어빌 업, 오를 때마다 체력 +30·마나 +15', () => {
  const d = readyRogue({ classId: 'archer', abilityLevel: 1, abilityExp: 0 });
  assert.equal(abilityExpShare(d, gd, 1000), 250);
  assert.equal(abilityExpShare(d, gd, 3), 0, '버림');
  assert.equal(abilityExpShare(readyRogue(), gd, 1000), 0, '1차 직업은 어빌 경험치가 없음');
  const pure0 = pureVitals(d, gd);
  const need = expToNext(1) + expToNext(2);
  assert.equal(addAbilityExpToData(d, gd, need - 1), 1);
  assert.equal(d.abilityLevel, 2);
  assert.equal(d.abilityExp, expToNext(2) - 1);
  assert.equal(addAbilityExpToData(d, gd, 6), 1);
  assert.equal(d.abilityLevel, 3);
  assert.equal(d.abilityExp, 5);
  const pure = pureVitals(d, gd);
  assert.equal(pure.hp - pure0.hp, 60);
  assert.equal(pure.mp - pure0.mp, 30);
  // 만렙(99)이면 더 쌓이지 않음
  const top = readyRogue({ classId: 'archer', abilityLevel: 98, abilityExp: 0 });
  assert.equal(addAbilityExpToData(top, gd, 1e15), 1);
  assert.equal(top.abilityLevel, 99);
  assert.equal(top.abilityExp, 0);
  assert.equal(addAbilityExpToData(top, gd, 1000), 0);
  assert.equal(top.abilityExp, 0);
  assert.equal(abilityExpShare(top, gd, 1000), 0);
  // 2차 직업이 아니면 아무 일도 없음
  const first = readyRogue();
  assert.equal(addAbilityExpToData(first, gd, 1e9), 0);
  assert.equal(first.abilityLevel, 0);
  assert.equal(first.abilityExp, 0);
});

// ───────────────────────── 숙련도 ─────────────────────────

test('숙련도: 쓸 때마다 max(3%, 35% × (1 − 0.8 × 숙련도/100)) 확률로 +1, 최대 100, 배우지 않은 기술은 오르지 않음', () => {
  const P = gd.progression.proficiency;
  const d = readyWarrior({ prof: { first_aid: 0, w_strike: 50, w_ironwall: 99 } });
  for (const [id, prof] of [['first_aid', 0], ['w_strike', 50], ['w_ironwall', 99]] as const) {
    const chance = profGainChance(prof, P);
    assert.equal(rollProficiencyOnData(d, gd, id, chance), false, `${id}: 확률과 같으면 오르지 않음`);
    assert.equal(d.prof[id], prof);
    assert.equal(rollProficiencyOnData(d, gd, id, chance - 1e-9), true, `${id}: 확률보다 작으면 오름`);
    assert.equal(d.prof[id], prof + 1);
  }
  assert.ok(Math.abs(profGainChance(0, P) - 0.35) < 1e-12);
  assert.ok(Math.abs(profGainChance(50, P) - 0.21) < 1e-12);
  assert.equal(profGainChance(100, P), 0);
  // 최대에서 멈춤
  assert.equal(d.prof.w_ironwall, 100);
  assert.equal(rollProficiencyOnData(d, gd, 'w_ironwall', 0), false);
  assert.equal(d.prof.w_ironwall, 100);
  // 배우지 않은 기술
  assert.equal(rollProficiencyOnData(d, gd, 'w_crash', 0), false);
  assert.equal(d.prof.w_crash, undefined);
  // 오르는 속도: 1000번 쓰면 0 → 100 근처까지, 확률 표대로라면 평균 약 1,000번
  const e = readyWarrior({ prof: { first_aid: 0, w_strike: 0, w_ironwall: 0 } });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let uses = 0;
  while (e.prof.w_strike! < 100 && uses < 100_000) {
    rollProficiencyOnData(e, gd, 'w_strike', rnd());
    uses++;
  }
  assert.equal(e.prof.w_strike, 100);
  assert.ok(uses > 500 && uses < 2000, `${uses}번`);
});

test('숙련도 배율: 숙련도 0 → 70%, 50 → 92.5%, 100 → 115% (위력과 해로운 상태의 확률)', () => {
  const d = readyWarrior({ prof: { first_aid: 0, w_strike: 50, w_ironwall: 100 } });
  const fake = { data: d, world: { data: gd } } as unknown as Player;
  assert.ok(Math.abs(proficiencyMultiplier(fake, 'first_aid') - 0.7) < 1e-12);
  assert.ok(Math.abs(proficiencyMultiplier(fake, 'w_strike') - 0.925) < 1e-12);
  assert.ok(Math.abs(proficiencyMultiplier(fake, 'w_ironwall') - 1.15) < 1e-12);
});

// ───────────────────────── 스킬트리로 배우기 ─────────────────────────

/** 시험용 조건을 붙인 트리 (회오리 베기: 늑대 가죽 3개 + 강타 숙련도 30 + 힘 20, 할퀴기: 포유류 전용,
 *  2차 직업 시험의 회오리 칼날·할퀴기는 선수과목·재료 없이 어빌·계통만 보게) */
function treeData(): GameData {
  const live = GameData.load(DIR);
  const trees = clone(live.skillTrees) as SkillTreesConfig;
  const whirl = trees.trees.warrior.nodes.find((n) => n.ability === 'w_whirl')!;
  whirl.items = [{ item: 'mat_wolf_pelt', qty: 3 }];
  whirl.requires = [{ ability: 'w_strike', prof: 30 }];
  whirl.stats = { str: 20 };
  const gWhirl = trees.trees.gladiator.nodes.find((n) => n.ability === 'g_whirl')!;
  gWhirl.items = [];
  gWhirl.requires = [];
  const rend = trees.trees.beastkin.nodes.find((n) => n.ability === 'k_rend')!;
  rend.beastType = 'mammal';
  rend.items = [];
  rend.requires = [];
  const issues = live.applyDesign({ skillTrees: trees });
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  return live;
}

test('배우기: 레벨·골드·재료(씀)·선수과목 숙련도·능력치를 모두 채워야 배우고, 배우면 숙련도 0', () => {
  const t = treeData();
  const warrior = (o: Partial<CharacterData> = {}): CharacterData => {
    const d = char({ classId: 'warrior', level: 12, gold: 1000, stats: stats(20, 3, 3, 3, 3), skills: ['first_aid', 'w_strike'], prof: { first_aid: 0, w_strike: 30 }, ...o });
    addItem(d, t.items.get('mat_wolf_pelt')!, 4);
    return d;
  };
  const cases: [string, Partial<CharacterData>, RegExp][] = [
    ['레벨', { level: 11 }, /레벨 12 이상/],
    ['골드', { gold: 799 }, /800 골드/],
    ['선수과목 숙련도', { prof: { first_aid: 0, w_strike: 29 } }, /선수과목.*강타 숙련도 30/],
    ['선수과목 안 배움', { skills: ['first_aid'], prof: { first_aid: 0 } }, /선수과목.*강타/],
    ['능력치', { stats: stats(19, 3, 3, 3, 3) }, /힘 20 이상/],
  ];
  for (const [what, o, re] of cases) {
    const d = warrior(o);
    const before = clone(d);
    const r = learnFromTree(d, t, 'w_whirl');
    assert.equal(r.ok, false, what);
    assert.match(r.msg, re, what);
    assert.deepEqual(d, before, `${what}: 아무것도 내지 않음`);
  }
  const lacking = warrior();
  lacking.inventory = lacking.inventory.map((s) => (s?.item === 'mat_wolf_pelt' ? { ...s, qty: 2 } : s));
  assert.match(learnFromTree(lacking, t, 'w_whirl').msg, /늑대 가죽 3개/);
  const d = warrior();
  const r = learnFromTree(d, t, 'w_whirl');
  assert.equal(r.ok, true, r.msg);
  assert.match(r.msg, /800 골드, 늑대 가죽 3개/);
  assert.ok(d.skills.includes('w_whirl'));
  assert.equal(d.prof.w_whirl, 0);
  assert.equal(d.gold, 200);
  assert.equal(countItem(d, 'mat_wolf_pelt'), 1);
  assert.equal(learnFromTree(d, t, 'w_whirl').ok, false, '이미 배움');
});

test('배우기: 지금 직업의 트리만 (전직 전 직업의 기술은 못 배우지만 쓸 수는 있음), 평민 트리는 누구나, 운영자는 조건 없이', () => {
  const t = treeData();
  // 전사였다가 도적으로 전직: 전사 기술은 더 배울 수 없음
  const d = char({ classId: 'rogue', level: 99, gold: 1_000_000, rebirths: 1, stats: stats(255, 3, 3, 3, 3), skills: ['first_aid', 'w_strike'], prof: { first_aid: 100, w_strike: 100 } });
  addItem(d, t.items.get('mat_wolf_pelt')!, 3);
  const r = learnFromTree(d, t, 'w_whirl');
  assert.equal(r.ok, false);
  assert.match(r.msg, /지금 직업의 기술만/);
  assert.equal(learnFromTree(d, t, 'r_stab').ok, true);
  assert.equal(learnFromTree(d, t, 'rest').ok, true, '평민 트리는 누구나');
  // 운영자: 다른 직업 기술도, 골드·재료 없이
  const gmGold = d.gold;
  assert.equal(learnFromTree(d, t, 'w_whirl', { free: true }).ok, true);
  assert.equal(d.gold, gmGold);
  assert.equal(countItem(d, 'mat_wolf_pelt'), 3);
  assert.equal(d.prof.w_whirl, 0);
  assert.equal(learnFromTree(d, t, 'mon_poison', { free: true }).ok, false, '몬스터 기술은 운영자도 못 배움');
});

test('배우기: 2차 직업 기술은 레벨이 아니라 어빌로, 수인 계통 전용 기술은 그 계통만', () => {
  const t = treeData();
  const glad = char({ classId: 'gladiator', level: 99, abilityLevel: 11, gold: 10_000 });
  const low = learnFromTree(glad, t, 'g_whirl');
  assert.equal(low.ok, false);
  assert.match(low.msg, /어빌 12 이상/);
  glad.abilityLevel = 12;
  assert.equal(learnFromTree(glad, t, 'g_whirl').ok, true);
  assert.equal(glad.gold, 10_000 - 800);
  const beast = (type: string) => char({ classId: 'beastkin', level: 99, abilityLevel: 5, gold: 1000, beastType: type });
  const bird = beast('bird');
  const no = learnFromTree(bird, t, 'k_rend');
  assert.equal(no.ok, false);
  assert.match(no.msg, /포유류 계통/);
  assert.equal(learnFromTree(beast('mammal'), t, 'k_rend').ok, true);
});

// ───────────────────────── 옛 저장 파일 ─────────────────────────

test('옛 저장 파일: 불러오면 배운 기술은 숙련도 100(가장 센 위력), 2차 직업은 어빌 1, 성장 항목은 기본값', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-oldsave-'));
  try {
    fs.mkdirSync(path.join(dir, 'characters'));
    // 이 체계를 넣기 전의 저장 파일 (rebirths·ascended·abilityLevel·beastType·prof 가 없음)
    const old = {
      version: 1,
      name: '옛전사',
      passwordHash: 'x',
      classId: 'warrior',
      level: 77,
      exp: 1234,
      stats: { str: 120, int: 3, wis: 20, con: 80, dex: 40 },
      statPoints: 0,
      bonusHp: 500,
      bonusMp: 100,
      skills: ['first_aid', 'w_strike', 'w_whirl'],
      spells: [],
      inventory: [{ item: 'pot_hp_1', qty: 5 }],
      equipment: { weapon: 'w_warrior_1' },
    };
    const oldArcher = { version: 1, name: '옛궁수', passwordHash: 'x', classId: 'archer', level: 99, skills: ['a_aimed', 'a_double'], spells: [] };
    fs.writeFileSync(path.join(dir, 'characters', '옛전사.json'), JSON.stringify(old));
    fs.writeFileSync(path.join(dir, 'characters', '옛궁수.json'), JSON.stringify(oldArcher));
    const store = new CharacterStore(dir);
    store.load((id) => gd.items.has(id));
    const w = store.get('옛전사')!;
    assert.deepEqual(w.prof, { first_aid: 100, w_strike: 100, w_whirl: 100 });
    assert.equal(w.rebirths, 0);
    assert.equal(w.ascended, false);
    assert.equal(w.abilityLevel, 0);
    assert.equal(w.beastType, null);
    assert.equal(w.level, 77);
    assert.equal(w.bonusHp, 500);
    const fake = { data: w, world: { data: gd } } as unknown as Player;
    assert.equal(proficiencyMultiplier(fake, 'w_strike'), gd.progression.proficiency.effectMax);
    const a = store.get('옛궁수')!;
    assert.equal(a.abilityLevel, 1);
    assert.equal(a.abilityExp, 0);
    assert.deepEqual(a.prof, { a_aimed: 100, a_double: 100 });
    // 다시 저장했다 읽어도 같음
    await store.save(w);
    await store.flush();
    const again = new CharacterStore(dir);
    again.load();
    assert.deepEqual(again.get('옛전사')!.prof, w.prof);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
