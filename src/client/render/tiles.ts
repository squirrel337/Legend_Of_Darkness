// 타일 그리기: 바닥/벽/나무/물체. 자주 쓰는 그림은 미리 그려서 캐시합니다.
import { TILE_H, TILE_W } from '../../shared/constants';
import { TILESET, tileInfo, type TileInfo } from '../../shared/tiles';
import { HALF_H, HALF_W, WALL_H, diamondPath, makeCanvas, seeded, shade, withAlpha } from './iso';

const VARIANTS = 4;
const floorCache = new Map<string, HTMLCanvasElement>();
const wallCache = new Map<string, HTMLCanvasElement>();
const objCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number }>();

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

// ───────────────────────── 벽 ─────────────────────────

export function wallCanvas(ch: string): HTMLCanvasElement {
  let c = wallCache.get(ch);
  if (c) return c;
  const info = tileInfo(ch);
  const [canvas, ctx] = makeCanvas(TILE_W, TILE_H + WALL_H);
  const cx = HALF_W;
  const top = shade(info.color, 0.18);
  const left = info.color;
  const right = shade(info.color2, -0.05);
  // 왼쪽 면
  ctx.beginPath();
  ctx.moveTo(0, HALF_H);
  ctx.lineTo(cx, TILE_H);
  ctx.lineTo(cx, TILE_H + WALL_H);
  ctx.lineTo(0, HALF_H + WALL_H);
  ctx.closePath();
  ctx.fillStyle = left;
  ctx.fill();
  // 오른쪽 면
  ctx.beginPath();
  ctx.moveTo(cx, TILE_H);
  ctx.lineTo(TILE_W, HALF_H);
  ctx.lineTo(TILE_W, HALF_H + WALL_H);
  ctx.lineTo(cx, TILE_H + WALL_H);
  ctx.closePath();
  ctx.fillStyle = right;
  ctx.fill();
  // 무늬
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  const wooden = ch === 'W';
  const rough = ch === 'K' || ch === 'X' || ch === 'D';
  if (wooden) {
    for (let i = 1; i < 4; i++) {
      const x = (cx / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, HALF_H + (x / cx) * HALF_H);
      ctx.lineTo(x, HALF_H + (x / cx) * HALF_H + WALL_H);
      ctx.moveTo(cx + x, TILE_H - (x / cx) * HALF_H);
      ctx.lineTo(cx + x, TILE_H - (x / cx) * HALF_H + WALL_H);
      ctx.stroke();
    }
  } else if (ch !== 'H') {
    const rows = 4;
    for (let r = 1; r < rows; r++) {
      const dy = (WALL_H / rows) * r;
      ctx.beginPath();
      ctx.moveTo(0, HALF_H + dy);
      ctx.lineTo(cx, TILE_H + dy);
      ctx.lineTo(TILE_W, HALF_H + dy);
      ctx.stroke();
      // 벽돌 세로줄
      const off = r % 2 === 0 ? 8 : 0;
      for (let x = 8 + off; x < cx; x += 16) {
        const y0 = HALF_H + (x / cx) * HALF_H + dy;
        ctx.beginPath();
        ctx.moveTo(x, y0 - WALL_H / rows);
        ctx.lineTo(x, y0);
        ctx.stroke();
        const x2 = cx + x;
        const y2 = TILE_H - (x / cx) * HALF_H + dy;
        ctx.beginPath();
        ctx.moveTo(x2, y2 - WALL_H / rows);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    if (rough) {
      const rnd = seeded(ch.charCodeAt(0) * 99);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 14; i++) ctx.fillRect(rnd() * TILE_W, HALF_H + rnd() * WALL_H, 3, 2);
    }
  } else {
    // 신전 벽: 매끈한 벽 + 금색 띠
    ctx.fillStyle = withAlpha('#d4af37', 0.55);
    ctx.beginPath();
    ctx.moveTo(0, HALF_H + 6);
    ctx.lineTo(cx, TILE_H + 6);
    ctx.lineTo(TILE_W, HALF_H + 6);
    ctx.lineTo(TILE_W, HALF_H + 9);
    ctx.lineTo(cx, TILE_H + 9);
    ctx.lineTo(0, HALF_H + 9);
    ctx.closePath();
    ctx.fill();
  }
  // 윗면
  diamondPath(ctx, cx, 0);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
  // 모서리 강조
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(cx, TILE_H);
  ctx.lineTo(cx, TILE_H + WALL_H);
  ctx.stroke();
  wallCache.set(ch, canvas);
  return canvas;
}

// ───────────────────────── 나무와 물체 ─────────────────────────

/** 물체 캐시: 기준점(ox, oy)은 타일 중심(발 위치) */
export function objectSprite(ch: string, variant: number): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const info = tileInfo(ch);
  const key = `${ch}:${variant % VARIANTS}`;
  let o = objCache.get(key);
  if (o) return o;
  const W = 96;
  const H = 140;
  const [canvas, ctx] = makeCanvas(W, H);
  const ox = W / 2;
  const oy = H - 24;
  ctx.translate(ox, oy);
  const rnd = seeded(ch.charCodeAt(0) * 7 + variant * 13);
  drawObjectShape(ctx, info, rnd);
  o = { canvas, ox, oy };
  objCache.set(key, o);
  return o;
}

