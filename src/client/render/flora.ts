// 나무와 덤불 그림 (R3 양식): 가는 갈색 줄기 위에 아래로 처진 잎 송이(tuft)를 층층이 겹쳐 쌓습니다.
// 잎 송이는 윗면이 왼쪽 위 빛을 받아 연두색으로 밝고, 아래로 갈수록 어두워지며 끝이 뾰족하게 처집니다.
// 위층 송이의 어두운 잎끝 위로 아래층 송이의 밝은 윗면이 겹쳐서 원작처럼 "밝음→어두움"이 반복되는 결이 생깁니다.
import { hash2 } from './iso';
import { Pix, blob, grain, groundShadow, ramp, rgb, rod, stamp, tone, type RGB, type Ramp } from './pixel';

// ───────────────────────── 색 ─────────────────────────

// R3 나무: 바탕 #2f6a22, 빛 받는 쪽 #7cb848, 어두운 안쪽 #1a3e14
export const LEAF = ramp('#0d2408', '#14320f', '#1a3e14', '#24521a', '#2f6a22', '#3f8029', '#58993a', '#7cb848', '#a6d468');
// 활엽수(버드나무 꼴)는 조금 더 노란빛
const ELM = ramp('#0c2207', '#132f0d', '#1b4113', '#26561a', '#336c22', '#46852b', '#63a038', '#86bc4a', '#b2da6e');
const BUSH = ramp('#0c2408', '#15340f', '#1c4514', '#275b1b', '#337223', '#478a2c', '#62a438', '#88c04c', '#b0da6c');
// R3 줄기: #5a3a1e
export const TRUNK = ramp('#1e1208', '#2e1c0e', '#3e2815', '#4e331b', '#5a3a1e', '#6e4a28', '#86603a', '#a07a4c');
const PINE = ramp('#06160c', '#0d2616', '#133320', '#1b4429', '#255634', '#326a3f', '#4a844f', '#6aa064');
const PINE_BARK = ramp('#160e08', '#2a1b10', '#3a2616', '#4a321e', '#5e4228', '#765636');
const DEAD = ramp('#15110d', '#231d18', '#2e2721', '#3a332c', '#4d453c', '#655b50', '#7f7366', '#9a8f80');
const BERRY: readonly RGB[] = [rgb('#7a1414'), rgb('#c82828'), rgb('#ff8a7a')];
const BLOSSOM: readonly RGB[] = [rgb('#a89cc0'), rgb('#f0ecff'), rgb('#fff6c0')];

type Rnd = () => number;

/** 나무껍질: 원기둥 명암 + 세로 결 */
export function barkFn(pal: Ramp, seed: number) {
  return (v: number, _t: number, _k: number, ix: number, iy: number): RGB =>
    tone(pal, v + (hash2(ix, Math.floor(iy / 3 + hash2(ix, 0, seed) * 3), seed) - 0.5) * 0.3, ix, iy, 0.6);
}

// ───────────────────────── 잎 송이 ─────────────────────────

export interface Tuft {
  /** 송이 가운데 (발 기준 CSS px) */
  x: number;
  y: number;
  /** 반폭과 윗둥근 높이 */
  rw: number;
  rh: number;
  /** 아래로 처지는 잎끝 길이 */
  fringe: number;
  /** 밝기 보정 (왕관 안 위치에 따른 빛) */
  lit: number;
}

/**
 * 잎 송이 하나: 폭 약 2.5px 의 잎이 나란히 매달린 둥근 지붕 꼴.
 * 윗선은 잎마다 조금씩 들쭉날쭉하고, 아랫선은 잎끝이 뾰족하게 처집니다.
 */
