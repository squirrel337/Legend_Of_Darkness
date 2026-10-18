// 게임 화면의 사람 캐릭터(플레이어·NPC): 고전 어둠의 전설 풍 도트 그림.
// 자세를 몇 장의 그림으로 나눠(classic-core) 1배 픽셀 그림을 그리고(classic-art),
// 화면 배율의 정수배로 최근접 확대한 캔버스를 캐시해 복사합니다. 치비 그림(chibi.ts)은 초상화·로그인·캐릭터 창용으로 그대로 둡니다.
import type { HumanLook } from '../../shared/types';
import { renderClassicFrame } from './classic-art';
import { LruCache, classicGhostFloat, lookSignature, quantizePose, type ClassicPose } from './classic-core';
import { P } from './classic-kit';

export { CLASSIC_IDLE_MS, lookSignature, quantizePose } from './classic-core';
export type { ClassicPose } from './classic-core';

/** 맨머리 보통 캐릭터의 머리 꼭대기 높이 (발에서 위로 CSS px). 이름표 자리 계산용 */
export const CLASSIC_HEAD_TOP = 60;
/** 캐릭터 대략의 폭 (발 가운데에서 좌우로 CSS px). 마우스 선택 범위용 */
export const CLASSIC_HALF_WIDTH = 11;
/** 캐시할 그림 수 */
export const CLASSIC_CACHE_FRAMES = 1000;

interface FrameImage {
  canvas: HTMLCanvasElement;
  /** 잘라낸 범위의 왼쪽 위 (스프라이트 좌표, 1배 px) */
  x: number;
  y: number;
}

const cache = new LruCache<FrameImage>(CLASSIC_CACHE_FRAMES);
const headTops = new LruCache<number>(512);

/** 캐시 상태 (성능 확인용) */
export const classicStats = { hits: 0, misses: 0, renderMs: 0 };

function makeFrame(look: HumanLook, q: ReturnType<typeof quantizePose>, scale: number): FrameImage {
  const t0 = performance.now();
  const b = renderClassicFrame(look, q.frame);
  const bb = b.bounds() ?? { x: 0, y: -1, w: 1, h: 1 };
  const canvas = document.createElement('canvas');
  canvas.width = bb.w * scale;
  canvas.height = bb.h * scale;
  const data = b.toRGBA(bb, scale);
  canvas.getContext('2d')!.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  const fr = q.frame;
  if (fr.anim === 'idle' && fr.view === 'F' && fr.f === 0 && !fr.beast && !fr.ghost && !headTops.has(lookSignature(look))) {
    const top = b.topY([P.hair, P.hat, P.head, P.hairBack]);
    if (top !== null) headTops.set(lookSignature(look), -top);
  }
  classicStats.renderMs += performance.now() - t0;
  return { canvas, x: bb.x, y: bb.y };
}

/** 그림자 캔버스 (배율별) */
const shadows = new Map<number, HTMLCanvasElement>();

function shadowCanvas(scale: number): HTMLCanvasElement {
  let c = shadows.get(scale);
  if (!c) {
    c = document.createElement('canvas');
    const W = 28;
    const H = 12;
    c.width = W * scale;
    c.height = H * scale;
    const g = c.getContext('2d')!;
    g.setTransform(scale, 0, 0, scale, (W / 2) * scale, (H / 2) * scale);
    g.scale(1, 0.42);
    const grad = g.createRadialGradient(0, 0, 1, 0, 0, 13);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.fill();
    shadows.set(scale, c);
  }
  return c;
}

/**
 * 게임 화면용으로 사람 캐릭터를 그립니다 (발밑 그림자 포함, 왼쪽을 보면 좌우를 뒤집음).
 * ctx 의 원점이 발 위치이고 1 단위 = 1 CSS px. dpr 은 화면 배율.
 */
export function drawClassicFast(ctx: CanvasRenderingContext2D, look: HumanLook, pose: ClassicPose, dpr: number): void {
  const q = quantizePose(pose);
  // 정수배로 그려 두고, 배율이 정수가 아니면 CSS 크기로 부드럽게 줄여 그림
  const scale = Math.max(1, Math.min(4, Math.ceil(dpr - 1e-6)));
  const key = `${lookSignature(look)}|${q.key}|${scale}`;
  let fr = cache.get(key);
  if (fr) classicStats.hits++;
  else {
    classicStats.misses++;
    fr = makeFrame(look, q, scale);
    cache.set(key, fr);
  }
  const ghost = q.frame.ghost;
  // 발밑 그림자
  ctx.save();
  if (ghost) ctx.globalAlpha *= 0.35;
  ctx.drawImage(shadowCanvas(scale), -14, -6, 28, 12);
  ctx.restore();
  // 기기 픽셀에 맞춰 그림 (점이 흐려지지 않게)
  const m = ctx.getTransform();
  const k = m.a / scale;
  const lift = ghost ? classicGhostFloat(pose.time) : 0;
  ctx.save();
  ctx.setTransform(q.flip ? -k : k, 0, 0, m.d / scale, Math.round(m.e), Math.round(m.f - lift * m.d));
  const exact = Math.abs(k - Math.round(k)) < 1e-6 && k >= 1;
  ctx.imageSmoothingEnabled = !exact;
  ctx.drawImage(fr.canvas, fr.x * scale, fr.y * scale);
  ctx.restore();
}

/** 이 겉모습의 머리 꼭대기 높이 (모자 포함, 무기 제외; 발에서 위로 CSS px) */
export function classicHeadTop(look: HumanLook): number {
  const sig = lookSignature(look);
  let v = headTops.get(sig);
  if (v === undefined) {
    const b = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 0, ghost: false, beast: false });
    const top = b.topY([P.hair, P.hat, P.head, P.hairBack]);
    v = top === null ? CLASSIC_HEAD_TOP : -top;
    headTops.set(sig, v);
  }
  return v;
}

/** 캐시 비우기 (설정 변경 등) */
export function clearClassicCache(): void {
  cache.clear();
  headTops.clear();
}