function shadow(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawObjectShape(ctx: CanvasRenderingContext2D, info: TileInfo, rnd: () => number): void {
  const c2 = info.color2;
  switch (info.shape) {
    case 'oak': {
      shadow(ctx, 22, 9);
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(-4, -34, 8, 34);
      const leaves = [shade(c2, -0.1), c2, shade(c2, 0.15)];
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = leaves[i % 3]!;
        ctx.beginPath();
        ctx.arc((rnd() - 0.5) * 30, -48 - rnd() * 26, 12 + rnd() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha('#ffffff', 0.08);
      ctx.beginPath();
      ctx.arc(-6, -66, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pine': {
      shadow(ctx, 18, 8);
      ctx.fillStyle = '#4a2f1a';
      ctx.fillRect(-3, -22, 6, 22);
      const h = 70 + rnd() * 20;
      for (let i = 0; i < 4; i++) {
        const y = -18 - i * (h / 5);
        const w = 26 - i * 5;
        ctx.fillStyle = i % 2 ? c2 : shade(c2, 0.1);
        ctx.beginPath();
        ctx.moveTo(0, y - h / 3);
        ctx.lineTo(w, y);
        ctx.lineTo(-w, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'deadtree': {
      shadow(ctx, 16, 7);
      ctx.strokeStyle = c2;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -50);
      ctx.stroke();
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const y = -24 - i * 8;
        const dir = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(dir * (12 + rnd() * 8), y - 10 - rnd() * 8);
        ctx.stroke();
      }
      break;
    }
    case 'rock': {
      shadow(ctx, 16, 7);
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.lineTo(-12, -12);
      ctx.lineTo(-2, -20);
      ctx.lineTo(10, -16);
      ctx.lineTo(16, -4);
      ctx.lineTo(10, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(c2, 0.2);
      ctx.beginPath();
      ctx.moveTo(-10, -12);
      ctx.lineTo(-2, -18);
      ctx.lineTo(8, -14);
      ctx.lineTo(0, -9);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bush': {
      shadow(ctx, 16, 6);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? c2 : shade(c2, 0.15);
        ctx.beginPath();
        ctx.arc((rnd() - 0.5) * 18, -8 - rnd() * 8, 8 + rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (rnd() < 0.5) {
        ctx.fillStyle = '#ff6b8a';
        for (let i = 0; i < 3; i++) ctx.fillRect((rnd() - 0.5) * 18, -10 - rnd() * 8, 2, 2);
      }
      break;
    }
    case 'fence': {
      ctx.fillStyle = c2;
      ctx.strokeStyle = shade(c2, -0.3);
      for (const x of [-14, 0, 14]) {
        ctx.fillRect(x - 2, -22, 4, 22);
        ctx.strokeRect(x - 2, -22, 4, 22);
      }
      ctx.fillRect(-18, -18, 36, 3);
      ctx.fillRect(-18, -9, 36, 3);
      break;
    }
    case 'crate': {
      shadow(ctx, 14, 6);
      box(ctx, 22, 18, c2);
      ctx.strokeStyle = shade(c2, -0.35);
      ctx.beginPath();
      ctx.moveTo(-11, -9);
      ctx.lineTo(0, -3);
      ctx.moveTo(0, -3);
      ctx.lineTo(11, -9);
      ctx.stroke();
      break;
    }
    case 'barrel': {
      shadow(ctx, 12, 5);
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(0, -2, 10, 5, 0, 0, Math.PI);
      ctx.lineTo(-10, -22);
      ctx.ellipse(0, -22, 10, 5, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 2;
      for (const y of [-6, -16]) {
        ctx.beginPath();
        ctx.ellipse(0, y, 10, 4, 0, 0, Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = shade(c2, 0.2);
      ctx.beginPath();
      ctx.ellipse(0, -22, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'altar': {
      shadow(ctx, 22, 8);
      box(ctx, 34, 18, c2);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(-12, -22, 24, 2);
      ctx.fillStyle = '#fff3a0';
      ctx.beginPath();
      ctx.arc(0, -30, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pillar': {
      shadow(ctx, 14, 6);
      ctx.fillStyle = shade(c2, -0.1);
      ctx.fillRect(-9, -70, 18, 70);
      ctx.fillStyle = c2;
      ctx.fillRect(-9, -70, 9, 70);
      ctx.fillStyle = shade(c2, 0.15);
      ctx.fillRect(-12, -76, 24, 7);
      ctx.fillRect(-12, -6, 24, 6);
      break;
    }
    case 'grave': {
      shadow(ctx, 12, 5);
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-9, -18);
      ctx.arc(0, -18, 9, Math.PI, 0);
      ctx.lineTo(9, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(c2, -0.4);
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(0, -10);
      ctx.moveTo(-4, -18);
      ctx.lineTo(4, -18);
      ctx.stroke();
      break;
    }
    case 'well': {
      shadow(ctx, 18, 7);
      ctx.fillStyle = '#6b6560';
      ctx.beginPath();
      ctx.ellipse(0, -6, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f6fa8';
      ctx.beginPath();
      ctx.ellipse(0, -8, 11, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a3a22';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-14, -8);
      ctx.lineTo(-14, -36);
      ctx.lineTo(14, -36);
      ctx.lineTo(14, -8);
      ctx.stroke();
      break;
    }
    case 'table': {
      shadow(ctx, 16, 6);
      box(ctx, 26, 12, c2);
      break;
    }
    case 'statue': {
      shadow(ctx, 14, 6);
      box(ctx, 20, 10, shade(c2, -0.2));
      ctx.fillStyle = c2;
      ctx.fillRect(-6, -40, 12, 30);
      ctx.beginPath();
      ctx.arc(0, -46, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-12, -36, 4, 18);
      ctx.fillRect(8, -36, 4, 18);
      break;
    }
    case 'crystal': {
      ctx.shadowColor = c2;
      ctx.shadowBlur = 14;
      ctx.fillStyle = withAlpha(c2, 0.85);
      for (const [x, h, w] of [
        [-6, 30, 6],
        [4, 22, 5],
        [10, 14, 4],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x - w, 0);
        ctx.lineTo(x, -h);
        ctx.lineTo(x + w, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      break;
    }
    case 'torch': {
      // 가로등/횃불대 (불꽃은 따로 그림)
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-2, -40, 4, 40);
      ctx.fillStyle = '#5a5a5a';
      ctx.fillRect(-6, -44, 12, 5);
      break;
    }
    case 'stall': {
      shadow(ctx, 22, 8);
      box(ctx, 34, 14, '#8a5a32');
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(-16, -44, 3, 30);
      ctx.fillRect(13, -44, 3, 30);
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(-22, -40);
      ctx.lineTo(22, -40);
      ctx.lineTo(18, -50);
      ctx.lineTo(-18, -50);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (let i = -18; i < 18; i += 8) ctx.fillRect(i, -50, 4, 10);
      break;
    }
    default:
      break;
  }
}

/** 작은 아이소메트릭 상자 (가로 w, 높이 h) */
function box(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const hw = w / 2;
  const hh = w / 4;
  ctx.fillStyle = shade(color, -0.15);
  ctx.beginPath();
  ctx.moveTo(-hw, -hh);
  ctx.lineTo(0, 0);
  ctx.lineTo(0, -h);
  ctx.lineTo(-hw, -hh - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(color, -0.3);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(hw, -hh);
  ctx.lineTo(hw, -hh - h);
  ctx.lineTo(0, -h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(hw, -hh - h);
  ctx.lineTo(0, -2 * hh - h);
  ctx.lineTo(-hw, -hh - h);
  ctx.closePath();
  ctx.fill();
}

/** 횃불 불꽃 (매 프레임) */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, scale = 1): void {
  const f = Math.sin(time / 90 + x) * 1.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = '#ffb347';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ff7a1a';
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.quadraticCurveTo(-5, -8, f, -14);
  ctx.quadraticCurveTo(5, -8, 4, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.quadraticCurveTo(-2, -5, f * 0.6, -8);
  ctx.quadraticCurveTo(2, -5, 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export const WALL_HEIGHT = WALL_H;
