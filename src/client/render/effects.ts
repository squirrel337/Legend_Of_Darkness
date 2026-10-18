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
  /** 대상 위치에서 조금 비켜 맞는 곳 (연사 화살) */
  off?: Point;
}

type Effect = FloatText | Fx;

const PROJECTILES = new Set(['bolt', 'ki', 'throw', 'holy', 'arrow']);

/** 효과별 지속 시간 (밀리초) */
const DURATION: Record<string, number> = {
  levelup: 1400,
  revive: 1400,
  explosion: 600,
  music: 1100,
  summon: 1000,
  claw: 420,
  roar: 650,
  twinslash: 480,
  mark: 1800,
  hit: 260,
};

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
    if (name === 'volley') {
      // 화살 여러 발: 시전자가 있으면 날아가고, 없으면 하늘에서 쏟아짐
      for (let i = 0; i < 4; i++) {
        const delay = i * 70;
        const off = { sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 8 };
        const flying = from !== null && fromId !== targetId;
        const base = { kind: 'fx' as const, color, targetId, fromId, at, seed: Math.random(), off };
        if (flying) this.list.push({ ...base, name: 'projectile:arrow', start: now + delay, dur: 230, from });
        else this.list.push({ ...base, name: 'arrowfall', start: now + delay, dur: 230, from: null });
        this.list.push({ ...base, name: 'hit', start: now + delay + 220, dur: 260, from: null });
      }
      return;
    }
    if (proj) {
      const arrow = name === 'arrow';
      this.list.push({ kind: 'fx', name: 'projectile:' + name, color, start: now, dur: arrow ? 220 : 260, targetId, fromId, at, from, seed: Math.random() });
      this.list.push({ kind: 'fx', name: arrow ? 'hit' : 'impact', color, start: now + (arrow ? 210 : 250), dur: arrow ? 260 : 380, targetId, fromId, at, from: null, seed: Math.random() });
      return;
    }
    const dur = DURATION[name] ?? 650;
    this.list.push({ kind: 'fx', name: name === 'arrow' ? 'hit' : name, color, start: now, dur, targetId, fromId, at, from, seed: Math.random() });
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
      let p = toScreen(target);
      if (e.off) p = { sx: p.sx + e.off.sx, sy: p.sy + e.off.sy };
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
    case 'arrow':
    case 'volley':
    case 'hit':
      return '#f4e8c8';
    case 'music':
      return '#ffd86b';
    case 'summon':
      return '#ff9ad0';
    case 'claw':
      return '#ffb070';
    case 'roar':
      return '#ff8a3d';
    case 'twinslash':
      return '#ffe0d0';
    case 'mark':
      return '#ff3b5c';
    default:
      return '#ffe9b0';
  }
}

