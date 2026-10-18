// 고전 도트 캐릭터 그리기의 공통 형식과 도우미 (DOM 없음).
// 겉모습 → 머리 모양/의상/모자 해석, 부위 번호, 관절 자세(Rig), 몸통·팔다리 모양 계산을 모읍니다.
import type { ClassId } from '../../shared/constants';
import type { HumanLook, IconShape } from '../../shared/types';
import type { ClassicPalette } from './classic-palette';
import type { Mat, PixelBuf } from './classic-raster';

// ───────────────────────── 공개 형식 ─────────────────────────

/** 앞 3/4(오른쪽 아래를 봄) 또는 뒤 3/4(오른쪽 위를 봄) */
export type ClassicView = 'F' | 'B';
export type ClassicAnim = 'idle' | 'walk' | 'attack' | 'cast' | 'skill';

/** 동작마다 그림 수 (가만히·걷기·공격·시전·기술 모두 4장) */
export const CLASSIC_FRAMES_PER_ANIM = 4;

export interface ClassicFrame {
  view: ClassicView;
  anim: ClassicAnim;
  /** 동작 안의 그림 번호 (0~3) */
  f: number;
  ghost: boolean;
  beast: boolean;
}

export type HairStyleId = 'short' | 'spiky' | 'long' | 'topknot' | 'ponytail' | 'wild' | 'braid' | 'bob' | 'twintail';

/** 머리 모양 번호 → 모양 (남/녀). 플레이어는 0~5, NPC 는 더 큰 번호도 씀 */
export const HAIR_M: readonly HairStyleId[] = ['short', 'spiky', 'long', 'topknot', 'ponytail', 'wild', 'braid', 'bob'];
export const HAIR_F: readonly HairStyleId[] = ['bob', 'wild', 'long', 'braid', 'ponytail', 'twintail', 'spiky', 'short'];

export function hairStyleOf(look: Pick<HumanLook, 'gender' | 'hairStyle'>): HairStyleId {
  const list = look.gender === 'f' ? HAIR_F : HAIR_M;
  const n = Number.isFinite(look.hairStyle) ? Math.trunc(look.hairStyle) : 0;
  return list[((n % list.length) + list.length) % list.length]!;
}

/** 머리에 쓰는 것 */
export type ClassicHeadGear =
  | 'none'
  | 'horned'
  | 'halfhelm'
  | 'circlet'
  | 'browguard'
  | 'beret'
  | 'plumehelm'
  | 'pointhat'
  | 'mitre'
  | 'veil'
  | 'bandana'
  | 'headband'
  | 'tallcap'
  | 'ribbon'
  | 'featherhat'
  | 'robinhat'
  | 'featherclip'
  | 'crest';

/**
 * chibi.ts 와 같은 규칙: 투구(helmet 색)가 있으면 직업별 투구를 그 색으로,
 * 없으면 직업 기본 모자 (마법사 고깔, 사제 주교관/베일, 도적 두건 ...).
 */
export function headGearOf(look: Pick<HumanLook, 'gender' | 'outfit' | 'helmet'>): ClassicHeadGear {
  const o = look.outfit ?? 'peasant';
  const f = look.gender === 'f';
  if (look.helmet) {
    if (o === 'wizard' || o === 'priest' || o === 'summoner') return 'circlet';
    if (o === 'rogue' || o === 'archer') return 'halfhelm';
    if (o === 'monk' || o === 'beastkin') return 'browguard';
    if (o === 'bard') return 'beret';
    if (o === 'gladiator') return 'plumehelm';
    return 'horned';
  }
  switch (o) {
    case 'wizard':
      return f ? 'none' : 'pointhat';
    case 'priest':
      return f ? 'veil' : 'mitre';
    case 'rogue':
      return f ? 'none' : 'bandana';
    case 'monk':
      return 'headband';
    case 'summoner':
      return f ? 'ribbon' : 'tallcap';
    case 'bard':
      return 'featherhat';
    case 'archer':
      return f ? 'featherclip' : 'robinhat';
    case 'gladiator':
      return 'crest';
    default:
      return 'none';
  }
}

