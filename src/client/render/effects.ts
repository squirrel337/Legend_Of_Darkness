// 시각 효과: 떠오르는 숫자, 마법 투사체, 폭발, 치유 등
import { ELEMENT_COLORS, type Element } from '../../shared/constants';
import type { DamageKind } from '../../shared/protocol';
import { withAlpha } from './iso';

export interface Point {
  sx: number;
  sy: number;
}

/** 엔티티의 현재 화면 위치를 구하는 함수 (사라졌으면 null) */
export type Locate = (id: number) => Point | null;

interface FloatText {
  kind: 'text';
  text: string;
  color: string;
  size: number;
  start: number;
  dur: number;
  id: number | null;
  at: Point;
  dx: number;
}

interface Fx {
  kind: 'fx';
  name: string;
  color: string;
  start: number;
  dur: number;
  targetId: number | null;
  fromId: number | null;
  at: Point;
  from: Point | null;
  seed: number;
}

type Effect = FloatText | Fx;

const PROJECTILES = new Set(['bolt', 'ki', 'throw', 'holy']);

export class Effects {
  private list: Effect[] = [];

  damage(id: number, at: Point, v: number, k: DamageKind, isSelf: boolean, now: number): void {
    let text = v.toLocaleString('ko-KR');
    let color = '#ffffff';
    let size = 15;
    switch (k) {
      case 'phys':
        color = isSelf ? '#ff6b6b' : '#ffffff';
        break;
      case 'crit':
        color = isSelf ? '#ff4040' : '#ffd93d';
        size = 19;
        text += '!';
        break;
      case 'magic':
        color = isSelf ? '#ff6b9a' : '#8fd3ff';
        size = 16;
        break;
      case 'heal':
        if (v <= 0) return;
        color = '#6bff8f';
        text = '+' + text;
        break;
      case 'mp':
        color = '#6b9bff';
        text = '+' + text;
        size = 13;
        break;
      case 'dot':
        color = '#b6ff6b';
        size = 13;
        break;
      case 'miss':
        color = '#bbbbbb';
        text = 'MISS';
        size = 13;
        break;
      case 'immune':
        color = '#dddddd';
        text = '무적';
        size = 13;
        break;
    }
    this.list.push({ kind: 'text', text, color, size, start: now, dur: 1100, id, at, dx: (Math.random() - 0.5) * 16 });
  }

  text(id: number | null, at: Point, text: string, color: string, now: number, size = 14, dur = 1400): void {
    this.list.push({ kind: 'text', text, color, size, start: now, dur, id, at, dx: 0 });
  }

  fx(name: string, el: Element | undefined, targetId: number | null, at: Point, fromId: number | null, from: Point | null, now: number): void {
    const color = el && el !== 'none' ? ELEMENT_COLORS[el] : defaultColor(name);
    const proj = PROJECTILES.has(name) && from && fromId !== targetId;
    if (proj) {
      this.list.push({ kind: 'fx', name: 'projectile:' + name, color, start: now, dur: 260, targetId, fromId, at, from, seed: Math.random() });
      this.list.push({ kind: 'fx', name: 'impact', color, start: now + 250, dur: 380, targetId, fromId, at, from: null, seed: Math.random() });
      return;
    }
    const dur = name === 'levelup' || name === 'revive' ? 1400 : name === 'explosion' ? 600 : 650;
    this.list.push({ kind: 'fx', name, color, start: now, dur, targetId, fromId, at, from, seed: Math.random() });
  }

  get count(): number {
    return this.list.length;
  }

