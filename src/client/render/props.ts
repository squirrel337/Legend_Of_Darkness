// 물체·나무 그림 (고전 어둠의 전설 풍, docs/art-direction.md 의 R1~R3 양식)
//
// 모든 그림은 코드로 한 점씩 칠합니다 (pixel.ts). 빛은 왼쪽 위에서 오고, 외곽선은 같은 계열의 어두운 색이며,
// 바닥에는 부드러운 타원 그림자를 깝니다. 다 그린 뒤 한 번만 캔버스로 옮겨 (모양, 변형, 배율, 이웃)별로 캐시합니다.
// 배율은 Math.ceil(dpr) 정수라서 dpr 2 에서도 점이 또렷하고, 화면에는 CSS 크기로 그립니다 (캐시와 굽기는 sprite-cache.ts).
// 나무·덤불은 flora.ts, 바위는 rocks.ts, 벽은 walls.ts 에 있습니다.
import { tileInfo, type TileInfo } from '../../shared/tiles';
import { HALF_H, HALF_W, hash2, makeCanvas, seeded } from './iso';
import { barkFn, bush, deadTree, elmTree, grassTufts, oakTree, pineTree } from './flora';
import { CAVE_ROCK, boulderPile, rockSprite } from './rocks';
import {
  Pix,
  blob,
  face,
  gloss,
  glow,
  grain,
  groundShadow,
  isoAt,
  isoBox,
  lathe,
  latheN,
  latheV,
  lightMap,
  poly,
  quad,
  ramp,
  rgb,
  rod,
  speckle,
  sphereV,
  stamp,
  tone,
  type Box,
  type LatheHit,
  type RGB,
  type Ramp,
} from './pixel';

type Rnd = () => number;

// ───────────────────────── 색 사다리 ─────────────────────────

// R1 게시판: 기둥 #4a3220, 판 #7a5a36, 처마 #3e2a18, 종이 #e8e4d8
const POST_WOOD = ramp('#1a1009', '#2e1f12', '#3c2a19', '#4a3220', '#5a3f29', '#6c4e33', '#80603f', '#94724c');
const BOARD = ramp('#24170b', '#3a2717', '#4c341f', '#5e4128', '#6e4e30', '#7a5a36', '#8d6b43', '#a28050');
const EAVE = ramp('#1c1209', '#2e1e10', '#3e2a18', '#54391f', '#6a4a28', '#7e5c33', '#94703f', '#aa844c', '#c09a5c');
const PAPER = ramp('#6a6558', '#a8a292', '#c4bfae', '#d8d3c4', '#e8e4d8', '#f4f1e8');
const INK = rgb('#3a352d');
const CRATE = ramp('#2e1d0e', '#4e3318', '#694522', '#82582c', '#9a6a38', '#b5824e', '#c89860', '#d8ae76');
const BARREL = ramp('#24150a', '#3c2412', '#4e3018', '#643e20', '#7a4e2a', '#8a5a32', '#a06c3e', '#b8824e');
const STUMP_BARK = ramp('#1e140a', '#33220f', '#463019', '#584026', '#6a4a2a', '#7e5c36', '#946e42');
const STUMP_WOOD = ramp('#4a3018', '#6e4c2a', '#8c6638', '#a87e48', '#bf955a', '#d2ab70', '#e2c288');
// R2 석상 받침: 밝은 회백색 돌 #b0a898, 그림자 #6e675c (이끼 낀 올리브 빛)
const PEDESTAL = ramp('#2c2920', '#433f35', '#58534a', '#6e675c', '#817a6c', '#948c7c', '#a59d8c', '#b0a898', '#c6bfb0', '#dcd6c8');
const STATUE = ramp('#27272a', '#3a3a3c', '#4d4d4f', '#616162', '#767675', '#8c8b88', '#a2a09b', '#b8b5ae', '#cfccc4');
// R3 기둥: 베이지 #c4b898 (줄눈 #8a7e64, 옆 #9a8e72), 금색 돔 #d0a040 / #f0d070 / #6a5020
const BEIGE = ramp('#3a3426', '#544c3a', '#6c634d', '#82785f', '#968a6e', '#aa9e80', '#c4b898', '#d6ccae', '#e8e0c8');
const GOLD = ramp('#3a2a10', '#5c4418', '#6a5020', '#8e6a2a', '#b08636', '#d0a040', '#e2b852', '#f0d070', '#fff0b0');
// R3 기둥 머리돌: 금빛이 도는 누런 돌
const GOLD_STONE = ramp('#352b1a', '#54452a', '#6e5c38', '#887246', '#a08a56', '#b8a066', '#ccb478', '#dcc88e', '#ecdcaa');
const POST_STONE = ramp('#34312c', '#4c4842', '#625e57', '#77726a', '#8a857c', '#9a9488', '#ada79a', '#c2bcae');
const IRON = ramp('#0b0b0d', '#18181b', '#222226', '#2c2c31', '#38383e', '#48484f', '#5c5c64', '#7a7a84');
const GLASS = ramp('#7a3a10', '#c06818', '#e89030', '#ffb347', '#ffd27a', '#ffe9a8', '#fff6d8');
const MARBLE = ramp('#57513f', '#8a8270', '#a59c86', '#bdb49b', '#d0c7ae', '#e0d8c0', '#f0e6c8', '#faf4e2');
const GRAVE = ramp('#2a2826', '#42403c', '#57544f', '#6b6762', '#7f7a74', '#918c85', '#a6a199', '#bbb6ad');
const WELL_STONE = ramp('#2a2724', '#423e3a', '#57524c', '#6b6560', '#7e7872', '#908a83', '#a39d95', '#b8b2a9');
const WATER = ramp('#081a2c', '#0e2a44', '#16395a', '#204a70', '#2f6fa8', '#5a98cc', '#a8d4f0');
const CRYSTAL = ramp('#0b2236', '#16405f', '#235e88', '#357dad', '#4f9fd0', '#72c4ee', '#a8e4ff', '#e4f8ff');
const RED_CLOTH = ramp('#33090a', '#5a1410', '#7a1d16', '#9a271d', '#b8352a', '#cf4c3c', '#e2705c');
const BLUE_CLOTH = ramp('#0c1430', '#14234e', '#1d3270', '#284490', '#3658ad', '#4c72c6', '#6a90da');
const GREEN_CLOTH = ramp('#0c260e', '#143a16', '#1d4f1f', '#28662a', '#367e36', '#4a9846', '#68b05e');
const ORANGE_CLOTH = ramp('#3a1a06', '#5e2a0a', '#82400e', '#a65614', '#c46e1e', '#dc8a30', '#eeaa50');
const WHITE_CLOTH = ramp('#625c52', '#8a8478', '#aaa498', '#c4beb2', '#d8d4c8', '#e8e5dc', '#f6f4ee');
const SACK = ramp('#3a2e1c', '#56452c', '#6e5a3a', '#86714c', '#9c875e', '#b29c72', '#c6b288');
// R3 울타리 밧줄: 밝은 황갈색
const ROPE = ramp('#3a2c18', '#5a4628', '#7a6238', '#987c4a', '#b0945e', '#c8ac74', '#dcc48e');
const DIRT = ramp('#1e140c', '#33241a', '#46331f', '#5a4228', '#6e5232');
const MOSS: RGB = rgb('#4c6a2c');
const MOSS_DARK: RGB = rgb('#3a4e22');

// ───────────────────────── 그루터기·돌 말뚝 ─────────────────────────

/** 그루터기 u: 나이테가 보이는 잘린 밑동과 뿌리 */
function stump(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 3, 2, 16, 6);
  const H = variant === 2 ? 14 : 8 + rnd() * 4;
  const R = 8.5 + rnd() * 2;
  const l = p.layer();
  const fn = barkFn(STUMP_BARK, seed);
  const roots = [-2.5, -0.9, 0.7, 2.4].map((a) => a + (rnd() - 0.5) * 0.4);
  // 뒤쪽 뿌리, 몸통, 앞쪽 뿌리 순서
  const root = (a: number) => rod(l, Math.sin(a) * R * 0.7, Math.cos(a) * R * 0.35 - 2.5, 2.5, Math.sin(a) * (R + 5), Math.cos(a) * (R + 5) * 0.5 + 0.5, 1, fn);
  for (const a of roots) if (Math.cos(a) < 0) root(a);
  const crack = rnd() * Math.PI * 2;
  lathe(l, 0, 0, H, (h) => R + (h < 3 ? (3 - h) * 0.8 : 0) + Math.sin(h * 1.7 + seed) * 0.25, (q) => {
    if (q.top) {
      if (q.d > 0.88) return tone(STUMP_BARK, 0.62 + grain(q.ix, q.iy, seed) * 0.2, q.ix, q.iy);
      const ring = Math.sin(q.d * 17 + Math.sin(q.a * 3) * 0.6);
      let v = 0.62 + ring * 0.12 - q.d * 0.1 + grain(q.ix, q.iy, seed) * 0.1;
      if (q.d < 0.12) v -= 0.2;
      const da = Math.abs(((q.a - crack + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < 0.12 && q.d > 0.25 && q.d < 0.85) v -= 0.4;
      if (variant === 1 && q.d > 0.7 && hash2(q.ix, q.iy, seed) < 0.3) return MOSS;
      return tone(STUMP_WOOD, v, q.ix, q.iy, 0.6);
    }
    const plate = hash2(Math.floor(q.a * 8 + 40), Math.floor(q.h / 3), seed) - 0.5;
    return fn(q.v + plate * 0.3 - (q.h < 2 ? 0.1 : 0), 0, 0, q.ix, q.iy);
  });
  for (const a of roots) if (Math.cos(a) >= 0) root(a);
  // 버섯
  if (variant === 3) {
    for (const [x, y] of [
      [-R + 1, -3],
      [-R + 3, -6],
    ] as const) {
      rod(l, x, y, 0.8, x, y - 2, 0.8, () => rgb('#e8dcc0'));
      blob(l, x, y - 2.5, 2.4, 1.4, (_x, _y, ix, iy, dx, dy) => tone(RED_CLOTH, sphereV(dx, dy) + 0.1, ix, iy));
    }
  }
  stamp(p, l, STUMP_BARK);
  grassTufts(p, rnd, seed, [
    [-R - 2, 2],
    [R - 1, 3],
  ]);
}

/** 돌 말뚝 p: 무릎 높이의 짧은 돌기둥 (둥근 머리 / 네모 피라미드 머리) */
function stonePost(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 3, 1, 11, 4.5);
  const l = p.layer();
  const H = 17 + rnd() * 3;
  const st = (v: number, ix: number, iy: number) => tone(POST_STONE, v + speckle(ix, iy, seed) * 0.22, ix, iy);
  if (variant === 0 || variant === 2) {
    lathe(
      l,
      0,
      0,
      H + 4,
      (h) => {
        if (h < 2.5) return 6.5;
        if (variant === 2 && h > H - 1 && h < H + 0.5) return 4.8;
        if (h > H) return 5.4 * Math.sqrt(Math.max(0, 1 - ((h - H) / 4) ** 2));
        return 5.4;
      },
      (q) => {
        let v = q.v;
        if (!q.top && q.h > 7 && q.h < 8.2) v -= 0.25;
        return st(v, q.ix, q.iy);
      },
    );
  } else {
    const s = 10;
    isoBox(
      l,
      0,
      0,
      s,
      s,
      H,
      (a, b, ix, iy) => st(0.78 + (a < 1 || b < 1 ? 0.08 : 0), ix, iy),
      (u, v, ix, iy) => st(0.6 - (v > H - 2 ? 0.12 : 0) + (u < 1 ? 0.06 : 0), ix, iy),
      (u, v, ix, iy) => st(0.32 - (v > H - 2 ? 0.08 : 0) - (u > s - 1 ? 0.05 : 0), ix, iy),
    );
    // 피라미드 머리
    const top = -H;
    const lv: [number, number] = [-s, top];
    const fv: [number, number] = [0, top + s / 2];
    const rv: [number, number] = [s, top];
    const bv: [number, number] = [0, top - s / 2];
    const apex: [number, number] = [0, top - 6];
    poly(l, [...lv, ...fv, ...apex], (_x, _y, ix, iy) => st(0.7, ix, iy));
    poly(l, [...fv, ...rv, ...apex], (_x, _y, ix, iy) => st(0.4, ix, iy));
    poly(l, [...lv, ...bv, ...apex], (_x, _y, ix, iy) => st(0.84, ix, iy));
    if (variant === 3) l.paint(-s, top - 6, s, 0, (x, y, ix, iy) => (l.alpha(l.col(x), l.row(y)) > 0 && y > -6 && hash2(ix, iy, seed) < 0.35 ? MOSS : null));
  }
  stamp(p, l, POST_STONE);
}

