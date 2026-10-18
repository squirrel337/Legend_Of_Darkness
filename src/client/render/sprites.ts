// 몬스터와 바닥 아이템 그리기. 모든 그림은 발 위치(0,0)를 기준으로 위쪽(음수 y)에 그립니다.
// (사람 캐릭터는 chibi.ts)
import type { Dir } from '../../shared/constants';
import type { ItemDef, MonsterLook } from '../../shared/types';
import { drawIcon } from './icons';
import { shade, withAlpha } from './iso';

const isFront = (d: Dir) => d === 1 || d === 2;
const facesLeft = (d: Dir) => d === 2 || d === 3;

function shadow(ctx: CanvasRenderingContext2D, rx: number, ry: number, a = 0.3): void {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ───────────────────────── 몬스터 ─────────────────────────

export interface MonsterPose {
  dir: Dir;
  walk: number | null;
  act: number | null;
  time: number;
  /** 사라지는 중 (0~1) */
  fade?: number;
  /** false 면 발밑 그림자를 빼고 몸만 (가려진 몬스터를 덧그릴 때) */
  shadow?: boolean;
}

export function drawMonster(ctx: CanvasRenderingContext2D, look: MonsterLook, o: MonsterPose): void {
  const s = look.size ?? 1;
  ctx.save();
  if (o.fade !== undefined) ctx.globalAlpha = Math.max(0, 1 - o.fade);
  if (o.shadow !== false) shadow(ctx, 13 * s, 5 * s);
  if (facesLeft(o.dir)) ctx.scale(-1, 1);
  ctx.scale(s, s);
  const c = look.color;
  const c2 = look.color2 ?? shade(c, -0.35);
  const t = o.time / 1000;
  const lunge = o.act !== null ? Math.sin(o.act * Math.PI) * 5 : 0;
  ctx.translate(lunge, 0);
  const step = o.walk !== null ? Math.sin(o.walk * Math.PI * 2) : 0;
  const front = isFront(o.dir);
  switch (look.body) {
    case 'rat': {
      const y = -6 - Math.abs(step) * 1.5;
      ctx.strokeStyle = shade(c, 0.25);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-9, y + 2);
      ctx.quadraticCurveTo(-18, y - 2, -16, y - 8);
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, y, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(9, y - 1, 5, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(c, 0.3);
      ctx.beginPath();
      ctx.arc(7, y - 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      eye(ctx, 11, y - 2, 1.2, look.eye ?? '#ff3030');
      ctx.fillStyle = '#ff9aa8';
      ctx.fillRect(13, y - 1, 2, 1.5);
      break;
    }
    case 'bat': {
      const flap = Math.sin(t * 14) * 0.8;
      const y = -26 + Math.sin(t * 3) * 3;
      ctx.fillStyle = c2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(side * 10, y - 12 * flap - 4, side * 18, y - 6 * flap);
        ctx.quadraticCurveTo(side * 12, y + 2, side * 6, y + 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, y, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, y - 4);
      ctx.lineTo(-3, y - 9);
      ctx.lineTo(-1, y - 5);
      ctx.moveTo(4, y - 4);
      ctx.lineTo(3, y - 9);
      ctx.lineTo(1, y - 5);
      ctx.fill();
      eye(ctx, 2, y - 2, 1.2, look.eye ?? '#ffdd33');
      break;
    }
    case 'spider': {
      const y = -8;
      ctx.strokeStyle = shade(c, -0.2);
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) {
        const k = i - 1.5;
        const sw = Math.sin(t * 10 + i) * (o.walk !== null ? 2 : 0.5);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(k * 3, y);
          ctx.lineTo(k * 5 + side * 2, y - 6 + sw);
          ctx.lineTo(k * 7 + side * 3, 0);
          ctx.stroke();
        }
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(-5, y - 2, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(-6, y - 4, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(c, 0.1);
      ctx.beginPath();
      ctx.ellipse(6, y - 1, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      eye(ctx, 8, y - 2, 1, look.eye ?? '#ff3030');
      eye(ctx, 9.5, y - 0.5, 1, look.eye ?? '#ff3030');
      break;
    }
    case 'wolf': {
      const y = -14 - Math.abs(step) * 1.5;
      ctx.fillStyle = shade(c, -0.25);
      ctx.fillRect(-9 + step * 2, y + 3, 3, 11);
      ctx.fillRect(6 - step * 2, y + 3, 3, 11);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, y, 12, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-7 - step * 2, y + 3, 3, 11);
      ctx.fillRect(8 + step * 2, y + 3, 3, 11);
      ctx.beginPath();
      ctx.moveTo(-11, y - 2);
      ctx.quadraticCurveTo(-20, y - 6, -18, y - 12);
      ctx.lineWidth = 3;
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(12, y - 4, 6, 5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(15, y - 3);
      ctx.lineTo(22, y - 1);
      ctx.lineTo(16, y + 1);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(9, y - 8);
      ctx.lineTo(10, y - 14);
      ctx.lineTo(13, y - 8);
      ctx.fill();
      if (look.color2) {
        ctx.fillStyle = withAlpha(look.color2, 0.5 + 0.3 * Math.sin(t * 4));
        ctx.beginPath();
        ctx.ellipse(0, y, 12, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      eye(ctx, 14, y - 5, 1.3, look.eye ?? '#ffdd33');
      break;
    }
    case 'humanoid':
    case 'skeleton': {
      const bone = look.body === 'skeleton';
      const y0 = 0;
      const legC = bone ? c : shade(c, -0.35);
      ctx.strokeStyle = legC;
      ctx.lineWidth = bone ? 2.5 : 4;
      ctx.beginPath();
      ctx.moveTo(-3, y0 - 13);
      ctx.lineTo(-4 + step * 2, y0);
      ctx.moveTo(3, y0 - 13);
      ctx.lineTo(4 - step * 2, y0);
      ctx.stroke();
      if (bone) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(0, -30);
        for (const yy of [-26, -22, -18]) {
          ctx.moveTo(-5, yy);
          ctx.lineTo(5, yy);
        }
        ctx.stroke();
        if (look.color2) {
          ctx.fillStyle = withAlpha(look.color2, 0.85);
          ctx.beginPath();
          ctx.moveTo(-8, -31);
          ctx.lineTo(8, -31);
          ctx.lineTo(9, -14);
          ctx.lineTo(-9, -14);
          ctx.closePath();
          ctx.globalAlpha *= 0.6;
          ctx.fill();
          ctx.globalAlpha /= 0.6;
        }
      } else {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-8, -31);
        ctx.lineTo(8, -31);
        ctx.lineTo(9, -12);
        ctx.lineTo(-9, -12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = c2;
        ctx.fillRect(-9, -18, 18, 3);
      }
      // 팔과 무기
      ctx.strokeStyle = bone ? c : shade(c, 0.1);
      ctx.lineWidth = bone ? 2 : 3.5;
      const arm = o.act !== null ? -1.4 + o.act * 2.2 : 0.3;
      ctx.beginPath();
      ctx.moveTo(-8, -29);
      ctx.lineTo(-10, -17);
      ctx.stroke();
      ctx.save();
      ctx.translate(8, -29);
      ctx.rotate(arm * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1, 11);
      ctx.stroke();
      ctx.translate(1, 12);
      ctx.rotate(arm * 0.6);
      ctx.strokeStyle = '#9aa0a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, -16);
      ctx.stroke();
      ctx.restore();
      // 머리
      ctx.fillStyle = bone ? shade(c, 0.1) : shade(c, 0.12);
      ctx.beginPath();
      ctx.arc(0, -37, bone ? 6.5 : 7, 0, Math.PI * 2);
      ctx.fill();
      if (bone) {
        ctx.fillStyle = '#1a1a1a';
        if (front) {
          ctx.beginPath();
          ctx.arc(1.5, -38, 1.8, 0, Math.PI * 2);
          ctx.arc(5, -38, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        eye(ctx, front ? 1.5 : 3, -38, 0.8, look.eye ?? (look.color2 ? '#ff3030' : '#ff9a30'));
      } else {
        // 귀 (고블린/오크 느낌)
        ctx.beginPath();
        ctx.moveTo(-6, -39);
        ctx.lineTo(-11, -43);
        ctx.lineTo(-6, -35);
        ctx.fill();
        if (front) {
          eye(ctx, 2, -38, 1.3, look.eye ?? '#ffdd33');
          eye(ctx, 5.5, -38, 1.3, look.eye ?? '#ffdd33');
        }
      }
      break;
    }
    case 'ghost': {
      const y = -24 + Math.sin(t * 2.5) * 3;
      ctx.globalAlpha *= 0.8;
      const g = ctx.createLinearGradient(0, y - 18, 0, y + 20);
      g.addColorStop(0, withAlpha(c, 0.95));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, y - 6, 10, Math.PI, 0);
      ctx.lineTo(10, y + 14);
      for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(7 - i * 5, y + 10 + (i % 2) * 6, 5 - i * 5, y + 14);
      ctx.lineTo(-10, y - 6);
      ctx.fill();
      eye(ctx, 2, y - 7, 1.6, look.eye ?? '#1a1a3a');
      eye(ctx, 6, y - 7, 1.6, look.eye ?? '#1a1a3a');
      ctx.fillStyle = withAlpha(c2, 0.6);
      ctx.beginPath();
      ctx.ellipse(4, y - 1, 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'slime': {
      const sq = 1 + Math.sin(t * 5) * 0.08;
      ctx.fillStyle = withAlpha(c, 0.85);
      ctx.beginPath();
      ctx.ellipse(0, -8 * sq, 12 / sq, 9 * sq, 0, Math.PI, 0);
      ctx.lineTo(12 / sq, 0);
      ctx.lineTo(-12 / sq, 0);
      ctx.fill();
      eye(ctx, 3, -9, 1.5, '#1a1a1a');
      eye(ctx, 7, -9, 1.5, '#1a1a1a');
      break;
    }
    case 'golem': {
      const y = 0;
      ctx.fillStyle = shade(c, -0.3);
      ctx.fillRect(-9, y - 12, 7, 12);
      ctx.fillRect(2, y - 12, 7, 12);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(-13, y - 36, 26, 25, 4);
      ctx.fill();
      ctx.fillStyle = shade(c, -0.15);
      ctx.beginPath();
      ctx.roundRect(-19 + lunge * 0.2, y - 34, 7, 20, 3);
      ctx.roundRect(12, y - 34, 7, 20, 3);
      ctx.fill();
      ctx.fillStyle = shade(c, 0.15);
      ctx.beginPath();
      ctx.roundRect(-7, y - 46, 14, 11, 3);
      ctx.fill();
      ctx.strokeStyle = shade(c, -0.4);
      ctx.beginPath();
      ctx.moveTo(-8, y - 30);
      ctx.lineTo(-2, y - 24);
      ctx.lineTo(4, y - 28);
      ctx.stroke();
      if (look.color2) {
        ctx.fillStyle = withAlpha(look.color2, 0.5 + 0.3 * Math.sin(t * 3));
        ctx.beginPath();
        ctx.arc(0, y - 24, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      eye(ctx, 0, y - 41, 1.6, look.eye ?? '#7fd6ff');
      eye(ctx, 4, y - 41, 1.6, look.eye ?? '#7fd6ff');
      break;
    }
    case 'beast': {
      const y = 0;
      ctx.fillStyle = shade(c, -0.3);
      ctx.fillRect(-8 + step * 2, y - 14, 6, 14);
      ctx.fillRect(3 - step * 2, y - 14, 6, 14);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, y - 26, 13, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(2, y - 24, 7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(4, y - 41, 7, 0, Math.PI * 2);
      ctx.fill();
      // 뿔
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath();
      ctx.moveTo(-1, y - 45);
      ctx.lineTo(-5, y - 54);
      ctx.lineTo(2, y - 47);
      ctx.moveTo(7, y - 46);
      ctx.lineTo(10, y - 55);
      ctx.lineTo(10, y - 45);
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(10, y - 32);
      ctx.lineTo(15 + lunge, y - 20);
      ctx.stroke();
      eye(ctx, 6, y - 42, 1.5, look.eye ?? '#ff3030');
      break;
    }
    case 'dragon': {
      const y = -14;
      const flap = Math.sin(t * 4) * 0.5;
      ctx.fillStyle = withAlpha(c2, 0.85);
      ctx.beginPath();
      ctx.moveTo(-2, y - 10);
      ctx.quadraticCurveTo(-14, y - 34 - flap * 10, -26, y - 22 - flap * 6);
      ctx.quadraticCurveTo(-16, y - 18, -10, y - 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, y, 15, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(-13, y + 2);
      ctx.quadraticCurveTo(-24, y + 8, -28, y - 2);
      ctx.stroke();
      ctx.fillRect(-9 + step * 2, y + 5, 4, 9);
      ctx.fillRect(6 - step * 2, y + 5, 4, 9);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(10, y - 4);
      ctx.quadraticCurveTo(16, y - 16, 18, y - 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(21, y - 24, 7, 5, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8e2d0';
      ctx.beginPath();
      ctx.moveTo(18, y - 28);
      ctx.lineTo(15, y - 35);
      ctx.lineTo(21, y - 29);
      ctx.fill();
      ctx.fillStyle = withAlpha(c2, 0.9);
      ctx.beginPath();
      ctx.moveTo(2, y - 8);
      ctx.quadraticCurveTo(14, y - 30 - flap * 10, 4, y - 30 - flap * 4);
      ctx.quadraticCurveTo(0, y - 18, -4, y - 8);
      ctx.closePath();
      ctx.fill();
      eye(ctx, 24, y - 25, 1.5, look.eye ?? '#ffdd33');
      break;
    }
    case 'eye': {
      const y = -28 + Math.sin(t * 2) * 3;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.2 + (i / 5) * Math.PI * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, y + Math.sin(a) * 8);
        ctx.quadraticCurveTo(Math.cos(a) * 14 + Math.sin(t * 3 + i) * 3, y + 14, Math.cos(a) * 10, y + 22);
        ctx.stroke();
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0e8e0';
      ctx.beginPath();
      ctx.ellipse(2, y, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.eye ?? '#ff3030';
      ctx.shadowColor = look.eye ?? '#ff3030';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(4, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(4, y, 1, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'serpent': {
      const y = -6;
      ctx.strokeStyle = c;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-16, y + 2);
      for (let i = 0; i <= 4; i++) ctx.lineTo(-16 + i * 7, y + Math.sin(t * 6 + i) * 3);
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(14, y - 6, 7, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c2;
      for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 7, y - 3 + Math.sin(t * 6 + i) * 3, 3, 2);
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(20, y - 6, 4, 1);
      eye(ctx, 16, y - 8, 1.3, look.eye ?? '#ffdd33');
      break;
    }
    case 'plant': {
      ctx.fillStyle = c2;
      ctx.fillRect(-2, -18, 4, 18);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, -24, 9, 0, Math.PI * 2);
      ctx.fill();
      eye(ctx, 3, -25, 1.5, '#1a1a1a');
      break;
    }
    case 'dummy': {
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(-2, -30, 4, 30);
      ctx.fillRect(-14, -28, 28, 3);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, -22, 8, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(0, -37, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -22, 4, 0, Math.PI * 2);
      ctx.arc(0, -22, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ───────────────────────── 바닥 아이템 ─────────────────────────

export function drawGroundItem(ctx: CanvasRenderingContext2D, def: ItemDef | undefined, qty: number, time: number, seed: number): void {
  const bob = Math.sin(time / 400 + seed) * 1.2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(-11, -20 + bob);
  if (!def) {
    drawIcon(ctx, { shape: 'coin', color: '#d4af37' }, 22);
  } else {
    drawIcon(ctx, def.icon, 22);
    if (def.type === 'equip' && (def.level ?? 0) >= 25) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = withAlpha(def.icon.color2 ?? '#ffe680', 0.15 + 0.1 * Math.sin(time / 200));
      ctx.beginPath();
      ctx.arc(11, 11, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  void qty;
}
