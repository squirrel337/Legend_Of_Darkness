// 맵 점유 칸과 바닥 아이템 관리 (서버를 띄우지 않는 단위 테스트)
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { GameData } from '../src/server/gamedata';
import { dropBlockedReason, dropToGround, MAX_GROUND_ITEMS, MAX_PLAYER_DROPS } from '../src/server/systems/ground';
import { MapInstance } from '../src/server/world/MapInstance';
import { Monster } from '../src/server/world/Monster';
import type { World } from '../src/server/world/World';

const gd = GameData.load(path.resolve(import.meta.dirname, '..', 'gamedata'));
let nextId = 1;

function monsterAt(x: number, y: number): Monster {
  const m = new Monster(nextId++, gd.monsters.get('rat')!);
  m.x = x;
  m.y = y;
  return m;
}

/** dropToGround 가 쓰는 부분만 있는 가짜 World */
function fakeWorld(...maps: MapInstance[]): World {
  return { maps: new Map(maps.map((m) => [m.id, m])), data: gd, allocId: () => nextId++ } as unknown as World;
}

test('같은 칸에 두 생물이 겹쳐도 점유 정보가 어긋나지 않는다', () => {
  const map = new MapInstance(gd.maps.get('forest')!);
  const { x, y } = map.def.spawn;
  const a = monsterAt(x, y);
  map.add(a);
  const free = map.findFreeNear(x, y)!;
  // 순간이동/부활 등으로 이미 생물이 있는 칸에 다른 생물이 놓이는 경우
  const b = monsterAt(x, y);
  map.add(b);
  assert.equal(map.creatureAt(x, y), a, '먼저 있던 생물을 덮어쓰지 않음');
  map.move(b, free.x, free.y);
  assert.equal(map.creatureAt(x, y), a, '겹쳐 있던 생물이 떠나도 원래 생물의 칸은 그대로');
  assert.equal(map.creatureAt(free.x, free.y), b);
  map.move(b, x, y);
  assert.equal(map.creatureAt(free.x, free.y), undefined);
  map.remove(a);
  assert.equal(map.creatureAt(x, y), b, '먼저 있던 생물이 떠나면 겹쳐 있던 생물이 칸을 차지');
  b.dead = true;
  map.refreshBlocking(b);
  assert.equal(map.creatureAt(x, y), undefined);
  assert.ok(map.isFree(x, y));
});

test('바닥 아이템: 한 사람이 버려 둘 수 있는 개수에는 상한이 있다', () => {
  const forest = new MapInstance(gd.maps.get('forest')!);
  const town = new MapInstance(gd.maps.get('town')!);
  const world = fakeWorld(forest, town);
  const { x, y } = forest.def.spawn;
  // 여러 맵에 나눠 버려도 합계로 셉니다
  for (let i = 0; i < MAX_PLAYER_DROPS; i++) dropToGround(world, i % 2 ? forest : town, x, y, 'pot_hp_1', 1, null, 'griefer');
  assert.match(dropBlockedReason(world, forest, 'griefer') ?? '', /너무 많습니다/);
  assert.equal(dropBlockedReason(world, forest, 'someone'), null, '다른 사람은 영향 없음');
});

test('바닥 아이템: 맵이 가득 차도 버린 물건이 남의 전리품을 밀어내지 못한다', () => {
  const map = new MapInstance(gd.maps.get('forest')!);
  const world = fakeWorld(map);
  const { x, y } = map.def.spawn;
  const loot = [];
  for (let i = 0; i < MAX_GROUND_ITEMS; i++) loot.push(dropToGround(world, map, x, y, 'pot_hp_1', 1, 'hunter')!);
  assert.equal(map.items.size, MAX_GROUND_ITEMS);
  // 가득 찬 맵에 직접 버리기: 치울 수 있는 자기 물건이 없으므로 거절
  assert.match(dropBlockedReason(world, map, 'griefer') ?? '', /너무 많아서/);
  assert.equal(dropToGround(world, map, x, y, 'pot_hp_1', 1, null, 'griefer'), null);
  assert.ok(loot.every((it) => map.items.has(it)), '전리품은 그대로');
  // 몬스터 전리품은 가장 오래된 전리품을 밀어냅니다
  dropToGround(world, map, x, y, 'pot_mp_1', 1, 'hunter');
  assert.equal(map.items.size, MAX_GROUND_ITEMS);
  assert.ok(!map.items.has(loot[0]!));
  assert.ok(map.items.has(loot[1]!));
});

test('바닥 아이템: 가득 차면 직접 버린 물건부터 치우고, 버린 사람은 자기 물건만 밀어낸다', () => {
  const map = new MapInstance(gd.maps.get('forest')!);
  const world = fakeWorld(map);
  const { x, y } = map.def.spawn;
  const loot = [];
  for (let i = 0; i < MAX_GROUND_ITEMS - 2; i++) loot.push(dropToGround(world, map, x, y, 'pot_hp_1', 1, 'hunter')!);
  const mine = dropToGround(world, map, x, y, 'pot_hp_1', 1, null, 'griefer')!;
  const other = dropToGround(world, map, x, y, 'pot_hp_1', 1, null, 'trader')!;
  assert.equal(map.items.size, MAX_GROUND_ITEMS);
  // 버린 사람이 또 버리면 자기 물건만 밀려남
  assert.equal(dropBlockedReason(world, map, 'griefer'), null);
  const again = dropToGround(world, map, x, y, 'pot_hp_1', 1, null, 'griefer')!;
  assert.ok(!map.items.has(mine));
  assert.ok(map.items.has(other) && map.items.has(again) && map.items.has(loot[0]!));
  // 전리품이 떨어지면 오래된 전리품보다 버려진 물건(먼저 버린 것)이 먼저 치워짐
  dropToGround(world, map, x, y, 'pot_mp_1', 1, 'hunter');
  assert.ok(!map.items.has(other));
  assert.ok(map.items.has(loot[0]!) && map.items.has(again));
});