// ───────────────────────── 석상 (R2) ─────────────────────────

/** 석상 바닥돌 반지름 (CSS px): 막힌 한 칸(반너비 32) 안에 들어 옆 칸 사람의 발이 받침 위에 오지 않음 */
const STATUE_BASE_R = 34;

/**
 * 석상 S: 2단 둥근 바닥돌 + 위아래 둥근 띠(몰딩)와 덩굴 무늬를 새긴 원기둥 받침 + 회색 석상
 * (변형 0 지팡이 든 여인상, 1 구슬을 든 여인상, 2 칼을 짚은 전사상, 3 칼과 방패를 든 전사상). 받침 앞에 돌 명판.
 * 바닥돌은 막힌 한 칸 안에 들도록 반지름 34px (옆 칸에 선 사람이 받침 위에 올라선 것처럼 보이지 않게).
 */
function statue(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 9, 3, 40, 17, 0.32);
  const base = p.layer();
  // 둥근 바닥돌 2단
  lathe(base, 0, 0, 7, (h) => (h < 3.6 ? STATUE_BASE_R - (h > 2.6 ? (h - 2.6) * 1.5 : 0) : STATUE_BASE_R - 4 - (h > 6 ? (h - 6) * 1.5 : 0)), (q) => {
    let v = q.v + speckle(q.ix, q.iy, seed) * 0.2;
    // 바닥돌 이음매 (방사형)
    if (q.top && q.d > 0.75 && Math.abs(Math.sin(q.a * 6)) < 0.07) v -= 0.22;
    if (!q.top && Math.abs(Math.sin(q.a * 6 + (q.h < 3.6 ? 0.5 : 0))) < 0.06) v -= 0.2;
    if (!q.top && Math.abs(q.h - 3.6) < 0.5) v -= 0.2;
    if (!q.top && q.h < 2 && hash2(q.ix, q.iy, seed + 4) < 0.25) return MOSS_DARK;
    return tone(PEDESTAL, v - 0.05, q.ix, q.iy);
  });
  stamp(p, base, PEDESTAL);
  // 받침: 아래 둥근 띠 · 덩굴 무늬 몸통 · 위 둥근 띠 · 윗판 (가운데가 둥글게 솟음)
  const ped = p.layer();
  const R = (h: number) => {
    if (h < 3.4) return 23 + 1.4 * Math.sin((Math.PI * h) / 3.4);
    if (h < 26) return 21 - 0.5 * Math.sin((Math.PI * (h - 3.4)) / 22.6);
    if (h < 30) return 22.5 + 1.4 * Math.sin((Math.PI * (h - 26)) / 4);
    if (h < 32.5) return 24;
    return 24 * Math.sqrt(Math.max(0, 1 - ((h - 32.5) / 8) ** 2));
  };
  const vineA = rnd() * 6;
  lathe(ped, 0, -7, 35, R, (q) => {
    let v = q.v + speckle(q.ix, q.iy, seed + 1) * 0.2;
    if (q.top) return tone(PEDESTAL, 0.72 + speckle(q.ix, q.iy, seed + 2) * 0.2 - q.d * 0.12, q.ix, q.iy);
    if (q.h >= 3.4 && q.h < 26) {
      // 덩굴 무늬 부조: 볼록한 줄은 위·왼쪽이 밝고, 오목한 곳은 어둡게
      const u = q.a * 21;
      const h = q.h - 3.4;
      const s1 = Math.sin(u * 0.42 + Math.sin(h * 0.55 + vineA) * 1.8);
      const s2 = Math.sin(h * 0.62 - u * 0.21 + vineA);
      const relief = s1 * 0.65 + s2 * 0.35;
      if (relief > 0.45) v += 0.1 + (Math.sin(u * 0.42 + 1) > 0 ? 0.06 : -0.04);
      else if (relief < -0.35) v -= 0.18;
      if (h < 1 || h > 21.6) v -= 0.12;
    } else if (Math.abs(q.h - 3.4) < 0.5 || Math.abs(q.h - 26) < 0.5) v -= 0.2;
    return tone(PEDESTAL, v, q.ix, q.iy);
  });
  stamp(p, ped, PEDESTAL);
  // 앞쪽 돌 명판 (기대어 세움)
  if (variant === 0 || variant === 2) {
    const tab = p.layer();
    const tx = -18;
    const ty = 14;
    quad(tab, tx - 9, ty - 15, 14, 7, 3, 11, (s, t, ix, iy) => {
      let v = 0.66 + speckle(ix, iy, seed + 9) * 0.2;
      if (t > 0.25 && t < 0.85 && s > 0.15 && s < 0.85 && Math.floor(t * 12) % 2 === 0 && hash2(ix, iy, seed) < 0.7) v -= 0.3;
      return tone(PEDESTAL, v, ix, iy);
    });
    quad(tab, tx + 5, ty - 8, 1.6, -0.8, 3, 11, (_s, _t, ix, iy) => tone(PEDESTAL, 0.32, ix, iy));
    stamp(p, tab, PEDESTAL);
  }
  const fig = p.layer();
  figure(fig, 0, -49, variant, seed);
  stamp(p, fig, STATUE);
}

