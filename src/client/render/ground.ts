// 바닥 그리기: 맵 바닥을 256px 조각으로 미리 구워 두고(LRU), 물·성수·용암만 매 프레임 움직입니다.
// 조각은 굽기 작업자(bake-worker.ts)가 화면 밖 스레드에서 굽고, 아직 오지 않은 조각 자리에는 맵 전체의 흐린 밑그림을 깝니다.
// 조각은 픽셀마다 계산합니다: 재질 고르기(노이즈로 흔들린 유기적 경계) → 무늬 + 큰 얼룩 →
// 경계 효과(흙길 어두운 테두리, 물가 거품, 용암 그을음) → 풀잎 포기 → 장식(돌멩이·잔가지·낙엽·꽃·고사리·뼈)
// → 돌 단상 계단 옆면 → 성수 샘의 금 테두리.
// 텍셀 하나 = CSS 1px. 조각 캔버스는 실제 화면 픽셀 해상도로 만들고, 정수 배율이면 텍셀을 그대로 늘려 또렷하게,
// 소수 배율이면 부드럽게 늘립니다 (들쭉날쭉한 점보다 고른 점이 낫기 때문).
import type { MapView } from '../../shared/protocol';
import { disposeImage, pixelsToCanvas, type BakeMap, type BakedImage, type BakedPixels } from './bake-types';
import type { Baker } from './baker';
import { makeCanvas } from './iso';
import { hashU32, periodicNoise, rng, smooth } from './noise';
import {
  ALL_TEXTURES,
  EDGE,
  STEP_JOINT,
  STEP_LIT,
  STEP_SHADE,
  TEX_H,
  TEX_W,
  groundTexture,
  hasGroundTexture,
  liquidTexture,
  paletteFor,
  rgba32,
  type GroundVariant,
} from './groundtex';
import {
  CHUNK,
  DECO,
  EXCLUDED,
  GROUND,
  GROUND_COUNT,
  Lru,
  MARGIN_PER_PX,
  MATERIALS,
  MIXED,
  SOLID,
  STEP_D,
  STEP_DROP,
  STEP_H,
  STEPS,
  TUFT_AMP,
  blendPoint,
  buildGroundGrid,
  chunkKey,
  chunksByDistance,
  coversEdge,
  daisLevel,
  findPools,
  liquidBit,
  liquidCover,
  mapWorldBounds,
  stepHit,
  tileRangeFor,
  type BlendOut,
  type GroundGrid,
  type StepHit,
} from './terrain';
import { ambienceFor } from './ambience';

const VOID = GROUND.VOID;
const LIQ = Uint8Array.from(MATERIALS, (m) => (m.liquid ? 1 : 0));
const BUILT = Uint8Array.from(MATERIALS, (m) => (m.built ? 1 : 0));
const TUFTS = Uint8Array.from(MATERIALS, (m) => (m.tufts ? 1 : 0));
const RIM = Uint8Array.from(MATERIALS, (m) => (m.rim ? 1 : 0));

/** 조각 둘레 여유 (경계 효과·풀잎이 이웃 조각과 똑같이 나오도록) */
const APRON = 8;
/** 조각 출력 크기: 한 변 CHUNK + 2 (이웃 조각과 2텍셀 겹쳐서 소수 배율에서도 틈이 없게) */
const OW = CHUNK + 2;
/** 재질 버퍼 크기 */
const BW = OW + APRON * 2;
/** 경계 거리 저장 단위: 1px = 16 */
const PX = 16;
/** 작업자 없이 그 자리에서 구울 때 한 프레임에 미리 굽는 조각 수와 시간 한도 */
const PREFETCH_PER_FRAME = 2;
const PREFETCH_MS = 6;
/** 미리 굽는 둘레 너비 (px) */
const PREFETCH_MARGIN = 192;
/** 조각 캐시 메모리 한도 (바이트, 화면 배율 1 마다): 배율 1 에서 약 150 조각, 2 에서 약 75 조각 (맵 하나 반) */
const CACHE_BYTES_PER_DPR = 40 * 1024 * 1024;
/** 바닥면 1px 이 타일 좌표로 얼마인지 (곧은 경계에 수직으로 잰 값) */
const TILE_PER_PX = MARGIN_PER_PX / 2;

const VOID_RGBA = rgba32('#05050a');

// ───────────────────────── 공통 잡음 ─────────────────────────

/** 경계 흔들림 잡음 (256×256 주기, -1~1) */
let NOISE: Float32Array | null = null;
/** 풀잎 포기 (세로로 가는 뾰족한 줄, 0~1) */
let BLADE: Float32Array | null = null;
/** 큰 얼룩 단계 디더 (64×64, 0~1) */
let DITHER: Float32Array | null = null;
/** 부드러운 보간 표 */
const SM32 = Float32Array.from({ length: 32 }, (_, i) => smooth((i + 0.5) / 32));
const SM16 = Float32Array.from({ length: 16 }, (_, i) => smooth((i + 0.5) / 16));

function initNoise(): void {
  if (NOISE) return;
  const a = periodicNoise(256, 256, 32, 32, 901);
  const b = periodicNoise(256, 256, 16, 16, 902);
  const c = periodicNoise(256, 256, 8, 8, 903);
  const d = periodicNoise(256, 256, 4, 4, 904);
  NOISE = new Float32Array(256 * 256);
  for (let i = 0; i < NOISE.length; i++) {
    const v = a[i]! * 0.42 + b[i]! * 0.3 + c[i]! * 0.18 + d[i]! * 0.1;
    NOISE[i] = Math.max(-1, Math.min(1, (v - 0.5) * 3.2));
  }
  // 풀잎: 세로 1px 짜리 뾰족한 줄이 포기(덩어리)를 이루며 모여 있음
  BLADE = new Float32Array(256 * 256);
  const clump = periodicNoise(256, 256, 8, 8, 905);
  for (let x = 0; x < 256; x++) {
    const R = rng(7000 + x);
    let y = Math.floor(R() * 6);
    while (y < 256) {
      const len = 2 + Math.floor(R() * 4);
      const amp = 0.45 + R() * 0.55;
      for (let k = 0; k < len; k++) {
        // 위로 갈수록 가늘어짐 (끝이 뾰족)
        const t = 1 - k / len;
        const i = ((y + k) & 255) * 256 + x;
        if (clump[i]! > 0.45) BLADE[i] = Math.max(BLADE[i]!, amp * (0.5 + 0.5 * t));
      }
      y += len + 1 + Math.floor(R() * 5);
    }
  }
  DITHER = new Float32Array(64 * 64);
  const R = rng(906);
  for (let i = 0; i < DITHER.length; i++) DITHER[i] = R();
}

// ───────────────────────── 맵별 준비 ─────────────────────────

interface CompiledPalette {
  col: Uint32Array;
  /** 색띠마다 가장 밝은 단계 */
  max: Uint8Array;
  /** 큰 얼룩 값(0~255) → 밝기 단계 이동 */
  lut: Float32Array;
  shift: number;
}

function compilePalette(mat: number, variant: GroundVariant): CompiledPalette {
  const spec = paletteFor(mat, variant);
  const col = new Uint32Array(64);
  const max = new Uint8Array(4);
  spec.ramps.forEach((ramp, r) => {
    ramp.forEach((hex, l) => (col[(r << 4) | l] = rgba32(hex)));
    max[r] = ramp.length - 1;
  });
  const lut = new Float32Array(256);
  const pts = spec.macro;
  for (let i = 0; i < 256; i++) {
    const m = (i / 255) * 2 - 1;
    let v = pts[0]![1];
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1]!;
      const [x1, y1] = pts[k]!;
      if (m >= x0 && m <= x1) v = y0 + ((y1 - y0) * (m - x0)) / (x1 - x0 || 1);
      else if (m > x1) v = y1;
    }
    lut[i] = v;
  }
  return { col, max, lut, shift: spec.shift };
}

/** 둥근 성수 샘 (화면 좌표) */
interface RoundPool {
  /** 가운데 (월드 화면 px) */
  cx: number;
  cy: number;
  /** 물 타원 반지름 (가로 a, 세로 b = a/2) */
  a: number;
  b: number;
  /** 금 톱니 수 */
  teeth: number;
  /** 웅덩이 둘레 바닥 */
  rim: number;
}

/** 금 테두리: 물 타원 반지름의 배수로 안쪽 끝, 고리 띠 바깥 끝, 톱니 끝 */
const RIM_IN = 1.0;
const RIM_BAND = 1.2;
const RIM_TIP = 1.44;

interface GroundMap {
  key: string;
  grid: GroundGrid;
  variant: GroundVariant;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** 조각을 구울 무늬·팔레트까지 준비했는지 (작업자가 굽는 동안 화면 쪽은 격자만) */
  bakeable: boolean;
  tex: (Uint8Array | null)[];
  pal: (CompiledPalette | null)[];
  /** 칸마다 비칠 수 있는 액체 비트 */
  cover: Uint8Array;
  liquidBits: number;
  pools: RoundPool[];
  /** 둥근 샘으로 그리는 성수 칸 */
  roundCell: Uint8Array;
  /** 앞쪽 변이 드러난 단상 칸 [x, y] */
  daisFront: [number, number][];
  rimCols: Uint32Array;
  isDais: (x: number, y: number) => boolean;
}

