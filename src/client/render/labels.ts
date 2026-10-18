// 이름표와 말풍선 (고전 어둠의 전설 풍)
// - 이름표는 원작처럼 평소에 숨기고, 마우스를 올렸거나 대상으로 고른 것만 보여 줍니다.
// - 글자는 도트 글꼴(갈무리 모노 11)로 정수 픽셀 위치에 그려서 dpr 1/2 모두 또렷합니다.
// - 말풍선은 원작 화면(R2)처럼 반투명한 검은 바탕, 1px 흰 테두리, 흰 12px 글씨, 아래쪽의 작은 꼬리입니다.
// 캔버스 형식(DOM)에 기대지 않으므로 서버 쪽 테스트에서도 그대로 불러 점검할 수 있습니다.

/**
 * 도트 글꼴 (public/fonts/GalmuriMono11.woff2, SIL OFL 1.1). 한글 12px, 영문·숫자·문장 부호 6px 고정폭.
 * 원작 글자도 전각 12px·반각 6px 칸에 찍히므로(R2 `수: 운` 의 쌍점과 빈칸이 6px 씩), 반각 글자가 4~8px 인
 * 비례폭 갈무리 11(쌍점 4px, 빈칸 5px)보다 글자 사이가 원작과 같습니다. 한글 모양은 두 글꼴이 같습니다.
 */