/** 석상의 인물: 발 (fx, fy) 기준, 키 약 60 */
function figure(l: Pix, fx: number, fy: number, variant: number, seed: number): void {
  const st = (v: number, ix: number, iy: number) => tone(STATUE, v + speckle(ix, iy, seed) * 0.16, ix, iy, 0.7);
  const limb = (x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, dv = 0) => rod(l, fx + x0, fy + y0, r0, fx + x1, fy + y1, r1, (v, _t, _k, ix, iy) => st(v + dv, ix, iy));
  const ball = (x: number, y: number, rx: number, ry: number, dv = 0) => blob(l, fx + x, fy + y, rx, ry, (_x, _y, ix, iy, dx, dy) => st(sphereV(dx, dy) + dv, ix, iy));
  /** 넓어지는 옷자락: 위 (y0, 반폭 w0) → 아래 (y1, 반폭 w1), 아래 단은 앞쪽으로 둥글게 */
  const skirt = (y0: number, w0: number, y1: number, w1: number, folds: number, dv = 0) => {
    l.paint(fx - w1 - 1, fy + y0, fx + w1 + 1, fy + y1 + 3, (x, y, ix, iy) => {
      const t = (y - fy - y0) / (y1 - y0);
      const w = w0 + (w1 - w0) * Math.pow(Math.max(0, Math.min(1, t)), 0.85);
      const dx = (x - fx) / w;
      if (Math.abs(dx) > 1) return null;
      const hem = y1 + Math.sqrt(Math.max(0, 1 - dx * dx)) * 2.4;
      if (y - fy > hem) return null;
      let v = sphereV(dx * 0.95, 0.1) + dv;
      if (folds > 0) v += Math.sin(dx * Math.PI * folds + 0.6) * 0.14 * Math.max(0, Math.min(1, t + 0.2));
      return st(v, ix, iy);
    });
  };
  if (variant <= 1) {
    // 여인상: 긴 머리, 로브, 지팡이(0) 또는 높이 든 구슬(1)
    limb(-5, -56, -7.5, -42, 3.6, 4, -0.15);
    limb(5, -56, 7.5, -42, 3.6, 4, -0.2);
    skirt(-33, 7, -1, 15, 2.6);
    skirt(-49, 8.5, -33, 7, 0);
    l.paint(fx - 8, fy - 34.5, fx + 8, fy - 31, (x, y, ix, iy) => (Math.abs(x - fx) < 7 ? st(0.42 - (y - fy + 34.5) * 0.07, ix, iy) : null));
    if (variant === 0) {
      limb(9, -46, 11, -33, 2.9, 2.6);
      limb(11, -33, 8, -26, 2.6, 2.2);
      limb(-13, 1, -11.5, -66, 1.2, 1.2, 0.05);
      limb(-9, -46, -12, -36, 2.9, 2.6);
      limb(-12, -36, -12, -29, 2.6, 2.4);
      ball(-12, -29, 2.4, 2.4);
      ball(-11.5, -69, 3.8, 3.8, 0.08);
    } else {
      limb(-9, -46, -11, -33, 2.9, 2.6);
      limb(-11, -33, -8, -26, 2.6, 2.2);
      limb(9, -46, 12, -57, 2.9, 2.5);
      limb(12, -57, 11, -64, 2.5, 2.2);
      ball(11, -69, 4.4, 4.4, 0.1);
    }
    limb(0, -48, 0, -52, 1.9, 1.9, -0.1);
    ball(0, -56, 4.6, 5.4);
    // 머리띠
    l.paint(fx - 5.5, fy - 60.5, fx + 5.5, fy - 59.2, (x, _y, ix, iy) => (Math.abs(x - fx) < 4.8 ? st(0.4, ix, iy) : null));
  } else {
    // 전사상: 망토, 갑옷, 투구, 칼(2: 땅에 짚음, 3: 치켜듦 + 방패)
    l.paint(fx - 12, fy - 47, fx + 12, fy - 4, (x, y, ix, iy) => {
      const t = (y - fy + 47) / 43;
      const w = 7.5 + t * 4.5;
      return Math.abs(x - fx) < w ? st(0.22 + t * 0.05, ix, iy) : null;
    });
    limb(-3.8, 0, -3.3, -22, 2.9, 3.3, 0);
    limb(3.8, 0, 3.3, -22, 2.9, 3.3, -0.05);
    ball(-3.9, -1, 3.1, 2, 0.05);
    ball(3.9, -1, 3.1, 2, 0);
    skirt(-29, 7.5, -18, 10, 4);
    l.paint(fx - 10, fy - 48, fx + 10, fy - 28, (x, y, ix, iy) => {
      const t = (y - fy + 48) / 20;
      const w = 9.2 - t * 2.2;
      const dx = (x - fx) / w;
      if (Math.abs(dx) > 1) return null;
      let v = sphereV(dx, -0.2 + t * 0.4);
      if (Math.abs(y - fy + 38.5) < 0.6) v -= 0.18;
      return st(v, ix, iy);
    });
    ball(-8.6, -45, 4.8, 4.1, 0.05);
    ball(8.6, -45, 4.8, 4.1, 0);
    if (variant === 2) {
      // 두 손으로 칼자루를 짚음
      limb(-8.6, -44, -5.4, -33, 2.6, 2.4);
      limb(8.6, -44, 5.4, -33, 2.6, 2.4);
      l.paint(fx - 1.7, fy - 32, fx + 1.7, fy + 1, (x, y, ix, iy) => {
        const t = (y - fy + 32) / 33;
        const w = 1.6 * (1 - t * 0.7);
        const dx = x - fx;
        if (Math.abs(dx) > w) return null;
        return st(dx < 0 ? 0.8 : 0.5, ix, iy);
      });
      limb(-5.5, -33, 5.5, -33, 1.1, 1.1, 0.1);
      ball(0, -35, 2.8, 2.4, 0.05);
      limb(0, -36, 0, -40, 1, 1);
      ball(0, -41.5, 1.4, 1.4, 0.1);
    } else {
      // 방패 든 왼팔, 칼 든 오른팔
      limb(8.6, -44, 12, -54, 2.6, 2.4);
      limb(12, -54, 13, -60, 2.4, 2.2);
      l.paint(fx + 11.4, fy - 86, fx + 14.6, fy - 61, (x, y, ix, iy) => {
        const t = (fy - 61 - y) / 25;
        const w = 1.5 * (1 - t * 0.6);
        const dx = x - fx - 13;
        if (Math.abs(dx) > w) return null;
        return st(dx < 0 ? 0.82 : 0.5, ix, iy);
      });
      limb(9.8, -61, 16.2, -61, 1.1, 1.1, 0.1);
      ball(13, -59, 2.2, 2.2);
      limb(-8.6, -44, -12, -34, 2.6, 2.4);
      // 방패 (둥근 방패, 가운데 돌기)
      blob(l, fx - 12, fy - 31, 7.6, 9.2, (_x, _y, ix, iy, dx, dy) => {
        const r = Math.sqrt(dx * dx + dy * dy);
        let v = sphereV(dx * 0.6, dy * 0.6) + 0.04;
        if (r > 0.82) v += 0.12;
        if (r > 0.74 && r < 0.82) v -= 0.25;
        return st(v, ix, iy);
      });
      ball(-12, -31, 2, 2, 0.15);
    }
    limb(0, -48, 0, -52, 2, 2, -0.1);
    // 투구와 볏
    ball(0, -56, 5, 5.4);
    l.paint(fx - 5, fy - 56, fx + 5, fy - 54.4, (x, _y, ix, iy) => (Math.abs(x - fx) < 4.6 ? st(0.3, ix, iy) : null));
    limb(0, -61, -1, -65.5, 1.5, 1.2, 0.05);
    limb(-1, -65.5, -5.5, -64.5, 1.2, 0.9, 0);
  }
}

// ───────────────────────── 기둥 (R3) ─────────────────────────

/**
 * 기둥 I (R3): 2단 네모 받침돌 + 세로 홈이 파인 베이지 몸통 + 네모 머리돌 + 금색 공 머리 (약 2.5칸).
 * 변형마다 키와 이끼·금이 조금씩 다릅니다.
 */
function pillar(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 7, 3, 22, 9, 0.32);
  const l = p.layer();
  const mossy = variant === 1 || variant === 3;
  const st = (v: number, ix: number, iy: number, low = 0) => {
    if (mossy && low > 0 && hash2(ix >> 1, iy, seed + 3) < low) return hash2(ix, iy, seed) < 0.5 ? MOSS_DARK : MOSS;
    return tone(BEIGE, v + speckle(ix, iy, seed) * 0.2, ix, iy, 0.7);
  };
  // 받침돌: 아래 넓은 판 + 위 좁은 단
  const slab = (cy: number, s: number, h: number, low: number) =>
    isoBox(
      l,
      0,
      cy,
      s,
      s,
      h,
      (a, b, ix, iy) => st(0.8 + (a < 1.2 || b < 1.2 ? 0.08 : 0) - (a > s - 1.2 || b > s - 1.2 ? 0.06 : 0), ix, iy),
      (_u, v, ix, iy) => st(0.56 - (v > h - 1.2 ? 0.12 : 0) + (v < 1 ? 0.08 : 0), ix, iy, low),
      (_u, v, ix, iy) => st(0.3 - (v > h - 1.2 ? 0.08 : 0) + (v < 1 ? 0.06 : 0), ix, iy, low * 1.5),
    );
  slab(0, 28, 5, 0.25);
  slab(-5, 22, 6, 0.12);
  // 몸통 (세로 홈 10줄, 가운데 마디 두 줄, 살짝 배흘림)
  const shaftH = [50, 52, 47, 55][variant]! + Math.round(rnd() * 2);
  const flutes = 10;
  const crack = variant === 1 ? 0.3 + rnd() * 0.3 : -9;
  lathe(
    l,
    0,
    -11,
    shaftH,
    (h) => {
      if (h < 2) return 9.2;
      if (h < 3.2) return 8.4;
      if (h > shaftH - 2) return 8.6;
      return 7.6 + 0.4 * Math.sin((Math.PI * h) / shaftH);
    },
    (q) => {
      let v = q.v;
      if (q.h > 3.2 && q.h < shaftH - 2) {
        // 세로 홈: 둘레를 따라 법선을 비틀고 홈 바닥을 어둡게
        const ph = q.a * flutes;
        v = latheV(q.a + 0.22 * Math.sin(ph), q.k) - 0.09 * (1 + Math.cos(ph));
        if (Math.abs(q.h - shaftH * 0.36) < 0.55 || Math.abs(q.h - shaftH * 0.7) < 0.55) v -= 0.2;
        if (Math.abs(q.a - crack) < 0.05 + q.h * 0.002 && q.h > shaftH * 0.4) v -= 0.3;
      }
      if (Math.abs(q.h - 2) < 0.5 || Math.abs(q.h - (shaftH - 2)) < 0.5) v -= 0.15;
      return st(v, q.ix, q.iy, mossy && q.h < 6 ? 0.2 : 0);
    },
    false,
  );
  // 머리돌 (네모, 금빛이 도는 돌)
  const capY = -11 - shaftH;
  isoBox(
    l,
    0,
    capY,
    20,
    20,
    6,
    (a, b, ix, iy) => tone(GOLD_STONE, 0.8 + speckle(ix, iy, seed) * 0.16 + (a < 1.2 || b < 1.2 ? 0.08 : 0), ix, iy, 0.6),
    (_u, v, ix, iy) => tone(GOLD_STONE, 0.56 - (v > 4.8 ? 0.14 : 0) + (v < 1 ? 0.08 : 0) + speckle(ix, iy, seed) * 0.16, ix, iy, 0.6),
    (_u, v, ix, iy) => tone(GOLD_STONE, 0.28 - (v > 4.8 ? 0.08 : 0) + speckle(ix, iy, seed) * 0.14, ix, iy, 0.6),
  );
  // 금색 공 (어두운 띠 받침 + 반짝임)
  const R = 7.4;
  lathe(
    l,
    0,
    capY - 6,
    R * 2 + 1.5,
    (h) => (h < 1.5 ? 6.2 : R * Math.sqrt(Math.max(0, 1 - ((h - 1.5 - R) / R) ** 2)) + 0.15),
    (q) => {
      if (q.h < 1.5) return tone(GOLD, 0.1, q.ix, q.iy, 0.4);
      const [nx, ny, nz] = q.top ? [0, -0.866, 0.5] : latheN(q.a, q.k);
      return tone(GOLD, q.v * 0.95 + gloss(nx, ny, nz, 16) * 0.55 - 0.08 + grain(q.ix, q.iy, seed) * 0.08, q.ix, q.iy, 0.6);
    },
  );
  stamp(p, l, BEIGE);
}

