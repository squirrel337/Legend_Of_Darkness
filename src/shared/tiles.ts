// 맵 타일 정의. gamedata/maps/*.json 의 tiles 문자열에 쓰이는 문자들입니다.

export type TileKind =
  /** 평평한 바닥 */
  | 'floor'
  /** 높은 벽 (블록 형태) */
  | 'wall'
  /** 나무 */
  | 'tree'
  /** 물/용암 같은 액체 (지나갈 수 없음) */
  | 'liquid'
  /** 바닥 위에 놓인 장애물 */
  | 'object'
  /** 아무것도 없음 */
  | 'void';

export interface TileInfo {
  name: string;
  walkable: boolean;
  kind: TileKind;
  /** 바닥 색 */
  color: string;
  /** 보조 색 (무늬/벽 옆면/물체) */
  color2: string;
  /** 물체 종류 (kind가 object/tree/wall일 때 그리는 모양) */
  shape?:
    | 'rock'
    | 'crate'
    | 'barrel'
    | 'altar'
    | 'pillar'
    | 'grave'
    | 'bush'
    | 'fence'
    | 'well'
    | 'table'
    | 'statue'
    | 'pine'
    | 'oak'
    | 'deadtree'
    | 'crystal'
    | 'torch'
    | 'flowers'
    | 'bones'
    | 'stall'
    | 'sign'
    | 'boulder'
    | 'elm'
    | 'stump'
    | 'lamp'
    | 'post'
    | 'tallgrass';
  /** 바닥 무늬 */
  pattern?:
    | 'grass'
    | 'dirt'
    | 'cobble'
    | 'planks'
    | 'tiles'
    | 'cave'
    | 'sand'
    | 'marble'
    | 'ash'
    | 'swamp'
    | 'flagstone'
    | 'dais';
  /** 낮은 벽 (허리 높이의 담). 지나갈 수 없는 것은 보통 벽과 같습니다 */
  low?: boolean;
}

const T = (t: TileInfo): TileInfo => t;

