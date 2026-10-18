// 치비(SD) 스타일 사람 캐릭터 그리기.
// 큰 머리와 큰 눈, 굵은 외곽선, 직업별 의상을 모두 코드로 그립니다 (이미지 파일 없음).
// 좌표는 발 위치(0,0) 기준, 위쪽이 음수 y. 게임 화면에서는 1 단위 = 1 CSS 픽셀입니다.
// 기본 그림은 오른쪽(동/북)을 바라보는 3/4 시점이고, 왼쪽을 볼 때는 좌우를 뒤집습니다.
import type { ClassId, Dir } from '../../shared/constants';
import type { HumanLook, IconShape } from '../../shared/types';

export interface ChibiPose {
  dir: Dir;
  /** 걷기 진행 (0~1, 걷지 않으면 null) */
  walk: number | null;
  /** 걸음마다 다리를 번갈아 내딛기 위한 값 (0 또는 1) */
  step?: number;
  /** 행동 애니메이션 진행 (0~1, 없으면 null) */
  act: number | null;
  actKind?: 'attack' | 'cast' | 'skill';
  time: number;
  ghost?: boolean;
  /** 일러스트용 멋진 자세 (무기를 옆으로 들고 다른 손을 듦) */
  showcase?: boolean;
  /** 눈 깜빡임을 강제로 정함 (프레임 캐시용) */
  blink?: boolean;
}

export interface ChibiOptions {
  /** 'portrait' 면 일러스트용으로 세부 묘사를 더하고 외곽선을 가늘게 합니다 */
  detail?: 'sprite' | 'portrait';
  shadow?: boolean;
}

// ───────────────────────── 색 ─────────────────────────

type RGB = [number, number, number];
const rgbCache = new Map<string, RGB>();

function parse(c: string): RGB {
  let v = rgbCache.get(c);
  if (v) return v;
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = c.match(/[\d.]+/g);
    v = m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [128, 128, 128];
  }
  if (rgbCache.size > 2000) rgbCache.clear();
  rgbCache.set(c, v);
  return v;
}

