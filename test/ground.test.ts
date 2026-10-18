// 바닥 그림의 순수한 부분 점검: 지형 분류와 덮임 순서, 물체 아래 바닥 추정, 성수 샘·단상 계단 모양,
// 바닥 조각 번호·LRU, 맵별 분위기 표, 무늬의 색 번호. 조각 픽셀은 DOM 없이 구워서 결정성과 이음매를 봅니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { TILE_H, TILE_W } from '../src/shared/constants';
import { TILESET } from '../src/shared/tiles';
import type { MapView } from '../src/shared/protocol';
import { AMBIENCES, MAP_AMBIENCE, ambienceFor, vignetteAlpha } from '../src/client/render/ambience';
import { ALL_TEXTURES, TEX_H, TEX_W, groundTexture, paletteFor } from '../src/client/render/groundtex';
import {
  CHUNK,
  DECO,
  EXCLUDED,
  GROUND,
  Lru,
  MATERIALS,
  MIXED,
  SOLID,
  STEPS,
  STEP_D,
  blendPoint,
  buildGroundGrid,
  chunkKey,
  chunkRange,
  chunksByDistance,
  classifyTile,
  coversEdge,
  daisLevel,
  dualIndex,
  findPools,
  inferFloor,
  liquidBit,
  liquidCover,
  mapWorldBounds,
  stepHit,
  tileRangeFor,
  type BlendOut,
  type StepHit,
} from '../src/client/render/terrain';
import { ROOT } from './helpers';

// 조각 굽기는 DOM 형식(캔버스)을 쓰는 모듈에 있으므로 서버 tsconfig 의 형식 검사 밖에서 불러옵니다
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const mapOf = (id: string, tiles: string[], dark = false): MapView => ({ id, name: id, tiles, safe: true, dark, warps: [] });

test('지형 분류: 바닥 무늬마다 재질, 장식, 벽·물체 구분', () => {
  const cases: [string, number, number, number][] = [
    ['.', GROUND.GRASS, DECO.NONE, SOLID.NONE],
    [':', GROUND.GRASS, DECO.FLOWERS, SOLID.NONE],
    ['f', GROUND.GRASS, DECO.FERNS, SOLID.NONE],
    [',', GROUND.DIRT, DECO.NONE, SOLID.NONE],
    ['=', GROUND.COBBLE, DECO.NONE, SOLID.NONE],
    ['_', GROUND.PLANKS, DECO.NONE, SOLID.NONE],
    ['m', GROUND.MARBLE, DECO.NONE, SOLID.NONE],
    ['-', GROUND.DUNGEON, DECO.NONE, SOLID.NONE],
    ['x', GROUND.ABYSS, DECO.NONE, SOLID.NONE],
    ['k', GROUND.DUNGEON, DECO.BONES, SOLID.NONE],
    [';', GROUND.CAVE, DECO.NONE, SOLID.NONE],
    ['s', GROUND.SAND, DECO.NONE, SOLID.NONE],
    ['a', GROUND.ASH, DECO.NONE, SOLID.NONE],
    ['v', GROUND.SWAMP, DECO.NONE, SOLID.NONE],
    ['g', GROUND.FLAGSTONE, DECO.NONE, SOLID.NONE],
    ['d', GROUND.DAIS, DECO.NONE, SOLID.NONE],
    ['~', GROUND.WATER, DECO.NONE, SOLID.NONE],
    ['U', GROUND.HOLY, DECO.NONE, SOLID.NONE],
    ['L', GROUND.LAVA, DECO.NONE, SOLID.NONE],
    [' ', GROUND.VOID, DECO.NONE, SOLID.NONE],
    ['#', EXCLUDED, DECO.NONE, SOLID.WALL],
    ['h', EXCLUDED, DECO.NONE, SOLID.WALL],
    ['T', EXCLUDED, DECO.NONE, SOLID.OBJECT],
    ['I', EXCLUDED, DECO.NONE, SOLID.OBJECT],
    ['Q', EXCLUDED, DECO.NONE, SOLID.OBJECT],
  ];
  for (const [ch, mat, deco, solid] of cases) assert.deepEqual(classifyTile(ch), { mat, deco, solid }, `타일 '${ch}'`);
  // 표에 없는 문자는 공허
  assert.equal(classifyTile('@').mat, GROUND.VOID);
  // 모든 바닥·액체 타일이 실제 재질로 갈라짐
  for (const [ch, info] of Object.entries(TILESET)) {
    const m = classifyTile(ch).mat;
    if (info.kind === 'floor' || info.kind === 'liquid') assert.ok(m > GROUND.VOID && m < MATERIALS.length, `타일 '${ch}' → ${m}`);
  }
});

