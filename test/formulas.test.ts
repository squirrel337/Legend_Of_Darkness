import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acMultiplier,
  autoAllocate,
  computeDerived,
  elementMultiplier,
  expToNext,
  hitChance,
  monsterStats,
  totalExpForLevel,
} from '../src/shared/formulas';
import { circleOf } from '../src/shared/constants';
import type { ClassDef, ItemDef } from '../src/shared/types';

const warrior: ClassDef = {
  id: 'warrior',
  name: '전사',
  desc: '',
  color: '#fff',
  baseHp: 60,
  baseMp: 20,
  hpPerLevel: 40,
  mpPerLevel: 8,
  hpPerCon: 10,
  mpPerWis: 6,
  statWeights: { str: 6, con: 3, dex: 1 },
};

test('경험치 테이블은 레벨마다 증가하고 99레벨까지 누적값이 합리적이다', () => {
  let prev = 0;
  for (let l = 1; l < 99; l++) {
    const v = expToNext(l);
    assert.ok(v > prev, `레벨 ${l}`);
    prev = v;
  }
  assert.equal(expToNext(1), 65);
  const total = totalExpForLevel(99);
  assert.ok(total > 10_000_000 && total < 100_000_000, `누적 ${total}`);
});

test('서클 구간', () => {
  assert.equal(circleOf(1), 1);
  assert.equal(circleOf(10), 1);
  assert.equal(circleOf(11), 2);
  assert.equal(circleOf(41), 3);
  assert.equal(circleOf(71), 4);
  assert.equal(circleOf(99), 5);
});

test('속성 상성: 불>바람>땅>물>불, 빛과 어둠은 서로 강함', () => {
  assert.equal(elementMultiplier('fire', 'wind'), 1.5);
  assert.equal(elementMultiplier('wind', 'earth'), 1.5);
  assert.equal(elementMultiplier('earth', 'water'), 1.5);
  assert.equal(elementMultiplier('water', 'fire'), 1.5);
  assert.equal(elementMultiplier('wind', 'fire'), 0.75);
  assert.equal(elementMultiplier('light', 'dark'), 1.5);
  assert.equal(elementMultiplier('dark', 'light'), 1.5);
  assert.equal(elementMultiplier('fire', 'fire'), 0.6);
  assert.equal(elementMultiplier('none', 'fire'), 1);
  assert.equal(elementMultiplier('fire', 'none'), 1);
});

test('AC 배율은 낮을수록 피해가 줄고 범위가 제한된다', () => {
  assert.equal(acMultiplier(0), 1);
  assert.equal(acMultiplier(-50), 0.5);
  assert.equal(acMultiplier(-500), 0.2);
  assert.equal(acMultiplier(500), 2);
});

test('명중률은 30%~98% 사이', () => {
  assert.equal(hitChance(1000, 99, 0, 1), 0.98);
  assert.equal(hitChance(0, 1, 1000, 99), 0.3);
});

test('파생 능력치: 장비/상태 효과/맨손 피해', () => {
  const sword: ItemDef = { id: 's', name: '검', type: 'equip', slot: 'weapon', dmg: [10, 20], bonus: { str: 5, hp: 100 }, price: 0, icon: { shape: 'sword', color: '#fff' } };
  const armor: ItemDef = { id: 'a', name: '갑옷', type: 'equip', slot: 'armor', ac: -20, price: 0, icon: { shape: 'armor', color: '#fff' } };
  const stats = { str: 10, int: 3, wis: 3, con: 10, dex: 3 };
  const bare = computeDerived({ cls: warrior, level: 10, stats, bonusHp: 0, bonusMp: 0, equipment: [] });
  assert.deepEqual([bare.dmgMin, bare.dmgMax], [2, 5]);
  assert.equal(bare.maxHp, 60 + 40 * 9 + 10 * 10);
  const eq = computeDerived({
    cls: warrior,
    level: 10,
    stats,
    bonusHp: 50,
    bonusMp: 0,
    equipment: [sword, armor],
    statuses: [
      { id: 'armor', potency: 15 },
      { id: 'curse', potency: 5 },
    ],
  });
  assert.equal(eq.str, 15);
  assert.equal(eq.ac, -20 - 15 + 5);
  assert.deepEqual([eq.dmgMin, eq.dmgMax], [10, 20]);
  assert.equal(eq.maxHp, bare.maxHp + 100 + 50);
});

test('능력치 자동 분배는 포인트를 모두 사용한다', () => {
  const out = autoAllocate({ str: 6, con: 3, dex: 1 }, 197);
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  assert.equal(sum, 197);
  assert.ok(out.str > out.con && out.con > out.dex);
  assert.equal(out.int, 0);
});

test('능력치 자동 분배는 아주 큰 수에서도 바로 끝난다', () => {
  // 2^53 을 넘는 수에서는 1을 더해도 값이 변하지 않아, 나머지 분배가 끝나지 않던 문제
  const out = autoAllocate({ str: 4, con: 4, dex: 3 }, 15482362418670758);
  assert.ok(Object.values(out).every((v) => Number.isFinite(v) && v >= 0));
  assert.ok(out.str > 0 && out.con > 0 && out.dex > 0);
});

test('몬스터 능력치는 레벨에 따라 커지고 지정값이 우선한다', () => {
  const low = monsterStats({ id: 'a', name: 'a', level: 1, look: { body: 'rat', color: '#fff' } });
  const high = monsterStats({ id: 'b', name: 'b', level: 90, look: { body: 'rat', color: '#fff' } });
  assert.ok(high.hp > low.hp * 50);
  assert.ok(high.exp > low.exp * 100);
  const fixed = monsterStats({ id: 'c', name: 'c', level: 50, hp: 7, exp: 0, look: { body: 'dummy', color: '#fff' } });
  assert.equal(fixed.hp, 7);
  assert.equal(fixed.exp, 0);
});
