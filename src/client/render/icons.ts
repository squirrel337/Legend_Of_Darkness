// 아이템/기술 아이콘을 캔버스로 그립니다. DOM 에서는 data URL 로 캐시해서 씁니다.
import type { IconSpec } from '../../shared/types';
import { makeCanvas, shade, withAlpha } from './iso';

const urlCache = new Map<string, string>();

export function iconUrl(spec: IconSpec, size = 34): string {
  const key = `${spec.shape}|${spec.color}|${spec.color2 ?? ''}|${size}`;
  let url = urlCache.get(key);
  if (!url) {
    const [c, ctx] = makeCanvas(size, size);
    drawIcon(ctx, spec, size);
    url = c.toDataURL();
    urlCache.set(key, url);
  }
  return url;
}

/** size x size 영역 (0,0 기준)에 아이콘을 그립니다 */
export function drawIcon(ctx: CanvasRenderingContext2D, spec: IconSpec, size: number): void {
  ctx.save();
  ctx.scale(size / 32, size / 32);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const c = spec.color;
  const c2 = spec.color2 ?? shade(c, -0.35);
  const outline = 'rgba(0,0,0,0.55)';
  const glow = spec.color2;
  switch (spec.shape) {
    case 'sword':
      ctx.strokeStyle = outline;
      ctx.lineWidth = 5;
      line(ctx, 8, 24, 25, 7);
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      line(ctx, 8, 24, 25, 7);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      line(ctx, 11, 20, 24, 8);
      ctx.strokeStyle = '#8a6a2a';
      ctx.lineWidth = 3;
      line(ctx, 5, 21, 11, 27);
      ctx.strokeStyle = '#5a3a22';
      line(ctx, 4, 28, 8, 24);
      break;
    case 'axe':
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 3;
      line(ctx, 7, 27, 22, 6);
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(18, 6);
      ctx.quadraticCurveTo(30, 6, 28, 18);
      ctx.lineTo(19, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'dagger':
      ctx.strokeStyle = outline;
      ctx.lineWidth = 4;
      line(ctx, 11, 21, 24, 8);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      line(ctx, 11, 21, 24, 8);
      ctx.strokeStyle = '#8a6a2a';
      ctx.lineWidth = 3;
      line(ctx, 8, 18, 14, 24);
      ctx.strokeStyle = '#3a2a1a';
      line(ctx, 6, 26, 10, 22);
      break;
    case 'claw':
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(6, 16, 14, 10);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      for (const y of [12, 17, 22]) line(ctx, 18, y + 2, 28, y - 4);
      break;
    case 'staff':
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 3;
      line(ctx, 6, 28, 22, 10);
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(24, 8, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    case 'mace':
      ctx.strokeStyle = '#7a5a3a';
      ctx.lineWidth = 3;
      line(ctx, 7, 27, 20, 12);
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(22, 10, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = shade(c, 0.4);
      ctx.fillRect(20, 6, 2, 2);
      break;
    case 'stick':
      ctx.strokeStyle = c;
      ctx.lineWidth = 4;
      line(ctx, 7, 26, 24, 7);
      ctx.strokeStyle = shade(c, -0.3);
      ctx.lineWidth = 1;
      line(ctx, 9, 23, 22, 9);
      break;
    case 'armor':
    case 'leather':
    case 'gi':
    case 'robe': {
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (spec.shape === 'robe') {
        ctx.moveTo(11, 4);
        ctx.lineTo(21, 4);
        ctx.lineTo(27, 10);
        ctx.lineTo(24, 13);
        ctx.lineTo(23, 29);
        ctx.lineTo(9, 29);
        ctx.lineTo(8, 13);
        ctx.lineTo(5, 10);
      } else {
        ctx.moveTo(10, 5);
        ctx.lineTo(22, 5);
        ctx.lineTo(28, 11);
        ctx.lineTo(24, 15);
        ctx.lineTo(23, 27);
        ctx.lineTo(9, 27);
        ctx.lineTo(8, 15);
        ctx.lineTo(4, 11);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      if (spec.shape === 'armor') {
        line(ctx, 10, 13, 22, 13);
        line(ctx, 10, 19, 22, 19);
      } else if (spec.shape === 'gi') {
        line(ctx, 12, 5, 18, 16);
        line(ctx, 9, 18, 23, 18);
      } else if (spec.shape === 'robe') {
        line(ctx, 16, 5, 16, 28);
      } else {
        line(ctx, 9, 17, 23, 17);
      }
      break;
    }
    case 'helmet':
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.arc(16, 18, 10, Math.PI, 0);
      ctx.lineTo(26, 22);
      ctx.lineTo(6, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = shade(c, -0.35);
      ctx.fillRect(10, 18, 12, 3);
      ctx.fillStyle = shade(c, 0.35);
      ctx.fillRect(15, 7, 2, 10);
      break;
    case 'shield':
    case 'shieldIcon':
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, 4);
      ctx.lineTo(27, 8);
      ctx.quadraticCurveTo(27, 22, 16, 29);
      ctx.quadraticCurveTo(5, 22, 5, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      line(ctx, 16, 8, 16, 25);
      line(ctx, 9, 14, 23, 14);
      break;
    case 'necklace':
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(16, 10, 9, 0.2, Math.PI - 0.2);
      ctx.stroke();
      gem(ctx, 16, 21, 5, c, glow);
      break;
    case 'earring':
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(16, 9, 4, 0, Math.PI * 2);
      ctx.stroke();
      line(ctx, 16, 13, 16, 17);
      gem(ctx, 16, 21, 5, c, glow);
      break;
    case 'ring':
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(16, 19, 8, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      gem(ctx, 16, 11, 4.5, c, glow);
      break;
    case 'belt':
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(3, 13, 26, 7);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 11, 8, 11);
      gem(ctx, 16, 16.5, 2.5, c, glow);
      break;
    case 'boots':
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.moveTo(8, 5);
      ctx.lineTo(16, 5);
      ctx.lineTo(16, 20);
      ctx.lineTo(26, 22);
      ctx.lineTo(26, 27);
      ctx.lineTo(8, 27);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = shade(c, -0.4);
      ctx.fillRect(8, 25, 18, 2);
      break;
    case 'potion':
      ctx.fillStyle = withAlpha('#ffffff', 0.25);
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.moveTo(13, 4);
      ctx.lineTo(19, 4);
      ctx.lineTo(19, 11);
      ctx.quadraticCurveTo(27, 15, 26, 22);
      ctx.quadraticCurveTo(25, 29, 16, 29);
      ctx.quadraticCurveTo(7, 29, 6, 22);
      ctx.quadraticCurveTo(5, 15, 13, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(7, 19);
      ctx.quadraticCurveTo(16, 16, 25, 19);
      ctx.quadraticCurveTo(25, 28, 16, 28);
      ctx.quadraticCurveTo(7, 28, 7, 19);
      ctx.fill();
      ctx.fillStyle = '#8a5a32';
      ctx.fillRect(13, 2, 6, 4);
      if (spec.color2) {
        ctx.fillStyle = spec.color2;
        ctx.beginPath();
        ctx.arc(12, 21, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(10, 14, 2, 4);
      break;
    case 'scroll':
      ctx.fillStyle = c;
      ctx.strokeStyle = outline;
      ctx.fillRect(7, 8, 18, 16);
      ctx.strokeRect(7, 8, 18, 16);
      ctx.fillStyle = shade(c, -0.25);
      ctx.beginPath();
      ctx.ellipse(7, 16, 3, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(25, 16, 3, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = spec.color2 ?? '#8a5a32';
      ctx.lineWidth = 1.5;
      line(ctx, 11, 13, 21, 13);
      line(ctx, 11, 17, 21, 17);
      line(ctx, 11, 21, 18, 21);
      break;
    case 'gem':
      gem(ctx, 16, 16, 9, c, glow ?? c);
      break;
    case 'orb':
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(16, 16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(13, 13, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bone':
      ctx.strokeStyle = c;
      ctx.lineWidth = 4;
      line(ctx, 9, 23, 23, 9);
      ctx.fillStyle = c;
      for (const [x, y] of [
        [7, 21],
        [11, 25],
        [21, 7],
        [25, 11],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'pelt':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(6, 10);
      ctx.lineTo(12, 6);
      ctx.lineTo(20, 6);
      ctx.lineTo(26, 10);
      ctx.lineTo(24, 26);
      ctx.lineTo(16, 28);
      ctx.lineTo(8, 26);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(c, -0.3);
      line(ctx, 12, 14, 20, 20);
      break;
    case 'wing':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(6, 24);
      ctx.quadraticCurveTo(10, 6, 27, 5);
      ctx.quadraticCurveTo(22, 12, 24, 16);
      ctx.quadraticCurveTo(16, 18, 18, 22);
      ctx.quadraticCurveTo(12, 22, 6, 24);
      ctx.fill();
      break;
    case 'tail':
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(6, 24);
      ctx.bezierCurveTo(14, 30, 22, 4, 27, 10);
      ctx.stroke();
      break;
    case 'web':
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        line(ctx, 16, 16, 16 + Math.cos(a) * 12, 16 + Math.sin(a) * 12);
      }
      for (const r of [4, 8, 12]) {
        ctx.beginPath();
        ctx.arc(16, 16, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'ear':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(8, 26);
      ctx.quadraticCurveTo(4, 6, 26, 5);
      ctx.quadraticCurveTo(20, 18, 8, 26);
      ctx.fill();
      break;
    case 'scale':
      for (const [x, y] of [
        [12, 12],
        [20, 12],
        [16, 20],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = shade(c, 0.3);
        ctx.stroke();
      }
      break;
    case 'coin':
      for (const [x, y] of [
        [11, 21],
        [19, 22],
        [15, 16],
      ] as const) {
        ctx.fillStyle = '#d4af37';
        ctx.strokeStyle = '#8a6a1a';
        ctx.beginPath();
        ctx.ellipse(x, y, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    // ── 기술/마법 아이콘 ──
    case 'slash':
      bg(ctx, c);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(8, 26, 18, -1.3, -0.1);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(10, 24, 13, -1.3, -0.1);
      ctx.stroke();
      break;
    case 'burst':
      bg(ctx, c);
      ctx.fillStyle = shade(c, 0.4);
      star(ctx, 16, 16, 12, 5, 8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(16, 16, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bolt':
      bg(ctx, c);
      ctx.fillStyle = shade(c, 0.5);
      ctx.beginPath();
      ctx.moveTo(18, 3);
      ctx.lineTo(9, 18);
      ctx.lineTo(15, 18);
      ctx.lineTo(12, 29);
      ctx.lineTo(23, 13);
      ctx.lineTo(17, 13);
      ctx.closePath();
      ctx.fill();
      break;
    case 'heart':
      bg(ctx, c);
      ctx.fillStyle = shade(c, 0.45);
      ctx.beginPath();
      ctx.moveTo(16, 26);
      ctx.bezierCurveTo(3, 17, 7, 6, 16, 12);
      ctx.bezierCurveTo(25, 6, 29, 17, 16, 26);
      ctx.fill();
      break;
    case 'cross':
      bg(ctx, c);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(13, 5, 6, 22);
      ctx.fillRect(7, 11, 18, 6);
      break;
    case 'fist':
      bg(ctx, c);
      ctx.fillStyle = '#f1c9a5';
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.roundRect(8, 9, 16, 14, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      for (const x of [12, 16, 20]) line(ctx, x, 10, x, 15);
      break;
    case 'eye':
      bg(ctx, c);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(16, 16, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a2a';
      ctx.beginPath();
      ctx.arc(16, 16, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'skull':
      bg(ctx, c);
      ctx.fillStyle = '#f0ead8';
      ctx.beginPath();
      ctx.arc(16, 14, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(12, 18, 8, 7);
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(13, 14, 2, 0, Math.PI * 2);
      ctx.arc(19, 14, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'wave':
      bg(ctx, c);
      ctx.strokeStyle = shade(c, 0.5);
      ctx.lineWidth = 2.5;
      for (const y of [11, 17, 23]) {
        ctx.beginPath();
        ctx.moveTo(5, y);
        ctx.quadraticCurveTo(10, y - 5, 16, y);
        ctx.quadraticCurveTo(22, y + 5, 27, y);
        ctx.stroke();
      }
      break;
    case 'leaf':
      bg(ctx, c);
      ctx.fillStyle = shade(c, 0.45);
      ctx.beginPath();
      ctx.moveTo(7, 25);
      ctx.quadraticCurveTo(6, 7, 26, 6);
      ctx.quadraticCurveTo(25, 26, 7, 25);
      ctx.fill();
      ctx.strokeStyle = shade(c, -0.3);
      line(ctx, 8, 24, 22, 10);
      break;
    case 'star':
      bg(ctx, c);
      ctx.fillStyle = shade(c, 0.5);
      star(ctx, 16, 16, 11, 5, 5);
      break;
    default:
      ctx.fillStyle = c;
      ctx.fillRect(6, 6, 20, 20);
  }
  ctx.restore();
}

function bg(ctx: CanvasRenderingContext2D, c: string): void {
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, shade(c, -0.1));
  g.addColorStop(1, shade(c, -0.65));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(1, 1, 30, 30, 5);
  ctx.fill();
  ctx.strokeStyle = shade(c, 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function gem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, glow?: string): void {
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6;
  }
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.4, y - r * 0.2);
  ctx.lineTo(x - r * 0.4, y - r * 0.2);
  ctx.closePath();
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
