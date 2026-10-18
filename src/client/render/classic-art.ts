// 고전 어둠의 전설 풍 도트 캐릭터 한 장 그리기 (DOM 없음).
// 원작 화면처럼 머리:몸 ≈ 1:5, 키 ≈ 60px(1.9칸)의 날씬한 캐릭터를 작은 픽셀 버퍼에 직접 찍습니다.
// 관절(어깨·팔꿈치·손·엉덩이·무릎·발목)을 자세마다 정하고(classic-rig), 팔다리는 원기둥, 몸통·옷·머리카락은
// 다각형으로 칠합니다(classic-wear, classic-gear). 부위가 겹치는 곳에는 어두운 경계선, 실루엣 둘레에는 1px 외곽선.
// 기본 그림은 오른쪽을 바라보는 3/4 시점(앞: 오른쪽 아래, 뒤: 오른쪽 위)이고, 왼쪽은 그릴 때 좌우를 뒤집습니다.
import type { ClassId } from '../../shared/constants';
import type { HumanLook } from '../../shared/types';
import { drawBeastAura, drawBeastEars, drawBeastEyes, drawBowString, drawEar, drawFace, drawGlow, drawHairBackLayer, drawHairCap, drawHead, drawHeadGear, drawShield, drawTrail, drawWeapon, showsEar } from './classic-gear';
import { P, costumeOf, hairStyleOf, headGearOf, pt, wpnAt, type ClassicFrame, type Ctx, type Pt } from './classic-kit';
import { buildClassicPalette, type ClassicPalette } from './classic-palette';
import { OUTLINE_PART, PixelBuf, pack } from './classic-raster';
import { computeRig } from './classic-rig';
import { drawArm, drawCape, drawHand, drawLeg, drawNeck, drawPauldron, drawQuiver, drawScarf, drawTail, drawTorso } from './classic-wear';

export type { ClassicAnim, ClassicFrame, ClassicView, ClassicHeadGear, Costume, HairStyleId } from './classic-kit';
export { HAIR_F, HAIR_M, costumeOf, gripOf, hairStyleOf, headGearOf } from './classic-kit';

/** 작업 버퍼 크기와 발 위치 (버퍼 좌표) */
export const ART_W = 112;
export const ART_H = 124;
export const ART_OX = 56;
export const ART_OY = 112;

// ───────────────────────── 조립 ─────────────────────────

function nearWeapon(x: Ctx): void {
  const { r, look } = x;
  if (r.grip === 'bow') return;
  drawWeapon(x, look.weapon, r.haN, r.wN, P.wpnN);
}

function farWeapon(x: Ctx): void {
  const { r, look } = x;
  if (r.grip === 'bow') drawWeapon(x, look.weapon, r.haF, r.wF, P.wpnF);
  else if (r.dual) drawWeapon(x, look.weapon, r.haF, r.wF, P.wpnF);
}

/** 활시위를 당기는 중인지 (아니면 시위는 활과 함께 그림) */
const pulling = (x: Ctx) => x.r.grip === 'bow' && (x.r.pull > 0 || x.r.nock);

function farArm(x: Ctx): void {
  drawArm(x, false);
  farWeapon(x);
  if (x.r.grip === 'bow' && !pulling(x)) drawBowString(x, x.r.haF, x.r.wF, null);
  drawHand(x, false, x.r.grip !== 'none');
}

function drawFront(x: Ctx): void {
  const { r, look, c } = x;
  // 몸 뒤의 것
  drawCape(x);
  if (c.quiver) drawQuiver(x);
  if (c.tail) drawTail(x);
  drawHairBackLayer(x);
  if (r.wpnBack) nearWeapon(x);
  const lute = r.grip === 'lute';
  if (!r.farFront && !lute) farArm(x);
  drawLeg(x, false);
  drawLeg(x, true);
  drawTorso(x);
  if (c.pauldrons === 'both') drawPauldron(x, false);
  if (lute) {
    // 류트: 몸 앞에 안고, 먼 손은 목을, 가까운 손은 줄을
    drawArm(x, false);
    nearWeapon(x);
    drawHand(x, false, true);
  } else if (r.farFront) farArm(x);
  if (look.shield) drawShield(x, r.haF);
  drawArm(x, true);
  if (!r.wpnBack && !lute) nearWeapon(x);
  drawHand(x, true, r.grip !== 'none');
  if (pulling(x)) drawBowString(x, r.haF, r.wF, r.haN);
  if (c.pauldrons) drawPauldron(x, true);
  drawScarf(x);
  drawNeck(x);
  drawHead(x);
  drawFace(x);
  drawHairCap(x);
  if (showsEar(x)) drawEar(x);
  drawHeadGear(x);
  drawBeastEars(x);
}

