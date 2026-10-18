// 고전 도트 캐릭터의 머리(얼굴·머리카락·모자)와 무기·방패·빛 효과 (DOM 없음).
import type { IconShape } from '../../shared/types';
import { mixColor, packColor, parseColor, ramp, toHsl } from './classic-palette';
import { SOFT_PART, mixPacked, pack, type Mat, type PixelBuf, type Shade } from './classic-raster';
import { P, coversHair, dirv, hp, part, pt, wpnAt, wpnPoly, type Ctx, type HairStyleId, type Pt } from './classic-kit';

// ───────────────────────── 얼굴 ─────────────────────────

export function drawHead(x: Ctx): void {
  const { pal, r, b } = x;
  const { x: hx, y: hy } = r.head;
  const [rx, ry] = r.d.headR;
  part(x, P.head, pal.skin.line, () => {
    if (r.view === 'F') {
      // 얼굴은 오른쪽(바라보는 쪽)으로 조금 갸름하고, 턱이 앞쪽에
      b.poly(
        [
          hx - rx, hy - 1,
          hx - rx * 0.86, hy - ry * 0.62,
          hx - rx * 0.45, hy - ry * 0.95,
          hx + rx * 0.2, hy - ry,
          hx + rx * 0.75, hy - ry * 0.8,
          hx + rx * 1.02, hy - ry * 0.3,
          hx + rx * 1.0, hy + ry * 0.3,
          hx + rx * 0.78, hy + ry * 0.68,
          hx + rx * 0.3, hy + ry * 0.98,
          hx - rx * 0.12, hy + ry,
          hx - rx * 0.6, hy + ry * 0.75,
          hx - rx * 0.95, hy + ry * 0.3,
        ],
        pal.skin,
        P.head,
        { k: 'ball', cx: hx - 1.2, cy: hy - 1.6, rx: rx * 1.45, ry: ry * 1.35 },
      );
    } else {
      b.ellipse(hx, hy, rx, ry, pal.skin, P.head);
    }
  });
}

export function drawFace(x: Ctx): void {
  const { pal, r, b } = x;
  if (r.view !== 'F') return;
  const HX = Math.round(r.head.x);
  const HY = Math.round(r.head.y + 0.6);
  const eye = r.beast ? pack(255, 48, 32) : pal.eye;
  // 가까운 눈 (화면 왼쪽)은 온전히, 먼 눈 (오른쪽, 얼굴 가장자리)은 조금 좁게
  const brow = mixPacked(pal.hair.t[0], pal.skin.t[0], 0.25);
  if (r.female) {
    // 큰 눈 (2x3) + 흰 반짝임 + 속눈썹
    b.rect(HX - 2, HY - 1, 2, 3, eye, P.face);
    b.rect(HX + 2, HY - 1, 2, 3, eye, P.face);
    if (!r.beast) {
      b.dot(HX - 1, HY, pal.eyeHi, P.face);
      b.dot(HX + 3, HY, pal.eyeHi, P.face);
      b.dot(HX - 2, HY + 1, mixPacked(eye, pal.skin.t[2], 0.45), P.face);
      b.dot(HX + 2, HY + 1, mixPacked(eye, pal.skin.t[2], 0.45), P.face);
    }
    b.dot(HX - 3, HY - 1, eye, P.face);
  } else {
    // 2x2 눈 + 짙은 눈썹
    b.rect(HX - 2, HY, 2, 2, eye, P.face);
    b.rect(HX + 2, HY, 1, 2, eye, P.face);
    if (!r.beast) {
      b.dot(HX - 1, HY, mixPacked(eye, pal.skin.t[2], 0.5), P.face);
      b.line(HX - 3, HY - 2, HX - 1, HY - 2, brow, P.face);
      b.line(HX + 2, HY - 2, HX + 3, HY - 2, brow, P.face);
    }
  }
  // 코 그림자, 입
  b.dot(HX + 1, HY + 2, pal.skin.t[1], P.face);
  b.dot(HX + 1, HY + 4, pal.mouth, P.face);
  if (r.beast) {
    // 송곳니
    b.dot(HX, HY + 4, pack(250, 250, 236), P.face);
    b.dot(HX + 2, HY + 4, pack(250, 250, 236), P.face);
    b.dot(HX + 1, HY + 4, pack(90, 20, 20), P.face);
  }
}

export function drawEar(x: Ctx): void {
  const { pal, r, b } = x;
  const front = r.view === 'F';
  const ex = front ? r.head.x - r.d.headR[0] + 0.6 : r.head.x + r.d.headR[0] - 0.6;
  const ey = r.head.y + 0.8;
  part(x, P.ear, pal.skin.line, () => {
    b.ellipse(ex, ey, 1.4, 1.9, pal.skin, P.ear);
    b.dot(ex + (front ? 0 : -1), ey, pal.skin.t[1], P.ear);
  });
}

// ───────────────────────── 머리카락 ─────────────────────────
// 좌표는 머리 중심 기준, 머리 반지름(rx, ry)으로 나눈 값.

type Fringe = 'swept' | 'spiky' | 'blunt' | 'parted';

function fringeOf(h: HairStyleId, female: boolean): Fringe {
  switch (h) {
    case 'spiky':
    case 'wild':
      return 'spiky';
    case 'bob':
    case 'braid':
    case 'twintail':
      return 'blunt';
    case 'long':
      return female ? 'parted' : 'swept';
    default:
      return 'swept';
  }
}

/** 귀가 보이는 머리 모양 */
export function showsEar(x: Ctx): boolean {
  const h = x.hair;
  if (x.gear === 'veil' || x.gear === 'horned' || x.gear === 'halfhelm' || x.gear === 'plumehelm') return false;
  return h === 'short' || h === 'spiky' || h === 'topknot' || h === 'ponytail' || (h === 'braid' && !x.r.female);
}

/** 앞머리 (먼 쪽 관자놀이 → 가까운 쪽 옆머리 앞) */
const FRINGE: Record<Fringe, readonly number[]> = {
  swept: [0.98, 0.16, 0.82, -0.34, 0.64, -0.08, 0.4, -0.5, 0.16, -0.14, -0.08, -0.56, -0.28, -0.18, -0.48, -0.46, -0.6, 0.06],
  spiky: [1.0, 0.22, 0.84, -0.36, 0.7, 0.04, 0.46, -0.5, 0.28, 0.08, 0.06, -0.46, -0.12, 0.06, -0.34, -0.44, -0.5, 0.08, -0.62, -0.18],
  blunt: [1.02, 0.34, 0.96, -0.16, 0.72, -0.08, 0.46, -0.16, 0.2, -0.08, -0.06, -0.16, -0.32, -0.08, -0.56, -0.16],
  parted: [1.02, 0.26, 0.88, -0.4, 0.6, -0.72, 0.38, -0.94, 0.2, -0.68, -0.04, -0.92, -0.34, -0.58, -0.56, -0.2],
};

/** 정수리 윤곽 (가까운 쪽 옆머리 → 먼 쪽 관자놀이). 모자·투구 아래는 이 크기 그대로 */
const CAP_TOP = [-1.1, 0.0, -1.16, -0.46, -0.95, -0.92, -0.54, -1.2, 0.0, -1.29, 0.52, -1.2, 0.93, -0.91, 1.12, -0.41, 1.1, 0.06];
/** 뾰족 머리: 원작처럼 머리 위로 크게, 뒤(화면 왼쪽)로 쓸어 넘긴 가시 일곱 개 */
const CAP_SPIKY = [-1.12, 0.05, -1.62, -0.24, -1.14, -0.5, -1.62, -1.02, -0.98, -1.04, -1.05, -1.86, -0.5, -1.22, -0.12, -2.0, 0.18, -1.26, 0.72, -1.8, 0.78, -1.08, 1.38, -1.12, 1.04, -0.66, 1.5, -0.46, 1.08, -0.3, 1.12, 0.06];
const CAP_WILD = [-1.16, 0.05, -1.46, -0.36, -1.16, -0.64, -1.3, -1.08, -0.78, -1.2, -0.5, -1.58, -0.08, -1.32, 0.3, -1.56, 0.62, -1.22, 1.1, -1.18, 1.04, -0.7, 1.32, -0.36, 1.1, 0.08];

