// 바닥 무늬 원본: 512×256 크기로 상하좌우가 이어지는 "손으로 찍은 픽셀" 무늬.
// 무늬에는 색 번호(색띠*16 + 밝기 단계)만 담고, 실제 색은 맵 분위기별 팔레트에서 고릅니다.
// 큰 얼룩은 주기가 없는 잡음으로 조각을 구울 때 밝기 단계를 옮겨서 반복이 보이지 않게 합니다 (앞쪽 색띠만).
// 화면 512×256 주기는 타일 좌표로 (8,-8)·(8,8) 이므로, 돌·나무 무늬는 타일 좌표 8칸 주기로 짭니다.
// DOM 을 쓰지 않으므로 무늬를 미리 만들어 두기(대기 시간에) 쉽습니다.
import { hash01, hashU32, periodicNoise, rng } from './noise';
import { GROUND } from './terrain';

export const TEX_W = 512;
export const TEX_H = 256;
const TN = TEX_W * TEX_H;
/** 타일 좌표 주기 (u, v 모두) */
const PERIOD = 8;

/** 색 번호 = 색띠 * 16 + 밝기 단계 */
const C = (ramp: number, level: number): number => (ramp << 4) | level;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 텍셀 (x, y) 중심의 타일 좌표: u = (x + 2y + 1.5) / 64, v = (2y - x + 0.5) / 64 */
const U0 = (y: number): number => (2 * y + 1.5) / 64;
const V0 = (y: number): number => (2 * y + 0.5) / 64;

class Painter {
  readonly c = new Uint8Array(TN);
  set(x: number, y: number, v: number): void {
    this.c[((y & 255) << 9) | (x & 511)] = v;
  }
  get(x: number, y: number): number {
    return this.c[((y & 255) << 9) | (x & 511)]!;
  }
}

// ───────────────────────── 팔레트 ─────────────────────────

export type GroundVariant = 'r1' | 'r2' | 'r3';

export interface PaletteSpec {
  /** 색띠마다 어두운 색부터 밝은 색 */
  ramps: readonly (readonly string[])[];
  /** 큰 얼룩 값(-1~1) → 밝기 단계 이동량. [얼룩 값, 이동량] 꺾은선 */
  macro: readonly (readonly [number, number])[];
  /** 얼룩의 영향을 받는 색띠 수 (앞에서부터). 줄눈·이끼 같은 색띠는 뒤에 둬서 얼룩에 씻기지 않게 */
  shift: number;
}

const P = (ramps: string[][], macro: [number, number][], shift = 1): PaletteSpec => ({ ramps, macro, shift });
const MILD: [number, number][] = [
  [-1, -0.9],
  [1, 0.8],
];
const SOFT: [number, number][] = [
  [-1, -0.6],
  [1, 0.5],
];

/** 재질별 팔레트. 풀·흙은 분위기(r1 저녁 숲, r2 낮 마을, r3 섬 풀밭)마다 다름 */
export function paletteFor(mat: number, variant: GroundVariant): PaletteSpec {
  switch (mat) {
    case GROUND.GRASS:
      if (variant === 'r1')
        // R1: #2c4a1c 바탕, #1b3011 큰 얼룩, #4d6e2a 밝은 점
        return P(
          [['#0f1d08', '#1b3011', '#2c4a1c', '#4d6e2a', '#587a30', '#6c8c38']],
          [
            [-1, -1.7],
            [-0.45, -1.1],
            [-0.1, -0.25],
            [0.35, 0.15],
            [1, 0.75],
          ],
        );
      if (variant === 'r3')
        // R3: #3a7424 바탕, #24501a 어두운 덩어리, #62983a 노란빛 풀잎
        return P(
          [['#1a4214', '#24501a', '#3a7424', '#467f2a', '#62983a', '#80b04c']],
          [
            [-1, -1.4],
            [-0.4, -0.75],
            [0, 0],
            [1, 0.75],
          ],
        );
      // R2: #2f7d24 바탕, #45a032 밝은 점, #22631a 어두운 점 (촘촘한 1px 디더, 큰 얼룩은 약함), 드문 흙빛 점
      return P(
        [
          ['#185014', '#22631a', '#2f7d24', '#45a032', '#58b03a', '#86c44c'],
          ['#3e3416', '#544220', '#5e5a22'],
        ],
        [
          [-1, -0.6],
          [-0.4, -0.25],
          [0, 0],
          [1, 0.35],
        ],
      );
    case GROUND.DIRT:
      if (variant === 'r1')
        // R1 흙길: #5c3a1f 바탕, #7a4d2a 밝은 점, #3d2412 어두운 점
        return P(
          [['#2a1609', '#3d2412', '#4e2e17', '#5e3b1f', '#74452a', '#8a5230', '#a4623a']],
          [
            [-1, -0.7],
            [1, 0.6],
          ],
        );
      // 낮의 흙 (R3 #a06c3a 덩어리)
      return P([['#4e2e14', '#66401f', '#7c5028', '#8e5e31', '#a06c3a', '#b07a44', '#c08a52']], MILD);
    case GROUND.COBBLE:
      return P(
        [
          ['#35312b', '#4b463f', '#5f5951', '#726c64', '#857e75', '#978f85', '#a9a196', '#bdb5a9'],
          ['#3a3129', '#52473b', '#66594b', '#796b5b', '#8b7c6b', '#9c8d7b', '#ad9e8b', '#bdaf9c'],
          ['#1e1b17', '#2c2823', '#3a352f'],
        ],
        MILD,
        2,
      );
    case GROUND.PLANKS:
      return P([['#38220f', '#52341d', '#664226', '#7a512e', '#8c5f37', '#9c6d42', '#ac7c4e', '#bc8c5c'], ['#1e1208', '#2c1b0d', '#3a2512']], SOFT);
    case GROUND.MARBLE:
      return P(
        [
          ['#97928a', '#b2ada4', '#c3bfb6', '#d0ccc4', '#dbd7cf', '#e5e2db', '#efede7'],
          ['#a39d93', '#b9b3a9', '#cbc5bb'],
          ['#8a857c', '#a29d94'],
        ],
        [
          [-1, -0.7],
          [1, 0.5],
        ],
      );
    case GROUND.DUNGEON:
      return P(
        [
          ['#1c1a18', '#26231f', '#2f2c28', '#383430', '#423e39', '#4c4843', '#57534d', '#635e57'],
          ['#2a2b20', '#34362a', '#3f4233'],
          ['#0c0b0a', '#141210', '#1c1a17'],
        ],
        MILD,
      );
    case GROUND.ABYSS:
      return P(
        [
          ['#110d16', '#18121f', '#201929', '#281f33', '#30263e', '#3a2d4a', '#453657', '#514065'],
          ['#5a3a86', '#7a52b8', '#a47ee4'],
          ['#07050a', '#0d0912', '#130e19'],
        ],
        MILD,
      );
    case GROUND.CAVE:
      return P(
        [
          ['#1e1a16', '#29231e', '#332c26', '#3e362f', '#4a4138', '#564c42', '#63584d', '#72665a'],
          ['#100d0b', '#5d544a', '#7a7064', '#968a7c'],
        ],
        [
          [-1, -1.2],
          [1, 0.9],
        ],
      );
    case GROUND.SAND:
      return P([['#8a7448', '#a08856', '#b0985f', '#bea56a', '#cbb178', '#d6be86', '#e2cc96'], ['#6e5a36', '#ece0b4']], MILD);
    case GROUND.ASH:
      return P(
        [
          ['#2b2925', '#36332e', '#413e38', '#4c4842', '#57534c', '#625e56', '#6e6961', '#7c776e'],
          ['#16130f', '#221d18', '#8e8a80', '#a8a49a'],
        ],
        [
          [-1, -1],
          [1, 0.8],
        ],
      );
    case GROUND.SWAMP:
      return P(
        [
          ['#18211a', '#202c1d', '#283722', '#304228', '#3a4e2f', '#445a36', '#50683e'],
          ['#141f1a', '#1b2a23', '#24362c', '#3c5446', '#6a8a6c', '#4e6a2c'],
        ],
        MILD,
      );
    case GROUND.FLAGSTONE:
      return P(
        [
          ['#4a463e', '#5d584e', '#716b60', '#837d71', '#948e81', '#a39d8f', '#b2ac9f', '#c1bcb0'],
          ['#28401a', '#365424', '#47682e', '#5a7c38'],
          ['#25221d', '#332f29', '#423d35'],
        ],
        [
          [-1, -0.9],
          [1, 0.6],
        ],
      );
    case GROUND.DAIS:
      // R3 단상 윗면: 옅은 베이지 돌 #c4b898, 줄눈 #8a7e64
      return P(
        [
          ['#7e735a', '#958a6e', '#a89c7e', '#b6aa8a', '#c4b898', '#cec3a4', '#d8cfb2', '#e2dac0'],
          ['#8f8f70', '#a2a07e', '#b3b08e', '#c2bf9e'],
          ['#5e5542', '#71684f', '#8a7e64'],
        ],
        [
          [-1, -0.7],
          [1, 0.4],
        ],
      );
    default:
      return P([['#000000']], MILD);
  }
}

