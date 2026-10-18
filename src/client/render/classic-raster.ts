// 고전 도트 캐릭터용 작은 소프트웨어 래스터라이저 (DOM 없음, 테스트에서 바로 씀).
// 캔버스 벡터 그림은 가장자리가 흐려져서 도트 느낌이 나지 않으므로, 점 하나하나를 직접 찍습니다.
// 좌표: 발 위치가 (0,0), 위쪽이 음수 y. 점 (x,y) 는 [x,x+1) x [y,y+1) 칸이고, 도형 안인지는 칸의 가운데로 판단합니다.
// 색은 ImageData 와 같은 바이트 순서로 묶은 32비트 정수(0xAABBGGRR)입니다.

/** 빛이 오는 방향 (왼쪽 위 앞) */
const LX = -0.62;
const LY = -0.5;
const LZ = 0.6;

/** 0xAABBGGRR 로 묶기 */
export function pack(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}
export const R = (c: number) => c & 255;
export const G = (c: number) => (c >>> 8) & 255;
export const B = (c: number) => (c >>> 16) & 255;
export const A = (c: number) => (c >>> 24) & 255;

/** 두 색 섞기 (t = 0 이면 a, 1 이면 b). 알파는 a 를 따름 */
export function mixPacked(a: number, b: number, t: number): number {
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return pack(f(R(a), R(b)), f(G(a), G(b)), f(B(a), B(b)), A(a));
}

/**
 * 재질: 어두운 색부터 밝은 색까지 4단계 + 외곽선 색.
 * 빛의 세기(-1~1)에 따라 단계를 고릅니다 (셀 셰이딩).
 */
export interface Mat {
  /** [가장 어두움, 그림자, 기본, 밝음] */
  t: readonly [number, number, number, number];
  /** 다른 부위 위에 겹칠 때 둘레에 긋는 선 색 */
  line: number;
}

/** 빛 세기 → 색 단계 문턱값 */
const T_DARK = -0.32;
const T_SH = 0.2;
const T_HI = 0.8;

function toneOf(m: Mat, light: number): number {
  return light < T_DARK ? m.t[0] : light < T_SH ? m.t[1] : light < T_HI ? m.t[2] : m.t[3];
}

/** 2x2 바이어 행렬 (-0.5 ~ 0.25): 명암 경계에 체크무늬 섞기 */
const BAYER = [-0.5, 0.0, 0.25, -0.25];

/**
 * 점 위치에 따른 명암 단계 (그림자 쪽 경계가 체크무늬로 섞여 손으로 찍은 느낌).
 * 밝은 면 경계는 체크무늬 없이 또렷하게: 원기둥(몸통·옷)의 빛은 가장 밝은 곳(약 0.86)이 문턱(0.8)에 가까워
 * 체크무늬가 여러 칸 넓이로 번져 옷감이 지저분해 보이므로 (원작 옷은 밝은 면이 깨끗한 띠)
 */
function toneAt(m: Mat, light: number, x: number, y: number, dither: number): number {
  if (light >= T_HI) return m.t[3];
  const l = light + BAYER[((y & 1) << 1) | (x & 1)]! * dither;
  return l < T_DARK ? m.t[0] : l < T_SH ? m.t[1] : m.t[2];
}

/** 구(머리, 둥근 덩어리)의 빛: 정규화 좌표 (-1~1) */
export function sphereLight(nx: number, ny: number): number {
  const q = nx * nx + ny * ny;
  const nz = q < 1 ? Math.sqrt(1 - q) : 0;
  return nx * LX + ny * LY + nz * LZ;
}

/** 세로 원기둥(몸통)의 빛: 가로 위치 nx (-1~1), 세로 기울기 ny 조금 */
function cylLight(nx: number, ny = 0): number {
  const c = Math.max(-1, Math.min(1, nx));
  const nz = Math.sqrt(1 - c * c);
  return c * LX + ny * LY + nz * LZ;
}

/** 다각형 그림자 방식 */
export type Shade =
  | { k: 'flat'; l: number }
  /** 가로 원기둥: 가운데 x 와 반폭 */
  | { k: 'cyl'; cx: number; hw: number; tilt?: number }
  /** 구: 가운데와 반지름 */
  | { k: 'ball'; cx: number; cy: number; rx: number; ry: number }
  /** 점마다 빛 함수 */
  | { k: 'fn'; f: (x: number, y: number) => number };

const FLAT_MID: Shade = { k: 'flat', l: 0.5 };