/**
 * 모자를 쓰지 않은 머리는 원작처럼 숱을 조금 더 크게: 머리 가운데 위쪽 점을 위·옆으로 넓힘
 * (모자 아래 머리는 투구 둥근 모양에 맞춰 그대로)
 */
function fuller(pts: readonly number[], covered: boolean): readonly number[] {
  if (covered) return pts;
  return pts.map((v, i) => (i % 2 === 0 ? v * 1.04 : v < 0 ? v * 1.08 : v));
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

function hairShade(x: Ctx): Shade {
  const { x: hx, y: hy } = x.r.head;
  const [rx, ry] = x.r.d.headR;
  return { k: 'ball', cx: hx - 2.4, cy: hy - 4.6, rx: rx * 1.7, ry: ry * 1.6 };
}

/** 묶은 머리 다발 (뿌리 → 끝, 가늘어짐) */
function lock(x: Ctx, m: Mat, id: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r0: number, r1: number, r2: number): void {
  x.b.capsule(x0, y0, x1, y1, r0, r1, m, id);
  x.b.capsule(x1, y1, x2, y2, r1, r2, m, id);
}

/** 앞모습: 머리 뒤쪽 숱 + 긴 머리 (몸 뒤에 그림) */
export function drawHairBackLayer(x: Ctx): void {
  const { pal, r, b, hair } = x;
  if (r.view !== 'F') return;
  if (x.gear === 'veil') return;
  const m = pal.hair;
  const [rx, ry] = r.d.headR;
  const { x: hx, y: hy } = r.head;
  const sw = r.sway * 0.06;
  const shade = hairShade(x);
  // 투구·모자를 쓰면 정수리의 삐친 머리는 숨고, 아래로 늘어진 머리만 보임
  const covered = coversHair(x.gear);
  const style: HairStyleId = covered && (hair === 'spiky' || hair === 'topknot') ? 'short' : hair;
  part(x, P.hairBack, m.line, () => {
    const big = style === 'spiky' || style === 'short' ? 1.12 : 1.2;
    b.ellipse(hx - 0.1 * rx, hy - 0.18 * ry, rx * big, ry * (big - 0.04), m, P.hairBack);
    switch (style) {
      case 'long':
        b.poly(hp(x, [-1.12, -0.3, -1.26, 0.7, -1.22, 1.9, -1.02 + sw, 2.9, -0.2 + sw, 3.05, 0.5 + sw, 2.9, 1.02 + sw, 2.2, 1.18, 0.7, 1.1, -0.3]), m, P.hairBack, shade);
        break;
      case 'wild':
        b.poly(hp(x, [-1.14, -0.3, -1.38, 0.6, -1.22, 1.2, -1.48 + sw, 1.9, -0.94 + sw, 1.75, -0.86 + sw, 2.35, -0.3, 1.9, 0.2, 2.2, 0.5, 1.6, 1.12, 1.85, 1.02, 1.0, 1.28, 0.4, 1.12, -0.3]), m, P.hairBack, shade);
        break;
      case 'bob':
        b.poly(hp(x, [-1.18, -0.3, -1.26, 0.6, -1.14, 1.12, -0.6, 1.2, 0.6, 1.02, 1.12, 0.92, 1.16, -0.2]), m, P.hairBack, shade);
        break;
      case 'ponytail': {
        // 뒤통수(화면 왼쪽 위)에서 묶어 등 뒤로
        const t = hp(x, [-0.95, -0.55]);
        const s = r.sway * 0.6;
        lock(x, m, P.hairBack, t[0]!, t[1]!, t[0]! - 3.2 + s, t[1]! + 8, t[0]! - 2.4 + s * 1.6, t[1]! + 15, 2.4, 1.9, 0.9);
        b.ellipse(t[0]! + 0.3, t[1]!, 1.3, 1.3, pal.trim, P.hairBack);
        break;
      }
      case 'twintail': {
        for (const s of [-1, 1]) {
          const t = hp(x, [s * 1.0, -0.62]);
          const ex = t[0]! + s * 2.4 + r.sway * 0.5;
          lock(x, m, P.hairBack, t[0]!, t[1]!, ex, t[1]! + 8, ex - s * 0.6 + r.sway * 0.6, t[1]! + 17, 2.5, 2.3, 0.9);
        }
        break;
      }
      case 'braid': {
        if (r.female) {
          for (const s of [-1, 1]) {
            const t = hp(x, [s * 0.98, -0.35]);
            for (let k = 0; k < 5; k++) b.ellipse(t[0]! + s * 0.7 + r.sway * 0.1 * k, t[1]! + 3.2 + k * 2.2, 1.35, 1.25, m, P.hairBack);
          }
        } else {
          const t = hp(x, [-0.92, -0.1]);
          for (let k = 0; k < 6; k++) b.ellipse(t[0]! - 0.6 + r.sway * 0.12 * k, t[1]! + 2 + k * 2.2, 1.45, 1.3, m, P.hairBack);
        }
        break;
      }
      case 'spiky':
        // 앞 가시 사이로 보이는 뒤쪽 가시 (경계선이 생겨 겹친 숱처럼 보임)
        b.poly(hp(x, [-1.0, 0.2, -1.66, -0.62, -1.2, -0.74, -1.5, -1.44, -0.82, -1.2, -0.62, -1.9, -0.24, -1.3, 0.34, -1.86, 0.5, -1.3, 1.1, -1.46, 1.0, -0.9, 1.1, 0.2]), m, P.hairBack, shade);
        break;
      default:
        break;
    }
  });
}

/** 정수리·앞머리 (앞모습) / 머리 전체 (뒷모습) */
export function drawHairCap(x: Ctx): void {
  const { pal, r, b, hair } = x;
  const m = pal.hair;
  const [rx, ry] = r.d.headR;
  const { x: hx, y: hy } = r.head;
  const shade = hairShade(x);
  const covered = coversHair(x.gear);
  const longSide = hair === 'long' || hair === 'bob' || hair === 'wild' || hair === 'twintail' || (hair === 'braid' && r.female);
  part(x, P.hair, m.line, () => {
    if (r.view === 'F') {
      const fr = fringeOf(hair, r.female);
      const top = covered ? CAP_TOP : hair === 'spiky' ? CAP_SPIKY : hair === 'wild' ? CAP_WILD : fuller(CAP_TOP, false);
      const side = longSide ? [-0.6, 0.96, -0.98, 1.02, -1.12, 0.5] : [-0.64, 0.52, -0.86, 0.58, -1.04, 0.3];
      b.poly(hp(x, [...side, ...top, ...FRINGE[fr]]), m, P.hair, shade);
      if (hair === 'topknot' && !covered) {
        // 정수리 뒤쪽의 작은 상투 + 묶은 끈
        const t = hp(x, [-0.3, -1.3]);
        b.ellipse(t[0]!, t[1]! - 0.9, 2.0, 1.7, m, P.hair);
        b.line(t[0]! - 1, t[1]! + 0.6, t[0]! + 1, t[1]! + 0.6, pal.trim.t[2], P.hair);
      }
      if (hair === 'braid' && r.female && !covered) {
        // 양쪽 경단
        for (const s of [-1, 1]) {
          const t = hp(x, [s * 0.98, -0.5]);
          b.ellipse(t[0]!, t[1]!, 2.4, 2.2, m, P.hair);
        }
      }
      // 머릿결: 정수리에서 앞머리 끝으로 내려오는 어두운 선 + 왼쪽 위의 광택 띠(천사 고리)
      b.setClip([P.hair]);
      const crown = hp(x, [0.1, -1.05]);
      const tips = FRINGE[fr];
      for (let i = 2; i + 1 < tips.length - 2; i += 4) {
        const tx = hx + tips[i]! * rx;
        const ty = hy + tips[i + 1]! * ry;
        b.line(lerpN(crown[0]!, tx, 0.45), lerpN(crown[1]!, ty, 0.45), tx, ty - 1, m.t[1], P.hair);
      }
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (1.08 + k * 0.075);
        const px = hx - 0.6 + Math.cos(a) * rx * 0.78;
        const py = hy - ry * 0.32 + Math.sin(a) * ry * 0.62;
        b.dot(px, py, m.t[3], P.hair);
        if (k % 2 === 0) b.dot(px + 1, py, m.t[3], P.hair);
      }
      b.setClip(null);
    } else {
      const sw = r.sway * 0.06;
      let pts: number[];
      // 모자 아래로는 정수리 장식만 숨기고 길이는 그대로
      const backStyle: HairStyleId = covered ? (hair === 'spiky' || hair === 'topknot' ? 'short' : hair === 'wild' ? 'long' : hair) : hair;
      switch (backStyle) {
        case 'spiky':
          // 앞모습과 같은 크기로 뒤로 쓸어 넘긴 가시
          pts = [-1.12, 0.5, -1.62, -0.2, -1.14, -0.52, -1.62, -1.0, -1.0, -1.06, -1.05, -1.84, -0.48, -1.24, -0.12, -2.0, 0.2, -1.26, 0.74, -1.78, 0.8, -1.06, 1.38, -1.08, 1.06, -0.62, 1.48, -0.42, 1.1, -0.2, 1.14, 0.5, 0.6, 0.94, 0.0, 1.04, -0.6, 0.94];
          break;
        case 'wild':
          pts = [-1.16, 0.4, -1.38, -0.4, -1.12, -0.66, -1.18, -1.04, -0.66, -1.16, -0.4, -1.46, 0.0, -1.24, 0.34, -1.44, 0.62, -1.12, 1.08, -1.06, 1.04, -0.6, 1.32, -0.3, 1.12, 0.4, 1.22, 1.2 + sw, 0.7, 1.0, 0.5, 1.62 + sw, 0.0, 1.2, -0.5, 1.72 + sw, -0.7, 1.1, -1.26, 1.42 + sw];
          break;
        case 'long':
          pts = [-1.18, 0.4, -1.14, -0.5, -0.88, -0.92, -0.4, -1.18, 0.1, -1.22, 0.56, -1.12, 0.94, -0.82, 1.14, -0.36, 1.2, 0.5, 1.22 + sw, 2.0, 0.92 + sw, 3.0, 0.0 + sw, 3.16, -0.92 + sw, 3.0, -1.24 + sw, 2.0];
          break;
        case 'bob':
          pts = [-1.22, 0.5, -1.16, -0.5, -0.9, -0.92, -0.4, -1.18, 0.1, -1.22, 0.56, -1.12, 0.94, -0.82, 1.16, -0.36, 1.22, 0.5, 1.14, 1.16, 0.0, 1.26, -1.14, 1.16];
          break;
        default:
          pts = [-1.12, 0.46, -1.12, -0.5, -0.88, -0.92, -0.4, -1.18, 0.1, -1.22, 0.56, -1.12, 0.94, -0.82, 1.12, -0.36, 1.12, 0.46, 0.6, 0.86, 0.0, 0.96, -0.6, 0.86];
      }
      b.poly(hp(x, backStyle === 'spiky' ? pts : fuller(pts, covered)), m, P.hair, shade);
      // 묶은 머리는 모자 아래로도 늘어짐 (상투만 모자에 가려짐)
      {
        if (hair === 'ponytail') {
          const t = hp(x, [-0.05, -0.36]);
          b.ellipse(t[0]!, t[1]!, 1.4, 1.3, pal.trim, P.hair);
          lock(x, m, P.hair, t[0]!, t[1]! + 1, t[0]! + r.sway * 0.6, t[1]! + 9, t[0]! + r.sway, t[1]! + 15, 2.5, 1.8, 0.8);
        } else if (hair === 'twintail') {
          for (const s of [-1, 1]) {
            const t = hp(x, [s * 0.98, -0.55]);
            const ex = t[0]! + s * 2.4 + r.sway * 0.5;
            lock(x, m, P.hair, t[0]!, t[1]!, ex, t[1]! + 8, ex - s * 0.6 + r.sway * 0.6, t[1]! + 17, 2.5, 2.3, 0.9);
            b.ellipse(t[0]!, t[1]!, 1.3, 1.3, pal.trim, P.hair);
          }
        } else if (hair === 'braid') {
          const ss = r.female ? [-1, 1] : [0];
          for (const s of ss) {
            const t = hp(x, [s * 0.82, r.female ? -0.32 : 0.45]);
            if (r.female) b.ellipse(t[0]!, t[1]!, 2.4, 2.2, m, P.hair);
            for (let k = 0; k < (r.female ? 5 : 6); k++) b.ellipse(t[0]! + r.sway * 0.12 * k, t[1]! + 2.6 + k * 2.2, 1.45, 1.3, m, P.hair);
          }
        } else if (hair === 'topknot' && !covered) {
          const t = hp(x, [0.0, -1.24]);
          b.ellipse(t[0]!, t[1]! - 0.9, 2.0, 1.7, m, P.hair);
          b.line(t[0]! - 1, t[1]! + 0.6, t[0]! + 1, t[1]! + 0.6, pal.trim.t[2], P.hair);
        }
      }
      // 뒷머리 결과 광택
      b.setClip([P.hair]);
      for (let k = 0; k < 8; k++) {
        const a = Math.PI * (1.05 + k * 0.08);
        const px = hx - 0.3 + Math.cos(a) * rx * 0.8;
        const py = hy - ry * 0.25 + Math.sin(a) * ry * 0.66;
        b.dot(px, py, m.t[3], P.hair);
        if (k % 2 === 0) b.dot(px + 1, py, m.t[3], P.hair);
      }
      for (const u of [-0.5, 0.05, 0.55]) b.line(hx + u * rx, hy - ry * 0.6, hx + u * rx * 1.15, hy + ry * 0.75, m.t[1], P.hair);
      b.setClip(null);
    }
  });
}

