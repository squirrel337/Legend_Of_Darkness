// 손으로 찍은 픽셀 그림을 위한 도구 (물체·나무·벽 공용)
//
// 그림은 장치 픽셀 RGBA 버퍼(Pix)에 한 점씩 칠합니다. 모양 판정은 장치 픽셀 중심에서 하고,
// 색(디더링·잡음)은 CSS 1px 단위로 정해서 화면 배율과 상관없이 "점 크기"가 같습니다.
// 명암은 색 사다리(Ramp)를 Bayer 디더링으로 나눠 칠하고, 빛은 왼쪽 위에서 옵니다.
import { hash2, makeCanvas } from './iso';

// ───────────────────────── 색 ─────────────────────────

export type RGB = readonly [number, number, number];
/** 어두운 색 → 밝은 색 순서의 색 사다리. [0]은 외곽선 색이고 명암에는 [1]부터 씁니다 */
export type Ramp = readonly RGB[];

export function rgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const ramp = (...hex: string[]): Ramp => hex.map(rgb);

export function mixc(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** CSS 픽셀 (ix, iy)의 디더링 문턱 (-0.5 ~ 0.5) */
export function bayer(ix: number, iy: number): number {
  return (BAYER[((iy & 3) << 2) | (ix & 3)]! + 0.5) / 16 - 0.5;
}

/** 밝기 v(0~1) → 색 사다리의 색. [1]~[끝]을 고르게 나누고 경계는 디더링합니다 */
export function tone(r: Ramp, v: number, ix: number, iy: number, dither = 0.85): RGB {
  const n = r.length - 1;
  const k = Math.round(1 + clamp01(v) * (n - 1) + bayer(ix, iy) * dither);
  return r[k < 1 ? 1 : k > n ? n : k]!;
}

/** CSS 픽셀마다 정해진 잡음 (-0.5 ~ 0.5) */
export const grain = (ix: number, iy: number, seed: number) => hash2(ix, iy, seed) - 0.5;

/** 1~2px 크기의 얼룩 잡음 (-0.5 ~ 0.5): 낱점과 2px 덩어리를 섞어 손으로 찍은 질감을 냅니다 */
export const speckle = (ix: number, iy: number, seed: number) => (hash2(ix, iy, seed) - 0.5) * 0.6 + (hash2(ix >> 1, iy >> 1, seed + 1) - 0.5) * 0.4;

// ───────────────────────── 빛 ─────────────────────────

// 화면 좌표(x 오른쪽, y 아래, z 보는 사람 쪽)의 빛 방향: 왼쪽 위 앞쪽에서 옵니다
const LX = -0.52;
const LY = -0.49;
const LZ = 0.7;

/** 화면 좌표 법선 → 밝기 0~1 (주광 + 보는 쪽에서 오는 약한 보조광) */
export function lightN(nx: number, ny: number, nz: number): number {
  const d = nx * LX + ny * LY + nz * LZ;
  return 0.18 + 0.62 * (d > 0 ? d : 0) + 0.2 * (nz > 0 ? nz : 0);
}

/** 세계 법선(x 오른쪽, f 앞쪽, u 위쪽) → 밝기. 2:1 아이소 시점(약 30도 내려다봄) */
export function lightW(x: number, f: number, u: number): number {
  return lightN(x, 0.5 * f - 0.866 * u, 0.866 * f + 0.5 * u);
}

/**
 * 맵 좌표 법선 (X: 맵 x축 = 화면 오른쪽 아래, Y: 맵 y축 = 화면 왼쪽 아래, Z: 위) → 밝기.
 * 윗면 ≈ 0.76, 왼쪽 앞면(+Y) ≈ 0.69, 오른쪽 앞면(+X) ≈ 0.30
 */
export function lightMap(X: number, Y: number, Z: number): number {
  return lightW((X - Y) * Math.SQRT1_2, (X + Y) * Math.SQRT1_2, Z);
}

// ───────────────────────── 픽셀 버퍼 ─────────────────────────

/** 그림 상자: 발 위치(0,0) 기준 CSS 픽셀. left/top 은 보통 음수, w/h 는 정수 */
export interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

export type Shader = (x: number, y: number, ix: number, iy: number) => RGB | null;

/**
 * 장치 픽셀 RGBA 버퍼. 좌표는 상자 기준 CSS 픽셀이고 s 배로 촘촘하게 칠합니다.
 * 모양 판정은 장치 픽셀 중심에서, 색(디더링·잡음)은 CSS 픽셀 단위로 정합니다.
 */
export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  /** 칠한 범위 (장치 픽셀, 끝 미포함) */
  bx0: number;
  by0: number;
  bx1 = 0;
  by1 = 0;

  constructor(
    readonly box: Box,
    readonly s: number,
  ) {
    this.w = box.w * s;
    this.h = box.h * s;
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    this.bx0 = this.w;
    this.by0 = this.h;
  }

  /** 같은 크기의 빈 층 */
  layer(): Pix {
    return new Pix(this.box, this.s);
  }

  /** 장치 픽셀 (i, j)에 덮어 칠함. a < 255 면 아래 색과 섞음 */
  putRaw(i: number, j: number, r: number, g: number, b: number, a: number): void {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h || a <= 0) return;
    const d = this.data;
    const k = (j * this.w + i) * 4;
    const da = d[k + 3]!;
    if (a >= 255 || da === 0) {
      d[k] = r;
      d[k + 1] = g;
      d[k + 2] = b;
      d[k + 3] = a;
    } else {
      const sa = a / 255;
      const db = (da / 255) * (1 - sa);
      const oa = sa + db;
      d[k] = (r * sa + d[k]! * db) / oa;
      d[k + 1] = (g * sa + d[k + 1]! * db) / oa;
      d[k + 2] = (b * sa + d[k + 2]! * db) / oa;
      d[k + 3] = oa * 255;
    }
    if (i < this.bx0) this.bx0 = i;
    if (i >= this.bx1) this.bx1 = i + 1;
    if (j < this.by0) this.by0 = j;
    if (j >= this.by1) this.by1 = j + 1;
  }

  put(i: number, j: number, c: RGB, a = 255): void {
    this.putRaw(i, j, c[0], c[1], c[2], a);
  }

  alpha(i: number, j: number): number {
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? 0 : this.data[(j * this.w + i) * 4 + 3]!;
  }

  /** CSS 좌표 → 장치 픽셀 번호 */
  col(x: number): number {
    return Math.floor((x - this.box.left) * this.s);
  }

  row(y: number): number {
    return Math.floor((y - this.box.top) * this.s);
  }

  /**
   * CSS 영역 [x0,x1)×[y0,y1) 의 장치 픽셀마다 fn(x, y, ix, iy) 색을 칠합니다.
   * x, y: 장치 픽셀 중심의 CSS 좌표 (모양 판정), ix, iy: 그 점이 속한 CSS 픽셀 (색·디더링)
   */
  paint(x0: number, y0: number, x1: number, y1: number, fn: Shader, a = 255): void {
    const { s, box } = this;
    const i0 = Math.max(0, Math.floor((x0 - box.left) * s));
    const i1 = Math.min(this.w, Math.ceil((x1 - box.left) * s));
    const j0 = Math.max(0, Math.floor((y0 - box.top) * s));
    const j1 = Math.min(this.h, Math.ceil((y1 - box.top) * s));
    for (let j = j0; j < j1; j++) {
      const y = box.top + (j + 0.5) / s;
      const iy = Math.floor(y);
      for (let i = i0; i < i1; i++) {
        const x = box.left + (i + 0.5) / s;
        const c = fn(x, y, Math.floor(x), iy);
        if (c) this.putRaw(i, j, c[0], c[1], c[2], a);
      }
    }
  }

  /** 다른 층(같은 상자)을 위에 덮어 그림 */
  over(src: Pix): void {
    const sd = src.data;
    for (let j = src.by0; j < src.by1; j++) {
      for (let i = src.bx0; i < src.bx1; i++) {
        const k = (j * this.w + i) * 4;
        const a = sd[k + 3]!;
        if (a) this.putRaw(i, j, sd[k]!, sd[k + 1]!, sd[k + 2]!, a);
      }
    }
  }

  /** 실루엣 바깥 둘레에 CSS 1px 외곽선. 그늘 쪽(오른쪽·아래)은 dark, 빛 쪽(왼쪽·위)은 lite */
  outline(dark: RGB, lite: RGB = dark): void {
    const { w, h, s, data } = this;
    const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && data[(j * w + i) * 4 + 3]! >= 128;
    const marks: number[] = [];
    const x0 = Math.max(0, this.bx0 - s);
    const x1 = Math.min(w, this.bx1 + s);
    const y0 = Math.max(0, this.by0 - s);
    const y1 = Math.min(h, this.by1 + s);
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        if (solid(i, j)) continue;
        let side = 0;
        for (let k = 1; k <= s; k++) {
          if (solid(i + k, j) || solid(i, j + k)) side |= 1;
          if (solid(i - k, j) || solid(i, j - k)) side |= 2;
        }
        if (side) marks.push(i, j, side);
      }
    }
    for (let m = 0; m < marks.length; m += 3) this.put(marks[m]!, marks[m + 1]!, marks[m + 2] === 1 ? lite : dark);
  }

  /** 불투명한 장치 픽셀 수 (점검용) */
  coverage(): number {
    let n = 0;
    for (let k = 3; k < this.data.length; k += 4) if (this.data[k]! >= 128) n++;
    return n;
  }

  /** 불투명한 부분의 CSS 범위 [left, top, right, bottom] (점검용) */
  bounds(): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (this.data[(j * this.w + i) * 4 + 3]! < 128) continue;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
    const { s, box } = this;
    return [box.left + x0 / s, box.top + y0 / s, box.left + (x1 + 1) / s, box.top + (y1 + 1) / s];
  }

  toCanvas(): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(this.w, this.h);
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

