// 굽기 일꾼과 작업자 점검 (DOM 없이): 급한 일부터 맡기는지, 같은 일을 두 번 굽지 않는지, 오래 요청하지 않은 일을
// 뒤로 미루는지, 맵이 바뀌면 그 전 맵의 바닥 조각 일을 버리는지, 작업자가 죽으면 그 자리에서 굽기로 돌아가는지.
// 작업자가 돌려주는 픽셀이 그 자리에서 굽는 것과 똑같은지도 봅니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers';

// 클라이언트 모듈은 DOM 형식을 쓰므로 서버 tsconfig 의 형식 검사 밖에서 불러옵니다
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

interface Sent {
  t: string;
  id?: number;
  key?: string;
  job?: { kind: string; map?: string };
}

/** 시험용 가짜 작업자: 받은 말을 모아 두고, 시험이 부를 때 답함 */
class FakeWorker {
  static all: FakeWorker[] = [];
  static failOnCreate = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { preventDefault(): void }) => void) | null = null;
  readonly got: Sent[] = [];
  terminated = false;
  constructor(readonly url: unknown) {
    if (FakeWorker.failOnCreate) throw new Error('작업자를 띄울 수 없음');
    FakeWorker.all.push(this);
  }
  postMessage(m: Sent): void {
    this.got.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** 받은 일 열쇠 순서 */
  jobs(): string[] {
    return this.got.filter((m) => m.t === 'job').map((m) => String((m.job as { key?: string }).key ?? JSON.stringify(m.job)));
  }
  /** 마지막으로 받은 일에 그림(가짜 ImageBitmap)으로 답함 */
  reply(): void {
    const job = this.got.filter((m) => m.t === 'job').at(-1)!;
    const bitmap = { width: 1, height: 1, closed: false, close() {} };
    this.onmessage!({ data: { t: 'done', id: job.id, w: 1, h: 1, bitmap } });
  }
}

(globalThis as { Worker?: unknown }).Worker = FakeWorker;

/** 열쇠를 일 안에 실어 두면 어떤 일이 맡겨졌는지 알아보기 쉬움 */
const objJob = (key: string) => ({ kind: 'object', ch: 'T', variant: 0, scale: 1, links: 0, key });

test('굽기 일꾼: 급한 일부터, 같은 열쇠는 한 번만, 다시 요청하지 않은 일은 뒤로 미룬다', async () => {
  const { Baker } = await load('src/client/render/baker.ts');
  FakeWorker.all = [];
  const b = new Baker(() => 'bake-worker.js', 1, 1);
  b.start();
  assert.equal(b.async, true);
  const w = FakeWorker.all[0]!;
  assert.deepEqual(w.got[0], { t: 'warm' }, '띄우자마자 바닥 무늬 미리 만들기');
  const done: string[] = [];
  const req = (key: string, prio: number) => b.request(key, objJob(key), prio, (img: unknown) => img && done.push(key));
  req('a', 5);
  assert.deepEqual(w.jobs(), [], '프레임 끝(flush) 에 맡김');
  b.flush();
  assert.deepEqual(w.jobs(), ['a']);
  req('b', 3);
  req('c', 1);
  req('b', 3);
  b.flush();
  assert.deepEqual(w.jobs(), ['a'], '작업자가 바쁘면 기다림');
  assert.equal(b.has('b'), true);
  w.reply();
  assert.deepEqual(done, ['a']);
  assert.deepEqual(w.jobs(), ['a', 'c'], '우선순위가 작은 c 가 먼저');
  // b 는 그 뒤로 다시 요청하지 않음 (화면 밖으로 나감) → 새로 요청한 d 가 먼저
  for (let i = 0; i < 4; i++) b.tick();
  req('d', 10);
  w.reply();
  assert.deepEqual(w.jobs(), ['a', 'c', 'd'], '오래된 b 보다 지금 요청한 d');
  w.reply();
  assert.deepEqual(w.jobs(), ['a', 'c', 'd', 'b'], '남은 b 는 결국 구움');
  w.reply();
  assert.deepEqual(done, ['a', 'c', 'd', 'b']);
  assert.equal(b.has('b'), false);
  // 이미 맡긴 일은 같은 열쇠로 다시 요청해도 또 맡기지 않음
  req('e', 1);
  b.flush();
  req('e', 0);
  b.flush();
  assert.deepEqual(w.jobs(), ['a', 'c', 'd', 'b', 'e']);
});