/** 짐승 귀 (수인) */
export function drawBeastEars(x: Ctx): void {
  const { pal, r, b } = x;
  if (!x.c.ears) return;
  const m = pal.hair;
  const inner = ramp('#e89aa0');
  const front = r.view === 'F';
  part(x, P.hat, m.line, () => {
    for (const s of [-1, 1]) {
      const bx = front ? (s < 0 ? -0.62 : 0.55) : s * 0.6;
      const base = hp(x, [bx - 0.28, -0.92, bx + 0.28, -0.98]);
      const tip = hp(x, [bx + s * 0.25 + (front ? 0.1 : 0), -1.62]);
      b.poly([base[0]!, base[1]!, tip[0]!, tip[1]!, base[2]!, base[3]!], m, P.hat, { k: 'flat', l: s < 0 ? 0.7 : 0.3 });
      if (front || s > 0) {
        const c = hp(x, [bx + s * 0.1, -1.12]);
        b.dot(c[0]!, c[1]!, inner.t[2], P.hat);
        b.dot(c[0]!, c[1]! + 1, inner.t[2], P.hat);
      }
    }
  });
}

// ───────────────────────── 모자·투구 ─────────────────────────

export function drawHeadGear(x: Ctx): void {
  const { pal, r, b, gear } = x;
  if (gear === 'none') return;
  const front = r.view === 'F';
  const helm = pal.helm;
  const trim = pal.trim;
  const gold = pal.gold;
  const P2 = (pts: number[], ox = 0, oy = 0) => hp(x, pts, ox, oy);
  const domeShade = hairShade(x);
  const bone = ramp('#efe4c8', 1.1);
  switch (gear) {
    case 'horned':
    case 'halfhelm':
    case 'plumehelm': {
      part(x, P.hat, helm.line, () => {
        const low = gear === 'halfhelm' ? -0.28 : -0.16;
        b.poly(P2([-1.16, low + 0.1, -1.18, -0.55, -0.92, -0.96, -0.46, -1.22, 0.1, -1.28, 0.6, -1.17, 0.98, -0.88, 1.15, -0.42, 1.13, low]), helm, P.hat, domeShade);
        // 이마 테
        const rim = P2([-1.18, low - 0.12, 1.15, low - 0.16]);
        b.line(rim[0]!, rim[1]!, rim[2]!, rim[3]!, helm.t[0], P.hat);
        b.line(rim[0]!, rim[1]! - 1, rim[2]!, rim[3]! - 1, helm.t[3], P.hat);
        if (front && gear !== 'halfhelm') {
          // 코 가리개
          const n = P2([0.3, low - 0.1]);
          b.rect(Math.round(n[0]!), Math.round(n[1]!), 1, 4, helm.t[1], P.hat);
        }
        if (gear === 'plumehelm') {
          // 뺨 가리개
          const c = P2(front ? [-0.95, low] : [0.95, low]);
          b.rect(Math.round(c[0]! - 1), Math.round(c[1]!), 3, 5, helm.t[1], P.hat);
        }
      });
      if (gear === 'horned') {
        part(x, P.hat, bone.line, () => {
          for (const s of [-1, 1]) {
            const sx = front ? (s < 0 ? -1.0 : 0.95) : s * 0.98;
            const a = P2([sx, -0.62]);
            const m = P2([sx + s * 0.42, -1.0]);
            const t = P2([sx + s * 0.36, -1.58]);
            lock(x, bone, P.hat, a[0]!, a[1]!, m[0]!, m[1]!, t[0]!, t[1]!, 1.5, 1.2, 0.5);
          }
        });
      }
      if (gear === 'plumehelm') drawPlume(x, plumeMat(x), 1.0);
      break;
    }
    case 'circlet': {
      part(x, P.hat, gold.line, () => {
        const a = P2([-1.1, -0.38, 1.08, -0.44]);
        b.line(a[0]!, a[1]!, a[2]!, a[3]!, gold.t[2], P.hat);
        b.line(a[0]!, a[1]! + 1, a[2]!, a[3]! + 1, gold.t[1], P.hat);
        if (front) {
          const g = P2([0.3, -0.42]);
          const gem = x.look.helmet ? ramp(x.look.helmet, 1.2, 0.3) : ramp('#5ab0ff', 1.2);
          b.rect(Math.round(g[0]! - 0.5), Math.round(g[1]! - 0.5), 2, 2, gem.t[2], P.hat);
          b.dot(Math.round(g[0]! - 0.5), Math.round(g[1]! - 0.5), gem.t[3], P.hat);
        }
      });
      break;
    }
    case 'browguard': {
      part(x, P.hat, helm.line, () => {
        b.poly(P2([-1.1, -0.62, 1.1, -0.66, 1.08, -0.3, -1.1, -0.26]), helm, P.hat, { k: 'flat', l: 0.55 });
        const a = P2([-1.1, -0.6, 1.1, -0.64]);
        b.line(a[0]!, a[1]!, a[2]!, a[3]!, helm.t[3], P.hat);
      });
      drawTies(x, trim);
      break;
    }
    case 'headband': {
      part(x, P.hat, trim.line, () => {
        const a = P2([-1.12, -0.46, 1.1, -0.52]);
        b.line(a[0]!, a[1]!, a[2]!, a[3]!, trim.t[2], P.hat);
      });
      drawTies(x, trim);
      break;
    }
    case 'bandana': {
      part(x, P.hat, trim.line, () => {
        b.poly(P2([-1.16, -0.1, -1.16, -0.6, -0.9, -1.0, -0.4, -1.24, 0.15, -1.28, 0.65, -1.15, 1.0, -0.86, 1.14, -0.4, 1.12, -0.28, 0.3, -0.42, -0.5, -0.3]), trim, P.hat, domeShade);
        // 물방울 무늬
        b.setClip([P.hat]);
        const d1 = P2([-0.2, -0.9, 0.5, -0.75, -0.7, -0.6]);
        for (let k = 0; k < 6; k += 2) b.dot(d1[k]!, d1[k + 1]!, trim.t[3], P.hat);
        b.setClip(null);
      });
      drawTies(x, trim);
      break;
    }
    case 'veil': {
      const white = pal.white;
      const veil = x.look.body2 ? ramp(mixColor('#f4f2ec', pal.trimHex, 0.25), 0.9) : white;
      part(x, P.hat, veil.line, () => {
        if (front) {
          b.poly(P2([-1.0, 1.4, -1.28, 0.6, -1.24, -0.4, -0.92, -0.98, -0.4, -1.26, 0.2, -1.3, 0.7, -1.16, 1.06, -0.8, 1.2, -0.3, 1.0, -0.3, 0.6, -0.55, 0.0, -0.6, -0.55, -0.45, -0.75, 0.2, -0.6, 1.2, -0.75, 1.9, -1.15, 2.2]), veil, P.hat, domeShade);
        } else {
          b.poly(P2([-1.3, 0.5, -1.2, -0.5, -0.9, -0.96, -0.4, -1.24, 0.2, -1.28, 0.7, -1.14, 1.06, -0.8, 1.24, -0.2, 1.32, 1.0, 1.2, 2.4, 0.0, 2.6, -1.2, 2.4]), veil, P.hat, domeShade);
        }
        const g = P2([-1.1, -0.5, 1.12, -0.52]);
        b.setClip([P.hat]);
        b.line(g[0]!, g[1]!, g[2]!, g[3]!, gold.t[2], P.hat);
        b.setClip(null);
      });
      break;
    }
    case 'pointhat': {
      // 넓은 챙 + 뒤로 꺾인 고깔
      const m = ramp(pal.mainHex, 1.05, 0.15);
      part(x, P.hat, m.line, () => {
        const brim = P2([0.0, -0.78]);
        b.ellipse(brim[0]!, brim[1]!, 10.5, 2.4, m, P.hat);
        const lean = front ? -1 : -0.6;
        b.poly(P2([-0.82, -0.82, -0.6, -1.6, -0.3 + lean * 0.3, -2.3, lean * 0.9, -2.85, lean * 1.25, -2.7, 0.0 + lean * 0.2, -2.0, 0.4, -1.3, 0.86, -0.85]), m, P.hat, { k: 'cyl', cx: brim[0]! - 1, hw: 6 });
        b.setClip([P.hat]);
        const band = P2([-0.86, -0.98, 0.88, -1.02]);
        b.line(band[0]!, band[1]!, band[2]!, band[3]!, trim.t[2], P.hat);
        b.line(band[0]!, band[1]! + 1, band[2]!, band[3]! + 1, trim.t[1], P.hat);
        b.setClip(null);
      });
      break;
    }
    case 'mitre': {
      const m = pal.white;
      part(x, P.hat, m.line, () => {
        b.poly(P2([-0.92, -0.55, -0.98, -1.3, -0.5, -2.05, 0.05, -2.45, 0.55, -2.05, 1.0, -1.3, 0.92, -0.58]), m, P.hat, { k: 'cyl', cx: r.head.x - 1, hw: 6 });
        b.setClip([P.hat]);
        const c = P2([0.05, -2.3, 0.05, -0.6]);
        b.line(c[0]!, c[1]!, c[2]!, c[3]!, gold.t[2], P.hat);
        const c2 = P2([-0.4, -1.45, 0.5, -1.45]);
        b.line(c2[0]!, c2[1]!, c2[2]!, c2[3]!, gold.t[2], P.hat);
        const band = P2([-0.95, -0.75, 0.95, -0.78]);
        b.line(band[0]!, band[1]!, band[2]!, band[3]!, trim.t[2], P.hat);
        b.setClip(null);
      });
      break;
    }
    case 'tallcap': {
      const m = ramp(mixColor(pal.mainHex, '#1a1420', 0.6), 1.1);
      part(x, P.hat, m.line, () => {
        b.poly(P2([-0.75, -0.7, -0.85, -1.4, -0.6, -2.4, 0.5, -2.5, 0.75, -1.4, 0.72, -0.72]), m, P.hat, { k: 'cyl', cx: r.head.x - 0.8, hw: 5 });
        b.setClip([P.hat]);
        const band = P2([-0.85, -0.95, 0.75, -0.98]);
        b.line(band[0]!, band[1]!, band[2]!, band[3]!, trim.t[2], P.hat);
        b.setClip(null);
      });
      break;
    }
    case 'ribbon': {
      part(x, P.hat, trim.line, () => {
        const c = P2(front ? [-0.85, -0.85] : [0.0, -0.75]);
        b.ellipse(c[0]! - 2.6, c[1]! - 0.6, 2.4, 1.8, trim, P.hat);
        b.ellipse(c[0]! + 2.6, c[1]! - 0.6, 2.4, 1.8, trim, P.hat);
        b.ellipse(c[0]!, c[1]!, 1.2, 1.2, trim, P.hat);
        b.poly([c[0]! - 0.6, c[1]!, c[0]! + 0.6, c[1]!, c[0]! + 2 + r.sway * 0.3, c[1]! + 5, c[0]! + 0.6 + r.sway * 0.3, c[1]! + 5], trim, P.hat, { k: 'flat', l: 0.2 });
      });
      break;
    }
    case 'featherhat':
    case 'beret': {
      const isBard = x.outfit === 'bard' || gear === 'beret';
      const hatHex = x.look.helmet ?? (isBard ? mixColor(pal.mainHex, '#7a1c34', 0.55) : mixColor(pal.mainHex, '#2a4a20', 0.3));
      const m = ramp(hatHex, 1.05, 0.15);
      part(x, P.hat, m.line, () => {
        const c = P2([-0.05, -0.92]);
        if (gear === 'beret') b.ellipse(c[0]! - 0.8, c[1]! - 0.6, 7.6, 3.0, m, P.hat);
        else {
          b.ellipse(c[0]!, c[1]! + 0.6, 9.2, 2.2, m, P.hat);
          b.ellipse(c[0]! - 0.4, c[1]! - 1.4, 5.4, 3.6, m, P.hat);
          b.setClip([P.hat]);
          b.line(c[0]! - 5.4, c[1]! + 0.2, c[0]! + 5, c[1]! + 0.2, trim.t[2], P.hat);
          b.setClip(null);
        }
      });
      drawFeather(x, P2([front ? -0.6 : 0.4, -1.15]), front ? -1 : 1);
      break;
    }
    case 'robinhat': {
      const m = ramp(mixColor(pal.mainHex, '#3a6a2a', 0.35), 1.05, 0.15);
      part(x, P.hat, m.line, () => {
        b.poly(P2([-1.12, -0.5, -0.9, -1.05, -0.2, -1.42, 0.5, -1.25, 1.0, -0.9, 1.14, -0.52, 0.4, -0.66, -0.4, -0.6]), m, P.hat, domeShade);
        // 뒤로 뾰족한 끝
        b.poly(P2([-0.9, -1.0, -1.7, -0.8, -1.1, -0.6]), m, P.hat, { k: 'flat', l: 0.3 });
      });
      drawFeather(x, P2([-0.5, -1.1]), -1);
      break;
    }
    case 'featherclip': {
      drawFeather(x, P2(front ? [-0.95, -0.6] : [0.9, -0.6]), front ? -1 : 1, true);
      break;
    }
    case 'crest': {
      part(x, P.hat, helm.line, () => {
        const a = P2([-1.12, -0.42, 1.1, -0.48]);
        b.line(a[0]!, a[1]!, a[2]!, a[3]!, gold.t[2], P.hat);
        b.line(a[0]!, a[1]! + 1, a[2]!, a[3]! + 1, gold.t[1], P.hat);
      });
      drawPlume(x, plumeMat(x), 0.7);
      break;
    }
    default:
      break;
  }
}

