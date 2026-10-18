// 맵별 분위기 (낮 / 흐림 / 저녁 / 어둠): 풀·흙 색 묶음, 화면 색조, 가장자리 비네트.
// 서버 데이터를 바꾸지 않고 클라이언트의 맵 id 표로 정합니다. DOM 을 쓰지 않는 순수 함수만 둡니다.

export type AmbienceKind = 'day' | 'overcast' | 'dusk' | 'dark';

export interface Vignette {
  /** 화면 반지름으로 나눈 타원 거리 d 가 inner 이하이면 투명 */
  inner: number;
  /** d 가 outer 이상이면 alpha (모서리는 d ≈ 1.41) */
  outer: number;
  alpha: number;
  color: readonly [number, number, number];
}

export interface Ambience {
  kind: AmbienceKind;
  /** 풀·흙 색 묶음: r1 저녁 숲길, r2 낮 마을 잔디, r3 섬 풀밭 */
  palette: 'r1' | 'r2' | 'r3';
  /** 화면 전체에 덮는 색 [r,g,b,a] (없으면 null) */
  tint: readonly [number, number, number, number] | null;
  vignette: Vignette;
}

/** 맵 id → 분위기. 표에 없는 맵은 map.dark 이면 어둠, 아니면 낮 */
export const MAP_AMBIENCE: Readonly<Record<string, AmbienceKind>> = {
  town: 'day',
  training: 'day',
  plains: 'overcast',
  forest: 'dusk',
  cave: 'dark',
  crypt1: 'dark',
  crypt2: 'dark',
  tower: 'dark',
  abyss: 'dark',
};

export const AMBIENCES: Readonly<Record<AmbienceKind, Ambience>> = {
  // 낮 (R2): 가장자리만 살짝
  day: { kind: 'day', palette: 'r2', tint: null, vignette: { inner: 0.72, outer: 1.55, alpha: 0.42, color: [10, 12, 6] } },
  // 흐림: 살짝 회청색, 중간 비네트
  overcast: { kind: 'overcast', palette: 'r3', tint: [90, 98, 112, 0.16], vignette: { inner: 0.52, outer: 1.42, alpha: 0.66, color: [8, 10, 14] } },
  // 저녁 숲길 (R1): 어두운 청록 기운, 모서리는 거의 검정, 캐릭터 둘레만 넓게 밝음
  dusk: { kind: 'dusk', palette: 'r1', tint: [4, 12, 12, 0.13], vignette: { inner: 0.4, outer: 1.28, alpha: 0.97, color: [2, 5, 4] } },
  // 던전: 빛 구멍 어둠 위에 비네트
  dark: { kind: 'dark', palette: 'r1', tint: null, vignette: { inner: 0.42, outer: 1.3, alpha: 0.82, color: [2, 2, 6] } },
};

/** 맵의 분위기 */
export function ambienceFor(mapId: string, dark: boolean): Ambience {
  return AMBIENCES[MAP_AMBIENCE[mapId] ?? (dark ? 'dark' : 'day')];
}

/** 비네트 불투명도 (0 ~ alpha): d = 화면 반지름으로 나눈 타원 거리. 부드러운 S자로 어두워짐 */
export function vignetteAlpha(v: Vignette, d: number): number {
  if (d <= v.inner) return 0;
  const t = Math.min(1, (d - v.inner) / (v.outer - v.inner));
  return v.alpha * t * t * (3 - 2 * t);
}