export const PIXEL_FONT = 'GalmuriMono11';
/** 캔버스 글자 글꼴: 도트 글꼴 → 굴림·돋움 → 예전 글꼴 */
export const LABEL_FONT = `"${PIXEL_FONT}", "Gulim", "굴림", "Dotum", "돋움", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
/** 이름표·말풍선 글자 크기 (도트 글꼴이 또렷하게 나오는 크기) */
export const LABEL_PX = 12;
/** 글꼴을 이만큼 기다려도 안 오면 대체 글꼴로 그립니다 */
export const FONT_WAIT_MS = 3000;

/** 사람(플레이어·NPC) 머리 꼭대기: 발에서 위로 CSS px */
export const HEAD_TOP = 62;
/** 말풍선 한 줄의 글 폭 상한. 원작은 한글 9자(반각 18칸) = 108px 에서 글자 단위로 줄을 바꿉니다 */
export const BUBBLE_TEXT_W = 108;
export const BUBBLE_MAX_LINES = 4;
/** 말풍선이 사라지기 전에 흐려지는 시간 */
export const BUBBLE_FADE_MS = 300;
export const BUBBLE_LINE_H = 12;
/**
 * 말풍선 테두리 안쪽의 글자 둘레 여백. 원작 R2 의 말풍선을 잰 값으로, 오른쪽이 왼쪽보다 3px 넓어
 * 한 줄을 꽉 채운(108px) 말풍선의 폭이 원작과 같은 127px 이 됩니다.
 */
const PAD_LEFT = 7;
const PAD_RIGHT = 10;
const PAD_TOP = 2;
const PAD_BOTTOM = 4;
/** 도트 글꼴 한글 한 글자의 높이 (기준선 위 11줄) */
const GLYPH_H = 11;
/** 둥근 모서리 반지름 (원작처럼 5px 계단) */
const CORNER = 5;
/** 꼬리: 아래 테두리에서 3px 내려온 V 모양, 몸통과 만나는 폭 7px */
const TAIL_H = 3;
const TAIL_HALF = 3;

export const BUBBLE_FILL = 'rgba(0,0,0,0.5)';
export const BUBBLE_INK = '#ffffff';
export const LABEL_OUTLINE = 'rgba(0,0,0,0.85)';
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** 이 모듈이 쓰는 캔버스 기능 (CanvasRenderingContext2D 의 일부) */
export interface PixelCtx {
  font: string;
  fillStyle: unknown;
  globalAlpha: number;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ───────────────────────── 이름표 ─────────────────────────

/** 이름표에 필요한 엔티티 정보 (CEntity 의 일부) */
export interface LabelSubject {
  id: number;
  type: 'player' | 'monster' | 'npc' | 'item';
  name: string;
  level: number;
  ghost: boolean;
  role?: string;
  title?: string;
  ownerName?: string;
  item?: string | null;
  qty?: number;
}

export interface LabelOptions {
  hovered: boolean;
  targeted: boolean;
  selfId: number | null;
  /** 아군 소환수인지 */
  ally: boolean;
  boss: boolean;
  /** 바닥 아이템의 이름 (금화면 없음) */
  itemName?: string;
}

export interface LabelInfo {
  text: string;
  color: string;
  /** NPC 의 [직함] 줄 */
  title?: string;
}

/**
 * 머리 위 이름표. 원작처럼 평소에는 없고(null), 마우스를 올렸거나 대상으로 고른 엔티티만 보입니다.
 * 플레이어(자기 자신 포함)·NPC·몬스터(우두머리 포함)·소환수·아이템 모두 같은 규칙입니다.
 */
export function entityLabel(e: LabelSubject, o: LabelOptions): LabelInfo | null {
  if (!o.hovered && !o.targeted) return null;
  switch (e.type) {
    case 'player':
      return {
        text: e.name,
        color: e.ghost ? '#a8b8e8' : e.role === 'admin' || e.role === 'gm' ? '#ffd76b' : e.id === o.selfId ? '#b8ffb8' : '#ffffff',
      };
    case 'npc':
      return e.title ? { text: e.name, color: '#ffe9a8', title: `[${e.title}]` } : { text: e.name, color: '#ffe9a8' };
    case 'monster':
      if (o.ally) return { text: e.ownerName ? `${e.name} (${e.ownerName})` : e.name, color: '#8dff9a' };
      return { text: `${e.name} Lv.${e.level}`, color: o.boss ? '#ff9f6b' : '#ffb0b0' };
    case 'item': {
      const qty = e.qty ?? (e.item ? 1 : 0);
      const text = e.item ? `${o.itemName ?? e.item}${qty > 1 ? ` x${qty}` : ''}` : `${qty.toLocaleString('ko-KR')} 골드`;
      return { text, color: '#fff3a0' };
    }
  }
}

/** 1px 어두운 외곽선을 두른 글자를 가로 가운데 맞춰 그립니다 (baseline: 정수 기준선). 그린 폭을 돌려줍니다 */
export function drawOutlinedText(ctx: PixelCtx, text: string, cx: number, baseline: number, color: string): number {
  const w = Math.round(ctx.measureText(text).width);
  const x = Math.round(cx - w / 2);
  const y = Math.round(baseline);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = LABEL_OUTLINE;
  for (const [dx, dy] of OUTLINE_OFFSETS) ctx.fillText(text, x + dx, y + dy);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return w;
}

// ───────────────────────── 말풍선 ─────────────────────────

/** 말풍선 내용: 원작처럼 `이름: 대사` */
export function bubbleText(name: string, text: string): string {
  return `${name}: ${text}`;
}

let segmenter: Intl.Segmenter | null | undefined;

/** 글자 단위로 나눕니다 (이모지·결합 문자는 한 덩어리로) */
function graphemes(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

const isSpace = (ch: string) => /^\s+$/.test(ch);
/** 줄 첫머리에 오면 어색한 닫는 문장 부호. 줄 폭을 조금(HANG_MAX) 넘겨도 앞줄 끝에 매답니다 */
const NO_LINE_START = /^[.,!?:;~…'"’”)\]}>」』〉》、。，．！？：；）］｝]$/u;
/** 매다는 문장 부호가 줄 폭을 넘을 수 있는 한도 (한글 한 자 폭) */
export const BUBBLE_HANG_MAX = 12;

/**
 * 말풍선 글을 줄로 나눕니다. 원작처럼 낱말이 아니라 글자 단위로 줄 폭(maxWidth)을 꽉 채워 자르고,
 * 줄 첫머리의 빈칸은 버리며, 닫는 문장 부호(. ! ? 등)는 줄 첫머리로 넘기지 않고 앞줄 끝에 매답니다.
 * maxLines 를 넘으면 마지막 줄 끝을 '…' 로 줄입니다.
 * measure 는 글자열의 폭(CSS px)을 재는 함수입니다 (캔버스에서는 measureText).
 */
export function wrapBubble(text: string, maxWidth: number, measure: (s: string) => number, maxLines = BUBBLE_MAX_LINES): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of graphemes(text.trim())) {
    if (line === '' && isSpace(ch)) continue;
    const next = line + ch;
    if (line !== '' && measure(next) > maxWidth) {
      if (NO_LINE_START.test(ch) && measure(next) <= maxWidth + BUBBLE_HANG_MAX) {
        line = next;
        continue;
      }
      lines.push(line.trimEnd());
      line = isSpace(ch) ? '' : ch;
    } else line = next;
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  const max = Math.max(1, Math.floor(maxLines));
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  const parts = graphemes(out[max - 1]!);
  while (parts.length && measure(parts.join('').trimEnd() + '…') > maxWidth) parts.pop();
  out[max - 1] = parts.join('').trimEnd() + '…';
  return out;
}

/** 말풍선의 불투명도: 끝나기 BUBBLE_FADE_MS 전부터 흐려져 끝나는 순간 0 */
export function bubbleAlpha(now: number, until: number, fadeMs = BUBBLE_FADE_MS): number {
  if (now >= until) return 0;
  return Math.min(1, (until - now) / Math.max(1, fadeMs));
}

export interface BubbleShape {
  /** 몸통(테두리 포함)의 왼쪽 위와 크기 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 꼬리 끝 (말하는 사람 쪽) */
  tipX: number;
  tipY: number;
  /** 반투명 바탕 칸들 (서로, 그리고 테두리와 겹치지 않음) */
  fill: Rect[];
  /** 흰 테두리 칸들 */
  border: Rect[];
  /** 첫 줄 글자의 왼쪽과 기준선 (다음 줄은 BUBBLE_LINE_H 씩 아래) */
  textX: number;
  baseline: number;
}

/**
 * 말풍선 모양을 정수 픽셀 칸으로 계산합니다.
 * textW: 가장 긴 줄의 폭, lines: 줄 수, anchorX: 말하는 사람의 x, tipY: 꼬리 끝의 y (머리 위),
 * minX~maxX: 몸통이 들어가야 할 화면 가로 범위 (넘치면 안쪽으로 밀고 꼬리는 그대로 사람을 가리킴).
 */
export function bubbleShape(textW: number, lines: number, anchorX: number, tipY: number, minX = -Infinity, maxX = Infinity): BubbleShape {
  const n = Math.max(1, Math.floor(lines));
  const w = Math.max(2 * (CORNER + TAIL_HALF + 1) + 1, Math.ceil(textW) + 1 + PAD_LEFT + PAD_RIGHT + 1);
  const h = 1 + PAD_TOP + GLYPH_H + (n - 1) * BUBBLE_LINE_H + PAD_BOTTOM + 1;
  const ax = Math.round(anchorX);
  let x = Math.round(ax - w / 2);
  if (maxX - minX >= w) x = Math.min(Math.max(x, Math.ceil(minX)), Math.floor(maxX) - w);
  const ty = Math.round(tipY);
  const y = ty - TAIL_H + 1 - h;
  // 꼬리는 둥근 모서리를 피한 아래 테두리의 곧은 부분에서 나옵니다
  const tx = Math.min(Math.max(ax, x + CORNER + TAIL_HALF + 1), x + w - 1 - CORNER - TAIL_HALF - 1);
  const r = (rx: number, ry: number, rw: number, rh: number): Rect => ({ x: rx, y: ry, w: rw, h: rh });
  const b = y + h - 1; // 아래 테두리 줄
  const fill = [
    r(x + 5, y + 1, w - 10, 1),
    r(x + 3, y + 2, w - 6, 1),
    r(x + 2, y + 3, w - 4, 2),
    r(x + 1, y + 5, w - 2, h - 10),
    r(x + 2, b - 4, w - 4, 2),
    r(x + 3, b - 2, w - 6, 1),
    r(x + 5, b - 1, w - 10, 1),
    // 꼬리 안쪽 (아래 테두리가 끊긴 자리부터)
    r(tx - TAIL_HALF, b, 2 * TAIL_HALF + 1, 1),
    r(tx - 1, b + 1, 3, 1),
    r(tx, b + 2, 1, 1),
  ];
  const border = [
    // 위·왼쪽·오른쪽 변
    r(x + 5, y, w - 10, 1),
    r(x, y + 5, 1, h - 10),
    r(x + w - 1, y + 5, 1, h - 10),
    // 네 모서리 (5px 계단)
    r(x + 3, y + 1, 2, 1),
    r(x + 2, y + 2, 1, 1),
    r(x + 1, y + 3, 1, 2),
    r(x + w - 5, y + 1, 2, 1),
    r(x + w - 3, y + 2, 1, 1),
    r(x + w - 2, y + 3, 1, 2),
    r(x + 1, b - 4, 1, 2),
    r(x + 2, b - 2, 1, 1),
    r(x + 3, b - 1, 2, 1),
    r(x + w - 2, b - 4, 1, 2),
    r(x + w - 3, b - 2, 1, 1),
    r(x + w - 5, b - 1, 2, 1),
    // 아래 변 (꼬리 자리만 비움)
    r(x + 5, b, tx - TAIL_HALF - (x + 5), 1),
    r(tx + TAIL_HALF + 1, b, x + w - 5 - (tx + TAIL_HALF + 1), 1),
    // 꼬리 (V)
    r(tx - 3, b + 1, 2, 1),
    r(tx + 2, b + 1, 2, 1),
    r(tx - 1, b + 2, 1, 1),
    r(tx + 1, b + 2, 1, 1),
    r(tx, b + 3, 1, 1),
  ];
  return {
    x,
    y,
    w,
    h,
    tipX: tx,
    tipY: b + TAIL_H,
    fill,
    border,
    textX: x + 1 + PAD_LEFT,
    baseline: y + 1 + PAD_TOP + GLYPH_H,
  };
}

/** 말풍선을 그립니다. ctx.font 는 이미 이름표 글꼴로 맞춰져 있어야 합니다 */
export function drawBubble(ctx: PixelCtx, lines: readonly string[], shape: BubbleShape, alpha: number): void {
  if (alpha <= 0 || !lines.length) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = BUBBLE_FILL;
  for (const f of shape.fill) ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.fillStyle = BUBBLE_INK;
  for (const f of shape.border) ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, shape.textX, shape.baseline + i * BUBBLE_LINE_H));
  ctx.restore();
}

// ───────────────────────── 글꼴 준비 ─────────────────────────

/** document.fonts 중 이 모듈이 쓰는 부분 */
export interface FontSetLike {
  load(font: string, text?: string): Promise<unknown>;
}

/**
 * 도트 글꼴을 기다리는 문. 처음 물어볼 때 글꼴을 받기 시작하고, 받을 때까지(최대 waitMs) 닫혀 있습니다.
 * 받기 전에 그리면 대체 글꼴로 잠깐 보였다가 바뀌므로 그동안 글자는 그리지 않고,
 * 받지 못한 채 시간이 지나면 대체 글꼴로 그리다가 나중에라도 받으면 그때부터 도트 글꼴로 바뀝니다.
 */
export class FontGate {
  /** 0: 시작 전, 1: 받는 중, 2: 열림 (받았거나, 기다리다 대체 글꼴로 넘어감) */
  private state: 0 | 1 | 2 = 0;
  /** 글꼴이 바뀔 수 있을 때마다 늘어나는 번호 (잰 폭으로 만든 줄바꿈 캐시를 버리는 데 씀) */
  gen = 0;

  constructor(
    private readonly fonts: () => FontSetLike | undefined,
    private readonly waitMs = FONT_WAIT_MS,
    private readonly later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** 지금 이름표·말풍선 글자를 그려도 되는지 */
  ready(): boolean {
    if (this.state === 0) this.start();
    return this.state === 2;
  }

  private start(): void {
    const fonts = this.fonts();
    if (!fonts) {
      this.state = 2;
      return;
    }
    this.state = 1;
    const done = () => {
      this.state = 2;
      this.gen++;
    };
    try {
      fonts.load(`${LABEL_PX}px "${PIXEL_FONT}"`, '가A').then(done, done);
    } catch {
      done();
      return;
    }
    this.later(() => {
      if (this.state === 1) done();
    }, this.waitMs);
  }
}

const fontGate = new FontGate(() => (globalThis as { document?: { fonts?: FontSetLike } }).document?.fonts);

/** 이름표·말풍선 글자를 그려도 되는지 (도트 글꼴을 받을 때까지, 최대 FONT_WAIT_MS 동안 false) */
export function labelFontReady(): boolean {
  return fontGate.ready();
}

const wrapCache = new Map<string, { lines: string[]; width: number }>();

/** 말풍선 줄바꿈과 가장 긴 줄의 폭 (같은 글은 다시 재지 않음). ctx.font 는 이름표 글꼴이어야 합니다 */
export function bubbleLines(ctx: PixelCtx, text: string): { lines: string[]; width: number } {
  const key = `${fontGate.gen}\u0000${text}`;
  let v = wrapCache.get(key);
  if (!v) {
    const measure = (s: string) => ctx.measureText(s).width;
    const lines = wrapBubble(text, BUBBLE_TEXT_W, measure);
    v = { lines, width: Math.ceil(Math.max(0, ...lines.map((l) => Math.round(measure(l))))) };
    if (wrapCache.size >= 256) wrapCache.clear();
    wrapCache.set(key, v);
  }
  return v;
}

// 게임 화면을 띄우는 동안 미리 받아 둡니다 (브라우저에서만)
labelFontReady();