/** 투구 깃 색: 붉은 솔에 장식 색이 조금 */
function plumeMat(x: Ctx): Mat {
  return ramp(mixColor('#c8302a', x.pal.trimHex, 0.2), 1.1, 0.2);
}

/** 머리띠·두건 뒤로 늘어진 끈 */
function drawTies(x: Ctx, m: Mat): void {
  const { r, b } = x;
  const c = hp(x, r.view === 'F' ? [-1.05, -0.4] : [0.0, -0.3]);
  const s = r.sway * 0.5;
  if (r.view === 'F') {
    part(x, P.hat, m.line, () => {
      b.poly([c[0]!, c[1]! - 0.5, c[0]! + 1, c[1]! + 0.8, c[0]! - 3.6 + s, c[1]! + 6, c[0]! - 4.6 + s, c[1]! + 4.6], m, P.hat, { k: 'flat', l: 0.3 });
      b.poly([c[0]!, c[1]! - 0.5, c[0]! + 0.6, c[1]! + 0.8, c[0]! - 1.4 + s, c[1]! + 7.5, c[0]! - 2.6 + s, c[1]! + 6.8], m, P.hat, { k: 'flat', l: 0.6 });
    });
  } else {
    // 뒤통수의 작은 매듭 + 짧게 갈라진 끈 (경계선 없이 가볍게)
    part(x, P.hat, null, () => {
      const k = hp(x, [0.05, -0.48]);
      b.rect(Math.round(k[0]! - 1), Math.round(k[1]!), 2, 2, m.t[2], P.hat);
      b.line(k[0]! - 1, k[1]! + 2, k[0]! - 2 + s, k[1]! + 4.5, m.t[1], P.hat);
      b.line(k[0]! + 1, k[1]! + 2, k[0]! + 1.5 + s, k[1]! + 5, m.t[2], P.hat);
    });
  }
}