/** 그린 층에 외곽선(같은 계열의 어두운 색)을 두르고 바탕에 합침 */
export function stamp(p: Pix, layer: Pix, pal: Ramp): void {
  layer.outline(pal[0]!, mixc(pal[0]!, pal[1]!, 0.6));
  p.over(layer);
}

// ───────────────────────── 모양 ─────────────────────────

/** 바닥의 부드러운 타원 그림자 (오른쪽 아래로 조금 밀림) */
export function groundShadow(p: Pix, cx: number, cy: number, rx: number, ry: number, a = 0.34): void {
  const shadow: RGB = [8, 12, 6];
  const { s } = p;
  const i0 = Math.max(0, p.col(cx - rx));
  const i1 = Math.min(p.w, p.col(cx + rx) + 1);
  const j0 = Math.max(0, p.row(cy - ry));
  const j1 = Math.min(p.h, p.row(cy + ry) + 1);
  for (let j = j0; j < j1; j++) {
    const y = p.box.top + (j + 0.5) / s;
    for (let i = i0; i < i1; i++) {
      const x = p.box.left + (i + 0.5) / s;
      const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
      if (d >= 1) continue;
      p.put(i, j, shadow, 255 * a * (1 - smooth(0.45, 1, d)));
    }
  }
}

/** 부드러운 빛 무리 (색 c, 세기 a) */
export function glow(p: Pix, cx: number, cy: number, r: number, c: RGB, a: number): void {
  const { s } = p;
  for (let j = Math.max(0, p.row(cy - r)); j < Math.min(p.h, p.row(cy + r) + 1); j++) {
    const y = p.box.top + (j + 0.5) / s;
    for (let i = Math.max(0, p.col(cx - r)); i < Math.min(p.w, p.col(cx + r) + 1); i++) {
      const x = p.box.left + (i + 0.5) / s;
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r;
      if (d < 1) p.put(i, j, c, 255 * a * (1 - d) * (1 - d));
    }
  }
}

