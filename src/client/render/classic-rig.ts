// 고전 도트 캐릭터의 몸 치수와 동작별 관절 자세 (DOM 없음).
// 각도: 0 = 아래, π/2 = 앞(바라보는 쪽, +x), π = 위, -π/2 = 뒤.
import type { HumanLook } from '../../shared/types';
import { add, gripOf, isDual, lerp, pt, type ClassicAnim, type ClassicFrame, type Dims, type Grip, type Pt, type Rig } from './classic-kit';

/** 남자: 키 약 60px (머리카락 위 -60), 머리 약 13px */
const DIM_M: Dims = {
  shY: -44,
  torso: [
    [0, 4.6, 4.1],
    [1, 7.6, 7.0],
    [3, 8.6, 7.8],
    [6, 8.1, 7.3],
    [10, 6.3, 5.7],
    [13, 6.4, 5.8],
    [16, 6.7, 6.1],
    [19, 6.3, 5.7],
  ],
  waist: 10,
  crotch: 19,
  shX: [7.8, 7.1],
  shDy: 2.9,
  upper: 7.6,
  fore: 7.0,
  armR: [2.1, 1.8, 1.5],
  handR: 1.9,
  hipY: -25,
  hipX: [3.0, 2.8],
  thigh: 11,
  shin: 10,
  legR: [3.0, 2.4, 2.0],
  headDy: -7.0,
  headR: [6.0, 6.3],
};

/** 여자: 키 약 58px, 어깨가 좁고 허리가 잘록 */
const DIM_F: Dims = {
  shY: -43,
  torso: [
    [0, 3.6, 3.2],
    [1, 6.2, 5.6],
    [3, 6.8, 6.1],
    [5, 6.4, 5.8],
    [9, 4.8, 4.3],
    [12, 5.6, 5.0],
    [15, 6.6, 6.0],
    [18, 6.0, 5.5],
  ],
  waist: 9,
  crotch: 18,
  shX: [6.0, 5.4],
  shDy: 2.7,
  upper: 7.3,
  fore: 6.8,
  armR: [1.7, 1.45, 1.2],
  handR: 1.6,
  hipY: -25,
  hipX: [2.8, 2.6],
  thigh: 11,
  shin: 10,
  legR: [2.8, 2.2, 1.7],
  headDy: -6.8,
  headR: [5.7, 6.0],
};

/** 팔 자세: [윗팔 각도, 아래팔 각도] */
type ArmPose = readonly [number, number];

/** 무기별 쉬는 자세 */
function restPose(grip: Grip, back: boolean): { n: ArmPose; f: ArmPose; w: number; w2: number } {
  switch (grip) {
    case 'blade':
      return { n: [0.05, 0.75], f: [0.1, 0.15], w: 2.15, w2: 0 };
    case 'short':
      return { n: [0.05, 0.6], f: [0.1, 0.15], w: 1.8, w2: 1.8 };
    case 'heavy':
      return { n: [0.05, 0.7], f: [0.1, 0.15], w: 2.4, w2: 0 };
    case 'spear':
      return { n: [0.1, 0.95], f: [0.25, 1.1], w: 1.95, w2: 0 };
    case 'staff':
      // 몸 옆에 세워 짚음
      return { n: [-0.05, 0.3], f: [0.1, 0.15], w: Math.PI - 0.04, w2: 0 };
    case 'claw':
      return { n: [0.1, 0.8], f: [0.15, 0.85], w: 1.9, w2: 1.9 };
    case 'gauntlet':
      return { n: [0.08, 0.6], f: [0.12, 0.65], w: 2.0, w2: 2.0 };
    case 'dual':
      return { n: [0.05, 0.65], f: [0.15, 0.6], w: 2.05, w2: 2.2 };
    case 'bow':
      // 활은 먼 손(왼손)에 세워 듦
      return back ? { n: [0.0, 0.15], f: [0.2, 0.35], w: 0, w2: Math.PI - 0.15 } : { n: [0.0, 0.15], f: [0.25, 0.45], w: 0, w2: Math.PI - 0.2 };
    case 'lute':
      // 몸 앞에 비스듬히 안고, 가까운 손은 몸통을, 먼 손은 목을 잡음
      return { n: [0.35, 1.75], f: [0.25, 2.55], w: 2.3, w2: 0 };
    case 'book':
      return { n: [0.25, 1.45], f: [0.1, 0.15], w: 0, w2: 0 };
    default:
      return { n: [-0.15, -0.05], f: [0.15, 0.1], w: 0, w2: 0 };
  }
}