export class PixelBuf {
  readonly px: Uint32Array;
  readonly part: Uint8Array;
  /** 쓸 수 있는 부위 표 (null 이면 어디든). 1 이면 그 부위 위에 쓸 수 있음 */
  clip: Uint8Array | null = null;
  /** 명암 경계 체크무늬 세기 (0 이면 없음) */
  dither = 0.14;
  /** 마지막으로 칠한 점들 (외곽선 계산용) */
  private touched: Int32Array;
  private nTouched = 0;
  private recording = false;
  /** 외곽선·경계선 계산용 임시 목록 */
  private scratch: Int32Array;
  private keepTab = new Uint8Array(256);
  /** 칠한 칸의 범위 (버퍼 좌표, 포함). 비었으면 x0 > x1 */
  private bx0 = 0;
  private by0 = 0;
  private bx1 = -1;
  private by1 = -1;

  constructor(
    readonly w: number,
    readonly h: number,
    /** 발 위치의 버퍼 좌표 */
    readonly ox: number,
    readonly oy: number,
  ) {
    this.px = new Uint32Array(w * h);
    this.part = new Uint8Array(w * h);
    this.touched = new Int32Array(w * h);
    this.scratch = new Int32Array(w * h * 2);
    this.bx0 = w;
    this.by0 = h;
  }

  clear(): void {
    if (this.bx1 >= this.bx0) {
      // 칠한 줄만 지움
      const a = this.by0 * this.w;
      const b = (this.by1 + 1) * this.w;
      this.px.fill(0, a, b);
      this.part.fill(0, a, b);
    }
    this.bx0 = this.w;
    this.by0 = this.h;
    this.bx1 = -1;
    this.by1 = -1;
    this.clip = null;
    this.nTouched = 0;
    this.recording = false;
  }

  /** 칠한 범위에 칸 하나를 넣음 */
  private mark(i: number): void {
    const x = i % this.w;
    const y = (i - x) / this.w;
    if (x < this.bx0) this.bx0 = x;
    if (x > this.bx1) this.bx1 = x;
    if (y < this.by0) this.by0 = y;
    if (y > this.by1) this.by1 = y;
  }

  /** 스프라이트 좌표 → 버퍼 번호 (밖이면 -1) */
  idx(x: number, y: number): number {
    const bx = x + this.ox;
    const by = y + this.oy;
    if (bx < 0 || by < 0 || bx >= this.w || by >= this.h) return -1;
    return by * this.w + bx;
  }

  /** 클립 표: 주어진 부위들 위에만 칠함 (0 = 빈 곳 포함 여부) */
  setClip(parts: readonly number[] | null): void {
    if (!parts) {
      this.clip = null;
      return;
    }
    const c = new Uint8Array(256);
    for (const p of parts) c[p] = 1;
    this.clip = c;
  }

  put(i: number, color: number, part: number): void {
    if (i < 0) return;
    const pa = this.part;
    if (this.clip !== null && this.clip[pa[i]!] === 0) return;
    if (pa[i] === 0) this.mark(i);
    this.px[i] = color;
    pa[i] = part;
    if (this.recording) this.touched[this.nTouched++] = i;
  }

  /** 반투명 장식 칸을 바로 씀 (외곽선 없음) */
  setSoft(i: number, color: number): void {
    if (i < 0 || i >= this.part.length) return;
    if (this.part[i] === 0) this.mark(i);
    this.px[i] = color;
    this.part[i] = SOFT_PART;
  }

  /** 점 하나 */
  dot(x: number, y: number, color: number, part: number): void {
    this.put(this.idx(Math.floor(x), Math.floor(y)), color, part);
  }

  /**
   * 빛 점: 칠한 칸 위에서는 그 색을 color 쪽으로 a 만큼 섞고(불투명 유지),
   * 빈 칸에는 반투명 점을 둡니다 (외곽선을 만들지 않는 SOFT_PART).
   */
  glow(x: number, y: number, color: number, a: number): void {
    const i = this.idx(Math.floor(x), Math.floor(y));
    if (i < 0 || a <= 0) return;
    const cur = this.px[i]!;
    const p = this.part[i]!;
    if (p !== 0 && p !== SOFT_PART) {
      this.px[i] = mixPacked(cur, color, Math.min(1, a)) | 0xff000000;
      return;
    }
    const prevA = p === SOFT_PART ? A(cur) / 255 : 0;
    const na = Math.min(1, a + prevA * (1 - a));
    const mixed = p === SOFT_PART ? mixPacked(cur, color, a / Math.max(0.001, na)) : color;
    this.setSoft(i, ((Math.round(na * 255) & 255) << 24) | (mixed & 0xffffff));
  }

  /** 그 점의 색 (없으면 0) */
  get(x: number, y: number): number {
    const i = this.idx(Math.floor(x), Math.floor(y));
    return i < 0 ? 0 : this.px[i]!;
  }

  partAt(x: number, y: number): number {
    const i = this.idx(Math.floor(x), Math.floor(y));
    return i < 0 ? 0 : this.part[i]!;
  }

