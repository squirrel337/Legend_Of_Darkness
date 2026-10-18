// 바위 그림 (R3 해안 바위 양식): 모서리가 둥근 상자 꼴의 회색 바위.
// 윗면은 밝고(#9a9a9e), 왼쪽 앞면은 중간(#55555a), 오른쪽 앞면과 땅에 닿는 곳은 어둡습니다(#26262a).
// 바위 모양은 맵 좌표의 입체(둥근 상자 + 부드러운 울퉁불퉁함)를 광선으로 따라가 칠하고,
// 표면은 화강암처럼 1~2px 얼룩·밝은 알갱이·어두운 구멍을 촘촘히 찍습니다.
import { hash2 } from './iso';
import { grassTufts } from './flora';
import { Pix, groundShadow, isoAt, ramp, rgb, smooth, solid, speckle, stamp, tone, type RGB, type Ramp } from './pixel';

// R3 바위: 윗면 #9a9a9e, 몸통 #55555a, 그림자 #26262a
export const ROCK = ramp('#17171b', '#202024', '#2c2c31', '#3a3a3f', '#48484d', '#55555a', '#69696e', '#808085', '#9a9a9e', '#b6b6ba');
export const CAVE_ROCK = ramp('#15100d', '#211a15', '#2e251e', '#3b3027', '#4a3d32', '#594a3d', '#6c5b4c', '#81705f', '#988573', '#b09d8a');
const LICHEN: RGB = rgb('#56663c');

type Rnd = () => number;

/** 바위 하나: 맵 좌표 중심 (X, Y), 반크기 (bx, by, bz), 모서리 둥글기 r, 회전 rot, 울퉁불퉁함 amp */
export interface Boulder {
  X: number;
  Y: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
  rot: number;
  /** 윗면 기울기 */
  tx: number;
  ty: number;
  amp: number;
  seed: number;
}

/** 무작위 바위 (크기 size 근처) */
export function makeBoulder(rnd: Rnd, X: number, Y: number, size: number, seed: number, flat = 1): Boulder {
  const bx = size * (0.75 + rnd() * 0.4);
  const by = size * (0.7 + rnd() * 0.4);
  return {
    X,
    Y,
    bx,
    by,
    bz: size * (0.55 + rnd() * 0.4) * flat,
    r: size * (0.26 + rnd() * 0.2),
    rot: (rnd() - 0.5) * 1.2,
    tx: (rnd() - 0.5) * 0.3,
    ty: (rnd() - 0.5) * 0.3,
    amp: 0.6 + size * 0.06,
    seed,
  };
}

/** 둥근 상자 부호 거리 + 부드러운 울퉁불퉁함 */
function boulderSdf(c: Boulder): (X: number, Y: number, Z: number) => number {
  const cr = Math.cos(c.rot);
  const sr = Math.sin(c.rot);
  const p1 = hash2(c.seed, 1) * 6.3;
  const p2 = hash2(c.seed, 2) * 6.3;
  const p3 = hash2(c.seed, 3) * 6.3;
  const ix = c.bx - c.r;
  const iy = c.by - c.r;
  const iz = c.bz - c.r;
  // 바닥에 조금 묻힘
  const cz = c.bz * 0.78;
  return (X, Y, Z) => {
    const dx = X - c.X;
    const dy = Y - c.Y;
    const x = dx * cr - dy * sr;
    const y = dx * sr + dy * cr;
    const z = Z - cz - c.tx * x - c.ty * y;
    const qx = Math.abs(x) - ix;
    const qy = Math.abs(y) - iy;
    const qz = Math.abs(z) - iz;
    const ox = qx > 0 ? qx : 0;
    const oy = qy > 0 ? qy : 0;
    const oz = qz > 0 ? qz : 0;
    const inner = Math.max(qx, qy, qz);
    const d = Math.sqrt(ox * ox + oy * oy + oz * oz) + (inner < 0 ? inner : 0) - c.r;
    const n = Math.sin(x * 0.23 + p1) * Math.sin(y * 0.27 + p2) * 0.6 + Math.sin((x + z) * 0.19 + p3) * 0.4 + Math.sin((y - z) * 0.37 + p1) * 0.2;
    return d - n * c.amp;
  };
}

