// 벽 그림: 돌벽 #, 낮은 돌담 h (R2 켈트 매듭 띠), 신전 벽 H, 나무벽 W, 던전 벽 D, 동굴 벽 K, 심연의 벽 X.
// 벽 한 칸은 TILE_W x (TILE_H + WALL_H) 캔버스이고 타일 꼭대기 - WALL_H 에 그립니다 (깊이 정렬은 그대로).
// 낮은 돌담은 같은 캔버스의 아래쪽만 칠하고 윗부분은 비워 둡니다.
// 옆면 무늬는 면의 가로 위치 u(0~32)로 정하고 주기가 32를 나누므로 이웃 칸과 끊김 없이 이어집니다.
import { TILE_H, TILE_W } from '../../shared/constants';
import { tileInfo } from '../../shared/tiles';
import { HALF_H, HALF_W, WALL_H, hash2, seeded } from './iso';
import { barkFn } from './flora';
import { Pix, buildAllowed, grain, lathe, mixc, ramp, rgb, rod, speckle, stamp, tone, type RGB, type Ramp } from './pixel';

/** 낮은 돌담의 높이 (보통 벽의 절반) */
export const LOW_WALL_H = 20;

const VARIANTS = 4;

interface WallCtx {
  ch: string;
  variant: number;
  seed: number;
  /** 벽 높이 */
  hgt: number;
  links: number;
}

interface WallStyle {
  pal: Ramp;
  /** 옆면: u 가로 0~32 (왼쪽 → 오른쪽), v 위에서 아래 0~hgt, side 0 왼쪽 면(밝음) / 1 오른쪽 면 */
  face: (u: number, v: number, side: number, ix: number, iy: number, w: WallCtx) => RGB;
  /** 윗면: a = x축 방향 0~1, b = y축 방향 0~1 */
  top: (a: number, b: number, ix: number, iy: number, w: WallCtx) => RGB;
}

const IRON = ramp('#0b0b0d', '#18181b', '#222226', '#2c2c31', '#38383e', '#48484f', '#5c5c64', '#7a7a84');
const GLASS = ramp('#7a3a10', '#c06818', '#e89030', '#ffb347', '#ffd27a', '#ffe9a8', '#fff6d8');
const POST_WOOD = ramp('#1a1009', '#2e1f12', '#3c2a19', '#4a3220', '#5a3f29', '#6c4e33', '#80603f', '#94724c');
const GOLD = ramp('#3a2a10', '#5c4418', '#6a5020', '#8e6a2a', '#b08636', '#d0a040', '#e2b852', '#f0d070', '#fff0b0');
const LOG_END = ramp('#4a3018', '#6e4c2a', '#8c6638', '#a87e48', '#bf955a', '#d2ab70', '#e2c288');
const MOSS: RGB = rgb('#4c6a2c');
const IVY = ramp('#0f2a0c', '#1a3e14', '#24521a', '#2f6a22', '#46852c', '#62a03a');

const STONE_WALL = ramp('#2a2724', '#423e3a', '#55514c', '#68645e', '#7b7670', '#8b8580', '#9e9892', '#b2aca5', '#c6c0b8');
// R2 낮은 돌담: 회색 돌 #8a8a80, 밝은 갓돌, 어두운 홈에 밝게 새긴 매듭
const LOW_WALL = ramp('#1e201a', '#2e3129', '#3e423a', '#55574e', '#6c6c64', '#7e7e75', '#8a8a80', '#a0a095', '#b8b8ac', '#d0cfc4');
const TEMPLE = ramp('#5a564e', '#7e796e', '#9a958a', '#b0ab9f', '#c4bfb3', '#d4d0c5', '#e2ddd2', '#eeeae2', '#f8f6f0');
const LOGS = ramp('#1e1209', '#33200f', '#472d16', '#5e3c1e', '#734a26', '#8a5a32', '#a26c3e', '#ba824e', '#cc9862');
const DUNGEON = ramp('#141316', '#1e1d20', '#28262a', '#333033', '#3f3b3b', '#4c4844', '#5a5550', '#6a645e', '#7c756e');
const CAVE_WALL = ramp('#130f0c', '#1e1813', '#2a221b', '#372c23', '#45382c', '#544537', '#655343', '#786451', '#8c7660');
const ABYSS = ramp('#09070d', '#120d19', '#1b1424', '#241b30', '#2f233d', '#3a2c4b', '#47375b', '#56446c', '#6a5682');
const ABYSS_GLOW = ramp('#2a1450', '#4a2a88', '#6a40b8', '#8c5ee0', '#b088ff', '#d4bcff');

