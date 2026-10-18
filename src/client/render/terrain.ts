// 바닥 지형 계산 (그리기와 무관한 순수 함수들):
// 타일 문자 → 바닥 재질, 경계에서 어느 바닥이 위로 덮이는지, 물체·벽 아래 바닥 추정,
// 성수 웅덩이 찾기, 돌 단상 계단 높이, 물·용암을 깔아야 하는 칸, 바닥 캐시 조각(chunk) 번호와 LRU.
// DOM 을 쓰지 않으므로 node:test 로 바로 시험할 수 있습니다.
import { TILE_H, TILE_W } from '../../shared/constants';
import { TILESET, tileInfo } from '../../shared/tiles';

// ───────────────────────── 바닥 재질 ─────────────────────────

/** 바닥 재질 번호 (픽셀 버퍼에 그대로 담기는 작은 정수) */
export const GROUND = {
  VOID: 0,
  GRASS: 1,
  DIRT: 2,
  COBBLE: 3,
  PLANKS: 4,
  MARBLE: 5,
  DUNGEON: 6,
  ABYSS: 7,
  CAVE: 8,
  SAND: 9,
  ASH: 10,
  SWAMP: 11,
  FLAGSTONE: 12,
  DAIS: 13,
  WATER: 14,
  HOLY: 15,
  LAVA: 16,
} as const;
export const GROUND_COUNT = 17;
/** 섞기에서 빠지는 칸 (벽이 서 있는 칸: 벽 그림이 칸을 다 덮고, 벽 너머 바닥이 번져 들어오면 안 됨) */
export const EXCLUDED = 255;
/** 쌍대 칸의 네 꼭짓점이 서로 다른 재질 */
export const MIXED = 254;

/** 바닥 장식 (조각에 함께 구워 넣음) */
export const DECO = { NONE: 0, FLOWERS: 1, FERNS: 2, BONES: 3 } as const;

/** 칸 위에 선 것: 없음 / 물체·나무 / 벽 */
export const SOLID = { NONE: 0, OBJECT: 1, WALL: 2 } as const;

export interface Material {
  name: string;
  /** 경계에서 위로 덮어 들어가는 정도 (점수 단위, 1px ≈ 0.07). 클수록 남의 칸을 덮음 */
  prio: number;
  /** 경계 흔들림 세기. 흙·풀은 크고 돌바닥은 작아서 또렷함 */
  soft: number;
  /** 물·성수·용암: 조각에서는 투명하게 비우고 매 프레임 움직이는 그림을 아래에 깜 */
  liquid: boolean;
  /** 사람이 깐 바닥(돌·나무): 가장자리에 1px 줄눈 선 */
  built: boolean;
  /** 경계 너머로 풀잎 포기가 삐져나옴 */
  tufts: boolean;
  /** 풀과 맞닿는 가장자리에 어두운 테두리 (살짝 패인 흙길) */
  rim: boolean;
}

const M = (name: string, prio: number, soft: number, o: Partial<Material> = {}): Material => ({
  name,
  prio,
  soft,
  liquid: false,
  built: false,
  tufts: false,
  rim: false,
  ...o,
});

/** 재질 번호 → 성질. 순서는 GROUND 번호와 같습니다 */
export const MATERIALS: readonly Material[] = [
  M('void', 0, 0),
  M('grass', 0.2, 0.3, { tufts: true }),
  M('dirt', 0, 0.3, { rim: true }),
  M('cobble', 0.1, 0.07, { built: true }),
  M('planks', 0.12, 0.03, { built: true }),
  M('marble', 0.1, 0.03, { built: true }),
  M('dungeon', 0.1, 0.05, { built: true }),
  M('abyss', 0.1, 0.05, { built: true }),
  M('cave', 0.05, 0.28),
  M('sand', 0.02, 0.3, { rim: true }),
  M('ash', 0.05, 0.28, { rim: true }),
  M('swamp', 0.12, 0.3),
  M('flagstone', 0.1, 0.05, { built: true }),
  M('dais', 0.35, 0.02, { built: true }),
  M('water', -0.04, 0.26, { liquid: true }),
  M('holy', 0, 0.04, { liquid: true }),
  M('lava', -0.04, 0.22, { liquid: true }),
];