test('덮임 순서: 풀이 흙·모래·자갈·판석 가장자리를 덮고, 돌바닥 경계는 더 또렷함', () => {
  for (const m of [GROUND.DIRT, GROUND.SAND, GROUND.COBBLE, GROUND.FLAGSTONE, GROUND.ASH]) {
    assert.ok(coversEdge(GROUND.GRASS, m), `풀 > ${MATERIALS[m]!.name}`);
    assert.ok(!coversEdge(m, GROUND.GRASS), `${MATERIALS[m]!.name} < 풀`);
  }
  for (const m of [GROUND.COBBLE, GROUND.FLAGSTONE, GROUND.DAIS, GROUND.PLANKS, GROUND.MARBLE]) {
    assert.ok(MATERIALS[m]!.soft < MATERIALS[GROUND.DIRT]!.soft / 2, `${MATERIALS[m]!.name} 경계가 흙보다 또렷함`);
    assert.ok(MATERIALS[m]!.built);
  }
  assert.ok(MATERIALS[GROUND.DIRT]!.rim, '흙길 가장자리에 어두운 테두리');
  assert.ok(MATERIALS[GROUND.GRASS]!.tufts, '풀잎이 경계 너머로 삐져나옴');

  // 풀과 흙 칸 중심 사이 선 위: 우선순위 때문에 가운데를 지나서까지 풀이 덮음
  const out: BlendOut = { mat: 0, second: 0, margin: 0 };
  assert.ok(blendPoint(GROUND.GRASS, GROUND.DIRT, GROUND.GRASS, GROUND.DIRT, 0.5, 0.5, out, null));
  assert.equal(out.mat, GROUND.GRASS);
  assert.equal(out.second, GROUND.DIRT);
  assert.ok(Math.abs(out.margin - 0.2) < 1e-9);
  blendPoint(GROUND.GRASS, GROUND.DIRT, GROUND.GRASS, GROUND.DIRT, 0.58, 0.5, out, null);
  assert.equal(out.mat, GROUND.GRASS);
  blendPoint(GROUND.GRASS, GROUND.DIRT, GROUND.GRASS, GROUND.DIRT, 0.62, 0.5, out, null);
  assert.equal(out.mat, GROUND.DIRT);
  // 벽 꼭짓점은 빼고 나머지로 정함, 모두 벽이면 정하지 못함
  blendPoint(EXCLUDED, GROUND.DIRT, GROUND.DIRT, GROUND.DIRT, 0.1, 0.1, out, null);
  assert.equal(out.mat, GROUND.DIRT);
  assert.equal(blendPoint(EXCLUDED, EXCLUDED, EXCLUDED, EXCLUDED, 0.5, 0.5, out, null), false);
  // 흔들림은 결정적으로 경계만 옮김
  const shake = (m: number) => (m === GROUND.DIRT ? 0.3 : 0);
  blendPoint(GROUND.GRASS, GROUND.DIRT, GROUND.GRASS, GROUND.DIRT, 0.5, 0.5, out, shake);
  assert.equal(out.mat, GROUND.DIRT);
});