/** 머리카락을 덮는 모자 (앞머리만 보임) */
export function coversHair(g: ClassicHeadGear): boolean {
  return g === 'horned' || g === 'halfhelm' || g === 'plumehelm' || g === 'bandana' || g === 'veil' || g === 'pointhat' || g === 'mitre' || g === 'tallcap' || g === 'robinhat' || g === 'beret' || g === 'featherhat';
}

/** 의상 구성 (직업 + 성별) */
export interface Costume {
  top: 'tank' | 'dress' | 'armor' | 'jerkin' | 'robe' | 'gi' | 'layered' | 'vest' | 'fur' | 'tunic' | 'harness';
  sleeve: 'none' | 'short' | 'long' | 'wide' | 'puff';
  legs: 'shorts' | 'pants' | 'baggy' | 'tights' | 'bare';
  skirt: 'none' | 'robe' | 'dress' | 'tunic' | 'tassets' | 'straps' | 'loin';
  feet: 'shoes' | 'boots' | 'tallboots' | 'wraps' | 'greaves' | 'furboots';
  belt: 'none' | 'leather' | 'sash' | 'gold';
  cape?: 'long' | 'short';
  pauldrons?: 'both' | 'one';
  scarf?: boolean;
  quiver?: boolean;
  tail?: boolean;
  ears?: boolean;
  bracers?: boolean;
  wraps?: boolean;
  talisman?: boolean;
  stole?: boolean;
}

export function costumeOf(outfit: ClassId | undefined, gender: 'm' | 'f'): Costume {
  const f = gender === 'f';
  switch (outfit ?? 'peasant') {
    case 'warrior':
      return { top: 'armor', sleeve: 'short', legs: 'pants', skirt: 'tassets', feet: 'tallboots', belt: 'leather', cape: 'long', pauldrons: 'both', bracers: true };
    case 'rogue':
      return { top: 'jerkin', sleeve: 'none', legs: f ? 'tights' : 'pants', skirt: 'none', feet: f ? 'tallboots' : 'boots', belt: 'leather', scarf: true, bracers: true };
    case 'wizard':
      return { top: 'robe', sleeve: 'wide', legs: 'pants', skirt: 'robe', feet: 'shoes', belt: 'sash' };
    case 'priest':
      return { top: 'robe', sleeve: 'wide', legs: 'pants', skirt: 'robe', feet: 'shoes', belt: 'gold', stole: true };
    case 'monk':
      return { top: 'gi', sleeve: f ? 'none' : 'short', legs: 'baggy', skirt: 'none', feet: 'wraps', belt: 'sash', wraps: true };
    case 'summoner':
      return { top: 'layered', sleeve: 'wide', legs: 'pants', skirt: 'robe', feet: 'shoes', belt: 'sash', talisman: true };
    case 'bard':
      return { top: 'vest', sleeve: 'puff', legs: f ? 'tights' : 'pants', skirt: f ? 'tunic' : 'none', feet: 'tallboots', belt: 'leather', cape: 'short' };
    case 'beastkin':
      return { top: 'fur', sleeve: 'none', legs: 'bare', skirt: 'loin', feet: 'furboots', belt: 'leather', tail: true, ears: true };
    case 'archer':
      return { top: 'tunic', sleeve: 'short', legs: 'pants', skirt: 'tunic', feet: 'tallboots', belt: 'leather', quiver: true, bracers: true };
    case 'gladiator':
      return { top: 'harness', sleeve: 'none', legs: 'bare', skirt: 'straps', feet: 'greaves', belt: 'gold', pauldrons: 'one', bracers: true };
    default:
      return f
        ? { top: 'dress', sleeve: 'none', legs: 'bare', skirt: 'dress', feet: 'shoes', belt: 'leather' }
        : { top: 'tank', sleeve: 'none', legs: 'shorts', skirt: 'none', feet: 'shoes', belt: 'leather' };
  }
}

// ───────────────────────── 무기 쥐는 방식 ─────────────────────────

export type Grip = 'none' | 'blade' | 'short' | 'heavy' | 'staff' | 'claw' | 'gauntlet' | 'bow' | 'lute' | 'book' | 'dual' | 'spear';