export function paintTuft(l: Pix, t: Tuft, pal: Ramp, seed: number, id: number, leafW = 2.5): void {
  const phase = hash2(id, 1, seed);
  const tilt = (hash2(id, 2, seed) - 0.5) * 0.5;
  const lw = leafW * (0.85 + 0.3 * hash2(id, 3, seed));
  l.paint(t.x - t.rw - 2, t.y - t.rh - 2, t.x + t.rw + 2, t.y + t.rh * 0.3 + t.fringe + 1, (x, y, ix, iy) => {
    const dx0 = (x - t.x) / t.rw;
    // 잎은 아래로 갈수록 바깥쪽으로 벌어집니다 (가운데에서 양옆으로 처짐)
    const down = Math.max(0, y - t.y);
    const xs = x - dx0 * down * 0.35;
    const dx = (xs - t.x) / t.rw;
    if (dx <= -1 || dx >= 1) return null;
    const lx = (xs - t.x) / lw + phase;
    const k = Math.floor(lx);
    const f = lx - k;
    const hk = hash2(k, id, seed);
    const arc = Math.sqrt(1 - dx * dx);
    // 윗선: 둥근 지붕, 잎마다 높이가 조금 다르고 잎 끝이 둥급니다
    const top = t.y - t.rh * arc * (0.82 + 0.3 * hk) + Math.abs(f - 0.5) * 1.3;
    // 아랫선: 잎끝이 아래로 뾰족하게 처짐 (가장자리 잎은 짧게, 잎마다 길이가 다름)
    const len = t.fringe * (0.3 + 0.7 * hash2(k, id + 7, seed)) * (1 - 0.4 * Math.abs(dx));
    const point = Math.pow(1 - Math.abs(2 * f - 1), 1.2);
    const bot = t.y + t.rh * 0.25 * arc + tilt * dx * 2 + len * point;
    if (y < top || y > bot) return null;
    const q = (y - top) / Math.max(1.5, bot - top);
    let v = 0.98 - 0.78 * Math.pow(q, 0.9) + t.lit - 0.16 * dx;
    // 잎의 왼쪽 가장자리는 밝고 오른쪽은 어둡게 (잎 한 장 한 장이 보이게)
    v += (0.5 - f) * 0.16;
    // 잎 결 (세로 줄)
    v += (hash2(ix, Math.floor((y - top) / 2), seed + k) - 0.5) * 0.22;
    // 잎 사이 어두운 틈
    if (q > 0.4 && (f < 0.14 || f > 0.86)) v -= 0.3;
    return tone(pal, v, ix, iy, 0.7);
  });
}

/** 송이들 아래에 깔리는 어두운 잎 그늘: 이웃 송이 사이 틈이 비쳐 보이지 않게 (송이 윤곽 밖으로는 나가지 않음) */
function tuftShade(l: Pix, tufts: readonly Tuft[], pal: Ramp, seed: number): void {
  for (const t of tufts) {
    const ry = (t.rh + t.fringe) * 0.62;
    const cy = t.y + t.fringe * 0.25;
    l.paint(t.x - t.rw, cy - ry, t.x + t.rw, cy + ry, (x, y, ix, iy) => {
      const dx = (x - t.x) / (t.rw * 0.92);
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) return null;
      return tone(pal, 0.08 + grain(ix, iy, seed) * 0.24 + (hash2(ix >> 1, iy >> 1, seed + 5) < 0.1 ? 0.16 : 0), ix, iy, 0.6);
    });
  }
}