/** 타원 안을 칠함. fn 에 (x, y, ix, iy, dx, dy): dx, dy 는 중심에서 반지름 비 */
export function blob(p: Pix, cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, ix: number, iy: number, dx: number, dy: number) => RGB | null): void {
  p.paint(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y, ix, iy) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1 ? fn(x, y, ix, iy, dx, dy) : null;
  });
}

/** 공 모양 명암 (화면 좌표 타원을 반구로 보고) */
export function sphereV(dx: number, dy: number): number {
  const z = 1 - dx * dx - dy * dy;
  return lightN(dx, dy, z > 0 ? Math.sqrt(z) : 0);
}

/** 다각형 (짝홀 규칙). pts: [x0, y0, x1, y1, ...] */
export function poly(p: Pix, pts: readonly number[], fn: Shader): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < pts.length; k += 2) {
    x0 = Math.min(x0, pts[k]!);
    x1 = Math.max(x1, pts[k]!);
    y0 = Math.min(y0, pts[k + 1]!);
    y1 = Math.max(y1, pts[k + 1]!);
  }
  const n = pts.length / 2;
  p.paint(x0, y0, x1 + 1, y1 + 1, (x, y, ix, iy) => {
    let inside = false;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = pts[a * 2]!;
      const ay = pts[a * 2 + 1]!;
      const bx = pts[b * 2]!;
      const by = pts[b * 2 + 1]!;
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? fn(x, y, ix, iy) : null;
  });
}