/** 단상 계단 옆면 색: 빛 받는 왼쪽 앞면과 그늘진 오른쪽 앞면 (바닥 줄, 몸통 어둡게, 몸통, 몸통 밝게, 윗입술) */
export const STEP_LIT = ['#6e644e', '#857a60', '#9a8e72', '#a89c80', '#d4c9aa'] as const;
export const STEP_SHADE = ['#3e382c', '#564e3d', '#6a614c', '#766c56', '#b0a486'] as const;
/** 계단 옆면 돌 사이 줄눈 */
export const STEP_JOINT = ['#4e4636', '#3a3428'] as const;

/** 경계 효과 색 */
export const EDGE = {
  /** 흙길의 풀 쪽 어두운 테두리 (R1 #1e2a10) */
  rimDusk: ['#1e2a10', '#2a2c14', '#33301a'],
  rimDay: ['#2c3612', '#3c3e18', '#4c4420'],
  /** 물가 거품과 물보라 (R3 #dce8f4) */
  foam: ['#dce8f4', '#f4f8fc', '#a4c6e8', '#6f9fd8'],
  /** 성수 둘레 금 테두리 (#d8b040): 어두운 띠, 그늘, 바탕, 밝은 쪽, 빛 */
  gold: ['#6a5020', '#a4801f', '#d8b040', '#f0d070', '#fbe9a8'],
  /** 용암 둘레 그을음 */
  crust: ['#1c0905', '#341208', '#5a1d0a'],
} as const;

// ───────────────────────── 공통 도구 ─────────────────────────

/** 정수 격자 주기 표: i → i mod n (음수 포함, 범위 [-pad, n*k+pad)) */
function wrapTable(n: number, lo: number, hi: number): { tab: Int32Array; off: number } {
  const tab = new Int32Array(hi - lo + 1);
  for (let i = lo; i <= hi; i++) tab[i - lo] = ((i % n) + n) % n;
  return { tab, off: -lo };
}

interface Voronoi {
  /** 가장 가까운 점의 칸 번호 */
  id: Int32Array;
  /** 두 번째로 가까운 점까지 거리 - 가장 가까운 점까지 거리 (타일 단위, 경계에서 0) */
  e: Float32Array;
  /** 가장 가까운 점에서 본 텍셀의 자리 (타일 단위 u, v) */
  du: Float32Array;
  dv: Float32Array;
}

/**
 * 바닥면(타일 좌표) 보로노이: 한 타일에 u 방향 ku 칸, v 방향 kv 칸 (8·ku, 8·kv 는 정수여야 주기가 맞음).
 * 거리는 타일 단위로 재므로 돌이 바닥면에서 둥글고, 화면에서는 2:1 로 눌린 둥근 돌이 됩니다.
 * ku < kv 이면 u 방향으로 긴 돌.
 */
function voronoiUV(ku: number, kv: number, seed: number, jitter: number): Voronoi {
  const pu = Math.round(PERIOD * ku);
  const pv = Math.round(PERIOD * kv);
  const fx = new Float32Array(pu * pv);
  const fy = new Float32Array(pu * pv);
  for (let j = 0; j < pv; j++) {
    for (let i = 0; i < pu; i++) {
      fx[j * pu + i] = 0.5 + (hash01(i, j, seed) - 0.5) * jitter;
      fy[j * pu + i] = 0.5 + (hash01(i, j, seed + 1) - 0.5) * jitter;
    }
  }
  const Wu = wrapTable(pu, -2 * pu - 2, 3 * pu + 2);
  const Wv = wrapTable(pv, -2 * pv - 2, 3 * pv + 2);
  const id = new Int32Array(TN);
  const e = new Float32Array(TN);
  const du = new Float32Array(TN);
  const dv = new Float32Array(TN);
  for (let y = 0; y < TEX_H; y++) {
    const u0 = U0(y);
    const v0 = V0(y);
    for (let x = 0; x < TEX_W; x++) {
      const cu = (u0 + x / 64) * ku;
      const cv = (v0 - x / 64) * kv;
      const ci = Math.floor(cu);
      const cj = Math.floor(cv);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      let bu = 0;
      let bv = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        const row = Wv.tab[jj + Wv.off]! * pu;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const kk = row + Wu.tab[ii + Wu.off]!;
          const pu2 = (cu - ii - fx[kk]!) / ku;
          const pv2 = (cv - jj - fy[kk]!) / kv;
          const d = pu2 * pu2 + pv2 * pv2;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = kk;
            bu = pu2;
            bv = pv2;
          } else if (d < d2) d2 = d;
        }
      }
      const i = (y << 9) | x;
      id[i] = best;
      e[i] = Math.sqrt(d2) - Math.sqrt(d1);
      du[i] = bu;
      dv[i] = bv;
    }
  }
  return { id, e, du, dv };
}