test('물체·벽 아래 바닥: 둘레 8칸에서 가장 흔한 걸을 수 있는 바닥, 없으면 물, 그다음 색이 같은 바닥', () => {
  assert.equal(inferFloor(['...', '.T,', '...'], 1, 1), GROUND.GRASS);
  // 단상 위 기둥 (단상 5칸, 풀 3칸)
  assert.equal(inferFloor(['ddd', 'dId', '...'], 1, 1), GROUND.DAIS);
  // 단상 모서리의 기둥 (단상 3칸, 풀 5칸): 곧은 이웃 둘이 단상이면 단상 (모서리가 파이지 않게)
  assert.equal(inferFloor(['...', '.Id', '.dd'], 1, 1), GROUND.DAIS);
  // 단상 옆에 붙은 바위 (곧은 이웃 하나만 단상) 는 둘레 풀
  assert.equal(inferFloor(['...', '.Qd', '..d'], 1, 1), GROUND.GRASS);
  // 수가 같으면 곧은 이웃이 많은 쪽
  assert.equal(inferFloor([',.,', '.R.', ',.,'], 1, 1), GROUND.GRASS);
  // 바다 한가운데 바위는 물에 잠김
  assert.equal(inferFloor(['~~~', '~R~', '~~~'], 1, 1), GROUND.WATER);
  // 걸을 수 있는 바닥이 있으면 물보다 땅
  assert.equal(inferFloor(['~~~', '~Q~', '~~.'], 1, 1), GROUND.GRASS);
  // 이웃이 없으면 TileInfo 색이 같은 바닥 (바위 → 풀, 동굴 바위 → 동굴 바닥)
  assert.equal(inferFloor(['R'], 0, 0), GROUND.GRASS);
  assert.equal(inferFloor(['r'], 0, 0), GROUND.CAVE);
  // 벽 이웃은 세지 않음
  assert.equal(inferFloor(['###', '#O_', '###'], 1, 1), GROUND.PLANKS);
});

test('바닥 격자: 벽은 섞기에서 빠지고, 물체는 추정한 바닥으로 섞이고, 두꺼운 벽 안쪽도 바닥이 정해짐', () => {
  const tiles = [',,,,,,,', ',#####,', ',#####,', ',#####,', ',,,T,,,', ',,,,,,,'];
  const g = buildGroundGrid(tiles);
  assert.equal(g.w, 7);
  assert.equal(g.h, 6);
  const at = (x: number, y: number) => y * g.w + x;
  assert.equal(g.blend[at(2, 2)], EXCLUDED);
  assert.equal(g.solid[at(2, 2)], SOLID.WALL);
  assert.equal(g.base[at(3, 2)], GROUND.DIRT, '벽 덩어리 가운데도 둘레에서 번져 들어온 바닥');
  assert.equal(g.blend[at(3, 4)], GROUND.DIRT, '나무 칸은 추정한 바닥으로 섞임');
  assert.equal(g.solid[at(3, 4)], SOLID.OBJECT);
  for (let i = 0; i < g.w * g.h; i++) assert.notEqual(g.base[i], EXCLUDED);
  assert.ok(g.used.has(GROUND.DIRT));
  // 쌍대 칸: 한 재질만 있으면 그 재질, 섞이면 MIXED, 맵 밖과 맞닿으면 MIXED
  const g2 = buildGroundGrid(['....', '..,,', '..,,']);
  assert.equal(g2.dual[dualIndex(g2, 0, 0)], GROUND.GRASS);
  assert.equal(g2.dual[dualIndex(g2, 1, 0)], MIXED);
  assert.equal(g2.dual[dualIndex(g2, 2, 1)], GROUND.DIRT);
  assert.equal(g2.dual[dualIndex(g2, -1, 0)], MIXED);
});

test('물·성수·용암을 깔 칸: 액체 칸과 그 둘레 한 겹', () => {
  const g = buildGroundGrid(['.....', '.....', '..~..', '.....', '....L']);
  const cover = liquidCover(g);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const water = Math.abs(x - 2) <= 1 && Math.abs(y - 2) <= 1;
      const lava = x >= 3 && y >= 3;
      const want = (water ? liquidBit(GROUND.WATER) : 0) | (lava ? liquidBit(GROUND.LAVA) : 0);
      assert.equal(cover[y * 5 + x], want, `(${x},${y})`);
    }
  }
  assert.equal(liquidBit(GROUND.HOLY), 2);
  assert.equal(liquidBit(GROUND.GRASS), 0);
});

test('성수 샘: 정사각형 묶음은 둥근 샘, 둘레 바닥은 단상', () => {
  const g = buildGroundGrid(['dddddd', 'dddddd', 'ddUUdd', 'ddUUdd', 'dddddd', 'dddddd']);
  const pools = findPools(g);
  assert.equal(pools.length, 1);
  const p = pools[0]!;
  assert.equal(p.cells.length, 4);
  assert.equal(p.r, 1);
  assert.equal(p.u, 3);
  assert.equal(p.v, 3);
  assert.equal(p.rim, GROUND.DAIS);
  // ㄱ자 묶음은 둥글게 그리지 않음 (r = 0), 풀밭 위 샘의 둘레는 풀
  const g2 = buildGroundGrid(['.....', '.UU..', '.U...', '.....']);
  const p2 = findPools(g2);
  assert.equal(p2.length, 1);
  assert.equal(p2[0]!.r, 0);
  assert.equal(p2[0]!.rim, GROUND.GRASS);
});