/** 잎 덩어리: 송이들이 모인 둥근 덩어리 하나 (가운데와 반지름, 발 기준 CSS px) */
export interface Clump {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/**
 * 덩어리 안에 송이를 줄지어 배치: 위에서 아래로 (아래 송이가 위 송이를 덮음).
 * 줄마다 반씩 어긋나고 크기·자리가 들쭉날쭉하며, 가장자리에는 가끔 송이가 비거나 삐져나옵니다.
 * 밝기는 덩어리 안의 위치(왼쪽 위 밝음, 오른쪽 아래 어두움)와 나무 전체에서의 위치를 함께 봅니다.
 */
function clumpTufts(rnd: Rnd, c: Clump, crownX: number, crownRx: number, size: [number, number], fringe: [number, number], step: number): Tuft[] {
  const list: Tuft[] = [];
  const top = c.y - c.ry + size[0] * 0.5;
  const bottom = c.y + c.ry - size[0] * 0.3;
  let row = 0;
  for (let y = top; y <= bottom + 0.01; y += step * (0.8 + rnd() * 0.4), row++) {
    const d = (y - c.y) / c.ry;
    const w = c.rx * Math.sqrt(Math.max(0.04, 1 - d * d));
    const rw0 = size[0] + rnd() * (size[1] - size[0]);
    const n = Math.max(1, Math.round((2 * w) / (rw0 * 1.25)));
    const gap = (2 * w) / n;
    for (let i = 0; i < n; i++) {
      const edge = i === 0 || i === n - 1;
      // 가장자리 송이는 가끔 빼서 윤곽이 들쭉날쭉하게
      if (edge && n > 2 && rnd() < 0.18) continue;
      const rw = (size[0] + rnd() * (size[1] - size[0])) * (y < top + step ? 0.85 : 1);
      let x = c.x - w + gap * (i + 0.5) + (rnd() - 0.5) * gap * 0.5 + (row % 2 ? gap * 0.22 : -gap * 0.22);
      // 가끔 바깥으로 삐져나온 송이
      if (edge && rnd() < 0.3) x += (i === 0 ? -1 : 1) * rw * 0.45;
      const yy = y + (rnd() - 0.5) * step * 0.6;
      // 덩어리 안: 왼쪽 위는 밝게, 오른쪽 아래는 어둡게 + 나무 전체에서 오른쪽은 조금 더 어둡게
      const lit = -0.2 * ((x - c.x) / (c.rx + rw)) - 0.24 * ((yy - c.y) / c.ry) - 0.08 * ((x - crownX) / crownRx) + (rnd() - 0.5) * 0.1;
      list.push({ x, y: yy, rw, rh: rw * (0.66 + rnd() * 0.2), fringe: fringe[0] + rnd() * (fringe[1] - fringe[0]), lit });
    }
  }
  list.sort((p, q) => p.y - q.y);
  return list;
}

/**
 * 잎 덩어리 2~4개로 된 왕관: 위(뒤) 덩어리부터 그늘 → 송이 순서로 칠해서
 * 아래 덩어리의 밝은 윗면이 위 덩어리의 어두운 아랫면을 덮습니다. branches 는 첫 덩어리 그늘 뒤에 그리는 가지.
 */
function paintCrown(l: Pix, rnd: Rnd, clumps: Clump[], pal: Ramp, seed: number, size: [number, number], fringe: [number, number], step: number, leafW: number, branches: () => void): void {
  const crownX = clumps.reduce((a, c) => a + c.x, 0) / clumps.length;
  const crownRx = Math.max(...clumps.map((c) => Math.abs(c.x - crownX) + c.rx));
  const order = [...clumps].sort((a, b) => a.y + a.ry - (b.y + b.ry));
  let id = 0;
  order.forEach((c, k) => {
    const tufts = clumpTufts(rnd, c, crownX, crownRx, size, fringe, step);
    tuftShade(l, tufts, pal, seed);
    if (k === 0) branches();
    for (const t of tufts) paintTuft(l, t, pal, seed, id++, leafW);
  });
}

// ───────────────────────── 활엽수 T / E ─────────────────────────

/**
 * 나무 T: 가는 줄기 위에 잎 덩어리 3~4개가 겹친 둥근 왕관.
 * 변형 0 둥근 왕관, 1 넓고 낮은 왕관, 2 위가 두 갈래인 왕관, 3 가지가 드러난 넓게 퍼진 나무 (R3 앞쪽 나무)
 */
export function oakTree(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  if (variant === 3) {
    spreadTree(p, rnd, seed);
    return;
  }
  groundShadow(p, 8, 2, 30, 11, 0.3);
  const lean = (rnd() - 0.5) * 6;
  const CRx = variant === 1 ? 36 + rnd() * 3 : 31 + rnd() * 3;
  const CRy = variant === 1 ? 29 + rnd() * 3 : 33 + rnd() * 3;
  const trunkVis = variant === 1 ? 24 : 27 + rnd() * 4;
  const cx = lean;
  const cy = -trunkVis - CRy;
  const bark = p.layer();
  const fn = barkFn(TRUNK, seed);
  // 줄기와 뿌리
  rod(bark, 0, 0, 3.4, lean * 0.6, cy + CRy * 0.2, 2.3, fn);
  for (const side of [-1, 1]) rod(bark, side * 1.2, -2.5, 1.7, side * (5 + rnd() * 2), 1, 0.8, fn);
  stamp(p, bark, TRUNK);
  const j = () => (rnd() - 0.5) * 5;
  // 덩어리 자리 (왕관 반지름 비율): [x, y, rx, ry]
  const layout: [number, number, number, number][] =
    variant === 1
      ? [
          [-0.5, -0.05, 0.5, 0.55],
          [0.05, -0.5, 0.55, 0.5],
          [0.52, -0.1, 0.5, 0.55],
          [0, 0.45, 0.75, 0.5],
        ]
      : variant === 2
        ? [
            [-0.4, -0.45, 0.58, 0.55],
            [0.42, -0.55, 0.55, 0.5],
            [0.02, 0.35, 0.78, 0.6],
          ]
        : [
            [0.05, -0.52, 0.6, 0.48],
            [-0.45, 0.0, 0.58, 0.5],
            [0.42, -0.08, 0.6, 0.5],
            [0.05, 0.48, 0.72, 0.45],
          ];
  const clumps = layout.map(([x, y, rx, ry]) => ({ x: cx + x * CRx + j(), y: cy + y * CRy + j() * 0.6, rx: rx * CRx * (0.95 + rnd() * 0.12), ry: ry * CRy * (0.95 + rnd() * 0.12) }));
  const crown = p.layer();
  paintCrown(crown, rnd, clumps, LEAF, seed, [6, 9.5], [3, 6.5], 6.4, 2.5, () => {
    // 왕관 속 가지 (송이 틈으로 조금 보임): 줄기 끝에서 덩어리마다
    for (const c of clumps) rod(crown, lean * 0.6, cy + CRy * 0.35, 1.8, c.x, c.y, 0.9, fn);
  });
  stamp(p, crown, LEAF);
}

/** 넓게 퍼진 나무: 짧은 줄기에서 가지가 사방으로 뻗고, 가지 끝마다 큰 잎 송이 (사이로 가지가 보임) */
function spreadTree(p: Pix, rnd: Rnd, seed: number): void {
  groundShadow(p, 6, 2, 38, 13, 0.3);
  const wood = p.layer();
  const fn = barkFn(TRUNK, seed);
  const forkY = -15 - rnd() * 3;
  rod(wood, 0, 0, 3.6, 0.5, forkY, 3, fn);
  for (const side of [-1, 1]) rod(wood, side * 1.2, -2.5, 1.8, side * (5.5 + rnd() * 2), 1, 0.8, fn);
  const tips: [number, number][] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = -1.25 + (i / (n - 1)) * 2.5 + (rnd() - 0.5) * 0.25;
    const len = 26 + rnd() * 10 - Math.abs(a) * 3;
    const ex = Math.sin(a) * len * 1.25;
    const ey = forkY - Math.cos(a) * len * 0.75 - 6;
    const mx = Math.sin(a) * len * 0.55;
    const my = forkY - Math.cos(a) * len * 0.45 - 2;
    rod(wood, 0.5, forkY, 2.6, mx, my, 1.9, fn);
    rod(wood, mx, my, 1.9, ex, ey, 1.2, fn);
    tips.push([ex, ey], [mx * 0.9, my - 3]);
  }
  stamp(p, wood, TRUNK);
  const crown = p.layer();
  const tufts: Tuft[] = [];
  for (const [x, y] of tips) {
    const big = Math.abs(x) > 14;
    for (let k = 0; k < (big ? 3 : 2); k++) {
      const rw = (big ? 8.5 : 7) + rnd() * 2;
      const tx = x + (rnd() - 0.5) * 9;
      const ty = y - 3 + k * 4.5 + (rnd() - 0.5) * 2;
      tufts.push({ x: tx, y: ty, rw, rh: rw * 0.68, fringe: 3.5 + rnd() * 2.5, lit: -0.12 * (tx / 40) - 0.08 * ((ty + 40) / 20) + (rnd() - 0.5) * 0.08 });
    }
  }
  tufts.sort((a, b) => a.y - b.y);
  tuftShade(crown, tufts, LEAF, seed);
  tufts.forEach((t, i) => paintTuft(crown, t, LEAF, seed, i));
  stamp(p, crown, LEAF);
}

