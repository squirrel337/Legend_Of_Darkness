// 치비(SD) 스타일 사람 캐릭터 그리기.
// 큰 머리와 큰 눈, 굵은 외곽선, 직업별 의상을 모두 코드로 그립니다 (이미지 파일 없음).
// 초상화(아래 패널·캐릭터 창·NPC 대화)와 접속 화면에만 씁니다. 맵 위의 사람은 classic.ts 의 도트 캐릭터입니다.
// 좌표는 발 위치(0,0) 기준, 위쪽이 음수 y. 1 단위 = 1 CSS 픽셀이고 초상화는 확대해서 그립니다.
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
  /** 야수화 상태 (사나운 기운과 빛나는 눈) */
  beast?: boolean;
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
    case 'summoner':
      under = tone(main, -0.5);
      boot = tone(main, -0.45);
      break;
    case 'bard':
      under = mix(tone(main, -0.55), '#3a2a22', 0.4);
      boot = '#6a4426';
      break;
    case 'beastkin':
      under = mix(tone(main, -0.45), '#3a3a40', 0.35);
      boot = tone(main, -0.4);
      break;
    case 'archer':
      under = mix(tone(main, -0.45), '#5a4632', 0.5);
      boot = '#6b4a2a';
      break;
    case 'gladiator':
      // 맨다리 + 정강이 보호대
      under = '#ffe2cc';
      boot = mix(main, '#c4c8d0', 0.55);
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
  /** 보조 손 무기 기울기 (쌍검, 짐승 발톱) */
  weapon2: number;
  /** 활시위를 당긴 정도 (0~1) */
  pull: number;
  /** 화살을 메겼는지 */
  nock: boolean;
  /** 마도서의 빛 (0~1) */
  glow: number;
  /** 야수화 */
  beast: boolean;
  /** 손을 굽혀 활시위를 당기는 중 (팔꿈치가 뒤로) */
  bent: boolean;
}

const REST_WEAPON: Partial<Record<IconShape, number>> = {
  sword: -0.28,
  axe: -0.22,
  dagger: 1.1,
  mace: -0.18,
  stick: -0.22,
  staff: 0.02,
  claw: 1.45,
  bow: 0.08,
  lute: 1.4,
  book: 0.12,
  gauntlet: 2.05,
  dualsword: -0.28,
};

/** 보조 손에도 같은 무기를 드는지 (쌍검, 짐승 발톱). 방패가 있으면 방패가 우선 */
function isDual(look: HumanLook): boolean {
  return (look.weapon === 'dualsword' || look.weapon === 'gauntlet') && !look.shield;
}

/** 휘두르기 한 번 (공격 진행 a: 0~1) */
function swing(a: number, armRest: number, wRest: number, up: number, hit: number, wUp: number, wHit: number): { arm: number; w: number; lean: number } {
  if (a < 0.3) {
    const k = easeOut(a / 0.3);
    return { arm: lerp(armRest, up, k), w: lerp(wRest, wUp, k), lean: 0 };
  }
  if (a < 0.55) {
    const k = easeIn((a - 0.3) / 0.25);
    return { arm: lerp(up, hit, k), w: lerp(wUp, wHit, k), lean: k * 1.4 };
  }
  const k = easeInOut((a - 0.55) / 0.45);
  return { arm: lerp(hit, armRest, k), w: lerp(wHit, wRest, k), lean: (1 - k) * 1.4 };
}

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
  const dual = isDual(look);
  const r: Rig = {
    front,
    bob: 0,
    float: 0,
    headBob: 0,
    lean: 0,
    legNear: { dx: 0, lift: 0 },
    legFar: { dx: 0, lift: 0 },
    armWeapon:
      wpn === 'staff' ? 0.3 : wpn === 'claw' || wpn === 'dagger' ? 0.25 : wpn === 'gauntlet' ? 0.12 : wpn === 'book' ? 0.9 : -0.08,
    armOther: dual ? (wpn === 'gauntlet' ? 0.1 : 0.12) : -0.06,
    weapon: restW,
    mouth: 'smile',
    blink: !p.showcase && t % 3600 < 120,
    sway: Math.sin(((t % IDLE_MS) / IDLE_MS) * Math.PI * 2) * 0.8,
    cast: 0,
    weapon2: wpn === 'dualsword' ? 0.55 : restW,
    pull: 0,
    nock: false,
    glow: wpn === 'book' ? 0.35 : 0,
    beast: p.beast === true && !p.ghost,
    bent: false,
  };
  if (p.showcase) {
    // 무기는 몸 옆으로 비스듬히, 방패가 없으면 다른 손은 반갑게 듦
    r.armWeapon = wpn === 'staff' ? 0.2 : -0.42;
    r.weapon = wpn === 'staff' ? -0.08 : wpn === 'claw' ? 0.9 : wpn === 'dagger' ? 0.7 : -0.62;
    r.armOther = look.shield ? 0.75 : 2.05;
    r.headBob = 0.4;
    if (wpn === 'gauntlet') {
      // 발톱을 세우고 덤벼들 자세
      r.armWeapon = 1.05;
      r.weapon = 0.55;
      if (dual) {
        r.armOther = 1.55;
        r.weapon2 = 0.35;
      }
    } else if (wpn === 'dualsword' && dual) {
      // 다른 손의 검은 어깨높이에서 조금만 기울임 (칼끝이 가장 작은 초상화 액자 ±25 안에 들어오게)
      r.armOther = 1.2;
      r.weapon2 = 0.45;
    } else if (wpn === 'book') {
      r.armWeapon = 1.2;
      r.weapon = 0.1;
      r.glow = 1;
    }
  }
  const armRestW = r.armWeapon;
  const armRestO = r.armOther;
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
    // 악기·마도서를 든 손은 조금만 흔듦
    const k = wpn === 'lute' ? 0 : wpn === 'book' ? 0.2 : 0.5;
    r.armWeapon -= s * k;
    r.armOther += s * (wpn === 'lute' ? 0 : 0.5);
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
      r.weapon = lerp(r.weapon, wpn === 'staff' ? -0.05 : wpn === 'lute' ? 0.4 : 0.15, k);
      r.weapon2 = lerp(r.weapon2, 0.2, k);
      r.bob += k * 1.2;
      r.cast = k;
      if (wpn === 'book') r.glow = Math.max(r.glow, k);
    } else if (wpn === 'lute') {
      // 줄을 튕기며 몸을 앞으로
      const k = Math.sin(a * Math.PI);
      r.armWeapon = armRestW + Math.sin(a * Math.PI * 4) * 0.35;
      r.lean = k * 1.2;
      r.bob += k * 0.8;
    } else if (wpn === 'book') {
      // 마도서를 앞으로 내밀며 빛을 터뜨림
      const k = a < 0.35 ? easeOut(a / 0.35) : 1 - easeInOut((a - 0.35) / 0.65);
      r.armWeapon = lerp(r.armWeapon, 1.75, k);
      r.armOther = lerp(r.armOther, 0.9, k);
      r.weapon = lerp(r.weapon, -0.2, k);
      r.glow = Math.max(r.glow, k);
      r.lean = k * 1.2;
    } else if (wpn !== 'bow') {
      const thrust = wpn === 'claw' || wpn === 'dagger';
      const rake = wpn === 'gauntlet';
      // 발톱은 뒤로 젖혔다가 앞으로 할퀴고, 찌르기 무기는 짧게 내지름
      const up = rake ? -1.3 : thrust ? -0.5 : -2.5;
      const hit = rake ? 1.75 : thrust ? 1.65 : 1.35;
      const wUp = rake ? -0.4 : thrust ? restW - 0.3 : -1.2;
      const wHit = rake ? 2.2 : thrust ? restW + 0.25 : 2.35;
      const m = swing(a, r.armWeapon, restW, up, hit, wUp, wHit);
      r.armWeapon = m.arm;
      r.weapon = m.w;
      r.lean = m.lean;
      if (dual) {
        // 다른 손이 조금 늦게 한 번 더
        const a2 = a - 0.18;
        const wRest2 = wpn === 'dualsword' ? 0.55 : restW;
        if (a2 > 0) {
          const m2 = swing(Math.min(1, a2 / 0.82), r.armOther, wRest2, up, hit, wUp, wHit);
          r.armOther = m2.arm;
          r.weapon2 = m2.w;
          r.lean = Math.max(r.lean, m2.lean);
        }
      }
    }
  }
  if (r.beast) r.mouth = 'open';
  if (wpn === 'lute' && !(p.act !== null && p.actKind === 'cast' && !p.ghost)) {
    // 몸 앞에 비스듬히 안음: 오른손은 몸통을 튕기고 왼손은 목을 잡음
    if (front) {
      r.armOther = 1.0;
      if (p.act === null || p.ghost) r.armWeapon = 0.6;
      r.weapon = 1.4;
    } else {
      r.armOther = 0.45;
      if (p.act === null || p.ghost) r.armWeapon = 0.55;
      r.weapon = -1.55;
    }
  }
  if (wpn === 'bow' && !(p.act !== null && p.actKind === 'cast' && !p.ghost)) {
    // 활은 앞쪽(먼) 손에 들고, 가까운 손으로 시위를 당깁니다.
    // 앞모습의 먼 손 = armOther, 뒷모습의 먼 손 = armWeapon
    let bowA = 0.35;
    let drawA = front ? r.armWeapon : r.armOther;
    let tilt = 0.08;
    let pull = 0;
    let nock = false;
    if (p.showcase) {
      bowA = 1.42;
      drawA = 1.45;
      tilt = 0;
      pull = 0.8;
      nock = true;
    } else if (p.walk !== null && !p.ghost) {
      bowA += Math.sin((p.walk + (p.step ?? 0)) * Math.PI) * 0.3;
    }
    if (p.act !== null && !p.ghost) {
      const a = p.act;
      if (a < 0.22) {
        const k = easeOut(a / 0.22);
        bowA = lerp(bowA, 1.45, k);
        drawA = lerp(drawA, 1.45, k);
        tilt = lerp(tilt, 0, k);
        nock = a > 0.1;
      } else if (a < 0.58) {
        bowA = 1.45;
        drawA = 1.45;
        tilt = 0;
        nock = true;
        pull = easeOut(Math.min(1, (a - 0.22) / 0.26));
        r.lean = -0.4 * pull;
      } else {
        // 쏜 뒤: 활이 살짝 튀고 손이 돌아감
        const k = easeInOut((a - 0.58) / 0.42);
        bowA = lerp(1.6, 0.35, k);
        drawA = lerp(1.0, front ? armRestW : armRestO, k);
        tilt = lerp(-0.15, 0.08, k);
      }
    }
    if (front) {
      r.armOther = bowA;
      r.armWeapon = drawA;
    } else {
      r.armWeapon = bowA;
      r.armOther = drawA;
    }
    r.weapon = tilt;
    r.pull = pull;
    r.nock = nock;
    r.bent = nock && pull > 0;
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
  /** 장식 애니메이션용 시간 (밀리초) */
  time: number;
}

/** 고정 색도 유령이면 흐리게 */
function gc(d: D, c: string): string {
  return d.ghost ? mix(c, '#d6e4ff', 0.72) : c;
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
  const beast = d.rig.beast;
  if (beast) {
    // 야수화: 눈에서 빛이 번짐
    ctx.fillStyle = 'rgba(255,170,40,0.45)';
    ellipse(ctx, cx, cy, w * 0.95, h * 0.8);
    ctx.fill();
  }
  if (d.hi) {
    // 흰자
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, cx + outer * 0.25, cy + 0.15, w * 0.62, h * 0.5);
    ctx.fill();
  }
  // 홍채
  ctx.fillStyle = beast ? '#ffb428' : pal.eye;
  ellipse(ctx, cx, cy, w * 0.5, h * 0.5);
  ctx.fill();
  // 위쪽 그늘
  ctx.save();
  ellipse(ctx, cx, cy, w * 0.5, h * 0.5);
  ctx.clip();
  ctx.fillStyle = beast ? '#c8501a' : pal.eyeSh;
  ellipse(ctx, cx, cy - h * 0.34, w * 0.62, h * 0.42);
  ctx.fill();
  // 아래 반사
  ctx.fillStyle = beast ? '#fff2a0' : pal.eyeHi;
  ellipse(ctx, cx, cy + h * 0.36, w * 0.36, h * 0.18);
  ctx.fill();
  ctx.restore();
  // 동공 (야수화면 세로로 가늘게)
  ctx.fillStyle = '#1c0e0a';
  ellipse(ctx, cx + 0.15, cy + h * 0.02, beast ? w * 0.09 : w * 0.2, beast ? h * 0.34 : h * 0.24);
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
  if (d.rig.beast) {
    // 치켜 올라간 눈썹
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = lw * 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - 6.6, ey - eh * 0.95);
    ctx.lineTo(hx - 1.6, ey - eh * 0.62);
    ctx.moveTo(hx + 3.6, ey - eh * 0.62);
    ctx.lineTo(hx + 8.0, ey - eh * 0.92);
    ctx.stroke();
  }
  if (d.hi) {
    if (!d.rig.beast) {
      // 눈썹
      ctx.strokeStyle = tone(pal.hair, -0.2);
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(hx - 6.0, ey - eh * 0.82);
      ctx.quadraticCurveTo(hx - 3.6, ey - eh * 0.98, hx - 1.6, ey - eh * 0.8);
      ctx.moveTo(hx + 3.8, ey - eh * 0.8);
      ctx.quadraticCurveTo(hx + 5.6, ey - eh * 0.95, hx + 7.4, ey - eh * 0.78);
      ctx.stroke();
    }
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

type HeadGear =
  | 'none'
  | 'horned'
  | 'halfhelm'
  | 'circlet'
  | 'hood'
  | 'veil'
  | 'bandana'
  | 'headband'
  | 'browguard'
  // 새 직업
  | 'ribbon'
  | 'tallcap'
  | 'beret'
  | 'feather'
  | 'featherclip'
  | 'crest'
  | 'plumehelm';

function headGearOf(d: D): HeadGear {
  const o = d.outfit;
  if (d.look.helmet) {
    if (o === 'wizard' || o === 'priest' || o === 'summoner') return 'circlet';
    if (o === 'rogue' || o === 'archer') return 'halfhelm';
    if (o === 'monk' || o === 'beastkin') return 'browguard';
    if (o === 'bard') return 'beret';
    if (o === 'gladiator') return 'plumehelm';
    return 'horned';
  }
  if (o === 'wizard') return d.female ? 'none' : 'hood';
  if (o === 'priest') return d.female ? 'veil' : 'circlet';
  if (o === 'rogue') return d.female ? 'headband' : 'bandana';
  if (o === 'monk') return 'headband';
  if (o === 'summoner') return d.female ? 'ribbon' : 'tallcap';
  if (o === 'bard') return 'beret';
  if (o === 'archer') return d.female ? 'featherclip' : 'feather';
  if (o === 'gladiator') return 'crest';
  return 'none';
}

/** 머리카락을 가리는 모자인지 */
const coversHair = (g: HeadGear) => g === 'horned' || g === 'hood' || g === 'halfhelm' || g === 'bandana' || g === 'plumehelm';

/** 붉은 투구 깃털 색 (장식 색이 살짝 섞임) */
const plumeColor = (d: D) => mix(gc(d, '#d8332a'), d.pal.trim, 0.2);

/** 바드 망토 색 */
const bardCape = (d: D) => mix(d.pal.main, gc(d, '#7a1c34'), 0.55);
/** 바드 모자 색 (투구를 쓰면 투구 색) */
const bardHat = (d: D) => (d.look.helmet ? d.pal.helm : bardCape(d));

/** 깃털 하나 (뿌리 → 끝) */
function feather(d: D, x1: number, y1: number, x2: number, y2: number, w: number, fill: string, tip: string): void {
  const { ctx } = d;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx + nx * w * 1.3, my + ny * w * 1.3, x2, y2);
  ctx.quadraticCurveTo(mx - nx * w * 0.9, my - ny * w * 0.9, x1, y1);
  ctx.closePath();
  paint(d, fill, d.lw * 0.8);
  // 끝 무늬
  ctx.save();
  ctx.clip();
  ctx.fillStyle = tip;
  ellipse(ctx, x2 - (dx / len) * 1.6, y2 - (dy / len) * 1.6, w * 1.6, w * 1.6);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = rgba(d.pal.line, 0.55);
  ctx.lineWidth = d.lw * 0.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx + nx * w * 0.2, my + ny * w * 0.2, x2 - (dx / len) * 0.8, y2 - (dy / len) * 0.8);
  ctx.stroke();
}