/** 무기 모양 → 쥐는 방식 (무기가 아닌 모양이 와도 무언가는 들게) */
export function gripOf(w: IconShape | undefined): Grip {
  switch (w) {
    case undefined:
      return 'none';
    case 'sword':
      return 'blade';
    case 'dagger':
      return 'short';
    case 'axe':
    case 'mace':
    case 'stick':
    case 'bone':
      return 'heavy';
    case 'staff':
    case 'orb':
    case 'gem':
    case 'star':
    case 'wing':
      return 'staff';
    case 'claw':
      return 'claw';
    case 'gauntlet':
      return 'gauntlet';
    case 'bow':
      return 'bow';
    case 'lute':
      return 'lute';
    case 'book':
    case 'scroll':
      return 'book';
    case 'dualsword':
      return 'dual';
    case 'arrow':
      return 'spear';
    default:
      return 'heavy';
  }
}

/** 양손에 같은 무기 (쌍검·발톱). 방패가 있으면 방패가 우선 */
export function isDual(look: Pick<HumanLook, 'weapon' | 'shield'>): boolean {
  const g = gripOf(look.weapon);
  return (g === 'dual' || g === 'gauntlet' || g === 'claw') && !look.shield;
}

// ───────────────────────── 부위 번호 (경계선 계산용) ─────────────────────────

export const P = {
  back: 1,
  hairBack: 2,
  armF: 3,
  handF: 4,
  wpnF: 5,
  legF: 6,
  legN: 7,
  footF: 8,
  footN: 9,
  pantsF: 10,
  pantsN: 11,
  skirt: 12,
  torso: 13,
  cloth: 14,
  belt: 15,
  shield: 16,
  armN: 17,
  sleeveN: 18,
  handN: 19,
  wpnN: 20,
  neck: 21,
  head: 22,
  hair: 23,
  hat: 24,
  fx: 25,
  ear: 26,
  sleeveF: 27,
  cape: 28,
  tail: 29,
  scarf: 30,
  pauldron: 31,
  quiver: 32,
  face: 33,
} as const;

// ───────────────────────── 몸 치수 ─────────────────────────

export interface Dims {
  /** 어깨 윗선 y */
  shY: number;
  /** 몸통 외곽: [어깨에서 아래로, 가까운 쪽 반폭, 먼 쪽 반폭] */
  torso: readonly (readonly [number, number, number])[];
  /** 허리(가장 가는 곳)와 가랑이의 dy */
  waist: number;
  crotch: number;
  shX: readonly [number, number];
  shDy: number;
  upper: number;
  fore: number;
  armR: readonly [number, number, number];
  handR: number;
  hipY: number;
  hipX: readonly [number, number];
  thigh: number;
  shin: number;
  legR: readonly [number, number, number];
  headDy: number;
  headR: readonly [number, number];
}

export interface Pt {
  x: number;
  y: number;
}
export const pt = (x: number, y: number): Pt => ({ x, y });
/** 각도 a 방향의 단위 벡터 (0 = 아래, π/2 = 앞(오른쪽), π = 위, -π/2 = 뒤) */
export const dirv = (a: number): Pt => pt(Math.sin(a), Math.cos(a));
export const add = (p: Pt, a: number, len: number): Pt => pt(p.x + Math.sin(a) * len, p.y + Math.cos(a) * len);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Rig {
  view: ClassicView;
  female: boolean;
  d: Dims;
  /** 가까운 쪽 x 부호 (앞: -1 = 화면 왼쪽, 뒤: +1) */
  sN: number;
  /** 몸통 가운데 x */
  cx: number;
  /** 상체 위아래 이동 (숨쉬기·걸음) */
  uy: number;
  head: Pt;
  shN: Pt;
  shF: Pt;
  elN: Pt;
  elF: Pt;
  haN: Pt;
  haF: Pt;
  hipN: Pt;
  hipF: Pt;
  knN: Pt;
  knF: Pt;
  anN: Pt;
  anF: Pt;
  /** 발끝이 아래로 (뒤꿈치 듦) */
  tipN: number;
  tipF: number;
  /** 무기 방향 (가까운 손 / 먼 손) */
  wN: number;
  wF: number;
  /** 가까운 손 무기를 몸 뒤에 그림 (머리 위로 넘긴 칼 등) */
  wpnBack: boolean;
  /** 먼 팔을 몸통 앞에 그림 (들어 올린 팔) */
  farFront: boolean;
  /** 손의 빛 (시전) 0~1 */
  glow: number;
  /** 활시위 당김 0~1, 화살을 메김 */
  pull: number;
  nock: boolean;
  /** 휘두르는 궤적 (0 없음, 1 위→앞, 2 찌르기) */
  trail: number;
  grip: Grip;
  dual: boolean;
  /** 머리카락·망토 흔들림 (-1~1) */
  sway: number;
  beast: boolean;
}