/**
 * 쌓은 돌의 줄눈. 줄(높이 rowH)마다 이음매 위치를 정하되, 타일 경계(u=0, 32)에는
 * 짝수 줄에만 이음매를 둬서 이웃 타일과 돌이 엇갈려 이어집니다 (경계를 넘는 돌은 같은 색).
 * 결과: [돌 번호(-1: 경계를 넘는 돌), 돌 안의 가로 위치 0~1, 줄 안의 세로 위치 0~rowH, 이음매까지 거리(px)]
 */
function ashlar(u: number, v: number, rowH: number, seed: number, side: number): [number, number, number, number] {
  const row = Math.floor(v / rowH);
  const vv = v - row * rowH;
  const r1 = hash2(row, side, seed);
  const r2 = hash2(row, side + 7, seed);
  // 이음매 네 곳 (짝수 줄은 타일 경계에, 홀수 줄은 경계를 넘는 돌)
  const even = row % 2 === 0;
  const a1 = even ? 9 + r1 * 6 : 4 + r1 * 6;
  const a2 = even ? 20 + r2 * 6 : 15 + r2 * 9;
  let j0: number;
  let j1: number;
  let k: number;
  if (u < a1) {
    j0 = even ? 0 : -4;
    j1 = a1;
    k = 0;
  } else if (u < a2) {
    j0 = a1;
    j1 = a2;
    k = 1;
  } else {
    j0 = a2;
    j1 = even ? 32 : 36;
    k = 2;
  }
  const spans = j0 < 0 || j1 > 32;
  const dist = Math.min(u - j0, j1 - u, vv, rowH - vv);
  return [spans ? -1 : row * 8 + k + side * 64, (u - j0) / (j1 - j0), vv, dist];
}

/** 돌 한 덩이의 명암: 위·왼쪽 모서리는 밝게, 아래·오른쪽은 어둡게, 줄눈은 어둡게 */
function stoneBlock(base: number, u: number, v: number, rowH: number, w: WallCtx, side: number, bevel = 0.12, vary = 0.08): number {
  const [id, t, vv, dist] = ashlar(u, v, rowH, w.seed, side);
  if (dist < 0.6) return 0.08;
  let tv = base + (id < 0 ? 0 : (hash2(id, 3, w.seed) - 0.5) * vary * 2);
  if (vv < 1.6) tv += bevel;
  else if (vv > rowH - 1.6) tv -= bevel;
  if (t * 30 < 1.4) tv += bevel * 0.6;
  return tv;
}

/**
 * 윗면의 이웃 경계 처리: 앞쪽 모서리는 빛을 받아 밝고, 열린 뒤쪽 모서리는 살짝 밝은 테두리.
 * 이웃 벽과 붙은 뒤쪽 경계에는 변형 비트에 따라 갓돌 이음매를 넣어 칸마다 같은 격자가 보이지 않게 합니다.
 */
function capEdge(a: number, b: number, w: WallCtx, seams: boolean): number {
  const { links, variant } = w;
  let d = 0;
  if (!(links & 1) && a > 0.955) d += 0.12;
  if (!(links & 2) && b > 0.955) d += 0.14;
  if (!(links & 4) && a < 0.05) d += 0.08;
  if (!(links & 8) && b < 0.05) d += 0.06;
  if (seams && (((links & 4) && variant & 1 && a < 0.035) || ((links & 8) && variant & 2 && b < 0.035))) d -= 0.3;
  return d;
}

/**
 * 켈트 매듭 띠 (세 가닥 땋기): 기울기 ±1 인 두 묶음의 줄이 주기 P 로 엇갈리고, 띠 위아래에서 꺾여 돌아옵니다.
 * 교차점마다 위로 지나는 가닥이 번갈아 바뀝니다. (u, w): 띠 안 좌표, H: 띠 높이 (P 의 1.5 배).
 * 결과: [0 바탕 / 1 가닥 / 2 가닥 둘레 홈, 가닥 밝기 보정]
 */