/** 모자에 꽂은 큰 깃털 하나 (뒤로 휘어 넘어감, 초상화 액자 위쪽에 닿지 않게 낮게). dir: -1 이면 화면 왼쪽으로 */
function bigPlume(d: D, x: number, y: number, sw: number, dir: -1 | 1): void {
  const { ctx, pal } = d;
  const s = dir;
  const tipX = x + s * 19 + sw * 1.2;
  const tipY = y - 7.6;
  ctx.beginPath();
  ctx.moveTo(x + s * 1.4, y + 0.6);
  ctx.bezierCurveTo(x - s * 0.6, y - 7.8, x + s * 9.6 + sw * 0.6, y - 14.0, tipX, tipY);
  ctx.bezierCurveTo(x + s * 12.4 + sw, y - 7.2, x + s * 6.0, y - 4.4, x - s * 1.4, y + 0.6);
  ctx.closePath();
  paint(d, gc(d, '#f8f3e6'));
  ctx.save();
  ctx.clip();
  // 끝으로 갈수록 장식 색
  ctx.fillStyle = mix(pal.trim, gc(d, '#ffffff'), 0.15);
  ellipse(ctx, tipX - s * 1.4, tipY - 1.0, 6.4, 5.6);
  ctx.fill();
  // 깃 결
  ctx.strokeStyle = rgba(pal.line, 0.35);
  ctx.lineWidth = d.lw * 0.5;
  ctx.beginPath();
  for (let i = 1; i <= 5; i++) {
    const k = i / 6;
    const px = x + s * 9.6 * k + sw * 0.6 * k;
    const py = y - 10.2 * Math.sin(k * Math.PI * 0.6);
    ctx.moveTo(px, py);
    ctx.lineTo(px + s * 3.2, py - 2.7);
  }
  ctx.stroke();
  ctx.restore();
  // 깃대
  ctx.strokeStyle = rgba(pal.line, 0.7);
  ctx.lineWidth = d.lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + s * 2.4, y - 6.4, x + s * 9.6 + sw * 0.6, y - 9.9, tipX - s * 1.0, tipY + 0.4);
  ctx.stroke();
}

/** 리본 끈 하나 (위 → 아래로 늘어짐, 끝이 갈라짐) */
function ribbonTail(d: D, x: number, y: number, ex: number, ey: number, w: number, fill: string): void {
  const { ctx } = d;
  const mx = (x + ex) / 2 + (ey - y) * 0.12;
  const my = (y + ey) / 2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(mx - w / 2, my, ex - w * 0.6, ey);
  ctx.lineTo(ex, ey - w * 0.7);
  ctx.lineTo(ex + w * 0.6, ey);
  ctx.quadraticCurveTo(mx + w / 2, my, x + w / 2, y);
  ctx.closePath();
  paint(d, fill, d.lw * 0.8);
}

/** 술 장식 (끈 → 구슬 → 술) */
function tassel(d: D, x: number, y: number, len: number, color: string): void {
  const { ctx, pal } = d;
  ctx.strokeStyle = pal.goldSh;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + len * 0.35);
  ctx.stroke();
  ellipse(ctx, x, y + len * 0.4, 1.0, 1.0);
  paint(d, pal.gold, d.lw * 0.5);
  ctx.beginPath();
  ctx.moveTo(x - 0.7, y + len * 0.5);
  ctx.lineTo(x + 0.7, y + len * 0.5);
  ctx.lineTo(x + 1.3, y + len);
  ctx.lineTo(x - 1.3, y + len);
  ctx.closePath();
  paint(d, color, d.lw * 0.6);
}