/** 바닥면 점 (du, dv) 의 왼쪽 위 빛 (+ 밝음, - 어두움): 화면에서 왼쪽 위를 향하는 쪽이 밝음 */
function bevel(du: number, dv: number): number {
  const sx = du - dv; // 화면 x 방향 (반 칸 단위)
  const sy = (du + dv) * 0.5; // 화면 y 방향
  return -(sx * 0.6 + sy * 1.6);
}

/**
 * 줄마다 어긋난 직사각형 돌 (판석·던전 돌·단상 계단 디딤판 공용).
 * 바닥면 u 방향으로 줄을 놓고, 줄 높이 rowMin~rowMax (타일, 줄마다 다름), 돌 길이 minL~maxL. 경계는 잡음으로 살짝 흔듦.
 * 결과: id (돌 번호), e (가장 가까운 경계까지 거리, 타일 단위), side (경계 방향: 0 위, 1 아래, 2 왼쪽, 3 오른쪽).
 */
function slabs(seed: number, rowMin: number, rowMax: number, minL: number, maxL: number, wobble: number): { id: Int32Array; e: Float32Array; side: Uint8Array } {
  // 줄 경계: 높이 rowMin~rowMax 로 쌓아 주기 PERIOD 를 채움 (마지막 줄은 남은 만큼)
  const RR = rng(seed + 977);
  const rowStart: number[] = [0];
  let acc = 0;
  for (;;) {
    const hgt = rowMin + RR() * (rowMax - rowMin);
    if (acc + hgt > PERIOD - rowMin) break;
    acc += hgt;
    rowStart.push(acc);
  }
  const rows = rowStart.length;
  const rowEnd = rowStart.slice(1).concat([PERIOD]);
  const joints: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const R = rng(seed + r * 101);
    const js: number[] = [];
    let u = R() * maxL;
    const first = u;
    while (u < PERIOD + first - minL) {
      js.push(u % PERIOD);
      u += minL + R() * (maxL - minL);
    }
    joints.push(Float32Array.from(js).sort());
  }
  const wu = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 7);
  const wv = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 8);
  const id = new Int32Array(TN);
  const e = new Float32Array(TN);
  const side = new Uint8Array(TN);
  for (let y = 0; y < TEX_H; y++) {
    const u0 = U0(y);
    const v0 = V0(y);
    for (let x = 0; x < TEX_W; x++) {
      const i = (y << 9) | x;
      let u = u0 + x / 64 + (wu[i]! - 0.5) * wobble;
      let v = v0 - x / 64 + (wv[i]! - 0.5) * wobble;
      u = ((u % PERIOD) + PERIOD) % PERIOD;
      v = ((v % PERIOD) + PERIOD) % PERIOD;
      let r = rows - 1;
      for (let q = 1; q < rows; q++) {
        if (v < rowStart[q]!) {
          r = q - 1;
          break;
        }
      }
      const dv0 = v - rowStart[r]!;
      const dv1 = rowEnd[r]! - v;
      const js = joints[r]!;
      // u 를 감싼 두 이음매 (주기 넘어감 처리)
      let k = js.length - 1;
      for (let q = 0; q < js.length; q++) if (js[q]! <= u) k = q;
      let start = js[k]!;
      if (start > u) start -= PERIOD;
      let end = k + 1 < js.length ? js[k + 1]! : js[0]! + PERIOD;
      if (end <= start) end += PERIOD;
      const du0 = u - start;
      const du1 = end - u;
      let m = dv0;
      let sd = 0;
      if (dv1 < m) {
        m = dv1;
        sd = 1;
      }
      if (du0 < m) {
        m = du0;
        sd = 2;
      }
      if (du1 < m) {
        m = du1;
        sd = 3;
      }
      id[i] = r * 64 + (Math.floor((((start % PERIOD) + PERIOD) % PERIOD) * 8) & 63);
      e[i] = m;
      side[i] = sd;
    }
  }
  return { id, e, side };
}

// ───────────────────────── 무늬 ─────────────────────────

/**
 * 풀밭. 분위기마다 그림 방식이 다름:
 * r2 (낮 마을, R2) 바탕색 위주의 촘촘한 1px 디더와 짧은 빗금 (카펫 같은 잔디, 큰 덩어리 없음)
 * r3 (섬 풀밭, R3) 위는 밝고 아래는 어두운 작은 잎 덩어리를 겹겹이 찍은 붓 자국
 * r1 (저녁 숲길, R1) 어두운 바탕 + 촘촘한 밝은 점 + 세로 풀잎
 */