/** 바위 하나를 층 l 에 칠합니다 */
export function paintBoulder(l: Pix, c: Boulder, pal: Ramp, lichen: boolean): void {
  const R = Math.hypot(c.bx, c.by) + c.amp + 1;
  const top = c.bz * 0.78 + c.bz + c.amp + 2 + (Math.abs(c.tx) + Math.abs(c.ty)) * R;
  const seed = c.seed;
  solid(l, [c.X - R, c.X + R, c.Y - R, c.Y + R, 0, top], boulderSdf(c), (_X, _Y, Z, nx, ny, nz, ix, iy) => {
    // 윗면 밝게, 왼쪽 앞면(+Y) 중간, 오른쪽 앞면(+X) 어둡게
    let v = 0.46 + 0.42 * nz + 0.06 * ny - 0.26 * nx;
    if (nz > 0.8) v += 0.06;
    // 땅에 닿는 곳은 그늘
    v -= 0.22 * (1 - smooth(0, 6, Z));
    // 화강암 얼룩: 1~2px 점, 큰 얼룩, 밝은 알갱이, 어두운 구멍
    v += speckle(ix, iy, seed) * 0.26 + (hash2(ix >> 2, iy >> 2, seed + 7) - 0.5) * 0.1;
    const h = hash2(ix, iy, seed + 3);
    if (h < 0.035) v += 0.2;
    else if (h > 0.955) v -= 0.22;
    if (lichen && nz > 0.85 && hash2(ix >> 1, iy >> 1, seed + 11) < 0.012) return LICHEN;
    return tone(pal, v, ix, iy, 0.7);
  });
}

/**
 * 바위 여러 개를 뒤(화면 위)에서 앞 순서로 칠하고 하나씩 외곽선을 두름.
 * grass 면 바위마다 밑동에 풀 포기를 바로 이어서 그려서, 앞 바위가 뒤 바위의 풀을 가리게 합니다.
 */
function paintPile(p: Pix, rnd: Rnd, list: Boulder[], pal: Ramp, grass: boolean): void {
  list.sort((a, b) => a.X + a.Y - (b.X + b.Y));
  for (const b of list) {
    const l = p.layer();
    paintBoulder(l, b, pal, grass);
    stamp(p, l, pal);
    if (grass && rnd() < 0.7) grassTufts(p, rnd, b.seed, [foot(b, rnd)]);
  }
}

/**
 * 바위 R / 동굴 바위 r: 0 큰 바위 하나, 1 큰 바위 + 작은 바위, 2 납작한 바위, 3 높은 바위 + 작은 바위.
 * 풀밭 바위(R)는 밑동에 풀 포기가 돋고 윗면에 이끼가 조금 낍니다.
 */
export function rockSprite(p: Pix, rnd: Rnd, seed: number, variant: number, cave: boolean): void {
  const pal = cave ? CAVE_ROCK : ROCK;
  const list: Boulder[] = [];
  if (variant === 0) {
    groundShadow(p, 4, 2, 22, 9);
    list.push(makeBoulder(rnd, 0, 0, 12 + rnd() * 2, seed));
  } else if (variant === 1) {
    groundShadow(p, 4, 3, 25, 10);
    list.push(makeBoulder(rnd, -2, -3, 11.5 + rnd() * 2, seed));
    list.push(makeBoulder(rnd, 9, 8, 5.5 + rnd(), seed + 1));
  } else if (variant === 2) {
    groundShadow(p, 3, 2, 25, 9);
    list.push(makeBoulder(rnd, 0, 0, 14 + rnd() * 2, seed, 0.55));
  } else {
    groundShadow(p, 3, 2, 20, 8);
    const tall = makeBoulder(rnd, 1, -1, 9.5 + rnd(), seed);
    tall.bz = 16 + rnd() * 3;
    tall.r = Math.max(tall.r, 4.5);
    tall.tx = 0.18;
    list.push(tall);
    list.push(makeBoulder(rnd, -6, 9, 5 + rnd(), seed + 1));
  }
  paintPile(p, rnd, list, pal, !cave);
}

/** 바위 무더기 Q (R3 해안): 크고 작은 회색 바위 2~4개가 겹친 덩어리 */
export function boulderPile(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 5, 4, 40, 15, 0.32);
  const n = 2 + (variant % 3);
  const list: Boulder[] = [];
  const big = 14 + rnd() * 3;
  list.push(makeBoulder(rnd, -3 + rnd() * 4, -5 + rnd() * 3, big, seed));
  const spots: [number, number][] = [
    [11, 3],
    [-6, 11],
    [12, 13],
    [-13, 0],
  ];
  for (let i = 1; i < n + (variant === 3 ? 1 : 0); i++) {
    const [sx, sy] = spots[(i - 1 + variant) % spots.length]!;
    list.push(makeBoulder(rnd, sx + (rnd() - 0.5) * 4, sy + (rnd() - 0.5) * 4, 6.5 + rnd() * 5, seed + i * 31));
  }
  paintPile(p, rnd, list, ROCK, true);
}

/** 바위 밑동 앞쪽 둘레 (왼쪽 앞 또는 오른쪽 앞)에서 풀 포기가 돋을 화면 자리 */
function foot(b: Boulder, rnd: Rnd): [number, number] {
  const side = rnd() < 0.5 ? -1 : 1;
  const [x, y] = isoAt(b.X + (side > 0 ? b.bx * 0.8 : 0), b.Y + (side < 0 ? b.by * 0.8 : 0), 0);
  return [x + (rnd() - 0.5) * 4, y + 1];
}