test('단상 계단: 카메라 쪽 두 변 아래로만 옆면, 빛 받는 왼쪽 앞면과 그늘진 오른쪽 앞면', () => {
  const isDais = (x: number, y: number) => x === 1 && y === 1;
  assert.equal(daisLevel(isDais, 1.5, 1.5), 0);
  const side = { v: -1 };
  // +y 쪽(왼쪽 앞) 변 바로 너머: 첫 디딤판, 왼쪽 앞면
  assert.equal(daisLevel(isDais, 1.5, 2 + STEP_D * 0.5, side), 1);
  assert.equal(side.v, 0);
  assert.equal(daisLevel(isDais, 1.5, 2 + STEP_D * 1.5), 2);
  assert.equal(daisLevel(isDais, 1.5, 2.6), STEPS);
  // +x 쪽(오른쪽 앞) 변 너머: 오른쪽 앞면
  assert.equal(daisLevel(isDais, 2 + STEP_D * 0.5, 1.5, side), 1);
  assert.equal(side.v, 1);
  // 뒤쪽 변 너머에는 계단이 없음
  assert.equal(daisLevel(isDais, 1.5, 0.95), STEPS);
  assert.equal(daisLevel(isDais, 0.95, 1.5), STEPS);

  // 화면에서: 단상 칸 (1,1) 의 왼쪽 앞 변 가운데는 (-16, 56), 오른쪽 앞 변 가운데는 (16, 56)
  const hit: StepHit = { kind: 'top', level: 0, side: 0, row: 0, along: 0 };
  stepHit(isDais, -15.5, 50.5, hit);
  assert.deepEqual([hit.kind, hit.level], ['top', 0], '단상 윗면');
  stepHit(isDais, -15.5, 56.5, hit);
  assert.equal(hit.kind, 'face', '왼쪽 앞 변 바로 아래는 옆면');
  assert.equal(hit.level, 0);
  assert.equal(hit.side, 0);
  assert.equal(hit.row, 0, '변 바로 아래 줄은 윗입술');
  stepHit(isDais, 16.5, 58.5, hit);
  assert.equal(hit.kind, 'face');
  assert.equal(hit.side, 1);
  stepHit(isDais, -15.5, 120.5, hit);
  assert.deepEqual([hit.kind, hit.level], ['top', STEPS], '한참 아래는 땅');
  // 위에서 아래로 내려가며 옆면 → 디딤판 → 옆면 ... → 땅 순서로 층이 깊어짐
  let last = 0;
  let faces = 0;
  for (let sy = 50; sy < 120; sy++) {
    stepHit(isDais, -15.5, sy + 0.5, hit);
    const depth = hit.kind === 'face' ? hit.level + 0.5 : hit.level;
    assert.ok(depth >= last, `y=${sy} 에서 층이 거꾸로 감`);
    if (hit.kind === 'face' && hit.row === 0) faces++;
    last = depth;
  }
  assert.equal(faces, STEPS, '옆면이 층 수만큼 보임');
});

test('바닥 조각 번호: 범위, 가까운 순서, 맵 경계', () => {
  assert.deepEqual(chunkRange(0, 0, CHUNK, CHUNK), { cx0: 0, cy0: 0, cx1: 0, cy1: 0 });
  assert.deepEqual(chunkRange(-1, 10, CHUNK + 1, 20), { cx0: -1, cy0: 0, cx1: 1, cy1: 0 });
  const bounds = mapWorldBounds(40, 30);
  assert.equal(bounds.x0, (-30 * TILE_W) / 2);
  assert.equal(bounds.x1, (40 * TILE_W) / 2);
  assert.ok(bounds.y1 > ((40 + 30) * TILE_H) / 2, '단상 계단이 내려오는 만큼 아래로 여유');
  const view = { x0: -700, y0: 100, x1: 700, y1: 780 };
  const list = chunksByDistance(view, bounds);
  assert.ok(list.length > 0);
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const dist = ([i, j]: [number, number]) => ((i + 0.5) * CHUNK - cx) ** 2 + ((j + 0.5) * CHUNK - cy) ** 2;
  for (let k = 1; k < list.length; k++) assert.ok(dist(list[k - 1]!) <= dist(list[k]!), '가까운 조각부터');
  // 화면과 맵이 겹치는 곳의 조각은 모두 들어 있고, 맵 밖 조각은 없음
  const r = chunkRange(Math.max(view.x0, bounds.x0), Math.max(view.y0, bounds.y0), Math.min(view.x1, bounds.x1), Math.min(view.y1, bounds.y1));
  assert.equal(list.length, (r.cx1 - r.cx0 + 1) * (r.cy1 - r.cy0 + 1));
  assert.deepEqual(chunksByDistance({ x0: 5000, y0: 5000, x1: 6000, y1: 6000 }, bounds), []);
  assert.notEqual(chunkKey('town|1', 1, 2), chunkKey('town|2', 1, 2));
  assert.notEqual(chunkKey('town|1', 1, 2), chunkKey('town|1', 2, 1));
});

