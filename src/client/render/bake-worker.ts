// 굽기 작업자 (Web Worker, baker.ts 가 부림): 바닥 조각과 벽·나무·물체 그림의 픽셀을 게임 화면 밖 스레드에서 계산합니다.
// 그 자리에서 굽는 것과 같은 코드(ground.ts·props.ts·walls.ts)라 픽셀이 똑같습니다.
// 결과는 되도록 ImageBitmap 으로 만들어 넘기고 (받는 쪽은 바로 그림), 안 되면 픽셀 버퍼를 그대로 넘깁니다.
// 일이 없을 때는 바닥 무늬를 하나씩 미리 만들어 둡니다 (처음 가는 맵의 첫 조각을 기다리지 않게).
import type { BakeJob, BakeMap, BakedPixels, FromWorker, ToWorker } from './bake-types';
import { bakeChunkRGBA, warmGroundTexture } from './ground';
import { buildObject } from './props';
import { buildWall } from './walls';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
/** 받은 맵 타일 (열쇠 = groundKey) */
const maps = new Map<string, BakeMap>();
const canBitmap = typeof createImageBitmap === 'function' && typeof ImageData === 'function';
let warming = false;

function bake(job: BakeJob): BakedPixels | null {
  switch (job.kind) {
    case 'chunk': {
      const map = maps.get(job.map);
      if (!map) throw new Error(`맵 ${job.map} 을 받지 못했습니다`);
      return bakeChunkRGBA(map, job.map, job.cx, job.cy, job.scale);
    }
    case 'object': {
      const p = buildObject(job.ch, job.variant, job.scale, job.links);
      return p ? { w: p.w, h: p.h, data: p.data } : null;
    }
    case 'wall': {
      const p = buildWall(job.ch, job.scale, job.variant, job.links, job.sconce);
      return { w: p.w, h: p.h, data: p.data };
    }
  }
}

function send(id: number, px: BakedPixels | null): void {
  if (!px || !px.w || !px.h) {
    scope.postMessage({ t: 'done', id, w: 0, h: 0 });
    return;
  }
  const buf = px.data.buffer as ArrayBuffer;
  const raw = () => scope.postMessage({ t: 'done', id, w: px.w, h: px.h, data: buf }, [buf]);
  if (!canBitmap) return raw();
  createImageBitmap(new ImageData(new Uint8ClampedArray(buf), px.w, px.h)).then((bitmap) => scope.postMessage({ t: 'done', id, w: px.w, h: px.h, bitmap }, [bitmap]), raw);
}

function warmStep(): void {
  if (warmGroundTexture()) setTimeout(warmStep, 0);
  else warming = false;
}

scope.onmessage = (ev) => {
  const m = ev.data;
  if (m.t === 'map') {
    maps.set(m.key, m.map);
    if (maps.size > 4) maps.delete(maps.keys().next().value!);
    return;
  }
  if (m.t === 'warm') {
    if (!warming) {
      warming = true;
      setTimeout(warmStep, 0);
    }
    return;
  }
  try {
    send(m.id, bake(m.job));
  } catch (e) {
    scope.postMessage({ t: 'fail', id: m.id, error: e instanceof Error ? e.message : String(e) });
  }
};
