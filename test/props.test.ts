// 물체·나무·벽 그림 점검 (DOM 없이 픽셀 버퍼만 만들어 봄).
// 모든 모양 x 변형 x 배율이 결정적으로 그려지는지, 변형이 실제로 다른지, 그림 상자에 잘리지 않는지,
// 배율 2 가 배율 1 과 같은 모양을 4배 촘촘히 칠하는지, 벽 캔버스 규칙(크기, 낮은 담의 빈 윗부분)과
// 켈트 매듭 띠가 타일 경계에서 이어지는지 확인합니다.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { TILESET } from '../src/shared/tiles';
import { ROOT } from './helpers';

// 클라이언트 그림 모듈은 DOM 형식을 쓰므로 서버 tsconfig 의 형식 검사 밖에서 불러옵니다
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

interface PixLike {
  w: number;
  h: number;
  s: number;
  box: { left: number; top: number; w: number; h: number };
  data: Uint8ClampedArray;
  coverage(): number;
  bounds(): [number, number, number, number];
  alpha(i: number, j: number): number;
}

/** 버퍼 가장자리(맨 바깥 줄)에 칠해진 점이 있으면 그 자리 — 그림자·빛 무리까지 상자 안에 들어와야 함 */
function touchesBorder(p: PixLike): string | null {
  for (let i = 0; i < p.w; i++) {
    if (p.alpha(i, 0) > 0) return `위 ${i}`;
    if (p.alpha(i, p.h - 1) > 0) return `아래 ${i}`;
  }
  for (let j = 0; j < p.h; j++) {
    if (p.alpha(0, j) > 0) return `왼쪽 ${j}`;
    if (p.alpha(p.w - 1, j) > 0) return `오른쪽 ${j}`;
  }
  return null;
}

/** 버퍼 내용의 짧은 지문 (FNV-1a) */
function digest(p: PixLike): string {
  let h = 0x811c9dc5;
  const d = p.data;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return `${p.w}x${p.h}:${(h >>> 0).toString(16)}`;
}

const OBJECT_CHARS = Object.entries(TILESET)
  .filter(([, t]) => (t.kind === 'object' || t.kind === 'tree') && t.shape)
  .map(([ch]) => ch);
const WALL_CHARS = Object.entries(TILESET)
  .filter(([, t]) => t.kind === 'wall')
  .map(([ch]) => ch);

test('물체·나무: 모든 모양과 변형을 결정적으로, 상자 안에, 서로 다르게 그린다', async () => {
  const { buildObject, VARIANTS } = await load('src/client/render/props.ts');
  assert.ok(OBJECT_CHARS.length >= 24, '물체 문자 목록');
  for (const ch of OBJECT_CHARS) {
    const prints = new Set<string>();
    for (let v = 0; v < VARIANTS; v++) {
      const a: PixLike | null = buildObject(ch, v, 1);
      assert.ok(a, `${ch}: 그림이 없음`);
      const b: PixLike = buildObject(ch, v, 1);
      assert.equal(digest(a), digest(b), `${ch} v${v}: 같은 입력인데 그림이 다름`);
      const cov = a.coverage();
      assert.ok(cov > 150, `${ch} v${v}: 거의 비어 있음 (${cov})`);
      // 그림(그림자·빛 무리 포함)이 상자 가장자리에 닿으면 잘린 것
      for (const s of [1, 2]) {
        const edge = touchesBorder(s === 1 ? a : buildObject(ch, v, s));
        assert.equal(edge, null, `${ch} v${v} 배율 ${s}: 상자 [${a.box.left},${a.box.top},${a.box.w},${a.box.h}] 의 ${edge} 에서 잘림`);
      }
      // 발 위치(0,0) 둘레에 서 있어야 함: 밑동이 발 근처까지 내려옴
      const btm = a.bounds()[3];
      assert.ok(btm > -2 && btm < 24, `${ch} v${v}: 발 위치에서 떨어져 있음 (아래 끝 ${btm})`);
      prints.add(digest(a));
    }
    assert.ok(prints.size >= 3, `${ch}: 변형이 ${prints.size}가지뿐 (3가지 이상이어야 함)`);
  }
});

test('물체·나무: 배율 2 는 같은 모양을 장치 픽셀 4배로 칠한다 (dpr 2 에서 또렷함)', async () => {
  const { buildObject } = await load('src/client/render/props.ts');
  for (const ch of OBJECT_CHARS) {
    const a: PixLike = buildObject(ch, 1, 1);
    const b: PixLike = buildObject(ch, 1, 2);
    assert.equal(b.w, a.w * 2);
    assert.equal(b.h, a.h * 2);
    const ratio = b.coverage() / a.coverage();
    assert.ok(ratio > 3.3 && ratio < 4.8, `${ch}: 배율 2 칠한 넓이 비 ${ratio.toFixed(2)}`);
    // CSS 범위도 거의 같음
    const [l1, t1, r1, b1] = a.bounds();
    const [l2, t2, r2, b2] = b.bounds();
    for (const [x, y] of [
      [l1, l2],
      [t1, t2],
      [r1, r2],
      [b1, b2],
    ] as const)
      assert.ok(Math.abs(x - y) <= 1.5, `${ch}: 배율에 따라 모양 범위가 다름`);
  }
});