/** 경계에서 어느 재질이 위로 덮이는지 (풀 > 단상·판석·자갈·나무 > 흙·모래) */
export function coversEdge(a: number, b: number): boolean {
  return MATERIALS[a]!.prio > MATERIALS[b]!.prio;
}

const PATTERN_GROUND: Record<string, number> = {
  grass: GROUND.GRASS,
  dirt: GROUND.DIRT,
  cobble: GROUND.COBBLE,
  planks: GROUND.PLANKS,
  tiles: GROUND.DUNGEON,
  cave: GROUND.CAVE,
  sand: GROUND.SAND,
  marble: GROUND.MARBLE,
  ash: GROUND.ASH,
  swamp: GROUND.SWAMP,
  flagstone: GROUND.FLAGSTONE,
  dais: GROUND.DAIS,
};

export interface TileGround {
  /** 바닥 재질 (EXCLUDED 면 벽·물체·나무 칸이라 바닥을 둘레에서 추정해야 함) */
  mat: number;
  deco: number;
  solid: number;
}

const classCache = new Map<string, TileGround>();

/** 타일 문자 하나를 바닥 재질과 장식으로 나눕니다 */
export function classifyTile(ch: string): TileGround {
  const hit = classCache.get(ch);
  if (hit) return hit;
  const info = tileInfo(ch);
  let r: TileGround;
  if (info.kind === 'void') r = { mat: GROUND.VOID, deco: DECO.NONE, solid: SOLID.NONE };
  else if (info.kind === 'liquid') {
    const mat = ch === 'L' || info.name === '용암' ? GROUND.LAVA : ch === 'U' || info.name === '성수' ? GROUND.HOLY : GROUND.WATER;
    r = { mat, deco: DECO.NONE, solid: SOLID.NONE };
  } else if (info.kind === 'floor') {
    // 심연의 바닥은 던전 바닥과 무늬가 같지만 보랏빛 돌
    const mat = ch === 'x' ? GROUND.ABYSS : (PATTERN_GROUND[info.pattern ?? 'grass'] ?? GROUND.GRASS);
    const deco = info.shape === 'flowers' ? DECO.FLOWERS : info.shape === 'tallgrass' ? DECO.FERNS : info.shape === 'bones' ? DECO.BONES : DECO.NONE;
    r = { mat, deco, solid: SOLID.NONE };
  } else r = { mat: EXCLUDED, deco: DECO.NONE, solid: info.kind === 'wall' ? SOLID.WALL : SOLID.OBJECT };
  classCache.set(ch, r);
  return r;
}

const colourCache = new Map<string, number | null>();

/** TileInfo 색이 같은 (장식 없는) 바닥 타일의 재질. 나무·바위처럼 바닥색을 지닌 물체용 */
function colourMatchFloor(ch: string): number | null {
  let r = colourCache.get(ch);
  if (r !== undefined) return r;
  const info = tileInfo(ch);
  r = null;
  for (const [k, v] of Object.entries(TILESET)) {
    if (v.kind === 'floor' && v.color === info.color && !v.shape) {
      r = classifyTile(k).mat;
      break;
    }
  }
  colourCache.set(ch, r);
  return r;
}

const N8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const N4 = N8.slice(0, 4);

/** 표에서 가장 흔한 재질 (같으면 곧은 이웃이 많은 쪽, 그다음 우선순위가 높은 쪽, 그다음 번호가 작은 쪽) */
function majority(counts: Map<number, [number, number]>): number | null {
  let best: number | null = null;
  let bc = -1;
  let bo = -1;
  for (const [mat, [c, o]] of counts) {
    const better =
      best === null ||
      c > bc ||
      (c === bc && (o > bo || (o === bo && (MATERIALS[mat]!.prio > MATERIALS[best]!.prio || (MATERIALS[mat]!.prio === MATERIALS[best]!.prio && mat < best)))));
    if (better) {
      best = mat;
      bc = c;
      bo = o;
    }
  }
  return best;
}

/**
 * 물체·벽·나무 칸 아래의 바닥: 둘레 8칸 가운데 걸을 수 있는 바닥으로 가장 흔한 것.
 * 그런 이웃이 없으면 둘레의 물·용암 (바다 가운데 바위는 물에 잠김), 그것도 없으면 TileInfo 색이 같은 바닥.
 * 셋 다 없으면 null.
 */