/** 투구 깃 장식 (머리 위를 앞뒤로 가로지르는 붉은 깃털). front=false 면 뒷모습 */
function drawPlume(d: D, b: Body, front: boolean): void {
  const { ctx, pal, lw } = d;
  const { hx, hy } = b;
  const c = plumeColor(d);
  const sw = d.rig.sway * 0.4;
  ctx.beginPath();
  if (front) {
    // 이마 위에서 정수리를 지나 뒤로 넘어가는 반달 모양 솔 (옆에서 본 모습)
    ctx.moveTo(hx + 7.0, hy - 12.4);
    ctx.quadraticCurveTo(hx + 1.0, hy - 17.2, hx - 9.0, hy - 13.2);
    ctx.quadraticCurveTo(hx - 13.0 + sw, hy - 12.4, hx - 18.6 + sw * 1.4, hy - 12.8);
    const tips: Pt[] = [
      [-17.6, -16.4],
      [-16.2, -19.6],
      [-12.6, -23.2],
      [-8.0, -25.4],
      [-3.0, -26.6],
      [2.0, -25.8],
      [6.2, -23.4],
      [9.2, -19.8],
      [10.2, -15.6],
    ];
    let i = 0;
    for (const [x, y] of tips) {
      const s = sw * (1.3 - i / tips.length);
      // 솔 끝은 조금 낮게 (가장 작은 초상화 액자 위쪽에 닿지 않게)
      ctx.lineTo(hx + x + s + 0.8, hy + y * 0.86 - 0.6);
      ctx.lineTo(hx + x * 0.94 + s, hy + y * 0.8 + 0.6);
      i++;
    }
  } else {
    // 뒤에서: 가운데 능선에서 양옆으로 퍼짐
    ctx.moveTo(hx - 2.4, hy - 8.0);
    ctx.quadraticCurveTo(hx - 3.4, hy - 13.6, hx - 0.4, hy - 16.6);
    ctx.quadraticCurveTo(hx + 2.6, hy - 13.6, hx + 1.6, hy - 8.0);
    ctx.lineTo(hx + 4.8 + sw, hy - 13.2);
    ctx.lineTo(hx + 3.4 + sw, hy - 18.4);
    ctx.lineTo(hx + 1.6 + sw, hy - 22.0);
    ctx.lineTo(hx - 0.4 + sw, hy - 26.4);
    ctx.lineTo(hx - 2.6 + sw, hy - 22.0);
    ctx.lineTo(hx - 4.4 + sw, hy - 18.4);
    ctx.lineTo(hx - 5.8 + sw, hy - 13.2);
  }
  ctx.closePath();
  paint(d, c);
  // 결
  ctx.strokeStyle = tone(c, -0.3);
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  if (front) {
    // 솔 결 (뿌리에서 바깥으로)
    for (const [x, y] of [
      [-13.0, -16.8],
      [-7.6, -19.8],
      [-2.0, -20.8],
      [3.6, -19.6],
    ] as Pt[]) {
      ctx.moveTo(hx + x * 0.55, hy - 15.4);
      ctx.lineTo(hx + x + sw * 0.6, hy + y);
    }
  } else {
    ctx.moveTo(hx - 0.4, hy - 14.0);
    ctx.lineTo(hx - 0.4 + sw, hy - 23.0);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.35);
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  if (front) {
    ctx.moveTo(hx + 5.2, hy - 19.0);
    ctx.quadraticCurveTo(hx + 0.8, hy - 22.4, hx - 5.0, hy - 21.6);
  } else {
    ctx.moveTo(hx - 2.0, hy - 15.4);
    ctx.lineTo(hx - 2.2 + sw, hy - 21.0);
  }
  ctx.stroke();
  // 깃을 꽂는 금속 받침
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  if (front) {
    ctx.moveTo(hx + 7.0, hy - 12.4);
    ctx.quadraticCurveTo(hx + 1.0, hy - 17.0, hx - 8.6, hy - 13.4);
  } else {
    ctx.moveTo(hx - 0.4, hy - 16.0);
    ctx.lineTo(hx - 0.4, hy - 8.4);
  }
  ctx.stroke();
  ctx.strokeStyle = d.look.helmet ? pal.helmHi : pal.gold;
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

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
  } else if (g === 'ribbon') {
    // 머리 장식에서 늘어진 긴 리본 두 가닥 (머리 뒤)
    ribbonTail(d, hx + 11.0, hy - 6.0, hx + 16.4 + sw * 1.2, hy + 19.0, 2.6, pal.trimSh);
    ribbonTail(d, hx + 12.6, hy - 5.0, hx + 19.6 + sw * 1.5, hy + 14.0, 2.4, pal.trim);
  } else if (g === 'tallcap') {
    // 관 뒤로 늘어진 끈
    ribbonTail(d, hx - 8.6, hy - 11.0, hx - 15.6 + sw * 1.4, hy + 12.0, 2.2, pal.trimSh);
    ribbonTail(d, hx - 7.0, hy - 11.4, hx - 12.0 + sw * 1.1, hy + 15.0, 2.2, pal.trim);
  } else if (g === 'feather') {
    // 머리띠 매듭에 꽂은 깃털
    const kx = hx - 12.2;
    const ky = hy - 7.4;
    feather(d, kx + 1.0, ky, kx - 9.0 + sw, ky - 12.6, 2.2, gc(d, '#f4efe2'), pal.trim);
    feather(d, kx + 0.6, ky + 0.6, kx - 10.6 + sw, ky - 7.2, 1.8, gc(d, '#e8dcc4'), pal.trimSh);
    ctx.beginPath();
    ctx.moveTo(kx + 0.6, ky + 0.6);
    ctx.quadraticCurveTo(kx - 3.4 + sw, ky + 4.2, kx - 3.8 + sw * 1.3, ky + 8.0);
    ctx.lineTo(kx - 1.6 + sw, ky + 7.2);
    ctx.quadraticCurveTo(kx - 1.0, ky + 3.6, kx + 1.6, ky + 1.6);
    ctx.closePath();
    paint(d, pal.trim);
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
    case 'ribbon': {
      // 옆머리에 꽂은 큰 리본 매듭 + 비녀 + 방울
      const bx = hx + 9.4;
      const by = hy - 10.4;
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(bx - 6.4, by - 3.6);
      ctx.lineTo(bx + 5.2, by + 3.0);
      ctx.stroke();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 1.0;
      ctx.stroke();
      for (const [ox, oy, rot] of [
        [-3.4, -2.2, -0.5],
        [3.0, -2.6, 0.6],
      ] as const) {
        ellipse(ctx, bx + ox, by + oy, 3.6, 2.2, rot);
        paint(d, pal.trim);
        ctx.fillStyle = pal.trimSh;
        ellipse(ctx, bx + ox * 0.55, by + oy * 0.55, 1.4, 1.0, rot);
        ctx.fill();
      }
      ellipse(ctx, bx, by - 0.6, 1.8, 1.8);
      paint(d, pal.gold, lw * 0.8);
      ctx.fillStyle = rgba('#ffffff', 0.8);
      ellipse(ctx, bx - 0.5, by - 1.1, 0.6, 0.5);
      ctx.fill();
      tassel(d, bx + 1.2, by + 1.2, 6.0, pal.trim);
      break;
    }
    case 'tallcap': {
      // 둥근 관 + 앞에 높이 솟은 장식판 (보석) + 양옆 구슬 술.
      // 장식판 끝이 가장 작은 초상화 액자(NPC 대화창) 위쪽에 닿지 않을 높이까지만
      const top = hy - 19.6;
      ctx.beginPath();
      ctx.moveTo(hx - 9.4, hy - 9.6);
      ctx.bezierCurveTo(hx - 10.0, hy - 14, hx - 10.4, top + 4, hx - 7.6, top + 0.8);
      ctx.bezierCurveTo(hx - 3.0, top - 3.4, hx + 6.0, top - 3.4, hx + 10.2, top + 0.8);
      ctx.bezierCurveTo(hx + 12.4, top + 4, hx + 11.8, hy - 14, hx + 11.2, hy - 9.4);
      ctx.quadraticCurveTo(hx + 1.0, hy - 13.0, hx - 9.4, hy - 9.6);
      ctx.closePath();
      paint(d, pal.main);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pal.mainSh;
      ctx.fillRect(hx + 7.0, top - 4, 8, 22);
      ctx.fillStyle = pal.mainHi;
      ellipse(ctx, hx - 5.0, top + 3.8, 1.5, 3.4, 0.3);
      ctx.fill();
      ctx.restore();
      for (const sx of [-9.8, 11.8]) tassel(d, hx + sx, hy - 11.2, 7.0, pal.trim);
      // 아랫단 띠
      ctx.beginPath();
      ctx.moveTo(hx - 9.6, hy - 9.4);
      ctx.quadraticCurveTo(hx + 1.0, hy - 12.8, hx + 11.3, hy - 9.2);
      ctx.lineTo(hx + 11.2, hy - 12.4);
      ctx.quadraticCurveTo(hx + 1.0, hy - 16.0, hx - 9.6, hy - 12.6);
      ctx.closePath();
      paint(d, pal.trim, lw * 0.8);
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(hx - 9.4, hy - 11.0);
      ctx.quadraticCurveTo(hx + 1.0, hy - 14.4, hx + 11.2, hy - 10.8);
      ctx.stroke();
      // 앞 장식판: 뾰족한 아치 + 금테 + 보석
      const px = hx + 2.4;
      const tip = hy - 22.8;
      ctx.beginPath();
      ctx.moveTo(px - 5.0, hy - 12.6);
      ctx.bezierCurveTo(px - 5.6, hy - 17.2, px - 2.6, hy - 20.2, px, tip);
      ctx.bezierCurveTo(px + 2.6, hy - 20.2, px + 5.6, hy - 17.2, px + 5.0, hy - 12.6);
      ctx.quadraticCurveTo(px, hy - 14.0, px - 5.0, hy - 12.6);
      ctx.closePath();
      paint(d, pal.gold);
      ctx.beginPath();
      ctx.moveTo(px - 3.4, hy - 13.8);
      ctx.bezierCurveTo(px - 3.8, hy - 17.0, px - 1.8, hy - 19.0, px, hy - 20.8);
      ctx.bezierCurveTo(px + 1.8, hy - 19.0, px + 3.8, hy - 17.0, px + 3.4, hy - 13.8);
      ctx.quadraticCurveTo(px, hy - 15.0, px - 3.4, hy - 13.8);
      ctx.closePath();
      paint(d, pal.trim, lw * 0.6);
      ellipse(ctx, px, hy - 17.0, 1.6, 1.9);
      paint(d, gc(d, '#fff3c0'), lw * 0.6);
      ctx.fillStyle = rgba('#ffffff', 0.85);
      ellipse(ctx, px - 0.5, hy - 17.6, 0.5, 0.6);
      ctx.fill();
      ellipse(ctx, px, tip, 1.0, 1.0);
      paint(d, pal.gold, lw * 0.6);
      break;
    }
    case 'beret': {
      // 넓은 깃털 베레모 (바라보는 쪽으로 처짐)
      const c = bardHat(d);
      const sw = d.rig.sway;
      bigPlume(d, hx - 6.4, hy - 13.4, sw, -1);
      ellipse(ctx, hx + 3.6, hy - 14.6, 16.6, 7.4, 0.2);
      paint(d, c);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = tone(c, 0.2);
      ellipse(ctx, hx - 1.0, hy - 18.6, 10.4, 3.8, 0.16);
      ctx.fill();
      ctx.fillStyle = tone(c, -0.28);
      ellipse(ctx, hx + 6.4, hy - 8.6, 15.0, 4.0, 0.2);
      ctx.fill();
      ctx.restore();
      // 머리띠 부분
      ctx.beginPath();
      ctx.moveTo(hx - 11.6, hy - 9.2);
      ctx.quadraticCurveTo(hx + 1.0, hy - 13.6, hx + 13.4, hy - 9.6);
      ctx.lineTo(hx + 13.2, hy - 7.2);
      ctx.quadraticCurveTo(hx + 1.0, hy - 11.0, hx - 11.4, hy - 6.8);
      ctx.closePath();
      paint(d, tone(c, -0.35), lw * 0.8);
      // 깃털을 고정한 금 브로치
      star(ctx, hx - 6.4, hy - 11.6, 2.2, 1.0, 5);
      paint(d, pal.gold, lw * 0.6);
      // 꼭지
      ellipse(ctx, hx + 1.4, hy - 20.4, 1.4, 1.0);
      paint(d, tone(c, -0.2), lw * 0.6);
      break;
    }
    case 'feather': {
      // 가는 머리띠
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 6.8);
      ctx.quadraticCurveTo(hx + 0.6, hy - 11.0, hx + 13.8, hy - 6.8);
      ctx.lineTo(hx + 13.7, hy - 5.0);
      ctx.quadraticCurveTo(hx + 0.6, hy - 9.0, hx - 12.9, hy - 5.0);
      ctx.closePath();
      paint(d, pal.trim, lw * 0.8);
      ctx.fillStyle = pal.gold;
      ellipse(ctx, hx + 0.8, hy - 8.0, 1.1, 0.9);
      ctx.fill();
      break;
    }
    case 'featherclip': {
      // 머리 뒤쪽에 꽂은 깃털 두 개와 구슬
      const sw = d.rig.sway;
      const cx = hx - 10.6;
      const cy = hy - 8.0;
      feather(d, cx, cy, cx - 6.4 + sw, cy - 13.6, 2.2, gc(d, '#f4efe2'), pal.trim);
      feather(d, cx + 0.4, cy + 0.4, cx - 10.4 + sw, cy - 8.0, 2.0, mix(pal.trim, '#ffffff', 0.35), pal.trimSh);
      ellipse(ctx, cx + 0.4, cy + 0.4, 2.0, 1.6, -0.4);
      paint(d, pal.leather, lw * 0.8);
      ctx.strokeStyle = pal.goldSh;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + 0.6, cy + 1.4);
      ctx.lineTo(cx + 0.2 + sw * 0.3, cy + 6.0);
      ctx.stroke();
      ellipse(ctx, cx + 0.2 + sw * 0.3, cy + 4.4, 0.9, 0.9);
      paint(d, pal.trim, lw * 0.5);
      ellipse(ctx, cx + 0.2 + sw * 0.3, cy + 6.6, 1.1, 1.1);
      paint(d, pal.gold, lw * 0.5);
      break;
    }
    case 'crest': {
      // 깃 장식을 단 금속 이마띠
      drawPlume(d, b, true);
      ctx.beginPath();
      ctx.moveTo(hx - 13.0, hy - 6.6);
      ctx.quadraticCurveTo(hx + 0.6, hy - 11.4, hx + 13.8, hy - 6.6);
      ctx.lineTo(hx + 13.6, hy - 3.8);
      ctx.quadraticCurveTo(hx + 0.6, hy - 8.4, hx - 12.8, hy - 3.8);
      ctx.closePath();
      paint(d, pal.gold);
      ctx.strokeStyle = pal.goldSh;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(hx - 12.4, hy - 5.0);
      ctx.quadraticCurveTo(hx + 0.6, hy - 9.6, hx + 13.2, hy - 5.0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx + 0.6, hy - 11.2);
      ctx.lineTo(hx + 3.2, hy - 7.6);
      ctx.lineTo(hx + 0.6, hy - 4.6);
      ctx.lineTo(hx - 2.0, hy - 7.6);
      ctx.closePath();
      paint(d, pal.gold, lw * 0.8);
      ellipse(ctx, hx + 0.6, hy - 7.8, 1.0, 1.2);
      paint(d, pal.trim, lw * 0.5);
      break;
    }
    case 'plumehelm': {
      // 붉은 깃 장식 반투구
      drawPlume(d, b, true);
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 0.8);
      ctx.bezierCurveTo(hx - 14.6, hy - 9, hx - 8.6, hy - 15.2, hx + 0.4, hy - 15.2);
      ctx.bezierCurveTo(hx + 9.8, hy - 15.2, hx + 15.4, hy - 9, hx + 14.4, hy - 1.0);
      ctx.quadraticCurveTo(hx + 0.6, hy - 6.6, hx - 13.6, hy - 0.8);
      ctx.closePath();
      paint(d, pal.helm);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pal.helmSh;
      ctx.fillRect(hx + 8.0, hy - 16, 8, 16);
      ctx.restore();
      ctx.strokeStyle = pal.helmHi;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hx - 1, hy - 4, 9, Math.PI * 1.15, Math.PI * 1.45);
      ctx.stroke();
      // 이마 테두리
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(hx - 12.8, hy - 2.6);
      ctx.quadraticCurveTo(hx + 0.6, hy - 8.0, hx + 13.8, hy - 2.8);
      ctx.stroke();
      // 깃 받침 (투구 위 능선)
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(hx + 7.0, hy - 12.2);
      ctx.quadraticCurveTo(hx + 1.0, hy - 16.6, hx - 8.6, hy - 13.2);
      ctx.stroke();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 1.2;
      ctx.stroke();
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
    case 'ribbon': {
      const sw = d.rig.sway;
      const bx = hx + 8.4;
      const by = hy - 9.6;
      ribbonTail(d, bx - 0.6, by + 1.0, bx - 2.0 + sw * 1.2, by + 26.0, 2.6, pal.trimSh);
      ribbonTail(d, bx + 0.8, by + 1.0, bx + 3.4 + sw * 1.4, by + 22.0, 2.4, pal.trim);
      for (const [ox, oy, rot] of [
        [-3.2, -2.0, -0.5],
        [3.2, -2.2, 0.5],
      ] as const) {
        ellipse(ctx, bx + ox, by + oy, 3.4, 2.1, rot);
        paint(d, pal.trim);
      }
      ellipse(ctx, bx, by - 0.6, 1.7, 1.7);
      paint(d, pal.gold, d.lw * 0.8);
      break;
    }
    case 'tallcap': {
      const sw = d.rig.sway;
      const top = hy - 22.4;
      // 앞 장식판의 뒷면 (관 위로 뾰족하게)
      ctx.beginPath();
      ctx.moveTo(hx - 4.4, top + 2);
      ctx.quadraticCurveTo(hx - 2.0, top - 3, hx - 0.4, hy - 27.0);
      ctx.quadraticCurveTo(hx + 1.2, top - 4, hx + 3.6, top + 2);
      ctx.closePath();
      paint(d, pal.goldSh);
      ribbonTail(d, hx - 3.0, hy - 10.0, hx - 4.6 + sw * 1.2, hy + 15.0, 2.4, pal.trimSh);
      ribbonTail(d, hx + 2.2, hy - 10.0, hx + 1.8 + sw * 1.3, hy + 12.0, 2.4, pal.trim);
      ctx.beginPath();
      ctx.moveTo(hx - 10.6, hy - 9.4);
      ctx.bezierCurveTo(hx - 11.4, hy - 14, hx - 11.6, top + 4, hx - 8.8, top + 0.8);
      ctx.bezierCurveTo(hx - 4.4, top - 3.4, hx + 3.6, top - 3.4, hx + 8.0, top + 0.8);
      ctx.bezierCurveTo(hx + 10.8, top + 4, hx + 10.6, hy - 14, hx + 9.8, hy - 9.4);
      ctx.quadraticCurveTo(hx - 0.4, hy - 6.4, hx - 10.6, hy - 9.4);
      ctx.closePath();
      paint(d, pal.main);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pal.mainSh;
      ctx.fillRect(hx - 15, top - 4, 7, 22);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(hx - 10.8, hy - 9.4);
      ctx.quadraticCurveTo(hx - 0.4, hy - 6.4, hx + 10.0, hy - 9.4);
      ctx.lineTo(hx + 10.0, hy - 12.4);
      ctx.quadraticCurveTo(hx - 0.4, hy - 9.6, hx - 10.8, hy - 12.4);
      ctx.closePath();
      paint(d, pal.trim, d.lw * 0.8);
      for (const sx of [-11.0, 10.2]) tassel(d, hx + sx, hy - 11.0, 7.0, pal.trim);
      break;
    }
    case 'beret': {
      const c = bardHat(d);
      const sw = d.rig.sway;
      bigPlume(d, hx - 7.0, hy - 12.8, sw, -1);
      ellipse(ctx, hx + 1.4, hy - 13.8, 16.2, 7.2, 0.08);
      paint(d, c);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = tone(c, 0.18);
      ellipse(ctx, hx - 2.4, hy - 16.8, 9.0, 3.4, -0.06);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(hx - 13.2, hy - 8.4);
      ctx.quadraticCurveTo(hx - 0.4, hy - 5.6, hx + 12.4, hy - 8.4);
      ctx.lineTo(hx + 12.4, hy - 10.8);
      ctx.quadraticCurveTo(hx - 0.4, hy - 8.0, hx - 13.2, hy - 10.8);
      ctx.closePath();
      paint(d, tone(c, -0.35), d.lw * 0.8);
      star(ctx, hx - 7.0, hy - 10.8, 2.2, 1.0, 5);
      paint(d, pal.gold, d.lw * 0.6);
      break;
    }
    case 'feather': {
      const sw = d.rig.sway;
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 5.4);
      ctx.quadraticCurveTo(hx - 0.4, hy - 2.6, hx + 12.8, hy - 5.4);
      ctx.lineTo(hx + 12.8, hy - 3.6);
      ctx.quadraticCurveTo(hx - 0.4, hy - 0.8, hx - 13.6, hy - 3.6);
      ctx.closePath();
      paint(d, pal.trim, d.lw * 0.8);
      feather(d, hx - 1.0, hy - 2.6, hx - 9.0 + sw, hy - 18.0, 2.2, gc(d, '#f4efe2'), pal.trim);
      ctx.beginPath();
      ctx.moveTo(hx - 1.4, hy - 2.0);
      ctx.quadraticCurveTo(hx - 3.0 + sw, hy + 4, hx - 4.4 + sw * 1.4, hy + 8);
      ctx.lineTo(hx - 2.0 + sw, hy + 7.6);
      ctx.quadraticCurveTo(hx - 0.6, hy + 3, hx + 0.6, hy - 2.0);
      ctx.closePath();
      paint(d, pal.trimSh);
      break;
    }
    case 'featherclip': {
      const sw = d.rig.sway;
      const cx = hx - 9.4;
      const cy = hy - 6.4;
      feather(d, cx, cy, cx - 5.6 + sw, cy - 13.6, 2.2, gc(d, '#f4efe2'), pal.trim);
      feather(d, cx + 0.4, cy + 0.4, cx - 9.4 + sw, cy - 8.0, 2.0, mix(pal.trim, '#ffffff', 0.35), pal.trimSh);
      ellipse(ctx, cx + 0.4, cy + 0.4, 2.0, 1.6, -0.4);
      paint(d, pal.leather, d.lw * 0.8);
      break;
    }
    case 'crest': {
      ctx.beginPath();
      ctx.moveTo(hx - 13.6, hy - 5.6);
      ctx.quadraticCurveTo(hx - 0.4, hy - 2.6, hx + 12.8, hy - 5.6);
      ctx.lineTo(hx + 12.8, hy - 2.8);
      ctx.quadraticCurveTo(hx - 0.4, hy + 0.2, hx - 13.6, hy - 2.8);
      ctx.closePath();
      paint(d, pal.gold);
      drawPlume(d, b, false);
      break;
    }
    case 'plumehelm':
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
      drawPlume(d, b, false);
      break;
    default:
      break;
  }
}