export interface Ctx {
  b: PixelBuf;
  look: HumanLook;
  pal: ClassicPalette;
  r: Rig;
  c: Costume;
  outfit: ClassId;
  hair: HairStyleId;
  gear: ClassicHeadGear;
  fr: ClassicFrame;
}

/** 부위 하나를 그리고, 그 둘레 중 다른 부위 위에 있는 칸에 경계선을 긋습니다 */
export function part(x: Ctx, id: number, line: number | null, draw: () => void, keep: readonly number[] = []): void {
  x.b.begin();
  draw();
  if (line === null) x.b.end();
  else x.b.contour(id, line, keep);
}

/** 몸통 외곽선 x (dy: 어깨에서 아래로, side: -1 화면 왼쪽 / +1 오른쪽, extra: 옷 두께) */
export function torsoEdge(x: Ctx, dy: number, side: number, extra = 0): number {
  const { r } = x;
  const rows = r.d.torso;
  let a = rows[0]!;
  let b = rows[rows.length - 1]!;
  if (dy <= rows[0]![0]) b = a;
  else if (dy >= b[0]) a = b;
  else {
    for (let i = 0; i < rows.length - 1; i++) {
      if (dy >= rows[i]![0] && dy <= rows[i + 1]![0]) {
        a = rows[i]!;
        b = rows[i + 1]!;
        break;
      }
    }
  }
  const t = b[0] === a[0] ? 0 : (dy - a[0]) / (b[0] - a[0]);
  const near = side === r.sN;
  const w = near ? lerp(a[1], b[1], t) : lerp(a[2], b[2], t);
  return r.cx + side * (w + extra);
}

/** 어깨에서 dy 아래의 화면 y */
export function torsoY(x: Ctx, dy: number): number {
  return x.r.d.shY + x.r.uy + dy;
}

/** 몸통 모양 다각형 (dy0 ~ dy1 구간, extra 만큼 두껍게, 아래로 갈수록 flare 만큼 더 넓게) */
export function torsoPoly(x: Ctx, dy0: number, dy1: number, extra = 0, flare = 0): number[] {
  const ys: number[] = [];
  for (const row of x.r.d.torso) if (row[0] > dy0 && row[0] < dy1) ys.push(row[0]);
  const ex = (dy: number) => extra + (flare * (dy - dy0)) / Math.max(1, dy1 - dy0);
  const pts: number[] = [];
  pts.push(torsoEdge(x, dy0, -1, ex(dy0)), torsoY(x, dy0));
  for (const dy of ys) pts.push(torsoEdge(x, dy, -1, ex(dy)), torsoY(x, dy));
  pts.push(torsoEdge(x, dy1, -1, ex(dy1)), torsoY(x, dy1));
  pts.push(torsoEdge(x, dy1, 1, ex(dy1)), torsoY(x, dy1));
  for (let i = ys.length - 1; i >= 0; i--) pts.push(torsoEdge(x, ys[i]!, 1, ex(ys[i]!)), torsoY(x, ys[i]!));
  pts.push(torsoEdge(x, dy0, 1, ex(dy0)), torsoY(x, dy0));
  return pts;
}

/** 다리 관절 */
export function legPts(x: Ctx, near: boolean) {
  const r = x.r;
  return near ? { hip: r.hipN, kn: r.knN, an: r.anN, tip: r.tipN } : { hip: r.hipF, kn: r.knF, an: r.anF, tip: r.tipF };
}