export function inferFloor(tiles: readonly string[], x: number, y: number): number | null {
  const counts = new Map<number, [number, number]>();
  const wet = new Map<number, [number, number]>();
  for (const [dx, dy] of N8) {
    const n = tiles[y + dy]?.[x + dx];
    if (n === undefined) continue;
    const info = tileInfo(n);
    const table = info.kind === 'floor' && info.walkable ? counts : info.kind === 'liquid' ? wet : null;
    if (!table) continue;
    const mat = classifyTile(n).mat;
    const c = table.get(mat) ?? [0, 0];
    c[0]++;
    if (dx === 0 || dy === 0) c[1]++;
    table.set(mat, c);
  }
  return majority(counts) ?? majority(wet) ?? colourMatchFloor(tiles[y]?.[x] ?? ' ');
}

export interface GroundGrid {
  w: number;
  h: number;
  /** 섞기용 재질 (벽은 EXCLUDED, 물체·나무는 추정한 바닥) */
  blend: Uint8Array;
  /** 칸마다 실제 바닥 재질 (벽·물체·나무 칸은 추정한 바닥) */
  base: Uint8Array;
  deco: Uint8Array;
  /** SOLID 값: 바닥 장식을 뿌리지 않을 칸 */
  solid: Uint8Array;
  /**
   * 쌍대 칸: 타일 (i,j),(i+1,j),(i,j+1),(i+1,j+1) 의 중심을 꼭짓점으로 하는 칸.
   * 한 재질로만 덮이면 그 재질, 아니면 MIXED. 번호는 dualIndex(i, j).
   */
  dual: Uint8Array;
  /** 이 맵에 나오는 재질 */
  used: Set<number>;
}

export function dualIndex(g: { w: number }, i: number, j: number): number {
  return (j + 1) * (g.w + 1) + (i + 1);
}

/** 맵 문자열 → 바닥 격자. 물체 아래 바닥 추정과 쌍대 칸 미리 계산까지 */
export function buildGroundGrid(tiles: readonly string[]): GroundGrid {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  const blend = new Uint8Array(w * h);
  const base = new Uint8Array(w * h);
  const deco = new Uint8Array(w * h);
  const solid = new Uint8Array(w * h);
  const todo: number[] = [];
  for (let y = 0; y < h; y++) {
    const row = tiles[y]!;
    for (let x = 0; x < w; x++) {
      const c = classifyTile(row[x] ?? ' ');
      const i = y * w + x;
      deco[i] = c.deco;
      solid[i] = c.solid;
      if (c.mat === EXCLUDED) {
        const f = inferFloor(tiles, x, y);
        if (f === null) todo.push(i);
        base[i] = f ?? EXCLUDED;
      } else base[i] = c.mat;
    }
  }
  // 두꺼운 벽 덩어리 안쪽: 이미 정해진 이웃에서 번져 들어오게 (몇 번 되풀이)
  for (let pass = 0; pass < 64 && todo.length; pass++) {
    const next: [number, number][] = [];
    const left: number[] = [];
    for (const i of todo) {
      const x = i % w;
      const y = (i - x) / w;
      const counts = new Map<number, [number, number]>();
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const m = base[ny * w + nx]!;
        if (m === EXCLUDED || m === GROUND.VOID || MATERIALS[m]!.liquid) continue;
        const c = counts.get(m) ?? [0, 0];
        c[0]++;
        if (dx === 0 || dy === 0) c[1]++;
        counts.set(m, c);
      }
      const best = majority(counts);
      if (best === null) left.push(i);
      else next.push([i, best]);
    }
    if (!next.length) break;
    for (const [i, m] of next) base[i] = m;
    todo.length = 0;
    todo.push(...left);
  }
  for (const i of todo) base[i] = GROUND.GRASS;
  // 물체·나무는 추정한 바닥 그대로 섞기에 참여 (기둥 밑까지 단상, 물가 바위 밑까지 땅)
  for (let i = 0; i < w * h; i++) blend[i] = solid[i] === SOLID.WALL ? EXCLUDED : base[i]!;

  const used = new Set<number>();
  for (let i = 0; i < w * h; i++) used.add(base[i]!);

  const dual = new Uint8Array((w + 1) * (h + 1));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? GROUND.VOID : blend[y * w + x]!);
  const baseAt = (x: number, y: number) => base[y * w + x]!;
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const cs = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      let r: number = MIXED;
      if (!cs.includes(GROUND.VOID)) {
        const real = cs.filter((c) => c !== EXCLUDED);
        if (real.length) {
          if (real.every((c) => c === real[0])) r = real[0]!;
        } else {
          // 네 꼭짓점이 모두 벽: 벽 그림이 다 덮으므로 아무 바닥이나 (왼쪽 위 칸의 바닥)
          r = baseAt(i, j);
        }
      }
      dual[dualIndex({ w }, i, j)] = r;
    }
  }
  return { w, h, blend, base, deco, solid, dual, used };
}

