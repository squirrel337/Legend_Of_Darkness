// 화면 분위기: 맵별 색조와 가장자리 비네트를 작은 캔버스 한 장에 구워 두고 매 프레임 화면 크기로 늘려 붙입니다.
// 비네트는 부드러운 그라데이션이라 작은 캔버스를 부드럽게 늘려도 계단이 생기지 않고,
// 분위기 종류마다 한 번만 만들면 되므로 창 크기가 바뀌어도 다시 계산하지 않습니다.
import { makeCanvas } from './iso';
import { AMBIENCES, vignetteAlpha, type Ambience, type AmbienceKind } from './ambience';

/** 비네트 캔버스 크기 (화면 비율과 상관없이 늘려 붙임: 거리는 화면 반지름 기준이라 모양이 같음) */
const VW = 256;
const VH = 160;

/** 던전의 바탕 어둠 (빛 구멍을 뚫기 전): rgba(4,4,12,0.86) */
export const DARKNESS: readonly [number, number, number, number] = [4, 4, 12, 0.86];

/**
 * 비네트(+색조) 한 장. tint 를 주면 그 색을 화면 전체에 먼저 깐 것으로 셈합니다
 * (던전에서는 바탕 어둠을 tint 로 넣어서 어둠과 비네트를 한 장으로 만듦).
 */
function buildVignette(amb: Ambience, tintOverride?: readonly [number, number, number, number]): HTMLCanvasElement {
  const [c, x] = makeCanvas(VW, VH);
  const img = x.createImageData(VW, VH);
  const d = new Uint32Array(img.data.buffer);
  const v = amb.vignette;
  const t = tintOverride ?? amb.tint;
  const at = t ? t[3] : 0;
  // 가운데를 두고 상하좌우가 대칭이라 왼쪽 위 1/4 만 계산해 네 곳에 씀
  for (let y = 0; y < VH / 2; y++) {
    const ny = ((y + 0.5) / VH) * 2 - 1;
    for (let i = 0; i < VW / 2; i++) {
      const nx = ((i + 0.5) / VW) * 2 - 1;
      const av = vignetteAlpha(v, Math.sqrt(nx * nx + ny * ny));
      // 색조 위에 비네트를 겹친 결과를 한 겹으로
      const a = av + at * (1 - av);
      if (a <= 0) continue;
      const mix = (vc: number, tc: number) => Math.round((vc * av + tc * at * (1 - av)) / a) & 255;
      const px = ((Math.round(a * 255) << 24) | (mix(v.color[2], t ? t[2] : 0) << 16) | (mix(v.color[1], t ? t[1] : 0) << 8) | mix(v.color[0], t ? t[0] : 0)) >>> 0;
      const y2 = VH - 1 - y;
      const i2 = VW - 1 - i;
      d[y * VW + i] = px;
      d[y * VW + i2] = px;
      d[y2 * VW + i] = px;
      d[y2 * VW + i2] = px;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

export class Atmosphere {
  private readonly cache = new Map<AmbienceKind, HTMLCanvasElement>();
  private readonly darkCache = new Map<AmbienceKind, HTMLCanvasElement>();

  constructor() {
    // 쉬는 시간에 분위기마다 한 장씩 미리 만들어 둠 (처음 가는 맵의 첫 프레임에 몰리지 않게)
    const todo = Object.values(AMBIENCES);
    const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const step = () => {
      const amb = todo.shift();
      if (!amb) return;
      if (amb.kind === 'dark') this.darkness(amb);
      else this.layer(amb);
      if (w.requestIdleCallback) w.requestIdleCallback(step, { timeout: 2000 });
      else setTimeout(step, 100);
    };
    if (w.requestIdleCallback) w.requestIdleCallback(step, { timeout: 2000 });
    else setTimeout(step, 100);
  }

  /** 분위기 한 겹 (색조 + 비네트) */
  private layer(amb: Ambience): HTMLCanvasElement {
    let c = this.cache.get(amb.kind);
    if (!c) {
      c = buildVignette(amb);
      this.cache.set(amb.kind, c);
    }
    return c;
  }

  /** 던전 어둠 바탕: 바탕 어둠과 비네트를 겹친 작은 캔버스 (화면 크기로 늘려 쓰고, 그 위에 빛 구멍을 뚫음) */
  darkness(amb: Ambience): HTMLCanvasElement {
    let c = this.darkCache.get(amb.kind);
    if (!c) {
      c = buildVignette(amb, DARKNESS);
      this.darkCache.set(amb.kind, c);
    }
    return c;
  }

  /** 화면 전체에 분위기 한 겹 (ctx 의 변환과 상관없이 캔버스 픽셀 기준) */
  draw(ctx: CanvasRenderingContext2D, amb: Ambience, cssW: number, cssH: number, dpr: number): void {
    if (cssW <= 0 || cssH <= 0) return;
    const c = this.layer(amb);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, Math.round(cssW * dpr), Math.round(cssH * dpr));
    ctx.restore();
  }
}