function grassTex(seed: number, variant: GroundVariant): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 1);
  const n4 = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 2);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 3);
  if (variant === 'r2') {
    for (let i = 0; i < TN; i++) {
      const v = n4[i]! * 0.35 + n8[i]! * 0.25 + R() * 0.4;
      let lvl = v < 0.42 ? 1 : v < 0.7 ? 2 : 3;
      if (R() < 0.015) lvl = 0;
      p.c[i] = lvl;
      // 흙이 비치는 자리: 큰 잡음이 낮은 곳에 어두운 흙빛 점이 드문드문
      if (n16[i]! < 0.3 && R() < (0.3 - n16[i]!) * 0.5) p.c[i] = C(1, R() < 0.6 ? 0 : R() < 0.5 ? 1 : 2);
    }
    // 짧은 빗금 (어두운 1px 대각선 두세 점) 과 밝은 풀잎 끝
    for (let k = 0; k < TN / 170; k++) {
      const x = Math.floor(R() * TEX_W);
      const y = Math.floor(R() * TEX_H);
      const len = 2 + Math.floor(R() * 2);
      const dir = R() < 0.7 ? 1 : -1;
      for (let s = 0; s < len; s++) p.set(x + s * dir, y + s, 1);
    }
    for (let k = 0; k < TN / 70; k++) {
      const x = Math.floor(R() * TEX_W);
      const y = Math.floor(R() * TEX_H);
      p.set(x, y, R() < 0.12 ? 4 : 3);
      p.set(x, y + 1, 2);
      p.set(x, y + 2, 1);
    }
    return p.c;
  }
  if (variant === 'r3') {
    for (let i = 0; i < TN; i++) {
      const v = n8[i]! * 0.5 + n4[i]! * 0.2 + R() * 0.3;
      p.c[i] = v < 0.38 ? 0 : v < 0.5 ? 1 : 2;
    }
    // 잎 덩어리: 위쪽부터 차례로 찍어서 아래 덩어리가 위 덩어리를 가림 (비스듬히 내려다본 풀)
    const n = Math.floor(TN / 26);
    const clumps: [number, number, number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const x = Math.floor(R() * TEX_W);
      const y = Math.floor(R() * TEX_H);
      clumps.push([y, x, 2 + Math.floor(R() * 3), 1 + Math.floor(R() * 2), R()]);
    }
    clumps.sort((a, b) => a[0] - b[0]);
    for (const [y, x, rw, rh, r] of clumps) {
      const shadeK = n16[(y << 9) | x]!;
      // 어두운 자리(큰 잡음이 낮은 곳)의 덩어리는 한 단계 어둡게
      const off = shadeK < 0.36 ? -1 : shadeK > 0.68 && r < 0.5 ? 1 : 0;
      for (let dy = -rh; dy <= rh + 1; dy++) {
        for (let dx = -rw; dx <= rw; dx++) {
          const e = (dx * dx) / (rw * rw + 0.5) + (dy * dy) / (rh * rh + 0.5);
          if (dy === rh + 1) {
            if (Math.abs(dx) < rw && R() < 0.7) p.set(x + dx, y + dy, 0);
            continue;
          }
          if (e > 1.05) continue;
          let lvl = 3;
          if (dy === -rh || (dx < 0 && e > 0.55 && dy <= 0)) lvl = 4;
          else if (dy >= rh || (dx > 0 && e > 0.6)) lvl = 2;
          if (lvl === 4 && r < 0.18) lvl = 5;
          p.set(x + dx, y + dy, Math.max(0, Math.min(5, lvl + off)));
        }
      }
    }
    // 고운 점
    for (let k = 0; k < TN / 20; k++) {
      const x = Math.floor(R() * TEX_W);
      const y = Math.floor(R() * TEX_H);
      p.set(x, y, R() < 0.5 ? 1 : 3);
    }
    return p.c;
  }
  // r1: R1 저녁 숲 (어두운 바탕에 가늘고 긴 세로 풀잎이 촘촘히)
  for (let i = 0; i < TN; i++) {
    const clump = n8[i]! * 0.55 + n4[i]! * 0.45;
    const v = clump * 0.6 + R() * 0.4 + (n16[i]! - 0.5) * 0.18;
    let lvl = v < 0.38 ? 1 : v < 0.64 ? 2 : 3;
    if (clump < 0.3 && R() < 0.75) lvl = Math.max(0, lvl - 1);
    p.c[i] = lvl;
  }
  // 세로 풀잎: 밝은 끝 + 몸통 + 아래 그늘 (길이 3~6px, 가끔 기울어짐)
  for (let k = 0; k < TN / 7; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    const cl = n8[(y << 9) | x]!;
    if (cl < 0.25) continue;
    const len = 3 + Math.floor(R() * 4);
    const lean = R() < 0.3 ? (R() < 0.5 ? -1 : 1) : 0;
    for (let s2 = 0; s2 < len; s2++) {
      const t = s2 / len;
      const xx = x + (s2 === 0 ? lean : 0);
      p.set(xx, y + s2, s2 === 0 ? (cl > 0.6 && R() < 0.4 ? 4 : 3) : t < 0.34 ? 3 : 2);
    }
    p.set(x, y + len, 0);
  }
  // 노란빛 잎 터치: 2~4px 작은 덩어리 (밝은 자리에만)
  for (let k = 0; k < TN / 700; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    if (n16[(y << 9) | x]! < 0.45) continue;
    p.set(x, y, 5);
    p.set(x + 1, y, R() < 0.6 ? 4 : 5);
    if (R() < 0.6) p.set(x, y - 1, 4);
    p.set(x, y + 1, 2);
    p.set(x + 1, y + 1, 1);
  }
  return p.c;
}

/** 흙: 바탕 + 밝은/어두운 점 + 작은 흙덩이 + 가는 갈라짐 */
function dirtTex(seed: number): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 1);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const n4 = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  for (let i = 0; i < TN; i++) {
    // 고운 알갱이가 많은 흙 (R1 흙길): 부드러운 잡음보다 낱알 무늬가 더 큼
    const v = n16[i]! * 0.25 + n8[i]! * 0.15 + n4[i]! * 0.1 + R() * 0.5;
    let lvl = v < 0.38 ? 2 : v < 0.6 ? 3 : v < 0.72 ? 4 : 5;
    const r = R();
    if (r < 0.05) lvl = 1;
    else if (r < 0.07) lvl = 6;
    p.c[i] = lvl;
  }
  // 1~2px 점과 작은 흙덩이 (밝은 윗면 + 어두운 아랫면)
  for (let k = 0; k < TN / 80; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    if (R() < 0.5) {
      p.set(x, y, 5);
      p.set(x + 1, y, R() < 0.5 ? 6 : 5);
      p.set(x, y + 1, 1);
      p.set(x + 1, y + 1, 2);
    } else {
      p.set(x, y, 1);
      if (R() < 0.5) p.set(x + 1, y, 1);
    }
  }
  // 아주 가는 갈라짐
  for (let k = 0; k < TN / 6000; k++) {
    let x = Math.floor(R() * TEX_W);
    let y = Math.floor(R() * TEX_H);
    const len = 4 + Math.floor(R() * 8);
    for (let s = 0; s < len; s++) {
      p.set(x, y, 1);
      x += R() < 0.7 ? 1 : 0;
      y += R() < 0.4 ? (R() < 0.5 ? -1 : 1) : 0;
    }
  }
  return p.c;
}

/** 자갈길: 둥근 돌이 촘촘히 박힌 무늬 (바닥면 보로노이, 돌마다 색띠와 밝기가 다름) */
function cobbleTex(seed: number): Uint8Array {
  const out = new Uint8Array(TN);
  const vo = voronoiUV(4, 4, seed, 0.56);
  const fine = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 5);
  const R = rng(seed + 9);
  for (let i = 0; i < TN; i++) {
    const e = vo.e[i]!;
    if (e < 0.0325) {
      out[i] = C(2, e < 0.015 ? 0 : e < 0.025 || R() < 0.5 ? 1 : 2);
      continue;
    }
    const id = vo.id[i]!;
    const h = hashU32(id, 7, seed);
    let lvl = 3 + (h % 3) + bevel(vo.du[i]! * 4, vo.dv[i]! * 4) * 2.6 + (fine[i]! - 0.5) * 1.2 + (R() - 0.5) * 0.7;
    if (e < 0.05) lvl -= 1;
    out[i] = C((h >>> 4) % 5 < 2 ? 1 : 0, clamp(Math.round(lvl), 1, 7));
  }
  return out;
}