function tilesKey(map: BakeMap): string {
  let h = 2166136261;
  for (const row of map.tiles) {
    for (let i = 0; i < row.length; i++) h = Math.imul(h ^ row.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 10, 16777619);
  }
  return `${map.id}:${map.tiles.length}:${(h >>> 0).toString(36)}`;
}

/**
 * 맵 바닥 준비: 지형 격자, 액체 자리, 성수 샘, 단상 앞 변. bake 가 true 면 조각을 구울 무늬와 팔레트까지
 * (작업자가 굽는 동안 화면 쪽은 격자만 있으면 됨).
 */
function prepareGroundMap(map: BakeMap, key: string, bake = true): GroundMap {
  initNoise();
  const grid = buildGroundGrid(map.tiles);
  const variant = ambienceFor(map.id, map.dark).palette;
  const tex: (Uint8Array | null)[] = new Array(GROUND_COUNT).fill(null);
  const pal: (CompiledPalette | null)[] = new Array(GROUND_COUNT).fill(null);
  const need = new Set(grid.used);
  // 풀 팔레트는 다른 바닥 위의 장식(꽃·고사리)과 풀잎 포기 색에도 씀
  need.add(GROUND.GRASS);
  for (const m of bake ? need : []) {
    if (m === VOID || m === EXCLUDED || LIQ[m]) continue;
    tex[m] = groundTexture(m, variant);
    pal[m] = compilePalette(m, variant);
  }
  const cover = liquidCover(grid);
  let liquidBits = 0;
  for (let i = 0; i < cover.length; i++) liquidBits |= cover[i]!;
  // 성수: 빈칸 없는 정사각형 묶음은 둥근 샘 (R3), 나머지는 섞인 모양 그대로 + 금 띠
  const pools: RoundPool[] = [];
  const roundCell = new Uint8Array(grid.w * grid.h);
  // 계단을 셀 때 단상으로 치는 칸: 단상 + 단상 안에 놓인 성수 샘 (샘 둘레로 계단이 내려가지 않게)
  const raised = new Uint8Array(grid.w * grid.h);
  for (let i = 0; i < raised.length; i++) raised[i] = grid.blend[i] === GROUND.DAIS ? 1 : 0;
  for (const p of findPools(grid)) {
    if (p.rim === GROUND.DAIS) for (const c of p.cells) raised[c] = 1;
    if (p.r <= 0) continue;
    const a = p.r * 0.95 * 32 * Math.SQRT2;
    pools.push({ cx: (p.u - p.v) * 32, cy: (p.u + p.v) * 16, a, b: a / 2, teeth: Math.max(12, Math.round(p.r * 18)), rim: p.rim });
    for (const c of p.cells) roundCell[c] = 1;
  }
  const isDais = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && raised[y * grid.w + x] === 1;
  const daisFront: [number, number][] = [];
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) if (isDais(x, y) && (!isDais(x, y + 1) || !isDais(x + 1, y))) daisFront.push([x, y]);
  const rim = variant === 'r1' ? EDGE.rimDusk : EDGE.rimDay;
  return {
    key,
    grid,
    variant,
    bounds: mapWorldBounds(grid.w, grid.h),
    bakeable: bake,
    tex,
    pal,
    cover,
    liquidBits,
    pools,
    roundCell,
    daisFront,
    rimCols: Uint32Array.from(rim, (c) => rgba32(c)),
    isDais,
  };
}

// ───────────────────────── 조각 굽기 ─────────────────────────

// 조각 하나를 굽는 동안 쓰는 작업 버퍼 (한 번 만들어 계속 씀)
const cls = new Uint8Array(BW * BW);
const sec = new Uint8Array(BW * BW);
const mrg = new Uint8Array(BW * BW);
/** 조각 전체의 큰 얼룩 값 (0~255, 줄마다 macroRow 로 채움) */
const MACRO = new Uint8Array(OW * OW);
const L1ROW = new Float32Array(OW / 32 + 4);
const L2ROW = new Float32Array(OW / 16 + 4);
const OUT = new Uint32Array(OW * OW);
const BO: BlendOut = { mat: 0, second: 0, margin: 0 };
const HIT: StepHit = { kind: 'top', level: 0, side: 0, row: 0, along: 0 };

let curX = 0;
let curY = 0;

/** 재질마다 다른 자리의 잡음으로 경계를 흔듦 + 풀은 풀잎 포기만큼 더 밀고 들어감 */
function perturb(mat: number, amp: number): number {
  const n = NOISE![(((curY + mat * 59) & 255) << 8) | ((curX + mat * 37) & 255)]!;
  let v = amp * n;
  if (TUFTS[mat]) v += TUFT_AMP * BLADE![((curY & 255) << 8) | (curX & 255)]!;
  return v;
}

/** 경계 거리 (px) → 저장 값 */
function marginCode(px: number): number {
  const q = px * PX;
  return q >= 254 ? 254 : q < 0 ? 0 : q | 0;
}

/**
 * 1단계: 픽셀마다 재질, 두 번째 재질, 경계까지 거리 (조각 둘레 APRON 포함).
 * 한 재질로만 덮인 쌍대 칸을 지나는 동안은 픽셀을 하나씩 보지 않고 한꺼번에 채웁니다.
 */
function classify(gm: GroundMap, bx: number, by: number): void {
  const g = gm.grid;
  const w = g.w;
  const h = g.h;
  const dual = g.dual;
  const blend = g.blend;
  const base = g.base;
  const DW = w + 1;
  for (let py = 0; py < BW; py++) {
    const sy = by + py;
    // 픽셀 중심의 타일 좌표 ×128 (정수로 정확히 계산): 오른쪽으로 한 칸 갈 때 a += 2, b -= 2
    let a = 2 * bx + 4 * sy + 3;
    let b = 4 * sy - 2 * bx + 1;
    let p = py * BW;
    let px = 0;
    while (px < BW) {
      const i0 = (a - 64) >> 7;
      const j0 = (b - 64) >> 7;
      // 이 쌍대 칸에 머무는 픽셀 수
      const ra = (128 - ((a - 64) & 127) + 1) >> 1;
      const rb = (((b - 64) & 127) >> 1) + 1;
      let run = ra < rb ? ra : rb;
      if (run > BW - px) run = BW - px;
      if (i0 < -1 || j0 < -1 || i0 >= w || j0 >= h) {
        cls.fill(VOID, p, p + run);
        sec.fill(VOID, p, p + run);
        mrg.fill(255, p, p + run);
      } else {
        const d = dual[(j0 + 1) * DW + i0 + 1]!;
        if (d !== MIXED) {
          cls.fill(d, p, p + run);
          sec.fill(d, p, p + run);
          mrg.fill(255, p, p + run);
        } else {
          for (let r = 0; r < run; r++) classifyPixel(blend, base, w, h, i0, j0, a + 2 * r, b - 2 * r, p + r, bx + px + r, sy);
        }
      }
      p += run;
      px += run;
      a += 2 * run;
      b -= 2 * run;
    }
  }
}

/** 여러 재질이 만나는 쌍대 칸 안의 픽셀 하나 */
function classifyPixel(blend: Uint8Array, base: Uint8Array, w: number, h: number, i0: number, j0: number, a: number, b: number, p: number, sx: number, sy: number): void {
  const tx = a >> 7;
  const ty = b >> 7;
  const own = tx < 0 || ty < 0 || tx >= w || ty >= h ? VOID : blend[ty * w + tx]!;
  if (own === VOID) {
    cls[p] = VOID;
    sec[p] = VOID;
    mrg[p] = 255;
    return;
  }
  if (own === GROUND.DAIS) {
    // 단상은 칸 모양 그대로 또렷하게 (앞쪽 변은 계단이 맡고, 뒤쪽 변에는 줄눈 선)
    cls[p] = GROUND.DAIS;
    const fu = (a & 127) / 128;
    const fv = (b & 127) / 128;
    const nu = tx > 0 ? blend[ty * w + tx - 1]! : VOID;
    const nv = ty > 0 ? blend[(ty - 1) * w + tx]! : VOID;
    let m = 255;
    let s2: number = GROUND.DAIS;
    if (nu !== GROUND.DAIS && fu / TILE_PER_PX < 254 / PX) {
      m = marginCode(fu / TILE_PER_PX);
      s2 = nu === EXCLUDED ? GROUND.DAIS : nu;
    }
    if (nv !== GROUND.DAIS && fv / TILE_PER_PX < m / PX) {
      m = marginCode(fv / TILE_PER_PX);
      s2 = nv === EXCLUDED ? GROUND.DAIS : nv;
    }
    sec[p] = s2;
    mrg[p] = s2 === GROUND.DAIS ? 255 : m;
    return;
  }
  const c00 = i0 >= 0 && j0 >= 0 ? blend[j0 * w + i0]! : VOID;
  const c10 = i0 + 1 < w && j0 >= 0 ? blend[j0 * w + i0 + 1]! : VOID;
  const c01 = i0 >= 0 && j0 + 1 < h ? blend[(j0 + 1) * w + i0]! : VOID;
  const c11 = i0 + 1 < w && j0 + 1 < h ? blend[(j0 + 1) * w + i0 + 1]! : VOID;
  curX = sx;
  curY = sy;
  if (!blendPoint(c00, c10, c01, c11, ((a - 64) & 127) / 128, ((b - 64) & 127) / 128, BO, perturb)) {
    const m = base[ty * w + tx]!;
    cls[p] = m;
    sec[p] = m;
    mrg[p] = 255;
    return;
  }
  let mat = BO.mat;
  let second = BO.second;
  // 단상 칸이 아닌 곳으로는 단상이 번지지 않음
  if (mat === GROUND.DAIS) {
    mat = second === GROUND.DAIS ? base[ty * w + tx]! : second;
    second = GROUND.DAIS;
  }
  cls[p] = mat;
  sec[p] = second;
  mrg[p] = mat === second ? 255 : marginCode(BO.margin / MARGIN_PER_PX);
}