// ───────────────────────── 게시판 (R1) ─────────────────────────

/**
 * 게시판 N (R1): 나무 기둥 두 개, 나무 테 판에 흰 종이 3~4장, 판 위에 처마 지붕 (약 1.8칸).
 * 변형 0·2 는 판이 맵 x축을 따라 서서 왼쪽 아래를, 1·3 은 y축을 따라 서서 오른쪽 아래를 봅니다.
 */
function noticeBoard(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 6, 3, 28, 11, 0.3);
  const alongX = variant % 2 === 0;
  const U = 40;
  // 판 좌표 (u: 판을 따라 0~U, d: 판 앞쪽으로, z: 높이) → 화면
  const at = (u: number, d: number, z: number): [number, number] => (alongX ? isoAt(u - U / 2, d, z) : isoAt(d, U / 2 - u, z));
  // 판 좌표 법선 → 맵 법선 밝기
  const lit = (nu: number, nd: number, nz: number) => (alongX ? lightMap(nu, nd, nz) : lightMap(nd, -nu, nz));
  const q = (pp: Pix, u0: number, d0: number, z0: number, u1: number, d1: number, z1: number, u2: number, d2: number, z2: number, fn: (s: number, t: number, ix: number, iy: number) => RGB | null) => {
    const [x0, y0] = at(u0, d0, z0);
    const [x1, y1] = at(u1, d1, z1);
    const [x2, y2] = at(u2, d2, z2);
    quad(pp, x0, y0, x1 - x0, y1 - y0, x2 - x0, y2 - y0, fn);
  };
  const zTop = 42;
  const zBot = 19;
  // 기둥 (판 뒤)
  const posts = p.layer();
  const wood = barkFn(POST_WOOD, seed);
  for (const u of [5, U - 5]) {
    const [x0, y0] = at(u, -1.5, 0);
    const [x1, y1] = at(u, -1.5, zTop + 3);
    rod(posts, x0, y0, 2.1, x1, y1, 1.9, wood);
  }
  stamp(p, posts, POST_WOOD);
  // 판: 앞면 (테두리 + 판자 + 종이), 옆 두께, 윗면
  const board = p.layer();
  const front = lit(0, 1, 0);
  const papers = variant < 2 ? 4 : 3;
  const sheets: [number, number, number, number][] = [];
  const pr = seeded(seed + 5);
  for (let i = 0; i < papers; i++) {
    const w = 7.5 + pr() * 2;
    const u0 = 4 + i * ((U - 8) / papers) + pr() * 1.5;
    const zt = zTop - 3 - pr() * 3;
    sheets.push([u0, zt, Math.min(w, (U - 8) / papers + 1.5), 9 + pr() * 4]);
  }
  q(board, 0, 1, zTop, U, 1, zTop, 0, 1, zBot, (s, t, ix, iy) => {
    const u = s * U;
    const z = zTop - t * (zTop - zBot);
    // 종이 (뒤에 붙인 것부터, 나중 것이 위)
    for (let k = sheets.length - 1; k >= 0; k--) {
      const [u0, zt, w, h] = sheets[k]!;
      if (u < u0 || u >= u0 + w || z > zt || z <= zt - h) continue;
      const lu = u - u0;
      const lz = zt - z;
      // 빨간 압정
      if (lz < 1.4 && Math.abs(lu - w / 2) < 0.9) return rgb('#9a2a20');
      const line = lz > 2.6 && lz < h - 1.4 && Math.floor(lz - 2.6) % 2 === 0 && lu > 1.3 && lu < w - 1.2 - hash2(Math.floor(lz), Math.floor(u0), seed) * 3;
      if (line && hash2(ix, iy, seed + 2) < 0.75) return INK;
      let pv = 0.5 + front * 0.45 - (lu > w - 1.2 || lz > h - 1.2 ? 0.18 : 0) + grain(ix, iy, seed) * 0.06;
      if (lu < 1.2 && lz > h - 3) pv -= 0.25;
      return tone(PAPER, pv, ix, iy, 0.5);
    }
    // 테두리 (굵은 나무 테) 와 안쪽 판자
    const rim = u < 2.2 || u > U - 2.2 || z > zTop - 2.2 || z < zBot + 2.2;
    let bv = front * 0.85 - 0.02;
    if (rim) bv += 0.12;
    else {
      bv -= 0.14;
      if (Math.abs(((z - zBot) % 6) - 0.4) < 0.5) bv -= 0.16;
    }
    bv += (hash2(Math.floor(u / 5), Math.floor(z / 6), seed) - 0.5) * 0.12 + grain(ix, iy, seed) * 0.1;
    return tone(BOARD, bv, ix, iy, 0.6);
  });
  // 끝 두께 (보이는 쪽)
  const endU = alongX ? U : 0;
  const endLit = alongX ? lit(1, 0, 0) : lit(-1, 0, 0);
  q(board, endU, 1, zTop, endU, -1.5, zTop, endU, 1, zBot, (_s, _t, ix, iy) => tone(BOARD, endLit * 0.9 + grain(ix, iy, seed) * 0.1, ix, iy, 0.6));
  stamp(p, board, BOARD);
  // 처마 지붕: 앞 비탈 + 보이는 쪽 박공 (판자 줄)
  const roof = p.layer();
  const zr = zTop + 8;
  const ze = zTop + 1;
  const front2 = lit(0, 0.62, 0.78);
  q(roof, -3, 5.5, ze, U + 3, 5.5, ze, -3, 0, zr, (s, t, ix, iy) => {
    const u = -3 + s * (U + 6);
    let v = front2 * 0.95 + (hash2(Math.floor((u + 3) / 4), 3, seed) - 0.5) * 0.16 + grain(ix, iy, seed) * 0.12;
    if (((u + 300) % 4) < 0.7) v -= 0.2;
    if (t < 0.12) v -= 0.2;
    if (t > 0.88) v += 0.1;
    return tone(EAVE, v, ix, iy, 0.6);
  });
  // 뒤 비탈 (용마루 너머로 조금 보임)
  q(roof, -3, 0, zr, U + 3, 0, zr, -3, -5.5, ze, (_s, t, ix, iy) => tone(EAVE, 0.36 - t * 0.12 + grain(ix, iy, seed) * 0.1, ix, iy, 0.6));
  const gU = alongX ? U + 3 : -3;
  const gLit = alongX ? lit(1, 0, 0) : lit(-1, 0, 0);
  const g0 = at(gU, 5.5, ze);
  const g1 = at(gU, 0, zr);
  const g2 = at(gU, -5.5, ze);
  poly(roof, [...g0, ...g1, ...g2], (_x, _y, ix, iy) => tone(EAVE, gLit * 0.8 + grain(ix, iy, seed) * 0.1, ix, iy, 0.6));
  stamp(p, roof, EAVE);
  if (rnd() < 0.5) grassTufts(p, rnd, seed, [at(5, 1, 0), at(U - 5, 1, 0)].map(([x, y]) => [x, y + 1] as [number, number]));
}

// ───────────────────────── 가로등·횃불 ─────────────────────────

/**
 * 가로등 l: 쇠기둥 위 따뜻한 등불 (빛 무리는 그림에 미리 넣고, 렌더러가 광원으로 등록).
 * 0 곧은 기둥, 1 굽은 팔에 매단 등, 2 돌 받침 위 낮은 기둥, 3 양팔에 등 두 개
 */
function lamp(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 3, 1, variant === 3 ? 16 : 12, 5);
  const ironFn = (q: LatheHit) => {
    const [nx, ny, nz] = q.top ? [0, -0.866, 0.5] : latheN(q.a, q.k);
    return tone(IRON, q.v + gloss(nx, ny, nz, 12) * 0.4 + grain(q.ix, q.iy, seed) * 0.08, q.ix, q.iy, 0.6);
  };
  const fn = (v: number, _t: number, _k: number, ix: number, iy: number) => tone(IRON, v, ix, iy, 0.6);
  // 등불 상자의 바닥 중심 (상자 아래 끝은 이 점에서 6px 아래, 지붕 꼭지는 18px 위)
  const lights: [number, number][] = variant === 1 ? [[10, -48]] : variant === 2 ? [[0, -58]] : variant === 3 ? [[-11, -66], [11, -66]] : [[0, -66]];
  for (const [x, y] of lights) glow(p, x, y - 5, variant === 3 ? 22 : 26, [255, 196, 110], 0.3);
  const l = p.layer();
  const base = variant === 2 ? 8 : 0;
  if (variant === 2) {
    const st = (v: number, ix: number, iy: number) => tone(POST_STONE, v + speckle(ix, iy, seed) * 0.2, ix, iy);
    isoBox(l, 0, 0, 14, 14, 8, (_a, _b, ix, iy) => st(0.8, ix, iy), (_u, v, ix, iy) => st(0.58 - (v > 6.8 ? 0.1 : 0), ix, iy), (_u, v, ix, iy) => st(0.3 - (v > 6.8 ? 0.06 : 0), ix, iy));
  }
  const poleH = (variant === 1 ? 70 : variant === 2 ? 52 : variant === 3 ? 56 : 60) - base;
  lathe(
    l,
    0,
    -base,
    poleH,
    (h) => {
      if (base === 0 && h < 2) return 5.6;
      if (base === 0 && h < 4) return 4.4;
      if (h < 8) return 2.9 + (8 - h) * 0.32;
      if (h > 32 - base && h < 34.5 - base) return 2.6;
      if (h > poleH - 3) return 2.5;
      return 1.7;
    },
    ironFn,
  );
  const top = -base - poleH;
  if (variant === 1) {
    // 굽은 팔 끝에 짧은 사슬로 매단 등
    rod(l, 0, top, 1.3, 5.5, top - 3, 1.2, fn);
    rod(l, 5.5, top - 3, 1.2, 10, top + 1, 1.1, fn);
    rod(l, 10, top + 1, 0.7, 10, -48 - 17, 0.7, fn);
  } else if (variant === 3) {
    // 가로팔 양 끝의 짧은 받침 위에 등, 가운데 장식 공
    rod(l, -12, top + 1, 1.1, 12, top + 1, 1.1, fn);
    for (const sd of [-1, 1]) rod(l, sd * 11, top + 1, 0.9, sd * 11, -60, 0.9, fn);
    blob(l, 0, top - 2.5, 2, 2, (_x, _y, ix, iy, dx, dy) => tone(IRON, sphereV(dx, dy), ix, iy));
  }
  for (const [x, y] of lights) lantern(l, x, y, seed);
  stamp(p, l, IRON);
}

