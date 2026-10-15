import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CLASS_IDS } from '../src/shared/constants';
import { tileInfo } from '../src/shared/tiles';
import { GameData, GameDataError } from '../src/server/gamedata';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);

test('게임 데이터가 오류 없이 로드된다', () => {
  assert.ok(gd.items.size > 100);
  assert.ok(gd.abilities.size > 50);
  assert.ok(gd.monsters.size > 20);
  assert.ok(gd.maps.has('town'));
  for (const id of CLASS_IDS) assert.ok(gd.classes.has(id));
});

test('모든 맵의 걸을 수 있는 칸은 시작 지점에서 도달할 수 있다', () => {
  for (const m of gd.maps.values()) {
    const H = m.tiles.length;
    const W = m.tiles[0]!.length;
    const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && tileInfo(m.tiles[y]![x]).walkable;
    const seen = new Set<number>();
    const q: [number, number][] = [[m.spawn.x, m.spawn.y]];
    seen.add(m.spawn.y * W + m.spawn.x);
    while (q.length) {
      const [x, y] = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (walk(nx, ny) && !seen.has(ny * W + nx)) {
          seen.add(ny * W + nx);
          q.push([nx, ny]);
        }
      }
    }
    let total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk(x, y)) total++;
    assert.equal(seen.size, total, `${m.id}: 고립된 칸이 있습니다`);
    for (const w of m.warps) assert.ok(seen.has(w.y * W + w.x), `${m.id}: 워프 (${w.x},${w.y}) 에 갈 수 없습니다`);
  }
});

test('워프 도착 지점은 다른 워프가 아니다', () => {
  for (const m of gd.maps.values()) {
    for (const w of m.warps) {
      const t = gd.maps.get(w.to)!;
      assert.ok(!t.warps.some((o) => o.x === w.tx && o.y === w.ty), `${m.id} → ${w.to}`);
    }
  }
});

test('각 직업은 전직 레벨에 배울 수 있는 기술이 있고, 시작 장비를 착용할 수 있다', () => {
  for (const c of gd.classes.values()) {
    if (c.id === 'peasant') continue;
    const abilities = [...gd.abilities.values()].filter((a) => a.classId === c.id);
    assert.ok(abilities.some((a) => a.level <= 5), `${c.id}: 5레벨 기술 없음`);
    for (const id of c.starterItems ?? []) {
      const it = gd.items.get(id)!;
      assert.ok(!it.classes || it.classes.includes(c.id), `${c.id}: ${id}`);
      assert.ok((it.level ?? 1) <= 5, `${c.id}: ${id} 레벨`);
    }
  }
});

test('이름/ID 검색', () => {
  assert.equal(gd.findItem('엘릭서')?.id, 'elixir');
  assert.equal(gd.findItem('빨간물약')?.id, 'pot_hp_1');
  assert.equal(gd.findMonster('들쥐')?.id, 'rat');
  assert.equal(gd.findMap('forest')?.name, '속삭이는 숲');
  assert.equal(gd.findAbility('치유')?.id, 'p_heal');
});

test('잘못된 데이터는 어디가 틀렸는지 알려 준다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-gd-'));
  fs.cpSync(DIR, tmp, { recursive: true });
  const monsters = JSON.parse(fs.readFileSync(path.join(tmp, 'monsters.json'), 'utf8'));
  monsters[0].loot.push({ item: 'no_such_item', chance: 0.5 });
  fs.writeFileSync(path.join(tmp, 'monsters.json'), JSON.stringify(monsters));
  assert.throws(() => GameData.load(tmp), (e: unknown) => e instanceof GameDataError && e.message.includes('no_such_item'));
  fs.rmSync(tmp, { recursive: true, force: true });
});
