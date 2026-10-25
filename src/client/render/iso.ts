// 아이소메트릭 좌표 변환과 색 도우미
import { TILE_H, TILE_W } from '../../shared/constants';

export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
export const WALL_H = 40;

/** 타일 (x,y)의 마름모 위쪽 꼭짓점의 화면 좌표 (월드 기준) */
export function tileTop(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * HALF_W, sy: (x + y) * HALF_H };
}

/** 타일 중심(발 위치)의 화면 좌표 */
export function tileCenter(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * HALF_W, sy: (x + y) * HALF_H + HALF_H };
}

/** 월드 화면 좌표 → 타일 좌표 */
export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const fx = (sx / HALF_W + sy / HALF_H) / 2;
  const fy = (sy / HALF_H - sx / HALF_W) / 2;
  return { x: Math.floor(fx), y: Math.floor(fy) };
}

export function diamondPath(ctx: CanvasRenderingContext2D, cx: number, top: number, w = TILE_W, h = TILE_H): void {
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + w / 2, top + h / 2);
  ctx.lineTo(cx, top + h);
  ctx.lineTo(cx - w / 2, top + h / 2);
  ctx.closePath();
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** amount > 0 이면 밝게, < 0 이면 어둡게 (-1 ~ 1) */
export function shade(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** 결정적 의사 난수 (좌표 → 0~1) */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}
