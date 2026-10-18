// 화면 그리기: 카메라, 타일/엔티티 깊이 정렬, 이름표, 효과, 어둠, 미니맵
import { STATUS_INFO, TILE_H, TILE_W } from '../../shared/constants';
import { tileInfo } from '../../shared/tiles';
import { entityPos, isAlly, type CEntity, type ClientState } from '../state';
import { Effects, type Point } from './effects';
import { HALF_H, HALF_W, WALL_H, diamondPath, hash2, makeCanvas, screenToTile, tileCenter, tileTop, withAlpha } from './iso';
import { ambienceFor, type Ambience } from './ambience';
import { Atmosphere } from './atmosphere';
import type { ChibiPose } from './chibi';
import { CLASSIC_HALF_WIDTH, CLASSIC_HEAD_TOP, classicHeadTop, drawClassicFast } from './classic';
import { Ground } from './ground';
import { drawGroundItem, drawMonster } from './sprites';
import { drawFlame, objectSprite, wallCanvas } from './tiles';

const ACT_MS = 320;
/** 어둠 캔버스는 CSS 픽셀의 이 배수만큼 작게 그립니다 (부드러운 빛 구멍뿐이라 늘려도 티가 나지 않음) */
const DARK_SCALE = 2;
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

interface Drawable {
  depth: number;
  order: number;
  draw: () => void;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dark: HTMLCanvasElement;
  private darkCtx: CanvasRenderingContext2D;
  /** 바닥 조각 캐시 (물·성수·용암 포함) 와 화면 가장자리 분위기 */
  private readonly ground = new Ground();
  private readonly atmosphere = new Atmosphere();
  readonly effects = new Effects();
  /** 화면 좌표 = 월드 좌표 + offset */
  private offX = 0;
  private offY = 0;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  mouse: { x: number; y: number } | null = null;
  hoverTile: { x: number; y: number } | null = null;
  hoverEntity: CEntity | null = null;
  walkTarget: { x: number; y: number; until: number } | null = null;
  private wallLike = new Map<number, string>();
  private lights: { x: number; y: number; r: number; flicker: boolean }[] = [];
  private mapKey = '';
  private minimapBase: HTMLCanvasElement | null = null;
  /** 반투명/번쩍임 효과를 위해 캐릭터 하나를 먼저 그리는 작은 캔버스 */
  private spriteBuf: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly state: ClientState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    [this.dark, this.darkCtx] = makeCanvas(16, 16);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    // 어둠은 부드러운 그라데이션뿐이라 CSS 해상도의 절반으로 그리고 늘려 붙입니다
    this.dark.width = Math.max(1, Math.ceil(this.cssW / DARK_SCALE));
    this.dark.height = Math.max(1, Math.ceil(this.cssH / DARK_SCALE));
    // 배율이 바뀌면 바닥 조각을 새 해상도로 다시 굽습니다
    this.ground.setDpr(this.dpr);
  }

  /** 맵이 바뀌면 벽처럼 그릴 횃불 칸과 광원 목록을 다시 계산 */
  private prepareMap(): void {
    const map = this.state.map;
    if (!map) return;
    // 바닥 캐시는 타일 내용이 바뀐 맵에서만 새로 만듭니다 (같은 맵이면 그대로)
    this.ground.setMap(map);
    const key = map.id + ':' + map.tiles.length;
    if (key === this.mapKey) return;
    this.mapKey = key;
    this.wallLike.clear();
    this.lights = [];
    const W = this.state.mapWidth;
    for (let y = 0; y < map.tiles.length; y++) {
      const row = map.tiles[y]!;
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!;
        if (ch === 'j') {
          // 주변에 벽이 2개 이상이면 벽에 달린 횃불로 그립니다
          const counts = new Map<string, number>();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const n = map.tiles[y + dy]?.[x + dx];
            if (n && tileInfo(n).kind === 'wall') counts.set(n, (counts.get(n) ?? 0) + 1);
          }
          let best: string | null = null;
          let bestN = 0;
          for (const [k, v] of counts) if (v > bestN) [best, bestN] = [k, v];
          if (best && bestN >= 2) this.wallLike.set(y * W + x, best);
          this.lights.push({ x, y, r: 150, flicker: true });
        } else if (ch === 'L') this.lights.push({ x, y, r: 90, flicker: true });
        else if (ch === 'l') this.lights.push({ x, y, r: 130, flicker: false });
        else if (ch === 'c') this.lights.push({ x, y, r: 80, flicker: false });
      }
    }
    for (const w of map.warps) this.lights.push({ x: w.x, y: w.y, r: 90, flicker: false });
    this.minimapBase = null;
  }

  worldToScreen(p: Point): Point {
    return { sx: p.sx + this.offX, sy: p.sy + this.offY };
  }

  /** 엔티티 발 위치(월드 픽셀) */
  entityPoint(e: CEntity, now: number): Point {
    const p = entityPos(e, now);
    return tileCenter(p.x, p.y);
  }

  /** CSS 픽셀 좌표 → 타일 */
  screenToTile(mx: number, my: number): { x: number; y: number } {
    return screenToTile(mx - this.offX, my - this.offY);
  }

  /** 마우스 아래의 엔티티 (스프라이트 영역 기준). 겹치면 소환수보다 다른 것을 먼저 고름 */
  pickEntity(mx: number, my: number, now: number): CEntity | null {
    let best: CEntity | null = null;
    let bestDepth = -Infinity;
    for (const e of this.state.entities.values()) {
      if (e.dying) continue;
      const p = this.worldToScreen(this.entityPoint(e, now));
      const h = e.type === 'item' ? 24 : e.type === 'monster' ? 48 : e.look ? classicHeadTop(e.look) + 2 : CLASSIC_HEAD_TOP;
      const w = e.type === 'item' ? 14 : e.type === 'monster' ? 15 : CLASSIC_HALF_WIDTH;
      if (mx >= p.sx - w && mx <= p.sx + w && my >= p.sy - h && my <= p.sy + 4) {
        const pos = entityPos(e, now);
        const depth = pos.x + pos.y + (e.type === 'item' ? -0.5 : 0) - (isAlly(e) ? 1000 : 0);
        if (depth > bestDepth) {
          best = e;
          bestDepth = depth;
        }
      }
    }
    return best;
  }

  render(now: number): void {
    const { ctx, state } = this;
    const map = state.map;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const me = state.me;
    if (!map || !me) return;
    this.prepareMap();

    const focus = this.entityPoint(me, now);
    this.offX = Math.round(this.cssW / 2 - focus.sx);
    this.offY = Math.round(this.cssH / 2 - focus.sy + 30);

    if (this.mouse) {
      this.hoverTile = this.screenToTile(this.mouse.x, this.mouse.y);
      this.hoverEntity = this.pickEntity(this.mouse.x, this.mouse.y, now);
    } else {
      this.hoverTile = null;
      this.hoverEntity = null;
    }

    const W = state.mapWidth;
    const H = state.mapHeight;
    const minSX = -TILE_W - this.offX;
    const maxSX = this.cssW + TILE_W - this.offX;
    const minSY = -TILE_H - 120 - this.offY;
    const maxSY = this.cssH + TILE_H + WALL_H - this.offY;
    const visible = (x: number, y: number) => {
      const t = tileTop(x, y);
      return t.sx >= minSX && t.sx <= maxSX && t.sy >= minSY && t.sy <= maxSY;
    };

    ctx.save();
    ctx.translate(this.offX, this.offY);

    // 1) 바닥: 미리 구운 바닥 조각 (타일 경계 없이 이어짐) + 보이는 물·성수·용암만 매 프레임
    this.ground.draw(ctx, this.offX, this.offY, this.cssW, this.cssH, now);

    // 2) 워프 지점
    for (const w of map.warps) {
      if (!visible(w.x, w.y)) continue;
      const c = tileCenter(w.x, w.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 300 + w.x);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(c.sx, c.sy, 2, c.sx, c.sy, 26);
      g.addColorStop(0, `rgba(140,200,255,${0.55 + pulse * 0.3})`);
      g.addColorStop(1, 'rgba(80,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.sx, c.sy, 26, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(200,230,255,${0.6})`;
      ctx.beginPath();
      ctx.ellipse(c.sx, c.sy, 14 + pulse * 6, 7 + pulse * 3, now / 900, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3) 마우스 칸 / 이동 목표
    const ht = this.hoverTile;
    if (ht && ht.x >= 0 && ht.y >= 0 && ht.x < W && ht.y < H) {
      const t = tileTop(ht.x, ht.y);
      diamondPath(ctx, t.sx, t.sy);
      ctx.strokeStyle = state.walkable(ht.x, ht.y) ? 'rgba(255,255,255,0.35)' : 'rgba(255,80,80,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (this.walkTarget && now < this.walkTarget.until) {
      const t = tileTop(this.walkTarget.x, this.walkTarget.y);
      diamondPath(ctx, t.sx, t.sy + 4, TILE_W - 16, TILE_H - 8);
      ctx.strokeStyle = 'rgba(255,230,120,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 4) 바닥 아이템
    for (const e of state.entities.values()) {
      if (e.type !== 'item' || !visible(e.x, e.y)) continue;
      const c = tileCenter(e.x, e.y);
      ctx.save();
      ctx.translate(c.sx + ((e.id % 5) - 2) * 3, c.sy + ((e.id % 3) - 1) * 2);
      drawGroundItem(ctx, e.item ? state.items.get(e.item) : undefined, e.qty ?? 1, now, e.id);
      ctx.restore();
    }

    // 5) 대상 표시 (발밑 고리)
    const target = state.targetId !== null ? state.entities.get(state.targetId) : undefined;
    if (target && !target.dying) {
      const c = this.entityPoint(target, now);
      ctx.strokeStyle = isAlly(target) ? 'rgba(110,240,130,0.9)' : target.type === 'monster' ? 'rgba(255,90,90,0.9)' : 'rgba(120,220,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(c.sx, c.sy, 17, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 6) 깊이 정렬 그리기
    // 벽·물체 그림은 화면 배율에 맞춘 정수 배율로 미리 그려 두고 CSS 크기로 옮겨 그립니다 (dpr 2 에서도 또렷함)
    const ps = Math.max(1, Math.ceil(this.dpr));
    // 칸의 벽 높이 (0: 벽 아님, 1: 낮은 담, 2: 보통 벽과 벽에 붙은 횃불)
    const wallLevel = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      if (this.wallLike.has(y * W + x)) return 2;
      const n = tileInfo(map.tiles[y]![x]);
      return n.kind === 'wall' ? (n.low ? 1 : 2) : 0;
    };
    const list: Drawable[] = [];
    for (let y = 0; y < H; y++) {
      const row = map.tiles[y]!;
      for (let x = 0; x < W; x++) {
        const ch = row[x]!;
        const info = tileInfo(ch);
        const asWall = this.wallLike.get(y * W + x);
        if (info.kind !== 'wall' && info.kind !== 'tree' && info.kind !== 'object' && !asWall) continue;
        if (!visible(x, y)) continue;
        const t = tileTop(x, y);
        if (info.kind === 'wall' || asWall) {
          // 같은 높이 이상의 이웃 벽 (1: x+1, 2: y+1, 4: x-1, 8: y-1): 가려지는 면은 생략하고 윗면은 잇습니다
          const lv = wallLevel(x, y);
          const links =
            (wallLevel(x + 1, y) >= lv ? 1 : 0) | (wallLevel(x, y + 1) >= lv ? 2 : 0) | (wallLevel(x - 1, y) >= lv ? 4 : 0) | (wallLevel(x, y - 1) >= lv ? 8 : 0);
          const wc = wallCanvas(asWall ?? ch, ps, Math.floor(hash2(x, y, 3) * 4), links, !!asWall, now);
          // 벽 횃불은 보이는 면 가운데의 받침 위에서 탑니다. 앞의 두 면이 다 가려졌으면 뒤쪽 면에 달린 것으로 보고
          // 벽보다 먼저 그려서 벽 너머로 불꽃 끝만 보이게 합니다 (뒤도 다 막혔으면 불꽃 없이 빛만)
          const front = !(links & 2) || !(links & 1);
          const fx = !(links & 2) ? -HALF_W / 2 : HALF_W / 2;
          const bx = !(links & 8) ? HALF_W / 2 : !(links & 4) ? -HALF_W / 2 : null;
          list.push({
            depth: x + y,
            order: 0,
            draw: () => {
              if (asWall && !front && bx !== null) drawFlame(ctx, t.sx + bx, t.sy - WALL_H + 10, now, 0.8);
              ctx.drawImage(wc, t.sx - HALF_W, t.sy - WALL_H, TILE_W, TILE_H + WALL_H);
              if (asWall && front) drawFlame(ctx, t.sx + fx, t.sy - 4, now, 0.8);
            },
          });
        } else {
          // 울타리는 이웃 울타리 쪽으로 밧줄을 잇습니다
          const links =
            info.shape === 'fence'
              ? (row[x + 1] === ch ? 1 : 0) | (map.tiles[y + 1]?.[x] === ch ? 2 : 0) | (row[x - 1] === ch ? 4 : 0) | (map.tiles[y - 1]?.[x] === ch ? 8 : 0)
              : 0;
          const spr = objectSprite(ch, Math.floor(hash2(x, y, 7) * 4), ps, links, now);
          list.push({
            depth: x + y,
            order: 0,
            draw: () => {
              const c = tileCenter(x, y);
              ctx.drawImage(spr.canvas, c.sx - spr.ox, c.sy - spr.oy, spr.w, spr.h);
              if (spr.flame) drawFlame(ctx, c.sx + spr.flame.x, c.sy + spr.flame.y, now, spr.flame.scale);
            },
          });
        }
      }
    }
    for (const e of state.entities.values()) {
      if (e.type === 'item') continue;
      const pos = entityPos(e, now);
      if (!visible(Math.round(pos.x), Math.round(pos.y))) continue;
      const depth = pos.moving ? Math.max(e.fromX + e.fromY, e.x + e.y) : pos.x + pos.y;
      list.push({ depth, order: 1, draw: () => this.drawEntity(e, now) });
    }
    list.sort((a, b) => a.depth - b.depth || a.order - b.order);
    for (const d of list) d.draw();

    // 7) 효과
    this.effects.draw(
      ctx,
      now,
      (id) => {
        const e = state.entities.get(id);
        return e ? this.entityPoint(e, now) : null;
      },
      (p) => p,
    );

    // 8) 이름표, 체력바, 말풍선
    for (const e of state.entities.values()) {
      if (e.dying) continue;
      const pos = entityPos(e, now);
      if (!visible(Math.round(pos.x), Math.round(pos.y))) continue;
      this.drawLabels(e, now);
    }
    ctx.restore();

    // 9) 어둠과 분위기: 모든 맵에 맵별 색조와 가장자리 비네트 (던전은 비네트를 품은 어둠에 빛 구멍)
    const amb = ambienceFor(map.id, map.dark);
    if (map.dark) this.drawDarkness(now, amb);
    else this.atmosphere.draw(ctx, amb, this.cssW, this.cssH, this.dpr);
    if (state.self?.ghost) {
      ctx.fillStyle = 'rgba(60,80,140,0.18)';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  private drawEntity(e: CEntity, now: number): void {
    const ctx = this.ctx;
    const c = this.entityPoint(e, now);
    const pos = entityPos(e, now);
    const walk = pos.moving ? pos.t : null;
    const act = e.actStart && now - e.actStart < ACT_MS ? (now - e.actStart) / ACT_MS : null;
    const flash = now - e.hitFlash < 120;
    ctx.save();
    ctx.translate(c.sx, c.sy);
    if (e.type === 'player' || e.type === 'npc') {
      const look = e.look;
      const hidden = e.statuses.includes('hide');
      const alpha = hidden ? (e.id === this.state.selfId ? 0.45 : 0.18) : e.ghost ? 0.62 : 1;
      if (look) {
        const pose: ChibiPose = {
          dir: e.dir,
          walk,
          step: (e.x + e.y) & 1,
          act,
          actKind: e.actKind,
          time: now + e.id * 97,
          ghost: e.ghost,
          beast: e.statuses.includes('beast'),
        };
        if (alpha < 1 || flash) this.drawBuffered((b) => drawClassicFast(b, look, pose, this.dpr), alpha, flash);
        else drawClassicFast(ctx, look, pose, this.dpr);
      }
      if (e.role === 'admin' || e.role === 'gm') {
        // 운영자 왕관: 머리(모자) 바로 위. 숨기·유령이면 몸과 같은 투명도 (숨은 운영자의 자리가 왕관으로 드러나지 않게)
        const top = -(look ? classicHeadTop(look) : CLASSIC_HEAD_TOP) - 3 - (e.ghost ? 3 : 0);
        const a0 = ctx.globalAlpha;
        ctx.globalAlpha = a0 * alpha;
        ctx.fillStyle = 'rgba(255,215,0,0.9)';
        ctx.strokeStyle = 'rgba(60,40,0,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-4, top - 3);
        ctx.lineTo(0, top - 9);
        ctx.lineTo(4, top - 3);
        ctx.lineTo(0, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = a0;
      }
    } else if (e.type === 'monster') {
      const def = e.def ? this.state.monsters.get(e.def) : undefined;
      if (isAlly(e) && !e.dying) {
        // 아군 소환수: 발밑의 옅은 초록 고리
        const pulse = 0.5 + 0.5 * Math.sin(now / 420 + e.id);
        ctx.strokeStyle = `rgba(110,240,130,${0.35 + pulse * 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 15, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (def) {
        const fade = e.dying ? Math.min(1, (now - e.dying) / 500) : undefined;
        const pose = { dir: e.dir, walk, act, time: now + e.id * 131, ...(fade !== undefined ? { fade } : {}) };
        if (flash) this.drawBuffered((b) => drawMonster(b, def.look, pose), 1, true);
        else drawMonster(ctx, def.look, pose);
      }
    }
    // 상태 효과 표시 (발밑 작은 점들)
    if (e.statuses.length && e.type !== 'npc') {
      let i = 0;
      for (const s of e.statuses) {
        const info = STATUS_INFO[s];
        if (!info) continue;
        ctx.fillStyle = info.color;
        ctx.beginPath();
        ctx.arc(-10 + i * 6, 6, 2.3, 0, Math.PI * 2);
        ctx.fill();
        i++;
      }
      if (e.statuses.includes('sleep')) {
        ctx.fillStyle = '#c8d8ff';
        ctx.font = `bold 11px ${FONT}`;
        // 사람은 머리 바로 위, 몬스터는 예전 자리
        const zy = e.look && e.type === 'player' ? -(classicHeadTop(e.look) + 2) : -62;
        ctx.fillText('z', 10 + Math.sin(now / 300) * 2, zy);
      }
    }
    ctx.restore();
  }

  /**
   * 작은 캔버스에 먼저 그린 뒤 투명도/번쩍임을 적용해 옮겨 그립니다.
   * (겹친 부분이 진해지지 않고, 번쩍임이 배경까지 하얗게 만들지 않음)
   */
  private drawBuffered(draw: (b: CanvasRenderingContext2D) => void, alpha: number, flash: boolean): void {
    const W = 200;
    const H = 190;
    const OX = 100;
    const OY = 165;
    const s = this.dpr;
    if (!this.spriteBuf) this.spriteBuf = makeCanvas(W * s, H * s);
    const [buf, b] = this.spriteBuf;
    if (buf.width !== Math.ceil(W * s)) {
      buf.width = Math.ceil(W * s);
      buf.height = Math.ceil(H * s);
    }
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.clearRect(0, 0, buf.width, buf.height);
    b.setTransform(s, 0, 0, s, OX * s, OY * s);
    draw(b);
    if (flash) {
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-atop';
      b.fillStyle = 'rgba(255,255,255,0.6)';
      b.fillRect(0, 0, buf.width, buf.height);
      b.globalCompositeOperation = 'source-over';
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(buf, -OX, -OY, W, H);
    ctx.restore();
  }

  private drawLabels(e: CEntity, now: number): void {
    const ctx = this.ctx;
    const c = this.entityPoint(e, now);
    const hovered = this.hoverEntity === e;
    const targeted = this.state.targetId === e.id;
    const monsterDef = e.type === 'monster' && e.def ? this.state.monsters.get(e.def) : undefined;
    const scale = monsterDef?.look.size ?? 1;
    // 소환수 이름은 늘 보이므로 몸 크기에 맞춰 낮게 (주인 이름표와 겹치지 않게)
    const top =
      c.sy -
      (e.type === 'item' ? 26 : isAlly(e) ? 30 + 18 * scale : e.type === 'monster' ? 56 * Math.max(1, scale * 0.95) : 66);
    ctx.textAlign = 'center';
    let label: string | null = null;
    let color = '#ffffff';
    if (e.type === 'player') {
      label = e.name;
      color = e.ghost ? '#a8b8e8' : e.role === 'admin' || e.role === 'gm' ? '#ffd76b' : e.id === this.state.selfId ? '#b8ffb8' : '#ffffff';
    } else if (e.type === 'npc') {
      label = e.name;
      color = '#ffe9a8';
    } else if (e.type === 'monster' && isAlly(e)) {
      label = e.ownerName ? `${e.name} (${e.ownerName})` : e.name;
      color = '#8dff9a';
    } else if (e.type === 'monster' && (hovered || targeted || monsterDef?.boss)) {
      label = `${e.name} Lv.${e.level}`;
      color = monsterDef?.boss ? '#ff9f6b' : '#ffb0b0';
    } else if (e.type === 'item' && hovered) {
      label = e.item ? `${this.state.itemName(e.item)}${(e.qty ?? 1) > 1 ? ` x${e.qty}` : ''}` : `${(e.qty ?? 0).toLocaleString('ko-KR')} 골드`;
      color = '#fff3a0';
    }
    if (label) {
      ctx.font = `${e.type === 'npc' || hovered ? 'bold ' : ''}${isAlly(e) ? 11 : 12}px ${FONT}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(label, c.sx, top);
      ctx.fillStyle = color;
      ctx.fillText(label, c.sx, top);
      if (e.type === 'npc' && e.title) {
        ctx.font = `11px ${FONT}`;
        ctx.strokeText(`[${e.title}]`, c.sx, top - 13);
        ctx.fillStyle = '#9fd3ff';
        ctx.fillText(`[${e.title}]`, c.sx, top - 13);
      }
    }
    // 체력바
    const showHp =
      (e.type === 'monster' && (targeted || hovered || now < e.showHpUntil || e.hpPct < 100)) ||
      (e.type === 'player' && (e.hpPct < 100 || now < e.showHpUntil) && !e.ghost);
    if (showHp) {
      const w = 30;
      const y = top + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(c.sx - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = e.type === 'monster' && !isAlly(e) ? '#e04040' : '#40c060';
      ctx.fillRect(c.sx - w / 2, y, (w * Math.max(0, e.hpPct)) / 100, 3);
    }
    // 말풍선
    if (e.bubble && now < e.bubble.until) {
      const text = e.bubble.text.length > 40 ? e.bubble.text.slice(0, 39) + '…' : e.bubble.text;
      ctx.font = `12px ${FONT}`;
      const tw = ctx.measureText(text).width;
      const bx = c.sx - tw / 2 - 6;
      const by = top - (e.type === 'npc' ? 40 : 30);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 12, 18, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(text, c.sx, by + 13);
    }
  }

  private drawDarkness(now: number, amb: Ambience): void {
    const d = this.darkCtx;
    const me = this.state.me;
    // 바탕 어둠 + 가장자리 비네트를 한 장으로 (지우기·채우기·비네트를 따로 하지 않고 한 번에 덮어씀)
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'copy';
    d.imageSmoothingEnabled = true;
    d.drawImage(this.atmosphere.darkness(amb), 0, 0, this.dark.width, this.dark.height);
    d.setTransform(1 / DARK_SCALE, 0, 0, 1 / DARK_SCALE, 0, 0);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number) => {
      const g = d.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.beginPath();
      d.arc(x, y, r, 0, Math.PI * 2);
      d.fill();
    };
    if (me) {
      const p = this.worldToScreen(this.entityPoint(me, now));
      hole(p.sx, p.sy - 20, 260);
    }
    for (const l of this.lights) {
      const c = this.worldToScreen(tileCenter(l.x, l.y));
      if (c.sx < -200 || c.sy < -200 || c.sx > this.cssW + 200 || c.sy > this.cssH + 200) continue;
      const r = l.r * (l.flicker ? 0.93 + 0.07 * Math.sin(now / 120 + l.x * 3) : 1);
      hole(c.sx, c.sy - 20, r);
    }
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.dark, 0, 0, this.dark.width * DARK_SCALE * this.dpr, this.dark.height * DARK_SCALE * this.dpr);
    this.ctx.restore();
    // 따뜻한 횃불빛
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      if (!l.flicker) continue;
      const c = this.worldToScreen(tileCenter(l.x, l.y));
      if (c.sx < -200 || c.sy < -200 || c.sx > this.cssW + 200 || c.sy > this.cssH + 200) continue;
      const g = this.ctx.createRadialGradient(c.sx, c.sy - 20, 0, c.sx, c.sy - 20, l.r * 0.7);
      g.addColorStop(0, 'rgba(255,150,60,0.12)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      this.ctx.fillStyle = g;
      this.ctx.beginPath();
      this.ctx.arc(c.sx, c.sy - 20, l.r * 0.7, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  // ───────────────────────── 미니맵 ─────────────────────────

  drawMinimap(canvas: HTMLCanvasElement, now: number): void {
    const map = this.state.map;
    if (!map) return;
    const W = this.state.mapWidth;
    const H = this.state.mapHeight;
    const cw = 3;
    const ch = 1.5;
    const width = Math.ceil((W + H) * cw) + 4;
    const height = Math.ceil((W + H) * ch) + 4;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.minimapBase = null;
    }
    const ox = H * cw + 2;
    const oy = 2;
    if (!this.minimapBase) {
      const [base, b] = makeCanvas(width, height);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const info = tileInfo(map.tiles[y]![x]);
          if (info.kind === 'void') continue;
          let color = info.color;
          if (info.kind === 'wall') color = info.color2;
          else if (info.kind === 'tree' || info.kind === 'object') color = info.color2;
          b.fillStyle = color;
          const sx = ox + (x - y) * cw;
          const sy = oy + (x + y) * ch;
          b.beginPath();
          b.moveTo(sx, sy);
          b.lineTo(sx + cw, sy + ch);
          b.lineTo(sx, sy + ch * 2);
          b.lineTo(sx - cw, sy + ch);
          b.closePath();
          b.fill();
        }
      }
      for (const w of map.warps) {
        b.fillStyle = '#7fd6ff';
        b.fillRect(ox + (w.x - w.y) * cw - 2, oy + (w.x + w.y) * ch, 4, 3);
      }
      this.minimapBase = base;
    }
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, width, height);
    c.drawImage(this.minimapBase, 0, 0);
    for (const e of this.state.entities.values()) {
      if (e.type === 'item' || e.dying) continue;
      const pos = entityPos(e, now);
      const sx = ox + (pos.x - pos.y) * cw;
      const sy = oy + (pos.x + pos.y) * ch + ch;
      if (e.id === this.state.selfId) continue;
      c.fillStyle = isAlly(e) ? '#5dff7a' : e.type === 'monster' ? '#ff4d4d' : e.type === 'npc' ? '#ffe066' : '#6bd0ff';
      c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
    const me = this.state.me;
    if (me) {
      const pos = entityPos(me, now);
      const sx = ox + (pos.x - pos.y) * cw;
      const sy = oy + (pos.x + pos.y) * ch + ch;
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#000000';
      c.beginPath();
      c.arc(sx, sy, 3, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }

  /** 화면에서 떠오르는 숫자 등을 위해 엔티티 위치를 노출 */
  locate(id: number, now: number): Point | null {
    const e = this.state.entities.get(id);
    return e ? this.entityPoint(e, now) : null;
  }
}

export { withAlpha, HALF_H };