/** 둥근 성수 샘: 물 타원 안은 성수, 타원 밖으로 남은 성수 칸 모서리는 둘레 바닥 */
function classifyPools(gm: GroundMap, bx: number, by: number): void {
  if (!gm.pools.length) return;
  const g = gm.grid;
  for (const pl of gm.pools) {
    const rx = pl.a * RIM_TIP + 4;
    const ry = pl.b * RIM_TIP + 4;
    const x0 = Math.max(0, Math.floor(pl.cx - rx) - bx);
    const x1 = Math.min(BW - 1, Math.ceil(pl.cx + rx) - bx);
    const y0 = Math.max(0, Math.floor(pl.cy - ry) - by);
    const y1 = Math.min(BW - 1, Math.ceil(pl.cy + ry) - by);
    for (let py = y0; py <= y1; py++) {
      const sy = by + py + 0.5;
      const dy = (sy - pl.cy) / pl.b;
      for (let px = x0; px <= x1; px++) {
        const p = py * BW + px;
        const sx = bx + px + 0.5;
        const dx = (sx - pl.cx) / pl.a;
        const rho = Math.sqrt(dx * dx + dy * dy);
        if (rho <= RIM_IN) {
          cls[p] = GROUND.HOLY;
          sec[p] = pl.rim;
          // 물가까지 거리 (px, 대략): 세로 반지름 기준
          mrg[p] = marginCode((RIM_IN - rho) * pl.b);
          continue;
        }
        if (cls[p] === GROUND.HOLY) {
          // 정사각형 샘 칸의 모서리: 둘레 바닥으로
          const tx = Math.floor((sx / 32 + sy / 16) / 2);
          const ty = Math.floor((sy / 16 - sx / 32) / 2);
          const i = tx >= 0 && ty >= 0 && tx < g.w && ty < g.h ? ty * g.w + tx : -1;
          if (i >= 0 && gm.roundCell[i]) {
            cls[p] = pl.rim;
            sec[p] = pl.rim;
            mrg[p] = 255;
          }
        }
      }
    }
  }
}

/**
 * 큰 얼룩 (주기 없음): 32px·16px 격자 값 잡음 두 겹을 한 줄씩 계산해 MACRO 의 oy 줄에 넣음.
 * 아주 부드러운 값이라 4px 마다 계산해서 채웁니다 (밝기 단계는 픽셀마다 디더로 고르므로 계단이 보이지 않음).
 */
function macroRow(x0: number, sy: number, oy: number): void {
  const j1 = sy >> 5;
  const t1 = SM32[sy & 31]!;
  const j2 = sy >> 4;
  const t2 = SM16[sy & 15]!;
  const i1s = x0 >> 5;
  const i2s = x0 >> 4;
  const n1 = ((x0 + OW) >> 5) - i1s + 2;
  const n2 = ((x0 + OW) >> 4) - i2s + 2;
  for (let k = 0; k < n1; k++) {
    const a = hashU32(i1s + k, j1, 31) / 4294967296;
    L1ROW[k] = a + (hashU32(i1s + k, j1 + 1, 31) / 4294967296 - a) * t1;
  }
  for (let k = 0; k < n2; k++) {
    const a = hashU32(i2s + k, j2, 32) / 4294967296;
    L2ROW[k] = a + (hashU32(i2s + k, j2 + 1, 32) / 4294967296 - a) * t2;
  }
  const o = oy * OW;
  for (let ox = 0; ox < OW; ox += 4) {
    const sx = x0 + ox + 2;
    const k1 = (sx >> 5) - i1s;
    const k2 = (sx >> 4) - i2s;
    const v1 = L1ROW[k1]! + (L1ROW[k1 + 1]! - L1ROW[k1]!) * SM32[sx & 31]!;
    const v2 = L2ROW[k2]! + (L2ROW[k2 + 1]! - L2ROW[k2]!) * SM16[sx & 15]!;
    // 두 겹 값 잡음은 가운데로 몰리므로 넓게 펴서 0~255
    const m = ((v1 * 0.65 + v2 * 0.35 - 0.5) * 2.3 + 0.5) * 255;
    const v = m < 0 ? 0 : m > 255 ? 255 : m | 0;
    const e = ox + 4 < OW ? ox + 4 : OW;
    for (let x = ox; x < e; x++) MACRO[o + x] = v;
  }
}

const FOAM = Uint32Array.from(EDGE.foam, (c) => rgba32(c));
const GOLD = Uint32Array.from(EDGE.gold, (c) => rgba32(c));
const CRUST = Uint32Array.from(EDGE.crust, (c) => rgba32(c));
const HOLY_EDGE = rgba32('#b4f0fa');
const LAVA_EDGE = rgba32('#ff8a24');