/** 판석 광장: 줄마다 어긋난 큰 사각 판석 + 어두운 줄눈 + 틈의 이끼 + 금 간 돌, 깨진 모서리 */
function flagstoneTex(seed: number): Uint8Array {
  const out = new Uint8Array(TN);
  const sl = slabs(seed, 0.48, 0.78, 0.5, 1.05, 0.07);
  const fine = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  const blot = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 4);
  const moss = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 5);
  const R = rng(seed + 9);
  const G = 0.028; // 줄눈 반 두께 (타일)
  for (let i = 0; i < TN; i++) {
    const e = sl.e[i]!;
    const id = sl.id[i]!;
    const h = hashU32(id, 3, seed);
    // 깨진 모서리: 돌마다 하나쯤, 경계 가까이에서 줄눈을 넓힘
    const chip = (h & 7) === 0 ? 0.03 * (blot[i]! > 0.5 ? 1 : 0) : 0;
    if (e < G + chip) {
      const m = moss[i]! > 0.66 && R() < 0.75;
      out[i] = m ? C(1, Math.floor(R() * 3)) : C(2, e < G * 0.4 ? 0 : R() < 0.45 ? 1 : 2);
      continue;
    }
    let lvl = 3.4 + (h % 4) * 0.55;
    // 위·왼쪽 가장자리는 밝게, 아래·오른쪽은 어둡게 (빛은 왼쪽 위)
    const s = sl.side[i]!;
    if (e < G + 0.04) lvl += s === 0 || s === 2 ? 1 : -1.2;
    lvl += (fine[i]! - 0.5) * 1.3 + (blot[i]! - 0.5) * 1.2 + (R() - 0.5) * 0.7;
    if (R() < 0.015) lvl -= 2;
    out[i] = C(0, clamp(Math.round(lvl), 1, 7));
  }
  cracks(out, rng(seed + 11), TN / 9000, 0, C(2, 1));
  return out;
}

/** 돌 위의 가는 금: 이리저리 꺾이며 걷는 1px 선 (색띠 ramp 의 돌 위에만 그림) */
function cracks(out: Uint8Array, R: () => number, n: number, ramp: number, col: number): void {
  for (let k = 0; k < n; k++) {
    let x = Math.floor(R() * TEX_W);
    let y = Math.floor(R() * TEX_H);
    let dx = R() < 0.5 ? 1 : -1;
    const len = 5 + Math.floor(R() * 10);
    for (let s = 0; s < len; s++) {
      const i = ((y & 255) << 9) | (x & 511);
      if (out[i]! >> 4 !== ramp) break;
      out[i] = col;
      if (R() < 0.2) dx = -dx;
      x += R() < 0.75 ? dx : 0;
      y += R() < 0.55 ? 1 : 0;
    }
  }
}

/** 돌 단상 윗면 (R3): 크기가 제각각인 둥근 베이지 판석 (보로노이), 어두운 줄눈, 가끔 푸른 기운 도는 돌 */
function daisTex(seed: number): Uint8Array {
  const out = new Uint8Array(TN);
  const vo = voronoiUV(1.5, 2, seed, 0.85);
  const fine = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 1);
  const blot = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const R = rng(seed + 3);
  for (let i = 0; i < TN; i++) {
    const e = vo.e[i]!;
    if (e < 0.036) {
      out[i] = C(2, e < 0.017 ? 0 : R() < 0.55 ? 1 : 2);
      continue;
    }
    const h = hashU32(vo.id[i]!, 5, seed);
    const green = h % 6 === 0;
    let lvl = (green ? 1.6 : 3.6) + (h % 3) * 0.5 + bevel(vo.du[i]! * 1.75, vo.dv[i]! * 1.75) * 1.5 + (fine[i]! - 0.5) * 1.1 + (blot[i]! - 0.5) * 0.9 + (R() - 0.5) * 0.6;
    if (e < 0.06) lvl -= 0.8;
    if (R() < 0.012) lvl -= 2;
    out[i] = C(green ? 1 : 0, clamp(Math.round(lvl), 1, green ? 3 : 7));
  }
  return out;
}

/** 대리석: 한 칸짜리 판석을 줄마다 반 칸 어긋나게, 옅은 줄눈과 가는 결 */
function marbleTex(seed: number): Uint8Array {
  const out = new Uint8Array(TN);
  const vein = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 1);
  const vein2 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 2);
  const fine = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  const R = rng(seed + 4);
  for (let y = 0; y < TEX_H; y++) {
    const u0 = U0(y);
    const v0 = V0(y);
    for (let x = 0; x < TEX_W; x++) {
      const i = (y << 9) | x;
      const v = v0 - x / 64 + PERIOD;
      const r = Math.floor(v);
      const u = u0 + x / 64 + (r & 1 ? 0.5 : 0);
      const c = Math.floor(u);
      const fu = u - c;
      const fv = v - r;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      if (edge < 0.022) {
        out[i] = C(2, edge < 0.011 ? 0 : 1);
        continue;
      }
      let lvl = 4 + ((hashU32(c & 7, r & 7, seed) % 3) - 1);
      if (fv < 0.05 || fu < 0.05) lvl += 1;
      else if (fv > 0.95 || fu > 0.95) lvl -= 1;
      // 구름 같은 옅은 얼룩 + 고운 점
      lvl += Math.round((vein2[i]! - 0.5) * 1.6 + (fine[i]! - 0.5) * 0.6 + (R() - 0.5) * 0.45);
      // 결: 큰 잡음의 등고선 두 줄 정도만 가늘고 길게 (판석마다 어긋나게)
      const w = vein[i]! + (hashU32(c & 7, r & 7, seed + 1) % 7) * 0.031;
      const f = Math.abs(((w * 2.4) % 1) - 0.5);
      if (f < 0.012) {
        out[i] = C(1, f < 0.005 ? 0 : 1);
        continue;
      }
      out[i] = C(0, clamp(lvl, 2, 6));
    }
  }
  return out;
}

/** 던전·심연 바닥: 크기가 제각각인 낡은 돌판, 닳은 모서리, 금, 줄눈의 때 (심연은 금이 보랏빛으로 빛남) */
function dungeonTex(seed: number, glow: boolean): Uint8Array {
  const out = new Uint8Array(TN);
  const sl = slabs(seed, 0.38, 0.62, 0.4, 0.95, 0.09);
  const fine = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 1);
  const wear = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const crack = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 3);
  const blot = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 4);
  const R = rng(seed + 5);
  for (let i = 0; i < TN; i++) {
    const e = sl.e[i]!;
    // 닳은 모서리: 줄눈 두께를 잡음으로 흔듦
    const g = 0.03 + (wear[i]! - 0.5) * 0.035;
    if (e < g) {
      out[i] = glow ? C(2, e < g * 0.5 ? 0 : 1) : (blot[i]! > 0.62 && R() < 0.5 ? C(1, Math.floor(R() * 3)) : C(2, e < g * 0.5 ? 0 : R() < 0.5 ? 1 : 2));
      continue;
    }
    const h = hashU32(sl.id[i]!, 9, seed);
    let lvl = 3.2 + (h % 4) * 0.5;
    const s = sl.side[i]!;
    if (e < g + 0.035) lvl += s === 0 || s === 2 ? 1 : -1;
    lvl += (fine[i]! - 0.5) * 1.4 + (blot[i]! - 0.5) * 1.1 + (R() - 0.5) * 0.9;
    const f = Math.abs(((crack[i]! * 7 + (h % 11) * 0.05) % 1) - 0.5);
    if (f < 0.018 && h % 3 === 0) {
      out[i] = glow ? C(1, f < 0.008 ? 1 : 0) : C(2, 1);
      continue;
    }
    if (R() < 0.03) lvl -= 2;
    out[i] = C(0, clamp(Math.round(lvl), 1, 7));
  }
  return out;
}