/**
 * 활엽수 E (R3 의 버드나무 꼴): 더 가늘고 키가 큰 왕관 (약 3칸). 잎끝이 길게 처진 작은 송이로 된
 * 덩어리 3~4개가 위아래로 겹치며 조금씩 좌우로 어긋납니다.
 */
export function elmTree(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 6, 2, 24, 9, 0.3);
  const lean = (rnd() - 0.5) * 7 + (variant === 2 ? 3 : 0);
  const CRx = 23 + rnd() * 3 + (variant === 1 ? 3 : 0);
  const CRy = 43 + rnd() * 5 - (variant === 3 ? 5 : 0);
  const trunkVis = 24 + rnd() * 5;
  const top = -trunkVis - CRy * 2;
  const bottom = -trunkVis;
  const cx = lean;
  const bark = p.layer();
  const fn = barkFn(TRUNK, seed);
  rod(bark, 0, 0, 2.9, lean * 0.7, bottom - 12, 1.9, fn);
  for (const side of [-1, 1]) rod(bark, side * 1, -2.5, 1.5, side * (4.5 + rnd() * 2), 1, 0.7, fn);
  stamp(p, bark, TRUNK);
  // 덩어리: 위는 작고 가운데가 가장 넓으며, 번갈아 좌우로 어긋남
  const n = variant === 3 ? 3 : 4;
  const Hc = bottom - top;
  const side0 = variant % 2 ? 1 : -1;
  const clumps: Clump[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    clumps.push({
      x: cx * (1 - f * 0.5) + (i % 2 ? side0 : -side0) * (2.5 + rnd() * 2.5),
      y: top + Hc * f + (rnd() - 0.5) * 3,
      rx: CRx * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, f + 0.12))) * (0.95 + rnd() * 0.1),
      ry: (Hc / n) * (0.72 + rnd() * 0.12),
    });
  }
  const crown = p.layer();
  paintCrown(crown, rnd, clumps, ELM, seed, [5, 8], [4, 8], 6, 2.2, () => {
    for (const c of clumps) rod(crown, lean * 0.7, bottom - 10, 1.5, c.x, c.y, 0.8, fn);
  });
  stamp(p, crown, ELM);
}