/** 색을 곱해서 어둡게 (f: 0~1) */
function dim(c: number, f: number): number {
  const r = (c & 255) * f;
  const g = ((c >>> 8) & 255) * f;
  const b = ((c >>> 16) & 255) * f;
  return ((c & 0xff000000) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

function noise01(sx: number, sy: number, o: number): number {
  return (NOISE![(((sy + o * 17) & 255) << 8) | ((sx + o * 29) & 255)]! + 1) * 0.5;
}

/** 무늬 + 큰 얼룩으로 고른 재질 색 (q = 조각 출력 안 자리, 큰 얼룩 값을 읽음) */
function texColour(gm: GroundMap, k: number, sx: number, sy: number, q: number): number {
  const t = gm.tex[k];
  const pl = gm.pal[k];
  if (!t || !pl) return VOID_RGBA;
  const code = t[((sy & (TEX_H - 1)) << 9) | (sx & (TEX_W - 1))]!;
  let lvl = code & 15;
  const ramp = code >> 4;
  if (ramp < pl.shift) {
    lvl += Math.floor(pl.lut[MACRO[q]!]! + DITHER![((sy & 63) << 6) | (sx & 63)]!);
    const mx = pl.max[ramp]!;
    lvl = lvl < 0 ? 0 : lvl > mx ? mx : lvl;
  }
  return pl.col[(ramp << 4) | lvl]!;
}

/** 땅 쪽 경계 효과 */
function edgePixel(gm: GroundMap, k: number, s2: number, m: number, c: number, sx: number, sy: number): number {
  if (LIQ[s2]) {
    if (s2 === GROUND.WATER) {
      // 젖은 물가: 물에 가까울수록 어둡게
      if (m < 1.2 * PX) return dim(c, 0.58);
      if (m < 2.6 * PX) return hashU32(sx, sy, 3) & 1 ? dim(c, 0.74) : dim(c, 0.86);
      return c;
    }
    if (s2 === GROUND.HOLY) {
      // 둥글지 않은 성수 묶음: 금 띠
      if (m < 1 * PX) return GOLD[0]!;
      if (m < 3 * PX) return GOLD[2 + (hashU32(sx, sy, 2) & 1)]!;
      if (m < 4 * PX) return GOLD[1]!;
      return c;
    }
    if (s2 === GROUND.LAVA) {
      if (m < 1.4 * PX) return CRUST[hashU32(sx, sy, 4) % 3]!;
      if (m < 3.5 * PX) return dim(c, (hashU32(sx, sy, 5) & 1 ? 0.45 : 0.6) + m / (PX * 12));
    }
    return c;
  }
  if (RIM[k] && TUFTS[s2] && coversEdge(s2, k)) {
    // 흙길의 풀 쪽 가장자리: 1~3px 어두운 테두리 + 그 안쪽 살짝 어두운 흙 (길이 패인 느낌, R1)
    const w = (1 + noise01(sx, sy, 3) * 2) * PX;
    if (m < w) return gm.rimCols[m < w - PX ? 0 : 1 + (hashU32(sx, sy, 6) & 1)]!;
    if (m < w + 2.5 * PX) return dim(c, 0.8 + ((hashU32(sx, sy, 7) & 3) === 0 ? 0.1 : 0));
    return c;
  }
  if (BUILT[k] && s2 !== k) {
    // 깐 바닥 가장자리: 1px 줄눈 선
    if (m < 0.9 * PX) return dim(c, 0.55);
    if (m < 1.8 * PX && k !== GROUND.DAIS) return dim(c, 0.82);
    return c;
  }
  if (k === GROUND.GRASS && BUILT[s2] && m < 0.8 * PX) return dim(c, 0.7);
  return c;
}

/** 액체 쪽: 대부분 투명(아래에 움직이는 물이 비침), 물가에만 거품·물보라 */
function liquidPixel(k: number, s2: number, m: number, sx: number, sy: number): number {
  if (m === 255 || LIQ[s2] || s2 === VOID) return 0;
  if (k === GROUND.WATER) {
    const h = hashU32(sx, sy, 8);
    const fw = (1 + noise01(sx, sy, 5) * 2.6) * PX;
    if (m < fw) return (h & 7) === 0 ? FOAM[2]! : (h & 3) === 1 ? FOAM[1]! : FOAM[0]!;
    if (m < fw + PX * 1.5) return (h & 3) === 0 ? FOAM[2]! : (h & 7) === 1 ? FOAM[0]! : (h & 7) === 2 ? FOAM[3]! : 0;
    if (m < fw + PX * 7 && h % 23 === 0) return h & 64 ? FOAM[0]! : FOAM[2]!;
    return 0;
  }
  if (k === GROUND.HOLY) return m < PX ? HOLY_EDGE : 0;
  if (k === GROUND.LAVA) return m < PX ? LAVA_EDGE : 0;
  return 0;
}

/** 2단계: 무늬 + 큰 얼룩 + 경계 효과로 색 칠하기 (같은 재질이 이어지는 동안은 팔레트를 다시 찾지 않음) */
function colour(gm: GroundMap, X0: number, Y0: number): void {
  const out = OUT;
  const dith = DITHER!;
  let lastK = -1;
  let tex: Uint8Array | null = null;
  let col: Uint32Array = EMPTY_COL;
  let lut: Float32Array = EMPTY_LUT;
  let maxs: Uint8Array = EMPTY_MAX;
  let shift = 0;
  for (let oy = 0; oy < OW; oy++) {
    const sy = Y0 + oy;
    macroRow(X0, sy, oy);
    const trow = (sy & (TEX_H - 1)) << 9;
    const drow = (sy & 63) << 6;
    let p = (oy + APRON) * BW + APRON;
    let q = oy * OW;
    for (let ox = 0; ox < OW; ox++, p++, q++) {
      const sx = X0 + ox;
      const k = cls[p]!;
      if (k === VOID) {
        out[q] = VOID_RGBA;
        continue;
      }
      if (LIQ[k]) {
        out[q] = liquidPixel(k, sec[p]!, mrg[p]!, sx, sy);
        continue;
      }
      if (k !== lastK) {
        lastK = k;
        const pl = gm.pal[k];
        tex = gm.tex[k] ?? null;
        col = pl ? pl.col : EMPTY_COL;
        lut = pl ? pl.lut : EMPTY_LUT;
        maxs = pl ? pl.max : EMPTY_MAX;
        shift = pl ? pl.shift : 0;
      }
      if (!tex) {
        out[q] = VOID_RGBA;
        continue;
      }
      const code = tex[trow | (sx & (TEX_W - 1))]!;
      const ramp = code >> 4;
      let lvl = code & 15;
      if (ramp < shift) {
        lvl += Math.floor(lut[MACRO[q]!]! + dith[drow | (sx & 63)]!);
        const mx = maxs[ramp]!;
        lvl = lvl < 0 ? 0 : lvl > mx ? mx : lvl;
      }
      let c = col[(ramp << 4) | lvl]!;
      const m = mrg[p]!;
      if (m !== 255) c = edgePixel(gm, k, sec[p]!, m, c, sx, sy);
      out[q] = c;
    }
  }
}

const EMPTY_COL = new Uint32Array(64);
const EMPTY_LUT = new Float32Array(256);
const EMPTY_MAX = new Uint8Array(4);

/** 출력 버퍼에 점 하나 (액체·공허 위에는 찍지 않음) */
function dot(X0: number, Y0: number, sx: number, sy: number, c: number): void {
  const ox = sx - X0;
  const oy = sy - Y0;
  if (ox < 0 || oy < 0 || ox >= OW || oy >= OW) return;
  const k = cls[(oy + APRON) * BW + ox + APRON]!;
  if (k === VOID || LIQ[k]) return;
  OUT[oy * OW + ox] = c;
}

/** 3단계: 풀 경계 위로 삐져나온 풀잎 (아래쪽 풀에서 위로 자람) */
function tufts(gm: GroundMap, X0: number, Y0: number): void {
  const gp = gm.pal[GROUND.GRASS];
  if (!gp) return;
  for (let py = APRON; py < BW - 1; py++) {
    const sy = Y0 - APRON + py;
    for (let px = APRON - 1; px < BW - APRON + 1; px++) {
      const p = py * BW + px;
      const k = cls[p]!;
      if (!TUFTS[k]) continue;
      const up = cls[p - BW]!;
      if (TUFTS[up] || up === VOID || LIQ[up] || up === GROUND.DAIS) continue;
      const sx = X0 - APRON + px;
      const h = hashU32(sx, sy, 91);
      if ((h & 15) >= 7) continue;
      const len = 1 + ((h >> 4) & 3) + ((h >> 6) & 1);
      const lean = (h >> 8) % 5 === 0 ? ((h >> 11) & 1 ? 1 : -1) : 0;
      for (let i = 1; i <= len; i++) {
        const x = sx + (i === len ? lean : 0);
        const y = sy - i;
        const ox = x - X0;
        const oy = y - Y0;
        if (ox < 0 || oy < 0 || ox >= OW || oy >= OW) continue;
        const q = (oy + APRON) * BW + ox + APRON;
        const kq = cls[q]!;
        if (TUFTS[kq] || kq === GROUND.DAIS || LIQ[kq] || kq === VOID) continue;
        OUT[oy * OW + ox] = gp.col[i === len ? ((h >> 9) & 1 ? 4 : 3) : i === 1 ? 2 : 3]!;
      }
    }
  }
}

// ───────────────────────── 장식 ─────────────────────────

function tone(base: number, d: number): number {
  const f = 1 + d;
  const r = Math.min(255, ((base >> 16) & 255) * f);
  const g = Math.min(255, ((base >> 8) & 255) * f);
  const b = Math.min(255, (base & 255) * f);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** 작은 돌멩이 (회갈색 2~3px, 왼쪽 위 밝음) */
function pebble(X0: number, Y0: number, x: number, y: number, R: () => number, dark: boolean): void {
  const base = dark ? 0x504840 : 0x7a6e60;
  const w = R() < 0.5 ? 2 : 3;
  for (let i = 0; i < w; i++) {
    dot(X0, Y0, x + i, y, tone(base, i === 0 ? 0.35 : 0.12));
    dot(X0, Y0, x + i, y + 1, tone(base, i === w - 1 ? -0.3 : -0.08));
  }
  dot(X0, Y0, x + 1, y + 2, tone(base, -0.6));
  if (w === 3) dot(X0, Y0, x + 2, y + 2, tone(base, -0.6));
}

const TWIG = [rgba32('#2e1a0c'), rgba32('#5a3a1e'), rgba32('#8a6238'), rgba32('#a87c4c')];
/** 잔가지 (R1: 밝은 윗면 + 어두운 아랫선, 길이 5~10px, 가끔 곁가지) */
function twig(X0: number, Y0: number, x: number, y: number, R: () => number): void {
  const len = 5 + Math.floor(R() * 6);
  const dir = R() < 0.5 ? 1 : -1;
  const slope = (R() - 0.3) * 0.7;
  let fy = y;
  for (let i = 0; i < len; i++) {
    const xx = x + i * dir;
    const yy = Math.round(fy);
    dot(X0, Y0, xx, yy, i === 0 || i === len - 1 ? TWIG[1]! : i % 4 === 1 ? TWIG[3]! : TWIG[2]!);
    dot(X0, Y0, xx, yy + 1, TWIG[0]!);
    fy += slope;
  }
  if (len > 6) {
    const bx = x + Math.floor(len / 2) * dir;
    const by = Math.round(y + (slope * len) / 2);
    dot(X0, Y0, bx + dir, by - 1, TWIG[2]!);
    dot(X0, Y0, bx + 2 * dir, by - 2, TWIG[1]!);
  }
}

const LEAF = ['#8a6a28', '#a07a2e', '#6e4a1e', '#b88a38', '#9a4a1e'].map((c) => rgba32(c));
function leaf(X0: number, Y0: number, x: number, y: number, R: () => number): void {
  const c = LEAF[Math.floor(R() * LEAF.length)]!;
  dot(X0, Y0, x, y, c);
  dot(X0, Y0, x + 1, y, c);
  if (R() < 0.6) dot(X0, Y0, x + 1, y - 1, tone(c, 0.15));
  dot(X0, Y0, x, y + 1, dim(c, 0.55));
}

const FLOWER = ['#f6f2e6', '#f6d64a', '#f08aa6', '#b68ae0', '#88b8f4', '#ee6a52'].map((c) => rgba32(c));
/** 작은 꽃 무더기: 같은 색 꽃 3~6송이 (+ 모양 꽃잎, 노란 꽃술), 초록 잎 */
function flowers(gm: GroundMap, X0: number, Y0: number, x: number, y: number, R: () => number): void {
  const gp = gm.pal[GROUND.GRASS]!;
  const n = 3 + Math.floor(R() * 4);
  const col = FLOWER[Math.floor(R() * FLOWER.length)]!;
  const col2 = R() < 0.35 ? FLOWER[Math.floor(R() * FLOWER.length)]! : col;
  for (let i = 0; i < n; i++) {
    const fx = x + Math.round((R() - 0.5) * 10);
    const fy = y + Math.round((R() - 0.5) * 5);
    const c = i % 3 === 2 ? col2 : col;
    // 잎과 줄기
    dot(X0, Y0, fx - 1, fy + 2, gp.col[3]!);
    dot(X0, Y0, fx + 1, fy + 2, gp.col[2]!);
    dot(X0, Y0, fx, fy + 2, gp.col[1]!);
    dot(X0, Y0, fx, fy + 1, gp.col[2]!);
    if (R() < 0.7) {
      dot(X0, Y0, fx - 1, fy, c);
      dot(X0, Y0, fx + 1, fy, c);
      dot(X0, Y0, fx, fy - 1, tone(c, 0.12));
      dot(X0, Y0, fx, fy + 1, dim(c, 0.7));
      dot(X0, Y0, fx, fy, c === FLOWER[1] ? FLOWER[5]! : FLOWER[1]!);
    } else {
      dot(X0, Y0, fx, fy, c);
      dot(X0, Y0, fx + 1, fy, dim(c, 0.8));
    }
  }
}

/** 뾰족한 풀·고사리 포기 (걸어서 지나갈 수 있는 바닥 장식): 디더 그늘 + 부채꼴로 뻗어 휘는 잎 (어두운 아랫선 먼저) */
function ferns(gm: GroundMap, X0: number, Y0: number, x: number, y: number, R: () => number): void {
  const gp = gm.pal[GROUND.GRASS]!;
  // 바닥 그늘: 가운데는 진하게, 가장자리는 체크무늬로 옅게
  for (let dy = -1; dy <= 3; dy++) {
    for (let dx = -9; dx <= 9; dx++) {
      const e = (dx * dx) / 81 + ((dy - 1) * (dy - 1)) / 5;
      if (e > 1) continue;
      if (e < 0.45 || ((dx + dy) & 1) === 0) dot(X0, Y0, x + dx, y + dy, gp.col[e < 0.3 ? 0 : 1]!);
    }
  }
  const n = 9 + Math.floor(R() * 5);
  const blades: [number, number, number, number, number][] = [];
  for (let b = 0; b < n; b++) {
    const spread = (b / (n - 1) - 0.5) * 2;
    const ang = -Math.PI / 2 + spread * 1.25 + (R() - 0.5) * 0.25;
    const len = 7 + R() * 7 * (1 - Math.abs(spread) * 0.35);
    blades.push([x + spread * 3 + (R() - 0.5) * 2, ang, len, spread * 0.09, R()]);
  }
  // 가운데 잎이 앞에 오도록 바깥 잎부터
  blades.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]));
  for (const pass of [0, 1]) {
    for (const [bx, a0, len, droop, r] of blades) {
      let ang = a0;
      let fx = bx;
      let fy = y;
      for (let s = 0; s < len; s++) {
        const t = s / len;
        const px = Math.round(fx);
        const py = Math.round(fy);
        if (pass === 0) dot(X0, Y0, px, py + 1, gp.col[0]!);
        else {
          const lit = Math.cos(ang) < 0.15;
          const c = t < 0.2 ? gp.col[1]! : t < 0.55 ? gp.col[lit ? 3 : 2]! : t < 0.88 ? gp.col[lit ? 4 : 3]! : gp.col[r < 0.3 ? 5 : 4]!;
          dot(X0, Y0, px, py, c);
          // 고사리 잎: 줄기 옆으로 작은 잎
          if (s > 2 && s % 2 === 1 && len > 9) dot(X0, Y0, Math.round(fx - Math.sin(ang) * 1.4), Math.round(fy + Math.cos(ang) * 0.8), gp.col[t < 0.5 ? 2 : 3]!);
        }
        fx += Math.cos(ang);
        fy += Math.sin(ang) * 0.8;
        ang += droop;
      }
    }
  }
}

