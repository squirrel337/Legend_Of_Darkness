import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { INVENTORY_SIZE } from '../src/shared/constants';
import { expToNext } from '../src/shared/formulas';
import { loadConfig } from '../src/server/config';
import { GameData } from '../src/server/gamedata';
import { CharacterStore, emptyEquipment, normalizeCharacter, type CharacterData } from '../src/server/storage';
import {
  addExpToData,
  addItem,
  autoAllocateOnData,
  bestGearFor,
  canFit,
  countItem,
  equipError,
  learnOnData,
  removeItemQty,
  resetStatsOnData,
  setClassOnData,
  setLevelOnData,
} from '../src/server/systems/character';

const gd = GameData.load(path.resolve(import.meta.dirname, '..', 'gamedata'));
const cfg = loadConfig({ ADMIN_PASSWORD: 'x', DATA_DIR: os.tmpdir() } as NodeJS.ProcessEnv);

function fresh(): CharacterData {
  return normalizeCharacter({ name: '시험', passwordHash: 'x', inventory: [], equipment: emptyEquipment() });
}

test('아이템 겹치기와 소지품 공간', () => {
  const d = fresh();
  const pot = gd.items.get('pot_hp_1')!;
  assert.equal(addItem(d, pot, 150), 0);
  assert.equal(countItem(d, 'pot_hp_1'), 150);
  assert.equal(d.inventory.filter(Boolean).length, 2);
  const sword = gd.items.get('w_warrior_1')!;
  assert.equal(addItem(d, sword, INVENTORY_SIZE), 2);
  assert.equal(canFit(d, sword, 1), false);
  assert.equal(canFit(d, pot, 50), true, '기존 묶음에 50개 여유');
  assert.ok(removeItemQty(d, 'pot_hp_1', 120));
  assert.equal(countItem(d, 'pot_hp_1'), 30);
  assert.equal(removeItemQty(d, 'pot_hp_1', 31), false);
});

test('경험치를 얻으면 레벨이 오르고 능력치 포인트를 받는다', () => {
  const d = fresh();
  const need = expToNext(1) + expToNext(2) + 10;
  assert.equal(addExpToData(d, cfg, need), 2);
  assert.equal(d.level, 3);
  assert.equal(d.exp, 10);
  assert.equal(d.statPoints, 2 * cfg.statPointsPerLevel);
});

test('만렙 이후 경험치는 승급용으로 쌓인다', () => {
  const d = fresh();
  setLevelOnData(d, cfg, cfg.maxLevel);
  assert.equal(addExpToData(d, cfg, 5_000_000), 0);
  assert.equal(d.level, cfg.maxLevel);
  assert.equal(d.exp, 5_000_000);
});

test('레벨 직접 설정과 능력치 초기화/자동 분배', () => {
  const d = fresh();
  setLevelOnData(d, cfg, 50);
  assert.equal(d.level, 50);
  assert.equal(d.statPoints, 49 * cfg.statPointsPerLevel);
  d.classId = 'warrior';
  const spent = autoAllocateOnData(d, gd, cfg);
  assert.equal(spent, 98);
  assert.equal(d.statPoints, 0);
  assert.ok(d.stats.str > d.stats.con && d.stats.con > d.stats.dex);
  const refund = resetStatsOnData(d);
  assert.equal(refund, 98);
  assert.equal(d.stats.str, 3);
  setLevelOnData(d, cfg, 10);
  assert.equal(d.statPoints, 98 - 40 * cfg.statPointsPerLevel);
  setLevelOnData(d, cfg, 9999);
  assert.equal(d.level, cfg.maxLevel);
});

test('직업 변경 시 다른 직업 기술과 못 쓰는 장비를 정리한다', () => {
  const d = fresh();
  d.level = 30;
  d.classId = 'warrior';
  learnOnData(d, gd.abilities.get('w_strike')!);
  learnOnData(d, gd.abilities.get('first_aid')!);
  d.equipment.weapon = 'w_warrior_2';
  d.equipment.helmet = 'helm_2';
  setClassOnData(d, gd, 'wizard');
  assert.deepEqual(d.skills, ['first_aid']);
  assert.equal(d.equipment.weapon, null);
  assert.equal(d.equipment.helmet, 'helm_2');
  assert.equal(countItem(d, 'w_warrior_2'), 1);
});

test('장비 조건 검사', () => {
  const d = fresh();
  const sword = gd.items.get('w_warrior_3')!;
  assert.match(equipError(d, sword) ?? '', /레벨/);
  d.level = 99;
  assert.match(equipError(d, sword) ?? '', /직업/);
  d.classId = 'warrior';
  assert.equal(equipError(d, sword), null);
  assert.equal(equipError(fresh(), sword, true), null, '운영자는 조건 무시');
});

test('레벨에 맞는 최고 장비는 모두 착용 가능하다', () => {
  for (const cls of ['warrior', 'rogue', 'wizard', 'priest', 'monk'] as const) {
    for (const lv of [5, 40, 99]) {
      const d = fresh();
      d.classId = cls;
      d.level = lv;
      const gear = bestGearFor(d, gd);
      assert.ok(gear.some((g) => g.slot === 'weapon'), `${cls} ${lv} 무기`);
      for (const g of gear) assert.equal(equipError(d, g), null, `${cls} ${lv} ${g.id}`);
    }
  }
});

test('저장소: 저장 후 다시 읽으면 같은 데이터, 모르는 아이템은 제거', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-store-'));
  const store = new CharacterStore(dir);
  store.load();
  const d = fresh();
  d.name = 'Alice';
  d.gold = 1234;
  d.inventory[0] = { item: 'pot_hp_1', qty: 3 };
  d.inventory[1] = { item: 'deleted_item', qty: 1 };
  await store.create(d);
  await assert.rejects(store.create({ ...d, name: 'alice' }), /이미/);
  const again = new CharacterStore(dir);
  again.load((id) => gd.items.has(id));
  const loaded = again.get('ALICE')!;
  assert.equal(loaded.gold, 1234);
  assert.deepEqual(loaded.inventory[0], { item: 'pot_hp_1', qty: 3 });
  assert.equal(loaded.inventory[1], null);
  assert.ok(await again.delete('alice'));
  assert.equal(fs.readdirSync(path.join(dir, 'characters')).filter((f) => f.endsWith('.json')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