/** 다리 위의 점 (t: 0 = 엉덩이, 1 = 무릎, 2 = 발목) */
export function legAt(x: Ctx, near: boolean, t: number): [number, number, number] {
  const { hip, kn, an } = legPts(x, near);
  const R = x.r.d.legR;
  if (t <= 1) return [lerp(hip.x, kn.x, t), lerp(hip.y, kn.y, t), lerp(R[0], R[1], t)];
  const u = t - 1;
  return [lerp(kn.x, an.x, u), lerp(kn.y, an.y, u), lerp(R[1], R[2], u)];
}

/** 다리 한 쪽을 구간별로 칠함 (t0~t1) */
export function legSeg(x: Ctx, near: boolean, t0: number, t1: number, m: Mat, id: number, extra = 0): void {
  const bias = near ? 0.05 : -0.12;
  if (t0 < 1) {
    const a = legAt(x, near, t0);
    const b = legAt(x, near, Math.min(1, t1));
    x.b.capsule(a[0], a[1], b[0], b[1], a[2] + extra, b[2] + extra, m, id, bias);
  }
  if (t1 > 1) {
    const a = legAt(x, near, Math.max(1, t0));
    const b = legAt(x, near, t1);
    x.b.capsule(a[0], a[1], b[0], b[1], a[2] + extra, b[2] + extra, m, id, bias);
  }
}

export function armPts(x: Ctx, near: boolean) {
  const r = x.r;
  return near ? { sh: r.shN, el: r.elN, ha: r.haN } : { sh: r.shF, el: r.elF, ha: r.haF };
}

/** 팔 위의 점 (t: 0 = 어깨, 1 = 팔꿈치, 2 = 손목) */
export function armAt(x: Ctx, near: boolean, t: number): [number, number, number] {
  const { sh, el, ha } = armPts(x, near);
  const R = x.r.d.armR;
  if (t <= 1) return [lerp(sh.x, el.x, t), lerp(sh.y, el.y, t), lerp(R[0], R[1], t)];
  const u = t - 1;
  return [lerp(el.x, ha.x, u), lerp(el.y, ha.y, u), lerp(R[1], R[2], u)];
}

export function armSeg(x: Ctx, near: boolean, t0: number, t1: number, m: Mat, id: number, extra = 0): void {
  const bias = near ? 0.05 : -0.15;
  if (t0 < 1) {
    const a = armAt(x, near, t0);
    const b = armAt(x, near, Math.min(1, t1));
    x.b.capsule(a[0], a[1], b[0], b[1], a[2] + extra, b[2] + extra, m, id, bias);
  }
  if (t1 > 1) {
    const a = armAt(x, near, Math.max(1, t0));
    const b = armAt(x, near, t1);
    x.b.capsule(a[0], a[1], b[0], b[1], a[2] + extra, b[2] + extra, m, id, bias);
  }
}

/** 머리 정규화 좌표 (머리 반지름으로 나눈 값) → 실제 좌표 */
export function hp(x: Ctx, pts: readonly number[], ox = 0, oy = 0): number[] {
  const { x: hx, y: hy } = x.r.head;
  const [rx, ry] = x.r.d.headR;
  return pts.map((v, i) => (i % 2 === 0 ? hx + (v + ox) * rx : hy + (v + oy) * ry));
}

/** 무기 좌표계 (손잡이 가운데 원점, v = 무기 끝 방향, u = 옆) → 실제 좌표 */
export function wpnPoly(hand: Pt, a: number, pts: readonly number[]): number[] {
  const dv = dirv(a);
  const ux = -dv.y;
  const uy = dv.x;
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const u = pts[i]!;
    const v = pts[i + 1]!;
    out.push(hand.x + dv.x * v + ux * u, hand.y + dv.y * v + uy * u);
  }
  return out;
}

/** 무기 좌표의 한 점 */
export function wpnAt(hand: Pt, a: number, u: number, v: number): Pt {
  const p = wpnPoly(hand, a, [u, v]);
  return pt(p[0]!, p[1]!);
}