/** 수인의 짐승 귀 (머리 모양과 상관없이 정수리 위에 보임) */
function drawBeastEars(d: D, b: Body, front: boolean): void {
  const { ctx, pal, lw } = d;
  const { hx, hy } = b;
  const inner = mix(pal.hair, gc(d, '#ffc4c4'), 0.6);
  const sides: [number, number][] = front
    ? [
        [-1, 1],
        [1, 0.86],
      ]
    : [
        [-1, 1],
        [1, 1],
      ];
  const cx = front ? hx : hx - 0.4;
  for (const [s, wk] of sides) {
    const bx = cx + s * 7.6 + (front && s > 0 ? 0.6 : 0);
    const by = hy - 10.2;
    const tipX = cx + s * 11.0;
    const tipY = hy - 21.4;
    const w = 4.2 * wk;
    ctx.beginPath();
    ctx.moveTo(bx - w, by + 1.2);
    ctx.quadraticCurveTo(bx - w * 0.6 + s * 0.6, tipY + 6, tipX, tipY);
    ctx.quadraticCurveTo(bx + w * 0.9 + s * 1.2, tipY + 5, bx + w, by + 1.0);
    ctx.closePath();
    paint(d, pal.hair);
    if (front) {
      // 귀 안쪽
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.5, by - 0.2);
      ctx.quadraticCurveTo(bx - w * 0.3 + s * 0.6, tipY + 7, tipX - s * 0.6, tipY + 2.6);
      ctx.quadraticCurveTo(bx + w * 0.5 + s * 1.0, tipY + 6, bx + w * 0.5, by - 0.4);
      ctx.closePath();
      ctx.fillStyle = inner;
      ctx.fill();
      // 귀털
      ctx.strokeStyle = pal.hairHi;
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.2, by - 0.6);
      ctx.lineTo(bx + s * 0.6, by - 4.2);
      ctx.moveTo(bx + w * 0.3, by - 0.6);
      ctx.lineTo(bx + s * 1.2, by - 3.4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = pal.hairSh;
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + s * 1.2, tipY + 7, tipX - s * 0.4, tipY + 1.8);
      ctx.stroke();
    }
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
    case 'dualsword': {
      // 짧고 넓은 투기장 검 (양손에 하나씩)
      const blade = mix(metal, glow, 0.35);
      ctx.beginPath();
      ctx.rect(-0.8, -1.0, 1.6, 4.4);
      paint(d, pal.leather, lw * 0.8);
      ellipse(ctx, 0, 4.0, 1.5, 1.3);
      paint(d, pal.gold, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(-1.7, -2.4);
      ctx.lineTo(-2.1, -11.6);
      ctx.quadraticCurveTo(-2.2, -16.6, 0, -19.8);
      ctx.quadraticCurveTo(2.2, -16.6, 2.1, -11.6);
      ctx.lineTo(1.7, -2.4);
      ctx.closePath();
      paint(d, blade);
      ctx.strokeStyle = rgba('#ffffff', 0.8);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-1.0, -4);
      ctx.lineTo(-1.2, -14.6);
      ctx.stroke();
      ctx.strokeStyle = tone(blade, -0.3);
      ctx.beginPath();
      ctx.moveTo(0.4, -4);
      ctx.lineTo(0.4, -15.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3.6, -2.0);
      ctx.quadraticCurveTo(0, -3.6, 3.6, -2.0);
      ctx.lineTo(3.2, -1.0);
      ctx.quadraticCurveTo(0, -2.2, -3.2, -1.0);
      ctx.closePath();
      paint(d, pal.gold, lw * 0.8);
      break;
    }
    case 'gauntlet': {
      // 손을 덮는 짐승 발톱 장갑: 털 소매 + 큰 갈고리 발톱 셋
      const blade = mix(mix(metal, '#fff6e0', 0.3), glow, 0.3);
      const fur = mix(pal.main, gc(d, '#efe2c8'), 0.5);
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 4.0 : 3.0;
        const px = Math.cos(a) * r;
        const py = 3.0 + Math.sin(a) * r * 0.6;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      paint(d, fur, lw * 0.8);
      ellipse(ctx, 0, -0.2, 3.5, 3.3);
      paint(d, mix(gc(d, '#5a3a24'), glow, 0.25));
      ctx.fillStyle = rgba('#ffffff', 0.25);
      ellipse(ctx, -1.2, -1.2, 1.4, 1.0, -0.4);
      ctx.fill();
      for (const ox of [-2.2, 0, 2.2]) {
        ctx.beginPath();
        ctx.moveTo(ox - 1.0, -2.4);
        ctx.quadraticCurveTo(ox - 1.0, -7.4, ox + 2.2, -10.4 + Math.abs(ox) * 0.5);
        ctx.quadraticCurveTo(ox + 0.4, -6.6, ox + 1.0, -2.4);
        ctx.closePath();
        paint(d, blade, lw * 0.8);
      }
      ellipse(ctx, 0, -0.4, 1.1, 1.1);
      paint(d, glow, lw * 0.5);
      break;
    }
    case 'bow': {
      // 활대가 앞(+x)으로 휜 활. 시위는 당기지 않았을 때만 여기서 그림
      const wood = mix(gc(d, '#8a5a2e'), glow, 0.22);
      ctx.beginPath();
      ctx.moveTo(0.2, -14.2);
      ctx.quadraticCurveTo(1.6, -13.0, 2.0, -11.2);
      ctx.quadraticCurveTo(4.8, -5.8, 1.4, -1.8);
      ctx.lineTo(1.4, 1.8);
      ctx.quadraticCurveTo(4.8, 5.8, 2.0, 11.2);
      ctx.quadraticCurveTo(1.6, 13.0, 0.2, 14.2);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 2.0 + lw * 2;
      ctx.stroke();
      ctx.strokeStyle = wood;
      ctx.lineWidth = 2.0;
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(2.6, -10.4);
      ctx.quadraticCurveTo(4.2, -6.0, 2.2, -2.6);
      ctx.stroke();
      if (!d.rig.nock) {
        ctx.strokeStyle = gc(d, '#f2ead6');
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0.2, -14.2);
        ctx.lineTo(0.2, 14.2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.roundRect(-0.2, -2.6, 2.6, 5.2, 0.8);
      paint(d, pal.leather, lw * 0.8);
      for (const y of [-14.2, 14.2]) {
        ellipse(ctx, 0.4, y, 1.1, 1.1);
        paint(d, glow, lw * 0.5);
      }
      break;
    }
    case 'lute': {
      // 배 모양 몸통 + 목 + 뒤로 꺾인 줄감개. 손(원점)이 울림통 위에 놓임
      // 조금 크게 그리되 외곽선 굵기는 그대로
      ctx.scale(1.2, 1.2);
      const dl: D = { ...d, lw: lw / 1.2 };
      const wood = gc(dl, '#b8783e');
      const woodSh = gc(dl, '#7a4a24');
      if (d.rig.front) {
        ctx.save();
        ctx.translate(0, -16.0);
        ctx.rotate(-0.55);
        ctx.beginPath();
        ctx.roundRect(-1.3, -4.6, 2.6, 5.0, 0.8);
        paint(dl, woodSh, dl.lw * 0.8);
        ctx.fillStyle = gc(dl, '#f2e6c8');
        for (const y of [-3.6, -1.8, 0]) {
          ellipse(ctx, -1.7, y, 0.6, 0.5);
          ctx.fill();
          ellipse(ctx, 1.7, y, 0.6, 0.5);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.beginPath();
      ctx.rect(-1.1, -16.2, 2.2, 11.0);
      paint(dl, gc(dl, '#5a3418'), dl.lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(0, -6.6);
      ctx.bezierCurveTo(4.2, -6.0, 6.0, -1.2, 5.6, 2.6);
      ctx.bezierCurveTo(5.2, 6.8, 2.4, 8.6, 0, 8.6);
      ctx.bezierCurveTo(-2.4, 8.6, -5.2, 6.8, -5.6, 2.6);
      ctx.bezierCurveTo(-6.0, -1.2, -4.2, -6.0, 0, -6.6);
      ctx.closePath();
      paint(dl, d.rig.front ? gc(dl, '#e2b070') : wood);
      ctx.save();
      ctx.clip();
      if (d.rig.front) {
        ctx.strokeStyle = wood;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = gc(dl, '#3a2010');
        ellipse(ctx, 0, -0.8, 2.0, 2.0);
        ctx.fill();
        ctx.strokeStyle = glow;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, -0.8, 2.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = woodSh;
        ctx.fillRect(-2.4, 4.4, 4.8, 1.1);
      } else {
        // 뒷면: 나무 판을 이어 붙인 둥근 등
        ctx.strokeStyle = woodSh;
        ctx.lineWidth = 0.7;
        for (const x of [-3.4, -1.2, 1.2, 3.4]) {
          ctx.beginPath();
          ctx.moveTo(x * 0.4, -6.2);
          ctx.quadraticCurveTo(x * 1.25, 1.2, x * 0.3, 8.4);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (d.rig.front) {
        ctx.strokeStyle = gc(dl, '#fbf4e2');
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        for (const x of [-0.7, 0, 0.7]) {
          ctx.moveTo(x, 4.8);
          ctx.lineTo(x * 0.7, -15.8);
        }
        ctx.stroke();
      }
      // 목에 묶은 리본
      ellipse(ctx, -1.6, -7.4, 1.6, 1.0, -0.5);
      paint(dl, pal.trim, dl.lw * 0.6);
      ellipse(ctx, 1.6, -7.4, 1.6, 1.0, 0.5);
      paint(dl, pal.trim, dl.lw * 0.6);
      break;
    }
    case 'book': {
      // 펼친 마도서: 표지 위로 책장, 그 위에 떠오르는 마법진
      const gray = isGrayish(color);
      const magic = gray ? gc(d, '#ffcf6a') : glow;
      const cover = mix(gc(d, '#5a2438'), gray ? pal.trim : glow, 0.3);
      ctx.beginPath();
      ctx.moveTo(0, -0.4);
      ctx.lineTo(-7.0, -2.6);
      ctx.lineTo(-6.6, 3.8);
      ctx.lineTo(0, 5.8);
      ctx.lineTo(6.6, 3.8);
      ctx.lineTo(7.0, -2.6);
      ctx.closePath();
      paint(d, cover);
      ctx.fillStyle = pal.gold;
      for (const x of [-6.0, 6.0]) {
        ctx.beginPath();
        ctx.arc(x, 3.4, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0.2);
        ctx.quadraticCurveTo(s * 3.2, -2.2, s * 6.1, -1.7);
        ctx.lineTo(s * 5.8, 3.0);
        ctx.quadraticCurveTo(s * 3.0, 2.6, 0, 4.6);
        ctx.closePath();
        paint(d, gc(d, '#f4ead2'), lw * 0.7);
        ctx.strokeStyle = rgba(gc(d, '#9a7a5a'), 0.8);
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        for (const k of [0, 1, 2]) {
          ctx.moveTo(s * 1.4, 0.8 + k * 1.1);
          ctx.lineTo(s * 4.8, -0.4 + k * 1.1);
        }
        ctx.stroke();
      }
      // 책갈피 끈
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0.4, 4.6);
      ctx.quadraticCurveTo(1.6, 6.8, 1.0, 8.6);
      ctx.stroke();
      const k = d.rig.glow;
      if (k > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, -3.4, 0.5, 0, -3.4, 6 + k * 5);
        g.addColorStop(0, rgba(magic, 0.75 * k));
        g.addColorStop(1, rgba(magic, 0));
        ctx.fillStyle = g;
        ellipse(ctx, 0, -3.4, 6 + k * 5, 6 + k * 5);
        ctx.fill();
        ctx.strokeStyle = rgba(magic, 0.9 * k);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(0, -5.6 - k * 1.5, 4.0 + k * 1.2, 1.5 + k * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        star(ctx, 0, -5.6 - k * 1.5, 1.8 + k, 0.7, 4);
        ctx.fillStyle = rgba('#ffffff', 0.8 * k);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** 활의 양 끝 (세계 좌표) */
function bowTips(grip: Pt, angle: number): [Pt, Pt] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (x: number, y: number): Pt => [grip[0] + x * c - y * s, grip[1] + x * s + y * c];
  return [at(0.2, -14.2), at(0.2, 14.2)];
}

/** 당긴 시위와 메긴 화살 (손보다 먼저, 팔보다 나중에 그림) */
function drawBowString(d: D, grip: Pt, angle: number, hand: Pt): void {
  const { ctx, pal, lw } = d;
  const r = d.rig;
  if (!r.nock) return;
  const [t1, t2] = bowTips(grip, angle);
  const mid: Pt = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2];
  const p: Pt = [lerp(mid[0], hand[0], r.pull), lerp(mid[1], hand[1], r.pull)];
  ctx.strokeStyle = gc(d, '#f2ead6');
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(t1[0], t1[1]);
  ctx.lineTo(p[0], p[1]);
  ctx.lineTo(t2[0], t2[1]);
  ctx.stroke();
  // 화살: 시위에서 활 앞으로
  const dx = grip[0] - p[0];
  const dy = grip[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const end: Pt = [grip[0] + ux * 5.5, grip[1] + uy * 5.5];
  tube(d, p[0], p[1], end[0], end[1], 1.0, gc(d, '#d8b07a'));
  ctx.beginPath();
  ctx.moveTo(end[0] + ux * 3.0, end[1] + uy * 3.0);
  ctx.lineTo(end[0] - uy * 1.6, end[1] + ux * 1.6);
  ctx.lineTo(end[0] + uy * 1.6, end[1] - ux * 1.6);
  ctx.closePath();
  paint(d, gc(d, '#e6ecf2'), lw * 0.7);
  // 깃
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(p[0] + ux * 0.6, p[1] + uy * 0.6);
    ctx.lineTo(p[0] + ux * 3.6 - uy * s * 1.8, p[1] + uy * 3.6 + ux * s * 1.8);
    ctx.lineTo(p[0] + ux * 4.2, p[1] + uy * 4.2);
    ctx.closePath();
    paint(d, pal.trim, lw * 0.5);
  }
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

/** 바드 셔츠 색 */
const shirtColor = (d: D) => gc(d, '#f3ead8');
/** 수인 털 색 (털 깃, 털 허리감개 장식) */
const furColor = (d: D) => mix(d.pal.main, gc(d, '#f2e4cc'), 0.55);
/** 소환사 안쪽 겹옷 색 */
const innerColor = (d: D) => mix(gc(d, '#f6eedc'), d.pal.trim, 0.12);

function sleeveColor(d: D): string {
  switch (d.outfit) {
    case 'warrior':
      return d.pal.under;
    case 'monk':
      return d.female ? d.pal.main : d.pal.skin;
    case 'rogue':
      return d.pal.mainSh;
    case 'bard':
      return shirtColor(d);
    case 'beastkin':
    case 'gladiator':
      return d.pal.skin;
    default:
      return d.pal.main;
  }
}

/** 어깨 → 손 사이의 한 점 (k: 0~1) */
const along = (sh: Pt, hand: Pt, k: number): Pt => [sh[0] + (hand[0] - sh[0]) * k, sh[1] + (hand[1] - sh[1]) * k];

/** 팔 위에 감은 띠 (팔토시, 붕대) */
function wraps(d: D, sh: Pt, hand: Pt, from: number, w: number, fill: string, lines: string, n: number): void {
  const a = along(sh, hand, from);
  tube(d, a[0], a[1], hand[0], hand[1], w, fill);
  const { ctx } = d;
  const ex = hand[0] - sh[0];
  const ey = hand[1] - sh[1];
  const len = Math.hypot(ex, ey) || 1;
  const nx = -ey / len;
  const ny = ex / len;
  ctx.strokeStyle = lines;
  ctx.lineWidth = d.lw * 0.6;
  ctx.beginPath();
  for (let i = 1; i <= n; i++) {
    const p = along(sh, hand, from + ((1 - from) * i) / (n + 1));
    ctx.moveTo(p[0] - nx * w * 0.5, p[1] - ny * w * 0.5 - 0.3);
    ctx.lineTo(p[0] + nx * w * 0.5, p[1] + ny * w * 0.5 + 0.3);
  }
  ctx.stroke();
}

/** 팔 하나 (소매 + 손). 무기는 따로 */
function drawArm(d: D, sh: Pt, hand: Pt, near: boolean): void {
  const { pal } = d;
  const o = d.outfit;
  const sc = sleeveColor(d);
  if (o === 'wizard' || o === 'priest' || o === 'summoner') {
    const wide = o === 'summoner';
    const w2 = wide ? 4.6 : 3.4;
    bell(d, sh[0], sh[1], hand[0], hand[1] - 0.5, wide ? 2.4 : 2.2, w2, near ? sc : pal.mainSh);
    // 소매 끝 장식
    const ex = hand[0] - sh[0];
    const ey = hand[1] - sh[1];
    const len = Math.hypot(ex, ey) || 1;
    const cw = w2 - 0.2;
    const line = (off: number) => {
      d.ctx.beginPath();
      d.ctx.moveTo(hand[0] - (ey / len) * cw - (ex / len) * off, hand[1] - 0.5 + (ex / len) * cw - (ey / len) * off);
      d.ctx.lineTo(hand[0] + (ey / len) * cw - (ex / len) * off, hand[1] - 0.5 - (ex / len) * cw - (ey / len) * off);
      d.ctx.stroke();
    };
    if (wide) {
      // 넓은 소매: 겹친 안감 + 장식 띠
      d.ctx.strokeStyle = pal.trim;
      d.ctx.lineWidth = 2.2;
      line(1.4);
      d.ctx.strokeStyle = innerColor(d);
      d.ctx.lineWidth = 0.9;
      line(0.3);
    } else {
      d.ctx.strokeStyle = pal.trim;
      d.ctx.lineWidth = 1.2;
      line(0.8);
    }
  } else if (o === 'bard') {
    // 부푼 소매 (트임 사이로 장식 색) + 손목 주름
    tube(d, sh[0], sh[1], hand[0], hand[1], 3.4, near ? sc : tone(sc, -0.12));
    const p = along(sh, hand, 0.32);
    const ang = Math.atan2(hand[1] - sh[1], hand[0] - sh[0]);
    ellipse(d.ctx, p[0], p[1], 4.0, 3.2, ang);
    paint(d, near ? sc : tone(sc, -0.12));
    d.ctx.save();
    d.ctx.clip();
    d.ctx.strokeStyle = near ? pal.main : pal.mainSh;
    d.ctx.lineWidth = 1.1;
    d.ctx.beginPath();
    for (const k of [-1.4, 1.2]) {
      d.ctx.moveTo(p[0] + Math.cos(ang) * 3.2 - Math.sin(ang) * k, p[1] + Math.sin(ang) * 3.2 + Math.cos(ang) * k);
      d.ctx.lineTo(p[0] - Math.cos(ang) * 3.2 - Math.sin(ang) * k, p[1] - Math.sin(ang) * 3.2 + Math.cos(ang) * k);
    }
    d.ctx.stroke();
    d.ctx.restore();
    const c = along(sh, hand, 0.84);
    ellipse(d.ctx, c[0], c[1], 2.4, 1.8, ang);
    paint(d, gc(d, '#ffffff'), d.lw * 0.8);
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
    if (o === 'beastkin') {
      // 아래팔에 감은 붕대
      wraps(d, sh, hand, 0.5, 3.8, gc(d, near ? '#efe6d2' : '#d8ccb4'), pal.trimSh, 3);
    }
    if (o === 'archer') {
      // 가죽 팔보호대
      wraps(d, sh, hand, 0.52, 3.9, near ? pal.leather : tone(pal.leather, -0.15), pal.trim, 2);
    }
    if (o === 'gladiator') {
      wraps(d, sh, hand, 0.58, 4.0, near ? pal.main : pal.mainSh, pal.gold, 2);
    }
  }
}

/** 활시위를 당기는 굽힌 팔 (팔꿈치가 뒤로 빠짐) */
function drawBentArm(d: D, sh: Pt, hand: Pt, near: boolean): void {
  const elbow: Pt = [sh[0] - 3.0, sh[1] + 1.6];
  const sc = sleeveColor(d);
  tube(d, sh[0], sh[1], elbow[0], elbow[1], 3.4, near ? sc : tone(sc, -0.12));
  drawArm(d, elbow, hand, near);
}

function drawHand(d: D, hand: Pt, near: boolean): void {
  const glove = d.outfit === 'warrior' ? d.pal.main : d.outfit === 'rogue' ? d.pal.leather : near ? d.pal.skin : d.pal.skinSh;
  ellipse(d.ctx, hand[0], hand[1], 2.3, 2.2);
  paint(d, glove);
}

function drawLegs(d: D): void {
  const { ctx, pal, rig } = d;
  const o = d.outfit;
  const robe = o === 'wizard' || o === 'priest' || o === 'summoner';
  const legs = [
    { x: rig.front ? 3.0 : -2.6, ...rig.legFar, near: false },
    { x: rig.front ? -2.6 : 3.0, ...rig.legNear, near: true },
  ];
  for (const L of legs) {
    const footX = L.x + L.dx;
    const footY = -L.lift;
    if (!robe) {
      const w = o === 'monk' ? 4.8 : o === 'beastkin' ? 4.4 : 4.0;
      tube(d, L.x, -13.6, footX, footY - 4.2, w, L.near ? pal.under : tone(pal.under, -0.12));
      if (o === 'beastkin') {
        // 정강이에 감은 붕대
        ctx.strokeStyle = gc(d, '#e6dcc6');
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const y of [-8.4, -6.6]) {
          const k = (y + 13.6) / (footY - 4.2 + 13.6);
          const x = L.x + (footX - L.x) * k;
          ctx.moveTo(x - 2.2, y + 0.5);
          ctx.lineTo(x + 2.2, y - 0.5);
        }
        ctx.stroke();
      }
    } else {
      tube(d, L.x, -8, footX, footY - 3.4, 3.4, L.near ? pal.under : pal.underSh);
    }
    // 신발
    const toe = rig.front ? 2.0 : 0.6;
    const bootTop =
      o === 'rogue'
        ? -8.2
        : o === 'warrior'
          ? -6.6
          : o === 'bard'
            ? -9.0
            : o === 'archer'
              ? -8.4
              : o === 'gladiator'
                ? -8.8
                : o === 'beastkin'
                  ? -5.4
                  : -4.4;
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
    } else if (o === 'bard' || o === 'archer') {
      // 접어 내린 목 (바드는 넓게)
      const h = o === 'bard' ? 2.6 : 1.8;
      ctx.beginPath();
      ctx.moveTo(footX - 2.9, footY + bootTop - 0.8);
      ctx.lineTo(footX + 2.9, footY + bootTop - 0.8);
      ctx.lineTo(footX + 2.5, footY + bootTop + h);
      ctx.lineTo(footX - 2.6, footY + bootTop + h);
      ctx.closePath();
      paint(d, tone(bc, 0.18), d.lw * 0.8);
      if (o === 'archer') {
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(footX - 1.4, footY - 5.6);
        ctx.lineTo(footX + 1.2, footY - 4.2);
        ctx.moveTo(footX + 1.2, footY - 5.6);
        ctx.lineTo(footX - 1.4, footY - 4.2);
        ctx.stroke();
      } else {
        ctx.fillStyle = pal.gold;
        ctx.fillRect(footX - 0.6, footY + bootTop + 0.2, 1.2, 1.2);
      }
    } else if (o === 'gladiator') {
      // 정강이 보호대: 무릎 덮개 + 가운데 능선 + 샌들 끈
      ellipse(ctx, footX, footY + bootTop - 0.4, 2.8, 1.9);
      paint(d, tone(bc, 0.12), d.lw * 0.8);
      ctx.strokeStyle = tone(bc, -0.3);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(footX + 0.2, footY + bootTop + 1.6);
      ctx.lineTo(footX + 0.2, footY - 3.0);
      ctx.stroke();
      ctx.strokeStyle = pal.leather;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(footX - 2.4, footY - 2.4);
      ctx.lineTo(footX + 2.6, footY - 1.4);
      ctx.stroke();
    } else if (o === 'beastkin') {
      // 털 장식 신발 목
      ctx.beginPath();
      ctx.moveTo(footX - 3.0, footY + bootTop + 1.2);
      for (let i = 0; i <= 6; i++) {
        const x = footX - 3.0 + i;
        ctx.lineTo(x, footY + bootTop + (i % 2 === 0 ? -1.2 : 0.6));
      }
      ctx.lineTo(footX + 3.0, footY + bootTop + 1.4);
      ctx.closePath();
      paint(d, furColor(d), d.lw * 0.8);
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
  if (o === 'wizard' || o === 'priest' || o === 'summoner') {
    const flare = o === 'wizard' ? 10.8 : o === 'summoner' ? 11.4 : 9.6;
    const robePath = (fl: number, hem: number) => {
      ctx.beginPath();
      ctx.moveTo(shL + 0.2, SH_Y + 2);
      ctx.lineTo(shR - 0.2, SH_Y + 2);
      ctx.bezierCurveTo(shR + 1.4, -16, fl - 1.0 + sw, -6, fl + sw, -1.6 + hem);
      ctx.quadraticCurveTo(fl * 0.5 + sw, -0.4 + hem, 0.6 + sw, -1.2 + hem);
      ctx.quadraticCurveTo(-fl * 0.5 + sw, -0.4 + hem, -fl + 0.6 + sw, -1.6 + hem);
      ctx.bezierCurveTo(-fl + 1.8 + sw, -6, shL - 1.4, -16, shL + 0.2, SH_Y + 2);
      ctx.closePath();
    };
    const hemUp = o === 'summoner' ? -1.8 : 0;
    if (o === 'summoner') {
      // 바깥 옷보다 조금 긴 안쪽 겹옷
      robePath(flare - 0.6, 0.6);
      paint(d, innerColor(d));
      ctx.strokeStyle = pal.trimSh;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-flare + 1.4 + sw, -1.6);
      ctx.quadraticCurveTo(0.6 + sw, -0.4, flare - 0.6 + sw, -1.6);
      ctx.stroke();
    }
    robePath(flare, hemUp);
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
    ctx.lineWidth = o === 'summoner' ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(-flare - 1, -2.9 + hemUp);
    ctx.quadraticCurveTo(0, -1.6 + hemUp, flare + 1, -2.9 + hemUp);
    ctx.stroke();
    if (o === 'summoner') {
      // 밑단 무늬 (금빛 마름모)
      ctx.fillStyle = pal.gold;
      for (let i = -4; i <= 4; i++) {
        const x = i * 2.6 + sw;
        const y = -2.5 + hemUp + Math.abs(i) * 0.12 - 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y - 0.8);
        ctx.lineTo(x + 0.7, y);
        ctx.lineTo(x, y + 0.8);
        ctx.lineTo(x - 0.7, y);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (front) {
      // 앞섶 / 성직자 앞치마 / 소환사 겹옷 트임
      if (o === 'summoner') {
        ctx.fillStyle = innerColor(d);
        ctx.beginPath();
        ctx.moveTo(0.2, -17.6);
        ctx.lineTo(3.0, -17.6);
        ctx.lineTo(5.6 + sw, 0);
        ctx.lineTo(-2.2 + sw, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0.2, -17.6);
        ctx.lineTo(-2.2 + sw, 0);
        ctx.moveTo(3.0, -17.6);
        ctx.lineTo(5.6 + sw, 0);
        ctx.stroke();
        ctx.strokeStyle = rgba(pal.trimSh, 0.7);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (const y of [-12, -8, -4]) {
          const k = (y + 17.6) / 17.6;
          ctx.moveTo(0.2 - 2.4 * k + sw * k + 1.0, y);
          ctx.lineTo(3.0 + 2.6 * k + sw * k - 1.0, y);
        }
        ctx.stroke();
      } else if (o === 'priest') {
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
  } else if (o === 'gladiator') {
    // 붉은 속옷 자락 위로 가죽 띠 치마 (프테루게스)
    ctx.beginPath();
    ctx.moveTo(-6.8, -17.8);
    ctx.lineTo(7.2, -17.8);
    ctx.lineTo(7.8 + sw, -11.4);
    ctx.quadraticCurveTo(0.6 + sw, -10.4, -7.4 + sw, -11.4);
    ctx.closePath();
    paint(d, pal.trimSh);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = -7.4 + i * 3.0;
      const x1 = x0 + 2.9;
      const bottom = -9.4 + (i === 0 || i === n - 1 ? 0.8 : 0);
      const s = sw * (0.6 + i * 0.1);
      ctx.beginPath();
      ctx.moveTo(x0, -16.6);
      ctx.lineTo(x1, -16.6);
      ctx.lineTo(x1 + s, bottom);
      ctx.quadraticCurveTo((x0 + x1) / 2 + s, bottom + 1.4, x0 + s, bottom);
      ctx.closePath();
      const far = (x0 + x1) / 2 > 2 === front;
      paint(d, i % 2 ? (far ? tone(pal.mainSh, -0.1) : pal.mainSh) : far ? pal.mainSh : pal.main);
      ctx.fillStyle = pal.gold;
      ellipse(ctx, (x0 + x1) / 2 + s, bottom - 1.2, 0.6, 0.6);
      ctx.fill();
    }
  } else if (o === 'beastkin') {
    // 바지 + 털가죽 허리감개 (들쭉날쭉한 밑단)
    ctx.beginPath();
    ctx.moveTo(-6.4, -17.4);
    ctx.lineTo(6.8, -17.4);
    ctx.lineTo(7.0, -12.0);
    ctx.lineTo(-6.6, -12.0);
    ctx.closePath();
    paint(d, pal.under);
    ctx.beginPath();
    ctx.moveTo(-7.0, -18.8);
    ctx.lineTo(7.4, -18.8);
    ctx.lineTo(8.2 + sw, -12.8);
    const teeth = 7;
    for (let i = 1; i < teeth * 2; i++) {
      const x = 8.2 - (16.6 * i) / (teeth * 2) + sw;
      ctx.lineTo(x, i % 2 ? -10.4 - (i % 4 === 1 ? 0.8 : 0) : -12.8);
    }
    ctx.lineTo(-8.4 + sw, -12.6);
    ctx.closePath();
    paint(d, pal.main);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = pal.mainSh;
    ctx.fillRect(front ? 3.6 : -9, -19, 6, 10);
    // 얼룩 무늬
    ctx.fillStyle = tone(pal.main, -0.4);
    for (const [x, y] of [
      [-4.2, -15.6],
      [1.0, -13.4],
      [5.0, -16.0],
    ] as Pt[]) {
      ellipse(ctx, x + sw * 0.5, y, 1.4, 0.7, 0.3);
      ctx.fill();
    }
    ctx.restore();
  } else if (o === 'archer' && f) {
    // 허리를 묶은 긴 웃옷 자락 (치마처럼 퍼짐) + 옆트임
    ctx.beginPath();
    ctx.moveTo(-6.2, -17.6);
    ctx.lineTo(6.8, -17.6);
    ctx.quadraticCurveTo(8.6 + sw, -13, 9.2 + sw, -10.4);
    ctx.quadraticCurveTo(5 + sw, -9.4, 0.6 + sw, -10.0);
    ctx.quadraticCurveTo(-4 + sw, -9.4, -8.6 + sw, -10.4);
    ctx.quadraticCurveTo(-8.0, -13, -6.2, -17.6);
    ctx.closePath();
    paint(d, pal.main);
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-8.2 + sw, -11.4);
    ctx.quadraticCurveTo(0.6 + sw, -10.4, 8.8 + sw, -11.4);
    ctx.stroke();
    ctx.strokeStyle = pal.mainSh;
    ctx.lineWidth = d.lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(front ? 4.6 : -3.6, -16.4);
    ctx.lineTo((front ? 5.6 : -4.6) + sw, -10.6);
    ctx.stroke();
  } else if (f && (o === 'peasant' || o === 'rogue' || o === 'bard')) {
    // 치마
    const hem = o === 'rogue' ? -10.6 : o === 'bard' ? -10.0 : -8.4;
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
    } else if (o === 'bard') {
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-8.4 + sw, hem + 0.9);
      ctx.quadraticCurveTo(0.6 + sw, hem + 1.6, 9.0 + sw, hem + 0.9);
      ctx.stroke();
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
    } else if (o === 'bard') {
      // 조끼 아랫자락: 앞이 갈라진 뾰족한 끝
      ctx.beginPath();
      ctx.moveTo(-6.8, -17.6);
      ctx.lineTo(7.2, -17.6);
      ctx.lineTo(7.8 + sw, -13.2);
      ctx.lineTo(3.6 + sw, -11.8);
      ctx.lineTo(front ? 2.0 : 0.6, -14.8);
      ctx.lineTo(0.6 + sw, -11.8);
      ctx.lineTo(-7.4 + sw, -13.0);
      ctx.closePath();
      paint(d, pal.main);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-7.0 + sw, -13.6);
      ctx.lineTo(0.8 + sw, -12.6);
      ctx.moveTo(3.4 + sw, -12.6);
      ctx.lineTo(7.4 + sw, -13.8);
      ctx.stroke();
    } else if (o === 'archer') {
      // 옆이 트인 긴 웃옷 자락 (뒤 자락 → 앞 자락)
      ctx.beginPath();
      ctx.moveTo(-6.8, -17.6);
      ctx.lineTo(1.4, -17.6);
      ctx.lineTo(1.0 + sw, -10.8);
      ctx.quadraticCurveTo(-3.4 + sw, -10.2, -7.6 + sw, -11.0);
      ctx.closePath();
      paint(d, front ? pal.mainSh : pal.main);
      ctx.beginPath();
      ctx.moveTo(0.4, -17.6);
      ctx.lineTo(7.2, -17.6);
      ctx.lineTo(8.0 + sw, -11.0);
      ctx.quadraticCurveTo(4.2 + sw, -10.2, 0.2 + sw, -10.8);
      ctx.closePath();
      paint(d, front ? pal.main : pal.mainSh);
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-7.2 + sw, -11.8);
      ctx.quadraticCurveTo(-3.4 + sw, -11.0, 0.8 + sw, -11.6);
      ctx.moveTo(0.6 + sw, -11.6);
      ctx.quadraticCurveTo(4.2 + sw, -11.0, 7.8 + sw, -11.8);
      ctx.stroke();
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
  // 맨몸(수인, 남자 검투사) / 셔츠(바드) / 옷
  const bare = o === 'beastkin' || (o === 'gladiator' && !f);
  const base = bare ? pal.skin : o === 'bard' ? shirtColor(d) : pal.main;
  paint(d, base);
  ctx.save();
  ctx.clip();
  // 그늘 (바라보는 반대쪽)
  ctx.fillStyle = bare ? pal.skinSh : o === 'bard' ? tone(base, -0.16) : pal.mainSh;
  if (front) ctx.fillRect(shR - 3.2, SH_Y - 3, 6, 12);
  else ctx.fillRect(shL - 2.8, SH_Y - 3, 6, 12);
  if (o === 'bard') {
    // 셔츠 위의 조끼 (앞은 가운데가 열림)
    ctx.fillStyle = pal.main;
    if (front) {
      ctx.fillRect(shL - 2, SH_Y - 4, 2.2 - shL, 14);
      ctx.fillRect(3.0, SH_Y - 4, shR + 2 - 3.0, 14);
    } else ctx.fillRect(shL - 2, SH_Y - 4, shR - shL + 4, 14);
    ctx.fillStyle = pal.mainSh;
    if (front) ctx.fillRect(shR - 2.8, SH_Y - 3, 6, 12);
    else ctx.fillRect(shL - 2.6, SH_Y - 3, 5, 12);
  }
  if (bare && f && o === 'beastkin') {
    // 가슴을 감은 짧은 윗옷 (허리는 드러남)
    ctx.beginPath();
    ctx.moveTo(shL - 2, SH_Y - 4);
    ctx.lineTo(shR + 2, SH_Y - 4);
    ctx.lineTo(shR + 2, -20.6);
    ctx.quadraticCurveTo(0.6, -19.4, shL - 2, -20.6);
    ctx.closePath();
    paint(d, pal.main, lw * 0.8);
    ctx.fillStyle = pal.mainSh;
    ctx.fillRect(front ? shR - 3.0 : shL - 2.6, SH_Y - 3, 5, 6);
  }
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
      case 'summoner': {
        // 겹겹이 여민 깃: 안쪽 옷 → 장식 띠
        ctx.fillStyle = innerColor(d);
        ctx.beginPath();
        ctx.moveTo(-3.0, SH_Y - 2);
        ctx.lineTo(5.4, SH_Y - 2);
        ctx.lineTo(1.4, -18.0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-3.6, SH_Y - 1.4);
        ctx.lineTo(1.4, -18.2);
        ctx.lineTo(6.0, SH_Y - 1.4);
        ctx.stroke();
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-4.8, SH_Y - 0.8);
        ctx.lineTo(1.4, -17.2);
        ctx.lineTo(7.2, SH_Y - 0.8);
        ctx.stroke();
        break;
      }
      case 'bard': {
        // 조끼 가장자리 장식과 금단추, 목의 주름 장식
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0.2, SH_Y - 1);
        ctx.lineTo(0.2, -16.4);
        ctx.moveTo(3.0, SH_Y - 1);
        ctx.lineTo(3.0, -16.4);
        ctx.stroke();
        for (const y of [-22.4, -20.0]) {
          ellipse(ctx, 3.6, y, 0.75, 0.75);
          paint(d, pal.gold, lw * 0.5);
        }
        ctx.beginPath();
        ctx.moveTo(0.0, SH_Y - 2);
        ctx.lineTo(3.4, SH_Y - 2);
        for (let i = 0; i <= 4; i++) {
          const y = SH_Y - 1 + i * 1.2;
          const w = 2.0 - i * 0.25;
          ctx.lineTo(1.7 + w + (i % 2) * 0.6, y);
          ctx.lineTo(1.7 + w * 0.3, y + 0.6);
        }
        for (let i = 4; i >= 0; i--) {
          const y = SH_Y - 1 + i * 1.2;
          const w = 2.0 - i * 0.25;
          ctx.lineTo(1.7 - w * 0.3, y + 0.6);
          ctx.lineTo(1.7 - w - (i % 2) * 0.6, y);
        }
        ctx.closePath();
        paint(d, gc(d, '#ffffff'), lw * 0.7);
        break;
      }
      case 'beastkin': {
        if (!f) {
          // 가슴·배 근육선
          ctx.strokeStyle = pal.skinSh;
          ctx.lineWidth = lw * 0.8;
          ctx.beginPath();
          ctx.moveTo(-4.4, -21.6);
          ctx.quadraticCurveTo(-1.6, -20.4, 0.8, -21.8);
          ctx.moveTo(1.6, -21.8);
          ctx.quadraticCurveTo(3.8, -20.6, 5.6, -21.4);
          ctx.moveTo(1.2, -20.2);
          ctx.lineTo(1.2, -17.2);
          ctx.stroke();
        }
        // 어깨에서 허리로 맨 가죽끈 (이빨 장식)
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-5.4, SH_Y);
        ctx.lineTo(7.4, -16.6);
        ctx.stroke();
        ctx.strokeStyle = pal.leather;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0.6, -21.4);
        ctx.quadraticCurveTo(1.6, -19.0, 0.6, -18.0);
        ctx.quadraticCurveTo(1.0, -19.4, -0.4, -20.8);
        ctx.closePath();
        paint(d, gc(d, '#f4efe2'), lw * 0.6);
        break;
      }
      case 'archer': {
        // 끈으로 여민 V자 깃 + 화살통 멜빵
        ctx.fillStyle = mix(pal.main, gc(d, '#f0e6d0'), 0.6);
        ctx.beginPath();
        ctx.moveTo(-1.2, SH_Y - 2);
        ctx.lineTo(3.6, SH_Y - 2);
        ctx.lineTo(1.2, -20.4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = pal.leather;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(0.2, SH_Y + 0.2);
        ctx.lineTo(2.4, SH_Y + 1.6);
        ctx.moveTo(2.4, SH_Y + 0.2);
        ctx.lineTo(0.2, SH_Y + 1.6);
        ctx.stroke();
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-5.6, SH_Y);
        ctx.lineTo(7.4, -16.6);
        ctx.stroke();
        ctx.strokeStyle = pal.leather;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = pal.gold;
        ctx.fillRect(0.2, -21.6, 1.6, 1.4);
        break;
      }
      case 'gladiator': {
        if (f) {
          // 가죽 흉갑: 밝은 면 + 가운데 이음선
          ctx.fillStyle = pal.mainHi;
          ellipse(ctx, -2.4, -22.4, 2.6, 2.0, -0.4);
          ctx.fill();
          ctx.strokeStyle = pal.mainSh;
          ctx.lineWidth = lw * 0.8;
          ctx.beginPath();
          ctx.moveTo(1.0, SH_Y - 1);
          ctx.lineTo(1.0, -16.6);
          ctx.moveTo(-6, -19.4);
          ctx.quadraticCurveTo(1, -18.2, 7.4, -19.4);
          ctx.stroke();
        } else {
          ctx.strokeStyle = pal.skinSh;
          ctx.lineWidth = lw * 0.8;
          ctx.beginPath();
          ctx.moveTo(1.2, -19.4);
          ctx.lineTo(1.2, -17.0);
          ctx.stroke();
        }
        // X자 가죽 멜빵 + 가운데 둥근 쇠장식
        for (const [x1, y1, x2, y2] of [
          [-5.8, SH_Y, 7.4, -16.8],
          [7.0, SH_Y, -6.0, -16.8],
        ] as const) {
          ctx.strokeStyle = pal.line;
          ctx.lineWidth = 3.0;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.strokeStyle = f ? pal.leather : pal.main;
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }
        ellipse(ctx, 0.8, -21.0, 1.9, 1.9);
        paint(d, pal.gold, lw * 0.8);
        ctx.fillStyle = rgba('#ffffff', 0.6);
        ellipse(ctx, 0.3, -21.5, 0.6, 0.5);
        ctx.fill();
        break;
      }
    }
  } else {
    // 뒷모습 장식
    switch (o) {
      case 'beastkin':
      case 'gladiator':
        if (o === 'gladiator' || !f) {
          // 등줄기
          ctx.strokeStyle = bare ? pal.skinSh : pal.mainSh;
          ctx.lineWidth = lw * 0.8;
          ctx.beginPath();
          ctx.moveTo(0.4, SH_Y + 1);
          ctx.lineTo(0.4, -17);
          ctx.stroke();
        }
        if (o === 'gladiator') {
          for (const [x1, y1, x2, y2] of [
            [-6.2, SH_Y, 7.0, -16.8],
            [7.0, SH_Y, -6.2, -16.8],
          ] as const) {
            ctx.strokeStyle = pal.line;
            ctx.lineWidth = 3.0;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.strokeStyle = f ? pal.leather : pal.main;
            ctx.lineWidth = 2.0;
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = pal.line;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(7.0, SH_Y);
          ctx.lineTo(-6.0, -16.6);
          ctx.stroke();
          ctx.strokeStyle = pal.leather;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        break;
      case 'summoner':
        // 등의 문장 (원 + 별)
        ctx.strokeStyle = pal.trim;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(0.4, -21.8, 2.6, 0, Math.PI * 2);
        ctx.stroke();
        star(ctx, 0.4, -21.8, 1.9, 0.8, 5);
        ctx.fillStyle = pal.gold;
        ctx.fill();
        break;
      default:
        ctx.strokeStyle = o === 'warrior' ? pal.mainSh : pal.trim;
        ctx.lineWidth = o === 'warrior' ? lw * 0.8 : 1.0;
        ctx.beginPath();
        ctx.moveTo(0.4, SH_Y - 1);
        ctx.lineTo(0.4, -16.6);
        ctx.stroke();
    }
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
  } else if (o === 'summoner') {
    // 넓은 띠 + 앞(뒷모습은 등)의 큰 매듭과 늘어진 술
    ctx.beginPath();
    ctx.rect(shL - 0.6, beltY - 1.8, shR - shL + 1.2, 3.8);
    paint(d, pal.trim, lw * 0.8);
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(shL - 0.4, beltY + 0.1);
    ctx.lineTo(shR + 0.4, beltY + 0.1);
    ctx.stroke();
    const kx = front ? 1.6 : 0.4;
    const ky = beltY + 0.2;
    // 늘어진 끈 두 가닥 + 술
    for (const [ox, len] of [
      [-1.0, 9.0],
      [1.4, 7.4],
    ] as const) {
      ribbonTail(d, kx + ox * 0.6, ky + 1.0, kx + ox + sw * 1.2, ky + len, 1.8, pal.trimSh);
      tassel(d, kx + ox + sw * 1.2, ky + len - 0.4, 4.0, pal.trim);
    }
    // 매듭 고리
    for (const s of [-1, 1]) {
      ellipse(ctx, kx + s * 2.6, ky - 0.4, front ? 2.8 : 3.4, 1.9, s * 0.35);
      paint(d, pal.trim, lw * 0.8);
      ctx.fillStyle = pal.trimSh;
      ellipse(ctx, kx + s * 1.6, ky - 0.2, 1.0, 0.8, s * 0.35);
      ctx.fill();
    }
    ellipse(ctx, kx, ky, 1.5, 1.6);
    paint(d, pal.gold, lw * 0.7);
    if (front) {
      // 허리에 매단 부적
      ctx.strokeStyle = pal.goldSh;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-4.6, beltY + 2.0);
      ctx.lineTo(-4.8 + sw * 0.6, beltY + 4.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-6.0 + sw * 0.6, beltY + 4.0, 2.6, 5.0);
      paint(d, gc(d, '#f6efd8'), lw * 0.6);
      ctx.strokeStyle = gc(d, '#c0392b');
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(-5.4 + sw * 0.6, beltY + 5.0);
      ctx.lineTo(-4.0 + sw * 0.6, beltY + 6.0);
      ctx.lineTo(-5.4 + sw * 0.6, beltY + 7.0);
      ctx.lineTo(-4.0 + sw * 0.6, beltY + 8.0);
      ctx.stroke();
    }
  } else if (o === 'beastkin') {
    // 꼰 밧줄 허리띠 + 이빨 장식
    ctx.beginPath();
    ctx.rect(shL - 0.4, beltY - 0.8, shR - shL + 0.8, 2.4);
    paint(d, pal.trim, lw * 0.8);
    ctx.strokeStyle = pal.trimSh;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = shL + 0.6; x < shR; x += 1.6) {
      ctx.moveTo(x, beltY - 0.6);
      ctx.lineTo(x + 1.0, beltY + 1.4);
    }
    ctx.stroke();
    if (front) {
      ctx.beginPath();
      ctx.moveTo(0.2, beltY + 1.2);
      ctx.quadraticCurveTo(0.8, beltY + 4.6, 2.8 + sw, beltY + 5.6);
      ctx.quadraticCurveTo(1.8, beltY + 3.2, 2.0, beltY + 1.2);
      ctx.closePath();
      paint(d, gc(d, '#f4efe2'), lw * 0.7);
    }
  } else if (o === 'gladiator') {
    // 넓은 가죽 띠 + 쇠 장식판
    ctx.beginPath();
    ctx.rect(shL - 0.4, beltY - 1.2, shR - shL + 0.8, 3.2);
    paint(d, pal.leather, lw * 0.8);
    ctx.fillStyle = pal.gold;
    for (const x of front ? [-4.6, -1.2, 4.6] : [-3.6, 0.4, 4.4]) {
      ctx.beginPath();
      ctx.roundRect(x - 0.9, beltY - 0.6, 1.8, 2.0, 0.4);
      ctx.fill();
    }
    if (front) {
      ctx.beginPath();
      ctx.rect(0.4, beltY - 1.4, 2.8, 3.6);
      paint(d, pal.gold, lw * 0.7);
    }
  } else if (o !== 'priest') {
    ctx.beginPath();
    ctx.rect(shL - 0.2, beltY - 0.6, shR - shL + 0.4, 2.2);
    paint(d, o === 'peasant' ? '#8a6a42' : pal.leather, lw * 0.8);
    if (front) {
      ctx.beginPath();
      ctx.rect(0.0, beltY - 1.0, 2.6, 3.0);
      paint(d, pal.gold, lw * 0.7);
    }
    if (o === 'rogue' || o === 'archer') {
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
  } else if (o === 'beastkin') {
    // 어깨를 덮는 털 깃 (들쭉날쭉한 털 끝)
    const fur = furColor(d);
    ctx.beginPath();
    ctx.moveTo(shL - 1.4, SH_Y + 1.0);
    ctx.quadraticCurveTo(shL - 0.4, SH_Y - 3.2, 0.6, SH_Y - 3.4);
    ctx.quadraticCurveTo(shR + 0.4, SH_Y - 3.2, shR + 1.6, SH_Y + 1.0);
    const n = 9;
    for (let i = 1; i < n * 2; i++) {
      const x = shR + 1.6 - ((shR - shL + 3.0) * i) / (n * 2);
      const y = SH_Y + (i % 2 ? 3.2 + ((i * 7) % 3) * 0.4 : 1.0);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    paint(d, fur);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = tone(fur, -0.18);
    ctx.fillRect(front ? shR - 2.6 : shL - 2.6, SH_Y - 4, 5, 9);
    ctx.restore();
    ctx.strokeStyle = tone(fur, 0.35);
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(-3.4, SH_Y - 1.6);
    ctx.lineTo(-2.6, SH_Y + 0.6);
    ctx.moveTo(-0.4, SH_Y - 2.0);
    ctx.lineTo(0.2, SH_Y + 0.4);
    ctx.stroke();
  }
}

/** 검투사의 큰 어깨 갑옷 (무기 든 쪽 어깨 하나). near: 앞모습(가까운 어깨) */
function drawPauldron(d: D, b: Body, near: boolean): void {
  const { ctx, pal, lw } = d;
  const s = near ? -1 : 1;
  const x = b.shW[0] + s * (near ? 2.2 : 1.2);
  const y = SH_Y + (near ? 1.0 : -0.2);
  for (let i = 2; i >= 0; i--) {
    const cx = x + s * i * 0.6;
    const cy = y + i * 2.4;
    ellipse(ctx, cx, cy, 5.8 - i * 0.5, 3.8 - i * 0.3, s * 0.36);
    paint(d, i === 0 ? pal.main : i === 1 ? pal.mainSh : tone(pal.mainSh, -0.12));
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.6, 4.6 - i * 0.5, 2.6 - i * 0.3, s * 0.32, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = pal.mainHi;
  ellipse(ctx, x - s * 1.4, y - 1.2, 1.8, 0.9, s * 0.3);
  ctx.fill();
  ellipse(ctx, x + s * 0.4, y - 0.2, 0.9, 0.9);
  paint(d, pal.gold, lw * 0.5);
}

/** 바드의 짧은 망토. 앞모습은 몸 뒤로 살짝, 뒷모습은 등을 덮음 */
function drawShortCape(d: D, b: Body, overBody: boolean): void {
  const { ctx, pal } = d;
  const sw = d.rig.sway;
  const c = bardCape(d);
  if (!overBody) {
    ctx.beginPath();
    ctx.moveTo(-5.0, SH_Y - 1.2);
    ctx.bezierCurveTo(-12.4 + sw * 0.3, -22.6, -14.0 + sw * 0.6, -17.0, -13.6 + sw, -13.2);
    ctx.quadraticCurveTo(-10.6 + sw * 0.8, -12.0, -8.4 + sw * 0.7, -14.2);
    ctx.quadraticCurveTo(-6.4 + sw * 0.5, -12.8, -4.0 + sw * 0.5, -14.0);
    ctx.lineTo(-1.0, -19);
    ctx.closePath();
    paint(d, tone(c, -0.25));
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-13.2 + sw, -14.2);
    ctx.quadraticCurveTo(-10.6 + sw * 0.8, -13.0, -8.4 + sw * 0.7, -15.2);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(-7.8, SH_Y - 0.6);
  ctx.quadraticCurveTo(b.hx, SH_Y - 2.6, 8.4, SH_Y - 0.6);
  ctx.bezierCurveTo(10.6, -21.6, 11.0 + sw * 0.6, -17.6, 10.6 + sw, -14.6);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x0 = 10.6 - (19.6 * i) / n + sw;
    const x1 = 10.6 - (19.6 * (i + 1)) / n + sw;
    ctx.quadraticCurveTo((x0 + x1) / 2, -12.4, x1, -14.6);
  }
  ctx.bezierCurveTo(-10.4 + sw * 0.6, -17.6, -10.2, -21.6, -7.8, SH_Y - 0.6);
  ctx.closePath();
  paint(d, c);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = tone(c, -0.22);
  ctx.fillRect(-14, SH_Y - 3, 6.4, 14);
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x0 = 10.6 - (19.6 * i) / n + sw;
    const x1 = 10.6 - (19.6 * (i + 1)) / n + sw;
    if (i === 0) ctx.moveTo(x0, -15.6);
    ctx.quadraticCurveTo((x0 + x1) / 2, -13.4, x1, -15.6);
  }
  ctx.stroke();
  ctx.restore();
  // 세운 깃
  ctx.beginPath();
  ctx.moveTo(-4.4, SH_Y - 1.4);
  ctx.quadraticCurveTo(b.hx, SH_Y - 3.6, 5.4, SH_Y - 1.4);
  ctx.lineTo(5.0, SH_Y + 0.6);
  ctx.quadraticCurveTo(b.hx, SH_Y - 1.2, -4.0, SH_Y + 0.6);
  ctx.closePath();
  paint(d, pal.trim, d.lw * 0.8);
}