  draw(ctx: CanvasRenderingContext2D, now: number, locate: Locate, toScreen: (p: Point) => Point): void {
    this.list = this.list.filter((e) => now < e.start + e.dur);
    for (const e of this.list) {
      if (now < e.start) continue;
      const t = (now - e.start) / e.dur;
      if (e.kind === 'text') {
        const base = (e.id !== null ? locate(e.id) : null) ?? e.at;
        if (e.id !== null && locate(e.id)) e.at = base;
        const p = toScreen(base);
        const y = p.sy - 52 - t * 30;
        ctx.save();
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.font = `bold ${e.size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        const scale = t < 0.12 ? 1 + (0.12 - t) * 3 : 1;
        ctx.translate(p.sx + e.dx, y);
        ctx.scale(scale, scale);
        ctx.strokeText(e.text, 0, 0);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, 0, 0);
        ctx.restore();
        continue;
      }
      const target = (e.targetId !== null ? locate(e.targetId) : null) ?? e.at;
      if (e.targetId !== null && locate(e.targetId)) e.at = target;
      const p = toScreen(target);
      ctx.save();
      drawFx(ctx, e, t, p, e.from ? toScreen((e.fromId !== null ? locate(e.fromId) : null) ?? e.from) : null);
      ctx.restore();
    }
  }
}

function defaultColor(name: string): string {
  switch (name) {
    case 'heal':
      return '#6bff8f';
    case 'buff':
      return '#7fb7ff';
    case 'debuff':
      return '#b14dff';
    case 'revive':
    case 'levelup':
      return '#ffe066';
    case 'teleport':
      return '#7fd6ff';
    case 'shadow':
      return '#6d6d8f';
    case 'poison':
      return '#7fdc4f';
    case 'sleep':
      return '#8fa8ff';
    case 'paralyze':
      return '#ffe14f';
    case 'meditate':
      return '#7fb7ff';
    case 'cleanse':
      return '#ffffff';
    case 'holy':
      return '#fff3a0';
    case 'ki':
      return '#fff3a0';
    default:
      return '#ffe9b0';
  }
}

function drawFx(ctx: CanvasRenderingContext2D, e: Fx, t: number, p: Point, from: Point | null): void {
  const cx = p.sx;
  const cy = p.sy - 20;
  const c = e.color;
  const ease = 1 - Math.pow(1 - t, 2);
  if (e.name.startsWith('projectile:') && from) {
    const kind = e.name.slice(11);
    const fx = from.sx + (p.sx - from.sx) * t;
    const fy = from.sy - 26 + (p.sy - 20 - (from.sy - 26)) * t - Math.sin(t * Math.PI) * 14;
    ctx.globalCompositeOperation = 'lighter';
    if (kind === 'throw') {
      ctx.translate(fx, fy);
      ctx.rotate(t * 20);
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      return;
    }
    for (let i = 0; i < 5; i++) {
      const k = i / 5;
      const tx = from.sx + (p.sx - from.sx) * Math.max(0, t - k * 0.15);
      const ty = from.sy - 26 + (p.sy - 20 - (from.sy - 26)) * Math.max(0, t - k * 0.15) - Math.sin(Math.max(0, t - k * 0.15) * Math.PI) * 14;
      ctx.fillStyle = withAlpha(c, 0.5 * (1 - k));
      ctx.beginPath();
      ctx.arc(tx, ty, 7 * (1 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  switch (e.name) {
    case 'impact':
    case 'explosion': {
      const big = e.name === 'explosion';
      ctx.globalCompositeOperation = 'lighter';
      const r = (big ? 34 : 18) * ease;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r + 1);
      g.addColorStop(0, withAlpha('#ffffff', 0.9 * (1 - t)));
      g.addColorStop(0.4, withAlpha(c, 0.8 * (1 - t)));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(c, 1 - t);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, r * 1.3, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < (big ? 10 : 5); i++) {
        const a = (i / (big ? 10 : 5)) * Math.PI * 2 + e.seed * 6;
        ctx.fillStyle = withAlpha(c, 1 - t);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 0.7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'slash':
    case 'stab':
    case 'punch':
    case 'smash': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(e.name === 'smash' ? '#ffb347' : '#ffffff', 1 - t);
      ctx.lineWidth = e.name === 'smash' ? 4 : 3;
      ctx.beginPath();
      if (e.name === 'stab') {
        ctx.moveTo(cx - 14 + t * 10, cy + 6);
        ctx.lineTo(cx + 10 + t * 10, cy - 6);
      } else if (e.name === 'punch') {
        ctx.arc(cx, cy, 6 + t * 14, 0, Math.PI * 2);
      } else {
        ctx.arc(cx - 6, cy + 8, 22, -1.6 + t * 0.6, -0.2 + t * 0.6);
      }
      ctx.stroke();
      if (e.name === 'smash') {
        ctx.strokeStyle = withAlpha('#c49a5a', 1 - t);
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + e.seed;
          ctx.beginPath();
          ctx.moveTo(p.sx, p.sy);
          ctx.lineTo(p.sx + Math.cos(a) * 26 * ease, p.sy + Math.sin(a) * 12 * ease);
          ctx.stroke();
        }
      }
      break;
    }
    case 'whirl': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha('#ffffff', 0.9 * (1 - t));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy - 14, 40 * ease + 6, 18 * ease + 3, 0, t * 8, t * 8 + 4.5);
      ctx.stroke();
      break;
    }
    case 'heal':
    case 'cleanse':
    case 'meditate': {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const a = e.seed * 10 + i * 0.8;
        const x = cx + Math.cos(a) * 12;
        const y = cy + 18 - t * 40 - (i % 3) * 6;
        ctx.fillStyle = withAlpha(c, 1 - t);
        if (e.name === 'heal') {
          ctx.fillRect(x - 1, y - 4, 2, 8);
          ctx.fillRect(x - 4, y - 1, 8, 2);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'buff':
    case 'debuff':
    case 'teleport': {
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const tt = Math.max(0, t - k * 0.25);
        ctx.strokeStyle = withAlpha(c, 1 - tt);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy - tt * (e.name === 'debuff' ? 10 : 40), 18, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.name === 'teleport') {
        ctx.fillStyle = withAlpha(c, 0.4 * (1 - t));
        ctx.fillRect(p.sx - 12, p.sy - 60, 24, 60);
      }
      break;
    }
    case 'revive':
    case 'levelup': {
      ctx.globalCompositeOperation = 'lighter';
      const a = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      const g = ctx.createLinearGradient(0, p.sy - 140, 0, p.sy);
      g.addColorStop(0, withAlpha(c, 0));
      g.addColorStop(1, withAlpha(c, 0.55 * a));
      ctx.fillStyle = g;
      ctx.fillRect(p.sx - 16, p.sy - 140, 32, 140);
      for (let i = 0; i < 12; i++) {
        const ang = e.seed * 20 + i;
        const r = 10 + (i % 4) * 5;
        ctx.fillStyle = withAlpha('#ffffff', a);
        ctx.beginPath();
        ctx.arc(p.sx + Math.cos(ang + t * 4) * r, p.sy - 10 - t * 90 - i * 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'shadow': {
      for (let i = 0; i < 6; i++) {
        const a = e.seed * 10 + i;
        ctx.fillStyle = `rgba(30,30,50,${0.5 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(p.sx + Math.cos(a) * 14 * ease, p.sy - 14 + Math.sin(a) * 8 * ease, 8 * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'dash': {
      ctx.fillStyle = `rgba(200,180,140,${0.5 * (1 - t)})`;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(p.sx + (i - 2) * 6, p.sy - 2, 5 + t * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sleep': {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = withAlpha(c, 1 - t);
      ctx.fillText('Z', p.sx + 8 + t * 6, p.sy - 50 - t * 20);
      ctx.fillText('z', p.sx + 16 + t * 8, p.sy - 60 - t * 24);
      break;
    }
    case 'paralyze':
    case 'poison':
    case 'holy':
    case 'ki': {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const a = e.seed * 12 + i * 0.9;
        ctx.fillStyle = withAlpha(c, 1 - t);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 14 * ease, cy + Math.sin(a) * 10 * ease - t * 10, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (e.name === 'holy') {
        ctx.fillStyle = withAlpha(c, 0.4 * (1 - t));
        ctx.fillRect(p.sx - 6, p.sy - 90, 12, 90);
      }
      break;
    }
    default: {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = withAlpha(c, 0.6 * (1 - t));
      ctx.beginPath();
      ctx.arc(cx, cy, 14 * ease, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
