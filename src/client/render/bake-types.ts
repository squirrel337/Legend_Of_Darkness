// 굽기 일꾼(baker.ts)과 굽기 작업자(bake-worker.ts)가 주고받는 말과 그림 도우미.
// 작업자 번들에도 들어가므로 게임 화면 쪽 것(작업자 띄우기 등)은 두지 않습니다.
import type { MapView } from '../../shared/protocol';
import { makeCanvas } from './iso';

/** 작업자에게 맡기는 굽기 일 */
export type BakeJob =
  | { kind: 'chunk'; map: string; cx: number; cy: number; scale: number }
  | { kind: 'object'; ch: string; variant: number; scale: number; links: number }
  | { kind: 'wall'; ch: string; variant: number; scale: number; links: number; sconce: boolean };

/** 작업자가 맵 바닥을 굽는 데 필요한 맵 정보 */
export type BakeMap = Pick<MapView, 'id' | 'dark' | 'tiles'>;

/** 구운 픽셀 (RGBA, w×h 장치 픽셀) */
export interface BakedPixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** 화면에 그릴 수 있는 구운 그림 */
export type BakedImage = HTMLCanvasElement | ImageBitmap;

/** 작업자로 보내는 말 (warm: 쉬는 동안 바닥 무늬를 미리 만들어 둠) */
export type ToWorker = { t: 'map'; key: string; map: BakeMap } | { t: 'job'; id: number; job: BakeJob } | { t: 'warm' };
/** 작업자가 돌려주는 말 (그림이 없으면 w = 0) */
export type FromWorker = { t: 'done'; id: number; w: number; h: number; bitmap?: ImageBitmap; data?: ArrayBuffer } | { t: 'fail'; id: number; error: string };

/** 구운 그림의 메모리를 바로 돌려줌 */
export function disposeImage(img: BakedImage): void {
  if ('close' in img) img.close();
  else {
    img.width = 0;
    img.height = 0;
  }
}

/** RGBA 픽셀 → 캔버스 */
export function pixelsToCanvas(px: BakedPixels): HTMLCanvasElement {
  const [c, x] = makeCanvas(px.w, px.h);
  const img = x.createImageData(px.w, px.h);
  img.data.set(px.data);
  x.putImageData(img, 0, 0);
  return c;
}