test('화면 사각형과 겹치는 타일 범위는 겹치는 타일을 모두 담음', () => {
  const w = 30;
  const h = 25;
  for (const [x0, y0, x1, y1] of [
    [-200, 100, 300, 400],
    [-900, -50, -400, 200],
    [0, 600, 800, 900],
  ] as const) {
    const [tx0, ty0, tx1, ty1] = tileRangeFor(w, h, x0, y0, x1, y1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = (x - y) * 32;
        const sy = (x + y) * 16;
        const hits = sx + 32 > x0 && sx - 32 < x1 && sy + 32 > y0 && sy < y1;
        if (hits) assert.ok(x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1, `(${x},${y}) 빠짐`);
      }
    }
  }
});

test('LRU: 한도를 넘으면 가장 오래 안 쓴 것부터 버리고, 꺼내면 최근 것이 됨', () => {
  const evicted: string[] = [];
  const lru = new Lru<string, number>(2, (k) => evicted.push(k));
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 3);
  assert.deepEqual(evicted, ['b']);
  assert.deepEqual(lru.keys(), ['a', 'c']);
  assert.equal(lru.has('b'), false);
  lru.set('a', 10);
  assert.deepEqual(lru.keys(), ['c', 'a']);
  lru.limit = 1;
  lru.trim();
  assert.deepEqual(evicted, ['b', 'c']);
  lru.delete('a');
  assert.deepEqual(evicted, ['b', 'c', 'a']);
  assert.equal(lru.size, 0);
  lru.set('x', 1);
  lru.clear();
  assert.deepEqual(evicted, ['b', 'c', 'a', 'x']);
});

test('맵별 분위기: 마을·훈련장 낮, 평원 흐림, 숲 저녁, 던전 어둠, 모르는 맵은 map.dark 로', () => {
  assert.equal(ambienceFor('town', false).kind, 'day');
  assert.equal(ambienceFor('training', false).kind, 'day');
  assert.equal(ambienceFor('plains', false).kind, 'overcast');
  assert.equal(ambienceFor('forest', false).kind, 'dusk');
  for (const id of ['cave', 'crypt1', 'crypt2', 'tower', 'abyss']) assert.equal(ambienceFor(id, true).kind, 'dark', id);
  assert.equal(ambienceFor('new_island', false).kind, 'day');
  assert.equal(ambienceFor('new_dungeon', true).kind, 'dark');
  // 표가 이름을 이기고, 숲은 R1 색, 마을은 R2 색
  assert.equal(ambienceFor('forest', true).kind, 'dusk');
  assert.equal(ambienceFor('forest', false).palette, 'r1');
  assert.equal(ambienceFor('town', false).palette, 'r2');
  assert.equal(ambienceFor('plains', false).palette, 'r3');
  // 실제 맵 데이터에 있는 맵은 모두 표에 있음
  const dir = path.join(ROOT, 'gamedata/maps');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '');
    assert.ok(MAP_AMBIENCE[id], `맵 ${id} 의 분위기`);
  }
});