test('굽기 일꾼: 작업자마다 일을 몇 개씩 맡겨 두어 프레임 사이에 쉬지 않게 한다', async () => {
  const { Baker } = await load('src/client/render/baker.ts');
  FakeWorker.all = [];
  const b = new Baker(() => 'bake-worker.js', 1, 3);
  b.start();
  const w = FakeWorker.all[0]!;
  for (const [k, prio] of [
    ['p', 4],
    ['q', 2],
    ['r', 9],
    ['s', 1],
    ['t', 3],
  ] as const)
    b.request(k, objJob(k), prio, () => {});
  b.flush();
  assert.deepEqual(w.jobs(), ['s', 'q', 't'], '급한 셋을 한꺼번에');
  w.reply();
  assert.deepEqual(w.jobs(), ['s', 'q', 't', 'p'], '답을 받으면 하나 더');
});

test('굽기 일꾼: 맵이 바뀌면 그 전 맵의 바닥 조각 일을 버리고, 맵 타일은 작업자마다 한 번만 보낸다', async () => {
  const { Baker } = await load('src/client/render/baker.ts');
  FakeWorker.all = [];
  const b = new Baker(() => 'bake-worker.js', 1, 1);
  b.start();
  const w = FakeWorker.all[0]!;
  const map = { id: 'm', dark: false, tiles: ['..', '..'] };
  b.setMap('A', map);
  b.setMap('A', map);
  assert.equal(w.got.filter((m) => m.t === 'map').length, 1);
  const dropped: unknown[] = [];
  const chunk = (mapKey: string, cx: number) => ({ kind: 'chunk', map: mapKey, cx, cy: 0, scale: 1 });
  b.request('A|0', chunk('A', 0), 1, () => {});
  b.flush();
  b.request('A|1', chunk('A', 1), 2, (img: unknown) => dropped.push(img));
  b.request('o', objJob('o'), 3, () => {});
  b.setMap('B', { ...map, id: 'n' });
  assert.deepEqual(dropped, [null], '아직 맡기지 않은 A 조각은 버림 (done(null))');
  assert.equal(b.has('A|0'), true, '이미 맡긴 일은 끝까지');
  assert.equal(b.has('o'), true, '물체 그림은 맵과 상관없음');
  assert.deepEqual(
    w.got.filter((m) => m.t === 'map').map((m) => m.key),
    ['A', 'B'],
  );
});