/**
 * 앞모습에서 가까운 팔을 머리 위로 든 자세.
 * 앞모습의 가까운 어깨는 화면 왼쪽(바라보는 쪽의 반대)이라, 뒷모습처럼 "위-앞"으로 뻗으면 손이 얼굴을 가립니다.
 * 그래서 앞모습은 거의 곧게 위로 들어 손이 머리 왼쪽 위에 오게 합니다.
 */
const RAISED_NEAR_F: ArmPose = [3.0, 3.2];
/** 뒷모습에서 무기를 뒤로 넘겨 든 자세: 가까운 어깨(화면 오른쪽) 위로 곧게 들어 손이 뒤통수를 덮지 않게 */
const RAISED_NEAR_B: ArmPose = [-3.05, -3.2];

/** 무릎 위치 (앞(+x)으로 굽힘) */
function legIK(hip: Pt, an: Pt, thigh: number, shin: number): Pt {
  const dx = an.x - hip.x;
  const dy = an.y - hip.y;
  const dist = Math.hypot(dx, dy) || 1;
  const L = thigh + shin;
  const k = thigh / L;
  const mx = hip.x + dx * k;
  const my = hip.y + dy * k;
  const bend = dist < L ? Math.sqrt(Math.max(0, thigh * thigh - (dist * k) ** 2)) : 0;
  // 다리 방향에 수직, 앞쪽(+x)
  let nx = -dy / dist;
  let ny = dx / dist;
  if (nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  return pt(mx + nx * bend, my + ny * bend);
}

export function computeRig(look: HumanLook, fr: ClassicFrame): Rig {
  const female = look.gender === 'f';
  const d = female ? DIM_F : DIM_M;
  const view = fr.view;
  const back = view === 'B';
  const sN = back ? 1 : -1;
  const grip = gripOf(look.weapon);
  const dual = isDual(look);
  const rest = restPose(grip, back);
  let armN: ArmPose = rest.n;
  let armF: ArmPose = rest.f;
  let wN = rest.w;
  let wF = dual ? rest.w2 || rest.w : rest.w2;
  // 방패는 먼 팔을 앞으로 굽혀 듦
  if (look.shield && grip !== 'bow' && grip !== 'lute') armF = [0.12, 0.62];
  else if (!dual && grip !== 'bow' && grip !== 'lute' && grip !== 'spear') armF = grip === 'none' ? rest.f : [0.1, 0.15];
  let uy = 0;
  let lean = 0;
  let wpnBack = false;
  let farFront = false;
  let glow = 0;
  let pull = 0;
  let nock = false;
  let trail = 0;
  let sway = 0;
  let strideN = 0;
  let strideF = 0;
  let liftN = 0;
  let liftF = 0;
  let tipN = 0;
  let tipF = 0;
  const f = Math.max(0, Math.min(3, Math.floor(fr.f)));
  const ghost = fr.ghost;
  const anim: ClassicAnim = ghost ? 'idle' : fr.anim;
  const beast = fr.beast && !ghost;

  if (anim === 'idle') {
    // 숨쉬기: 가슴과 머리가 1px 오르내림
    uy = f === 1 || f === 2 ? -1 : 0;
    sway = f >= 2 ? 1 : 0;
  } else if (anim === 'walk') {
    // 0: 가까운 발 앞, 1: 모음(몸 위로), 2: 먼 발 앞, 3: 모음
    const ph = [1, 0, -1, 0][f]!;
    strideN = ph * 3.2;
    strideF = -ph * 3.2;
    if (ph > 0) tipF = 1;
    if (ph < 0) tipN = 1;
    if (f === 1) liftF = 1.5;
    if (f === 3) liftN = 1.5;
    uy = f === 1 || f === 3 ? -1 : 0;
    const sw = ph * 0.2;
    const held = grip === 'lute' || grip === 'book' || grip === 'staff' || grip === 'spear';
    armN = [armN[0] - sw * (held ? 0.25 : 1), armN[1] - sw * (held ? 0.25 : 1.15)];
    if (!look.shield && grip !== 'lute' && grip !== 'spear') armF = [armF[0] + sw, armF[1] + sw * 1.15];
    sway = -ph;
  } else if (anim === 'attack' || anim === 'skill') {
    const skill = anim === 'skill';
    if (grip === 'bow') {
      // 0: 활을 앞으로 들고 화살을 메김, 1: 끝까지 당김, 2: 놓음(시위가 튐), 3: 손이 돌아감
      const bowArm: ArmPose = [1.42, 1.5];
      const drawArm: ArmPose = f === 0 ? [1.1, 1.9] : f === 1 ? [1.15, 2.75] : f === 2 ? [0.9, 2.95] : [0.6, 1.3];
      armF = bowArm;
      armN = drawArm;
      wF = Math.PI;
      pull = f === 1 ? 1 : f === 0 ? 0.25 : 0;
      nock = f <= 1;
      lean = f === 1 ? -0.5 : 0;
      farFront = false;
      if (skill) glow = f <= 1 ? 0.8 : 0.35;
    } else if (grip === 'lute') {
      // 줄을 튕기며 몸을 앞으로
      armN = [0.35, f % 2 ? 2.15 : 1.4];
      lean = f === 1 || f === 2 ? 1 : 0;
      uy = f === 1 ? -1 : 0;
      glow = skill ? (f === 1 || f === 2 ? 0.6 : 0.35) : 0;
    } else if (grip === 'book') {
      // 마도서를 앞으로 내밀며 빛
      armN = f === 0 ? [0.5, 1.6] : f === 3 ? [0.35, 1.45] : [1.25, 1.5];
      armF = f === 1 || f === 2 ? [0.85, 1.35] : armF;
      farFront = f === 1 || f === 2;
      lean = f === 1 || f === 2 ? 1 : 0;
      glow = f === 1 || f === 2 ? 1 : 0.4;
    } else if (grip === 'short' || grip === 'claw') {
      // 찌르기: 뒤로 당겼다가 앞으로 쭉
      armN = f === 0 ? [-0.55, 0.5] : f === 1 ? [1.2, 1.45] : f === 2 ? [1.45, 1.55] : [0.6, 1.0];
      wN = grip === 'claw' ? (f === 0 ? 1.4 : 1.6) : f === 0 ? 1.3 : f === 3 ? 1.75 : 1.6;
      if (dual) {
        armF = f === 2 ? [1.25, 1.45] : f === 3 ? [1.4, 1.55] : f === 0 ? [0.4, 1.2] : [-0.35, 0.55];
        wF = 1.6;
        farFront = f >= 2;
      }
      lean = f === 1 || f === 2 ? 1.5 : 0;
      trail = f === 1 ? 2 : 0;
      if (skill) glow = f === 0 ? 0.8 : 0.4;
    } else if (grip === 'gauntlet') {
      // 할퀴기: 위로 들었다가 앞아래로 긁음
      armN = f === 0 ? (back ? [2.3, 2.75] : RAISED_NEAR_F) : f === 1 ? [1.55, 1.4] : f === 2 ? [0.85, 0.55] : [0.4, 0.95];
      wN = f === 0 ? 2.9 : f === 1 ? 1.7 : f === 2 ? 0.7 : 1.7;
      if (dual) {
        // 뒷모습의 먼 손(화면 왼쪽)은 앞으로 들면 뒤통수에 가리므로 바깥 위로 듦
        armF = f === 1 ? (back ? [-2.4, -2.8] : [2.2, 2.65]) : f === 2 ? [1.55, 1.4] : f === 3 ? [0.85, 0.6] : [0.4, 1.0];
        wF = f === 1 ? 2.9 : f === 2 ? 1.7 : 1.2;
        farFront = f === 2 || f === 3;
      }
      lean = f === 1 || f === 2 ? 1.5 : 0;
      trail = f === 1 ? 1 : 0;
      if (skill) glow = f === 0 ? 0.8 : 0.4;
    } else if (grip === 'staff') {
      // 지팡이 내려치기
      armN = f === 0 ? (back ? [2.3, 2.7] : RAISED_NEAR_F) : f === 1 ? [1.75, 1.85] : f === 2 ? [1.05, 1.25] : [0.5, 0.95];
      wN = f === 0 ? -2.5 : f === 1 ? 2.2 : f === 2 ? 1.45 : 2.5;
      wpnBack = f === 0;
      lean = f === 1 || f === 2 ? 1 : 0;
      trail = f === 1 ? 1 : 0;
      if (skill) glow = f === 0 ? 0.9 : 0.4;
    } else if (grip === 'spear') {
      armN = f === 0 ? [-0.35, 0.95] : f === 1 || f === 2 ? [1.3, 1.5] : [0.5, 1.1];
      armF = f === 0 ? [0.0, 1.0] : f === 1 || f === 2 ? [0.9, 1.45] : [0.25, 1.1];
      wN = 1.65;
      lean = f === 1 || f === 2 ? 1.5 : 0;
      trail = f === 1 ? 2 : 0;
      if (skill) glow = f === 0 ? 0.8 : 0.4;
    } else {
      // 칼·도끼·둔기 (맨손이면 주먹): 머리 위로 들었다가 앞으로 내려침
      // (앞모습의 머리 위 그림은 손이 얼굴 앞이 아니라 머리 옆 위, 무기는 머리 위로 비스듬히)
      armN = f === 0 ? (back ? RAISED_NEAR_B : [-2.65, -2.95]) : f === 1 ? (back ? [2.65, 2.5] : RAISED_NEAR_F) : f === 2 ? [1.4, 1.25] : [0.7, 0.95];
      wN = f === 0 ? (back ? -2.6 : -2.15) : f === 1 ? (back ? 2.45 : 2.75) : f === 2 ? 1.2 : 1.7;
      wpnBack = f === 0;
      if (grip === 'dual' && dual) {
        // 먼 손이 머리 뒤에 숨지 않게: 앞모습은 머리 오른쪽 위, 뒷모습은 머리 왼쪽 위로 듦
        armF = f === 0 ? [0.2, 0.5] : f === 1 ? (back ? [-2.6, -2.9] : [2.9, 3.1]) : f === 2 ? (back ? [-3.0, -3.1] : [2.45, 2.35]) : [1.4, 1.2];
        wF = f === 1 ? -2.15 : f === 2 ? 2.45 : f === 3 ? 1.2 : 2.2;
        farFront = f >= 2;
      }
      if (grip === 'none') {
        // 주먹 지르기
        armN = f === 0 ? [-0.5, 0.4] : f === 1 || f === 2 ? [1.35, 1.5] : [0.5, 0.9];
        wpnBack = false;
      }
      lean = f === 1 || f === 2 ? 1.5 : 0;
      uy = f === 0 ? -1 : 0;
      trail = f === 1 ? 1 : 0;
      if (skill) glow = f === 0 ? 1 : f === 1 ? 0.6 : 0.3;
    }
    // 내딛는 발
    if (f === 1 || f === 2) {
      strideN = 2.4;
      strideF = -1.4;
      tipF = 1;
    }
  } else if (anim === 'cast') {
    // 두 팔을 들어 올리고 손에 빛 (앞모습의 가까운 손은 얼굴을 가리지 않게 머리 옆 위로)
    const k = f === 0 ? 0.5 : f === 3 ? 0.45 : 1;
    const upN: ArmPose = back ? [2.55, 2.85] : RAISED_NEAR_F;
    // 뒷모습의 먼 손은 앞으로 들면 뒤통수에 가려 빛만 머리 위에 떠 보이므로, 바깥(화면 왼쪽) 위로 벌려 듦
    const upF: ArmPose = back ? [-2.8, -2.9] : [2.45, 2.75];
    // 류트를 안은 가까운 팔은 위로 접혀 있어 반쯤 든 그림에서 손이 턱에 오므로, 앞모습은 내린 팔에서 시작
    const fromN: ArmPose = grip === 'lute' && !back ? [0.1, 0.3] : armN;
    armN = [lerp(fromN[0], upN[0], k), lerp(fromN[1], upN[1], k)];
    armF = [lerp(armF[0], upF[0], k), lerp(armF[1], upF[1], k)];
    farFront = k >= 1 && grip !== 'bow';
    if (grip === 'staff' || grip === 'book') wN = Math.PI;
    else if (grip === 'blade' || grip === 'heavy' || grip === 'dual' || grip === 'spear' || grip === 'short') wN = Math.PI - 0.45;
    else if (grip === 'lute') wN = Math.PI - 0.9;
    if (dual) wF = Math.PI - 0.4;
    if (grip === 'bow') wF = Math.PI - 0.2;
    uy = k >= 1 ? -1 : 0;
    glow = k >= 1 ? (f === 2 ? 1 : 0.8) : 0.4;
    sway = f === 2 ? 1 : 0;
  }

  if (beast && anim !== 'attack' && anim !== 'skill' && anim !== 'cast') {
    // 야수화: 몸을 웅크리고 발톱을 세움
    armN = anim === 'walk' ? [armN[0] + 0.5, armN[1] + 1.2] : [0.7, 2.0];
    armF = anim === 'walk' ? [armF[0] + 0.5, armF[1] + 1.2] : [0.85, 2.1];
    if (grip === 'gauntlet' || grip === 'claw' || grip === 'none') {
      wN = 2.4;
      wF = 2.4;
    }
    lean += 1;
    uy += 1;
  }

  const cx = lean * 0.7;
  const shY = d.shY + uy;
  // 앞모습은 얼굴이 오른쪽으로, 뒷모습은 뒤통수가 약간 왼쪽으로
  const head = pt(cx + (back ? -0.3 : 0.6) + lean * 0.4, shY + d.headDy);
  const shN = pt(cx + sN * d.shX[0], shY + d.shDy);
  const shF = pt(cx - sN * d.shX[1], shY + d.shDy);
  const elN = add(shN, armN[0], d.upper);
  const elF = add(shF, armF[0], d.upper);
  const haN = add(elN, armN[1], d.fore);
  const haF = add(elF, armF[1], d.fore);
  // 걸음의 모음 그림에서는 엉덩이도 1px 올라감
  const hipY = d.hipY + (anim === 'walk' ? uy : 0);
  const hipN = pt(sN * d.hipX[0] + cx * 0.4, hipY);
  const hipF = pt(-sN * d.hipX[1] + cx * 0.4, hipY);
  // 발목: 가까운 발이 아래(앞), 먼 발은 1px 위(깊이)
  // 원작처럼 발을 조금 벌리고 섬 (A자)
  const spread = anim === 'walk' ? 0.4 : 1.0;
  const anN = pt(hipN.x + sN * spread + 0.2 + strideN, -3.4 - liftN - tipN + strideN * 0.3);
  const anF = pt(hipF.x - sN * spread + 0.5 + strideF, -4.6 - liftF - tipF + strideF * 0.3);
  const knN = legIK(hipN, anN, d.thigh, d.shin);
  const knF = legIK(hipF, anF, d.thigh, d.shin);
  return {
    view,
    female,
    d,
    sN,
    cx,
    uy,
    head,
    shN,
    shF,
    elN,
    elF,
    haN,
    haF,
    hipN,
    hipF,
    knN,
    knF,
    anN,
    anF,
    tipN,
    tipF,
    wN,
    wF,
    wpnBack,
    farFront,
    glow,
    pull,
    nock,
    trail,
    grip,
    dual,
    sway,
    beast,
  };
}