export function knotAt(u: number, w: number, P = 8, hw = 1.25): [number, number] {
  const fa = (u + w) / P;
  const ka = Math.round(fa);
  const sa = (u + w - ka * P) * Math.SQRT1_2;
  const fb = (u - w) / P;
  const kb = Math.round(fb);
  const sb = (u - w - kb * P) * Math.SQRT1_2;
  const da = Math.abs(sa);
  const db = Math.abs(sb);
  const aOver = (((ka + kb) % 2) + 2) % 2 === 0;
  // 빛은 왼쪽 위: A 가닥(오른쪽 위로 감)은 왼쪽 위 가장자리, B 가닥(오른쪽 아래로 감)은 오른쪽 위 가장자리가 밝음
  const shadeA = 0.3 * (1 - (da / hw) ** 2) - 0.22 * (sa / hw);
  const shadeB = 0.3 * (1 - (db / hw) ** 2) - 0.16 * (sb / hw);
  const inA = da < hw;
  const inB = db < hw;
  const gap = hw + 0.85;
  if (inA && (aOver || db >= gap)) return [1, shadeA];
  if (inB && (!aOver || da >= gap)) return [1, shadeB];
  if (da < gap || db < gap) return [2, 0];
  return [0, 0];
}

const WALLS: Record<string, WallStyle> = {
  // 돌벽: 쌓은 돌
  '#': {
    pal: STONE_WALL,
    face: (u, v, side, ix, iy, w) => {
      let t = stoneBlock(side ? 0.36 : 0.62, u, v, 10, w, side);
      if (v > w.hgt - 4 && hash2(ix, iy, w.seed) < 0.1) return tone(STONE_WALL, t - 0.2, ix, iy);
      t += speckle(ix, iy, w.seed) * 0.2;
      return tone(STONE_WALL, t, ix, iy, 0.7);
    },
    top: (a, b, ix, iy, w) => tone(STONE_WALL, 0.76 + capEdge(a, b, w, true) + speckle(ix, iy, w.seed) * 0.2 + (hash2(ix >> 2, iy >> 1, w.seed + 4) - 0.5) * 0.08, ix, iy, 0.7),
  },
  // 낮은 돌담: 갓돌 + 켈트 매듭 띠 + 아랫돌 (R2)
  h: {
    pal: LOW_WALL,
    face: (u, v, side, ix, iy, w) => {
      const lit = side ? -0.24 : 0;
      let t: number;
      if (v < 3.2) t = 0.84 + lit + (v < 1 ? 0.08 : 0);
      else if (v < 4.2) t = 0.1;
      else if (v < 16.2) {
        const [kind, k] = knotAt(u, v - 4.2);
        // 담쟁이 (변형 3, 띠 아래쪽 일부)
        if (w.variant === 3 && hash2(Math.floor(u / 3), Math.floor(v / 3), w.seed + side) < 0.22 && v > 8) return tone(IVY, 0.35 + grain(ix, iy, w.seed) * 0.6, ix, iy);
        if (kind === 1) t = 0.66 + lit + k;
        else if (kind === 2) t = 0.04;
        else t = 0.16 + lit * 0.3;
      } else if (v < 17.2) t = 0.1;
      else t = 0.54 + lit - (v > w.hgt - 1 ? 0.12 : 0) + (Math.floor((u + (side ? 5 : 0)) / 8) % 2 ? 0.04 : -0.04) - (u % 8 < 0.7 ? 0.25 : 0);
      return tone(LOW_WALL, t + speckle(ix, iy, w.seed) * 0.14, ix, iy, 0.6);
    },
    top: (a, b, ix, iy, w) => {
      let t = 0.86 + capEdge(a, b, w, true) + speckle(ix, iy, w.seed) * 0.16;
      if (w.variant === 3 && hash2(ix >> 1, iy >> 1, w.seed + 9) < 0.06) return MOSS;
      t += (hash2(ix >> 2, iy >> 1, w.seed + 4) - 0.5) * 0.08;
      return tone(LOW_WALL, t, ix, iy, 0.6);
    },
  },
  // 신전 벽: 밝은 돌 + 금색 띠
  H: {
    pal: TEMPLE,
    face: (u, v, side, ix, iy, w) => {
      const lit = side ? -0.3 : 0;
      if (v >= 3 && v < 7) {
        const key = Math.floor(u) % 6 === 0 || ((v < 4 || v > 6) && Math.floor(u) % 2 === 0);
        return tone(GOLD, 0.66 + lit * 0.8 - (key ? 0.22 : 0) + (v < 4 ? 0.12 : 0), ix, iy, 0.5);
      }
      let t: number;
      if (v < 3) t = 0.86 + lit;
      else if (v < 8) t = 0.3 + lit;
      else if (v > w.hgt - 4) t = 0.6 + lit - (v > w.hgt - 1 ? 0.12 : 0);
      else t = stoneBlock(0.76 + lit, u, v - 8, 14, w, side, 0.07, 0.04);
      return tone(TEMPLE, t + speckle(ix, iy, w.seed) * 0.12, ix, iy, 0.6);
    },
    top: (a, b, ix, iy, w) => tone(TEMPLE, 0.84 + capEdge(a, b, w, true) + speckle(ix, iy, w.seed) * 0.12, ix, iy, 0.6),
  },
  // 나무벽: 통나무를 눕혀 쌓음 (모서리에는 통나무 끝)
  W: {
    pal: LOGS,
    face: (u, v, side, ix, iy, w) => {
      const lit = side ? -0.26 : 0;
      const row = Math.floor(v / 8);
      const vv = v - row * 8;
      const corner = !(w.links & 1) && !(w.links & 2);
      // 모서리의 통나무 끝 (왼쪽 면은 짝수 줄, 오른쪽 면은 홀수 줄)
      if (corner && (side === 0 ? u > 26.5 && row % 2 === 0 : u < 5.5 && row % 2 === 1)) {
        const cu = side === 0 ? 30 : 2;
        const r = Math.hypot((u - cu) / 3.4, (vv - 4) / 3.6);
        if (r < 1) return tone(LOG_END, 0.7 + lit + Math.sin(r * 9) * 0.1 - r * 0.15, ix, iy, 0.5);
      }
      if (vv < 0.9) return tone(LOGS, 0.1, ix, iy);
      const k = (vv - 4.4) / 3.6;
      let t = 0.66 + lit - k * 0.24 - Math.abs(k) * 0.08;
      t += (hash2(Math.floor(u / 5 + row * 2.3), Math.floor(vv * 1.3), w.seed) - 0.5) * 0.16;
      if (hash2(Math.floor(u / 9), row, w.seed + side) < 0.06 && Math.abs(vv - 4) < 1.4 && Math.floor(u) % 9 < 2) t -= 0.3;
      return tone(LOGS, t + grain(ix, iy, w.seed) * 0.1, ix, iy, 0.6);
    },
    top: (a, b, ix, iy, w) => {
      const alongA = (w.links & 5) !== 0 || (w.links & 10) === 0;
      const across = alongA ? b : a;
      const log = Math.floor(across * 4);
      const f = across * 4 - log;
      let t = 0.74 - Math.abs(f - 0.5) * 0.3 + capEdge(a, b, w, false);
      if (f < 0.12) t -= 0.3;
      t += (hash2(log, Math.floor((alongA ? a : b) * 6), w.seed) - 0.5) * 0.12;
      return tone(LOGS, t + grain(ix, iy, w.seed) * 0.1, ix, iy, 0.6);
    },
  },
  // 던전 벽: 크고 거친 어두운 돌, 금과 얼룩
  D: {
    pal: DUNGEON,
    face: (u, v, side, ix, iy, w) => {
      let t = stoneBlock(side ? 0.36 : 0.6, u, v, 13.4, w, side, 0.14, 0.1);
      t -= Math.max(0, hash2(Math.floor(u / 6), Math.floor(v / 6), w.seed + 5) - 0.7) * 0.6;
      if (v > w.hgt - 5 && hash2(ix, iy, w.seed + 1) < 0.12) return mixc(DUNGEON[3]!, MOSS, 0.35);
      return tone(DUNGEON, t + speckle(ix, iy, w.seed) * 0.24, ix, iy, 0.7);
    },
    top: (a, b, ix, iy, w) => tone(DUNGEON, 0.24 + capEdge(a, b, w, false) * 1.5 + speckle(ix, iy, w.seed) * 0.28, ix, iy, 0.8),
  },
  // 동굴 벽: 깎인 바위 면
  K: {
    pal: CAVE_WALL,
    face: (u, v, side, ix, iy, w) => tone(CAVE_WALL, rockFace(u, v, side, w) + speckle(ix, iy, w.seed) * 0.2, ix, iy, 0.7),
    top: (a, b, ix, iy, w) => tone(CAVE_WALL, 0.2 + capEdge(a, b, w, false) * 1.5 + speckle(ix, iy, w.seed) * 0.3, ix, iy, 0.8),
  },
  // 심연의 벽: 보랏빛 검은 돌과 빛나는 금
  X: {
    pal: ABYSS,
    face: (u, v, side, ix, iy, w) => {
      const glowCrack = crackAt(u, v, w.seed + side * 13);
      if (glowCrack > 0) return tone(ABYSS_GLOW, glowCrack - side * 0.2, ix, iy, 0.5);
      const t = stoneBlock(side ? 0.36 : 0.58, u, v, 13.4, w, side, 0.12, 0.1);
      return tone(ABYSS, t + speckle(ix, iy, w.seed) * 0.22, ix, iy, 0.7);
    },
    top: (a, b, ix, iy, w) => tone(ABYSS, 0.2 + capEdge(a, b, w, false) * 1.5 + speckle(ix, iy, w.seed) * 0.26, ix, iy, 0.8),
  },
};