// ───────────────────────── 전나무·고목 ─────────────────────────

/** 전나무 P: 짙은 녹색의 톱니진 층이 겹겹이 쌓인 모양 */
export function pineTree(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 5, 2, 22, 8);
  const bark = p.layer();
  rod(bark, 0, 0, 2.7, 0, -16, 2.0, barkFn(PINE_BARK, seed));
  stamp(p, bark, PINE_BARK);
  const tiers = variant === 3 ? 4 : 5;
  const H = 96 + rnd() * 12 - (tiers === 4 ? 8 : 0);
  const lean = (rnd() - 0.5) * 3;
  const step = (H - 30) / tiers;
  const w0 = 22 + rnd() * 3;
  const edgeOf = (t: number, x: number) => {
    const yb = -8 - t * step;
    const hw = w0 * (1 - t / (tiers + 0.7));
    const ax = lean * (t / tiers);
    const q = (x - ax) / hw;
    const tooth = Math.abs((((x - ax) / 3.6 + t * 0.37 + 100) % 2) - 1);
    return yb - 0.32 * hw * q * q + tooth * 2.8;
  };
  for (let t = 0; t < tiers; t++) {
    const yb = -8 - t * step;
    const apex = t === tiers - 1 ? -H : yb - step * 2.1;
    const hw = w0 * (1 - t / (tiers + 0.7));
    const ax = lean * (t / tiers);
    const l = p.layer();
    l.paint(ax - hw - 2, apex - 1, ax + hw + 2, yb + 4, (x, y, ix, iy) => {
      const q = (y - apex) / (yb - apex);
      if (q < 0) return null;
      const half = hw * Math.pow(Math.min(1, q), 0.8) + Math.sin(y * 1.7 + t) * 0.8;
      const dx = x - ax;
      if (Math.abs(dx) > half || y > edgeOf(t, x)) return null;
      const nx = dx / Math.max(1, half);
      let v = 0.58 - 0.3 * nx + 0.12 * (q - 0.5);
      // 위층이 드리운 그늘
      if (t < tiers - 1) {
        const dd = y - edgeOf(t + 1, x);
        if (dd > -2 && dd < 7) v -= 0.32 * (1 - Math.max(0, dd) / 7);
      }
      // 가지 결: 줄기에서 바깥 아래로 뻗는 바늘잎 줄
      const band = Math.floor((y - 0.55 * Math.abs(dx)) / 2.2);
      v += (hash2(band, Math.floor(dx / 3.5), seed + t) - 0.5) * 0.34;
      v += grain(ix, iy, seed) * 0.12;
      // 가지 끝은 조금 밝게
      if (edgeOf(t, x) - y < 2.2 && nx < 0.3) v += 0.12;
      return tone(PINE, v, ix, iy, 0.6);
    });
    stamp(p, l, PINE);
  }
}