/** 궁사의 화살통. 앞모습은 몸 뒤(어깨 너머로 깃만), 뒷모습은 등 위에 */
function drawQuiver(d: D, overBody: boolean): void {
  const { ctx, pal, lw } = d;
  const sw = d.rig.sway * 0.3;
  ctx.save();
  if (overBody) {
    ctx.translate(-3.0, -21.6);
    ctx.rotate(-0.7);
  } else {
    ctx.translate(-8.0, -25.4);
    ctx.rotate(-0.58);
  }
  // 화살 (깃이 통 위로)
  const shafts: [number, number, string][] = [
    [-1.6, -15.6, pal.trim],
    [0.2, -16.8, gc(d, '#f4efe2')],
    [1.8, -15.4, pal.trim],
  ];
  for (const [x, top, col] of shafts) {
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, -9);
    ctx.lineTo(x + sw, top + 2);
    ctx.stroke();
    ctx.strokeStyle = gc(d, '#d8b07a');
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + sw, top + 5.4);
    ctx.lineTo(x - 1.6 + sw, top + 1.6);
    ctx.lineTo(x + sw, top - 0.4);
    ctx.lineTo(x + 1.6 + sw, top + 1.6);
    ctx.closePath();
    paint(d, col, lw * 0.6);
  }
  // 통
  ctx.beginPath();
  ctx.moveTo(-3.0, -10.4);
  ctx.lineTo(3.0, -10.4);
  ctx.lineTo(2.4, 8.6);
  ctx.quadraticCurveTo(0, 10.0, -2.4, 8.6);
  ctx.closePath();
  paint(d, pal.leather);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = tone(pal.leather, -0.25);
  ctx.fillRect(1.0, -12, 3, 24);
  ctx.restore();
  for (const y of [-10.0, 6.2]) {
    ctx.beginPath();
    ctx.rect(-3.1, y - 0.6, 6.2, 1.8);
    paint(d, pal.trim, lw * 0.6);
  }
  ellipse(ctx, 0, -1.8, 1.0, 1.0);
  paint(d, pal.gold, lw * 0.5);
  ctx.restore();
}