/** 등불 상자 (쇠틀 + 따뜻한 유리) */
function lantern(l: Pix, cx: number, cy: number, seed: number): void {
  const s = 8;
  const H = 11;
  const pane = (u: number, v: number, ix: number, iy: number, side: number): RGB => {
    if (u < 0.9 || u > s - 0.9 || v < 0.9 || v > H - 1) return tone(IRON, 0.5 - side * 0.25, ix, iy);
    const c = 1 - Math.abs(u - s / 2) / (s / 2);
    return tone(GLASS, 0.6 + c * 0.35 - side * 0.12 + (v / H) * 0.1 + grain(ix, iy, seed) * 0.08, ix, iy, 0.6);
  };
  isoBox(l, cx, cy, s, s, H, null, (u, v, ix, iy) => pane(u, v, ix, iy, 0), (u, v, ix, iy) => pane(u, v, ix, iy, 1));
  // 바닥판과 지붕
  isoBox(l, cx, cy + 1, s + 2, s + 2, 1.5, (_a, _b, ix, iy) => tone(IRON, 0.6, ix, iy), (_u, _v, ix, iy) => tone(IRON, 0.45, ix, iy), (_u, _v, ix, iy) => tone(IRON, 0.25, ix, iy));
  const t = cy - H;
  const w = s + 2;
  poly(l, [cx - w, t, cx, t + w / 2, cx, t - 6], (_x, _y, ix, iy) => tone(IRON, 0.62 + grain(ix, iy, seed) * 0.1, ix, iy));
  poly(l, [cx, t + w / 2, cx + w, t, cx, t - 6], (_x, _y, ix, iy) => tone(IRON, 0.3, ix, iy));
  blob(l, cx, t - 7, 1.5, 1.5, (_x, _y, ix, iy, dx, dy) => tone(IRON, sphereV(dx, dy), ix, iy));
}

/** 서 있는 횃불의 불꽃 위치 (발 기준 높이) */
const TORCH_TOP = 40;

/** 횃불 j: 0 세 다리 장대, 1 쇠띠 두른 장대, 2 돌 받침에 박은 장대, 3 쇠띠 + 가로대 (불꽃은 매 프레임 따로 그림) */
function torchPost(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 2, 1, 9, 4);
  const l = p.layer();
  const wood = barkFn(POST_WOOD, seed);
  if (variant === 2) {
    // 돌 받침
    const st = (v: number, ix: number, iy: number) => tone(POST_STONE, v + speckle(ix, iy, seed) * 0.2, ix, iy);
    isoBox(l, 0, 0, 11, 11, 6, (_a, _b, ix, iy) => st(0.78, ix, iy), (_u, _v, ix, iy) => st(0.56, ix, iy), (_u, _v, ix, iy) => st(0.3, ix, iy));
  } else {
    // 세 다리
    for (const a of [-2.3, 0.3, 2.6]) rod(l, Math.sin(a) * 6, Math.cos(a) * 3, 1.2, 0, -12, 1.3, wood);
  }
  rod(l, 0, variant === 2 ? -5 : 0, 1.9, 0, -TORCH_TOP + 3, 1.6, wood);
  if (variant % 2) {
    for (const y of [-14, -26]) rod(l, -2, y, 0.9, 2, y + 1, 0.9, (v, _t, _k, ix, iy) => tone(IRON, v, ix, iy));
    if (variant === 3) rod(l, -5, -22, 1, 5, -20, 1, wood);
  }
  lathe(
    l,
    0,
    -TORCH_TOP + 4,
    5,
    (h) => 2 + h * 0.7,
    (q) => {
      if (q.top) return tone(q.d < 0.7 ? GLASS : IRON, q.d < 0.7 ? 0.35 + hash2(q.ix, q.iy, seed) * 0.5 : 0.6, q.ix, q.iy);
      return tone(IRON, q.v + (Math.abs(q.h - 3) < 0.5 ? 0.15 : 0), q.ix, q.iy, 0.6);
    },
  );
  stamp(p, l, POST_WOOD);
}

// ───────────────────────── 울타리 (R3) ─────────────────────────

/** 이웃 방향 비트: 1 = x+1, 2 = y+1, 4 = x-1, 8 = y-1 (화면에서 오른쪽 아래, 왼쪽 아래, 왼쪽 위, 오른쪽 위) */
const LINK_DIRS: readonly [number, number, number][] = [
  [1, HALF_W, HALF_H],
  [2, -HALF_W, HALF_H],
  [4, -HALF_W, -HALF_H],
  [8, HALF_W, -HALF_H],
];

/** 울타리 밧줄 높이와 처짐 (이웃 칸과 같아야 가운데서 이어짐) */
const ROPES = [
  { z: 20, sag: 4.5 },
  { z: 11, sag: 3.5 },
];

/** 꼰 밧줄 결: 비스듬한 줄무늬 */
const ropeTone = (v: number, ix: number, iy: number) => tone(ROPE, v + ((ix + iy * 2) % 4 === 0 ? -0.24 : 0.04), ix, iy, 0.5);

/**
 * 울타리 F (R3): 굵은 나무 말뚝에 밧줄을 감고, 이웃 울타리 쪽으로 처진 밧줄 두 가닥을 칸 가운데까지 잇습니다.
 * 변형: 0 둥근 머리, 1 뾰족한 머리, 2 키 큰 말뚝, 3 잘린 머리 (나이테)
 */
function fence(p: Pix, rnd: Rnd, seed: number, variant: number, links: number): void {
  groundShadow(p, 3, 1, 9, 4, 0.32);
  const rope = (bit: number, dx: number, dy: number, l: Pix) => {
    if (!(links & bit)) return;
    for (const r of ROPES) {
      const steps = 8;
      let px = dx * 0.08;
      let py = -r.z + dy * 0.08;
      for (let k = 1; k <= steps; k++) {
        const t = (k / steps) * 0.5;
        const x = dx * t;
        const y = -r.z + dy * t + 4 * r.sag * t * (1 - t);
        rod(l, px, py, 1.3, x, y, 1.3, (v, _t, _k, ix, iy) => ropeTone(v, ix, iy));
        px = x;
        py = y;
      }
    }
  };
  const back = p.layer();
  for (const [bit, dx, dy] of LINK_DIRS) if (dy < 0) rope(bit, dx, dy, back);
  if (back.bx1 > 0) stamp(p, back, ROPE);
  const post = p.layer();
  const H = (variant === 2 ? 31 : 27) + rnd() * 2;
  const R = 4.2;
  const wood = (v: number, q: LatheHit) => tone(POST_WOOD, v + (hash2(Math.floor(q.a * 7 + 30), Math.floor(q.h / 5), seed) - 0.5) * 0.24 + grain(q.ix, q.iy, seed) * 0.12, q.ix, q.iy, 0.6);
  lathe(
    post,
    0,
    0,
    H + (variant === 0 ? 2.5 : 0),
    (h) => {
      // 밧줄을 감은 자리는 조금 굵게
      let r = R + Math.sin(h * 0.9 + seed) * 0.15;
      if (ROPES.some((rp) => Math.abs(h - rp.z) < 1.8)) r += 0.8;
      if (variant === 0 && h > H) r *= Math.sqrt(Math.max(0, 1 - ((h - H) / 2.5) ** 2));
      if (variant === 1 && h > H - 4) r *= Math.max(0.2, (H - h) / 4);
      return r;
    },
    (q) => {
      if (q.top) {
        if (variant === 3) return tone(STUMP_WOOD, 0.55 + Math.sin(q.d * 10) * 0.12 + grain(q.ix, q.iy, seed) * 0.1, q.ix, q.iy);
        return wood(q.v, q);
      }
      if (ROPES.some((rp) => Math.abs(q.h - rp.z) < 1.8)) {
        // 감은 밧줄: 가로 줄마다 엇갈린 결
        const turn = Math.floor((q.h + 10) / 1.2);
        return tone(ROPE, q.v + (Math.sin(q.a * 3 + turn * 1.7) > 0.4 ? -0.18 : 0.05), q.ix, q.iy, 0.5);
      }
      return wood(q.v - (q.h < 2 ? 0.12 : 0), q);
    },
  );
  stamp(p, post, POST_WOOD);
  const front = p.layer();
  for (const [bit, dx, dy] of LINK_DIRS) if (dy > 0) rope(bit, dx, dy, front);
  if (front.bx1 > 0) stamp(p, front, ROPE);
}

// ───────────────────────── 상자·통·제단·묘비·우물·탁자·수정·노점 ─────────────────────────

/** 나무판 면: 가로 판자 + 테두리 + 대각 버팀목 */
function plankFace(pal: Ramp, lit: number, U: number, V: number, seed: number, brace: boolean) {
  return (u: number, v: number, ix: number, iy: number): RGB => {
    let t = lit;
    const frame = u < 2 || u > U - 2 || v < 2 || v > V - 2;
    if (frame) t += 0.06;
    else {
      if (Math.floor(v - 2) % 5 === 4) t -= 0.25;
      if (brace && Math.abs((u - 2) / (U - 4) - (v - 2) / (V - 4)) < 0.09) t += 0.04;
      else t -= 0.06;
    }
    if ((u < 2.2 || u > U - 2.2) && Math.abs(((v + 1) % 6) - 1) < 0.5) return tone(IRON, 0.6, ix, iy);
    t += (hash2(Math.floor(v / 5), Math.floor(u / 7), seed) - 0.5) * 0.1 + grain(ix, iy, seed) * 0.12;
    return tone(pal, t, ix, iy, 0.6);
  };
}