/** 동굴 벽 면: 보로노이로 깎인 바위 면마다 기울기를 달리한 명암 */
function rockFace(u: number, v: number, side: number, w: WallCtx): number {
  const cell = 7;
  const gx = Math.floor(u / cell);
  const gy = Math.floor(v / cell);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cy = gy + j;
      // 경계(u=0,32)에서 같은 점이 되도록 가로 칸 번호는 타일 안에서 되풀이
      const wrap = ((cx % 5) + 5) % 5;
      const px = (cx + 0.15 + 0.7 * hash2(wrap, cy, w.ch.charCodeAt(0) + side)) * cell;
      const py = (cy + 0.15 + 0.7 * hash2(wrap, cy, 77 + side)) * cell;
      const d = (u - px) ** 2 + (v - py) ** 2;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = wrap * 31 + cy;
      } else if (d < d2) d2 = d;
    }
  }
  let t = (side ? 0.34 : 0.58) + (hash2(id, side, 5) - 0.5) * 0.3;
  if (Math.sqrt(d2) - Math.sqrt(d1) < 0.8) t -= 0.22;
  if (v > w.hgt - 2) t -= 0.12;
  return t;
}

/** 빛나는 금 (심연 벽): 금 위면 밝기, 아니면 0 */
function crackAt(u: number, v: number, seed: number): number {
  const r = seeded(seed);
  for (let n = 0; n < 2; n++) {
    const x0 = 4 + r() * 24;
    const y0 = 4 + r() * 10;
    const len = 10 + r() * 14;
    const ang = 1.1 + r() * 0.9;
    const t = ((u - x0) * Math.cos(ang) + (v - y0) * Math.sin(ang)) / len;
    if (t < 0 || t > 1) continue;
    const off = (u - x0) * -Math.sin(ang) + (v - y0) * Math.cos(ang) + Math.sin(t * 9 + n) * 1.2;
    if (Math.abs(off) < 0.6) return 0.85;
    if (Math.abs(off) < 1.4) return 0.35;
  }
  return 0;
}