test('굽기 일꾼: 작업자를 못 띄우거나 작업자가 죽으면 그 자리에서 굽기로 돌아간다', async () => {
  const { Baker } = await load('src/client/render/baker.ts');
  FakeWorker.all = [];
  FakeWorker.failOnCreate = true;
  const b1 = new Baker(() => 'x.js', 1);
  b1.start();
  assert.equal(b1.async, false);
  FakeWorker.failOnCreate = false;
  const b2 = new Baker(() => 'x.js', 1);
  b2.start();
  assert.equal(b2.async, true);
  const got: unknown[] = [];
  b2.request('a', objJob('a'), 1, (img: unknown) => got.push(img));
  b2.request('b', objJob('b'), 2, (img: unknown) => got.push(img));
  const w = FakeWorker.all[0]!;
  let prevented = false;
  w.onerror!({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(b2.async, false);
  assert.equal(w.terminated, true);
  assert.deepEqual(got, [null, null], '남은 일은 그림 없이 끝냄 (요청한 쪽이 다음 프레임에 그 자리에서 구움)');
});

test('굽기 작업자: 바닥 조각·물체·벽을 그 자리에서 굽는 것과 같은 픽셀로 돌려준다', async () => {
  const posted: { msg: { t: string; id: number; w: number; h: number; data?: ArrayBuffer; error?: string } }[] = [];
  (globalThis as { postMessage?: unknown }).postMessage = (msg: never) => posted.push({ msg });
  const ground = await load('src/client/render/ground.ts');
  const { buildObject } = await load('src/client/render/props.ts');
  const { buildWall } = await load('src/client/render/walls.ts');
  await load('src/client/render/bake-worker.ts');
  const onmessage = (globalThis as unknown as { onmessage: (ev: { data: unknown }) => void }).onmessage;
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamedata/maps/forest.json'), 'utf8')) as { id: string; tiles: string[] };
  const map = { id: m.id, dark: false, tiles: m.tiles };
  const key: string = ground.groundKey(map);
  onmessage({ data: { t: 'map', key, map } });
  const last = () => posted.at(-1)!.msg;
  onmessage({ data: { t: 'job', id: 1, job: { kind: 'chunk', map: key, cx: 0, cy: 2, scale: 2 } } });
  assert.equal(last().id, 1);
  const one: Uint32Array = ground.bakeGroundChunk(map, 0, 2);
  const N: number = ground.CHUNK_OUT;
  assert.equal(last().w, N * 2);
  const two = new Uint32Array(last().data!);
  // 배율 2 는 1배 텍셀을 2×2 로 그대로 늘린 것
  for (const [x, y] of [
    [0, 0],
    [17, 5],
    [N - 1, N - 1],
    [120, 200],
  ] as const) {
    const t = one[y * N + x];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      assert.equal(two[(y * 2 + dy) * N * 2 + x * 2 + dx], t, `(${x},${y})`);
  }
  onmessage({ data: { t: 'job', id: 2, job: { kind: 'object', ch: 'E', variant: 2, scale: 2, links: 0 } } });
  const obj = buildObject('E', 2, 2, 0);
  assert.equal(last().id, 2);
  assert.deepEqual([last().w, last().h], [obj.w, obj.h]);
  assert.deepEqual(new Uint8ClampedArray(last().data!), obj.data);
  onmessage({ data: { t: 'job', id: 3, job: { kind: 'wall', ch: 'h', variant: 1, scale: 1, links: 5, sconce: false } } });
  assert.deepEqual(new Uint8ClampedArray(last().data!), buildWall('h', 1, 1, 5, false).data);
  // 받지 못한 맵의 조각은 실패로 알림 (일꾼이 그림 없이 끝냄)
  onmessage({ data: { t: 'job', id: 4, job: { kind: 'chunk', map: 'nope', cx: 0, cy: 0, scale: 1 } } });
  assert.equal(last().t, 'fail');
  assert.equal(last().id, 4);
});

test('굽기 시간: 숲 첫 화면의 바닥 조각과 숲의 벽·물체 그림이 넉넉한 한도 안에 (느려지면 맵에 들어갈 때 오래 가려짐)', async () => {
  const ground = await load('src/client/render/ground.ts');
  const { chunksByDistance, mapWorldBounds } = await load('src/client/render/terrain.ts');
  const { buildObject } = await load('src/client/render/props.ts');
  const { buildWall } = await load('src/client/render/walls.ts');
  const { tileInfo } = await load('src/shared/tiles.ts');
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamedata/maps/forest.json'), 'utf8')) as { id: string; tiles: string[] };
  const map = { id: m.id, dark: false, tiles: m.tiles };
  // 1400×682 화면, 시작 자리 근처 (12, 19)
  const fx = (12 - 19) * 32;
  const fy = (12 + 19) * 16 + 16;
  const vis: [number, number][] = chunksByDistance({ x0: fx - 700, y0: fy - 371, x1: fx + 700, y1: fy + 311 }, mapWorldBounds(m.tiles[0]!.length, m.tiles.length));
  assert.ok(vis.length >= 15, `보이는 조각 ${vis.length}`);
  ground.bakeGroundChunk(map, vis[0]![0], vis[0]![1]); // 무늬·격자 준비는 따로 (작업자는 쉬는 동안 미리 만듦)
  let t0 = performance.now();
  for (const [cx, cy] of vis) ground.bakeGroundChunk(map, cx, cy);
  const chunkMs = performance.now() - t0;
  // 지금 약 8ms × 24조각 ≈ 0.2초. 다섯 배쯤 넉넉하게
  assert.ok(chunkMs < 1000, `숲 첫 화면 바닥 ${chunkMs.toFixed(0)}ms`);
  // 숲이 쓰는 벽·나무·물체 그림 전부 (배율 1, 변형마다 한 번)
  const seen = new Set<string>();
  t0 = performance.now();
  for (const row of m.tiles)
    for (const ch of row) {
      const k = tileInfo(ch).kind;
      if (k !== 'tree' && k !== 'object' && k !== 'wall') continue;
      for (let v = 0; v < 4; v++) {
        if (seen.has(ch + v)) continue;
        seen.add(ch + v);
        if (k === 'wall') buildWall(ch, 1, v, 0, false);
        else buildObject(ch, v, 1, 0);
      }
    }
  const spriteMs = performance.now() - t0;
  assert.ok(seen.size >= 20, `그림 ${seen.size}`);
  assert.ok(spriteMs < 1500, `숲 그림 ${seen.size}개 ${spriteMs.toFixed(0)}ms`);
});
