// 벽·나무·물체 그림 캐시 (게임 화면 쪽).
// 그림은 굽기 작업자(baker.ts)가 props.ts·walls.ts 로 구워 보내고, 여기서 (문자, 변형, 배율, 이웃)별로 모아 둡니다.
// 아직 오지 않은 그림은 null 이라 그 프레임에는 그리지 않습니다. 렌더러가 맵에 들어올 때 그 맵이 쓰는 그림을
// 모두 미리 구워 두므로 걷다가 비는 일은 드물고, 같은 칸은 언제나 같은 그림입니다 (다른 변형을 잠깐 대신 쓰지 않음).
// 작업자를 못 쓰면 그 자리에서 굽습니다.
import type { BakedImage } from './bake-types';
import { baker } from './baker';
import { makeCanvas } from './iso';
import { VARIANTS, buildObject, objectBox, objectFlame, objectLinked } from './props';
import { buildWall } from './walls';

export interface Sprite {
  canvas: BakedImage;
  /** 캔버스 안의 발 위치 (CSS 픽셀) */
  ox: number;
  oy: number;
  /** 화면에 그릴 CSS 크기 */
  w: number;
  h: number;
  /** 매 프레임 따로 그리는 불꽃 자리 (발 기준 CSS 픽셀, 횃불만) */
  flame?: { x: number; y: number; scale: number };
}

const objCache = new Map<string, Sprite>();
const wallCache = new Map<string, BakedImage>();
let emptySprite: Sprite | null = null;

const wrap = (v: number) => ((Math.floor(v) % VARIANTS) + VARIANTS) % VARIANTS;

/**
 * 물체·나무 그림. scale 은 내부 해상도 배율(정수, 보통 Math.ceil(dpr)),
 * links 는 울타리처럼 이웃과 잇는 물체의 이웃 방향 비트 (1: x+1, 2: y+1, 4: x-1, 8: y-1).
 * 아직 굽는 중이면 null (prio: 작을수록 먼저 구움). 화면에는 drawImage(canvas, x - ox, y - oy, w, h) 로 CSS 크기에 맞춰 그립니다.
 */
export function objectSprite(ch: string, variant: number, scale = 1, links = 0, prio = 1): Sprite | null {
  const s = Math.max(1, Math.round(scale));
  const v = wrap(variant);
  const l = objectLinked(ch) ? links & 15 : 0;
  const key = `o:${ch}:${v}:${s}:${l}`;
  const hit = objCache.get(key);
  if (hit) return hit;
  const box = objectBox(ch);
  if (!box) {
    emptySprite ??= { canvas: makeCanvas(1, 1)[0], ox: 0, oy: 0, w: 1, h: 1 };
    return emptySprite;
  }
  const keep = (canvas: BakedImage): Sprite => {
    const o: Sprite = { canvas, ox: -box.left, oy: -box.top, w: box.w, h: box.h };
    const flame = objectFlame(ch);
    if (flame) o.flame = flame;
    objCache.set(key, o);
    return o;
  };
  if (!baker.async) return keep(buildObject(ch, v, s, l)!.toCanvas());
  baker.request(key, { kind: 'object', ch, variant: v, scale: s, links: l }, prio, (img) => {
    if (img) keep(img);
  });
  return null;
}

/**
 * 벽 그림. 화면에는 drawImage(그림, 타일 꼭대기 x - HALF_W, 타일 꼭대기 y - WALL_H, TILE_W, TILE_H + WALL_H).
 * links 는 같은 높이 이상의 이웃 벽 방향 비트, sconce 는 벽에 붙은 횃불 받침. 아직 굽는 중이면 null.
 */
export function wallImage(ch: string, scale = 1, variant = 0, links = 0, sconce = false, prio = 1): BakedImage | null {
  const s = Math.max(1, Math.round(scale));
  const v = wrap(variant);
  const l = links & 15;
  const key = `w:${ch}:${s}:${v}:${l}:${sconce ? 1 : 0}`;
  const hit = wallCache.get(key);
  if (hit) return hit;
  if (!baker.async) {
    const c = buildWall(ch, s, v, l, sconce).toCanvas();
    wallCache.set(key, c);
    return c;
  }
  baker.request(key, { kind: 'wall', ch, variant: v, scale: s, links: l, sconce }, prio, (img) => {
    if (img) wallCache.set(key, img);
  });
  return null;
}