/** 동굴 바닥: 거친 흙 바탕 + 촘촘한 잔자갈 + 큰 돌 몇 개 + 드문 금 */
function caveTex(seed: number): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 1);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const n32 = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 3);
  for (let i = 0; i < TN; i++) {
    const v = n16[i]! * 0.45 + n8[i]! * 0.3 + R() * 0.25;
    let lvl = v < 0.32 ? 2 : v < 0.5 ? 3 : v < 0.66 ? 4 : 5;
    const r = R();
    if (r < 0.05) lvl = 6;
    else if (r < 0.1) lvl = 1;
    p.c[i] = lvl;
  }
  // 드문 금: 큰 잡음의 등고선 두 줄 정도, 그것도 한쪽 자리에만
  for (let i = 0; i < TN; i++) {
    if (n16[i]! < 0.55) continue;
    const f = Math.abs(((n32[i]! * 2.2 + n8[i]! * 0.35) % 1) - 0.5);
    if (f < 0.009) p.c[i] = C(1, 0);
  }
  // 잔자갈과 돌: 밝은 윗면 + 어두운 아랫면 (그늘은 바탕보다 한두 단계 어두운 흙색, 큰 돌만 짙은 그늘)
  for (let k = 0; k < TN / 170; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    const big = R() < 0.12;
    const w = big ? 3 + Math.floor(R() * 3) : 1 + Math.floor(R() * 2);
    const hgt = big ? 2 + Math.floor(R() * 2) : 1;
    for (let dy = 0; dy < hgt; dy++)
      for (let dx = 0; dx < w; dx++) {
        if ((dx === 0 || dx === w - 1) && dy === 0 && w > 2) continue;
        p.set(x + dx, y + dy, dy === 0 ? C(1, dx < w / 2 ? 3 : 2) : C(1, dx < w / 2 ? 2 : 1));
      }
    for (let dx = big ? 0 : 1; dx < w; dx++) p.set(x + dx, y + hgt, big ? C(1, 0) : 1);
  }
  return p.c;
}

/** 잿빛 땅: 고운 점 + 그을음 얼룩 + 검은 숯 조각 + 흰 재 + 드문 금 */
function ashTex(seed: number): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 1);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const n4 = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  const n32 = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 4);
  for (let i = 0; i < TN; i++) {
    const v = n16[i]! * 0.35 + n8[i]! * 0.25 + n4[i]! * 0.15 + R() * 0.25;
    let lvl = v < 0.34 ? 2 : v < 0.5 ? 3 : v < 0.64 ? 4 : 5;
    const r = R();
    if (r < 0.06) lvl = 6;
    else if (r < 0.11) lvl = 1;
    p.c[i] = lvl;
    const f = Math.abs(((n32[i]! * 4 + n8[i]! * 0.4) % 1) - 0.5);
    if (f < 0.008) p.c[i] = C(1, 1);
  }
  for (let k = 0; k < TN / 260; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    if (R() < 0.6) {
      // 숯 조각
      p.set(x, y, C(1, 0));
      p.set(x + 1, y, C(1, R() < 0.5 ? 0 : 1));
      if (R() < 0.5) p.set(x, y + 1, C(1, 1));
    } else {
      // 흰 재
      p.set(x, y, C(1, 3));
      if (R() < 0.5) p.set(x + 1, y, C(1, 2));
    }
  }
  return p.c;
}

/** 모래: 고운 점 + 바람결 물결 + 드문 조개 조각·잔돌 */
function sandTex(seed: number): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 1);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const n4 = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const i = (y << 9) | x;
      let v = n16[i]! * 0.4 + n8[i]! * 0.25 + n4[i]! * 0.15 + R() * 0.2;
      // 대각선 물결 (2y - x 는 128 주기라 512×256 안에서 이어짐)
      const ph = (x - 2 * y + n16[i]! * 24) / 16;
      v += Math.sin(ph * Math.PI * 2) * 0.09;
      let lvl = v < 0.3 ? 2 : v < 0.45 ? 3 : v < 0.6 ? 4 : 5;
      const r = R();
      if (r < 0.04) lvl = 6;
      else if (r < 0.08) lvl = 1;
      p.c[i] = lvl;
    }
  }
  for (let k = 0; k < TN / 3000; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    p.set(x, y, C(1, 1));
    p.set(x + 1, y, C(1, 1));
    p.set(x, y - 1, C(0, 6));
  }
  return p.c;
}

/** 늪: 진흙 바탕 + 탁한 물웅덩이 (위 가장자리는 하늘이 비쳐 밝고, 가운데는 깊어 어두움, 군데군데 물풀) */
function swampTex(seed: number): Uint8Array {
  const p = new Painter();
  const R = rng(seed);
  const n16 = periodicNoise(TEX_W, TEX_H, 16, 16, seed + 1);
  const n8 = periodicNoise(TEX_W, TEX_H, 8, 8, seed + 2);
  const n4 = periodicNoise(TEX_W, TEX_H, 4, 4, seed + 3);
  const n32 = periodicNoise(TEX_W, TEX_H, 32, 32, seed + 4);
  const wet = new Float32Array(TN);
  for (let i = 0; i < TN; i++) wet[i] = n32[i]! * 0.65 + n8[i]! * 0.35;
  const W = 0.31;
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const i = (y << 9) | x;
      const d = wet[i]!;
      if (d < W) {
        const up = wet[(((y - 1) & 255) << 9) | x]!;
        const up2 = wet[(((y - 2) & 255) << 9) | x]!;
        const down = wet[(((y + 1) & 255) << 9) | x]!;
        let c = C(1, d < W - 0.07 ? 0 : d < W - 0.03 ? 1 : 2);
        if (up >= W) c = C(1, 4);
        else if (up2 >= W && R() < 0.6) c = C(1, 3);
        else if (down >= W) c = C(1, 2);
        if (d < W - 0.05 && n4[i]! > 0.72 && R() < 0.5) c = C(1, 5);
        p.c[i] = c;
        continue;
      }
      const v = n16[i]! * 0.4 + n8[i]! * 0.25 + n4[i]! * 0.15 + R() * 0.2;
      let lvl = v < 0.3 ? 2 : v < 0.45 ? 3 : v < 0.6 ? 4 : 5;
      const r = R();
      if (r < 0.04) lvl = 6;
      else if (r < 0.08) lvl = 1;
      // 웅덩이 둘레의 젖은 진흙
      if (d < W + 0.03) lvl = Math.max(0, lvl - 2);
      p.c[i] = C(0, lvl);
    }
  }
  return p.c;
}