export const TILESET: Record<string, TileInfo> = {
  '.': T({ name: '풀밭', walkable: true, kind: 'floor', color: '#4f7d3a', color2: '#5f8f44', pattern: 'grass' }),
  ':': T({ name: '꽃밭', walkable: true, kind: 'floor', color: '#4f7d3a', color2: '#5f8f44', pattern: 'grass', shape: 'flowers' }),
  ',': T({ name: '흙길', walkable: true, kind: 'floor', color: '#8a6a45', color2: '#7a5c3b', pattern: 'dirt' }),
  '=': T({ name: '돌바닥', walkable: true, kind: 'floor', color: '#8d8a83', color2: '#77746e', pattern: 'cobble' }),
  _: T({ name: '나무 바닥', walkable: true, kind: 'floor', color: '#9a6b3f', color2: '#80562f', pattern: 'planks' }),
  m: T({ name: '대리석', walkable: true, kind: 'floor', color: '#d8d4cc', color2: '#bdb8ae', pattern: 'marble' }),
  '-': T({ name: '던전 바닥', walkable: true, kind: 'floor', color: '#4a4744', color2: '#3d3a37', pattern: 'tiles' }),
  ';': T({ name: '동굴 바닥', walkable: true, kind: 'floor', color: '#5b5048', color2: '#4c423b', pattern: 'cave' }),
  s: T({ name: '모래', walkable: true, kind: 'floor', color: '#cdb27a', color2: '#bfa36b', pattern: 'sand' }),
  a: T({ name: '잿빛 땅', walkable: true, kind: 'floor', color: '#6e6a62', color2: '#5e5a53', pattern: 'ash' }),
  v: T({ name: '늪', walkable: true, kind: 'floor', color: '#3f5a3a', color2: '#344b30', pattern: 'swamp' }),
  x: T({ name: '심연의 바닥', walkable: true, kind: 'floor', color: '#2e2438', color2: '#251d2e', pattern: 'tiles' }),
  k: T({ name: '뼈 무더기', walkable: true, kind: 'floor', color: '#4a4744', color2: '#3d3a37', pattern: 'tiles', shape: 'bones' }),
  g: T({ name: '판석 광장', walkable: true, kind: 'floor', color: '#a39d8f', color2: '#8a8476', pattern: 'flagstone' }),
  d: T({ name: '돌 단상', walkable: true, kind: 'floor', color: '#c2b79b', color2: '#8f8468', pattern: 'dais' }),
  f: T({ name: '우거진 풀', walkable: true, kind: 'floor', color: '#4f7d3a', color2: '#5f8f44', pattern: 'grass', shape: 'tallgrass' }),

  '~': T({ name: '물', walkable: false, kind: 'liquid', color: '#2f6fa8', color2: '#4f8fc8' }),
  L: T({ name: '용암', walkable: false, kind: 'liquid', color: '#c2410c', color2: '#f59e0b' }),
  U: T({ name: '성수', walkable: false, kind: 'liquid', color: '#3cc4e4', color2: '#d8b040' }),
  ' ': T({ name: '공허', walkable: false, kind: 'void', color: '#000000', color2: '#000000' }),

  '#': T({ name: '돌벽', walkable: false, kind: 'wall', color: '#8b8580', color2: '#6b6560' }),
  W: T({ name: '나무벽', walkable: false, kind: 'wall', color: '#8a5a32', color2: '#6a4322' }),
  D: T({ name: '던전 벽', walkable: false, kind: 'wall', color: '#5a5550', color2: '#403c38' }),
  K: T({ name: '동굴 벽', walkable: false, kind: 'wall', color: '#6b5a4b', color2: '#4e4136' }),
  X: T({ name: '심연의 벽', walkable: false, kind: 'wall', color: '#3d2f4d', color2: '#291f35' }),
  H: T({ name: '신전 벽', walkable: false, kind: 'wall', color: '#e2ddd2', color2: '#b8b2a5' }),
  h: T({ name: '낮은 돌담', walkable: false, kind: 'wall', color: '#8f8a80', color2: '#6f6a60', low: true }),

  T: T({ name: '나무', walkable: false, kind: 'tree', color: '#4f7d3a', color2: '#2f5d24', shape: 'oak' }),
  P: T({ name: '전나무', walkable: false, kind: 'tree', color: '#4f7d3a', color2: '#1f4a2a', shape: 'pine' }),
  Y: T({ name: '고목', walkable: false, kind: 'tree', color: '#6e6a62', color2: '#3a332c', shape: 'deadtree' }),
  E: T({ name: '활엽수', walkable: false, kind: 'tree', color: '#4f7d3a', color2: '#2f6a22', shape: 'elm' }),

  R: T({ name: '바위', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#7d7a74', shape: 'rock' }),
  r: T({ name: '동굴 바위', walkable: false, kind: 'object', color: '#5b5048', color2: '#7a6a5c', shape: 'rock' }),
  B: T({ name: '덤불', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#2f6a2a', shape: 'bush' }),
  F: T({ name: '울타리', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#8a6a45', shape: 'fence' }),
  C: T({ name: '상자', walkable: false, kind: 'object', color: '#9a6b3f', color2: '#b5824e', shape: 'crate' }),
  O: T({ name: '통', walkable: false, kind: 'object', color: '#8d8a83', color2: '#8a5a32', shape: 'barrel' }),
  A: T({ name: '제단', walkable: false, kind: 'object', color: '#d8d4cc', color2: '#f0e6c8', shape: 'altar' }),
  I: T({ name: '기둥', walkable: false, kind: 'object', color: '#8d8a83', color2: '#cfc9bd', shape: 'pillar' }),
  G: T({ name: '묘비', walkable: false, kind: 'object', color: '#4a4744', color2: '#8f8a84', shape: 'grave' }),
  w: T({ name: '우물', walkable: false, kind: 'object', color: '#8d8a83', color2: '#6b6560', shape: 'well' }),
  t: T({ name: '탁자', walkable: false, kind: 'object', color: '#9a6b3f', color2: '#7a4f2a', shape: 'table' }),
  S: T({ name: '석상', walkable: false, kind: 'object', color: '#8d8a83', color2: '#b0aba3', shape: 'statue' }),
  c: T({ name: '수정', walkable: false, kind: 'object', color: '#5b5048', color2: '#7fd6ff', shape: 'crystal' }),
  j: T({ name: '횃불', walkable: false, kind: 'object', color: '#4a4744', color2: '#ffb347', shape: 'torch' }),
  n: T({ name: '노점', walkable: false, kind: 'object', color: '#8d8a83', color2: '#c0392b', shape: 'stall' }),
  N: T({ name: '게시판', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#7a5530', shape: 'sign' }),
  Q: T({ name: '바위 무더기', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#6a6a66', shape: 'boulder' }),
  u: T({ name: '그루터기', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#6a4a2a', shape: 'stump' }),
  l: T({ name: '가로등', walkable: false, kind: 'object', color: '#8d8a83', color2: '#2a2a2a', shape: 'lamp' }),
  p: T({ name: '돌 말뚝', walkable: false, kind: 'object', color: '#4f7d3a', color2: '#9a9488', shape: 'post' }),
};

const BLOCKED: TileInfo = TILESET[' ']!;

export function tileInfo(ch: string | undefined): TileInfo {
  if (ch === undefined) return BLOCKED;
  return TILESET[ch] ?? BLOCKED;
}

export function isKnownTile(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(TILESET, ch);
}