/**
 * 벽 한 칸을 픽셀 버퍼로 만듭니다. 크기는 TILE_W x (TILE_H + WALL_H) (CSS), 타일 꼭대기 - WALL_H 에 그립니다.
 * links: 같은 높이 이상의 벽이 있는 이웃 방향 비트 (1: x+1, 2: y+1, 4: x-1, 8: y-1) — 가려지는 면을 생략하고
 * 윗면이 이어지게 합니다. sconce: 벽에 횃불 받침을 붙임 (불꽃은 렌더러가 매 프레임 그림)
 */
export function buildWall(ch: string, scale = 1, variant = 0, links = 0, sconce = false): Pix {
  const info = tileInfo(ch);
  const style = WALLS[ch] ?? WALLS['#']!;
  const hgt = info.low ? LOW_WALL_H : WALL_H;
  const T0 = WALL_H - hgt;
  const v4 = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const w: WallCtx = { ch, variant: v4, seed: ch.charCodeAt(0) * 131 + v4 * 977 + 3, hgt, links };
  const p = new Pix({ left: 0, top: 0, w: TILE_W, h: TILE_H + WALL_H }, Math.max(1, Math.round(scale)));
  const showL = !(links & 2);
  const showR = !(links & 1);
  const pal = style.pal;
  const outline = pal[0]!;
  p.paint(0, 0, TILE_W, TILE_H + WALL_H, (x, y, ix, iy) => {
    const X = x - HALF_W;
    const Y = y - T0;
    const a = (X / HALF_W + Y / HALF_H) / 2;
    const b = (Y / HALF_H - X / HALF_W) / 2;
    if (a >= 0 && a <= 1 && b >= 0 && b <= 1) return style.top(a, b, ix, iy, w);
    // 뒤쪽 모서리가 열려 있으면 바깥 외곽선
    if (Y < HALF_H + 1 && ((!(links & 4) && a < 0 && a > -1.1 / TILE_W && b >= 0 && b <= 1) || (!(links & 8) && b < 0 && b > -1.1 / TILE_W && a >= 0 && a <= 1))) return outline;
    if (x < HALF_W) {
      if (!showL) return null;
      const v = y - (T0 + HALF_H + x / 2);
      if (v < 0 || v >= hgt) return null;
      if (x < 1 && !(links & 4)) return outline;
      const c = style.face(x, v, 0, ix, iy, w);
      // 앞 모서리는 빛을 받아 살짝 밝게
      return x > HALF_W - 1 && showR ? mixc(c, pal[pal.length - 1]!, 0.25) : c;
    }
    if (!showR) return null;
    const u = x - HALF_W;
    const v = y - (T0 + TILE_H - u / 2);
    if (v < 0 || v >= hgt) return null;
    if (u > HALF_W - 1 && !(links & 8)) return outline;
    return style.face(u, v, 1, ix, iy, w);
  });
  // 횃불 받침은 보이는 앞면에만 (앞면이 다 가려지면 렌더러가 뒤쪽 불꽃만 그림)
  if (sconce && (showL || showR)) wallSconce(p, showL ? 0 : 1, T0);
  return p;
}