/** 투구 위 깃 장식 (앞에서 뒤로 이어진 붉은 솔) */
function drawPlume(x: Ctx, m: Mat, size: number): void {
  const { r, b } = x;
  part(x, P.hat, m.line, () => {
    const pts: number[] = [];
    const n = 6;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (0.1 + (0.8 * k) / n);
      const u = -Math.cos(a) * (r.view === 'F' ? 0.95 : 0.6);
      const v = -1.15 - Math.sin(a) * 0.45 * size;
      pts.push(u, v);
    }
    const top = hp(x, pts);
    for (let k = 0; k < top.length; k += 2) b.ellipse(top[k]!, top[k + 1]!, 1.9, 1.9 + size * 0.6, m, P.hat);
  });
}

/** 깃털 하나 (뿌리 p, 뒤쪽 방향 s) */
function drawFeather(x: Ctx, p: number[], s: number, pair = false): void {
  const { pal, b, r } = x;
  const white = pal.white;
  const sw = r.sway * 0.4;
  part(x, P.hat, white.line, () => {
    const x0 = p[0]!;
    const y0 = p[1]!;
    b.capsule(x0, y0, x0 + s * 4 + sw, y0 - 5, 1.0, 1.5, white, P.hat);
    b.capsule(x0 + s * 4 + sw, y0 - 5, x0 + s * 7 + sw, y0 - 6.5, 1.5, 0.6, white, P.hat);
    b.line(x0, y0, x0 + s * 6.5 + sw, y0 - 6.2, pal.trim.t[2], P.hat);
    if (pair) {
      b.capsule(x0, y0 + 1, x0 + s * 5 + sw, y0 - 2, 0.9, 1.3, ramp(mixColor(x.pal.trimHex, '#ffffff', 0.4)), P.hat);
      b.ellipse(x0, y0 + 0.5, 1.2, 1.2, pal.leather, P.hat);
    }
  });
}