function drawBack(x: Ctx): void {
  const { r, look, c } = x;
  // 먼 팔(화면 왼쪽)과 방패는 몸 뒤
  if (look.shield) drawShield(x, r.haF);
  farArm(x);
  if (r.wpnBack) nearWeapon(x);
  drawLeg(x, false);
  drawLeg(x, true);
  drawTorso(x);
  if (c.pauldrons === 'both') drawPauldron(x, false);
  // 등의 것
  if (c.tail) drawTail(x);
  drawCape(x);
  if (c.quiver) drawQuiver(x);
  drawScarf(x);
  drawArm(x, true);
  if (!r.wpnBack) nearWeapon(x);
  drawHand(x, true, r.grip !== 'none');
  if (pulling(x)) drawBowString(x, r.haF, r.wF, r.haN);
  if (c.pauldrons) drawPauldron(x, true);
  drawNeck(x);
  drawHead(x);
  drawHairCap(x);
  if (showsEar(x)) drawEar(x);
  drawHeadGear(x);
  drawBeastEars(x);
}

/** 시전·기술 빛을 낼 곳 */
function glowPoints(x: Ctx): Pt[] {
  const { r, fr } = x;
  if (r.glow <= 0) return [];
  if (fr.anim === 'cast') return r.grip === 'staff' ? [wpnAt(r.haN, r.wN, 0, 26), r.haF] : [r.haN, r.haF];
  switch (r.grip) {
    case 'staff':
      return [wpnAt(r.haN, r.wN, 0, 26)];
    case 'book':
      return [pt(r.haN.x + 0.5, r.haN.y - 4)];
    case 'bow':
      return [pt(r.haF.x + 5, r.haF.y)];
    case 'lute':
      return [pt(r.haN.x + 1, r.haN.y - 2)];
    case 'blade':
      return [wpnAt(r.haN, r.wN, 0, 14)];
    case 'heavy':
      return [wpnAt(r.haN, r.wN, 0, 11)];
    default:
      return [r.haN];
  }
}

/** 유령: 푸르스름하고 옅게 (투명도는 그리는 쪽에서) */
function ghostify(b: PixelBuf): void {
  const lo = [62, 78, 132];
  const hi = [222, 234, 255];
  for (let i = 0; i < b.px.length; i++) {
    const c = b.px[i]!;
    if (c === 0) continue;
    const a = c >>> 24;
    const lum = (0.3 * (c & 255) + 0.59 * ((c >>> 8) & 255) + 0.11 * ((c >>> 16) & 255)) / 255;
    const t = b.part[i] === OUTLINE_PART ? 0.12 : Math.min(1, 0.3 + lum * 0.8);
    b.px[i] = pack(lo[0]! + (hi[0]! - lo[0]!) * t, lo[1]! + (hi[1]! - lo[1]!) * t, lo[2]! + (hi[2]! - lo[2]!) * t, a);
  }
}

const palCache = new Map<string, ClassicPalette>();

function paletteFor(look: HumanLook): ClassicPalette {
  const k = `${look.hairColor}|${look.body}|${look.body2 ?? ''}|${look.outfit ?? ''}|${look.weaponColor ?? ''}|${look.helmet ?? ''}|${look.shield ?? ''}`;
  let p = palCache.get(k);
  if (!p) {
    p = buildClassicPalette(look);
    if (palCache.size > 256) palCache.clear();
    palCache.set(k, p);
  }
  return p;
}

let sharedBuf: PixelBuf | null = null;

/** 새 작업 버퍼 */
export function makeArtBuffer(): PixelBuf {
  return new PixelBuf(ART_W, ART_H, ART_OX, ART_OY);
}

/**
 * 캐릭터 그림 한 장을 픽셀 버퍼에 그립니다 (발 위치 = 버퍼의 ART_OX, ART_OY).
 * buf 를 주지 않으면 공용 버퍼를 다시 쓰므로, 돌려받은 버퍼는 바로 복사해서 쓰세요.
 */
export function renderClassicFrame(look: HumanLook, fr: ClassicFrame, buf?: PixelBuf): PixelBuf {
  const b = buf ?? (sharedBuf ??= makeArtBuffer());
  b.clear();
  const outfit: ClassId = look.outfit ?? 'peasant';
  const x: Ctx = {
    b,
    look,
    pal: paletteFor(look),
    r: computeRig(look, fr),
    c: costumeOf(outfit, look.gender),
    outfit,
    hair: hairStyleOf(look),
    gear: headGearOf(look),
    fr,
  };
  if (fr.view === 'F') drawFront(x);
  else drawBack(x);
  b.outline(x.pal.outline, 0.82);
  if (!fr.ghost) {
    drawTrail(x);
    for (const p of glowPoints(x)) drawGlow(x, p, x.r.glow);
    if (x.r.beast) {
      drawBeastEyes(x);
      drawBeastAura(x, fr.f);
    }
  } else ghostify(b);
  return b;
}