function hex(r: number, g: number, b: number): string {
  const f = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/** amt > 0 이면 밝게, < 0 이면 어둡게 (-1 ~ 1) */
export function tone(c: string, amt: number): string {
  const [r, g, b] = parse(c);
  const f = (x: number) => (amt >= 0 ? x + (255 - x) * amt : x * (1 + amt));
  return hex(f(r), f(g), f(b));
}

export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

function rgba(c: string, a: number): string {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${a})`;
}

function toHsl(c: string): [number, number, number] {
  const [r, g, b] = parse(c).map((x) => x / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return hex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

const isGrayish = (c: string) => toHsl(c)[1] < 0.12;

/** 머리색에 어울리는 눈동자 색 */
function eyeColorFor(hair: string): string {
  const [h, s, l] = toHsl(hair);
  if (s < 0.15) return l < 0.3 ? '#8a3a2a' : '#4b86c8';
  return fromHsl(h, Math.min(0.85, Math.max(0.5, s * 1.1)), 0.4);
}

interface Palette {
  line: string;
  skin: string;
  skinSh: string;
  blush: string;
  hair: string;
  hairSh: string;
  hairHi: string;
  eye: string;
  eyeSh: string;
  eyeHi: string;
  main: string;
  mainSh: string;
  mainHi: string;
  trim: string;
  trimSh: string;
  under: string;
  underSh: string;
  boot: string;
  bootSh: string;
  leather: string;
  gold: string;
  goldSh: string;
  helm: string;
  helmSh: string;
  helmHi: string;
  cape: string;
  capeSh: string;
}

const DEFAULT_TRIM: Record<ClassId, string> = {
  peasant: '#7a5a3a',
  warrior: '#c9a74a',
  rogue: '#b5463a',
  wizard: '#e8c35a',
  priest: '#d4af37',
  monk: '#c0392b',
  summoner: '#e05a7a',
  bard: '#e8b84a',
  beastkin: '#c8803a',
  archer: '#6fae4a',
  gladiator: '#c83a2a',
};

function buildPalette(look: HumanLook, outfit: ClassId, ghost: boolean): Palette {
  const main = look.body;
  let trim = look.body2 ?? DEFAULT_TRIM[outfit];
  // 1·2단계 장비의 회색 장식은 직업 색으로 (더 생기 있게)
  if (isGrayish(trim) && outfit !== 'peasant') trim = DEFAULT_TRIM[outfit];
  const hair = look.hairColor;
  const eye = eyeColorFor(hair);
  let under: string;
  let boot: string;
  switch (outfit) {
    case 'warrior':
      under = '#4a4048';
      boot = main;
      break;
    case 'rogue':
      under = tone(main, -0.45);
      boot = mix(tone(main, -0.3), '#4a3020', 0.5);
      break;
    case 'wizard':
      under = tone(main, -0.5);
      boot = tone(main, -0.45);
      break;
    case 'priest':
      under = '#e9e2d2';
      boot = mix(trim, '#ffffff', 0.25);
      break;
    case 'monk':
      under = mix(main, '#ffffff', 0.25);
      boot = '#3a2e2a';
      break;
    default:
      under = tone(main, -0.45);
      boot = '#6b4a2a';
  }
  const helm = look.helmet ?? '#9aa0a6';
  const capeBase = isGrayish(trim) ? '#8a1c22' : tone(trim, -0.35);
  const p: Palette = {
    line: '#2e1b14',
    skin: '#ffe2cc',
    skinSh: '#f2bfa0',
    blush: 'rgba(255,105,105,0.38)',
    hair,
    hairSh: tone(hair, -0.35),
    hairHi: mix(hair, '#ffffff', 0.45),
    eye,
    eyeSh: tone(eye, -0.55),
    eyeHi: mix(eye, '#ffffff', 0.55),
    main,
    mainSh: tone(main, -0.28),
    mainHi: mix(main, '#ffffff', 0.3),
    trim,
    trimSh: tone(trim, -0.3),
    under,
    underSh: tone(under, -0.3),
    boot,
    bootSh: tone(boot, -0.35),
    leather: '#5a3a24',
    gold: '#e0b84a',
    goldSh: '#9a7426',
    helm,
    helmSh: tone(helm, -0.32),
    helmHi: mix(helm, '#ffffff', 0.45),
    cape: capeBase,
    capeSh: tone(capeBase, -0.3),
  };
  if (ghost) {
    for (const k of Object.keys(p) as (keyof Palette)[]) {
      if (k === 'blush') continue;
      p[k] = mix(p[k], '#d6e4ff', 0.72);
    }
    p.line = '#5d6f9e';
    p.blush = 'rgba(160,180,255,0.3)';
  }
  return p;
}

// ───────────────────────── 머리 모양 ─────────────────────────

type Pt = [number, number];

interface HairDef {
  /** 앞머리 끝점들 (머리 중심 기준, 오른쪽 → 왼쪽) */
  fringe: Pt[];
  /** 정수리 볼륨 */
  puff: number;
  /** 정수리의 삐친 머리 (뾰족 머리) */
  spikes?: Pt[];
  /** 옆머리 길이 (머리 중심 기준 y). 없으면 귀 위에서 끝남 */
  locks?: number;
  back: 'none' | 'nape' | 'bob' | 'shoulder' | 'long' | 'ponytail' | 'twintail' | 'wavy';
  buns?: 'twin' | 'top';
  /** 머리카락 결 (일러스트용) */
  strands?: boolean;
}

// 오른쪽(바라보는 쪽)으로 쓸어 넘긴 앞머리
const SWEPT: Pt[] = [
  [12.8, 1.0],
  [10.6, -5.6],
  [9.2, -1.2],
  [6.6, -7.2],
  [4.2, -1.6],
  [1.0, -7.8],
  [-2.0, -2.0],
  [-5.0, -7.4],
  [-7.8, -2.6],
  [-10.4, -5.6],
  [-12.6, 1.6],
];
// 가지런한 일자 앞머리
const BLUNT: Pt[] = [
  [12.9, 2.6],
  [11.6, -2.2],
  [9.6, -1.4],
  [7.6, -2.8],
  [5.2, -1.2],
  [2.8, -2.8],
  [0.4, -1.3],
  [-2.2, -2.9],
  [-4.8, -1.4],
  [-7.4, -3.0],
  [-9.8, -1.8],
  [-11.6, -3.4],
  [-12.8, 2.6],
];
// 가운데 가르마
const PARTED: Pt[] = [
  [12.8, 2.0],
  [11.0, -3.6],
  [8.6, -0.8],
  [5.0, -6.6],
  [2.6, -9.2],
  [0.6, -6.0],
  [-2.6, -9.0],
  [-5.4, -4.4],
  [-8.6, -0.6],
  [-11.0, -3.8],
  [-12.8, 2.0],
];
// 삐죽삐죽한 앞머리
const SPIKY_FRINGE: Pt[] = [
  [13.2, 0.4],
  [11.4, -5.4],
  [10.6, 0.2],
  [7.4, -6.2],
  [5.6, -0.6],
  [2.4, -7.0],
  [-0.2, -0.8],
  [-2.8, -6.8],
  [-6.0, -1.2],
  [-8.2, -6.0],
  [-11.6, -1.0],
  [-12.6, -3.8],
  [-13.4, 1.2],
];
// 짧게 넘긴 앞머리 (상투)
const SHORT_FRINGE: Pt[] = [
  [12.6, -0.4],
  [9.8, -6.4],
  [6.8, -4.6],
  [3.2, -7.8],
  [-0.6, -5.6],
  [-4.4, -8.0],
  [-7.6, -5.4],
  [-10.6, -6.6],
  [-12.6, 0.4],
];

const HAIR_M: HairDef[] = [
  { fringe: SWEPT, puff: 0.6, back: 'nape' },
  { fringe: SPIKY_FRINGE, puff: 1.4, back: 'nape', spikes: [[-9, -11.5], [-4.6, -15.6], [1, -16.6], [6.6, -15.2], [10.8, -11]] },
  { fringe: PARTED, puff: 0.8, locks: 7, back: 'shoulder' },
  { fringe: SHORT_FRINGE, puff: 0.2, back: 'none', buns: 'top' },
  { fringe: SWEPT, puff: 0.8, back: 'ponytail' },
  { fringe: SPIKY_FRINGE, puff: 1.8, back: 'wavy' },
];

const HAIR_F: HairDef[] = [
  { fringe: BLUNT, puff: 0.8, locks: 7.5, back: 'bob' },
  { fringe: SPIKY_FRINGE, puff: 1.2, locks: 6, back: 'shoulder', spikes: [[-6, -14], [2, -16.2], [9, -13]] },
  { fringe: SWEPT, puff: 1.0, locks: 15, back: 'long' },
  { fringe: BLUNT, puff: 0.6, locks: 4, back: 'none', buns: 'twin' },
  { fringe: SWEPT, puff: 0.8, locks: 5, back: 'ponytail' },
  { fringe: BLUNT, puff: 0.8, locks: 6, back: 'twintail' },
];

// ───────────────────────── 자세 ─────────────────────────

interface Rig {
  front: boolean;
  /** 몸 전체를 위로 (양수 = 위) */
  bob: number;
  /** 유령이 떠오르는 높이 (프레임 캐시에서는 그릴 때 따로 적용) */
  float: number;
  /** 머리만 추가로 */
  headBob: number;
  lean: number;
  legNear: { dx: number; lift: number };
  legFar: { dx: number; lift: number };
  /** 팔 각도 (0 = 아래로, 양수 = 앞으로) */
  armWeapon: number;
  armOther: number;
  /** 무기 기울기 (0 = 위, 양수 = 앞으로) */
  weapon: number;
  mouth: 'smile' | 'open' | 'flat';
  blink: boolean;
  sway: number;
  cast: number;
}

const REST_WEAPON: Partial<Record<IconShape, number>> = {
  sword: -0.28,
  axe: -0.22,
  dagger: 1.1,
  mace: -0.18,
  stick: -0.22,
  staff: 0.02,
  claw: 1.45,
};

/** 숨쉬기 한 주기 (밀리초) */
const IDLE_MS = 2600;
const ghostFloat = (t: number) => 3 + Math.sin(t / 380) * 1.6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function computeRig(look: HumanLook, p: ChibiPose): Rig {
  const front = p.dir === 1 || p.dir === 2;
  const t = p.time;
  const wpn = look.weapon;
  const restW = (wpn && REST_WEAPON[wpn]) ?? 0.5;
  const r: Rig = {
    front,
    bob: 0,
    float: 0,
    headBob: 0,
    lean: 0,
    legNear: { dx: 0, lift: 0 },
    legFar: { dx: 0, lift: 0 },
    armWeapon: wpn === 'staff' ? 0.3 : wpn === 'claw' || wpn === 'dagger' ? 0.25 : -0.08,
    armOther: -0.06,
    weapon: restW,
    mouth: 'smile',
    blink: p.blink ?? (!p.showcase && t % 3600 < 120),
    sway: Math.sin(((t % IDLE_MS) / IDLE_MS) * Math.PI * 2) * 0.8,
    cast: 0,
  };
  if (p.showcase) {
    // 무기는 몸 옆으로 비스듬히, 방패가 없으면 다른 손은 반갑게 듦
    r.armWeapon = wpn === 'staff' ? 0.2 : -0.42;
    r.weapon = wpn === 'staff' ? -0.08 : wpn === 'claw' ? 0.9 : wpn === 'dagger' ? 0.7 : -0.62;
    r.armOther = look.shield ? 0.75 : 2.05;
    r.headBob = 0.4;
  }
  if (p.ghost) {
    r.float = ghostFloat(t);
    r.mouth = 'flat';
  } else if (p.walk !== null) {
    const ph = (p.walk + (p.step ?? 0)) * Math.PI;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    r.legNear = { dx: s * 2.4, lift: Math.max(0, c) * 1.8 };
    r.legFar = { dx: -s * 2.4, lift: Math.max(0, -c) * 1.8 };
    r.bob = Math.abs(c) * 1.3;
    r.armWeapon -= s * 0.5;
    r.armOther += s * 0.5;
    r.sway = s * 1.6;
  } else {
    // 숨쉬기
    r.headBob = (Math.sin(((t % IDLE_MS) / IDLE_MS) * Math.PI * 2) + 1) * 0.3;
  }
  if (p.act !== null && !p.ghost) {
    const a = p.act;
    r.mouth = 'open';
    if (p.actKind === 'cast') {
      const k = a < 0.3 ? easeOut(a / 0.3) : a < 0.75 ? 1 : 1 - easeInOut((a - 0.75) / 0.25);
      r.armWeapon = lerp(r.armWeapon, 2.0, k);
      r.armOther = lerp(r.armOther, 1.75, k);
      r.weapon = lerp(r.weapon, wpn === 'staff' ? -0.05 : 0.15, k);
      r.bob += k * 1.2;
      r.cast = k;
    } else {
      const thrust = wpn === 'claw' || wpn === 'dagger';
      const up = thrust ? -0.5 : -2.5;
      const hit = thrust ? 1.65 : 1.35;
      const wUp = thrust ? restW - 0.3 : -1.2;
      const wHit = thrust ? restW + 0.25 : 2.35;
      if (a < 0.3) {
        const k = easeOut(a / 0.3);
        r.armWeapon = lerp(r.armWeapon, up, k);
        r.weapon = lerp(restW, wUp, k);
      } else if (a < 0.55) {
        const k = easeIn((a - 0.3) / 0.25);
        r.armWeapon = lerp(up, hit, k);
        r.weapon = lerp(wUp, wHit, k);
        r.lean = k * 1.4;
      } else {
        const k = easeInOut((a - 0.55) / 0.45);
        r.armWeapon = lerp(hit, r.armWeapon, k);
        r.weapon = lerp(wHit, restW, k);
        r.lean = (1 - k) * 1.4;
      }
    }
  }
  return r;
}

// ───────────────────────── 그리기 도우미 ─────────────────────────

interface D {
  ctx: CanvasRenderingContext2D;
  look: HumanLook;
  pal: Palette;
  rig: Rig;
  lw: number;
  hi: boolean;
  outfit: ClassId;
  female: boolean;
  hair: HairDef;
  ghost: boolean;
}

function paint(d: D, fill: string | CanvasGradient, lw = d.lw): void {
  const { ctx } = d;
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = d.pal.line;
    ctx.stroke();
  }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}

/** 외곽선이 있는 둥근 막대 (팔, 다리) */
function tube(d: D, x1: number, y1: number, x2: number, y2: number, w: number, fill: string): void {
  const { ctx } = d;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = d.pal.line;
  ctx.lineWidth = w + d.lw * 2;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.stroke();
}

/** 끝으로 갈수록 넓어지는 소매 */
function bell(d: D, x1: number, y1: number, x2: number, y2: number, w1: number, w2: number, fill: string): void {
  const { ctx } = d;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.quadraticCurveTo(x2 + (dx / len) * 1.6, y2 + (dy / len) * 1.6, x2 - nx * w2, y2 - ny * w2);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.arc(x1, y1, w1, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
  paint(d, fill);
}

/** 점들을 부드럽게 잇는 곡선 (중점을 지나는 2차 곡선) */
function smoothThrough(ctx: CanvasRenderingContext2D, pts: Pt[], startWithLine = true): void {
  if (pts.length === 0) return;
  if (startWithLine) ctx.lineTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last[0], last[1]);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// ───────────────────────── 몸 기준 좌표 ─────────────────────────

const HEAD_Y = -37.2;
const SH_Y = -25.2;
const ARM_LEN = 9.0;

interface Body {
  /** 머리 중심 */
  hx: number;
  hy: number;
  /** 무기 든 손 쪽 어깨 / 다른 쪽 어깨 */
  shW: Pt;
  shO: Pt;
  handW: Pt;
  handO: Pt;
  /** 무기 쪽 팔이 몸 앞(가까운 쪽)인지 */
  weaponNear: boolean;
}

function bodyPoints(d: D): Body {
  const r = d.rig;
  const lean = r.lean;
  const hx = 0.9 + lean * 0.8;
  const hy = HEAD_Y - r.headBob;
  // 앞모습: 오른손(무기)은 화면 왼쪽(가까운 쪽). 뒷모습: 오른손은 화면 오른쪽(먼 쪽)
  const nearX = -6.2 + lean * 0.4;
  const farX = 6.8 + lean * 0.4;
  const shW: Pt = r.front ? [nearX, SH_Y + 1.4] : [farX, SH_Y + 1.4];
  const shO: Pt = r.front ? [farX, SH_Y + 1.4] : [nearX, SH_Y + 1.4];
  const hand = (s: Pt, a: number): Pt => [s[0] + Math.sin(a) * ARM_LEN, s[1] + Math.cos(a) * ARM_LEN];
  return { hx, hy, shW, shO, handW: hand(shW, r.armWeapon), handO: hand(shO, r.armOther), weaponNear: r.front };
}

// ───────────────────────── 머리 ─────────────────────────

function headPath(ctx: CanvasRenderingContext2D, x: number, y: number, front: boolean): void {
  ctx.beginPath();
  if (!front) {
    ctx.ellipse(x - 0.4, y, 12.7, 12.0, 0, 0, Math.PI * 2);
    return;
  }
  ctx.moveTo(x - 0.2, y - 11.9);
  ctx.bezierCurveTo(x + 7.8, y - 11.9, x + 13.2, y - 6.4, x + 13.0, y + 0.8);
  ctx.bezierCurveTo(x + 12.8, y + 6.4, x + 8.6, y + 11.2, x + 2.8, y + 12.3);
  ctx.bezierCurveTo(x - 3.6, y + 12.7, x - 10.6, y + 9.3, x - 12.2, y + 2.6);
  ctx.bezierCurveTo(x - 13.2, y - 5.6, x - 8.2, y - 11.9, x - 0.2, y - 11.9);
  ctx.closePath();
}

function drawEye(d: D, cx: number, cy: number, w: number, h: number, outer: -1 | 1): void {
  const { ctx, pal, lw } = d;
  if (d.rig.blink || d.ghost) {
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = lw * 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.55, cy + 0.2);
    ctx.quadraticCurveTo(cx, cy + 1.6, cx + w * 0.55, cy + 0.2);
    ctx.stroke();
    return;
  }
  if (d.hi) {
    // 흰자
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, cx + outer * 0.25, cy + 0.15, w * 0.62, h * 0.5);
    ctx.fill();
  }
  // 홍채
  ctx.fillStyle = pal.eye;
  ellipse(ctx, cx, cy, w * 0.5, h * 0.5);
  ctx.fill();
  // 위쪽 그늘
  ctx.save();
  ellipse(ctx, cx, cy, w * 0.5, h * 0.5);
  ctx.clip();
  ctx.fillStyle = pal.eyeSh;
  ellipse(ctx, cx, cy - h * 0.34, w * 0.62, h * 0.42);
  ctx.fill();
  // 아래 반사
  ctx.fillStyle = pal.eyeHi;
  ellipse(ctx, cx, cy + h * 0.36, w * 0.36, h * 0.18);
  ctx.fill();
  ctx.restore();
  // 동공
  ctx.fillStyle = '#1c0e0a';
  ellipse(ctx, cx + 0.15, cy + h * 0.02, w * 0.2, h * 0.24);
  ctx.fill();
  // 반짝임
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, cx - w * 0.17, cy - h * 0.2, w * 0.2, h * 0.17);
  ctx.fill();
  ellipse(ctx, cx + w * 0.2, cy + h * 0.2, w * 0.09, w * 0.09);
  ctx.fill();
  // 윗 속눈썹
  ctx.strokeStyle = pal.line;
  ctx.lineCap = 'round';
  ctx.lineWidth = lw * (d.hi ? 1.6 : 1.5);
  ctx.beginPath();
  const ix = cx - outer * w * 0.58;
  const ox = cx + outer * w * 0.62;
  ctx.moveTo(ix, cy - h * 0.2);
  ctx.quadraticCurveTo(cx, cy - h * 0.64, ox, cy - h * 0.28);
  if (d.female) ctx.lineTo(ox + outer * 1.1, cy - h * 0.5);
  ctx.stroke();
  if (d.hi) {
    // 아랫 속눈썹
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.3, cy + h * 0.52);
    ctx.quadraticCurveTo(cx, cy + h * 0.6, cx + w * 0.3, cy + h * 0.52);
    ctx.stroke();
  }
}

function drawFace(d: D, b: Body): void {
  const { ctx, pal, lw } = d;
  const { hx, hy } = b;
  const eh = d.female ? 7.0 : 6.3;
  const ey = hy + 2.4;
  drawEye(d, hx - 3.8, ey, 5.0, eh, -1);
  drawEye(d, hx + 5.8, ey, 4.4, eh * 0.97, 1);
  if (d.hi) {
    // 눈썹
    ctx.strokeStyle = tone(pal.hair, -0.2);
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(hx - 6.0, ey - eh * 0.82);
    ctx.quadraticCurveTo(hx - 3.6, ey - eh * 0.98, hx - 1.6, ey - eh * 0.8);
    ctx.moveTo(hx + 3.8, ey - eh * 0.8);
    ctx.quadraticCurveTo(hx + 5.6, ey - eh * 0.95, hx + 7.4, ey - eh * 0.78);
    ctx.stroke();
    // 코
    ctx.fillStyle = pal.skinSh;
    ellipse(ctx, hx + 2.4, hy + 5.6, 0.6, 0.4);
    ctx.fill();
  }
  // 볼 터치
  ctx.fillStyle = pal.blush;
  ellipse(ctx, hx - 7.2, hy + 6.3, 2.4, 1.2);
  ctx.fill();
  ellipse(ctx, hx + 8.7, hy + 6.1, 1.8, 1.1);
  ctx.fill();
  // 입
  const mx = hx + 2.2;
  const my = hy + 8.2;
  if (d.rig.mouth === 'open') {
    ctx.fillStyle = '#8a2a2a';
    ctx.beginPath();
    ctx.moveTo(mx - 1.5, my - 0.4);
    ctx.quadraticCurveTo(mx, my - 0.9, mx + 1.5, my - 0.4);
    ctx.quadraticCurveTo(mx, my + 2.4, mx - 1.5, my - 0.4);
    ctx.closePath();
    paint(d, '#8a2a2a', lw * 0.6);
    ctx.fillStyle = '#ff8a8a';
    ellipse(ctx, mx, my + 0.9, 0.8, 0.45);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#8a3a30';
    ctx.lineWidth = lw * 0.85;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (d.rig.mouth === 'flat') {
      ctx.moveTo(mx - 1.0, my);
      ctx.lineTo(mx + 1.0, my);
    } else {
      ctx.moveTo(mx - 1.4, my - 0.3);
      ctx.quadraticCurveTo(mx, my + 1.1, mx + 1.4, my - 0.3);
    }
    ctx.stroke();
  }
}

/** 머리카락 윗부분 바깥선 (왼쪽 아래 → 정수리 → 오른쪽 아래) */
function capOuter(ctx: CanvasRenderingContext2D, hx: number, hy: number, h: HairDef, sideY: number): void {
  const p = h.puff;
  ctx.moveTo(hx - 13.6, hy + sideY);
  if (h.spikes) {
    ctx.bezierCurveTo(hx - 15.4 - p, hy - 4, hx - 13.6, hy - 10, hx - 11.6, hy - 11.2);
    let prev: Pt = [hx - 11.6, hy - 11.2];
    for (const [sx, sy] of h.spikes) {
      const tip: Pt = [hx + sx, hy + sy - p];
      ctx.lineTo(tip[0], tip[1]);
      prev = [hx + sx + 2.4, hy - 12.6 - p * 0.5];
      ctx.lineTo(prev[0], prev[1]);
    }
    ctx.bezierCurveTo(hx + 14.4, hy - 9.4, hx + 15.6 + p, hy - 3.4, hx + 14.0, hy + sideY);
    return;
  }
  ctx.bezierCurveTo(hx - 15.4 - p, hy - 5.8, hx - 9.8, hy - 14.4 - p, hx + 0.4, hy - 14.2 - p);
  ctx.bezierCurveTo(hx + 10.6, hy - 14.2 - p, hx + 15.6 + p, hy - 6.0, hx + 14.0, hy + sideY);
}

/** 앞모습: 머리 뒤쪽 (몸보다 먼저 그림) */
function drawHairBackFront(d: D, b: Body): void {
  const { ctx, pal } = d;
  const { hx, hy } = b;
  const h = d.hair;
  const sw = d.rig.sway;
  ctx.lineJoin = 'round';
  switch (h.back) {
    case 'bob':
      ctx.beginPath();
      ctx.moveTo(hx - 13.2, hy - 4);
      ctx.bezierCurveTo(hx - 15.6, hy + 4, hx - 14.6, hy + 10.5, hx - 11.4, hy + 11.6);
      ctx.lineTo(hx + 12.8, hy + 11.0);
      ctx.bezierCurveTo(hx + 15.4, hy + 9, hx + 15.6, hy + 2, hx + 13.8, hy - 4);
      ctx.closePath();
      paint(d, pal.hairSh);
      break;
    case 'shoulder':
    case 'wavy': {
      const len = h.back === 'wavy' ? 13 : d.female ? 17 : 15;
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 5);
      ctx.bezierCurveTo(hx - 16.4, hy + 3, hx - 15.2 + sw * 0.3, hy + len - 2, hx - 12.4 + sw * 0.4, hy + len);
      if (h.back === 'wavy') {
        ctx.lineTo(hx - 9.6, hy + len - 2.6);
        ctx.lineTo(hx - 7.2, hy + len + 0.6);
      }
      ctx.lineTo(hx + 12.8 + sw * 0.4, hy + len - 1);
      ctx.bezierCurveTo(hx + 15.8, hy + len - 4, hx + 16.0, hy + 3, hx + 13.8, hy - 5);
      ctx.closePath();
      paint(d, pal.hairSh);
      break;
    }
    case 'long': {
      const end = hy + 30;
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 6);
      ctx.bezierCurveTo(hx - 17.4, hy + 6, hx - 16.8 + sw * 0.4, end - 8, hx - 14.6 + sw * 0.6, end);
      ctx.lineTo(hx - 11.0 + sw * 0.6, end - 2.6);
      ctx.lineTo(hx - 8.0 + sw * 0.5, end + 0.4);
      ctx.lineTo(hx + 10.6 + sw * 0.5, end - 0.8);
      ctx.lineTo(hx + 13.6 + sw * 0.5, end - 3.4);
      ctx.bezierCurveTo(hx + 16.8, end - 9, hx + 17.2, hy + 6, hx + 13.6, hy - 6);
      ctx.closePath();
      paint(d, pal.hairSh);
      break;
    }
    case 'ponytail': {
      // 머리 뒤(화면 왼쪽)로 늘어진 꼬리
      const len = d.female ? 24 : 16;
      ctx.beginPath();
      ctx.moveTo(hx - 7.0, hy - 12.4);
      ctx.bezierCurveTo(hx - 19.0, hy - 13.6, hx - 21.0 + sw, hy + len * 0.4, hx - 16.2 + sw * 1.4, hy + len);
      ctx.bezierCurveTo(hx - 15.6 + sw, hy + len * 0.55, hx - 13.6, hy - 2, hx - 9.8, hy - 5.6);
      ctx.closePath();
      paint(d, pal.hair);
      ctx.strokeStyle = pal.hairSh;
      ctx.lineWidth = d.lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 9.6);
      ctx.quadraticCurveTo(hx - 18.6 + sw, hy + len * 0.3, hx - 16.4 + sw * 1.2, hy + len * 0.8);
      ctx.stroke();
      break;
    }
    case 'twintail': {
      for (const side of [-1, 1] as const) {
        const x0 = hx + side * 11.2;
        const len = 26;
        const s = sw * (side === -1 ? 1.2 : 0.8);
        ctx.beginPath();
        ctx.moveTo(x0 - 2.4, hy - 8.8);
        ctx.bezierCurveTo(x0 + side * 9.4, hy - 6.6, x0 + side * 9.0 + s, hy + len * 0.55, x0 + side * 5.2 + s * 1.3, hy + len);
        ctx.bezierCurveTo(x0 + side * 4.0 + s, hy + len * 0.5, x0 + side * 1.2, hy - 1.5, x0 + 2.4 * side, hy - 4.6);
        ctx.closePath();
        paint(d, side === -1 ? pal.hairSh : pal.hair);
      }
      break;
    }
    default:
      break;
  }
}

/** 앞모습: 머리 앞쪽 (얼굴 위에 그림) */
function drawHairFront(d: D, b: Body): void {
  const { ctx, pal, lw } = d;
  const { hx, hy } = b;
  const h = d.hair;
  ctx.lineJoin = 'round';
  // 옆머리 (얼굴 옆으로 내려오는 머리)
  if (h.locks) {
    const ly = hy + h.locks;
    const sw = d.rig.sway * 0.3;
    ctx.beginPath();
    ctx.moveTo(hx - 13.4, hy - 3);
    ctx.bezierCurveTo(hx - 14.6, hy + 3, hx - 13.6 + sw, ly - 2, hx - 11.6 + sw, ly);
    ctx.lineTo(hx - 10.0 + sw, ly - 2.6);
    ctx.bezierCurveTo(hx - 9.4, hy + 3, hx - 9.0, hy - 1, hx - 9.6, hy - 3.4);
    ctx.closePath();
    paint(d, pal.hair);
    ctx.beginPath();
    ctx.moveTo(hx + 13.8, hy - 3);
    ctx.bezierCurveTo(hx + 15.0, hy + 3, hx + 14.2 + sw, ly - 3, hx + 12.6 + sw, ly - 1);
    ctx.lineTo(hx + 11.4 + sw, ly - 3.2);
    ctx.bezierCurveTo(hx + 11.6, hy + 3, hx + 11.8, hy - 1, hx + 11.0, hy - 3.6);
    ctx.closePath();
    paint(d, pal.hair);
  }
  // 정수리 + 앞머리
  const sideY = h.locks ? -1.5 : 2.2;
  ctx.beginPath();
  capOuter(ctx, hx, hy, h, sideY);
  const fr = h.fringe.map(([x, y]) => [hx + x, hy + y] as Pt);
  smoothThrough(ctx, fr);
  ctx.closePath();
  paint(d, pal.hair);
  // 빛나는 띠 (천사의 고리)
  ctx.save();
  ctx.beginPath();
  capOuter(ctx, hx, hy, h, sideY);
  smoothThrough(ctx, fr);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = rgba(pal.hairHi, 0.75);
  ctx.lineWidth = d.hi ? 1.4 : 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(hx - 0.6, hy - 2.4, 10.4, 8.6, -0.15, Math.PI * 1.08, Math.PI * 1.52);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(hx - 0.6, hy - 2.4, 10.4, 8.6, -0.15, Math.PI * 1.6, Math.PI * 1.78);
  ctx.stroke();
  if (d.hi) {
    // 머리카락 결
    ctx.strokeStyle = rgba(pal.hairSh, 0.8);
    ctx.lineWidth = lw * 0.55;
    for (let i = 1; i < fr.length - 1; i += 2) {
      const [x, y] = fr[i]!;
      ctx.beginPath();
      ctx.moveTo(x, y - 0.5);
      ctx.quadraticCurveTo(x - 0.8, y - 5, x - 1.6 + (x - hx) * 0.15, hy - 11);
      ctx.stroke();
    }
  }
  ctx.restore();
  // 경단 / 상투
  if (h.buns === 'twin') {
    for (const [bx, by] of [
      [hx - 9.6, hy - 12.6],
      [hx + 10.6, hy - 12.2],
    ] as Pt[]) {
      ellipse(ctx, bx, by, 4.8, 4.4);
      paint(d, pal.hair);
      ctx.strokeStyle = pal.hairSh;
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.arc(bx + 0.4, by + 0.4, 2.4, Math.PI * 0.9, Math.PI * 2.1);
      ctx.stroke();
      // 머리끈
      ctx.fillStyle = pal.trim;
      ellipse(ctx, bx + (bx < hx ? 2.6 : -2.6), by + 3.2, 1.6, 1.1, bx < hx ? -0.6 : 0.6);
      paint(d, pal.trim, lw * 0.6);
    }
  } else if (h.buns === 'top') {
    ellipse(ctx, hx + 0.6, hy - 15.6, 4.2, 3.8);
    paint(d, pal.hair);
    ctx.fillStyle = pal.trim;
    ctx.beginPath();
    ctx.rect(hx - 2.4, hy - 13.4, 6, 1.8);
    paint(d, pal.trim, lw * 0.6);
  }
  if (h.back === 'twintail') {
    // 양쪽 머리끈
    for (const [bx, by] of [
      [hx - 11.6, hy - 6.6],
      [hx + 12.0, hy - 6.4],
    ] as Pt[]) {
      ellipse(ctx, bx, by, 1.9, 1.5);
      paint(d, pal.trim, lw * 0.7);
    }
  }
}

/** 뒷모습 머리 */
function drawHairBackView(d: D, b: Body): void {
  const { ctx, pal } = d;
  const { hx, hy } = b;
  const h = d.hair;
  const sw = d.rig.sway;
  // 등으로 늘어진 머리 (뒤통수 머리가 윗부분을 덮도록 먼저 그림)
  if (h.back === 'shoulder' || h.back === 'wavy' || h.back === 'bob' || h.back === 'long') {
    const len = h.back === 'long' ? 30 : h.back === 'bob' ? 12 : h.back === 'wavy' ? 13 : 16;
    ctx.beginPath();
    ctx.moveTo(hx - 13.0, hy);
    ctx.bezierCurveTo(hx - 15.0, hy + len * 0.5, hx - 12.6 + sw * 0.5, hy + len - 3, hx - 10.6 + sw * 0.6, hy + len);
    for (let i = 1; i <= 4; i++) {
      const x = hx - 10.6 + (i / 4) * 20.6 + sw * 0.6;
      ctx.lineTo(x - 2.6, hy + len - 2.4);
      ctx.lineTo(x, hy + len + (i % 2) * 0.8);
    }
    ctx.bezierCurveTo(hx + 12.6 + sw * 0.5, hy + len - 3, hx + 14.8, hy + len * 0.5, hx + 12.6, hy);
    ctx.closePath();
    paint(d, pal.hair);
    ctx.strokeStyle = pal.hairSh;
    ctx.lineWidth = d.lw * 0.7;
    ctx.beginPath();
    for (const x of [-5.6, 0, 5.4]) {
      ctx.moveTo(hx + x, hy + 8);
      ctx.quadraticCurveTo(hx + x * 1.15 + sw * 0.4, hy + len * 0.6, hx + x * 1.1 + sw * 0.6, hy + len - 2.6);
    }
    ctx.stroke();
  }
  // 머리 전체를 덮는 뒷머리
  ctx.beginPath();
  capOuter(ctx, hx - 0.4, hy, h, 2.6);
  const bottom = h.back === 'nape' || h.back === 'none' ? 9.4 : 10.6;
  ctx.bezierCurveTo(hx + 13.6, hy + 7, hx + 8, hy + bottom + 1.4, hx - 0.4, hy + bottom);
  ctx.bezierCurveTo(hx - 8.6, hy + bottom + 1.4, hx - 14.2, hy + 7, hx - 14.0, hy + 2.6);
  ctx.closePath();
  paint(d, pal.hair);
  // 가르마 / 결
  ctx.strokeStyle = pal.hairSh;
  ctx.lineWidth = d.lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(hx - 0.4, hy - 13);
  ctx.quadraticCurveTo(hx + 1.4, hy - 2, hx - 0.8, hy + bottom - 1);
  ctx.moveTo(hx - 6.6, hy - 10);
  ctx.quadraticCurveTo(hx - 7.4, hy, hx - 6.0, hy + bottom - 2);
  ctx.moveTo(hx + 6.0, hy - 10);
  ctx.quadraticCurveTo(hx + 7.0, hy, hx + 5.6, hy + bottom - 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(pal.hairHi, 0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(hx - 0.4, hy - 1, 10.4, 9.4, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  // 길게 늘어진 머리
  switch (h.back) {
    case 'ponytail': {
      const len = d.female ? 26 : 18;
      ctx.beginPath();
      ctx.moveTo(hx - 3.4, hy - 7);
      ctx.bezierCurveTo(hx - 6.4 + sw, hy + len * 0.4, hx - 4.0 + sw * 1.2, hy + len * 0.8, hx - 0.6 + sw * 1.4, hy + len);
      ctx.bezierCurveTo(hx + 3.6 + sw, hy + len * 0.7, hx + 4.6, hy + len * 0.3, hx + 2.8, hy - 7);
      ctx.closePath();
      paint(d, pal.hair);
      ellipse(ctx, hx - 0.2, hy - 7.2, 2.6, 1.6);
      paint(d, pal.trim, d.lw * 0.7);
      break;
    }
    case 'twintail': {
      for (const side of [-1, 1] as const) {
        const x0 = hx + side * 10.6;
        const len = 26;
        ctx.beginPath();
        ctx.moveTo(x0 - 2.2, hy - 7.6);
        ctx.bezierCurveTo(x0 + side * 7.6, hy - 4, x0 + side * 7.0 + sw, hy + len * 0.6, x0 + side * 3.6 + sw * 1.3, hy + len);
        ctx.bezierCurveTo(x0 + side * 2.2 + sw, hy + len * 0.5, x0, hy, x0 + 2.2, hy - 4.4);
        ctx.closePath();
        paint(d, pal.hair);
        ellipse(ctx, x0 + side * 0.4, hy - 6.4, 2.0, 1.6);
        paint(d, pal.trim, d.lw * 0.7);
      }
      break;
    }
    default:
      break;
  }
  if (h.buns === 'twin') {
    for (const bx of [hx - 9.8, hx + 9.0]) {
      ellipse(ctx, bx, hy - 12.4, 4.8, 4.4);
      paint(d, pal.hair);
    }
  } else if (h.buns === 'top') {
    ellipse(ctx, hx - 0.2, hy - 15.4, 4.2, 3.8);
    paint(d, pal.hair);
  }
}

// ───────────────────────── 모자 / 투구 ─────────────────────────

type HeadGear = 'none' | 'horned' | 'halfhelm' | 'circlet' | 'hood' | 'veil' | 'bandana' | 'headband' | 'browguard';

function headGearOf(d: D): HeadGear {
  const o = d.outfit;
  if (d.look.helmet) {
    if (o === 'wizard' || o === 'priest') return 'circlet';
    if (o === 'rogue') return 'halfhelm';
    if (o === 'monk') return 'browguard';
    return 'horned';
  }
  if (o === 'wizard') return d.female ? 'none' : 'hood';
  if (o === 'priest') return d.female ? 'veil' : 'circlet';
  if (o === 'rogue') return d.female ? 'headband' : 'bandana';
  if (o === 'monk') return 'headband';
  return 'none';
}

/** 머리카락을 가리는 모자인지 */
const coversHair = (g: HeadGear) => g === 'horned' || g === 'hood' || g === 'halfhelm' || g === 'bandana';

/** 얼굴 뒤에 그려야 하는 부분 (두건 뒷부분 등) */
function drawGearBehind(d: D, b: Body, g: HeadGear): void {
  const { ctx, pal } = d;
  const { hx, hy } = b;
  const sw = d.rig.sway;
  if (g === 'hood') {
    // 뾰족한 두건: 뒤쪽(화면 왼쪽)으로 처진 끝
    ctx.beginPath();
    ctx.moveTo(hx - 12.4, hy + 9);
    ctx.bezierCurveTo(hx - 17.6, hy + 2, hx - 17.0, hy - 12, hx - 8.0, hy - 15.6);
    ctx.bezierCurveTo(hx - 13.0, hy - 17.4, hx - 19.6 + sw, hy - 12.6, hx - 22.6 + sw * 1.4, hy - 6.4);
    ctx.bezierCurveTo(hx - 19.6 + sw, hy - 18.8, hx - 6.0, hy - 21.6, hx + 3.0, hy - 16.6);
    ctx.bezierCurveTo(hx + 12.4, hy - 13.8, hx + 16.4, hy - 4, hx + 14.4, hy + 7.4);
    ctx.bezierCurveTo(hx + 8.0, hy + 13, hx - 6.0, hy + 13.4, hx - 12.4, hy + 9);
    ctx.closePath();
    paint(d, pal.mainSh);
  } else if (g === 'veil') {
    ctx.beginPath();
    ctx.moveTo(hx - 12.8, hy - 6);
    ctx.bezierCurveTo(hx - 18.4, hy + 4, hx - 16.6 + sw * 0.5, hy + 18, hx - 13.0 + sw * 0.6, hy + 20.6);
    ctx.lineTo(hx + 13.6 + sw * 0.5, hy + 19.4);
    ctx.bezierCurveTo(hx + 17.6, hy + 14, hx + 18.0, hy + 2, hx + 13.6, hy - 6);
    ctx.closePath();
    paint(d, pal.main);
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx - 12.4 + sw * 0.6, hy + 19.4);
    ctx.lineTo(hx + 13.0 + sw * 0.5, hy + 18.2);
    ctx.stroke();
  } else if (g === 'bandana' || g === 'headband') {
    // 뒤로 묶은 매듭 꼬리
    const kx = hx - 12.4;
    const ky = g === 'bandana' ? hy - 6.8 : hy - 7.6;
    ctx.beginPath();
    ctx.moveTo(kx + 1, ky - 1);
    ctx.quadraticCurveTo(kx - 6 + sw, ky + 1.4, kx - 9.4 + sw * 1.5, ky + 6.4);
    ctx.lineTo(kx - 6.4 + sw * 1.2, ky + 5.4);
    ctx.quadraticCurveTo(kx - 3.6 + sw, ky + 2.4, kx + 0.6, ky + 1.4);
    ctx.closePath();
    paint(d, pal.trimSh);
    ctx.beginPath();
    ctx.moveTo(kx + 0.6, ky + 0.6);
    ctx.quadraticCurveTo(kx - 3.4 + sw, ky + 5.2, kx - 4.4 + sw * 1.3, ky + 10.2);
    ctx.lineTo(kx - 1.8 + sw, ky + 8.8);
    ctx.quadraticCurveTo(kx - 1.0, ky + 4.6, kx + 1.6, ky + 1.6);
    ctx.closePath();
    paint(d, pal.trim);
  }
}

function drawGearFront(d: D, b: Body, g: HeadGear): void {
  const { ctx, pal, lw } = d;
  const { hx, hy } = b;
  switch (g) {
    case 'horned': {
      // 뿔 달린 투구 (얼굴은 열려 있음)
      for (const side of [-1, 1] as const) {
        const bx = hx + side * 10.2 + (side === 1 ? 0.6 : 0);
        ctx.beginPath();
        ctx.moveTo(bx, hy - 7.6);
        ctx.bezierCurveTo(bx + side * 6.4, hy - 8.6, bx + side * 9.0, hy - 13.6, bx + side * 7.6, hy - 21.6);
        ctx.bezierCurveTo(bx + side * 5.6, hy - 15.4, bx + side * 3.2, hy - 13.0, bx - side * 0.6, hy - 12.2);
        ctx.closePath();
        paint(d, '#f2ead6');
        ctx.fillStyle = '#c9b48a';
        ctx.beginPath();
        ctx.moveTo(bx + side * 7.0, hy - 17.4);
        ctx.lineTo(bx + side * 7.6, hy - 21.6);
        ctx.lineTo(bx + side * 5.6, hy - 17.8);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(hx - 13.8, hy + 4.6);
      ctx.bezierCurveTo(hx - 15.2, hy - 6, hx - 9.6, hy - 15.4, hx + 0.4, hy - 15.4);
      ctx.bezierCurveTo(hx + 10.8, hy - 15.4, hx + 16.0, hy - 6.4, hx + 14.6, hy + 4.0);
      ctx.lineTo(hx + 11.6, hy + 4.6);
      ctx.lineTo(hx + 11.0, hy - 2.6);
      ctx.quadraticCurveTo(hx + 1.0, hy - 6.4, hx - 9.8, hy - 2.6);
      ctx.lineTo(hx - 10.6, hy + 5.2);
      ctx.closePath();
      paint(d, pal.helm);
      // 반사광과 테두리
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pal.helmHi;
      ellipse(ctx, hx - 4.6, hy - 10.4, 5.2, 2.6, -0.4);
      ctx.fill();
      ctx.fillStyle = pal.helmSh;
      ctx.fillRect(hx + 7.6, hy - 16, 8, 22);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(hx - 10.6, hy - 2.4);
      ctx.quadraticCurveTo(hx + 1.0, hy - 6.6, hx + 11.4, hy - 2.4);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // 가운데 장식 보석
      star(ctx, hx + 0.8, hy - 5.6, 1.9, 0.9, 4);
      paint(d, pal.trim, lw * 0.6);
      break;
    }
    case 'halfhelm': {
      ctx.beginPath();
      ctx.moveTo(hx - 13.4, hy - 1.6);
      ctx.bezierCurveTo(hx - 14.4, hy - 9, hx - 8.6, hy - 15, hx + 0.4, hy - 15);
      ctx.bezierCurveTo(hx + 9.8, hy - 15, hx + 15.2, hy - 9, hx + 14.2, hy - 1.8);
      ctx.quadraticCurveTo(hx + 0.6, hy - 6.6, hx - 13.4, hy - 1.6);
      ctx.closePath();
      paint(d, pal.helm);
      ctx.strokeStyle = pal.helmHi;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hx - 1, hy - 4, 9, Math.PI * 1.15, Math.PI * 1.45);
      ctx.stroke();
      break;
    }
    case 'circlet': {
      const c = d.look.helmet ? pal.helm : pal.gold;
      ctx.beginPath();
      ctx.moveTo(hx - 12.4, hy - 5.0);
      ctx.quadraticCurveTo(hx + 0.6, hy - 8.6, hx + 13.2, hy - 5.2);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx + 1.0, hy - 10.6);
      ctx.lineTo(hx + 2.8, hy - 7.6);
      ctx.lineTo(hx + 1.0, hy - 5.0);
      ctx.lineTo(hx - 0.8, hy - 7.6);
      ctx.closePath();
      paint(d, d.outfit === 'priest' ? '#7fd3ff' : pal.trim, lw * 0.7);
      break;
    }
    case 'hood': {
      // 얼굴을 감싸는 두건 앞쪽 테두리
      ctx.beginPath();
      ctx.moveTo(hx - 12.6, hy + 7.6);
      ctx.bezierCurveTo(hx - 15.4, hy - 5, hx - 9.4, hy - 16.4, hx + 1.0, hy - 16.0);
      ctx.bezierCurveTo(hx + 11.0, hy - 15.6, hx + 15.6, hy - 6, hx + 14.0, hy + 6.6);
      ctx.lineTo(hx + 12.0, hy + 6.0);
      ctx.bezierCurveTo(hx + 12.6, hy - 4, hx + 8.0, hy - 10.8, hx + 0.8, hy - 10.8);
      ctx.bezierCurveTo(hx - 7.0, hy - 10.8, hx - 11.6, hy - 4, hx - 10.2, hy + 7.0);
      ctx.closePath();
      paint(d, pal.main);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx - 10.8, hy + 6.4);
      ctx.bezierCurveTo(hx - 12.0, hy - 5, hx - 7.6, hy - 11.8, hx + 0.8, hy - 11.8);
      ctx.bezierCurveTo(hx + 8.8, hy - 11.8, hx + 13.2, hy - 5, hx + 12.6, hy + 5.6);
      ctx.stroke();
      break;
    }
    case 'veil': {
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 1);
      ctx.bezierCurveTo(hx - 15.0, hy - 10, hx - 8.8, hy - 15.8, hx + 0.6, hy - 15.6);
      ctx.bezierCurveTo(hx + 10.4, hy - 15.4, hx + 16.0, hy - 9, hx + 14.4, hy - 1.2);
      ctx.quadraticCurveTo(hx + 0.6, hy - 9.6, hx - 13.6, hy - 1);
      ctx.closePath();
      paint(d, pal.main);
      ctx.beginPath();
      ctx.moveTo(hx - 12.8, hy - 3.2);
      ctx.quadraticCurveTo(hx + 0.6, hy - 11.2, hx + 13.6, hy - 3.4);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ellipse(ctx, hx + 0.8, hy - 7.6, 1.6, 1.6);
      paint(d, '#7fd3ff', lw * 0.6);
      break;
    }
    case 'bandana': {
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 2.6);
      ctx.bezierCurveTo(hx - 14.8, hy - 10.6, hx - 8.2, hy - 15.4, hx + 0.6, hy - 15.2);
      ctx.bezierCurveTo(hx + 9.8, hy - 15.0, hx + 15.4, hy - 9.6, hx + 14.4, hy - 2.8);
      ctx.quadraticCurveTo(hx + 0.6, hy - 7.6, hx - 13.6, hy - 2.6);
      ctx.closePath();
      paint(d, pal.trim);
      // 물방울 무늬
      ctx.fillStyle = rgba('#ffffff', 0.55);
      for (const [x, y] of [
        [-6, -10],
        [-1, -12.4],
        [5, -11],
        [9.4, -7],
        [-9.6, -6],
        [2.4, -8],
      ] as Pt[]) {
        ellipse(ctx, hx + x, hy + y, 0.9, 0.7);
        ctx.fill();
      }
      break;
    }
    case 'headband':
    case 'browguard': {
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 6.6);
      ctx.quadraticCurveTo(hx + 0.6, hy - 11.2, hx + 13.8, hy - 6.6);
      ctx.lineTo(hx + 13.6, hy - 4.0);
      ctx.quadraticCurveTo(hx + 0.6, hy - 8.4, hx - 12.8, hy - 4.0);
      ctx.closePath();
      paint(d, pal.trim);
      if (g === 'browguard') {
        ctx.beginPath();
        ctx.moveTo(hx - 3.4, hy - 9.4);
        ctx.lineTo(hx + 5.2, hy - 9.4);
        ctx.lineTo(hx + 4.6, hy - 5.6);
        ctx.lineTo(hx - 2.8, hy - 5.6);
        ctx.closePath();
        paint(d, pal.helm, lw * 0.8);
        ctx.fillStyle = pal.helmHi;
        ctx.fillRect(hx - 1.8, hy - 8.8, 3.2, 0.9);
      }
      break;
    }
    default:
      break;
  }
}

/** 뒷모습 모자 */
function drawGearBackView(d: D, b: Body, g: HeadGear): void {
  const { ctx, pal } = d;
  const { hx, hy } = b;
  switch (g) {
    case 'horned':
    case 'halfhelm':
      ctx.beginPath();
      ctx.moveTo(hx - 14.4, hy + 5);
      ctx.bezierCurveTo(hx - 15.6, hy - 7, hx - 9.6, hy - 15.6, hx - 0.4, hy - 15.6);
      ctx.bezierCurveTo(hx + 9.2, hy - 15.6, hx + 15.2, hy - 7, hx + 13.8, hy + 5);
      ctx.quadraticCurveTo(hx - 0.4, hy + 9, hx - 14.4, hy + 5);
      ctx.closePath();
      paint(d, pal.helm);
      ctx.fillStyle = pal.helmHi;
      ellipse(ctx, hx - 4.4, hy - 10, 4.6, 2.4, -0.3);
      ctx.fill();
      if (g === 'horned') {
        for (const side of [-1, 1] as const) {
          const bx = hx + side * 10.6 - 0.4;
          ctx.beginPath();
          ctx.moveTo(bx, hy - 7);
          ctx.bezierCurveTo(bx + side * 6.4, hy - 8, bx + side * 9.0, hy - 13, bx + side * 7.6, hy - 21);
          ctx.bezierCurveTo(bx + side * 5.6, hy - 15, bx + side * 3.2, hy - 12.6, bx - side * 0.6, hy - 11.6);
          ctx.closePath();
          paint(d, '#f2ead6');
        }
      }
      break;
    case 'hood':
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy + 9);
      ctx.bezierCurveTo(hx - 16.4, hy - 6, hx - 10.4, hy - 16.6, hx - 0.4, hy - 16.6);
      ctx.bezierCurveTo(hx + 6.0, hy - 16.6, hx + 10.0, hy - 15.0, hx + 12.6, hy - 12.4);
      ctx.bezierCurveTo(hx + 18.6, hy - 13.6, hx + 21.0, hy - 9, hx + 22.4, hy - 4);
      ctx.bezierCurveTo(hx + 18.4, hy - 8, hx + 15.6, hy - 8.6, hx + 14.4, hy - 6.6);
      ctx.bezierCurveTo(hx + 16.0, hy - 1, hx + 15.4, hy + 5, hx + 13.0, hy + 9);
      ctx.quadraticCurveTo(hx - 0.4, hy + 14, hx - 13.6, hy + 9);
      ctx.closePath();
      paint(d, pal.main);
      break;
    case 'veil': {
      const sw = d.rig.sway;
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 4);
      ctx.bezierCurveTo(hx - 15.2, hy - 12, hx - 8.6, hy - 16, hx - 0.4, hy - 16);
      ctx.bezierCurveTo(hx + 8.0, hy - 16, hx + 14.6, hy - 12, hx + 13.0, hy - 4);
      ctx.bezierCurveTo(hx + 16.6, hy + 4, hx + 15.0 + sw * 0.4, hy + 11, hx + 12.6 + sw * 0.6, hy + 15.4);
      ctx.quadraticCurveTo(hx - 0.4 + sw * 0.6, hy + 18.4, hx - 13.2 + sw * 0.6, hy + 15.6);
      ctx.bezierCurveTo(hx - 15.8, hy + 11, hx - 17.0, hy + 4, hx - 13.6, hy - 4);
      ctx.closePath();
      paint(d, pal.main);
      ctx.strokeStyle = pal.mainSh;
      ctx.lineWidth = d.lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(hx - 6.4, hy - 8);
      ctx.quadraticCurveTo(hx - 8.0, hy + 4, hx - 7.4 + sw * 0.5, hy + 15.6);
      ctx.moveTo(hx + 5.8, hy - 8);
      ctx.quadraticCurveTo(hx + 7.4, hy + 4, hx + 6.6 + sw * 0.5, hy + 15.2);
      ctx.stroke();
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx + 12.0 + sw * 0.6, hy + 14.6);
      ctx.quadraticCurveTo(hx - 0.4 + sw * 0.6, hy + 17.4, hx - 12.6 + sw * 0.6, hy + 14.8);
      ctx.stroke();
      star(ctx, hx - 0.4, hy - 3.6, 2.6, 1.1, 4);
      paint(d, pal.trim, d.lw * 0.6);
      break;
    }
    case 'circlet':
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(hx - 13.2, hy - 4.6);
      ctx.quadraticCurveTo(hx - 0.4, hy - 1.8, hx + 12.6, hy - 4.6);
      ctx.stroke();
      ctx.strokeStyle = d.look.helmet ? pal.helm : pal.gold;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    case 'bandana':
      ctx.beginPath();
      ctx.moveTo(hx - 14.0, hy - 1);
      ctx.bezierCurveTo(hx - 15.0, hy - 10.6, hx - 8.6, hy - 15.4, hx - 0.4, hy - 15.4);
      ctx.bezierCurveTo(hx + 8.0, hy - 15.4, hx + 14.4, hy - 10.6, hx + 13.4, hy - 1);
      ctx.quadraticCurveTo(hx - 0.4, hy + 2, hx - 14.0, hy - 1);
      ctx.closePath();
      paint(d, pal.trim);
      ellipse(ctx, hx - 0.4, hy + 0.4, 2.4, 1.8);
      paint(d, pal.trimSh, d.lw * 0.7);
      break;
    case 'headband':
    case 'browguard':
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 5.6);
      ctx.quadraticCurveTo(hx - 0.4, hy - 2.6, hx + 12.8, hy - 5.6);
      ctx.lineTo(hx + 12.8, hy - 3.0);
      ctx.quadraticCurveTo(hx - 0.4, hy + 0.2, hx - 13.6, hy - 3.0);
      ctx.closePath();
      paint(d, pal.trim);
      ctx.beginPath();
      ctx.moveTo(hx - 1.4, hy - 2.4);
      ctx.quadraticCurveTo(hx - 3.0 + d.rig.sway, hy + 4, hx - 4.4 + d.rig.sway * 1.4, hy + 9);
      ctx.lineTo(hx - 2.0 + d.rig.sway, hy + 8.4);
      ctx.quadraticCurveTo(hx - 0.6, hy + 3, hx + 0.6, hy - 2.4);
      ctx.closePath();
      paint(d, pal.trimSh);
      break;
    default:
      break;
  }
}

// ───────────────────────── 무기 / 방패 ─────────────────────────

function drawWeapon(d: D, shape: IconShape | undefined, color: string, x: number, y: number, angle: number): void {
  if (!shape) return;
  const { ctx, pal, lw } = d;
  const metal = d.ghost ? mix('#dfe6ee', '#d6e4ff', 0.7) : '#dfe6ee';
  const glow = d.ghost ? mix(color, '#d6e4ff', 0.7) : color;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'round';
  switch (shape) {
    case 'sword': {
      const blade = mix(metal, glow, 0.35);
      ctx.beginPath();
      ctx.rect(-0.9, -1.2, 1.8, 5.2);
      paint(d, pal.leather, lw * 0.8);
      ellipse(ctx, 0, 4.6, 1.4, 1.4);
      paint(d, pal.gold, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(-1.9, -2.6);
      ctx.lineTo(-1.9, -20.4);
      ctx.lineTo(0, -24.6);
      ctx.lineTo(1.9, -20.4);
      ctx.lineTo(1.9, -2.6);
      ctx.closePath();
      paint(d, blade);
      ctx.strokeStyle = rgba('#ffffff', 0.8);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-1.0, -4);
      ctx.lineTo(-1.0, -20.4);
      ctx.stroke();
      ctx.strokeStyle = tone(blade, -0.3);
      ctx.beginPath();
      ctx.moveTo(0.4, -4);
      ctx.lineTo(0.4, -19.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-4.8, -3.0, 9.6, 2.0, 0.9);
      paint(d, pal.gold, lw * 0.9);
      ellipse(ctx, 0, -2.0, 1.2, 1.2);
      paint(d, glow, lw * 0.6);
      break;
    }
    case 'axe': {
      tube(d, 0, 5, 0, -20, 2.0, '#7a5232');
      const head = mix(metal, glow, 0.35);
      ctx.beginPath();
      ctx.moveTo(0.6, -19.6);
      ctx.bezierCurveTo(5.0, -21.6, 9.8, -23.6, 10.6, -18.0);
      ctx.bezierCurveTo(11.2, -13.0, 8.2, -10.6, 4.6, -11.6);
      ctx.bezierCurveTo(3.2, -12.6, 1.6, -13.0, 0.6, -13.4);
      ctx.closePath();
      paint(d, head);
      ctx.strokeStyle = rgba('#ffffff', 0.75);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(9.0, -20.0);
      ctx.quadraticCurveTo(10.6, -16, 8.4, -12.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.6, -18.6);
      ctx.lineTo(-3.8, -17.2);
      ctx.lineTo(-0.6, -14.6);
      ctx.closePath();
      paint(d, head, lw * 0.8);
      ellipse(ctx, 0, -16.4, 1.1, 1.1);
      paint(d, glow, lw * 0.6);
      break;
    }
    case 'dagger': {
      ctx.beginPath();
      ctx.rect(-0.8, -1.0, 1.6, 4.4);
      paint(d, pal.leather, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(-1.4, -1.4);
      ctx.lineTo(0, -11.6);
      ctx.lineTo(1.4, -1.4);
      ctx.closePath();
      paint(d, mix(metal, glow, 0.35));
      ctx.beginPath();
      ctx.roundRect(-3.0, -2.4, 6.0, 1.5, 0.7);
      paint(d, glow, lw * 0.8);
      break;
    }
    case 'claw': {
      // 주먹에 끼우는 갈퀴
      const blade = mix(metal, glow, 0.35);
      for (const ox of [-1.6, 0, 1.6]) {
        ctx.beginPath();
        ctx.moveTo(ox - 0.7, -1.6);
        ctx.quadraticCurveTo(ox - 0.6, -6, ox + 1.4, -9.0 + Math.abs(ox) * 0.3);
        ctx.quadraticCurveTo(ox + 0.2, -5.6, ox + 0.7, -1.6);
        ctx.closePath();
        paint(d, blade, lw * 0.8);
      }
      ctx.beginPath();
      ctx.roundRect(-2.8, -2.4, 5.6, 3.0, 1.2);
      paint(d, glow, lw * 0.8);
      break;
    }
    case 'staff': {
      tube(d, 0, 9.5, 0, -25.5, 1.9, '#6b4423');
      ctx.strokeStyle = rgba('#ffffff', 0.25);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-0.4, 8);
      ctx.lineTo(-0.4, -24);
      ctx.stroke();
      // 보주를 감싼 고리
      ctx.fillStyle = rgba(glow, 0.28);
      ellipse(ctx, 0, -29.4, 6.2, 6.2);
      ctx.fill();
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, -29.2, 4.6, Math.PI * 0.62, Math.PI * 2.38);
      ctx.stroke();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ellipse(ctx, 0, -29.2, 2.9, 2.9);
      paint(d, glow, lw * 0.8);
      ctx.fillStyle = rgba('#ffffff', 0.9);
      ellipse(ctx, -0.9, -30.2, 0.9, 0.7);
      ctx.fill();
      break;
    }
    case 'mace': {
      tube(d, 0, 4.2, 0, -11.6, 1.8, '#7a5232');
      const head = mix(metal, glow, 0.45);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 2.4, -14.4 + Math.sin(a) * 2.4);
        ctx.lineTo(Math.cos(a + 0.26) * 5.0, -14.4 + Math.sin(a + 0.26) * 5.0);
        ctx.lineTo(Math.cos(a + 0.52) * 2.4, -14.4 + Math.sin(a + 0.52) * 2.4);
        ctx.closePath();
        paint(d, head, lw * 0.7);
      }
      ellipse(ctx, 0, -14.4, 3.2, 3.2);
      paint(d, head);
      ellipse(ctx, 0, -14.4, 1.3, 1.3);
      paint(d, glow, lw * 0.5);
      break;
    }
    case 'stick': {
      ctx.beginPath();
      ctx.moveTo(-1.1, 4);
      ctx.lineTo(-2.3, -13.4);
      ctx.quadraticCurveTo(0, -16.6, 2.3, -13.4);
      ctx.lineTo(1.1, 4);
      ctx.closePath();
      paint(d, d.ghost ? mix('#9a6b40', '#d6e4ff', 0.7) : '#9a6b40');
      ctx.fillStyle = '#6b4423';
      ellipse(ctx, -0.6, -8, 0.7, 1.1);
      ctx.fill();
      ellipse(ctx, 0.8, -3, 0.6, 0.9);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawShield(d: D, color: string, x: number, y: number): void {
  const { ctx, pal, lw } = d;
  const base = d.ghost ? mix(color, '#d6e4ff', 0.72) : color;
  const rim = pal.trim;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-6.2, -7.0);
  ctx.quadraticCurveTo(0, -9.0, 6.2, -7.0);
  ctx.lineTo(6.0, 0.6);
  ctx.quadraticCurveTo(5.0, 6.6, 0, 9.4);
  ctx.quadraticCurveTo(-5.0, 6.6, -6.0, 0.6);
  ctx.closePath();
  paint(d, rim);
  ctx.beginPath();
  ctx.moveTo(-4.6, -5.6);
  ctx.quadraticCurveTo(0, -7.2, 4.6, -5.6);
  ctx.lineTo(4.5, 0.4);
  ctx.quadraticCurveTo(3.7, 5.0, 0, 7.4);
  ctx.quadraticCurveTo(-3.7, 5.0, -4.5, 0.4);
  ctx.closePath();
  paint(d, base, lw * 0.7);
  ctx.fillStyle = rgba('#ffffff', 0.35);
  ctx.beginPath();
  ctx.moveTo(-4.0, -5.0);
  ctx.quadraticCurveTo(-1.6, -6.0, 0, -6.2);
  ctx.lineTo(0, 6.6);
  ctx.quadraticCurveTo(-3.4, 4.6, -4.0, 0.4);
  ctx.closePath();
  ctx.fill();
  star(ctx, 0, -0.4, 2.8, 1.2, 4);
  paint(d, pal.gold, lw * 0.6);
  ctx.restore();
}

// ───────────────────────── 몸 / 의상 ─────────────────────────

function sleeveColor(d: D): string {
  switch (d.outfit) {
    case 'warrior':
      return d.pal.under;
    case 'monk':
      return d.female ? d.pal.main : d.pal.skin;
    case 'rogue':
      return d.pal.mainSh;
    default:
      return d.pal.main;
  }
}

/** 팔 하나 (소매 + 손). 무기는 따로 */
function drawArm(d: D, sh: Pt, hand: Pt, near: boolean): void {
  const { pal } = d;
  const o = d.outfit;
  const sc = sleeveColor(d);
  if (o === 'wizard' || o === 'priest') {
    bell(d, sh[0], sh[1], hand[0], hand[1] - 0.5, 2.2, 3.4, near ? sc : pal.mainSh);
    // 소매 끝 장식
    const ex = hand[0] - sh[0];
    const ey = hand[1] - sh[1];
    const len = Math.hypot(ex, ey) || 1;
    d.ctx.strokeStyle = pal.trim;
    d.ctx.lineWidth = 1.2;
    d.ctx.beginPath();
    d.ctx.moveTo(hand[0] - (ey / len) * 3.2 - (ex / len) * 0.8, hand[1] - 0.5 + (ex / len) * 3.2 - (ey / len) * 0.8);
    d.ctx.lineTo(hand[0] + (ey / len) * 3.2 - (ex / len) * 0.8, hand[1] - 0.5 - (ex / len) * 3.2 - (ey / len) * 0.8);
    d.ctx.stroke();
  } else {
    const w = o === 'monk' && !d.female ? 3.9 : 3.4;
    tube(d, sh[0], sh[1], hand[0], hand[1], w, near ? sc : tone(sc, -0.12));
    if (o === 'peasant' || (o === 'monk' && d.female)) {
      // 짧은 소매 아래로 드러난 팔
      const mx = sh[0] + (hand[0] - sh[0]) * 0.45;
      const my = sh[1] + (hand[1] - sh[1]) * 0.45;
      tube(d, mx, my, hand[0], hand[1], 2.8, near ? pal.skin : pal.skinSh);
    }
    if (o === 'monk') {
      // 손목 붕대
      const bx = sh[0] + (hand[0] - sh[0]) * 0.72;
      const by = sh[1] + (hand[1] - sh[1]) * 0.72;
      tube(d, bx, by, hand[0], hand[1], 3.4, '#f4f0e6');
    }
    if (o === 'warrior') {
      // 건틀릿
      const bx = sh[0] + (hand[0] - sh[0]) * 0.55;
      const by = sh[1] + (hand[1] - sh[1]) * 0.55;
      tube(d, bx, by, hand[0], hand[1], 4.0, near ? pal.main : pal.mainSh);
    }
    if (o === 'rogue') {
      const bx = sh[0] + (hand[0] - sh[0]) * 0.62;
      const by = sh[1] + (hand[1] - sh[1]) * 0.62;
      tube(d, bx, by, hand[0], hand[1], 3.6, pal.leather);
    }
  }
}

function drawHand(d: D, hand: Pt, near: boolean): void {
  const glove = d.outfit === 'warrior' ? d.pal.main : d.outfit === 'rogue' ? d.pal.leather : near ? d.pal.skin : d.pal.skinSh;
  ellipse(d.ctx, hand[0], hand[1], 2.3, 2.2);
  paint(d, glove);
}

function drawLegs(d: D): void {
  const { ctx, pal, rig } = d;
  const o = d.outfit;
  const robe = o === 'wizard' || o === 'priest';
  const legs = [
    { x: rig.front ? 3.0 : -2.6, ...rig.legFar, near: false },
    { x: rig.front ? -2.6 : 3.0, ...rig.legNear, near: true },
  ];
  for (const L of legs) {
    const footX = L.x + L.dx;
    const footY = -L.lift;
    if (!robe) {
      const w = o === 'monk' ? 4.8 : 4.0;
      tube(d, L.x, -13.6, footX, footY - 4.2, w, L.near ? pal.under : tone(pal.under, -0.12));
    } else {
      tube(d, L.x, -8, footX, footY - 3.4, 3.4, L.near ? pal.under : pal.underSh);
    }
    // 신발
    const toe = rig.front ? 2.0 : 0.6;
    const bootTop = o === 'rogue' ? -8.2 : o === 'warrior' ? -6.6 : -4.4;
    const bc = L.near ? pal.boot : pal.bootSh;
    ctx.beginPath();
    ctx.moveTo(footX - 2.4, footY + bootTop);
    ctx.lineTo(footX + 2.2, footY + bootTop);
    ctx.lineTo(footX + 2.4, footY - 2.0);
    ctx.quadraticCurveTo(footX + 2.6 + toe, footY - 2.0, footX + 2.6 + toe, footY - 0.2);
    ctx.lineTo(footX - 2.6, footY - 0.2);
    ctx.closePath();
    paint(d, bc);
    if (o === 'rogue') {
      ctx.beginPath();
      ctx.rect(footX - 2.7, footY + bootTop - 0.6, 5.2, 1.8);
      paint(d, tone(bc, 0.15), d.lw * 0.8);
    } else if (o === 'warrior') {
      ctx.fillStyle = pal.gold;
      ctx.fillRect(footX - 2.0, footY + bootTop + 0.6, 4.0, 0.9);
    } else if (o === 'monk') {
      ctx.strokeStyle = '#f4f0e6';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(footX - 2.0, footY - 4.6);
      ctx.lineTo(footX + 2.0, footY - 3.4);
      ctx.moveTo(footX - 2.0, footY - 3.0);
      ctx.lineTo(footX + 2.0, footY - 1.8);
      ctx.stroke();
    }
  }
}

/** 망토 (전사). 앞모습에서는 몸 뒤로 살짝 보이고 뒷모습에서는 몸을 덮음 */
function drawCape(d: D, b: Body, overBody: boolean): void {
  const { ctx, pal } = d;
  const sw = d.rig.sway;
  if (!overBody) {
    ctx.beginPath();
    ctx.moveTo(-6.0, SH_Y);
    ctx.bezierCurveTo(-11.4 + sw * 0.3, -18, -12.6 + sw * 0.6, -8, -11.6 + sw, -3.6);
    ctx.lineTo(-4.0 + sw * 0.6, -5.6);
    ctx.lineTo(0, -12);
    ctx.closePath();
    paint(d, pal.capeSh);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(-7.4, SH_Y - 0.4);
  ctx.quadraticCurveTo(b.hx, SH_Y - 2.0, 8.0, SH_Y - 0.4);
  ctx.bezierCurveTo(10.6, -17, 11.0 + sw * 0.6, -9, 10.4 + sw, -4.6);
  ctx.lineTo(5.6 + sw, -5.8);
  ctx.lineTo(1.0 + sw, -4.4);
  ctx.lineTo(-3.6 + sw, -5.8);
  ctx.lineTo(-8.6 + sw, -4.6);
  ctx.bezierCurveTo(-10.4 + sw * 0.6, -9, -10.0, -17, -7.4, SH_Y - 0.4);
  ctx.closePath();
  paint(d, pal.cape);
  ctx.strokeStyle = pal.capeSh;
  ctx.lineWidth = d.lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(-2.4, -22);
  ctx.lineTo(-3.2 + sw, -6.4);
  ctx.moveTo(4.0, -22);
  ctx.lineTo(4.6 + sw, -6.6);
  ctx.stroke();
}

/** 상체 + 하의 (앞모습/뒷모습 공통 모양, 장식만 다름) */
function drawTorso(d: D, b: Body): void {
  const { ctx, pal, lw, rig } = d;
  const o = d.outfit;
  const front = rig.front;
  const f = d.female;
  const sw = rig.sway * 0.3;
  const shL = f ? -6.0 : -6.6;
  const shR = f ? 6.6 : 7.2;

  // 하의 (치마/로브/갑옷 자락)
  if (o === 'wizard' || o === 'priest') {
    const flare = o === 'wizard' ? 10.8 : 9.6;
    ctx.beginPath();
    ctx.moveTo(shL + 0.2, SH_Y + 2);
    ctx.lineTo(shR - 0.2, SH_Y + 2);
    ctx.bezierCurveTo(shR + 1.4, -16, flare - 1.0 + sw, -6, flare + sw, -1.6);
    ctx.quadraticCurveTo(flare * 0.5 + sw, -0.4, 0.6 + sw, -1.2);
    ctx.quadraticCurveTo(-flare * 0.5 + sw, -0.4, -flare + 0.6 + sw, -1.6);
    ctx.bezierCurveTo(-flare + 1.8 + sw, -6, shL - 1.4, -16, shL + 0.2, SH_Y + 2);
    ctx.closePath();
    paint(d, pal.main);
    // 그늘과 밑단 장식
    ctx.save();
    ctx.clip();
    ctx.fillStyle = pal.mainSh;
    ctx.beginPath();
    ctx.moveTo(front ? 3.4 : -2.6, -17);
    ctx.lineTo(front ? 14 : -14, -17);
    ctx.lineTo(front ? 14 : -14, 0);
    ctx.lineTo(front ? 5.0 + sw : -4.0 + sw, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-flare - 1, -2.9);
    ctx.quadraticCurveTo(0, -1.6, flare + 1, -2.9);
    ctx.stroke();
    if (front) {
      // 앞섶 / 성직자 앞치마
      if (o === 'priest') {
        ctx.fillStyle = pal.trim;
        ctx.beginPath();
        ctx.moveTo(-1.2, -21);
        ctx.lineTo(3.6, -21);
        ctx.lineTo(4.2 + sw, -1);
        ctx.lineTo(-1.6 + sw, -1);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.7;
        ctx.stroke();
        star(ctx, 1.3 + sw * 0.5, -7.2, 1.6, 0.7, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(1.6, -20);
        ctx.quadraticCurveTo(2.4, -10, 2.0 + sw, -1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  } else if (o === 'warrior') {
    // 사슬 치마 + 갑옷 자락
    ctx.beginPath();
    ctx.moveTo(-6.6, -17);
    ctx.lineTo(7.0, -17);
    ctx.lineTo(7.6, -9.6);
    ctx.lineTo(-7.2, -9.6);
    ctx.closePath();
    paint(d, pal.under);
    const plates: [number, number][] = [
      [-7.6, -2.6],
      [-2.4, 2.6],
      [2.8, 7.8],
    ];
    for (const [x0, x1] of plates) {
      ctx.beginPath();
      ctx.moveTo(x0, -16);
      ctx.lineTo(x1, -16);
      ctx.lineTo(x1 + (x1 > 0 ? 0.6 : 0), -9.4);
      ctx.quadraticCurveTo((x0 + x1) / 2, -8.4, x0 - (x0 < 0 ? 0.6 : 0), -9.4);
      ctx.closePath();
      paint(d, (x0 + x1) / 2 > 2 === front ? pal.mainSh : pal.main);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.6, -10.6);
      ctx.quadraticCurveTo((x0 + x1) / 2, -9.8, x1 - 0.6, -10.6);
      ctx.stroke();
    }
  } else if (f && (o === 'peasant' || o === 'rogue')) {
    // 치마
    const hem = o === 'rogue' ? -10.6 : -8.4;
    ctx.beginPath();
    ctx.moveTo(-6.2, -17.6);
    ctx.lineTo(6.8, -17.6);
    ctx.quadraticCurveTo(8.8 + sw, -13, 9.4 + sw, hem);
    ctx.quadraticCurveTo(5 + sw, hem + 1.2, 0.6 + sw, hem + 0.2);
    ctx.quadraticCurveTo(-4 + sw, hem + 1.2, -8.8 + sw, hem);
    ctx.quadraticCurveTo(-8.2, -13, -6.2, -17.6);
    ctx.closePath();
    paint(d, o === 'rogue' ? pal.mainSh : pal.main);
    if (o === 'peasant') {
      // 앞치마
      ctx.beginPath();
      ctx.moveTo(-3.6, -17);
      ctx.lineTo(4.8, -17);
      ctx.lineTo(5.6 + sw, hem + 1.6);
      ctx.quadraticCurveTo(0.8 + sw, hem + 2.4, -4.4 + sw, hem + 1.6);
      ctx.closePath();
      paint(d, '#f4efe2', lw * 0.8);
    }
  } else {
    // 바지 윗부분
    ctx.beginPath();
    ctx.moveTo(-6.4, -17.4);
    ctx.lineTo(6.8, -17.4);
    ctx.lineTo(7.0, -12.0);
    ctx.lineTo(-6.6, -12.0);
    ctx.closePath();
    paint(d, pal.under);
    if (o === 'peasant' || o === 'rogue') {
      // 상의 아랫자락
      ctx.beginPath();
      ctx.moveTo(-6.8, -17.6);
      ctx.lineTo(7.2, -17.6);
      ctx.lineTo(7.8 + sw, -12.6);
      ctx.lineTo(3.0 + sw, -11.6);
      ctx.lineTo(-2.0 + sw, -12.4);
      ctx.lineTo(-7.4 + sw, -11.8);
      ctx.closePath();
      paint(d, pal.main);
    }
  }

  // 상체
  ctx.beginPath();
  ctx.moveTo(shL, SH_Y - 0.4);
  ctx.quadraticCurveTo(0.6, SH_Y - 2.2, shR, SH_Y - 0.4);
  ctx.quadraticCurveTo(shR + 1.2, SH_Y + 4.4, shR - 0.2, -16.4);
  ctx.lineTo(shL + 0.2, -16.4);
  ctx.quadraticCurveTo(shL - 1.2, SH_Y + 4.4, shL, SH_Y - 0.4);
  ctx.closePath();
  paint(d, pal.main);
  ctx.save();
  ctx.clip();
  // 그늘 (바라보는 반대쪽)
  ctx.fillStyle = pal.mainSh;
  if (front) ctx.fillRect(shR - 3.2, SH_Y - 3, 6, 12);
  else ctx.fillRect(shL - 2.8, SH_Y - 3, 6, 12);
  if (front) {
    switch (o) {
      case 'peasant': {
        ctx.fillStyle = pal.skin;
        ctx.beginPath();
        ctx.moveTo(-1.4, SH_Y - 2);
        ctx.lineTo(3.6, SH_Y - 2);
        ctx.lineTo(1.1, SH_Y + 3.8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
        break;
      }
      case 'warrior': {
        ctx.fillStyle = pal.mainHi;
        ellipse(ctx, -2.6, -22.4, 2.8, 2.2, -0.4);
        ctx.fill();
        ctx.strokeStyle = pal.mainSh;
        ctx.lineWidth = lw * 0.8;
        ctx.beginPath();
        ctx.moveTo(1.0, SH_Y - 1);
        ctx.lineTo(1.0, -16.6);
        ctx.moveTo(-6, -19.6);
        ctx.quadraticCurveTo(1, -18.2, 7.4, -19.6);
        ctx.stroke();
        break;
      }
      case 'rogue': {
        ctx.fillStyle = mix(pal.main, '#f0e6d0', 0.6);
        ctx.beginPath();
        ctx.moveTo(-1.0, SH_Y - 2);
        ctx.lineTo(3.4, SH_Y - 2);
        ctx.lineTo(1.2, -18.0);
        ctx.closePath();
        ctx.fill();
        // 어깨끈
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-5.6, SH_Y);
        ctx.lineTo(7.4, -16.6);
        ctx.stroke();
        ctx.strokeStyle = pal.leather;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        break;
      }
      case 'monk': {
        // 여민 깃
        ctx.fillStyle = d.female ? mix(pal.main, '#ffffff', 0.5) : pal.skin;
        ctx.beginPath();
        ctx.moveTo(-2.4, SH_Y - 2);
        ctx.lineTo(4.4, SH_Y - 2);
        ctx.lineTo(2.0, -19.6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-4.6, SH_Y - 1);
        ctx.lineTo(2.2, -19.0);
        ctx.lineTo(4.6, -16.8);
        ctx.stroke();
        break;
      }
      case 'wizard': {
        star(ctx, -0.6, -21.4, 2.4, 1.0, 5);
        ctx.fillStyle = pal.gold;
        ctx.fill();
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-3.0, SH_Y - 1.4);
        ctx.quadraticCurveTo(1.0, SH_Y + 1.4, 5.0, SH_Y - 1.4);
        ctx.stroke();
        break;
      }
      case 'priest':
        break;
    }
  } else {
    // 뒷모습 장식
    ctx.strokeStyle = o === 'warrior' ? pal.mainSh : pal.trim;
    ctx.lineWidth = o === 'warrior' ? lw * 0.8 : 1.0;
    ctx.beginPath();
    ctx.moveTo(0.4, SH_Y - 1);
    ctx.lineTo(0.4, -16.6);
    ctx.stroke();
  }
  ctx.restore();

  // 허리띠
  const beltY = -17.8;
  if (o === 'wizard' || o === 'monk') {
    ctx.beginPath();
    ctx.moveTo(shL - 0.2, beltY - 0.8);
    ctx.lineTo(shR + 0.2, beltY - 0.8);
    ctx.lineTo(shR + 0.2, beltY + 1.8);
    ctx.lineTo(shL - 0.2, beltY + 1.8);
    ctx.closePath();
    paint(d, pal.trim, lw * 0.8);
    // 매듭과 늘어진 끈
    const kx = front ? 5.6 : -4.6;
    ctx.beginPath();
    ctx.moveTo(kx - 0.6, beltY + 1.4);
    ctx.quadraticCurveTo(kx + 1.2 + sw, beltY + 5, kx + 1.6 + sw * 1.4, beltY + 8.4);
    ctx.lineTo(kx + 3.2 + sw * 1.2, beltY + 7.6);
    ctx.quadraticCurveTo(kx + 2.4, beltY + 4, kx + 1.6, beltY + 1.2);
    ctx.closePath();
    paint(d, pal.trimSh, lw * 0.8);
    ellipse(ctx, kx + 0.6, beltY + 0.5, 1.6, 1.3);
    paint(d, pal.trim, lw * 0.8);
  } else if (o !== 'priest') {
    ctx.beginPath();
    ctx.rect(shL - 0.2, beltY - 0.6, shR - shL + 0.4, 2.2);
    paint(d, o === 'peasant' ? '#8a6a42' : pal.leather, lw * 0.8);
    if (front) {
      ctx.beginPath();
      ctx.rect(0.0, beltY - 1.0, 2.6, 3.0);
      paint(d, pal.gold, lw * 0.7);
    }
    if (o === 'rogue') {
      // 주머니
      ctx.beginPath();
      ctx.roundRect(front ? -6.6 : 4.0, beltY + 1.0, 3.4, 3.2, 0.8);
      paint(d, pal.leather, lw * 0.8);
    }
  }

  // 어깨 장식
  if (o === 'warrior') {
    const sides: [number, number][] = front
      ? [
          [8.0, 1],
          [-7.6, 0],
        ]
      : [
          [-7.6, 1],
          [8.0, 0],
        ];
    for (const [x, far] of sides) {
      ellipse(ctx, x, SH_Y + 0.6, far ? 4.0 : 4.8, far ? 3.4 : 4.0, x < 0 ? 0.25 : -0.25);
      paint(d, far ? pal.mainSh : pal.main);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(x, SH_Y + 1.4, far ? 3.2 : 3.9, far ? 2.2 : 2.6, x < 0 ? 0.25 : -0.25, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      if (!far) {
        ctx.fillStyle = pal.mainHi;
        ellipse(ctx, x - 1.2, SH_Y - 0.8, 1.6, 0.9, -0.3);
        ctx.fill();
      }
    }
  } else if (o === 'priest') {
    // 짧은 어깨 망토
    ctx.beginPath();
    ctx.moveTo(shL - 0.4, SH_Y);
    ctx.quadraticCurveTo(0.6, SH_Y - 2.6, shR + 0.4, SH_Y);
    ctx.quadraticCurveTo(shR + 2.4, SH_Y + 3.6, shR + 1.4, SH_Y + 6.0);
    ctx.quadraticCurveTo(0.6, SH_Y + 8.4, shL - 1.4, SH_Y + 6.0);
    ctx.quadraticCurveTo(shL - 2.4, SH_Y + 3.6, shL - 0.4, SH_Y);
    ctx.closePath();
    paint(d, pal.mainHi);
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(shR + 1.0, SH_Y + 5.4);
    ctx.quadraticCurveTo(0.6, SH_Y + 7.8, shL - 1.0, SH_Y + 5.4);
    ctx.stroke();
    if (front) {
      // 태양 문장
      ctx.fillStyle = pal.gold;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(1.2 + Math.cos(a) * 1.6, SH_Y + 3.6 + Math.sin(a) * 1.6);
        ctx.lineTo(1.2 + Math.cos(a + 0.2) * 3.0, SH_Y + 3.6 + Math.sin(a + 0.2) * 3.0);
        ctx.lineTo(1.2 + Math.cos(a + 0.4) * 1.6, SH_Y + 3.6 + Math.sin(a + 0.4) * 1.6);
        ctx.fill();
      }
      ellipse(ctx, 1.2, SH_Y + 3.6, 1.6, 1.6);
      paint(d, pal.gold, lw * 0.6);
    }
  } else if (o === 'rogue') {
    // 목도리
    ctx.beginPath();
    ctx.moveTo(shL + 0.6, SH_Y - 0.8);
    ctx.quadraticCurveTo(0.6, SH_Y - 3.4, shR - 0.6, SH_Y - 0.8);
    ctx.lineTo(shR - 1.0, SH_Y + 2.0);
    ctx.quadraticCurveTo(0.6, SH_Y + 0.6, shL + 1.0, SH_Y + 2.0);
    ctx.closePath();
    paint(d, pal.trim);
  }
}

/** 목도리 꼬리 (도적, 몸 뒤) */
function drawScarfTail(d: D): void {
  if (d.outfit !== 'rogue') return;
  const { ctx, pal } = d;
  const sw = d.rig.sway;
  const x = d.rig.front ? -4.4 : 4.8;
  const dir = d.rig.front ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, SH_Y);
  ctx.quadraticCurveTo(x + dir * 6 + sw, SH_Y + 2, x + dir * 9.6 + sw * 1.6, SH_Y + 6.4);
  ctx.lineTo(x + dir * 7.2 + sw * 1.4, SH_Y + 7.2);
  ctx.quadraticCurveTo(x + dir * 4 + sw, SH_Y + 4, x - dir * 0.4, SH_Y + 2.4);
  ctx.closePath();
  paint(d, pal.trimSh);
}

function drawNeck(d: D, b: Body): void {
  const { ctx } = d;
  ctx.beginPath();
  ctx.rect(b.hx - 2.4, SH_Y - 4.4, 5.0, 4.4);
  paint(d, d.pal.skinSh, d.lw * 0.8);
}

function drawEar(d: D, b: Body): void {
  ellipse(d.ctx, b.hx - 11.6, b.hy + 2.0, 2.0, 2.8, 0.2);
  paint(d, d.pal.skin, d.lw * 0.9);
  d.ctx.fillStyle = d.pal.skinSh;
  ellipse(d.ctx, b.hx - 11.4, b.hy + 2.2, 0.9, 1.5, 0.2);
  d.ctx.fill();
}

// ───────────────────────── 조립 ─────────────────────────

const prepared = new WeakMap<HumanLook, { pal: Palette; ghostPal: Palette; outfit: ClassId; hair: HairDef }>();

function prep(look: HumanLook) {
  let p = prepared.get(look);
  if (!p) {
    const outfit = look.outfit ?? 'peasant';
    const styles = look.gender === 'f' ? HAIR_F : HAIR_M;
    p = {
      pal: buildPalette(look, outfit, false),
      ghostPal: buildPalette(look, outfit, true),
      outfit,
      hair: styles[((look.hairStyle % styles.length) + styles.length) % styles.length]!,
    };
    prepared.set(look, p);
  }
  return p;
}

/** 사람 캐릭터를 그립니다. ctx 의 원점이 발 위치여야 합니다. */
function makeDraw(ctx: CanvasRenderingContext2D, look: HumanLook, pose: ChibiPose, hi: boolean): D {
  const p = prep(look);
  const ghost = pose.ghost === true;
  return {
    ctx,
    look,
    pal: ghost ? p.ghostPal : p.pal,
    rig: computeRig(look, pose),
    lw: hi ? 0.6 : 1.0,
    hi,
    outfit: p.outfit,
    female: look.gender === 'f',
    hair: p.hair,
    ghost,
  };
}

function drawShadow(ctx: CanvasRenderingContext2D, ghost: boolean): void {
  ctx.fillStyle = ghost ? 'rgba(40,60,120,0.12)' : 'rgba(0,0,0,0.28)';
  ellipse(ctx, 0, 0, 11.5, 4.6);
  ctx.fill();
}

/** 몸만 그림 (그림자 없음, 좌우 뒤집기 없음, 유령 부유 없음) */
function drawBody(d: D): void {
  const { ctx } = d;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(0, -d.rig.bob);
  if (d.rig.front) drawFront(d);
  else drawBack(d);
  ctx.restore();
}

/** 사람 캐릭터를 바로 그립니다 (일러스트·미리보기용). ctx 의 원점이 발 위치여야 합니다. */
export function drawChibi(ctx: CanvasRenderingContext2D, look: HumanLook, pose: ChibiPose, opts: ChibiOptions = {}): void {
  const d = makeDraw(ctx, look, pose, opts.detail === 'portrait');
  ctx.save();
  if (opts.shadow !== false) drawShadow(ctx, d.ghost);
  if (pose.dir === 2 || pose.dir === 3) ctx.scale(-1, 1);
  ctx.translate(0, -d.rig.float);
  drawBody(d);
  ctx.restore();
}

// ───────────────────────── 게임 화면용 프레임 캐시 ─────────────────────────
// 캐릭터를 매 프레임 벡터로 그리면 무거워서, 자세를 몇 단계로 나눈 그림을 만들어 두고 복사해 씁니다.

/** 프레임 그림의 범위 (발 기준, CSS 픽셀) */
const FW = 84;
const FH = 92;
const FOX = 42;
const FOY = 82;
const WALK_FRAMES = 8;
const ACT_FRAMES = 8;
const IDLE_FRAMES = 6;
const MAX_CACHE_PIXELS = 12_000_000;

const frameCache = new Map<string, HTMLCanvasElement>();
let cachedPixels = 0;
const lookKeys = new WeakMap<HumanLook, string>();

function lookKey(look: HumanLook): string {
  let k = lookKeys.get(look);
  if (!k) {
    k = JSON.stringify(look);
    lookKeys.set(look, k);
  }
  return k;
}

/**
 * 게임 화면용으로 캐릭터를 그립니다 (같은 자세는 미리 그린 그림을 재사용).
 * dpr 은 화면 배율 (선명하게 그리기 위해).
 */
export function drawChibiFast(ctx: CanvasRenderingContext2D, look: HumanLook, pose: ChibiPose, dpr: number): void {
  const ghost = pose.ghost === true;
  const front = pose.dir === 1 || pose.dir === 2;
  // 자세를 몇 단계로 나눕니다
  let anim: string;
  const q: ChibiPose = { dir: front ? 1 : 0, walk: null, act: null, time: 1000, blink: false, ghost };
  if (pose.act !== null && !ghost) {
    const f = Math.min(ACT_FRAMES - 1, Math.floor(pose.act * ACT_FRAMES));
    const kind = pose.actKind === 'cast' ? 'cast' : 'attack';
    anim = `${kind[0]}${f}`;
    q.act = (f + 0.5) / ACT_FRAMES;
    q.actKind = kind;
  } else if (pose.walk !== null && !ghost) {
    const f = Math.min(WALK_FRAMES - 1, Math.floor(pose.walk * WALK_FRAMES));
    const step = pose.step ?? 0;
    anim = `w${step}${f}`;
    q.walk = (f + 0.5) / WALK_FRAMES;
    q.step = step;
  } else {
    const ph = Math.floor(((pose.time % IDLE_MS) / IDLE_MS) * IDLE_FRAMES);
    const blink = !ghost && pose.time % 3600 < 120;
    anim = `i${ph}${blink ? 'b' : ''}`;
    q.time = ((ph + 0.5) / IDLE_FRAMES) * IDLE_MS;
    q.blink = blink;
  }
  const scale = Math.max(1, Math.min(3, Math.round(dpr * 2) / 2));
  const key = `${lookKey(look)}|${front ? 'F' : 'B'}|${ghost ? 'g' : ''}|${anim}|${scale}`;
  let frame = frameCache.get(key);
  if (frame) {
    // 최근에 쓴 것을 뒤로 (오래 안 쓴 것부터 지움)
    frameCache.delete(key);
    frameCache.set(key, frame);
  } else {
    frame = document.createElement('canvas');
    frame.width = Math.ceil(FW * scale);
    frame.height = Math.ceil(FH * scale);
    const fc = frame.getContext('2d')!;
    fc.setTransform(scale, 0, 0, scale, FOX * scale, FOY * scale);
    drawBody(makeDraw(fc, look, q, false));
    frameCache.set(key, frame);
    cachedPixels += frame.width * frame.height;
    for (const [k, c] of frameCache) {
      if (cachedPixels <= MAX_CACHE_PIXELS) break;
      frameCache.delete(k);
      cachedPixels -= c.width * c.height;
    }
  }
  ctx.save();
  drawShadow(ctx, ghost);
  if (pose.dir === 2 || pose.dir === 3) ctx.scale(-1, 1);
  ctx.drawImage(frame, -FOX, -FOY - (ghost ? ghostFloat(pose.time) : 0), FW, FH);
  ctx.restore();
}

function drawFront(d: D): void {
  const b = bodyPoints(d);
  const look = d.look;
  const gear = headGearOf(d);
  if (d.outfit === 'warrior') drawCape(d, b, false);
  drawScarfTail(d);
  drawGearBehind(d, b, gear);
  drawHairBackFront(d, b);
  // 먼 팔(방패 쪽)은 몸 뒤. 들어 올린 팔은 몸통 앞에 보이게
  const raised = d.rig.armOther > 1.2;
  const farArm = () => {
    if (look.shield) drawShield(d, look.shield, b.handO[0] + 1.6, b.handO[1] - 3.4);
    drawArm(d, b.shO, b.handO, false);
    drawHand(d, b.handO, false);
    if (d.rig.cast > 0) castGlow(d, b.handO);
  };
  if (!raised) farArm();
  drawLegs(d);
  drawTorso(d, b);
  if (raised) farArm();
  // 가까운 팔 + 무기
  drawArm(d, b.shW, b.handW, true);
  drawWeapon(d, look.weapon, look.weaponColor ?? '#c0c0c0', b.handW[0], b.handW[1], d.rig.weapon);
  drawHand(d, b.handW, true);
  if (d.rig.cast > 0) castGlow(d, b.handW);
  drawNeck(d, b);
  headPath(d.ctx, b.hx, b.hy, true);
  paint(d, d.pal.skin);
  if (!coversHair(gear) || gear === 'bandana') drawEar(d, b);
  drawFace(d, b);
  if (gear === 'hood') {
    // 두건 안쪽으로 보이는 앞머리만
    d.ctx.save();
    d.ctx.beginPath();
    d.ctx.rect(b.hx - 16, b.hy - 11, 32, 20);
    d.ctx.clip();
    drawHairFront(d, b);
    d.ctx.restore();
  } else if (gear === 'horned') {
    // 투구 아래로 옆머리만
  } else {
    drawHairFront(d, b);
  }
  drawGearFront(d, b, gear);
}

function drawBack(d: D): void {
  const b = bodyPoints(d);
  const look = d.look;
  const gear = headGearOf(d);
  // 무기 든 팔(먼 쪽)은 몸 뒤
  drawWeapon(d, look.weapon, look.weaponColor ?? '#c0c0c0', b.handW[0], b.handW[1], d.rig.weapon);
  drawArm(d, b.shW, b.handW, false);
  drawHand(d, b.handW, false);
  if (d.rig.cast > 0) castGlow(d, b.handW);
  drawLegs(d);
  drawTorso(d, b);
  if (d.outfit === 'warrior') drawCape(d, b, true);
  drawScarfTail(d);
  drawArm(d, b.shO, b.handO, true);
  drawHand(d, b.handO, true);
  if (look.shield) drawShield(d, look.shield, b.handO[0] - 1.0, b.handO[1] - 3.6);
  if (d.rig.cast > 0) castGlow(d, b.handO);
  drawNeck(d, b);
  headPath(d.ctx, b.hx, b.hy, false);
  paint(d, d.pal.skin);
  if (gear === 'hood' || gear === 'veil') drawGearBackView(d, b, gear);
  else {
    drawHairBackView(d, b);
    drawGearBackView(d, b, gear);
  }
}

function castGlow(d: D, hand: Pt): void {
  const { ctx } = d;
  const k = d.rig.cast;
  const c = d.look.weaponColor ?? '#9fd3ff';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(c, 0.35 * k);
  ellipse(ctx, hand[0], hand[1], 5 * k, 5 * k);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.5 * k);
  ellipse(ctx, hand[0], hand[1], 2.2 * k, 2.2 * k);
  ctx.fill();
  ctx.restore();
}

// ───────────────────────── 일러스트 (UI 용) ─────────────────────────

const portraitCache = new Map<string, string>();

/**
 * 큰 일러스트를 data URL 로 만듭니다 (캐시).
 * w x h 크기, scale 배 확대. 캐릭터는 아래쪽 가운데에 섭니다.
 */
export function portraitUrl(look: HumanLook, w = 180, h = 220, scale = 3.4, dir: Dir = 1): string {
  const key = `${JSON.stringify(look)}|${w}|${h}|${scale}|${dir}`;
  let url = portraitCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.translate(w / 2, h - 10);
    ctx.scale(scale, scale);
    drawChibi(ctx, look, { dir, walk: null, act: null, time: 0, showcase: true }, { detail: 'portrait' });
    url = c.toDataURL();
    if (portraitCache.size > 120) portraitCache.clear();
    portraitCache.set(key, url);
  }
  return url;
}
