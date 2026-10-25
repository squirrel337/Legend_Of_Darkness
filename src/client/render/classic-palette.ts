// 고전 도트 캐릭터의 색: 한 가지 색에서 4단계 명암(어두움·그림자·기본·밝음)과 선 색을 만듭니다.
// 도트 그림처럼 그림자는 푸른/보랏빛 쪽으로, 밝은 쪽은 노란빛 쪽으로 색상을 살짝 돌립니다.
import type { ClassId } from '../../shared/constants';
import type { HumanLook } from '../../shared/types';
import { pack, type Mat } from './classic-raster';

export type RGB = [number, number, number];

const parseCache = new Map<string, RGB>();

/** '#rgb', '#rrggbb', 'rgb(r,g,b)' 를 읽습니다. 모르는 형식은 회색 */
export function parseColor(c: string): RGB {
  let v = parseCache.get(c);
  if (v) return v;
  const s = c.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    v = Number.isFinite(n) && h.length >= 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  } else {
    const m = s.match(/-?[\d.]+/g);
    v = m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])].map((x) => Math.max(0, Math.min(255, Math.round(x)))) as RGB : [128, 128, 128];
  }
  if (parseCache.size > 512) parseCache.clear();
  parseCache.set(c, v);
  return v;
}

export function toHsl([r0, g0, b0]: RGB): [number, number, number] {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
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

export function fromHsl(h: number, s: number, l: number): RGB {
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
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 색상(0~1 원)을 target 쪽으로 amt 만큼 돌림 */
function shiftHue(h: number, target: number, amt: number): number {
  let d = target - h;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (h + d * amt + 1) % 1;
}

function packRgb([r, g, b]: RGB): number {
  return pack(r, g, b);
}

export function packColor(c: string): number {
  return packRgb(parseColor(c));
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

export function mixColor(a: string, b: string, t: number): string {
  const [r, g, bl] = mixRgb(parseColor(a), parseColor(b), t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function isGrayish(c: string): boolean {
  return toHsl(parseColor(c))[1] < 0.12;
}

/**
 * 한 색으로 재질(4단계 명암 + 선 색)을 만듭니다.
 * k: 명암 폭 (1 기본, 금속은 더 크게)
 * vivid: 채도를 조금 올림 (옷감을 원작처럼 선명하게)
 */
export function ramp(c: string | RGB, k = 1, vivid = 0): Mat {
  const rgb = typeof c === 'string' ? parseColor(c) : c;
  let [h, s, l] = toHsl(rgb);
  const gray = s < 0.07;
  if (gray) {
    // 회색은 그림자를 살짝 푸르게
    h = 0.62;
    s = 0.04;
  } else if (vivid > 0) {
    s = clamp01(s * (1 + vivid) + vivid * 0.12);
  }
  // 아주 어둡거나 밝은 색도 명암이 보이게 기본 밝기를 조금 당깁니다
  const L = Math.max(0.13, Math.min(0.9, l));
  const step = 0.13 * k;
  const hi = fromHsl(shiftHue(h, 1 / 6, 0.1), clamp01(s * 0.95), clamp01(L + step * (L > 0.75 ? 0.75 : 1) + (L < 0.25 ? 0.05 : 0)));
  const mid = fromHsl(h, s, L);
  const sh = fromHsl(shiftHue(h, 0.7, gray ? 0 : 0.07), clamp01(s * 1.05 + (gray ? 0.05 : 0.05)), clamp01(L - step * (L < 0.25 ? 0.6 : 1)));
  const dk = fromHsl(shiftHue(h, 0.7, gray ? 0 : 0.13), clamp01(s * 1.1 + (gray ? 0.07 : 0.08)), clamp01(L - step * (L < 0.25 ? 1.05 : 2)));
  const line = fromHsl(shiftHue(h, 0.72, gray ? 0 : 0.16), clamp01(s * 0.9 + 0.1), Math.max(0.035, Math.min(0.2, L * 0.3)));
  return { t: [packRgb(dk), packRgb(sh), packRgb(mid), packRgb(hi)], line: packRgb(line) };
}

/** 손으로 고른 4단계 색 */
function handRamp(dk: string, sh: string, mid: string, hi: string, line: string): Mat {
  return { t: [packColor(dk), packColor(sh), packColor(mid), packColor(hi)], line: packColor(line) };
}

/** 직업별 기본 장식 색 (body2 가 없을 때) */
const CLASSIC_TRIM: Record<ClassId, string> = {
  peasant: '#7a5a3a',
  warrior: '#c9a74a',
  rogue: '#b83a32',
  wizard: '#e8c35a',
  priest: '#d4af37',
  monk: '#c0392b',
  summoner: '#e05a7a',
  bard: '#e8b84a',
  beastkin: '#c8803a',
  archer: '#6fae4a',
  gladiator: '#c83a2a',
};

export interface ClassicPalette {
  skin: Mat;
  hair: Mat;
  /** 옷 (look.body) */
  main: Mat;
  /** 장식 (look.body2 또는 직업 기본) */
  trim: Mat;
  /** 바지·속옷 */
  under: Mat;
  boot: Mat;
  leather: Mat;
  metal: Mat;
  gold: Mat;
  helm: Mat;
  shield: Mat;
  wood: Mat;
  white: Mat;
  /** 무기 색 (look.weaponColor) */
  wpn: Mat;
  /** 무기 날 (금속에 무기 색이 조금) */
  blade: Mat;
  eye: number;
  eyeHi: number;
  mouth: number;
  /** 실루엣 외곽선 기준 색 */
  outline: number;
  /** 원래 색 문자열 (보조 계산용) */
  mainHex: string;
  trimHex: string;
  hairHex: string;
  wpnHex: string;
}

const SKIN = handRamp('#a8664a', '#d6976f', '#f1c49b', '#fde2c2', '#5c2f22');

/** 겉모습 → 색 묶음 */
export function buildClassicPalette(look: HumanLook): ClassicPalette {
  const outfit: ClassId = look.outfit ?? 'peasant';
  const main = look.body || '#8a7a66';
  let trim = look.body2 ?? CLASSIC_TRIM[outfit];
  // 1·2단계 장비의 회색 장식은 직업 색으로 (원작처럼 생기 있게)
  if (isGrayish(trim) && outfit !== 'peasant') trim = CLASSIC_TRIM[outfit];
  let under: string;
  let boot = '#7a4a28';
  switch (outfit) {
    case 'warrior':
      under = '#4a4250';
      boot = mixColor(main, '#5a5a66', 0.35);
      break;
    case 'rogue':
      under = mixColor(main, '#22202a', 0.55);
      boot = '#4a3424';
      break;
    case 'wizard':
    case 'summoner':
      under = mixColor(main, '#141022', 0.5);
      boot = mixColor(main, '#2a2030', 0.6);
      break;
    case 'priest':
      under = '#e8e2d4';
      boot = '#8a6a48';
      break;
    case 'monk':
      under = mixColor(main, '#f4ecd8', 0.15);
      boot = '#3a2e2a';
      break;
    case 'bard':
      under = mixColor(main, '#2a2026', 0.6);
      boot = '#6a4426';
      break;
    case 'beastkin':
      under = mixColor(main, '#2e2a26', 0.45);
      boot = mixColor(main, '#3a2a1e', 0.5);
      break;
    case 'archer':
      under = mixColor(main, '#5a4632', 0.55);
      boot = '#6b4a2a';
      break;
    case 'gladiator':
      under = mixColor(main, '#2a1a16', 0.4);
      boot = mixColor(trim, '#9aa0a8', 0.55);
      break;
    default:
      // 평민: 짧은 바지는 옷보다 어두운 갈색 계열
      under = mixColor(main, '#4a3020', 0.55);
      boot = '#7a4a28';
  }
  const hair = look.hairColor || '#5a3a22';
  const wpn = look.weaponColor ?? '#c0c0c0';
  const helm = look.helmet ?? '#9aa0a6';
  const shield = look.shield ?? '#8a6a45';
  const metalBase = '#c8ccd4';
  return {
    skin: SKIN,
    hair: ramp(hair, 1.05, 0.25),
    main: ramp(main, 1, 0.18),
    trim: ramp(trim, 1, 0.15),
    under: ramp(under, 0.9, 0.1),
    boot: ramp(boot, 0.95, 0.05),
    leather: ramp('#6a4428', 0.9),
    metal: ramp(metalBase, 1.4),
    gold: handRamp('#7a5418', '#b08028', '#e0b84a', '#fff0a0', '#3a2408'),
    helm: ramp(helm, 1.3, 0.05),
    shield: ramp(shield, 1.15, 0.05),
    wood: ramp('#8a5a32', 1),
    white: handRamp('#9aa0b4', '#c8ccd8', '#eceae4', '#ffffff', '#4a4a5a'),
    wpn: ramp(wpn, 1.1, 0.2),
    blade: ramp(mixColor(metalBase, wpn, 0.3), 1.4),
    eye: packColor('#2a1618'),
    eyeHi: packColor('#ffffff'),
    mouth: packColor('#b8644a'),
    outline: packColor('#120a0e'),
    mainHex: main,
    trimHex: trim,
    hairHex: hair,
    wpnHex: wpn,
  };
}