/** 벽 횃불 받침 (쇠 받침 + 나무 손잡이). 불꽃은 면 가운데 위 (렌더러와 같은 자리) */
function wallSconce(p: Pix, side: number, T0: number): void {
  const l = p.layer();
  const x = side === 0 ? HALF_W / 2 : HALF_W * 1.5;
  const y = T0 + 36;
  const iron = (v: number, _t: number, _k: number, ix: number, iy: number) => tone(IRON, v + 0.1, ix, iy);
  rod(l, x - 2, y + 9, 1.1, x + 2, y + 9 + (side ? -2 : 2), 1.1, iron);
  rod(l, x, y + 10, 1, x, y + 3, 1, iron);
  rod(l, x, y + 8, 1.4, x, y, 1.2, barkFn(POST_WOOD, 5));
  lathe(l, x, y + 1, 3, (h) => 1.6 + h * 0.5, (q) => tone(q.top ? GLASS : IRON, q.top ? 0.5 : q.v, q.ix, q.iy));
  stamp(p, l, IRON);
}

const wallCache = new Map<string, HTMLCanvasElement>();
/** 벽 문자·배율·이웃 연결마다 처음 만든 그림 (예산을 넘긴 프레임에 잠깐 대신 씀) */
const standIns = new Map<string, HTMLCanvasElement>();

/**
 * 벽 그림 (캐시). 화면에는 drawImage(canvas, 타일 꼭대기 x - HALF_W, 타일 꼭대기 y - WALL_H, TILE_W, TILE_H + WALL_H).
 * now(프레임 시각)를 주면 한 프레임에 새로 만드는 시간을 제한하고, 넘치면 같은 벽·같은 이웃 연결의 다른 변형을 잠깐 씁니다.
 */
export function wallCanvas(ch: string, scale = 1, variant = 0, links = 0, sconce = false, now?: number): HTMLCanvasElement {
  const s = Math.max(1, Math.round(scale));
  const key = `${ch}:${s}:${((variant % VARIANTS) + VARIANTS) % VARIANTS}:${links & 15}:${sconce ? 1 : 0}`;
  let c = wallCache.get(key);
  if (c) return c;
  // 대신 쓸 그림은 이웃 연결이 같은 것 (면이 빠지거나 겹치지 않게), 변형만 다름
  const standKey = `${ch}:${s}:${links & 15}:${sconce ? 1 : 0}`;
  const stand = standIns.get(standKey);
  if (stand && !buildAllowed(now)) return stand;
  c = buildWall(ch, s, variant, links, sconce).toCanvas();
  wallCache.set(key, c);
  if (!stand) standIns.set(standKey, c);
  return c;
}
