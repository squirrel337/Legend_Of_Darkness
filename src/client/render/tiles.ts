// 타일 그리기: 바닥/벽/나무/물체. 자주 쓰는 그림은 미리 그려서 캐시합니다.
import { TILE_H, TILE_W } from '../../shared/constants';
import { TILESET, tileInfo, type TileInfo } from '../../shared/tiles';
import { HALF_H, HALF_W, WALL_H, diamondPath, makeCanvas, seeded, shade, withAlpha } from './iso';

const VARIANTS = 4;
const floorCache = new Map<string, HTMLCanvasElement>();

// ───────────────────────── 바닥 ─────────────────────────

function drawFloorPattern(ctx: CanvasRenderingContext2D, info: TileInfo, rnd: () => number): void {
  const cx = HALF_W;
  diamondPath(ctx, cx, 0);
  ctx.fillStyle = info.color;
  ctx.fill();
  ctx.save();
  diamondPath(ctx, cx, 0);
  ctx.clip();
  const p = info.pattern;
  const c2 = info.color2;
  if (p === 'grass' || p === 'swamp') {
    for (let i = 0; i < 26; i++) {
      const x = rnd() * TILE_W;
      const y = rnd() * TILE_H;
      ctx.strokeStyle = rnd() < 0.5 ? c2 : shade(info.color, -0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 3);
      ctx.stroke();
    }
    if (p === 'swamp') {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = withAlpha('#2a4a5a', 0.5);
        ctx.beginPath();
        ctx.ellipse(10 + rnd() * 44, 8 + rnd() * 16, 6 + rnd() * 6, 3 + rnd() * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (p === 'dirt' || p === 'sand' || p === 'ash' || p === 'cave') {
    const n = p === 'sand' ? 40 : 22;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rnd() < 0.5 ? c2 : shade(info.color, 0.12);
      ctx.fillRect(rnd() * TILE_W, rnd() * TILE_H, p === 'sand' ? 1 : 2, 1);
    }
    if (p === 'cave' || p === 'ash') {
      ctx.strokeStyle = shade(info.color, -0.25);
      ctx.beginPath();
      const x = rnd() * TILE_W;
      const y = rnd() * TILE_H;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + rnd() * 6, y + (rnd() - 0.5) * 4);
      ctx.lineTo(x + 10 + rnd() * 8, y + (rnd() - 0.5) * 6);
      ctx.stroke();
    }
  } else if (p === 'cobble') {
    for (let i = 0; i < 9; i++) {
      const x = 6 + rnd() * (TILE_W - 12);
      const y = 3 + rnd() * (TILE_H - 6);
      ctx.fillStyle = rnd() < 0.5 ? shade(info.color, 0.08) : shade(info.color, -0.06);
      ctx.strokeStyle = c2;
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + rnd() * 3, 3 + rnd() * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (p === 'planks') {
    ctx.strokeStyle = c2;
    ctx.lineWidth = 1;
    for (let i = -4; i < 8; i++) {
      const off = i * 8;
      ctx.beginPath();
      ctx.moveTo(off, 0);
      ctx.lineTo(off + TILE_W, TILE_H);
      ctx.stroke();
    }
    ctx.fillStyle = shade(info.color, -0.2);
    for (let i = 0; i < 3; i++) ctx.fillRect(rnd() * TILE_W, rnd() * TILE_H, 2, 1);
  } else if (p === 'tiles' || p === 'marble') {
    ctx.strokeStyle = c2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HALF_W / 2, HALF_H / 2);
    ctx.lineTo(HALF_W / 2 + HALF_W, HALF_H / 2 + HALF_H);
    ctx.moveTo(HALF_W / 2 + HALF_W, HALF_H / 2);
    ctx.lineTo(HALF_W / 2, HALF_H / 2 + HALF_H);
    ctx.stroke();
    if (p === 'marble') {
      ctx.strokeStyle = withAlpha('#a09a90', 0.5);
      ctx.beginPath();
      const x = rnd() * TILE_W;
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + 10, TILE_H / 2, x - 4, TILE_H);
      ctx.stroke();
    } else {
      ctx.fillStyle = shade(info.color, -0.15);
      for (let i = 0; i < 6; i++) ctx.fillRect(rnd() * TILE_W, rnd() * TILE_H, 2, 1);
    }
  }
  ctx.restore();
  // 아주 옅은 경계선
  diamondPath(ctx, cx, 0.5, TILE_W - 1, TILE_H - 1);
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.stroke();
}

function floorKeyFor(ch: string): string {
  const info = tileInfo(ch);
  // 물체/나무/벽 아래 바닥은 비슷한 바닥 타일을 사용
  if (info.kind === 'floor') return ch;
  if (info.kind === 'tree' || info.kind === 'object') {
    for (const [k, v] of Object.entries(TILESET)) if (v.kind === 'floor' && v.color === info.color && !v.shape) return k;
    return '.';
  }
  return ch;
}

export function floorCanvas(ch: string, variant: number): HTMLCanvasElement {
  const key = `${floorKeyFor(ch)}:${variant % VARIANTS}`;
  let c = floorCache.get(key);
  if (!c) {
    const [canvas, ctx] = makeCanvas(TILE_W, TILE_H);
    const info = tileInfo(floorKeyFor(ch));
    drawFloorPattern(ctx, info, seeded(key.length * 977 + variant * 131 + info.color.charCodeAt(2) * 7));
    if (info.shape === 'flowers' || ch === ':') {
      const rnd = seeded(variant * 17 + 5);
      const colors = ['#ff6b8a', '#ffd166', '#ffffff', '#c792ea', '#7fd6ff'];
      for (let i = 0; i < 7; i++) {
        const x = 14 + rnd() * 36;
        const y = 6 + rnd() * 18;
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)]!;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (info.shape === 'bones') {
      const rnd = seeded(variant * 31 + 9);
      ctx.strokeStyle = '#d8d2c0';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const x = 16 + rnd() * 30;
        const y = 8 + rnd() * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6, y + (rnd() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath();
      ctx.arc(30 + rnd() * 8, 14, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    floorCache.set(key, canvas);
    c = canvas;
  }
  return c;
}

// ───────────────────────── 물/용암 ─────────────────────────

export function drawLiquid(ctx: CanvasRenderingContext2D, info: TileInfo, sx: number, sy: number, x: number, y: number, time: number): void {
  diamondPath(ctx, sx, sy);
  ctx.fillStyle = info.color;
  ctx.fill();
  ctx.save();
  diamondPath(ctx, sx, sy);
  ctx.clip();
  const lava = info.name === '용암';
  ctx.strokeStyle = withAlpha(info.color2, lava ? 0.8 : 0.55);
  ctx.lineWidth = lava ? 2 : 1.2;
  for (let i = 0; i < 3; i++) {
    const phase = time / (lava ? 900 : 600) + x * 0.7 + y * 1.3 + i * 2.1;
    const yy = sy + 6 + i * 9 + Math.sin(phase) * 2;
    const xx = sx - 18 + ((phase * 6) % 36);
    ctx.beginPath();
    ctx.moveTo(xx - 6, yy);
    ctx.quadraticCurveTo(xx, yy - 2, xx + 6, yy);
    ctx.stroke();
  }
  if (lava) {
    ctx.fillStyle = withAlpha('#ffe066', 0.35 + 0.25 * Math.sin(time / 300 + x + y));
    ctx.beginPath();
    ctx.arc(sx + Math.sin(x * 3 + y) * 10, sy + HALF_H, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── 벽·나무·물체 ─────────────────────────
// 그림은 props.ts(물체) · flora.ts(나무) · rocks.ts(바위) · walls.ts(벽)에 있습니다
// (픽셀 단위 명암과 같은 계열의 외곽선, 화면 배율별 캐시).

export { drawFlame, objectSprite } from './props';
export { wallCanvas } from './walls';

export const WALL_HEIGHT = WALL_H;