/** 수인의 꼬리 (털이 풍성하고 끝이 밝음) */
function drawTail(d: D, overBody: boolean): void {
  const { ctx, pal, lw } = d;
  const sw = d.rig.sway;
  ctx.beginPath();
  if (!overBody) {
    // 앞모습: 엉덩이 뒤(화면 왼쪽)로 말려 올라감
    ctx.moveTo(-4.2, -17.0);
    ctx.bezierCurveTo(-12.0, -14.6, -20.6 + sw, -17.0, -18.6 + sw * 1.3, -30.6);
    ctx.bezierCurveTo(-16.6 + sw, -26.0, -14.6 + sw * 0.6, -21.6, -9.4, -19.8);
    ctx.quadraticCurveTo(-6.6, -19.6, -4.4, -19.8);
  } else {
    // 뒷모습: 가운데에서 한쪽으로 휘어 올라감
    ctx.moveTo(2.4, -17.2);
    ctx.bezierCurveTo(-0.4, -7.8, -14.0 + sw, -6.8, -16.8 + sw * 1.3, -24.4);
    ctx.bezierCurveTo(-12.0 + sw, -17.8, -6.4 + sw * 0.5, -13.6, -1.6, -18.0);
  }
  ctx.closePath();
  paint(d, pal.hair);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = mix(pal.hairHi, gc(d, '#ffffff'), 0.6);
  if (!overBody) ellipse(ctx, -18.6 + sw * 1.3, -30.0, 5.0, 4.4);
  else ellipse(ctx, -16.8 + sw * 1.3, -23.6, 5.0, 4.8);
  ctx.fill();
  ctx.fillStyle = pal.hairSh;
  if (!overBody) ellipse(ctx, -9.0, -15.6, 5.6, 2.4, -0.2);
  else ellipse(ctx, -4.0, -9.6, 5.6, 2.4, 0.4);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = pal.hairSh;
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  if (!overBody) {
    ctx.moveTo(-8.6, -17.6);
    ctx.quadraticCurveTo(-15.6 + sw, -18.6, -16.4 + sw, -24.6);
  } else {
    ctx.moveTo(-1.6, -12.4);
    ctx.quadraticCurveTo(-10.0 + sw, -10.4, -13.6 + sw, -18.6);
  }
  ctx.stroke();
}