const BONE = [rgba32('#ece6d4'), rgba32('#cfc8b4'), rgba32('#24201c'), rgba32('#9c9482')];
/** 뼈: 밝은 막대 + 양 끝 혹, 가끔 해골 */
function bones(X0: number, Y0: number, x: number, y: number, R: () => number): void {
  const n = 1 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) {
    const bx = x + Math.round((R() - 0.5) * 18);
    const by = y + Math.round((R() - 0.5) * 8);
    const len = 6 + Math.floor(R() * 5);
    const slope = (R() - 0.5) * 0.9;
    for (let s = 0; s <= len; s++) {
      const yy = by + Math.round(s * slope);
      dot(X0, Y0, bx + s, yy + 1, BONE[2]!);
      dot(X0, Y0, bx + s, yy, s === 0 || s === len ? BONE[0]! : BONE[1]!);
    }
    for (const e of [0, len]) {
      const yy = by + Math.round(e * slope);
      dot(X0, Y0, bx + e, yy - 1, BONE[0]!);
      dot(X0, Y0, bx + e + (e ? 1 : -1), yy, BONE[3]!);
      dot(X0, Y0, bx + e + (e ? 1 : -1), yy - 1, BONE[1]!);
    }
  }
  if (R() < 0.5) {
    const sx = x + Math.round((R() - 0.5) * 12);
    const sy = y + Math.round((R() - 0.5) * 4);
    for (let dy = -4; dy <= 1; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if ((dy === -4 && Math.abs(dx) >= 2) || (dy === 1 && Math.abs(dx) >= 2) || (dy === -3 && Math.abs(dx) === 3)) continue;
        dot(X0, Y0, sx + dx, sy + dy, dy <= -3 || dx === -3 ? BONE[0]! : dx === 3 ? BONE[3]! : BONE[1]!);
      }
    }
    dot(X0, Y0, sx - 1, sy - 1, BONE[2]!);
    dot(X0, Y0, sx - 2, sy - 1, BONE[2]!);
    dot(X0, Y0, sx + 1, sy - 1, BONE[2]!);
    dot(X0, Y0, sx + 2, sy - 1, BONE[2]!);
    dot(X0, Y0, sx, sy + 1, BONE[3]!);
    for (let dx = -2; dx <= 2; dx++) dot(X0, Y0, sx + dx, sy + 2, BONE[2]!);
  }
}

const REED = [rgba32('#2a3a1a'), rgba32('#4a5a28'), rgba32('#6a7a38')];

/** 칸 가운데 (cx, cy) 둘레의 장식 자리 (마름모 안쪽) */
function atX(cx: number, R: () => number): number {
  return cx + Math.round((R() - 0.5) * 34);
}
function atY(cy: number, R: () => number): number {
  return cy + Math.round((R() - 0.5) * 15);
}