// ───────────────────────── 무기 ─────────────────────────

/** 날의 반쪽씩 밝게/어둡게 (u 부호 기준) */
function bladeShade(hand: Pt, a: number, hi = 0.95, lo = 0.3): Shade {
  const dv = dirv(a);
  const ux = -dv.y;
  const uy = dv.x;
  // 빛(왼쪽 위)을 향한 쪽이 밝음
  const lit = ux * -0.62 + uy * -0.5 >= 0 ? 1 : -1;
  return { k: 'fn', f: (px, py) => (((px - hand.x) * ux + (py - hand.y) * uy) * lit > 0 ? hi : lo) };
}

export function drawWeapon(x: Ctx, shape: IconShape | undefined, hand: Pt, a: number, id: number): void {
  if (!shape) return;
  const { pal, b } = x;
  const blade = pal.blade;
  const wpn = pal.wpn;
  const gold = pal.gold;
  const leather = pal.leather;
  const wood = pal.wood;
  const W = (pts: number[]) => wpnPoly(hand, a, pts);
  const at = (u: number, v: number) => wpnAt(hand, a, u, v);
  const flat = (l: number): Shade => ({ k: 'flat', l });
  switch (shape) {
    case 'sword': {
      part(x, id, blade.line, () => {
        b.poly(W([-1.3, 2.2, 1.3, 2.2, 1.3, 18.5, 0, 21.5, -1.3, 18.5]), blade, id, bladeShade(hand, a));
        // 피홈
        const g0 = at(0, 4);
        const g1 = at(0, 17);
        b.line(g0.x, g0.y, g1.x, g1.y, wpn.t[2], id);
        b.poly(W([-3.6, 1.0, 3.6, 1.0, 3.6, 2.4, -3.6, 2.4]), gold, id, flat(0.6));
        b.poly(W([-0.8, -2.8, 0.8, -2.8, 0.8, 1.0, -0.8, 1.0]), leather, id, flat(0.5));
        const pm = at(0, -3.4);
        b.ellipse(pm.x, pm.y, 1.2, 1.2, gold, id);
      });
      break;
    }
    case 'dualsword': {
      part(x, id, blade.line, () => {
        b.poly(W([-1.5, 2.0, 1.5, 2.0, 1.7, 11, 0, 15, -1.7, 11]), blade, id, bladeShade(hand, a));
        b.poly(W([-3.0, 0.8, 3.0, 0.8, 3.0, 2.2, -3.0, 2.2]), gold, id, flat(0.6));
        b.poly(W([-0.8, -2.4, 0.8, -2.4, 0.8, 0.8, -0.8, 0.8]), leather, id, flat(0.5));
        const g0 = at(0, 3.5);
        const g1 = at(0, 11);
        b.line(g0.x, g0.y, g1.x, g1.y, wpn.t[2], id);
      });
      break;
    }
    case 'dagger': {
      part(x, id, blade.line, () => {
        b.poly(W([-1.1, 1.8, 1.1, 1.8, 0.9, 7.5, 0, 10, -0.9, 7.5]), blade, id, bladeShade(hand, a));
        b.poly(W([-2.6, 0.8, 2.6, 0.8, 2.6, 2.0, -2.6, 2.0]), wpn, id, flat(0.6));
        b.poly(W([-0.7, -2.0, 0.7, -2.0, 0.7, 0.8, -0.7, 0.8]), leather, id, flat(0.5));
      });
      break;
    }
    case 'axe': {
      part(x, id, wood.line, () => b.poly(W([-0.9, -6, 0.9, -6, 0.9, 19, -0.9, 19]), wood, id, bladeShade(hand, a, 0.8, 0.3)));
      part(x, id, blade.line, () => {
        // 큰 초승달 도끼날 (앞쪽) + 뒷날
        b.poly(W([0.6, 10, 4.0, 7.8, 7.6, 8.2, 9.4, 12, 9.2, 17, 7.4, 20.8, 3.6, 20.2, 0.6, 17.6]), blade, id, { k: 'fn', f: (px, py) => {
          const p = at(6.5, 14);
          return (px - p.x) * -0.62 + (py - p.y) * -0.5 > 0 ? 0.95 : 0.35;
        } });
        b.poly(W([-0.6, 12, -3.8, 11, -4.4, 15.2, -0.6, 16.2]), blade, id, flat(0.3));
        const e0 = at(8.8, 10.4);
        const e1 = at(8.4, 18.4);
        b.line(e0.x, e0.y, e1.x, e1.y, wpn.t[3], id);
      });
      break;
    }
    case 'mace': {
      part(x, id, wood.line, () => b.poly(W([-0.8, -3, 0.8, -3, 0.8, 11, -0.8, 11]), mixMat(wood, gold, 0.3), id, bladeShade(hand, a, 0.8, 0.3)));
      part(x, id, blade.line, () => {
        const c = at(0, 13.2);
        // 날개 달린 머리
        for (const k of [-1, 1]) b.poly(W([k * 0.6, 10, k * 4.4, 11, k * 4.4, 15.6, k * 0.6, 16.6]), blade, id, flat(k < 0 ? 0.9 : 0.3));
        b.ellipse(c.x, c.y, 2.9, 2.9, mixMat(blade, wpn, 0.35), id);
        const t = at(0, 17.2);
        b.dot(t.x, t.y, wpn.t[3], id);
      });
      break;
    }
    case 'stick':
    case 'bone': {
      part(x, id, wood.line, () => {
        b.poly(W([-0.9, -3, 0.9, -3, 1.9, 12.5, 0, 14.5, -1.9, 12.5]), wood, id, bladeShade(hand, a, 0.85, 0.3));
        const k = at(0.6, 8);
        b.dot(k.x, k.y, wood.t[0], id);
      });
      break;
    }
    case 'staff':
    case 'orb':
    case 'gem':
    case 'star':
    case 'wing': {
      // 긴 지팡이: 손은 가운데보다 조금 아래, 끝에 보석과 고리
      part(x, id, wood.line, () => b.poly(W([-0.9, -21, 0.9, -21, 0.9, 23, -0.9, 23]), wood, id, bladeShade(hand, a, 0.8, 0.3)));
      part(x, id, gold.line, () => {
        const c = at(0, 26);
        const ring = at(0, 25.5);
        b.ellipse(ring.x, ring.y, 3.4, 3.4, gold, id);
        b.ellipse(ring.x, ring.y, 2.0, 2.0, wpn, id);
        b.ellipse(c.x - 0.4, c.y - 0.4, 0.8, 0.8, flatOf(pack(255, 255, 255)), id);
        const tip = at(0, 23.2);
        b.dot(tip.x, tip.y, gold.t[3], id);
      });
      break;
    }
    case 'arrow': {
      // 창 (긴 자루 + 잎 모양 날)
      part(x, id, wood.line, () => b.poly(W([-0.8, -12, 0.8, -12, 0.8, 18, -0.8, 18]), wood, id, bladeShade(hand, a, 0.8, 0.3)));
      part(x, id, blade.line, () => b.poly(W([0, 17, 1.8, 20, 0, 25.5, -1.8, 20]), blade, id, bladeShade(hand, a)));
      break;
    }
    case 'claw': {
      // 주먹에 끼운 갈퀴 세 개 (앞으로)
      part(x, id, blade.line, () => {
        for (const u of [-1.4, 0, 1.4]) b.poly(W([u - 0.5, 1.2, u + 0.5, 1.2, u + 0.9, 6.5 - Math.abs(u) * 0.4, u + 0.2, 7.2 - Math.abs(u) * 0.4]), blade, id, flat(u < 0 ? 0.9 : 0.4));
        b.poly(W([-2.2, -1.0, 2.2, -1.0, 2.2, 1.4, -2.2, 1.4]), wpn, id, flat(0.6));
      });
      break;
    }
    case 'gauntlet': {
      // 털 소매 + 큰 갈고리 발톱
      const fur = ramp(mixColor(x.pal.mainHex, '#efe2c8', 0.5), 0.9);
      part(x, id, fur.line, () => {
        b.poly(W([-2.6, -4.5, 2.6, -4.5, 2.8, -1.5, -2.8, -1.5]), fur, id, flat(0.6));
        b.ellipse(hand.x, hand.y, 2.4, 2.4, mixMat(leather, wpn, 0.3), id);
      });
      part(x, id, blade.line, () => {
        for (const u of [-1.6, 0, 1.6]) b.poly(W([u - 0.6, 1.4, u + 0.6, 1.4, u + 1.6, 6.2, u + 1.0, 8.6 - Math.abs(u) * 0.5, u - 0.2, 5.6]), mixMat(blade, ramp('#fff6e0'), 0.3), id, flat(u < 0 ? 0.95 : 0.45));
      });
      break;
    }
    case 'bow': {
      // 세운 활: 손잡이를 쥔 손이 가운데. 시위는 drawBowString 에서
      const bw = mixMat(wood, wpn, 0.3);
      part(x, id, bw.line, () => {
        const pts: number[] = [];
        for (let k = -6; k <= 6; k++) {
          const v = k * 1.75;
          const u = 2.6 - Math.abs(k) * Math.abs(k) * 0.07 - (Math.abs(k) > 5 ? -0.6 : 0);
          pts.push(u, v);
        }
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const p0 = wpnAt(hand, a, pts[i]! - 0.0, pts[i + 1]!);
          const p1 = wpnAt(hand, a, pts[i + 2]!, pts[i + 3]!);
          b.capsule(p0.x, p0.y, p1.x, p1.y, 1.05, 1.05, bw, id);
        }
        const g = at(0.4, 0);
        b.ellipse(g.x, g.y, 1.3, 1.8, leather, id);
      });
      break;
    }
    case 'lute': {
      const body = mixMat(ramp('#a8682e', 1.05), wpn, 0.25);
      part(x, id, body.line, () => {
        // 몸통 (둥근 배) + 목 + 줄감개
        const c = at(0, -3.5);
        b.ellipse(c.x, c.y, 4.2, 4.2, body, id);
        const c2 = at(0, -0.2);
        b.ellipse(c2.x, c2.y, 3.0, 3.0, body, id);
        b.poly(W([-0.9, 1.5, 0.9, 1.5, 0.8, 11.5, -0.8, 11.5]), ramp('#5a3418'), id, flat(0.5));
        b.poly(W([-1.3, 11.5, 1.3, 11.5, 1.6, 14.5, -1.0, 14.5]), ramp('#5a3418'), id, flat(0.7));
        const h = at(0, -3.2);
        b.ellipse(h.x, h.y, 1.3, 1.3, flatOf(pack(40, 24, 14)), id);
        const s0 = at(0, -6.5);
        const s1 = at(0, 11);
        b.line(s0.x, s0.y, s1.x, s1.y, gold.t[3], id);
      });
      break;
    }
    case 'book':
    case 'scroll': {
      const cover = mixMat(ramp('#6a2a3a', 1.05), wpn, 0.45);
      const open = x.r.glow >= 0.75;
      part(x, id, cover.line, () => {
        const c = pt(hand.x + 0.5, hand.y - 2.5);
        if (open) {
          // 펼친 책
          b.poly([c.x - 4.5, c.y - 1.5, c.x, c.y - 0.5, c.x + 4.5, c.y - 1.5, c.x + 4.5, c.y + 2.5, c.x, c.y + 3.5, c.x - 4.5, c.y + 2.5], x.pal.white, id, flat(0.6));
          b.line(c.x, c.y - 0.5, c.x, c.y + 3.5, cover.t[1], id);
          b.line(c.x - 3.5, c.y + 0.5, c.x - 1, c.y + 1, x.pal.white.t[0], id);
          b.line(c.x + 1, c.y + 1, c.x + 3.5, c.y + 0.5, x.pal.white.t[0], id);
        } else {
          b.poly([c.x - 3, c.y - 3.5, c.x + 2.5, c.y - 4, c.x + 3, c.y + 3, c.x - 2.5, c.y + 3.5], cover, id, { k: 'cyl', cx: c.x - 0.5, hw: 4 });
          b.line(c.x - 2.2, c.y + 3.6, c.x + 2.6, c.y + 3.1, x.pal.white.t[2], id);
          b.dot(c.x, c.y, gold.t[3], id);
          b.dot(c.x - 2, c.y - 3, gold.t[2], id);
          b.dot(c.x + 2, c.y - 3.4, gold.t[2], id);
        }
      });
      break;
    }
    default: {
      part(x, id, wood.line, () => b.poly(W([-0.9, -3, 0.9, -3, 1.4, 12, -1.4, 12]), wood, id, bladeShade(hand, a, 0.8, 0.3)));
    }
  }
}