/** 소환사 어깨 위에 떠 있는 작은 정령 */
function drawWisp(d: D, b: Body): void {
  const { ctx, pal } = d;
  const bob = Math.sin(d.time / 420) * 1.6;
  const x = b.hx + 17.2;
  const y = b.hy + 2.2 + bob;
  const c = mix(pal.trim, gc(d, '#ffd9a0'), 0.4);
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0.5, x, y, 7.5);
  g.addColorStop(0, rgba(c, 0.6));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ellipse(ctx, x, y, 7.5, 7.5);
  ctx.fill();
  // 불꽃 꼬리
  ctx.beginPath();
  ctx.moveTo(x - 2.4, y - 1.0);
  ctx.quadraticCurveTo(x - 5.6, y + 1.4 - bob * 0.3, x - 6.4, y + 4.4);
  ctx.quadraticCurveTo(x - 3.0, y + 3.4, x + 0.6, y + 2.6);
  ctx.closePath();
  ctx.fillStyle = rgba(c, 0.85);
  ctx.fill();
  ellipse(ctx, x, y, 2.9, 2.7);
  ctx.fillStyle = mix(c, gc(d, '#ffffff'), 0.65);
  ctx.fill();
  ctx.strokeStyle = rgba(tone(c, -0.3), 0.8);
  ctx.lineWidth = d.lw * 0.6;
  ctx.stroke();
  // 작은 눈
  ctx.fillStyle = pal.line;
  ellipse(ctx, x + 0.2, y - 0.2, 0.4, 0.6);
  ctx.fill();
  ellipse(ctx, x + 1.7, y - 0.2, 0.4, 0.6);
  ctx.fill();
  ctx.restore();
}