/** 4단계: 칸마다 정해진 장식 (같은 칸은 언제나 같은 모양) */
function decals(gm: GroundMap, X0: number, Y0: number): void {
  const g = gm.grid;
  const [tx0, ty0, tx1, ty1] = tileRangeFor(g.w, g.h, X0 - 40, Y0 - 40, X0 + OW + 40, Y0 + OW + 40);
  const leafRate = gm.variant === 'r1' ? 0.3 : gm.variant === 'r3' ? 0.12 : 0.06;
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) {
      const i = y * g.w + x;
      const cx = (x - y) * 32;
      const cy = (x + y) * 16 + 16;
      if (cx + 40 < X0 || cx - 40 > X0 + OW || cy + 30 < Y0 || cy - 30 > Y0 + OW) continue;
      if (g.solid[i] !== SOLID.NONE) continue;
      const blend = g.blend[i]!;
      const R = rng(hashU32(x, y, 4242));
      const deco = g.deco[i]!;
      if (deco === DECO.FLOWERS) {
        const k = 2 + (R() < 0.5 ? 1 : 0);
        for (let n = 0; n < k; n++) flowers(gm, X0, Y0, atX(cx, R), atY(cy, R), R);
      } else if (deco === DECO.FERNS) {
        const k = 1 + (R() < 0.6 ? 1 : 0);
        for (let n = 0; n < k; n++) ferns(gm, X0, Y0, atX(cx, R), atY(cy, R) + 4, R);
      } else if (deco === DECO.BONES) bones(X0, Y0, atX(cx, R), atY(cy, R), R);
      switch (blend) {
        case GROUND.DIRT: {
          if (R() < 0.5) pebble(X0, Y0, atX(cx, R), atY(cy, R), R, false);
          if (R() < 0.2) pebble(X0, Y0, atX(cx, R), atY(cy, R), R, true);
          if (R() < (gm.variant === 'r1' ? 0.3 : 0.16)) twig(X0, Y0, atX(cx, R), atY(cy, R), R);
          break;
        }
        case GROUND.GRASS: {
          if (deco !== DECO.NONE) break;
          if (R() < leafRate) leaf(X0, Y0, atX(cx, R), atY(cy, R), R);
          if (R() < leafRate * 0.5) leaf(X0, Y0, atX(cx, R), atY(cy, R), R);
          if (R() < 0.04) pebble(X0, Y0, atX(cx, R), atY(cy, R), R, false);
          if (gm.variant === 'r1' && R() < 0.06) twig(X0, Y0, atX(cx, R), atY(cy, R), R);
          break;
        }
        case GROUND.CAVE:
        case GROUND.ASH: {
          const n = Math.floor(R() * 3);
          for (let k = 0; k < n; k++) pebble(X0, Y0, atX(cx, R), atY(cy, R), R, true);
          break;
        }
        case GROUND.DUNGEON:
        case GROUND.ABYSS: {
          if (R() < 0.2) pebble(X0, Y0, atX(cx, R), atY(cy, R), R, true);
          break;
        }
        case GROUND.SWAMP: {
          if (R() < 0.35) {
            const px = atX(cx, R);
            const py = atY(cy, R);
            for (let k = 0; k < 3; k++) {
              const h = 3 + Math.floor(R() * 4);
              for (let s = 0; s < h; s++) dot(X0, Y0, px + k * 2, py - s, REED[s === h - 1 ? 2 : s < 2 ? 0 : 1]!);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

// ───────────────────────── 단상 계단 ─────────────────────────

const LIT = Uint32Array.from(STEP_LIT, (c) => rgba32(c));
const SHADE = Uint32Array.from(STEP_SHADE, (c) => rgba32(c));
const JOINT = Uint32Array.from(STEP_JOINT, (c) => rgba32(c));
const SHADOW_SPAN = (STEPS - 1) * STEP_D;

/** 5단계: 돌 단상 앞쪽 두 변 (아래·오른쪽 이웃이 단상이 아닌 곳) 에 STEPS 단 계단 옆면과 디딤판 */
function daisSteps(gm: GroundMap, X0: number, Y0: number): void {
  if (!gm.daisFront.length) return;
  const isDais = gm.isDais;
  for (const [x, y] of gm.daisFront) {
    const cx = (x - y) * 32;
    const top = (x + y) * 16;
    const bx0 = Math.max(X0, cx - 34);
    const bx1 = Math.min(X0 + OW - 1, cx + 34 + Math.ceil(SHADOW_SPAN * 32));
    const by0 = Math.max(Y0, top + 14);
    const by1 = Math.min(Y0 + OW - 1, top + 32 + STEP_DROP);
    for (let sy = by0; sy <= by1; sy++) {
      const oy = sy - Y0;
      for (let sx = bx0; sx <= bx1; sx++) {
        const ox = sx - X0;
        stepHit(isDais, sx + 0.5, sy + 0.5, HIT);
        const q = oy * OW + ox;
        if (HIT.kind === 'top') {
          if (HIT.level === 0) continue;
          if (HIT.level < STEPS) {
            // 디딤판: 단상 윗면 돌 무늬, 조금 어둡게
            OUT[q] = dim(texColour(gm, GROUND.DAIS, sx, sy, q), 0.9);
            continue;
          }
          // 땅: 맨 아래 옆면 바로 밑에 그늘
          const k = cls[(oy + APRON) * BW + ox + APRON]!;
          if (k === VOID || LIQ[k]) continue;
          const sum = (sy + 0.5 - STEPS * STEP_H) / 16;
          const dd = (sx + 0.5) / 64;
          const u = sum / 2 + dd;
          const v = sum / 2 - dd;
          // 층 경계에서 얼마나 떨어졌는지: 2px 안쪽이면 진한 그늘, 4px 안쪽이면 옅은 그늘
          if (daisLevel(isDais, u - 2 * TILE_PER_PX, v - 2 * TILE_PER_PX) < STEPS) OUT[q] = dim(OUT[q]!, 0.5);
          else if (daisLevel(isDais, u - 4 * TILE_PER_PX, v - 4 * TILE_PER_PX) < STEPS) OUT[q] = dim(OUT[q]!, 0.72);
          continue;
        }
        // 옆면: 윗입술(밝게) → 몸통 → 바닥 줄(어둡게), 돌 사이 세로 줄눈
        const pal = HIT.side === 0 ? LIT : SHADE;
        const r = HIT.row;
        let c: number;
        // 돌 길이가 조금씩 다르게 (단조 증가하는 흔들림이라 이음매 순서는 그대로)
        const ju = HIT.along * 3 + HIT.level * 0.47 + 0.22 * Math.sin(HIT.along * 7.1 + HIT.level * 2.3);
        const joint = Math.abs(ju - Math.round(ju)) < (HIT.side === 0 ? 0.045 : 0.06);
        if (r === 0) c = pal[4]!;
        else if (r === STEP_H - 1) c = pal[0]!;
        else if (joint) c = JOINT[HIT.side]!;
        else {
          const h = hashU32(sx, sy, 41);
          c = (h & 7) === 0 ? pal[1]! : (h & 7) === 1 ? pal[3]! : r === 1 ? pal[3]! : pal[2]!;
        }
        OUT[q] = c;
      }
    }
  }
}

// ───────────────────────── 성수 샘 금 테두리 ─────────────────────────

/** 6단계: 둥근 샘 둘레의 해 모양 금 톱니 테두리 (R3) */
function poolRims(gm: GroundMap, X0: number, Y0: number): void {
  for (const pl of gm.pools) {
    const rx = pl.a * RIM_TIP + 3;
    const ry = pl.b * RIM_TIP + 3;
    const x0 = Math.max(X0, Math.floor(pl.cx - rx));
    const x1 = Math.min(X0 + OW - 1, Math.ceil(pl.cx + rx));
    const y0 = Math.max(Y0, Math.floor(pl.cy - ry));
    const y1 = Math.min(Y0 + OW - 1, Math.ceil(pl.cy + ry));
    for (let sy = y0; sy <= y1; sy++) {
      const dy = (sy + 0.5 - pl.cy) / pl.b;
      for (let sx = x0; sx <= x1; sx++) {
        const dx = (sx + 0.5 - pl.cx) / pl.a;
        const rho = Math.sqrt(dx * dx + dy * dy);
        if (rho <= RIM_IN || rho > RIM_TIP + 0.06) continue;
        const th = Math.atan2(dy, dx);
        const f = (((th / (Math.PI * 2)) * pl.teeth) % 1 + 1) % 1;
        const tooth = 1 - Math.abs(f * 2 - 1);
        const tip = RIM_BAND + (RIM_TIP - RIM_BAND) * Math.pow(tooth, 0.6);
        const q = (sy - Y0) * OW + (sx - X0);
        // 빛: 왼쪽 위를 향한 쪽이 밝음 (화면 각도)
        const light = -(Math.cos(th) * 0.55 + Math.sin(th) * 0.85);
        if (rho > tip) {
          // 톱니 끝 바깥 1px 그늘 (오른쪽 아래만)
          if (rho < tip + 0.05 && light < 0.2) OUT[q] = dim(OUT[q]!, 0.6);
          continue;
        }
        const pxIn = (rho - RIM_IN) * pl.b;
        if (pxIn < 1) {
          OUT[q] = GOLD[0]!;
          continue;
        }
        // 톱니 사이 가르는 선
        if (tooth < 0.12 && rho > RIM_BAND - 0.02) {
          OUT[q] = GOLD[0]!;
          continue;
        }
        // 톱니 한쪽 면은 밝고 다른 면은 어둡게 (입체), 바깥 끝은 한 단계 어둡게
        const half = f < 0.5 ? 1 : -1;
        let lvl = light > 0.45 ? 3 : light > -0.15 ? 2.5 : light > -0.6 ? 2 : 1.4;
        lvl += half * 0.45;
        if ((tip - rho) * pl.b < 1) lvl -= 0.8;
        if (rho < RIM_BAND && rho > RIM_BAND - 0.035) lvl -= 0.6;
        OUT[q] = GOLD[clamp(Math.round(lvl), 1, 4)]!;
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ───────────────────────── 조각 출력 ─────────────────────────

/** 조각 하나의 픽셀을 OUT 에 굽기 (DOM 을 쓰지 않음) */
function bakePixels(gm: GroundMap, cx: number, cy: number): void {
  const X0 = cx * CHUNK;
  const Y0 = cy * CHUNK;
  classify(gm, X0 - APRON, Y0 - APRON);
  classifyPools(gm, X0 - APRON, Y0 - APRON);
  colour(gm, X0, Y0);
  tufts(gm, X0, Y0);
  decals(gm, X0, Y0);
  daisSteps(gm, X0, Y0);
  poolRims(gm, X0, Y0);
}

/** 조각 하나를 s 배(정수) 장치 픽셀 RGBA 로 굽기: 텍셀 하나를 s×s 로 그대로 늘려 또렷하게 */
function chunkPixels(gm: GroundMap, cx: number, cy: number, s: number): BakedPixels {
  bakePixels(gm, cx, cy);
  const n = OW * s;
  const data = new Uint8ClampedArray(n * n * 4);
  const dst = new Uint32Array(data.buffer);
  if (s === 1) dst.set(OUT);
  else {
    for (let y = 0; y < OW; y++) {
      const d0 = y * s * n;
      const srow = y * OW;
      for (let x = 0; x < OW; x++) {
        const c = OUT[srow + x]!;
        const d = d0 + x * s;
        for (let k = 0; k < s; k++) dst[d + k] = c;
      }
      for (let r = 1; r < s; r++) dst.copyWithin(d0 + r * n, d0, d0 + n);
    }
  }
  return { w: n, h: n, data };
}

/** 굽기용으로 준비한 맵 바닥 (최근 둘: 맵을 오가는 동안 다시 준비하지 않게) */
const prepared = new Map<string, GroundMap>();

function preparedMap(map: BakeMap, key: string): GroundMap {
  let gm = prepared.get(key);
  if (!gm) {
    gm = prepareGroundMap(map, key);
    prepared.set(key, gm);
    if (prepared.size > 2) prepared.delete(prepared.keys().next().value!);
  }
  return gm;
}

/** 맵 바닥의 열쇠: 맵 id 와 타일 내용 (타일이 같으면 같은 열쇠) */
export function groundKey(map: BakeMap): string {
  return tilesKey(map);
}

/**
 * 조각 (cx, cy) 의 픽셀 (RGBA Uint32, 한 변 CHUNK + 2, 이웃 조각과 2텍셀 겹침).
 * 캔버스 없이 계산만 하므로 시험과 측정에 씁니다.
 */
export function bakeGroundChunk(map: BakeMap, cx: number, cy: number): Uint32Array {
  bakePixels(preparedMap(map, tilesKey(map)), cx, cy);
  return OUT.slice();
}

/** 조각 (cx, cy) 를 s 배(정수) 해상도 RGBA 로 굽기. key 는 groundKey(map). DOM 을 쓰지 않아 작업자가 부릅니다 */
export function bakeChunkRGBA(map: BakeMap, key: string, cx: number, cy: number, s: number): BakedPixels {
  return chunkPixels(preparedMap(map, key), cx, cy, s);
}

/** 아직 만들지 않은 바닥 무늬 하나를 만듭니다 (쉬는 동안 조금씩). 더 만들 것이 남았으면 true */
export function warmGroundTexture(): boolean {
  const next = ALL_TEXTURES.find(([m, v]) => !hasGroundTexture(m, v));
  if (!next) return false;
  groundTexture(next[0], next[1]);
  return ALL_TEXTURES.some(([m, v]) => !hasGroundTexture(m, v));
}

/** 조각 한 변 (겹침 포함) */
export const CHUNK_OUT = OW;

/** 소수 배율: 1배 조각을 화면 해상도로 부드럽게 늘림 (점 크기가 고르게) */
function smoothUp(src: CanvasImageSource, dpr: number): HTMLCanvasElement {
  const n = Math.ceil(OW * dpr);
  const [c, x] = makeCanvas(n, n);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, OW * dpr, OW * dpr);
  return c;
}

/** 밑그림 한 점이 덮는 CSS px (아직 굽지 못한 조각 자리에 잠깐 까는 흐린 그림이라 칸마다 4×2 점이면 충분) */
const OVERVIEW_PX = 16;

/** 맵 전체의 흐린 밑그림: 칸마다 바닥 재질의 대표 색 (액체·공허는 투명이라 아래 물이 비침) */
function buildOverview(gm: GroundMap): HTMLCanvasElement {
  const b = gm.bounds;
  const w = Math.ceil((b.x1 - b.x0) / OVERVIEW_PX);
  const h = Math.ceil((b.y1 - b.y0) / OVERVIEW_PX);
  const colours = new Uint32Array(GROUND_COUNT);
  for (let m = 1; m < GROUND_COUNT; m++) {
    if (LIQ[m]) continue;
    const r = paletteFor(m, gm.variant).ramps[0]!;
    colours[m] = rgba32(r[Math.floor(r.length / 2)]!);
  }
  const [c, x] = makeCanvas(w, h);
  const img = x.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  const g = gm.grid;
  for (let j = 0; j < h; j++) {
    const sy = b.y0 + (j + 0.5) * OVERVIEW_PX;
    for (let i = 0; i < w; i++) {
      const sx = b.x0 + (i + 0.5) * OVERVIEW_PX;
      const tx = Math.floor((sx / 32 + sy / 16) / 2);
      const ty = Math.floor((sy / 16 - sx / 32) / 2);
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
      const m = g.base[ty * g.w + tx]!;
      if (m < GROUND_COUNT) out[j * w + i] = colours[m]!;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

// ───────────────────────── 물·성수·용암 (매 프레임) ─────────────────────────

interface LiquidPatterns {
  base: CanvasPattern;
  glint: CanvasPattern;
  w: number;
  h: number;
}

function liquidCanvas(data: Uint32Array, w: number, h: number, dpr: number): HTMLCanvasElement {
  const [c, x] = makeCanvas(w, h);
  const img = x.createImageData(w, h);
  new Uint32Array(img.data.buffer).set(data);
  x.putImageData(img, 0, 0);
  if (dpr === 1) return c;
  const [d, dx] = makeCanvas(Math.round(w * dpr), Math.round(h * dpr));
  dx.imageSmoothingEnabled = !Number.isInteger(dpr);
  dx.drawImage(c, 0, 0, d.width, d.height);
  return d;
}

const LIQUID_MATS = [GROUND.WATER, GROUND.HOLY, GROUND.LAVA] as const;

// ───────────────────────── 바닥 캐시 ─────────────────────────

/** 맵 바닥 전체를 맡는 객체 (Renderer 가 하나 가짐) */
export class Ground {
  private gm: GroundMap | null = null;
  private lastMap: MapView | null = null;
  private dpr = 1;
  private fresh = false;
  private readonly chunks = new Lru<string, BakedImage>(64, (_k, c) => disposeImage(c));
  private patterns = new Map<number, LiquidPatterns>();
  private patternCtx: CanvasRenderingContext2D | null = null;
  /** 아직 굽지 못한 조각 자리에 깔 흐린 밑그림 (맵마다) */
  private overview: HTMLCanvasElement | null = null;
  private warmQueue: (readonly [number, GroundVariant])[] | null = null;
  private warmTimer = false;
  /** 마지막 프레임에 보인 조각 수와 그 가운데 아직 굽지 못해 밑그림으로 대신한 수 */
  visible = 0;
  missing = 0;

  /** 조각은 굽기 일꾼(baker)의 작업자에서 굽고, 작업자를 못 쓰면 그 자리에서 굽습니다 (그때는 쉬는 시간에 바닥 무늬를 미리 만들어 둠) */
  constructor(private readonly baker: Baker) {
    baker.start();
    if (!baker.async) this.scheduleWarmup();
  }

  /** 맵이 바뀌었으면 지형 격자를 다시 만듭니다 (같은 맵이면 아무 일도 안 함) */
  setMap(map: MapView): void {
    if (map === this.lastMap) return;
    this.lastMap = map;
    const key = tilesKey(map);
    if (this.gm && this.gm.key === key) return;
    // 작업자가 굽는다면 이쪽은 격자만 있으면 됨 (무늬는 작업자가 만듦)
    this.gm = prepareGroundMap(map, key, !this.baker.async);
    this.overview = null;
    this.fresh = true;
    if (this.baker.async) this.baker.setMap(key, map);
    else this.scheduleWarmup();
  }

  /** 화면 배율이 바뀌면 조각과 물 무늬를 새로 만듭니다 */
  setDpr(dpr: number): void {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.patterns.clear();
    this.chunks.clear();
    this.fresh = true;
  }

  /**
   * 아직 만들지 않은 바닥 무늬를 쉬는 시간에 하나씩 미리 만듭니다 (작업자를 못 쓸 때만).
   * (처음 가는 맵으로 순간이동할 때 무늬 만드는 시간까지 한 프레임에 몰리지 않게)
   */
  private scheduleWarmup(): void {
    if (!this.warmQueue) this.warmQueue = ALL_TEXTURES.filter(([m, v]) => !hasGroundTexture(m, v));
    if (this.warmTimer || !this.warmQueue.length) return;
    this.warmTimer = true;
    const step = () => {
      this.warmTimer = false;
      const q = this.warmQueue!;
      while (q.length && hasGroundTexture(q[0]![0], q[0]![1])) q.shift();
      const next = q.shift();
      if (next) groundTexture(next[0], next[1]);
      if (q.length) this.scheduleWarmup();
    };
    const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(step, { timeout: 1000 });
    else setTimeout(step, 60);
  }

  private prefix(): string {
    return `${this.gm!.key}|${this.dpr}`;
  }

  /**
   * 조각 그림. 캐시에 없으면 작업자에게 굽기를 맡기고 null (prio: 작을수록 먼저).
   * 작업자를 못 쓰면 그 자리에서 굽습니다.
   */
  private chunk(cx: number, cy: number, prio: number): BakedImage | null {
    const key = chunkKey(this.prefix(), cx, cy);
    const c = this.chunks.get(key);
    if (c) return c;
    let gm = this.gm!;
    const dpr = this.dpr;
    // 정수 배율이면 그 배율로 (텍셀을 그대로 늘림), 소수 배율이면 1배로 구워 받은 뒤 부드럽게 늘림
    const s = Math.round(dpr) === dpr ? dpr : 1;
    if (!this.baker.async) {
      // 작업자가 도중에 죽어 그 자리에서 굽게 되면 무늬·팔레트부터 준비
      if (!gm.bakeable) gm = this.gm = prepareGroundMap(this.lastMap!, gm.key, true);
      const px = chunkPixels(gm, cx, cy, s);
      const img = s === dpr ? pixelsToCanvas(px) : smoothUp(pixelsToCanvas(px), dpr);
      this.chunks.set(key, img);
      return img;
    }
    this.baker.request(key, { kind: 'chunk', map: gm.key, cx, cy, scale: s }, prio, (img) => {
      if (!img) return;
      // 굽는 동안 맵이나 배율이 바뀌었으면 버림
      if (!this.gm || !key.startsWith(this.prefix() + '|')) {
        disposeImage(img);
        return;
      }
      if (s === this.dpr) this.chunks.set(key, img);
      else {
        this.chunks.set(key, smoothUp(img, this.dpr));
        disposeImage(img);
      }
    });
    return null;
  }

  /** 아직 굽지 못한 조각 자리: 맵 전체 밑그림의 그 부분을 부드럽게 늘려 깜 */
  private drawStandIn(ctx: CanvasRenderingContext2D, gm: GroundMap, cx: number, cy: number, dx: number, dy: number): void {
    this.overview ??= buildOverview(gm);
    const b = gm.bounds;
    const k = OW / OVERVIEW_PX;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.overview, (cx * CHUNK - b.x0) / OVERVIEW_PX, (cy * CHUNK - b.y0) / OVERVIEW_PX, k, k, dx, dy, Math.ceil(OW * this.dpr), Math.ceil(OW * this.dpr));
    ctx.imageSmoothingEnabled = false;
  }

  /**
   * 바닥 그리기. ctx 는 (dpr 배율 + 카메라 offset) 이 걸린 상태여야 합니다.
   * 보이는 액체를 먼저 깔고 그 위에 조각(액체 자리는 투명)을 화면 픽셀에 1:1 로 붙입니다.
   * 아직 굽지 못한 조각 자리에는 흐린 밑그림을 깔고 그 수를 missing 에 남깁니다.
   */
  draw(ctx: CanvasRenderingContext2D, offX: number, offY: number, cssW: number, cssH: number, now: number): void {
    const gm = this.gm;
    if (!gm) return;
    const t0 = performance.now();
    const dpr = this.dpr;
    const view = { x0: -offX, y0: -offY, x1: cssW - offX, y1: cssH - offY };
    const vis = chunksByDistance(view, gm.bounds);
    const per = Math.ceil(OW * dpr) ** 2 * 4;
    const ring = chunksByDistance(
      { x0: view.x0 - PREFETCH_MARGIN, y0: view.y0 - PREFETCH_MARGIN, x1: view.x1 + PREFETCH_MARGIN, y1: view.y1 + PREFETCH_MARGIN },
      gm.bounds,
    );
    this.chunks.limit = Math.max(ring.length + 8, Math.floor((CACHE_BYTES_PER_DPR * dpr) / per));

    if (gm.liquidBits) this.drawLiquids(ctx, gm, view, now);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(offX * dpr);
    const oy = Math.round(offY * dpr);
    let missing = 0;
    for (let i = 0; i < vis.length; i++) {
      const [cx, cy] = vis[i]!;
      // 보이는 조각은 벽·물체 그림(우선순위 1)보다 먼저, 가운데에서 가까운 것부터
      const c = this.chunk(cx, cy, i / 100);
      const dx = Math.round(cx * CHUNK * dpr) + ox;
      const dy = Math.round(cy * CHUNK * dpr) + oy;
      if (c) ctx.drawImage(c, dx, dy);
      else {
        missing++;
        this.drawStandIn(ctx, gm, cx, cy, dx, dy);
      }
    }
    ctx.restore();
    this.visible = vis.length;
    this.missing = missing;

    if (this.baker.async) {
      // 둘레 조각은 보이는 것을 다 구운 뒤에 미리 굽기 (작업자에서)
      const prefix = this.prefix();
      for (let i = 0; i < ring.length; i++) {
        const [cx, cy] = ring[i]!;
        if (!this.chunks.has(chunkKey(prefix, cx, cy))) this.chunk(cx, cy, 1000 + i);
      }
    } else if (!this.fresh) {
      // 그 자리에서 굽는다면: 둘레 조각은 프레임마다 조금씩 (맵이 바뀐 첫 프레임은 쉼)
      let n = 0;
      const prefix = this.prefix();
      for (const [cx, cy] of ring) {
        if (n >= PREFETCH_PER_FRAME || performance.now() - t0 > PREFETCH_MS) break;
        if (this.chunks.has(chunkKey(prefix, cx, cy))) continue;
        this.chunk(cx, cy, 0);
        n++;
      }
    }
    this.fresh = false;
  }

  private liquidPatterns(ctx: CanvasRenderingContext2D, mat: number): LiquidPatterns | null {
    if (this.patternCtx !== ctx) {
      this.patterns.clear();
      this.patternCtx = ctx;
    }
    let p = this.patterns.get(mat);
    if (p) return p;
    const t = liquidTexture(mat);
    const base = ctx.createPattern(liquidCanvas(t.base, t.w, t.h, this.dpr), 'repeat');
    const glint = ctx.createPattern(liquidCanvas(t.glint, t.w, t.h, this.dpr), 'repeat');
    if (!base || !glint) return null;
    p = { base, glint, w: t.w, h: t.h };
    this.patterns.set(mat, p);
    return p;
  }

  /** 물·성수·용암: 화면에 보이는 액체 칸(과 그 둘레 한 겹)만 매 프레임 (무늬를 옮겨서 흐르게) */
  private drawLiquids(ctx: CanvasRenderingContext2D, gm: GroundMap, view: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    const g = gm.grid;
    const [tx0, ty0, tx1, ty1] = tileRangeFor(g.w, g.h, view.x0, view.y0, view.x1, view.y1);
    const paths: (Path2D | null)[] = [null, null, null];
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const bits = gm.cover[y * g.w + x]!;
        if (!bits) continue;
        const sx = (x - y) * 32;
        const sy = (x + y) * 16;
        if (sx + 32 < view.x0 || sx - 32 > view.x1 || sy + 32 < view.y0 || sy > view.y1) continue;
        for (let k = 0; k < 3; k++) {
          if (!(bits & liquidBit(LIQUID_MATS[k]))) continue;
          const p = (paths[k] ??= new Path2D());
          p.moveTo(sx, sy - 1);
          p.lineTo(sx + 33, sy + 16);
          p.lineTo(sx, sy + 33);
          p.lineTo(sx - 33, sy + 16);
          p.closePath();
        }
      }
    }
    const s = 1 / this.dpr;
    ctx.save();
    for (let k = 0; k < 3; k++) {
      const path = paths[k];
      if (!path) continue;
      const mat = LIQUID_MATS[k];
      const p = this.liquidPatterns(ctx, mat);
      if (!p) continue;
      if (mat === GROUND.WATER) {
        // 물결 띠는 물가 쪽으로 천천히 밀려오고, 반짝임은 물결을 따라 더 빨리 흐름 + 살짝 출렁
        const k1 = Math.floor(now / 230) % p.h;
        p.base.setTransform({ a: s, b: 0, c: 0, d: s, e: 0, f: k1 });
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.base;
        ctx.fill(path);
        const k2 = Math.floor(now / 95) % p.w;
        const bob = Math.round(Math.sin(now / 900));
        p.glint.setTransform({ a: s, b: 0, c: 0, d: s, e: 2 * k2 + 37, f: k2 + 11 + bob });
        ctx.fillStyle = p.glint;
        ctx.fill(path);
      } else if (mat === GROUND.HOLY) {
        const k1 = Math.floor(now / 420) % p.h;
        p.base.setTransform({ a: s, b: 0, c: 0, d: s, e: -2 * k1, f: k1 });
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.base;
        ctx.fill(path);
        this.drawPools(ctx, gm, view, now);
        const k2 = Math.floor(now / 160) % p.h;
        p.glint.setTransform({ a: s, b: 0, c: 0, d: s, e: 2 * k2 + 13, f: k2 + 5 });
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 520);
        ctx.fillStyle = p.glint;
        ctx.fill(path);
        ctx.globalAlpha = 1;
      } else {
        // 용암: 아주 천천히 흐르고 금이 숨 쉬듯 빛남
        const k1 = Math.floor(now / 520) % p.h;
        p.base.setTransform({ a: s, b: 0, c: 0, d: s, e: 2 * k1, f: k1 });
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.base;
        ctx.fill(path);
        p.glint.setTransform({ a: s, b: 0, c: 0, d: s, e: 2 * k1, f: k1 });
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3 + 0.3 * Math.sin(now / 380);
        ctx.fillStyle = p.glint;
        ctx.fill(path);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /** 둥근 성수 샘: 가운데가 더 밝고, 동심 잔물결이 천천히 퍼짐 (조각의 투명한 타원 아래에 그림) */
  private drawPools(ctx: CanvasRenderingContext2D, gm: GroundMap, view: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    for (const pool of gm.pools) {
      if (pool.cx + pool.a < view.x0 || pool.cx - pool.a > view.x1 || pool.cy + pool.b < view.y0 || pool.cy - pool.b > view.y1) continue;
      ctx.save();
      ctx.translate(pool.cx, pool.cy);
      ctx.scale(1, 0.5);
      const g = ctx.createRadialGradient(-pool.a * 0.15, -pool.a * 0.2, 0, 0, 0, pool.a);
      g.addColorStop(0, 'rgba(236,253,255,0.7)');
      g.addColorStop(0.45, 'rgba(170,240,252,0.32)');
      g.addColorStop(0.85, 'rgba(60,180,220,0.05)');
      g.addColorStop(1, 'rgba(20,120,170,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, pool.a, 0, Math.PI * 2);
      ctx.fill();
      // 잔물결: 가운데에서 바깥으로 퍼지며 옅어지는 고리 3개
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const t = ((now / 2600 + i / 3) % 1 + 1) % 1;
        ctx.strokeStyle = `rgba(230,252,255,${(0.42 * (1 - t)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(0, 0, pool.a * (0.12 + t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