/** 고목 Y: 잎 없이 비틀린 회갈색 줄기와 가지 */
export function deadTree(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 1, 17, 6, 0.3);
  const wood = p.layer();
  const fn = barkFn(DEAD, seed);
  const grow = (x: number, y: number, ang: number, len: number, r: number, depth: number): void => {
    // 한 마디를 두 번 꺾어 비틀린 느낌
    const bend = (rnd() - 0.5) * 0.5;
    const mx = x + Math.sin(ang + bend) * len * 0.5;
    const my = y - Math.cos(ang + bend) * len * 0.5;
    const x2 = mx + Math.sin(ang - bend * 0.6) * len * 0.5;
    const y2 = my - Math.cos(ang - bend * 0.6) * len * 0.5;
    const rm = r * 0.84;
    rod(wood, x, y, r, mx, my, rm, fn);
    rod(wood, mx, my, rm, x2, y2, r * 0.68, fn);
    if (depth === 0 || r < 0.9) return;
    const kids = depth >= 3 ? 2 : rnd() < 0.7 ? 2 : 1;
    for (let k = 0; k < kids; k++) {
      const spread = 0.38 + rnd() * 0.42;
      const dir = kids === 1 ? (rnd() < 0.5 ? -1 : 1) : k === 0 ? -1 : 1;
      grow(x2, y2, ang + dir * spread + (rnd() - 0.5) * 0.2, len * (0.58 + rnd() * 0.2), r * 0.62, depth - 1);
    }
    // 부러진 짧은 가지
    if (depth >= 2 && rnd() < 0.5) {
      const a = ang + (rnd() < 0.5 ? -1 : 1) * (1 + rnd() * 0.4);
      rod(wood, mx, my, r * 0.45, mx + Math.sin(a) * len * 0.28, my - Math.cos(a) * len * 0.28, r * 0.3, fn);
    }
  };
  const trunkLen = variant === 3 ? 26 + rnd() * 4 : 30 + rnd() * 8;
  grow(0, 0, (rnd() - 0.5) * 0.18, trunkLen, 4.2, variant === 3 ? 3 : 4);
  for (const side of [-1, 1]) rod(wood, side * 1.5, -4, 2.2, side * (6 + rnd() * 3), 1.5, 0.9, fn);
  // 옹이 구멍
  if (variant === 1) blob(wood, -0.5, -14, 1.3, 2, () => DEAD[1]!);
  stamp(p, wood, DEAD);
}

// ───────────────────────── 덤불 ─────────────────────────