test('비네트: 안쪽은 투명, 바깥으로 갈수록 진해지고, 저녁 숲 모서리는 거의 검정', () => {
  for (const amb of Object.values(AMBIENCES)) {
    const v = amb.vignette;
    assert.equal(vignetteAlpha(v, 0), 0);
    assert.equal(vignetteAlpha(v, v.inner), 0);
    assert.ok(Math.abs(vignetteAlpha(v, v.outer + 0.5) - v.alpha) < 1e-9);
    let last = 0;
    for (let d = 0; d <= 1.6; d += 0.02) {
      const a = vignetteAlpha(v, d);
      assert.ok(a >= last - 1e-12 && a <= v.alpha + 1e-12);
      last = a;
    }
  }
  const corner = Math.SQRT2;
  const day = vignetteAlpha(AMBIENCES.day.vignette, corner);
  const overcast = vignetteAlpha(AMBIENCES.overcast.vignette, corner);
  const dusk = vignetteAlpha(AMBIENCES.dusk.vignette, corner);
  assert.ok(day < overcast && overcast < dusk, '낮 < 흐림 < 저녁');
  assert.ok(dusk > 0.95, '저녁 숲 모서리는 거의 검정');
  assert.ok(vignetteAlpha(AMBIENCES.dusk.vignette, 0.35) === 0, '캐릭터 둘레는 넓게 밝음');
});

test('바닥 무늬: 모든 색 번호가 팔레트 안에 있음', () => {
  for (const [mat, variant] of ALL_TEXTURES) {
    for (const v of mat === GROUND.GRASS ? (['r1', 'r2', 'r3'] as const) : [variant]) {
      const tex = groundTexture(mat, v);
      assert.equal(tex.length, TEX_W * TEX_H);
      const spec = paletteFor(mat, v);
      const seen = new Set<number>();
      for (let i = 0; i < tex.length; i++) seen.add(tex[i]!);
      for (const code of seen) {
        const ramp = code >> 4;
        const lvl = code & 15;
        assert.ok(ramp < spec.ramps.length && lvl < spec.ramps[ramp]!.length, `${MATERIALS[mat]!.name}/${v}: 색 번호 ${ramp}:${lvl}`);
      }
      // 같은 재질·분위기면 같은 무늬 (캐시 + 결정적 생성)
      assert.equal(groundTexture(mat, v), tex);
    }
  }
});

test('바닥 조각: 같은 조각은 언제나 같은 픽셀, 이웃 조각과 겹치는 2줄이 똑같음 (이음매 없음)', async () => {
  const { bakeGroundChunk, CHUNK_OUT } = await load('src/client/render/ground.ts');
  const tiles = [
    '..........~~~~',
    '....,,....~~~~',
    '...,,,,.....~~',
    '..,,dddd:::...',
    '...,dIUUd.....',
    '....dUUUd..ff.',
    '....dUUUd..ff.',
    '....dddd...TT.',
    '..ggggg.......',
    '..ggggg...LL..',
    '..==,,,,......',
    '..............',
  ];
  const maps = [mapOf('ground-test', tiles)];
  for (const id of ['town', 'forest']) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamedata/maps', `${id}.json`), 'utf8')) as { tiles: string[]; dark?: boolean };
    maps.push(mapOf(id, m.tiles, !!m.dark));
  }
  const N: number = CHUNK_OUT;
  for (const map of maps) {
    const b = mapWorldBounds(map.tiles[0]!.length, map.tiles.length);
    const r = chunkRange(b.x0, b.y0, b.x1, b.y1);
    // 맵 가운데 쯤 조각 몇 개
    const cx = Math.floor((r.cx0 + r.cx1) / 2);
    const cy = Math.floor((r.cy0 + r.cy1) / 2);
    const a: Uint32Array = bakeGroundChunk(map, cx, cy);
    const right: Uint32Array = bakeGroundChunk(map, cx + 1, cy);
    const below: Uint32Array = bakeGroundChunk(map, cx, cy + 1);
    const again: Uint32Array = bakeGroundChunk(map, cx, cy);
    assert.equal(a.length, N * N);
    assert.deepEqual(again, a, `${map.id}: 같은 조각은 같은 픽셀`);
    let opaque = 0;
    for (let y = 0; y < N; y++) {
      for (let k = 0; k < N - CHUNK; k++) {
        assert.equal(a[y * N + CHUNK + k], right[y * N + k], `${map.id}: 오른쪽 이음매 (y=${y})`);
        assert.equal(a[(CHUNK + k) * N + y], below[k * N + y], `${map.id}: 아래 이음매 (x=${y})`);
      }
      for (let x = 0; x < N; x++) if (a[y * N + x]! >>> 24 === 255) opaque++;
    }
    assert.ok(opaque > N * N * 0.3, `${map.id}: 바닥이 그려짐`);
  }
});