// ───────────────────────── 경계 섞기 ─────────────────────────

export interface BlendOut {
  /** 이긴 재질 */
  mat: number;
  /** 두 번째 재질 (없으면 mat 과 같음) */
  second: number;
  /** 점수 차 (경계에서 0, 1px 안쪽마다 약 MARGIN_PER_PX) */
  margin: number;
}

/** 곧은 경계를 수직으로 1px 지날 때 점수 차가 변하는 양 (쌍선형 무게 기울기) */
export const MARGIN_PER_PX = 0.07;
/** 풀잎 포기가 경계를 밀어내는 최대 세기 */
export const TUFT_AMP = 0.16;

const PRIO = MATERIALS.map((m) => m.prio);
const SOFT = MATERIALS.map((m) => m.soft);
const MAX_PERTURB = 2 * (Math.max(...SOFT) + TUFT_AMP);
// 한 점을 고르는 동안 쓰는 작업 공간 (픽셀마다 불리므로 새 객체를 만들지 않음)
const bm = new Int32Array(4);
const bw = new Float64Array(4);
let bn = 0;
let btotal = 0;

function addCorner(m: number, w: number): void {
  if (m === EXCLUDED || m === GROUND.VOID || w <= 0) return;
  btotal += w;
  for (let k = 0; k < bn; k++) {
    if (bm[k] === m) {
      bw[k] = bw[k]! + w;
      return;
    }
  }
  bm[bn] = m;
  bw[bn] = w;
  bn++;
}

/**
 * 타일 중심 네 개 (c00 왼쪽 위, c10, c01, c11) 로 둘러싸인 칸 안의 점 (s,t ∈ 0~1) 의 재질을 고릅니다.
 * 점수 = 쌍선형 무게 + 재질 우선순위 + 흔들림(perturb). EXCLUDED 꼭짓점은 빼고 무게를 다시 나눕니다.
 * perturb(mat, amp) 는 그 재질의 잡음 값을 돌려줍니다 (amp = 함께 있는 재질 가운데 가장 작은 soft).
 * 꼭짓점이 모두 EXCLUDED 면 false.
 */
export function blendPoint(
  c00: number,
  c10: number,
  c01: number,
  c11: number,
  s: number,
  t: number,
  out: BlendOut,
  perturb: ((mat: number, amp: number) => number) | null,
): boolean {
  bn = 0;
  btotal = 0;
  addCorner(c00, (1 - s) * (1 - t));
  addCorner(c10, s * (1 - t));
  addCorner(c01, (1 - s) * t);
  addCorner(c11, s * t);
  const n = bn;
  const total = btotal;
  if (n === 0) {
    // 무게가 0인 꼭짓점만 남은 경우(가장자리 정확히 위) 를 위해 한 번 더
    for (const m of [c00, c10, c01, c11]) {
      if (m !== EXCLUDED && m !== GROUND.VOID) {
        out.mat = out.second = m;
        out.margin = 1;
        return true;
      }
    }
    return false;
  }
  if (n === 1) {
    out.mat = out.second = bm[0]!;
    out.margin = 1;
    return true;
  }
  let amp = 1;
  for (let k = 0; k < n; k++) {
    bw[k] = bw[k]! / total + PRIO[bm[k]!]!;
    amp = Math.min(amp, SOFT[bm[k]!]!);
  }
  let best = 0;
  let sec = 1;
  if (bw[1]! > bw[0]!) {
    best = 1;
    sec = 0;
  }
  for (let k = 2; k < n; k++) {
    if (bw[k]! > bw[best]!) {
      sec = best;
      best = k;
    } else if (bw[k]! > bw[sec]!) sec = k;
  }
  if (perturb && bw[best]! - bw[sec]! < MAX_PERTURB) {
    for (let k = 0; k < n; k++) bw[k] = bw[k]! + perturb(bm[k]!, amp);
    best = 0;
    sec = 1;
    if (bw[1]! > bw[0]!) {
      best = 1;
      sec = 0;
    }
    for (let k = 2; k < n; k++) {
      if (bw[k]! > bw[best]!) {
        sec = best;
        best = k;
      } else if (bw[k]! > bw[sec]!) sec = k;
    }
  }
  out.mat = bm[best]!;
  out.second = bm[sec]!;
  out.margin = bw[best]! - bw[sec]!;
  return true;
}