/** 덤불 B: 잎 송이가 둥글게 쌓인 낮은 덤불 (1: 빨간 열매, 2: 흰 꽃, 3: 고사리처럼 뾰족한 잎) */
export function bush(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 2, 21, 7, 0.32);
  if (variant === 3) {
    fern(p, rnd, seed);
    return;
  }
  const l = p.layer();
  const W = 16 + rnd() * 3;
  const top = -27 - rnd() * 4;
  const bottom = -7;
  // 덩어리 셋: 왼쪽 아래, 오른쪽 아래, 가운데 위
  const clumps: Clump[] = [
    { x: -W * 0.45, y: -10 - rnd() * 2, rx: W * 0.6, ry: 7.5 },
    { x: W * 0.45, y: -9 - rnd() * 2, rx: W * 0.58, ry: 7.5 },
    { x: (rnd() - 0.5) * 4, y: top + 12, rx: W * 0.62, ry: 8.5 },
  ];
  paintCrown(l, rnd, clumps, BUSH, seed, [5, 7], [2.5, 4.5], 5.6, 2.5, () => {});
  // 열매나 꽃
  if (variant === 1 || variant === 2) {
    const c = variant === 1 ? BERRY : BLOSSOM;
    for (let i = 0; i < 7; i++) {
      const x = Math.round(-W + 3 + rnd() * (W * 2 - 6));
      const y = Math.round(top + 5 + rnd() * (bottom - top - 6));
      l.paint(x, y, x + 2, y + 2, (_x, _y, ix, iy) => (ix === x && iy === y ? c[2]! : ix === x + 1 && iy === y + 1 ? c[0]! : c[1]!));
    }
  }
  stamp(p, l, BUSH);
}

/** 고사리 덤불: 가운데서 부채꼴로 뻗은 뾰족한 잎줄기 */
function fern(p: Pix, rnd: Rnd, seed: number): void {
  const l = p.layer();
  const fronds = 11;
  const list: { a: number; len: number }[] = [];
  for (let i = 0; i < fronds; i++) list.push({ a: -1.3 + (i / (fronds - 1)) * 2.6 + (rnd() - 0.5) * 0.18, len: 16 + rnd() * 8 - Math.abs(i - fronds / 2) * 0.4 });
  // 뒤쪽(가운데 위로 선 것)부터
  list.sort((a, b) => Math.abs(a.a) - Math.abs(b.a));
  for (const f of list.reverse()) {
    const bx = Math.sin(f.a) * 2;
    const tipX = bx + Math.sin(f.a) * f.len;
    const tipY = -3 - Math.cos(f.a) * f.len * 0.85;
    const steps = 10;
    // 잎줄기는 바깥으로 휘어 처집니다
    const px = (u: number) => bx + (tipX - bx) * u;
    const py = (u: number) => -3 + (tipY + 3) * u + Math.sin(u * Math.PI) * -2.5 + u * u * Math.abs(f.a) * 6;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = (k + 1) / steps;
      const w = 3.4 * Math.sin((1 - t) * Math.PI * 0.5 + 0.2) * (1 - t * 0.6);
      // 작은 잎 (톱니)
      for (const sd of [-1, 1]) {
        const ang = Math.atan2(py(t2) - py(t), px(t2) - px(t));
        const lx = px(t) + Math.cos(ang + sd * 1.1) * w;
        const ly = py(t) + Math.sin(ang + sd * 1.1) * w;
        rod(l, px(t), py(t), 1.0, lx, ly, 0.55, (v, _t, _k, ix, iy) => tone(BUSH, v + (sd < 0 ? 0.1 : -0.08) + t * 0.12 + grain(ix, iy, seed) * 0.2, ix, iy, 0.6));
      }
      rod(l, px(t), py(t), 0.9, px(t2), py(t2), 0.7, (v, _t, _k, ix, iy) => tone(BUSH, v - 0.15, ix, iy, 0.5));
    }
  }
  stamp(p, l, BUSH);
}

/** 그루터기나 바위 밑에 돋은 풀 포기 몇 개 */
export function grassTufts(p: Pix, rnd: Rnd, seed: number, spots: readonly [number, number][]): void {
  const l = p.layer();
  for (const [x0, y0] of spots) {
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const bx = x0 + (i - n / 2) * 1.6 + (rnd() - 0.5);
      const h = 3.5 + rnd() * 4;
      const lean = (rnd() - 0.5) * 3 + (i - n / 2) * 0.6;
      rod(l, bx, y0, 0.75, bx + lean, y0 - h, 0.45, (v, t, _k, ix, iy) => tone(BUSH, 0.3 + t * 0.5 + v * 0.2 + grain(ix, iy, seed) * 0.2, ix, iy, 0.5));
    }
  }
  p.over(l);
}