/** 상자 C */
function crate(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 2, 19, 7);
  const l = p.layer();
  const S = 22;
  const H = 17;
  const box = (cx: number, cy: number, s: number, h: number, lidFruit: boolean) =>
    isoBox(
      l,
      cx,
      cy,
      s,
      s,
      h,
      (a, b, ix, iy) => {
        if (lidFruit && a > 2 && a < s - 2 && b > 2 && b < s - 2) {
          const fx = Math.floor(a / 3.4);
          const fy = Math.floor(b / 3.4);
          const r = Math.hypot(a - (fx + 0.5) * 3.4, b - (fy + 0.5) * 3.4);
          return r < 1.6 ? tone(RED_CLOTH, 0.8 - r * 0.2, ix, iy) : tone(RED_CLOTH, 0.25, ix, iy);
        }
        const plank = Math.floor(b / 5.5);
        let t = 0.76 + (hash2(plank, 1, seed) - 0.5) * 0.1 + grain(ix, iy, seed) * 0.12;
        if (b % 5.5 < 0.7) t -= 0.25;
        if (a < 1.6 || a > s - 1.6 || b < 1.6 || b > s - 1.6) t += 0.06;
        return tone(CRATE, t, ix, iy, 0.6);
      },
      plankFace(CRATE, 0.62, s, h, seed, true),
      plankFace(CRATE, 0.34, s, h, seed + 1, true),
    );
  if (variant === 2) {
    // 기대 놓은 자루
    const sack = p.layer();
    blob(sack, -15, -6, 6, 7, (_x, _y, ix, iy, dx, dy) => tone(SACK, sphereV(dx, dy) + grain(ix, iy, seed) * 0.15, ix, iy));
    blob(sack, -15, -13.5, 2.6, 1.6, (_x, _y, ix, iy, dx, dy) => tone(SACK, sphereV(dx, dy) - 0.1, ix, iy));
    stamp(p, sack, SACK);
  }
  box(0, 0, S, H, variant === 3);
  if (variant === 1) box(-2, -H - 1, 14, 11, false);
  stamp(p, l, CRATE);
}

/** 통 O */
function barrel(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 2, 16, 6);
  const one = (cx: number, cy: number, H: number, R: number, water: boolean) => {
    const l = p.layer();
    lathe(
      l,
      cx,
      cy,
      H,
      (h) => R + 1.7 * Math.sin((Math.PI * h) / H),
      (q) => {
        if (q.top) {
          if (q.d > 0.86) return tone(BARREL, 0.5, q.ix, q.iy);
          if (water) return tone(WATER, 0.45 + (q.d < 0.4 && q.a < 0 ? 0.25 : 0) + grain(q.ix, q.iy, seed) * 0.1, q.ix, q.iy);
          const xx = Math.sin(q.a) * q.d * R;
          return tone(BARREL, 0.66 + (Math.abs((xx + 20) % 4) < 0.6 ? -0.25 : 0) + grain(q.ix, q.iy, seed) * 0.1, q.ix, q.iy, 0.6);
        }
        const hoop = Math.abs(q.h - 3.5) < 1.2 || Math.abs(q.h - (H - 3.5)) < 1.2;
        if (hoop) {
          const [nx, ny, nz] = latheN(q.a, q.k);
          return tone(IRON, q.v + gloss(nx, ny, nz, 10) * 0.4 + 0.05, q.ix, q.iy, 0.6);
        }
        let v = q.v;
        if (Math.abs(Math.sin(q.a * 6 + 0.4)) < 0.12) v -= 0.2;
        v += grain(q.ix, q.iy, seed) * 0.1 + (hash2(Math.floor(q.a * 6 + 9), 0, seed) - 0.5) * 0.12;
        return tone(BARREL, v, q.ix, q.iy, 0.6);
      },
    );
    stamp(p, l, BARREL);
  };
  if (variant === 1) {
    one(-3, -1, 21, 8, false);
    one(9, 4, 12, 5.2, false);
  } else if (variant === 2) {
    one(-6, -2, 20, 7.5, false);
    one(6, 3, 20, 7.5, false);
  } else one(0, 0, 22, 8.5, variant === 3);
}

/** 제단 A: 밝은 돌 단 + 금 장식. 0 빛나는 구슬, 1 구슬과 촛불, 2 펼친 경전, 3 붉은 천을 드리운 단과 구슬 */
function altar(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 5, 3, 27, 11);
  if (variant !== 2) glow(p, 0, -33, 18, [255, 236, 160], 0.3);
  const l = p.layer();
  const stone = (lit: number) => (_u: number, v: number, ix: number, iy: number) => tone(MARBLE, lit + speckle(ix, iy, seed) * 0.12 - (v < 1 ? -0.06 : 0), ix, iy, 0.6);
  isoBox(l, 0, 0, 32, 22, 4, stone(0.86), stone(0.62), stone(0.36));
  const runner = variant === 3;
  const band = (lit: number, U: number) => (u: number, v: number, ix: number, iy: number) => {
    if (runner && Math.abs(u - U / 2) < U * 0.22 && v < 13) return tone(RED_CLOTH, lit + 0.1 - (v > 11 ? 0.15 : 0) + (Math.abs(u - U / 2) > U * 0.18 ? 0.12 : 0), ix, iy, 0.5);
    if (v > 2 && v < 4.2) return tone(GOLD, lit + 0.1 + (Math.floor(u) % 4 === 0 ? 0.15 : 0), ix, iy);
    if (v > 7 && v < 13 && Math.abs(u - U / 2) < 3) {
      const cu = Math.abs(u - U / 2);
      if (cu < 0.9 || Math.abs(v - 9.5) < 0.8) return tone(GOLD, lit + 0.2, ix, iy);
    }
    return tone(MARBLE, lit + speckle(ix, iy, seed) * 0.12 - (v > 13 ? 0.06 : 0), ix, iy, 0.6);
  };
  isoBox(l, 0, -4, 26, 16, 15, null, band(0.66, 26), band(0.38, 16));
  isoBox(l, 0, -19, 30, 20, 3, stone(0.88), stone(0.7), stone(0.42));
  if (variant === 2) {
    // 펼친 경전 (책받침 위)
    quad(l, -6, -26, 12, 6, -4, 3, (s2, t, ix, iy) => tone(PAPER, 0.88 - (Math.abs(s2 - 0.5) < 0.05 ? 0.35 : 0) - (t > 0.2 && t < 0.8 && Math.floor(s2 * 14) % 2 === 0 && Math.abs(s2 - 0.5) > 0.1 && hash2(ix, iy, seed) < 0.5 ? 0.3 : 0), ix, iy, 0.4));
    quad(l, -6, -26, 12, 6, 0, 2, (_s, _t, ix, iy) => tone(RED_CLOTH, 0.35, ix, iy));
  } else {
    // 구슬 받침과 구슬
    lathe(l, 0, -22, 4, (h) => 3.4 - h * 0.4, (q) => tone(GOLD, q.v, q.ix, q.iy));
    blob(l, 0, -30, 4.2, 4.2, (_x, _y, ix, iy, dx, dy) => tone(GLASS, 0.75 + sphereV(dx, dy) * 0.4, ix, iy));
  }
  if (variant === 1) {
    for (const x of [-9, 9]) {
      lathe(l, x, -21 + Math.abs(x) * 0.1, 5, () => 1.1, (q) => tone(WHITE_CLOTH, q.v + 0.1, q.ix, q.iy));
      blob(l, x, -27.5, 0.9, 1.6, () => rgb('#ffd27a'));
    }
  }
  stamp(p, l, MARBLE);
}

/** 묘비 G */
function grave(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 2, 14, 5);
  const l = p.layer();
  const tilt = variant === 2 ? 1.6 : 0;
  if (variant !== 1) {
    // 무덤 흙더미
    blob(l, -1, 4, 11, 4.5, (_x, _y, ix, iy, dx, dy) => tone(DIRT, 0.55 + sphereV(dx, dy) * 0.3 + grain(ix, iy, seed) * 0.2, ix, iy));
  }
  const U = variant === 3 ? 9 : 13;
  const V = variant === 3 ? 22 : 19;
  const arch = variant === 3 ? 0 : U / 2;
  const ox = -U / 2 - 1;
  const oy = -V - U / 4 + 1;
  const slab = (dx: number, dy: number, dark: number, engr: boolean) =>
    face(l, ox + dx, oy + dy, U, V, 0.5, (u, v, ix, iy) => {
      const shift = tilt * (1 - v / V);
      const uu = u - shift;
      if (uu < 0 || uu > U) return null;
      if (arch > 0 && v < arch) {
        const t = (uu - U / 2) / (U / 2);
        if (v < arch * (1 - Math.sqrt(Math.max(0, 1 - t * t)))) return null;
      }
      if (variant === 3 && v < 3 && Math.abs(uu - U / 2) > (v / 3) * (U / 2)) return null;
      let t = 0.7 - dark + speckle(ix, iy, seed) * 0.2;
      if (engr) {
        const cu = Math.abs(uu - U / 2);
        if ((cu < 1 && v > 5 && v < 14) || (Math.abs(v - 8) < 1 && cu < 3.5)) t -= 0.32;
        if (variant === 2 && v > V - 5 && hash2(ix, iy, seed) < 0.45) return MOSS;
        if (variant === 2 && Math.abs(uu - 3 - v * 0.3) < 0.5 && v > 9) t -= 0.3;
      }
      return tone(GRAVE, t, ix, iy, 0.6);
    });
  if (variant === 1) {
    // 십자 돌
    const fn = (v: number, _t: number, _k: number, ix: number, iy: number) => tone(GRAVE, v + speckle(ix, iy, seed) * 0.16, ix, iy, 0.6);
    rod(l, 0, 1, 2.2, 0, -21, 2, fn);
    rod(l, -6, -15, 1.8, 6, -15, 1.8, fn);
    isoBox(l, 0, 2, 9, 9, 3, (_a, _b, ix, iy) => tone(GRAVE, 0.75, ix, iy), (_u, _v, ix, iy) => tone(GRAVE, 0.55, ix, iy), (_u, _v, ix, iy) => tone(GRAVE, 0.32, ix, iy));
  } else {
    slab(2.5, -1.25, 0.3, false);
    slab(0, 0, 0, true);
  }
  stamp(p, l, GRAVE);
}