/** 나무 바닥: u 방향 널빤지 4장/칸, 널마다 색과 길이가 다르고 결·옹이·못 자국 */
function planksTex(seed: number): Uint8Array {
  const out = new Uint8Array(TN);
  const B = 4; // 한 칸에 널빤지 4장
  const ROWS = PERIOD * B;
  const ends: Float32Array[] = [];
  for (let r = 0; r < ROWS; r++) {
    const R = rng(seed + r * 31);
    const es: number[] = [];
    let u = R() * 1.5;
    const first = u;
    while (u < PERIOD + first - 1.0) {
      es.push(u % PERIOD);
      u += 1.1 + R() * 1.9;
    }
    ends.push(Float32Array.from(es).sort());
  }
  // 결: 널 방향(u)으로 길쭉한 잡음 (v 방향으로 잘게)
  const glat = new Float32Array(16 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 16; i++) glat[j * 16 + i] = hash01(i, j, seed + 1);
  const R = rng(seed + 5);
  for (let y = 0; y < TEX_H; y++) {
    const u0 = U0(y);
    const v0 = V0(y);
    for (let x = 0; x < TEX_W; x++) {
      const i = (y << 9) | x;
      const u = u0 + x / 64;
      const vRaw = v0 - x / 64 + PERIOD;
      const vv = vRaw * B;
      const r = Math.floor(vv) % ROWS;
      const fv = vv - Math.floor(vv);
      const es = ends[r]!;
      const um = u % PERIOD;
      let k = es.length - 1;
      for (let q = 0; q < es.length; q++) if (es[q]! <= um) k = q;
      let start = es[k]!;
      if (start > um) start -= PERIOD;
      let end = k + 1 < es.length ? es[k + 1]! : es[0]! + PERIOD;
      if (end <= start) end += PERIOD;
      const du0 = um - start;
      const du1 = end - um;
      // 널 사이 틈 (v 방향) 과 널 끝 이음매 (u 방향)
      if (fv < 0.13) {
        out[i] = C(1, 0);
        continue;
      }
      if (du0 < 0.03 || du1 < 0.03) {
        out[i] = C(1, 1);
        continue;
      }
      const id = hashU32(r, Math.floor(start * 8) & 63, seed);
      let lvl = 4 + ((id % 3) - 1);
      if (fv < 0.26) lvl += 1; // 널의 윗가장자리 (빛)
      else if (fv > 0.88) lvl -= 1;
      // 결: u 방향 16칸, v 방향 256칸 격자의 값 잡음
      const gu = (um / PERIOD) * 16;
      const gv = ((vRaw % PERIOD) / PERIOD) * 256;
      const i0 = Math.floor(gu);
      const j0 = Math.floor(gv);
      const tx = gu - i0;
      const ty = gv - j0;
      const a = glat[(j0 & 255) * 16 + (i0 & 15)]!;
      const b = glat[(j0 & 255) * 16 + ((i0 + 1) & 15)]!;
      const c = glat[((j0 + 1) & 255) * 16 + (i0 & 15)]!;
      const d = glat[((j0 + 1) & 255) * 16 + ((i0 + 1) & 15)]!;
      const g = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      const band = Math.abs(((g * 5 + (id % 7) * 0.13) % 1) - 0.5);
      if (band < 0.07) lvl -= 1;
      else if (band > 0.46) lvl += 1;
      if (R() < 0.05) lvl += R() < 0.5 ? 1 : -1;
      // 못 자국: 널 끝에서 조금 안쪽, 널 가운데
      if (((du0 > 0.06 && du0 < 0.1) || (du1 > 0.06 && du1 < 0.1)) && fv > 0.47 && fv < 0.66) {
        out[i] = C(1, 0);
        continue;
      }
      out[i] = C(0, clamp(lvl, 0, 7));
    }
  }
  // 옹이: 작은 어두운 타원
  for (let k = 0; k < TN / 2600; k++) {
    const x = Math.floor(R() * TEX_W);
    const y = Math.floor(R() * TEX_H);
    const i = (y << 9) | x;
    if (out[i]! >> 4 || (out[i]! & 15) < 2) continue;
    for (const [dx, dy, l] of [
      [0, 0, 1],
      [1, 0, 1],
      [-1, 0, 2],
      [2, 0, 2],
      [0, -1, 5],
      [1, 1, 2],
    ] as const) {
      const j = (((y + dy) & 255) << 9) | ((x + dx) & 511);
      if (!(out[j]! >> 4) && (out[j]! & 15) >= 2) out[j] = C(0, l);
    }
  }
  return out;
}

const texCache = new Map<string, Uint8Array>();

function texKey(mat: number, variant: GroundVariant): string {
  return `${mat}:${mat === GROUND.GRASS ? variant : 'all'}`;
}

/** 이미 만들어 둔 무늬인지 */
export function hasGroundTexture(mat: number, variant: GroundVariant): boolean {
  return texCache.has(texKey(mat, variant));
}

/** 재질 무늬 (같은 재질·분위기면 늘 같은 무늬) */
export function groundTexture(mat: number, variant: GroundVariant): Uint8Array {
  const key = texKey(mat, variant);
  let t = texCache.get(key);
  if (t) return t;
  const seed = 1000 + mat * 7717;
  switch (mat) {
    case GROUND.GRASS:
      t = grassTex(seed, variant);
      break;
    case GROUND.DIRT:
      t = dirtTex(seed);
      break;
    case GROUND.COBBLE:
      t = cobbleTex(seed);
      break;
    case GROUND.PLANKS:
      t = planksTex(seed);
      break;
    case GROUND.MARBLE:
      t = marbleTex(seed);
      break;
    case GROUND.DUNGEON:
      t = dungeonTex(seed, false);
      break;
    case GROUND.ABYSS:
      t = dungeonTex(seed, true);
      break;
    case GROUND.CAVE:
      t = caveTex(seed);
      break;
    case GROUND.SAND:
      t = sandTex(seed);
      break;
    case GROUND.ASH:
      t = ashTex(seed);
      break;
    case GROUND.SWAMP:
      t = swampTex(seed);
      break;
    case GROUND.FLAGSTONE:
      t = flagstoneTex(seed);
      break;
    case GROUND.DAIS:
      t = daisTex(seed);
      break;
    default:
      t = new Uint8Array(TN);
  }
  texCache.set(key, t);
  return t;
}

/** 미리 만들어 둘 무늬 목록 (대기 시간에 하나씩): [재질, 분위기] */
export const ALL_TEXTURES: readonly (readonly [number, GroundVariant])[] = [
  [GROUND.GRASS, 'r2'],
  [GROUND.DIRT, 'r2'],
  [GROUND.GRASS, 'r1'],
  [GROUND.GRASS, 'r3'],
  [GROUND.COBBLE, 'r2'],
  [GROUND.PLANKS, 'r2'],
  [GROUND.MARBLE, 'r2'],
  [GROUND.ASH, 'r2'],
  [GROUND.CAVE, 'r2'],
  [GROUND.DUNGEON, 'r2'],
  [GROUND.ABYSS, 'r2'],
  [GROUND.FLAGSTONE, 'r2'],
  [GROUND.DAIS, 'r2'],
  [GROUND.SAND, 'r2'],
  [GROUND.SWAMP, 'r2'],
];