test('울타리: 이웃 방향으로 밧줄을 잇고, 이웃이 없으면 말뚝만', async () => {
  const { buildObject } = await load('src/client/render/props.ts');
  const lone: PixLike = buildObject('F', 0, 1, 0);
  const line: PixLike = buildObject('F', 0, 1, 1 | 4);
  const corner: PixLike = buildObject('F', 0, 1, 1 | 2);
  assert.ok(line.coverage() > lone.coverage() + 40, '밧줄이 그려지지 않음');
  assert.notEqual(digest(line), digest(corner));
  // x+1 쪽 밧줄은 오른쪽 아래로 뻗음
  const [, , rLone] = lone.bounds();
  const [, , rLine] = line.bounds();
  assert.ok(rLine > rLone + 8, '오른쪽 아래 이웃 쪽으로 밧줄이 없음');
  for (const links of [5, 10, 15]) assert.equal(touchesBorder(buildObject('F', 2, 2, links)), null, `울타리 이웃 ${links}: 상자에 잘림`);
  // 다른 물체는 이웃 비트를 무시
  assert.equal(digest(buildObject('C', 0, 1, 0)), digest(buildObject('C', 0, 1, 15)));
});

test('벽: 캔버스 크기 규칙, 낮은 담의 빈 윗부분, 가려진 면 생략', async () => {
  const { buildWall, LOW_WALL_H } = await load('src/client/render/walls.ts');
  const { WALL_H } = await load('src/client/render/iso.ts');
  for (const ch of WALL_CHARS) {
    for (const s of [1, 2]) {
      const p: PixLike = buildWall(ch, s, 1, 0, false);
      assert.equal(p.w, 64 * s, `${ch}: 폭`);
      assert.equal(p.h, (32 + WALL_H) * s, `${ch}: 높이`);
      assert.equal(digest(p), digest(buildWall(ch, s, 1, 0, false)), `${ch}: 결정적이지 않음`);
      const low = !!TILESET[ch]!.low;
      const T0 = low ? WALL_H - LOW_WALL_H : 0;
      // 윗면 가운데는 칠해짐
      assert.equal(p.alpha(32 * s, (T0 + 16) * s), 255, `${ch}: 윗면이 비어 있음`);
      // 낮은 담: 윗면 위쪽은 투명
      if (low) {
        for (let j = 0; j < T0 * s; j++) for (let i = 0; i < p.w; i++) assert.equal(p.alpha(i, j), 0, `${ch}: 낮은 담 윗부분이 칠해짐`);
      }
      // 왼쪽 면 가운데 (x 16, 면 위에서 hgt/2 아래)
      const hgt = WALL_H - T0;
      const lx = 16 * s;
      const ly = Math.round((T0 + 16 + 8 + hgt / 2) * s);
      assert.equal(p.alpha(lx, ly), 255, `${ch}: 왼쪽 면이 비어 있음`);
      // y+1 이웃이 있으면 왼쪽 면을 그리지 않음
      const hidden: PixLike = buildWall(ch, s, 1, 2, false);
      assert.equal(hidden.alpha(lx, ly), 0, `${ch}: 가려진 왼쪽 면을 그림`);
    }
  }
  // 변형마다 돌 무늬가 다름
  for (const ch of WALL_CHARS) {
    const prints = new Set([0, 1, 2, 3].map((v) => digest(buildWall(ch, 1, v, 0, false))));
    assert.ok(prints.size >= 3, `${ch}: 벽 변형이 ${prints.size}가지뿐`);
  }
});

test('낮은 돌담 매듭 띠: 무늬가 타일 경계(u=0, 32)에서 끊김 없이 이어진다', async () => {
  const { knotAt } = await load('src/client/render/walls.ts');
  const kinds = new Set<number>();
  for (let v = 0; v < 12; v += 0.25) {
    assert.deepEqual(knotAt(0, v), knotAt(32, v), `v=${v}`);
    assert.deepEqual(knotAt(0.5, v), knotAt(32.5, v), `v=${v}`);
    for (let u = 0; u < 32; u += 0.5) kinds.add(knotAt(u, v)[0]);
  }
  assert.deepEqual([...kinds].sort(), [0, 1, 2], '바탕·가닥·홈이 모두 있어야 함');
});

test('그림 만드는 시간 예산: 프레임 시각을 주지 않으면 언제나 바로 만든다', async () => {
  const { buildAllowed } = await load('src/client/render/pixel.ts');
  assert.equal(buildAllowed(), true);
  assert.equal(buildAllowed(undefined), true);
  // 새 프레임 시각이면 예산이 다시 채워짐
  assert.equal(buildAllowed(1), true);
  assert.equal(buildAllowed(2), true);
});