function flatOf(c: number): Mat {
  return { t: [c, c, c, c], line: c };
}

function mixMat(a: Mat, b: Mat, t: number): Mat {
  return {
    t: [mixPacked(a.t[0], b.t[0], t), mixPacked(a.t[1], b.t[1], t), mixPacked(a.t[2], b.t[2], t), mixPacked(a.t[3], b.t[3], t)],
    line: mixPacked(a.line, b.line, t),
  };
}

/** 활시위 (+ 메긴 화살). grip 은 활을 쥔 손, pullHand 는 시위를 당기는 손 */
export function drawBowString(x: Ctx, grip: Pt, a: number, pullHand: Pt | null): void {
  const { b, pal, r } = x;
  const top = wpnAt(grip, a, 2.6 - 36 * 0.07 + 0.6, 10.5);
  const bot = wpnAt(grip, a, 2.6 - 36 * 0.07 + 0.6, -10.5);
  const str = pack(232, 228, 210);
  part(x, P.fx, null, () => {
    if (pullHand && r.pull > 0) {
      b.line(top.x, top.y, pullHand.x, pullHand.y, str, P.fx);
      b.line(pullHand.x, pullHand.y, bot.x, bot.y, str, P.fx);
    } else {
      b.line(top.x, top.y, bot.x, bot.y, str, P.fx);
    }
    if (r.nock && pullHand) {
      // 화살: 당기는 손에서 활 앞으로
      const d = dirv(a + Math.PI / 2);
      const tipX = grip.x + d.x * 7;
      const tipY = grip.y + d.y * 7;
      b.line(pullHand.x, pullHand.y, tipX, tipY, pal.wood.t[3], P.fx);
      b.dot(tipX, tipY, pal.blade.t[3], P.fx);
      b.dot(tipX - d.x, tipY - d.y, pal.blade.t[2], P.fx);
      b.dot(pullHand.x - d.x, pullHand.y - d.y, pack(200, 60, 50), P.fx);
    }
  });
}

// ───────────────────────── 방패 ─────────────────────────