// ───────────────────────── 물·성수·용암 무늬 (RGBA) ─────────────────────────

/** '#rrggbb' → ImageData 의 Uint32 (리틀 엔디언 ABGR) */
export function rgba32(hex: string, a = 255): number {
  const n = parseInt(hex.slice(1), 16);
  return (((a & 255) << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
}

export interface LiquidTex {
  w: number;
  h: number;
  /** 바탕 (불투명) */
  base: Uint32Array;
  /** 위에 겹쳐 따로 움직이는 반짝임/거품/빛나는 금 (투명 바탕) */
  glint: Uint32Array;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** 물 (R3): 진한 파랑 바탕, 대각선 물결 띠, 흰 거품 붓질. 128×64 주기 */
function waterTex(): LiquidTex {
  const w = 128;
  const h = 64;
  const base = new Uint32Array(w * h);
  const glint = new Uint32Array(w * h);
  const wob = periodicNoise(w, h, 16, 16, 51);
  const mot = periodicNoise(w, h, 16, 16, 52);
  const mot2 = periodicNoise(w, h, 8, 8, 55);
  const big = periodicNoise(w, h, 32, 32, 54);
  const R = rng(53);
  const deep = rgba32('#1d55a0');
  const dark = rgba32('#184b90');
  const darker = rgba32('#14407e');
  const mid = rgba32('#2a66b2');
  const light = rgba32('#3a78c4');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // (2y - x) 는 128 주기 → 32 간격 물결 띠가 대각선으로 이어짐
      const ph = mod(2 * y - x + (wob[i]! - 0.5) * 30 + (big[i]! - 0.5) * 20, 32) / 32;
      const b = 1 - Math.abs(ph * 2 - 1);
      // 깊은 자리: 두 겹 잡음이라 네모난 얼룩이 생기지 않음
      const m = mot[i]! * 0.7 + mot2[i]! * 0.3;
      let c = m < 0.36 ? (m < 0.27 && R() < 0.8 ? darker : dark) : deep;
      if (b > 0.88) c = light;
      else if (b > 0.76 && R() < 0.7) c = mid;
      base[i] = c;
    }
  }
  // 반짝임: 물결 꼭대기 위의 밝은 줄과 흰 거품 붓질
  const foam = rgba32('#dce8f4');
  const glow = rgba32('#5c94d8');
  for (let k = 0; k < 40; k++) {
    let x = Math.floor(R() * w);
    let y = Math.floor(R() * h);
    const len = 3 + Math.floor(R() * 7);
    const white = R() < 0.45;
    for (let s = 0; s < len; s++) {
      glint[mod(y, h) * w + mod(x, w)] = white && s > 0 && s < len - 1 ? foam : glow;
      // 물결 방향 (2,1) 을 따라
      x += 1;
      if (s & 1) y += 1;
    }
  }
  return { w, h, base, glint };
}

/** 성수 (R3 원형 샘): 밝은 하늘색, 잔물결, 반짝임. 64×32 주기 */
function holyTex(): LiquidTex {
  const w = 64;
  const h = 32;
  const base = new Uint32Array(w * h);
  const glint = new Uint32Array(w * h);
  const wob = periodicNoise(w, h, 16, 16, 61);
  const R = rng(62);
  const c0 = rgba32('#34b4d6');
  const c1 = rgba32('#48c8e8');
  const c2 = rgba32('#6ad8f2');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ph = mod(2 * y + x + (wob[i]! - 0.5) * 18, 16) / 16;
      const b = 1 - Math.abs(ph * 2 - 1);
      base[i] = b > 0.84 ? c2 : b < 0.2 && R() < 0.6 ? c0 : c1;
    }
  }
  const sp = rgba32('#effdff');
  const sp2 = rgba32('#a8eefa');
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(R() * w);
    const y = Math.floor(R() * h);
    glint[y * w + x] = sp;
    glint[y * w + mod(x + 1, w)] = sp2;
    if (R() < 0.5) glint[mod(y - 1, h) * w + x] = sp2;
  }
  return { w, h, base, glint };
}

/** 용암: 검붉은 굳은 판 사이로 빛나는 금 (금마다 굵기·밝기가 다름). 128×64 주기 */
function lavaTex(): LiquidTex {
  const w = 128;
  const h = 64;
  const base = new Uint32Array(w * h);
  const glint = new Uint32Array(w * h);
  const PER = 8;
  const fx = new Float32Array(PER * PER);
  const fy = new Float32Array(PER * PER);
  for (let j = 0; j < PER; j++) {
    for (let i = 0; i < PER; i++) {
      fx[j * PER + i] = 0.15 + 0.7 * hash01(i, j, 71);
      fy[j * PER + i] = 0.15 + 0.7 * hash01(i, j, 72);
    }
  }
  const mot = periodicNoise(w, h, 8, 8, 73);
  const heat = periodicNoise(w, h, 32, 32, 75);
  const R = rng(74);
  const plate = [rgba32('#2e0904'), rgba32('#420e06'), rgba32('#561508'), rgba32('#6a1c0a')];
  const hot = [rgba32('#8e1e0a'), rgba32('#c63e12'), rgba32('#f0761e'), rgba32('#ffb43c'), rgba32('#ffe27a')];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // 셀 크기 16×8 (가로로 긴 판)
      const u = x / 16;
      const v = y / 8;
      const ci = Math.floor(u);
      const cj = Math.floor(v);
      let d1 = 99;
      let d2 = 99;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const jj = cj + dj;
          const k = mod(jj, PER) * PER + mod(ii, PER);
          const dx = u - (ii + fx[k]!);
          const dy = (v - (jj + fy[k]!)) * 0.9;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      // 금의 굵기와 열기는 큰 잡음으로 자리마다 다르게
      const t = heat[i]!;
      const wide = 0.03 + t * 0.06;
      if (e < wide) {
        const core = e < wide * 0.45;
        base[i] = core ? hot[t > 0.55 ? 3 : 2]! : hot[t > 0.5 ? 2 : 1]!;
        glint[i] = core ? hot[t > 0.6 ? 4 : 3]! : hot[2]!;
      } else if (e < wide + 0.05) {
        base[i] = R() < 0.6 ? hot[0]! : plate[3]!;
        if (t > 0.6 && R() < 0.4) glint[i] = hot[1]!;
      } else base[i] = plate[mot[i]! < 0.3 ? 0 : mot[i]! < 0.55 ? 1 : mot[i]! < 0.8 ? 2 : 3]!;
    }
  }
  return { w, h, base, glint };
}

const liquidCache = new Map<number, LiquidTex>();

export function liquidTexture(mat: number): LiquidTex {
  let t = liquidCache.get(mat);
  if (t) return t;
  t = mat === GROUND.LAVA ? lavaTex() : mat === GROUND.HOLY ? holyTex() : waterTex();
  liquidCache.set(mat, t);
  return t;
}