/**
 * 평행사변형: 꼭짓점 (x0, y0) 에서 변 U = (ux, uy), V = (vx, vy).
 * 안쪽 점마다 fn(s, t, ix, iy), s·t 는 0~1 (U, V 방향 비율)
 */
export function quad(p: Pix, x0: number, y0: number, ux: number, uy: number, vx: number, vy: number, fn: (s: number, t: number, ix: number, iy: number) => RGB | null): void {
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-6) return;
  const xs = [x0, x0 + ux, x0 + vx, x0 + ux + vx];
  const ys = [y0, y0 + uy, y0 + vy, y0 + uy + vy];
  p.paint(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y, ix, iy) => {
    const dx = x - x0;
    const dy = y - y0;
    const s = (dx * vy - dy * vx) / det;
    const t = (dy * ux - dx * uy) / det;
    return s < 0 || s >= 1 || t < 0 || t >= 1 ? null : fn(s, t, ix, iy);
  });
}

/**
 * 굵기가 변하는 둥근 막대 a→b (반지름 ra→rb).
 * fn(v, t, k, ix, iy): v 원기둥 명암, t 길이 방향 0~1, k 단면 위치 (-1 왼쪽 ~ 1 오른쪽, 진행 방향 기준)
 */
export function rod(
  p: Pix,
  ax: number,
  ay: number,
  ra: number,
  bx: number,
  by: number,
  rb: number,
  fn: (v: number, t: number, k: number, ix: number, iy: number) => RGB | null,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  const len = Math.sqrt(len2);
  const px = -dy / len;
  const py = dx / len;
  const r = Math.max(ra, rb) + 1;
  p.paint(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, (x, y, ix, iy) => {
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x - (ax + dx * t);
    const qy = y - (ay + dy * t);
    const rr = Math.max(0.72, ra + (rb - ra) * t);
    if (qx * qx + qy * qy > rr * rr) return null;
    let k = (qx * px + qy * py) / rr;
    k = k < -1 ? -1 : k > 1 ? 1 : k;
    return fn(lightN(k * px, k * py, Math.sqrt(1 - k * k)), t, k, ix, iy);
  });
}

/**
 * 아이소 평면 위의 사각 면. 원점 (ox, oy) 에서 가로 U 만큼 (1, slope) 방향, 세로 V 만큼 아래로.
 * slope +0.5 는 왼쪽 면(왼쪽 아래를 봄), -0.5 는 오른쪽 면. fn(u, v, ix, iy)
 */
export function face(p: Pix, ox: number, oy: number, U: number, V: number, slope: number, fn: (u: number, v: number, ix: number, iy: number) => RGB | null): void {
  const ya = Math.min(0, U * slope);
  const yb = Math.max(0, U * slope);
  p.paint(ox, oy + ya, ox + U, oy + yb + V, (x, y, ix, iy) => {
    const u = x - ox;
    const v = y - (oy + u * slope);
    return u < 0 || u >= U || v < 0 || v >= V ? null : fn(u, v, ix, iy);
  });
}

export type FaceFn = (u: number, v: number, ix: number, iy: number) => RGB | null;

/**
 * 아이소 상자. 바닥 중심 (cx, cy), x축 방향 길이 A, y축 방향 길이 B (둘 다 화면 가로 픽셀), 높이 H.
 * 윗면은 (a, b) = (x축, y축 방향 거리), 옆면은 (u 가로, v 위에서 아래) 좌표로 칠합니다.
 */
export function isoBox(p: Pix, cx: number, cy: number, A: number, B: number, H: number, top: FaceFn | null, left: FaceFn | null, right: FaceFn | null): void {
  const lx = cx - A / 2 - B / 2;
  const ly = cy - A / 4 + B / 4;
  const fx = cx + A / 2 - B / 2;
  const fy = cy + A / 4 + B / 4;
  if (left) face(p, lx, ly - H, A, H, 0.5, left);
  if (right) face(p, fx, fy - H, B, H, -0.5, right);
  if (top) {
    const bx = cx - A / 2 + B / 2;
    const by = cy - A / 4 - B / 4 - H;
    p.paint(lx, by, cx + A / 2 + B / 2, fy - H, (x, y, ix, iy) => {
      const X = x - bx;
      const Y = y - by;
      const a = X / 2 + Y;
      const b = Y - X / 2;
      return a < 0 || a > A || b < 0 || b > B ? null : top(a, b, ix, iy);
    });
  }
}