/** 야수화: 몸을 둘러싼 사나운 기운 (몸보다 먼저 그림) */
function drawBeastAura(d: D): void {
  const { ctx } = d;
  const t = d.time / 1000;
  ctx.save();
  const g = ctx.createRadialGradient(0.6, -26, 4, 0.6, -26, 32);
  g.addColorStop(0, 'rgba(255,150,50,0)');
  g.addColorStop(0.55, 'rgba(255,110,30,0.30)');
  g.addColorStop(1, 'rgba(200,40,20,0)');
  ctx.fillStyle = g;
  ellipse(ctx, 0.6, -26, 24, 32);
  ctx.fill();
  // 날름거리는 불꽃
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.34;
    const flick = 0.85 + 0.15 * Math.sin(t * 9 + i * 1.7);
    const bx = 0.6 + Math.cos(a) * 15;
    const by = -28 + Math.sin(a) * 22;
    const tx = 0.6 + Math.cos(a) * 23 * flick;
    const ty = -28 + Math.sin(a) * 30 * flick;
    const nx = -Math.sin(a) * 3.2;
    const ny = Math.cos(a) * 3.2;
    ctx.beginPath();
    ctx.moveTo(bx + nx, by + ny);
    ctx.quadraticCurveTo((bx + tx) / 2 + nx * 0.4, (by + ty) / 2 + ny * 0.4, tx, ty);
    ctx.quadraticCurveTo((bx + tx) / 2 - nx * 0.4, (by + ty) / 2 - ny * 0.4, bx - nx, by - ny);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? 'rgba(255,90,30,0.42)' : 'rgba(255,170,60,0.38)';
    ctx.fill();
  }
  ctx.restore();
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
    time: pose.time,
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

/** 손에 든 무기 + 손. 발톱 장갑은 손을 덮으므로 손을 먼저 그림 */
function weaponInHand(d: D, shape: IconShape | undefined, hand: Pt, angle: number, near: boolean): void {
  const color = d.look.weaponColor ?? '#c0c0c0';
  if (shape === 'gauntlet') {
    drawHand(d, hand, near);
    drawWeapon(d, shape, color, hand[0], hand[1], angle);
  } else {
    drawWeapon(d, shape, color, hand[0], hand[1], angle);
    drawHand(d, hand, near);
  }
}

function drawFront(d: D): void {
  const b = bodyPoints(d);
  const look = d.look;
  const gear = headGearOf(d);
  const o = d.outfit;
  const wpn = look.weapon;
  const dual = isDual(look);
  const bow = wpn === 'bow';
  if (d.rig.beast) drawBeastAura(d);
  if (o === 'warrior') drawCape(d, b, false);
  if (o === 'bard') drawShortCape(d, b, false);
  if (o === 'archer') drawQuiver(d, false);
  if (o === 'beastkin') drawTail(d, false);
  drawScarfTail(d);
  drawGearBehind(d, b, gear);
  drawHairBackFront(d, b);
  // 먼 팔(방패 쪽)은 몸 뒤. 들어 올린 팔(류트 목을 잡은 손 포함)은 몸통 앞에 보이게
  const raised = d.rig.armOther > 1.2 || wpn === 'lute';
  const farArm = () => {
    if (look.shield) drawShield(d, look.shield, b.handO[0] + 1.6, b.handO[1] - 3.4);
    drawArm(d, b.shO, b.handO, false);
    // 활은 앞쪽(먼) 손에, 쌍검·발톱은 양손에
    if (bow) weaponInHand(d, wpn, b.handO, d.rig.weapon, false);
    else if (dual) weaponInHand(d, wpn, b.handO, d.rig.weapon2, false);
    else drawHand(d, b.handO, false);
    if (d.rig.cast > 0) castGlow(d, b.handO);
  };
  if (!raised) farArm();
  drawLegs(d);
  drawTorso(d, b);
  if (raised) farArm();
  // 가까운 팔 + 무기
  if (d.rig.bent) drawBentArm(d, b.shW, b.handW, true);
  else drawArm(d, b.shW, b.handW, true);
  if (o === 'gladiator') drawPauldron(d, b, true);
  if (bow) {
    drawBowString(d, b.handO, d.rig.weapon, b.handW);
    drawHand(d, b.handW, true);
  } else weaponInHand(d, wpn, b.handW, d.rig.weapon, true);
  // 류트 목을 잡은 손은 악기 위에
  if (wpn === 'lute') drawHand(d, b.handO, false);
  if (d.rig.cast > 0) castGlow(d, b.handW);
  drawNeck(d, b);
  headPath(d.ctx, b.hx, b.hy, true);
  paint(d, d.pal.skin);
  if ((!coversHair(gear) || gear === 'bandana') && o !== 'beastkin') drawEar(d, b);
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
  // 짐승 귀는 머리카락 위로 (투구를 쓰면 투구 위로 뚫고 나옴)
  if (o === 'beastkin' && !coversHair(gear)) drawBeastEars(d, b, true);
  drawGearFront(d, b, gear);
  if (o === 'beastkin' && coversHair(gear)) drawBeastEars(d, b, true);
  if (o === 'summoner' && !d.ghost) drawWisp(d, b);
}

function drawBack(d: D): void {
  const b = bodyPoints(d);
  const look = d.look;
  const gear = headGearOf(d);
  const o = d.outfit;
  const wpn = look.weapon;
  const dual = isDual(look);
  if (d.rig.beast) drawBeastAura(d);
  // 무기 든 팔(먼 쪽)은 몸 뒤
  if (wpn === 'gauntlet') {
    drawArm(d, b.shW, b.handW, false);
    weaponInHand(d, wpn, b.handW, d.rig.weapon, false);
  } else {
    drawWeapon(d, wpn, look.weaponColor ?? '#c0c0c0', b.handW[0], b.handW[1], d.rig.weapon);
    drawArm(d, b.shW, b.handW, false);
    drawHand(d, b.handW, false);
  }
  if (d.rig.cast > 0) castGlow(d, b.handW);
  drawLegs(d);
  drawTorso(d, b);
  if (o === 'gladiator') drawPauldron(d, b, false);
  if (o === 'warrior') drawCape(d, b, true);
  if (o === 'bard') drawShortCape(d, b, true);
  drawScarfTail(d);
  if (d.rig.bent) drawBentArm(d, b.shO, b.handO, true);
  else drawArm(d, b.shO, b.handO, true);
  if (wpn === 'bow') {
    drawBowString(d, b.handW, d.rig.weapon, b.handO);
    drawHand(d, b.handO, true);
  } else if (dual) weaponInHand(d, wpn, b.handO, d.rig.weapon2, true);
  else drawHand(d, b.handO, true);
  if (look.shield) drawShield(d, look.shield, b.handO[0] - 1.0, b.handO[1] - 3.6);
  if (d.rig.cast > 0) castGlow(d, b.handO);
  drawNeck(d, b);
  headPath(d.ctx, b.hx, b.hy, false);
  paint(d, d.pal.skin);
  if (gear === 'hood' || gear === 'veil') drawGearBackView(d, b, gear);
  else {
    drawHairBackView(d, b);
    if (o === 'beastkin' && !coversHair(gear)) drawBeastEars(d, b, false);
    drawGearBackView(d, b, gear);
    if (o === 'beastkin' && coversHair(gear)) drawBeastEars(d, b, false);
  }
  // 등에 멘 것은 보는 사람에게 가장 가까우므로 머리카락 위에
  if (o === 'beastkin') drawTail(d, true);
  if (o === 'archer') drawQuiver(d, true);
  if (o === 'summoner' && !d.ghost) drawWisp(d, b);
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