// ───────────────────────── 물·성수·용암을 깔 칸 ─────────────────────────

/** 액체 재질 → 비트 (물 1, 성수 2, 용암 4) */
export function liquidBit(mat: number): number {
  return mat === GROUND.WATER ? 1 : mat === GROUND.HOLY ? 2 : mat === GROUND.LAVA ? 4 : 0;
}

/**
 * 칸마다 그 칸 마름모 안에 비칠 수 있는 액체 비트.
 * 경계 섞기는 둘레 8칸까지만 영향을 주므로, 액체 칸과 그 둘레 한 겹을 덮으면 조각의 투명한 구멍이 모두 덮입니다.
 */
export function liquidCover(g: GroundGrid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const bit = liquidBit(g.blend[y * g.w + x]!);
      if (!bit) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          out[ny * g.w + nx] = out[ny * g.w + nx]! | bit;
        }
      }
    }
  }
  return out;
}

// ───────────────────────── 성수 웅덩이 ─────────────────────────

export interface Pool {
  /** 웅덩이 칸 번호 (y * w + x) */
  cells: number[];
  /** 가운데 (타일 좌표, 칸 가운데가 x+0.5) */
  u: number;
  v: number;
  /** 둥근 샘 반지름 (타일 단위). 둥글게 그리기 어려운 모양이면 0 */
  r: number;
  /** 웅덩이를 둘러싼 바닥 (금 테두리 밑과 둥근 샘 바깥 모서리에 깜) */
  rim: number;
}

/**
 * 이어진 성수 칸 묶음. 빈칸 없는 정사각형 묶음은 둥근 샘(R3)으로 그리고,
 * 길쭉하거나 빈칸이 있는 묶음은 경계 섞기 모양 그대로 두고 금 띠만 두릅니다 (r = 0).
 */
export function findPools(g: GroundGrid): Pool[] {
  const pools: Pool[] = [];
  const seen = new Uint8Array(g.w * g.h);
  for (let start = 0; start < g.w * g.h; start++) {
    if (seen[start] || g.blend[start] !== GROUND.HOLY) continue;
    const stack = [start];
    seen[start] = 1;
    const cells: number[] = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % g.w;
      const y = (i - x) / g.w;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const j = ny * g.w + nx;
        if (!seen[j] && g.blend[j] === GROUND.HOLY) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // 빈칸 없는 정사각형만 둥근 샘 (빈칸이 있으면 걸을 수 있는 칸 위에 물을 그리게 됨)
    const round = bw === bh && cells.length === bw * bh;
    // 둘레 바닥: 묶음을 감싼 칸들 가운데 가장 흔한 바닥
    const counts = new Map<number, number>();
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const m = g.base[y * g.w + x]!;
        if (MATERIALS[m]!.liquid || m === GROUND.VOID || m === EXCLUDED) continue;
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    let rim: number = GROUND.DAIS;
    let rc = 0;
    for (const [m, c] of counts) if (c > rc || (c === rc && m < rim)) [rim, rc] = [m, c];
    pools.push({ cells, u: (x0 + x1 + 1) / 2, v: (y0 + y1 + 1) / 2, r: round ? bw / 2 : 0, rim });
  }
  return pools;
}

// ───────────────────────── 돌 단상 계단 ─────────────────────────

/** 단상 계단: 옆면 높이(px), 디딤판 깊이(타일), 옆면 수 */
export const STEP_H = 5;
export const STEP_D = 0.12;
export const STEPS = 3;
/** 계단이 단상 아래로 내려오는 높이 (px). 옆면 + 디딤판 + 바닥 그늘 */
export const STEP_DROP = STEPS * STEP_H + Math.ceil((STEPS - 1) * STEP_D * TILE_H) + 3;