// ───────────────────────── 회전체 (받침대·기둥·통·그루터기) ─────────────────────────

export interface LatheHit {
  /** 뚜껑(맨 윗면)이면 true */
  top: boolean;
  /** 높이 */
  h: number;
  /** 둘레 각 (앞 0, 왼쪽 음수, 라디안). 뚜껑이면 중심에서 본 각 */
  a: number;
  /** 옆면 기울기 dr/dh */
  k: number;
  /** 뚜껑: 중심에서 거리 비 0~1, 옆면: -1 */
  d: number;
  /** 기본 명암 0~1 */
  v: number;
  ix: number;
  iy: number;
}

/** 회전체 옆면의 명암을 다시 계산 (홈 파인 기둥처럼 각을 비틀 때) */
export function latheV(a: number, k: number): number {
  const n = Math.sqrt(1 + k * k);
  return lightW(Math.sin(a) / n, Math.cos(a) / n, -k / n);
}

/** 회전체 옆면의 화면 법선 (반짝임 계산용) */
export function latheN(a: number, k: number): [number, number, number] {
  const n = Math.sqrt(1 + k * k);
  const X = Math.sin(a) / n;
  const F = Math.cos(a) / n;
  const U = -k / n;
  return [X, 0.5 * F - 0.866 * U, 0.866 * F + 0.5 * U];
}

/** 금속 반짝임: 빛과 보는 방향의 가운데 방향과 법선이 가까울수록 */
export function gloss(nx: number, ny: number, nz: number, power: number): number {
  const d = nx * -0.28 + ny * -0.27 + nz * 0.92;
  return d > 0 ? Math.pow(d, power) : 0;
}

/**
 * 세로 축 회전체를 그립니다. 바닥 중심 (cx, cy), 높이 H, 높이별 반지름 r(h).
 * 2:1 시점이라 수평 원은 세로 절반 타원이 되고, 더 높은 점이 더 가까우므로 위에서부터 칠합니다.
 */
export function lathe(p: Pix, cx: number, cy: number, H: number, r: (h: number) => number, fn: (q: LatheHit) => RGB | null, cap = true): void {
  const { s, box } = p;
  const dh = 0.4 / s;
  const N = Math.ceil(H / dh) + 1;
  const hs = new Float64Array(N);
  const rs = new Float64Array(N);
  const ks = new Float64Array(N);
  let rMax = 0;
  for (let n = 0; n < N; n++) {
    const h = Math.max(0, H - n * dh);
    hs[n] = h;
    rs[n] = Math.max(0, r(h));
    rMax = Math.max(rMax, rs[n]!);
    const h0 = Math.max(0, h - 0.5);
    const h1 = Math.min(H, h + 0.5);
    ks[n] = h1 > h0 ? (r(h1) - r(h0)) / (h1 - h0) : 0;
  }
  const done = new Uint8Array(p.w * p.h);
  const q: LatheHit = { top: false, h: 0, a: 0, k: 0, d: -1, v: 0, ix: 0, iy: 0 };
  const hit = (i: number, j: number, ix: number) => {
    if (j < 0 || j >= p.h || done[j * p.w + i]) return;
    done[j * p.w + i] = 1;
    q.ix = ix;
    q.iy = Math.floor(box.top + (j + 0.5) / s);
    const c = fn(q);
    if (c) p.put(i, j, c);
  };
  const i0 = Math.max(0, p.col(cx - rMax));
  const i1 = Math.min(p.w, p.col(cx + rMax) + 1);
  const topV = lightW(0, 0, 1);
  for (let i = i0; i < i1; i++) {
    const x = box.left + (i + 0.5) / s;
    const xr = x - cx;
    const ix = Math.floor(x);
    if (cap && Math.abs(xr) < rs[0]!) {
      const rH = rs[0]!;
      const w = Math.sqrt(rH * rH - xr * xr);
      const yc = cy - H;
      for (let j = Math.max(0, p.row(yc - w / 2)); j <= Math.min(p.h - 1, p.row(yc + w / 2)); j++) {
        const y = box.top + (j + 0.5) / s;
        const zy = (y - yc) * 2;
        if (xr * xr + zy * zy > rH * rH) continue;
        q.top = true;
        q.h = H;
        q.a = Math.atan2(xr, zy);
        q.k = 0;
        q.d = Math.sqrt(xr * xr + zy * zy) / rH;
        q.v = topV;
        hit(i, j, ix);
      }
    }
    let lastF = -1;
    let lastB = -1;
    for (let n = 0; n < N; n++) {
      const rr = rs[n]!;
      if (Math.abs(xr) >= rr) {
        lastF = lastB = -1;
        continue;
      }
      const w = Math.sqrt(rr * rr - xr * xr);
      const h = hs[n]!;
      const sa = Math.asin(xr / rr);
      q.top = false;
      q.h = h;
      q.k = ks[n]!;
      q.d = -1;
      const jf = p.row(cy - h + w / 2);
      q.a = sa;
      q.v = latheV(sa, q.k);
      for (let j = lastF < 0 ? jf : lastF + 1; j <= jf; j++) hit(i, j, ix);
      if (jf > lastF) lastF = jf;
      const jb = p.row(cy - h - w / 2);
      q.a = Math.PI - sa;
      q.v = latheV(q.a, q.k);
      for (let j = lastB < 0 ? jb : lastB + 1; j <= jb; j++) hit(i, j, ix);
      if (jb > lastB) lastB = jb;
    }
  }
}