function drawFx(ctx: CanvasRenderingContext2D, e: Fx, t: number, p: Point, from: Point | null): void {
  const cx = p.sx;
  const cy = p.sy - 20;
  const c = e.color;
  const ease = 1 - Math.pow(1 - t, 2);
  if (e.name === 'projectile:arrow' && from) {
    drawArrow(ctx, from, p, t, c);
    return;
  }
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
    case 'hit': {
      // 화살이 꽂힌 자리의 작은 불꽃
      ctx.globalCompositeOperation = 'lighter';
      const a = 1 - t;
      ctx.strokeStyle = withAlpha('#ffffff', a);
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const ang = e.seed * 6 + (i / 6) * Math.PI * 2;
        const r0 = 3 + ease * 4;
        const r1 = 7 + ease * 9;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.7);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.7);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha(c, 0.7 * a);
      ctx.beginPath();
      ctx.arc(cx, cy, 4 * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arrowfall': {
      // 하늘에서 비스듬히 떨어지는 화살
      const x = cx + 26 * (1 - ease);
      const y = cy - 90 * (1 - ease);
      drawArrowShape(ctx, x, y, Math.atan2(90, -26), c, 1);
      break;
    }
    case 'music': {
      // 대상 주위로 음표가 흔들리며 떠오름
      for (let i = 0; i < 5; i++) {
        const tt = t - i * 0.08;
        if (tt <= 0) continue;
        const k = Math.min(1, tt / 0.9);
        const ang = e.seed * 10 + i * 1.3;
        const x = p.sx + Math.cos(ang) * 16 + Math.sin(k * 9 + i) * 4;
        const y = p.sy - 18 - k * 46 - (i % 2) * 6;
        const a = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
        drawNote(ctx, x, y, i % 2 === 0, withAlpha(c, a), `rgba(40,20,0,${0.7 * a})`, 0.9 + (i % 3) * 0.15);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(c, 0.5 * (1 - t));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, 14 + ease * 10, 6 + ease * 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'summon': {
      // 바닥의 마법진 + 위로 솟는 반짝임
      ctx.globalCompositeOperation = 'lighter';
      const a = t < 0.2 ? t / 0.2 : 1 - Math.max(0, (t - 0.55) / 0.45);
      const r = 22 + ease * 4;
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.scale(1, 0.5);
      ctx.rotate(t * 2.4);
      ctx.strokeStyle = withAlpha(c, 0.9 * a);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      // 별 모양 (오각형 이음)
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const ang = (i * 2 * (Math.PI * 2)) / 5 - Math.PI / 2;
        const x = Math.cos(ang) * r * 0.72;
        const y = Math.sin(ang) * r * 0.72;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 둘레의 작은 룬
      ctx.fillStyle = withAlpha('#ffffff', 0.8 * a);
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.fillRect(Math.cos(ang) * r * 0.86 - 1.2, Math.sin(ang) * r * 0.86 - 1.2, 2.4, 2.4);
      }
      ctx.restore();
      const g = ctx.createRadialGradient(p.sx, p.sy - 10, 2, p.sx, p.sy - 10, 26);
      g.addColorStop(0, withAlpha(c, 0.45 * a));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy - 10, 26, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 10; i++) {
        const ang = e.seed * 20 + i * 2.1;
        const rr = 6 + ((i * 7) % 5) * 3.5;
        const y = p.sy - ((t * 1.4 + i * 0.13) % 1) * 56;
        ctx.fillStyle = withAlpha(i % 3 ? c : '#ffffff', a);
        ctx.beginPath();
        ctx.arc(p.sx + Math.cos(ang + t * 3) * rr, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'claw': {
      // 대각선으로 그어지는 발톱 자국 셋
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const tt = Math.min(1, Math.max(0, (t - i * 0.07) / 0.35));
        if (tt <= 0) continue;
        const a = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        const ox = (i - 1) * 7;
        const x0 = cx - 12 + ox;
        const y0 = cy - 14;
        const x1 = cx + 8 + ox;
        const y1 = cy + 12;
        const xe = x0 + (x1 - x0) * tt;
        const ye = y0 + (y1 - y0) * tt;
        ctx.strokeStyle = withAlpha(c, 0.8 * a);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + xe) / 2 + 3, (y0 + ye) / 2 - 2, xe, ye);
        ctx.stroke();
        ctx.strokeStyle = withAlpha('#ffffff', a);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      break;
    }
    case 'roar': {
      // 퍼져 나가는 충격파 고리 + 바깥으로 뻗는 선
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const tt = t - k * 0.15;
        if (tt <= 0) continue;
        const u = Math.min(1, tt / 0.85);
        const e2 = 1 - Math.pow(1 - u, 2);
        ctx.strokeStyle = withAlpha(k === 0 ? '#ffffff' : c, (1 - u) * 0.9);
        ctx.lineWidth = 3 - k * 0.6;
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy - 6, 10 + e2 * 46, 5 + e2 * 22, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = withAlpha(c, 0.7 * (1 - t));
      ctx.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + e.seed;
        const r0 = 14 + ease * 22;
        const r1 = r0 + 10;
        ctx.beginPath();
        ctx.moveTo(p.sx + Math.cos(ang) * r0, p.sy - 22 + Math.sin(ang) * r0 * 0.6);
        ctx.lineTo(p.sx + Math.cos(ang) * r1, p.sy - 22 + Math.sin(ang) * r1 * 0.6);
        ctx.stroke();
      }
      break;
    }
    case 'twinslash': {
      // X자로 엇갈리는 두 번 베기 (두 번째는 조금 늦게)
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        const tt = Math.min(1, Math.max(0, (t - i * 0.22) / 0.3));
        if (tt <= 0) continue;
        const a = 1 - Math.max(0, (t - i * 0.22 - 0.3) / 0.48);
        if (a <= 0) continue;
        const s = i === 0 ? 1 : -1;
        const x0 = cx - 16 * s;
        const y0 = cy - 16;
        const x1 = cx + 16 * s;
        const y1 = cy + 14;
        const xe = x0 + (x1 - x0) * tt;
        const ye = y0 + (y1 - y0) * tt;
        ctx.strokeStyle = withAlpha(c, 0.75 * a);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + xe) / 2 + 4 * s, (y0 + ye) / 2 - 4, xe, ye);
        ctx.stroke();
        ctx.strokeStyle = withAlpha('#ffffff', a);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      break;
    }
    case 'mark': {
      // 붉은 조준 표식: 크게 나타났다가 오므라들어 잠시 머묾
      const k = Math.min(1, t / 0.18);
      const a = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      const r = 12 + Math.pow(1 - k, 3) * 16;
      ctx.translate(p.sx, p.sy - 26);
      ctx.rotate((1 - k) * 1.2 + Math.sin(t * 8) * 0.04);
      ctx.strokeStyle = `rgba(40,0,10,${0.5 * a})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(c, 0.95 * a);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        ctx.moveTo(Math.cos(ang) * (r - 4), Math.sin(ang) * (r - 4));
        ctx.lineTo(Math.cos(ang) * (r + 6), Math.sin(ang) * (r + 6));
      }
      ctx.stroke();
      ctx.fillStyle = withAlpha(c, 0.9 * a);
      ctx.beginPath();
      ctx.moveTo(0, -3.4);
      ctx.lineTo(3.4, 0);
      ctx.lineTo(0, 3.4);
      ctx.lineTo(-3.4, 0);
      ctx.closePath();
      ctx.fill();
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

/** 화살 하나 (x,y = 촉, ang = 날아가는 방향) */
function drawArrowShape(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, fletch: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(30,18,10,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(-2, 0);
  ctx.stroke();
  ctx.strokeStyle = '#e2c08a';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#eef4fa';
  ctx.strokeStyle = 'rgba(30,18,10,0.85)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(2.5, 0);
  ctx.lineTo(-3.5, -2.6);
  ctx.lineTo(-3.5, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fletch;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-15.5, s * 3);
    ctx.lineTo(-13, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** 시전자 → 대상으로 거의 곧게 날아가는 화살 + 짧은 꼬리 */
function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, t: number, c: string): void {
  const x0 = from.sx;
  const y0 = from.sy - 28;
  const x1 = to.sx;
  const y1 = to.sy - 22;
  const at = (k: number): [number, number] => [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 8];
  const [x, y] = at(t);
  const [xb, yb] = at(Math.max(0, t - 0.06));
  const ang = t > 0.06 ? Math.atan2(y - yb, x - xb) : Math.atan2(y1 - y0 - 8, x1 - x0);
  const [tx, ty] = at(Math.max(0, t - 0.35));
  const g = ctx.createLinearGradient(tx, ty, x, y);
  g.addColorStop(0, withAlpha(c, 0));
  g.addColorStop(1, withAlpha(c, 0.75));
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
  drawArrowShape(ctx, x, y, ang, c, 1);
}

/** 음표 하나 (single: ♪, 아니면 ♫) */
function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, single: boolean, fill: string, line: string, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  const head = (hx: number, hy: number) => {
    ctx.beginPath();
    ctx.ellipse(hx, hy, 3.2, 2.3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (single) {
    ctx.fillRect(1.8, -10, 1.4, 10);
    ctx.strokeRect(1.8, -10, 1.4, 10);
    ctx.beginPath();
    ctx.moveTo(3.2, -10);
    ctx.quadraticCurveTo(8, -7, 6, -2.5);
    ctx.quadraticCurveTo(6.4, -6, 3.2, -6.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    head(0, 0);
  } else {
    ctx.beginPath();
    ctx.moveTo(1.8, -10);
    ctx.lineTo(10.6, -12);
    ctx.lineTo(10.6, -9.4);
    ctx.lineTo(1.8, -7.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(1.8, -9, 1.4, 9);
    ctx.fillRect(9.2, -11, 1.4, 9);
    head(0, 0);
    head(7.4, -2);
  }
  ctx.restore();
}