/**
 * 단상을 카메라 쪽 (+x, +y) 으로만 STEP_D 씩 넓힌 층에서 점 (u,v) 의 층 번호.
 * 0 = 단상 윗면, 1..STEPS-1 = 아래 디딤판, STEPS = 땅. side 에는 이 점을 감싼 층 경계의 방향
 * (0 = +y 쪽 왼쪽 앞면, 1 = +x 쪽 오른쪽 앞면) 을 넣습니다.
 */
export function daisLevel(isDais: (x: number, y: number) => boolean, u: number, v: number, side?: { v: number }): number {
  const tx = Math.floor(u);
  const ty = Math.floor(v);
  const fu = u - tx;
  const fv = v - ty;
  if (isDais(tx, ty)) {
    // 단상 칸 안: 막 넘어 들어온 변은 +x / +y 가운데 더 가까운 쪽
    if (side) side.v = fu > fv ? 1 : 0;
    return 0;
  }
  let d = Infinity;
  let s = 0;
  if (isDais(tx - 1, ty) && fu < d) {
    d = fu;
    s = 1;
  }
  if (isDais(tx, ty - 1) && fv < d) {
    d = fv;
    s = 0;
  }
  if (isDais(tx - 1, ty - 1)) {
    const m = Math.max(fu, fv);
    if (m < d) {
      d = m;
      s = fu > fv ? 1 : 0;
    }
  }
  if (side) side.v = s;
  if (d === Infinity) return STEPS;
  return Math.min(STEPS, Math.max(1, Math.ceil(d / STEP_D - 1e-9)));
}

export interface StepHit {
  /** 'top' = 단상 윗면·디딤판·땅 (level 로 구분), 'face' = 계단 옆면 */
  kind: 'top' | 'face';
  level: number;
  /** 옆면: 0 = 빛 받는 왼쪽 앞면(+y), 1 = 그늘진 오른쪽 앞면(+x) */
  side: number;
  /** 옆면 위에서부터 몇 번째 줄 (0 ~ STEP_H-1) */
  row: number;
  /** 옆면을 따라 잰 자리 (타일 단위, 줄눈 위치에 씀) */
  along: number;
}

const sideTmp = { v: 0 };

/**
 * 화면 점 (sx, sy: 월드 픽셀 중심) 에서 보이는 단상 계단 면.
 * 시선은 화면 아래에서 위로 기울어 내려가므로, 높은 층부터 차례로 시선이 닿는 곳을 찾습니다.
 */
export function stepHit(isDais: (x: number, y: number) => boolean, sx: number, sy: number, out: StepHit): void {
  const d = sx / TILE_W; // (u - v) / 2
  for (let k = 0; k <= STEPS; k++) {
    const sum = (sy - k * STEP_H) / (TILE_H / 2); // u + v
    const u = sum / 2 + d;
    const v = sum / 2 - d;
    const l = daisLevel(isDais, u, v);
    if (l === k) {
      out.kind = 'top';
      out.level = k;
      out.side = 0;
      out.row = 0;
      out.along = 0;
      return;
    }
    if (l < k) {
      // 높이 z_{k-1} 와 z_k 사이에서 층 k-1 의 앞면에 닿음: 1px 씩 내려가며 처음 닿는 줄을 찾음
      for (let r = 1; r <= STEP_H; r++) {
        const s2 = (sy - (k - 1) * STEP_H - r) / (TILE_H / 2);
        const u2 = s2 / 2 + d;
        const v2 = s2 / 2 - d;
        if (daisLevel(isDais, u2, v2, sideTmp) <= k - 1) {
          out.kind = 'face';
          out.level = k - 1;
          out.side = sideTmp.v;
          out.row = r - 1;
          out.along = sideTmp.v === 0 ? u2 : v2;
          return;
        }
      }
      out.kind = 'face';
      out.level = k - 1;
      out.side = 0;
      out.row = STEP_H - 1;
      out.along = u;
      return;
    }
  }
  // k = STEPS 에서는 언제나 l <= k 이므로 여기까지 오지 않음
  out.kind = 'top';
  out.level = STEPS;
  out.side = 0;
  out.row = 0;
  out.along = 0;
}