// ───────────────────────── 아이소 입체 (맵 좌표) ─────────────────────────

/**
 * 맵 좌표 (X: 맵 x축, Y: 맵 y축, Z: 위, 단위는 화면 px) → 발 기준 화면 좌표.
 * X 로 1 가면 화면 (1, 0.5), Y 로 1 가면 (-1, 0.5), Z 로 1 가면 (0, -1). 타일 한 칸 = X 32.
 */
export function isoAt(X: number, Y: number, Z: number): [number, number] {
  return [X - Y, (X + Y) / 2 - Z];
}

/**
 * 부호 거리 함수(sdf)로 정한 입체를 그립니다 (보는 쪽 (1,1,1) 방향에서 오는 평행 광선을 거꾸로 따라감).
 * 범위 [X0,X1]×[Y0,Y1]×[Z0,Z1] 안에서만 찾고, 맞은 점마다 fn(X, Y, Z, nx, ny, nz, ix, iy) 로 색을 정합니다.
 */
export function solid(
  p: Pix,
  bb: readonly [number, number, number, number, number, number],
  sdf: (X: number, Y: number, Z: number) => number,
  fn: (X: number, Y: number, Z: number, nx: number, ny: number, nz: number, ix: number, iy: number) => RGB | null,
): void {
  const [X0, X1, Y0, Y1, Z0, Z1] = bb;
  // 상자 여덟 꼭짓점의 화면 범위
  let sx0 = Infinity;
  let sx1 = -Infinity;
  let sy0 = Infinity;
  let sy1 = -Infinity;
  for (const X of [X0, X1])
    for (const Y of [Y0, Y1])
      for (const Z of [Z0, Z1]) {
        const [sx, sy] = isoAt(X, Y, Z);
        sx0 = Math.min(sx0, sx);
        sx1 = Math.max(sx1, sx);
        sy0 = Math.min(sy0, sy);
        sy1 = Math.max(sy1, sy);
      }
  const e = 0.35;
  p.paint(sx0, sy0, sx1 + 1, sy1 + 1, (x, y, ix, iy) => {
    // 화면 점 (x, y) 를 지나는 광선: (Xa + t, Ya + t, t)
    const Xa = y + x / 2;
    const Ya = y - x / 2;
    const tHi = Math.min(X1 - Xa, Y1 - Ya, Z1);
    const tLo = Math.max(X0 - Xa, Y0 - Ya, Z0);
    if (tHi < tLo) return null;
    let t = tHi;
    for (let n = 0; n < 40 && t >= tLo; n++) {
      const d = sdf(Xa + t, Ya + t, t);
      if (d < 0.08) {
        const X = Xa + t;
        const Y = Ya + t;
        const Z = t;
        const gx = sdf(X + e, Y, Z) - sdf(X - e, Y, Z);
        const gy = sdf(X, Y + e, Z) - sdf(X, Y - e, Z);
        const gz = sdf(X, Y, Z + e) - sdf(X, Y, Z - e);
        const gl = Math.hypot(gx, gy, gz) || 1;
        return fn(X, Y, Z, gx / gl, gy / gl, gz / gl, ix, iy);
      }
      t -= Math.max(0.12, d * 0.55);
    }
    return null;
  });
}