  rect(x: number, y: number, w: number, h: number, color: number, part: number): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put(this.idx(xx, yy), color, part);
  }

  /** 1px 선 (브레젠험) */
  line(x0: number, y0: number, x1: number, y1: number, color: number, part: number): void {
    let ax = Math.floor(x0);
    let ay = Math.floor(y0);
    const bx = Math.floor(x1);
    const by = Math.floor(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 512; n++) {
      this.put(this.idx(ax, ay), color, part);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  /** 타원 (구 명암) */
  ellipse(cx: number, cy: number, rx: number, ry: number, m: Mat, part: number, shade: 'ball' | 'flat' = 'ball', flatL = 0.5): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const ny = (y + 0.5 - cy) / ry;
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        if (nx * nx + ny * ny > 1) continue;
        const l = shade === 'ball' ? sphereLight(nx, ny) : flatL;
        this.put(this.idx(x, y), shade === 'ball' ? toneAt(m, l, x, y, this.dither) : toneOf(m, l), part);
      }
    }
  }

  /**
   * 굵기가 변하는 선분 (팔다리). 단면은 원기둥처럼 칠합니다.
   * ra, rb = 양 끝의 반지름
   */
  capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: Mat, part: number, lightBias = 0): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const rmax = Math.max(ra, rb);
    const x0 = Math.floor(Math.min(ax, bx) - rmax);
    const x1 = Math.ceil(Math.max(ax, bx) + rmax);
    const y0 = Math.floor(Math.min(ay, by) - rmax);
    const y1 = Math.ceil(Math.max(ay, by) + rmax);
    const len = Math.sqrt(len2) || 1;
    // 단면의 수직 방향 (왼쪽)
    const px = dy / len;
    const py = -dx / len;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5 - ax;
        const qy = y + 0.5 - ay;
        let t = len2 > 0 ? (qx * dx + qy * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const r = ra + (rb - ra) * t;
        const ex = qx - dx * t;
        const ey = qy - dy * t;
        const d2 = ex * ex + ey * ey;
        if (d2 > r * r) continue;
        // 단면 위치 s (-1~1): 수직 방향 성분
        const s = r > 0 ? (ex * px + ey * py) / r : 0;
        const nzz = Math.sqrt(Math.max(0, 1 - s * s));
        const l = s * px * LX + s * py * LY + nzz * LZ + lightBias;
        this.put(this.idx(x, y), toneAt(m, l, x, y, this.dither), part);
      }
    }
  }

  /** 다각형 (점 목록은 [x0,y0,x1,y1,...]) */
  poly(pts: readonly number[], m: Mat, part: number, shade: Shade = FLAT_MID): void {
    const n = pts.length >> 1;
    if (n < 3) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2]!;
      const y = pts[i * 2 + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.floor(minY);
    const y1 = Math.ceil(maxY);
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = pts[i * 2 + 1]!;
        const yj = pts[j * 2 + 1]!;
        if (yi > sy !== yj > sy) {
          const xi = pts[i * 2]!;
          const xj = pts[j * 2]!;
          xs.push(xi + ((sy - yi) / (yj - yi)) * (xj - xi));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // 칸 가운데가 [xa, xb) 안에 드는 칸
        const xa = Math.ceil(xs[k]! - 0.5);
        const xb = Math.ceil(xs[k + 1]! - 0.5);
        for (let x = xa; x < xb; x++) {
          let l: number;
          switch (shade.k) {
            case 'flat':
              l = shade.l;
              break;
            case 'cyl':
              l = cylLight((x + 0.5 - shade.cx) / shade.hw, shade.tilt ?? 0);
              break;
            case 'ball':
              l = sphereLight((x + 0.5 - shade.cx) / shade.rx, (sy - shade.cy) / shade.ry);
              break;
            default:
              l = shade.f(x + 0.5, sy);
          }
          this.put(this.idx(x, y), shade.k === 'flat' ? toneOf(m, l) : toneAt(m, l, x, y, this.dither), part);
        }
      }
    }
  }

  /** 지금부터 칠하는 점을 기억 (contour 에 씀) */
  begin(): void {
    this.nTouched = 0;
    this.recording = true;
  }

  /**
   * begin() 뒤에 칠한 점들의 둘레 중 다른 부위 위에 있는 점을 선 색으로 칠합니다
   * (앞 부위와 뒤 부위 사이의 경계선). 빈 곳은 건드리지 않습니다 (나중에 외곽선이 그림).
   * keep: 선을 긋지 않을 뒤 부위들
   */
  contour(part: number, color: number, keep: readonly number[] = []): void {
    this.recording = false;
    const { px, w } = this;
    const pa = this.part;
    const n = this.nTouched;
    const kt = this.keepTab;
    kt.fill(0);
    kt[0] = 1;
    kt[part] = 1;
    kt[LINE_PART] = 1;
    for (const k of keep) kt[k] = 1;
    const hits = this.scratch;
    let nh = 0;
    const last = pa.length;
    for (let k = 0; k < n; k++) {
      const i = this.touched[k]!;
      if (pa[i] !== part) continue;
      const x = i % w;
      if (x > 0 && kt[pa[i - 1]!] === 0) hits[nh++] = i - 1;
      if (x < w - 1 && kt[pa[i + 1]!] === 0) hits[nh++] = i + 1;
      if (i >= w && kt[pa[i - w]!] === 0) hits[nh++] = i - w;
      if (i + w < last && kt[pa[i + w]!] === 0) hits[nh++] = i + w;
    }
    for (let k = 0; k < nh; k++) {
      const j = hits[k]!;
      px[j] = color;
      pa[j] = LINE_PART;
    }
    this.nTouched = 0;
  }

  /** begin() 기록 중단 (선 없이) */
  end(): void {
    this.recording = false;
    this.nTouched = 0;
  }

  /**
   * 실루엣 외곽선: 빈 칸 중 상하좌우에 칠한 칸이 있으면 그 색을 아주 어둡게 한 색으로.
   * dark: 0~1 (1 이면 base 색 그대로)
   */
  outline(base: number, dark = 0.78): void {
    const { px, part, w, h } = this;
    if (this.bx1 < this.bx0) return;
    const out = this.scratch;
    let n = 0;
    const x0 = Math.max(0, this.bx0 - 1);
    const x1 = Math.min(w - 1, this.bx1 + 1);
    const y0 = Math.max(0, this.by0 - 1);
    const y1 = Math.min(h - 1, this.by1 + 1);
    const solid = (p: number) => p !== 0 && p !== SOFT_PART;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (part[i] !== 0) continue;
        let src = -1;
        if (y > 0 && solid(part[i - w]!)) src = i - w;
        else if (x > 0 && solid(part[i - 1]!)) src = i - 1;
        else if (x < w - 1 && solid(part[i + 1]!)) src = i + 1;
        else if (y < h - 1 && solid(part[i + w]!)) src = i + w;
        if (src >= 0) {
          out[n++] = i;
          out[n++] = src;
        }
      }
    }
    for (let k = 0; k < n; k += 2) {
      const i = out[k]!;
      px[i] = mixPacked(px[out[k + 1]!]!, base, dark) | 0xff000000;
      part[i] = OUTLINE_PART;
      this.mark(i);
    }
  }

  /** 칠한 칸의 범위 (스프라이트 좌표). 비었으면 null */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    if (this.bx1 < this.bx0) return null;
    return { x: this.bx0 - this.ox, y: this.by0 - this.oy, w: this.bx1 - this.bx0 + 1, h: this.by1 - this.by0 + 1 };
  }

  /** 가장 위에 칠한 줄의 y (스프라이트 좌표). 부위를 고르면 그 부위만 봄 */
  topY(parts?: readonly number[]): number | null {
    const { part, w } = this;
    if (this.bx1 < this.bx0) return null;
    for (let y = this.by0; y <= this.by1; y++) {
      for (let x = this.bx0; x <= this.bx1; x++) {
        const p = part[y * w + x]!;
        if (p === 0) continue;
        if (parts && !parts.includes(p)) continue;
        return y - this.oy;
      }
    }
    return null;
  }

  /**
   * 잘라낸 범위를 정수배로 키운 RGBA 바이트 (ImageData 용).
   * 최근접 확대라 점이 또렷합니다.
   */
  toRGBA(crop: { x: number; y: number; w: number; h: number }, scale: number): Uint8ClampedArray<ArrayBuffer> {
    const s = Math.max(1, Math.floor(scale));
    const W = crop.w * s;
    const H = crop.h * s;
    const out = new Uint32Array(W * H);
    for (let y = 0; y < crop.h; y++) {
      const sy = y + crop.y + this.oy;
      for (let x = 0; x < crop.w; x++) {
        const c = this.px[sy * this.w + x + crop.x + this.ox]!;
        if (c === 0) continue;
        for (let yy = 0; yy < s; yy++) {
          const row = (y * s + yy) * W + x * s;
          for (let xx = 0; xx < s; xx++) out[row + xx] = c;
        }
      }
    }
    return new Uint8ClampedArray(out.buffer);
  }
}

/** 부위 사이 경계선으로 칠한 칸 */
const LINE_PART = 254;
/** 실루엣 외곽선 칸 */
export const OUTLINE_PART = 255;
/** 반투명 장식(기운, 빛) 칸: 외곽선을 만들지 않음 */
export const SOFT_PART = 253;