/**
 * 우물 w: 둥근 돌 우물. 0 판자 지붕과 두레박, 1 지붕 없이 도르래 틀과 테두리에 놓인 두레박,
 * 2 이끼 낀 돌과 지붕, 3 오래된 짙은 지붕과 넓은 테두리돌
 */
function well(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 4, 3, 23, 10);
  const R = 15;
  const ring = p.layer();
  const lip = variant === 3 ? 1.8 : 1;
  const mossy = variant === 2;
  lathe(
    ring,
    0,
    0,
    12,
    (h) => R + (h > 10 ? lip : 0),
    (q) => {
      if (q.top) {
        if (q.d < 0.74) {
          const back = q.a > Math.PI / 2 || q.a < -Math.PI / 2;
          if (q.d > 0.62 && back) return tone(WELL_STONE, 0.2, q.ix, q.iy);
          return tone(WATER, 0.3 + (q.d < 0.35 ? 0.1 : 0) + grain(q.ix, q.iy, seed) * 0.12, q.ix, q.iy);
        }
        const joint = Math.abs(Math.sin(q.a * 7)) < 0.09;
        return tone(WELL_STONE, 0.78 - (joint ? 0.25 : 0) + speckle(q.ix, q.iy, seed) * 0.16, q.ix, q.iy);
      }
      if (mossy && q.h < 5 && hash2(q.ix >> 1, q.iy, seed + 2) < 0.45 - q.h * 0.08) return hash2(q.ix, q.iy, seed) < 0.5 ? MOSS : MOSS_DARK;
      const course = Math.floor(q.h / 4);
      const joint = q.h % 4 < 0.7 || Math.abs(Math.sin(q.a * 5 + course * 1.3)) < 0.08;
      const v = q.v - (joint ? 0.22 : 0) + (hash2(Math.floor(q.a * 5 + course * 1.3 + 20), course, seed) - 0.5) * 0.16 + speckle(q.ix, q.iy, seed) * 0.14;
      return tone(WELL_STONE, v, q.ix, q.iy);
    },
  );
  stamp(p, ring, WELL_STONE);
  const frame = p.layer();
  const wood = barkFn(POST_WOOD, seed);
  const bucket = (x: number, y: number) => lathe(frame, x, y, 5, (h) => 2.6 + h * 0.15, (q) => (q.top ? tone(WATER, 0.35, q.ix, q.iy) : Math.abs(q.h - 3.5) < 0.6 ? tone(IRON, q.v, q.ix, q.iy) : tone(BARREL, q.v, q.ix, q.iy)));
  if (variant === 1) {
    // 지붕 없는 도르래 틀
    const top = -36;
    for (const x of [-R + 2, R - 2]) rod(frame, x, -11, 1.7, x, top, 1.5, wood);
    rod(frame, -R, top + 3, 1.3, R, top + 3, 1.3, wood);
    lathe(frame, 0, top + 6.5, 3, () => 2.6, (q) => tone(BARREL, q.top ? 0.5 : q.v, q.ix, q.iy));
    rod(frame, R + 0.5, top + 3, 0.8, R + 4, top + 7, 0.8, (v, _t, _k, ix, iy) => tone(IRON, v, ix, iy));
    rod(frame, 0, top + 7, 0.6, 0, -15, 0.6, (v, _t, _k, ix, iy) => tone(ROPE, v, ix, iy));
    bucket(9, -9.5);
    stamp(p, frame, POST_WOOD);
    return;
  }
  const top = -44;
  for (const x of [-R + 1, R - 1]) rod(frame, x, -12, 1.8, x, top + 2, 1.6, wood);
  rod(frame, -R - 1, top + 6, 1.4, R + 1, top + 6, 1.4, wood);
  // 밧줄과 두레박
  const hang = mossy ? -14 : -18;
  rod(frame, 1, top + 7, 0.6, 1, hang - 6, 0.6, (v, _t, _k, ix, iy) => tone(ROPE, v, ix, iy));
  bucket(1, hang);
  stamp(p, frame, POST_WOOD);
  // 지붕 (판자 경사면 두 장)
  const roof = p.layer();
  const ry = top + 2;
  const old = variant === 3 ? -0.16 : 0;
  const fn = (lit: number) => (_x: number, y: number, ix: number, iy: number) => tone(EAVE, lit + old + (Math.floor((y - ry) / 2.5) % 2 ? -0.08 : 0.04) + grain(ix, iy, seed) * 0.1, ix, iy, 0.6);
  poly(roof, [-R - 5, ry + 3, 0, ry - 9, 0, ry + 11, -R - 5, ry + 13], fn(0.68));
  poly(roof, [0, ry - 9, R + 5, ry + 3, R + 5, ry + 13, 0, ry + 11], fn(0.36));
  stamp(p, roof, EAVE);
}

/** 탁자 t: 0 잔과 빵, 1 잔만, 2 촛불과 펼친 책, 3 흰 식탁보와 잔 */
function table(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 3, 2, 19, 7);
  const l = p.layer();
  const wood = barkFn(BARREL, seed);
  const A = 26;
  const B = 18;
  const legs: [number, number][] = [
    [-A / 2 + B / 2 - 0.5, -A / 4 - B / 4 + 2],
    [-A / 2 - B / 2 + 3, -A / 4 + B / 4],
    [A / 2 + B / 2 - 3, A / 4 - B / 4],
    [A / 2 - B / 2 + 0.5, A / 4 + B / 4 - 2],
  ];
  for (const [x, y] of legs) rod(l, x, y, 1.3, x, y - 12, 1.3, wood);
  const cloth = variant === 3;
  isoBox(
    l,
    0,
    -12,
    A,
    B,
    3,
    (_a, b, ix, iy) => (cloth ? tone(WHITE_CLOTH, 0.8 + grain(ix, iy, seed) * 0.08, ix, iy) : tone(BARREL, 0.78 + (b % 4.5 < 0.6 ? -0.2 : 0) + grain(ix, iy, seed) * 0.1, ix, iy, 0.6)),
    (_u, _v, ix, iy) => (cloth ? tone(WHITE_CLOTH, 0.55, ix, iy) : tone(BARREL, 0.5, ix, iy)),
    (_u, _v, ix, iy) => (cloth ? tone(WHITE_CLOTH, 0.3, ix, iy) : tone(BARREL, 0.3, ix, iy)),
  );
  if (cloth) {
    // 식탁보 드림 (물결)
    const lx = -A / 2 - B / 2;
    const ly = -12 - A / 4 + B / 4;
    face(l, lx, ly, A, 6, 0.5, (u, v, ix, iy) => (v > 3 + 2 * Math.abs(Math.sin((u * Math.PI) / 6.5)) ? null : tone(WHITE_CLOTH, 0.62 - (Math.sin((u * Math.PI) / 6.5) > 0.7 ? 0.1 : 0), ix, iy, 0.5)));
    face(l, lx + A, ly + A / 2, B, 6, -0.5, (u, v, ix, iy) => (v > 3 + 2 * Math.abs(Math.sin((u * Math.PI) / 6.5)) ? null : tone(WHITE_CLOTH, 0.34, ix, iy, 0.5)));
  }
  // 위에 놓인 것
  const cup = () => lathe(l, -4, -15 - rnd(), 4, () => 1.8, (q) => tone(q.top ? WATER : POST_STONE, q.top ? 0.3 : q.v, q.ix, q.iy));
  if (variant === 2) {
    // 펼친 책과 촛불
    quad(l, -3, -19, 7, 3.5, -5, 2.5, (s2, _t, ix, iy) => tone(PAPER, 0.85 - (Math.abs(s2 - 0.5) < 0.06 ? 0.3 : 0) + grain(ix, iy, seed) * 0.05, ix, iy, 0.4));
    lathe(l, 6, -16, 6, () => 1.1, (q) => tone(WHITE_CLOTH, q.top ? 0.9 : q.v + 0.1, q.ix, q.iy));
    blob(l, 6, -23.5, 0.9, 1.6, () => rgb('#ffd27a'));
  } else {
    cup();
    if (variant === 0) blob(l, 5, -17, 4, 2.2, (_x, _y, ix, iy, dx, dy) => tone(SACK, sphereV(dx, dy) + 0.15, ix, iy));
  }
  stamp(p, l, BARREL);
}

/** 수정 c: 바위에서 솟은 빛나는 푸른 결정 */
function crystal(p: Pix, rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 3, 2, 17, 6, 0.3);
  glow(p, 0, -18, 24, [120, 210, 255], 0.28);
  const base = p.layer();
  blob(base, 0, -3, 13, 6, (_x, _y, ix, iy, dx, dy) => tone(CAVE_ROCK, sphereV(dx, dy * 1.4) * 0.9 + speckle(ix, iy, seed) * 0.25, ix, iy));
  stamp(p, base, CAVE_ROCK);
  const l = p.layer();
  const n = 4 + (variant % 3);
  const list: { a: number; len: number; w: number; x: number }[] = [];
  for (let i = 0; i < n; i++) list.push({ a: -0.75 + (i / (n - 1)) * 1.5 + (rnd() - 0.5) * 0.2, len: 12 + rnd() * 18 * (1 - Math.abs(i / (n - 1) - 0.5)), w: 2.4 + rnd() * 2, x: (rnd() - 0.5) * 8 });
  list.sort((a, b) => b.len - a.len);
  for (const c of list) {
    const bx = c.x;
    const by = -4;
    const ux = Math.sin(c.a);
    const uy = -Math.cos(c.a);
    const px = -uy;
    const py = ux;
    const L = c.len;
    const tip = c.w * 1.4;
    const pts = [bx - px * c.w, by - py * c.w, bx + ux * (L - tip) - px * c.w, by + uy * (L - tip) - py * c.w, bx + ux * L, by + uy * L, bx + ux * (L - tip) + px * c.w, by + uy * (L - tip) + py * c.w, bx + px * c.w, by + py * c.w];
    poly(l, pts, (x, y, ix, iy) => {
      const k = ((x - bx) * px + (y - by) * py) / c.w;
      const along = ((x - bx) * ux + (y - by) * uy) / L;
      let v = k < -0.25 ? 0.82 : k < 0.35 ? 0.62 : 0.4;
      if (along > (L - tip) / L) v += k < 0 ? 0.15 : -0.05;
      if (Math.abs(k + 0.25) < 0.12) v += 0.2;
      v += along * 0.12 + grain(ix, iy, seed) * 0.08;
      return tone(CRYSTAL, v, ix, iy, 0.5);
    });
  }
  stamp(p, l, CRYSTAL);
}