// ───────────────────────── 조각(chunk) ─────────────────────────

/** 바닥 캐시 조각 한 변 (CSS px) */
export const CHUNK = 256;

/** 맵 바닥이 차지하는 월드 화면 좌표 범위 [x0,x1) × [y0,y1) */
export function mapWorldBounds(w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: (-h * TILE_W) / 2, y0: 0, x1: (w * TILE_W) / 2, y1: ((w + h) * TILE_H) / 2 + STEP_DROP };
}

/** 사각형 [x0,x1)×[y0,y1) 과 겹치는 조각 번호 범위 (양끝 포함) */
export function chunkRange(x0: number, y0: number, x1: number, y1: number, size = CHUNK): { cx0: number; cy0: number; cx1: number; cy1: number } {
  return { cx0: Math.floor(x0 / size), cy0: Math.floor(y0 / size), cx1: Math.floor((x1 - 1) / size), cy1: Math.floor((y1 - 1) / size) };
}

/** 보이는 범위 안의 조각 목록: 화면 가운데에서 가까운 것부터 */
export function chunksByDistance(
  view: { x0: number; y0: number; x1: number; y1: number },
  limit: { x0: number; y0: number; x1: number; y1: number },
  size = CHUNK,
): [number, number][] {
  const x0 = Math.max(view.x0, limit.x0);
  const y0 = Math.max(view.y0, limit.y0);
  const x1 = Math.min(view.x1, limit.x1);
  const y1 = Math.min(view.y1, limit.y1);
  if (x1 <= x0 || y1 <= y0) return [];
  const r = chunkRange(x0, y0, x1, y1, size);
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const out: [number, number, number][] = [];
  for (let j = r.cy0; j <= r.cy1; j++) {
    for (let i = r.cx0; i <= r.cx1; i++) {
      const dx = (i + 0.5) * size - cx;
      const dy = (j + 0.5) * size - cy;
      out.push([i, j, dx * dx + dy * dy]);
    }
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([i, j]) => [i, j]);
}

export function chunkKey(prefix: string, cx: number, cy: number): string {
  return `${prefix}|${cx},${cy}`;
}

/** 화면 사각형과 겹칠 수 있는 타일 범위 [x0, y0, x1, y1] (양끝 포함, 맵 안으로 자름) */
export function tileRangeFor(w: number, h: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [sx, sy] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    const fx = (sx + 2 * sy) / TILE_W;
    const fy = (2 * sy - sx) / TILE_W;
    minX = Math.min(minX, fx);
    maxX = Math.max(maxX, fx);
    minY = Math.min(minY, fy);
    maxY = Math.max(maxY, fy);
  }
  return [Math.max(0, Math.floor(minX) - 1), Math.max(0, Math.floor(minY) - 1), Math.min(w - 1, Math.ceil(maxX) + 1), Math.min(h - 1, Math.ceil(maxY) + 1)];
}

/** 가장 오래 안 쓴 것부터 버리는 작은 캐시 (Map 의 넣은 순서를 이용) */
export class Lru<K, V> {
  private readonly m = new Map<K, V>();
  constructor(
    public limit: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get size(): number {
    return this.m.size;
  }

  has(key: K): boolean {
    return this.m.has(key);
  }

  /** 꺼내면서 가장 최근에 쓴 것으로 옮깁니다 */
  get(key: K): V | undefined {
    const v = this.m.get(key);
    if (v !== undefined) {
      this.m.delete(key);
      this.m.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.m.has(key)) this.m.delete(key);
    this.m.set(key, value);
    this.trim();
  }

  /** 한도를 넘는 만큼 오래된 것부터 버림 */
  trim(): void {
    while (this.m.size > this.limit) {
      const first = this.m.keys().next();
      if (first.done) break;
      const v = this.m.get(first.value)!;
      this.m.delete(first.value);
      this.onEvict?.(first.value, v);
    }
  }

  delete(key: K): void {
    const v = this.m.get(key);
    if (v === undefined) return;
    this.m.delete(key);
    this.onEvict?.(key, v);
  }

  clear(): void {
    for (const [k, v] of this.m) this.onEvict?.(k, v);
    this.m.clear();
  }

  keys(): K[] {
    return [...this.m.keys()];
  }
}