export function drawShield(x: Ctx, hand: Pt): void {
  const { pal, r, b } = x;
  const hex = x.look.shield ?? '#8a6a45';
  const m = pal.shield;
  // 나무색 방패는 쇠 테두리, 쇠 방패는 금 테두리
  const [h, s] = toHsl(parseColor(hex));
  const wooden = h > 0.04 && h < 0.14 && s > 0.2;
  const rim = wooden ? pal.metal : pal.gold;
  const front = r.view === 'F';
  part(x, P.shield, m.line, () => {
    if (front) {
      // 둥근 방패: 테두리 + 판 + 가운데 돌기 + 징
      const cx = hand.x - 0.4;
      const cy = hand.y - 4.4;
      const rx = 4.8;
      const ry = 6.1;
      b.ellipse(cx, cy, rx, ry, rim, P.shield);
      b.ellipse(cx, cy, rx - 1.15, ry - 1.2, m, P.shield);
      b.setClip([P.shield]);
      b.line(cx + 0.5, cy - ry + 1.5, cx + 0.5, cy + ry - 1.5, m.t[1], P.shield);
      b.line(cx - rx + 1.5, cy + 0.5, cx + rx - 1.5, cy + 0.5, m.t[1], P.shield);
      for (const [dx, dy] of [[-2.6, -3.4], [2.4, -3.4], [-2.6, 3.6], [2.4, 3.6]] as const) b.dot(cx + dx, cy + dy, rim.t[3], P.shield);
      b.setClip(null);
      b.ellipse(cx, cy, 1.6, 1.6, pal.metal, P.shield);
    } else {
      // 뒷모습: 비스듬히 보이는 방패 뒷면 (테두리 + 손잡이 끈)
      const cx = hand.x - 0.8;
      const cy = hand.y - 4.2;
      b.ellipse(cx, cy, 3.4, 6.0, rim, P.shield);
      b.ellipse(cx + 0.4, cy, 2.4, 4.9, ramp(mixColor(hex, '#2a1c12', 0.45)), P.shield);
      b.setClip([P.shield]);
      b.line(cx - 1.5, cy - 1, cx + 2, cy - 1, pal.leather.t[3], P.shield);
      b.line(cx - 1.5, cy + 2, cx + 2, cy + 2, pal.leather.t[2], P.shield);
      b.setClip(null);
    }
  });
}

// ───────────────────────── 빛·궤적·기운 ─────────────────────────

/** 손의 빛 (시전·기술) */
export function drawGlow(x: Ctx, at: Pt, k: number): void {
  if (k <= 0) return;
  const { b } = x;
  const c = packColor(x.look.weaponColor ?? '#9fd3ff');
  const white = pack(255, 255, 240);
  const R = 2 + k * 2.5;
  for (let yy = Math.floor(at.y - R - 1); yy <= at.y + R + 1; yy++) {
    for (let xx = Math.floor(at.x - R - 1); xx <= at.x + R + 1; xx++) {
      const d = Math.hypot(xx + 0.5 - at.x, yy + 0.5 - at.y);
      if (d > R) continue;
      const t = 1 - d / R;
      if (t > 0.6) b.glow(xx, yy, white, Math.min(1, t * 1.2 * k + 0.2));
      else b.glow(xx, yy, c, t * 0.9 * k + 0.12);
    }
  }
  if (k >= 0.75) {
    // 반짝이 (+ 모양)
    const s = Math.round(R + 2);
    for (const [dx, dy] of [[s, -s + 1], [-s, -s + 2], [s - 1, s - 1]] as const) {
      b.glow(at.x + dx, at.y + dy, white, 0.95);
      b.glow(at.x + dx + 1, at.y + dy, c, 0.7);
      b.glow(at.x + dx - 1, at.y + dy, c, 0.7);
      b.glow(at.x + dx, at.y + dy + 1, c, 0.7);
      b.glow(at.x + dx, at.y + dy - 1, c, 0.7);
    }
  }
}

/** 몸 밖(빈 칸·반투명 칸)에만 빛 점을 찍음: 궤적이 얼굴·몸 위를 덮지 않고 몸 뒤로 지나가 보이게 */
function glowOutside(b: PixelBuf, x: number, y: number, c: number, a: number): void {
  const p = b.partAt(x, y);
  if (p === 0 || p === SOFT_PART) b.glow(x, y, c, a);
}

/** 휘두르는 궤적 (공격 두 번째 그림): 어깨를 중심으로 위 → 앞 호 */
export function drawTrail(x: Ctx): void {
  const { r, b } = x;
  if (!r.trail) return;
  const c = packColor(mixColor(x.look.weaponColor ?? '#ffffff', '#ffffff', 0.6));
  if (r.trail === 2) {
    // 찌르기: 앞으로 뻗은 선
    for (let k = 0; k < 9; k++) {
      const xx = r.haN.x + 3 + k;
      glowOutside(b, xx, r.haN.y - 1, c, 0.75 - k * 0.06);
      glowOutside(b, xx, r.haN.y + 1, c, 0.5 - k * 0.05);
    }
    return;
  }
  const cx = r.shN.x + 1;
  const cy = r.shN.y + 2;
  const R0 = 17;
  for (let a = -0.2; a < 1.9; a += 0.035) {
    const t = a / 1.9;
    // a: 위(0) → 앞(π/2 넘어)
    const ang = Math.PI - 0.15 - a;
    for (let w = 0; w < 3; w++) {
      const rr = R0 - w * 1.4;
      glowOutside(b, cx + Math.sin(ang) * rr, cy + Math.cos(ang) * rr, c, (0.75 - w * 0.2) * (0.35 + t * 0.65));
    }
  }
}

/** 야수화 기운: 실루엣 둘레의 어두운 붉은 아지랑이 (외곽선 뒤에) */
export function drawBeastAura(x: Ctx, phase: number): void {
  const { b } = x;
  const { w, h, part: pa } = b;
  const bb = b.bounds();
  if (!bb) return;
  const rgb = pack(96, 8, 36) & 0xffffff;
  const at = (a: number) => (((Math.round(a * 255) & 255) << 24) | rgb) >>> 0;
  const x0 = Math.max(2, bb.x + b.ox - 2);
  const x1 = Math.min(w - 3, bb.x + b.ox + bb.w + 1);
  const y0 = Math.max(4, bb.y + b.oy - 2);
  const y1 = Math.min(h - 3, bb.y + b.oy + bb.h + 1);
  const solid = (j: number) => pa[j] !== 0 && pa[j] !== SOFT_PART;
  const ring1: number[] = [];
  const ring2: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let xx = x0; xx <= x1; xx++) {
      const i = y * w + xx;
      if (pa[i] !== 0) continue;
      if (solid(i - 1) || solid(i + 1) || solid(i - w) || solid(i + w)) ring1.push(i);
      else if (((xx + y + phase) & 1) === 0 && (solid(i - 2) || solid(i + 2) || solid(i - 2 * w) || solid(i + 2 * w) || solid(i - w - 1) || solid(i - w + 1) || solid(i + w - 1) || solid(i + w + 1))) ring2.push(i);
    }
  }
  for (const i of ring1) b.setSoft(i, at(0.34));
  for (const i of ring2) b.setSoft(i, at(0.18));
  // 머리·어깨 위로 피어오르는 기운 (그림마다 자리를 바꿈)
  for (let k = 0; k < 4; k++) {
    const cx = x0 + 3 + ((k * 7 + phase * 5) % Math.max(1, x1 - x0 - 5));
    let top = -1;
    for (let y = y0; y <= y1 && top < 0; y++) if (solid(y * w + cx)) top = y;
    if (top < 0) continue;
    const len = 2 + ((k + phase) % 3);
    for (let d = 2; d < 2 + len; d++) {
      const i = (top - d - ((phase + k) & 1)) * w + cx;
      if (i > 0 && pa[i] === 0) b.setSoft(i, at(0.3 - d * 0.04));
    }
  }
}

/** 빛나는 붉은 눈 */
export function drawBeastEyes(x: Ctx): void {
  const { r, b } = x;
  if (!r.beast || r.view !== 'F') return;
  const HX = Math.round(r.head.x);
  const HY = Math.round(r.head.y + 0.6);
  const red = pack(255, 60, 40);
  for (const ex of [HX - 1, HX + 2]) {
    b.glow(ex - 1, HY, red, 0.35);
    b.glow(ex + 1, HY, red, 0.35);
  }
}