/** 노점 n: 나무 판매대, 물건, 줄무늬 천막 */
function stall(p: Pix, _rnd: Rnd, seed: number, variant: number): void {
  groundShadow(p, 5, 3, 29, 12);
  const l = p.layer();
  const wood = barkFn(POST_WOOD, seed);
  const A = 34;
  const B = 18;
  const corner = (sa: number, sb: number): [number, number] => [(sa * A) / 2 - (sb * B) / 2, (sa * A) / 4 + (sb * B) / 4];
  // 뒤 기둥
  for (const [sa, sb] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
  ] as const) {
    const [x, y] = corner(sa * 0.92, sb * 0.85);
    rod(l, x, y, 1.3, x, y - 46, 1.2, wood);
  }
  isoBox(l, 0, 0, A, B, 13, (a, _b, ix, iy) => tone(BOARD, 0.74 + (a % 6 < 0.7 ? -0.2 : 0) + grain(ix, iy, seed) * 0.1, ix, iy, 0.6), plankFace(BOARD, 0.6, A, 13, seed, false), plankFace(BOARD, 0.32, B, 13, seed + 1, false));
  // 물건
  const goods = seeded(seed + variant);
  for (let i = 0; i < 7; i++) {
    const a = 5 + goods() * (A - 10);
    const b = 4 + goods() * (B - 8);
    const x = -A / 2 + B / 2 + a - b;
    const y = -A / 4 - B / 4 - 13 + (a + b) / 2;
    const kind = Math.floor(goods() * 3);
    if (kind === 0) blob(l, x, y - 2, 2.2, 2.2, (_x, _y, ix, iy, dx, dy) => tone(RED_CLOTH, sphereV(dx, dy) + 0.15, ix, iy));
    else if (kind === 1) blob(l, x, y - 1.5, 3.2, 1.8, (_x, _y, ix, iy, dx, dy) => tone(SACK, sphereV(dx, dy) + 0.2, ix, iy));
    else lathe(l, x, y, 4, (h) => 2.2 + Math.sin(h) * 0.6, (q) => tone(variant % 2 ? CRYSTAL : BARREL, q.top ? 0.3 : q.v, q.ix, q.iy));
  }
  const [fx, fy] = corner(0.92, 0.85);
  rod(l, fx, fy, 1.3, fx, fy - 40, 1.2, wood);
  stamp(p, l, BOARD);
  // 천막: 줄무늬 천 + 물결 모양 드림
  const cloth = p.layer();
  const H0 = 46;
  // 천막 색: 빨강·파랑·초록·주황 줄무늬 (흰 줄과 번갈아)
  const main = [RED_CLOTH, BLUE_CLOTH, GREEN_CLOTH, ORANGE_CLOTH][variant]!;
  const stripe = (a: number) => (Math.floor(a / 5) % 2 === 0 ? main : WHITE_CLOTH);
  isoBox(cloth, 1, -H0 + 4, A + 6, B + 6, 0.01, (a, b, ix, iy) => tone(stripe(a), 0.74 - b * 0.012 + grain(ix, iy, seed) * 0.08, ix, iy, 0.5), null, null);
  const AA = A + 6;
  const BB = B + 6;
  const lx = 1 - AA / 2 - BB / 2;
  const ly = -H0 + 4 - AA / 4 + BB / 4;
  face(cloth, lx, ly, AA, 5, 0.5, (u, v, ix, iy) => (v > 3 + 1.6 * Math.abs(Math.sin((u * Math.PI) / 5)) ? null : tone(stripe(u), 0.6, ix, iy, 0.5)));
  face(cloth, lx + AA, ly + AA / 2, BB, 5, -0.5, (u, v, ix, iy) => (v > 3 + 1.6 * Math.abs(Math.sin((u * Math.PI) / 5)) ? null : tone(main, 0.32, ix, iy, 0.5)));
  stamp(p, cloth, main);
}

// ───────────────────────── 물체 목록 ─────────────────────────

type Shape = NonNullable<TileInfo['shape']>;

interface ObjDef {
  /** 그림 상자 (발 위치 기준 CSS 픽셀) */
  box: Box;
  draw: (p: Pix, rnd: Rnd, seed: number, variant: number, links: number, ch: string) => void;
  /** 이웃 연결(울타리 밧줄)을 쓰는지 */
  linked?: boolean;
}

const bx = (left: number, top: number, w: number, h: number): Box => ({ left, top, w, h });

const OBJECTS: Partial<Record<Shape, ObjDef>> = {
  oak: { box: bx(-54, -110, 102, 128), draw: (p, r, s, v) => oakTree(p, r, s, v) },
  elm: { box: bx(-38, -136, 84, 150), draw: (p, r, s, v) => elmTree(p, r, s, v) },
  pine: { box: bx(-28, -108, 58, 122), draw: pineTree },
  deadtree: { box: bx(-44, -98, 98, 108), draw: deadTree },
  bush: { box: bx(-28, -36, 58, 48), draw: bush },
  // 동굴 바위(r)는 갈색 돌
  rock: { box: bx(-31, -42, 63, 60), draw: (p, r, s, v, _l, ch) => rockSprite(p, r, s, v, ch === 'r') },
  boulder: { box: bx(-38, -42, 86, 68), draw: boulderPile },
  stump: { box: bx(-24, -24, 47, 37), draw: stump },
  post: { box: bx(-15, -30, 33, 40), draw: stonePost },
  statue: { box: bx(-49, -140, 112, 168), draw: statue },
  pillar: { box: bx(-33, -95, 66, 114), draw: pillar },
  sign: { box: bx(-33, -66, 70, 84), draw: noticeBoard },
  lamp: { box: bx(-35, -99, 73, 111), draw: lamp },
  torch: { box: bx(-16, -49, 32, 59), draw: torchPost },
  fence: { box: bx(-22, -40, 44, 48), draw: fence, linked: true },
  crate: { box: bx(-27, -41, 54, 56), draw: crate },
  barrel: { box: bx(-20, -32, 44, 44), draw: barrel },
  altar: { box: bx(-32, -54, 67, 72), draw: altar },
  grave: { box: bx(-17, -28, 39, 41), draw: grave },
  well: { box: bx(-25, -56, 55, 73), draw: well },
  table: { box: bx(-27, -31, 54, 46), draw: table },
  crystal: { box: bx(-26, -44, 52, 56), draw: crystal },
  stall: { box: bx(-36, -64, 74, 83), draw: stall },
};

export const VARIANTS = 4;

/** 물체·나무 그림을 픽셀 버퍼로 만듭니다 (캐시하지 않음, 점검·미리보기용) */
export function buildObject(ch: string, variant: number, scale = 1, links = 0): Pix | null {
  const info = tileInfo(ch);
  const def = info.shape ? OBJECTS[info.shape] : undefined;
  if (!def) return null;
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  const seed = ch.charCodeAt(0) * 7919 + v * 104729 + 17;
  const p = new Pix(def.box, Math.max(1, Math.round(scale)));
  def.draw(p, seeded(seed), seed, v, def.linked ? links & 15 : 0, ch);
  return p;
}

/** 물체·나무 그림 상자 (발 위치 기준 CSS 픽셀). 그릴 모양이 없는 문자면 null */
export function objectBox(ch: string): Box | null {
  const shape = tileInfo(ch).shape;
  return (shape && OBJECTS[shape]?.box) || null;
}

/** 매 프레임 따로 그리는 불꽃 자리 (발 기준 CSS 픽셀, 횃불만) */
export function objectFlame(ch: string): { x: number; y: number; scale: number } | undefined {
  return tileInfo(ch).shape === 'torch' ? { x: 0, y: -TORCH_TOP - 1, scale: 1 } : undefined;
}

/** 울타리처럼 이웃과 잇는 물체인지 (그림이 이웃 방향 비트에 따라 달라짐) */
export function objectLinked(ch: string): boolean {
  const shape = tileInfo(ch).shape;
  return !!(shape && OBJECTS[shape]?.linked);
}

// ───────────────────────── 불꽃 (매 프레임) ─────────────────────────

let flameGlow: HTMLCanvasElement | null = null;

/** 불꽃 둘레의 따뜻한 빛 무리 (한 번 그려 두고 'lighter'로 덧그림) */
function flameGlowCanvas(): HTMLCanvasElement {
  if (flameGlow) return flameGlow;
  const [c, g] = makeCanvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,190,90,0.55)');
  grad.addColorStop(0.35, 'rgba(255,140,50,0.22)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flameGlow = c;
  return c;
}

/** 횃불 불꽃 (매 프레임). (x, y)는 불꽃 밑동 */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, scale = 1): void {
  const t = time / 90 + x * 0.37;
  const f = Math.sin(t) * 1.4 + Math.sin(t * 2.3) * 0.6;
  const h = 13 + Math.sin(t * 1.7) * 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const glowR = 22 + Math.sin(t * 0.8) * 2;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(flameGlowCanvas(), -glowR, -glowR - 6, glowR * 2, glowR * 2);
  ctx.globalCompositeOperation = 'source-over';
  const lobe = (w: number, hh: number, color: string, sway: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(-w * 1.15, -hh * 0.55, sway, -hh);
    ctx.quadraticCurveTo(w * 1.15, -hh * 0.55, w, 0);
    ctx.quadraticCurveTo(0, w * 0.6, -w, 0);
    ctx.fill();
  };
  lobe(4.2, h, '#d8461c', f);
  lobe(3.2, h * 0.78, '#ff8a22', f * 0.8);
  lobe(1.9, h * 0.5, '#ffe27a', f * 0.5);
  // 튀는 불티
  const spark = (time / 420 + x) % 1;
  ctx.fillStyle = `rgba(255,220,140,${1 - spark})`;
  ctx.fillRect(Math.sin(t * 0.7) * 3, -h - spark * 10, 1, 1);
  ctx.restore();
}

