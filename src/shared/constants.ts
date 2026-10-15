// 서버와 클라이언트가 함께 쓰는 상수 모음

export const PROTOCOL_VERSION = 1;

// 아이소메트릭 타일 크기 (픽셀)
export const TILE_W = 64;
export const TILE_H = 32;

/** 방향: 0=북(화면 오른쪽 위) 1=동(오른쪽 아래) 2=남(왼쪽 아래) 3=서(왼쪽 위) */
export type Dir = 0 | 1 | 2 | 3;
export const DIR_DX: readonly number[] = [0, 1, 0, -1];
export const DIR_DY: readonly number[] = [-1, 0, 1, 0];

export function isDir(v: unknown): v is Dir {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

export function oppositeDir(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

/** (fx,fy)에서 (tx,ty)를 바라보는 방향. 같은 칸이면 null */
export function dirTowards(fx: number, fy: number, tx: number, ty: number): Dir | null {
  const dx = tx - fx;
  const dy = ty - fy;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

export const INVENTORY_SIZE = 48;
export const MAX_STACK_DEFAULT = 1;
export const MAX_ABILITIES = 40;

// 이동/행동 속도 (밀리초)
export const WALK_MS = 230;
export const ASSAIL_COOLDOWN_MS = 650;
export const SPELL_GCD_MS = 500;
export const SKILL_GCD_MS = 250;
export const ITEM_COOLDOWN_MS = 250;

/** NPC와 대화할 수 있는 최대 거리 (칸) */
export const NPC_TALK_RANGE = 4;
/** 일반 대화(말하기)가 들리는 거리 */
export const SAY_RANGE = 12;
/** 바닥 아이템 소유권 유지 시간 / 소멸 시간 */
export const LOOT_OWNER_MS = 30_000;
export const GROUND_ITEM_TTL_MS = 180_000;

export const NAME_MIN = 2;
export const NAME_MAX = 12;
/** 캐릭터 이름: 한글/영문으로 시작, 한글/영문/숫자 2~12자 */
export const NAME_REGEX = /^[가-힣A-Za-z][가-힣A-Za-z0-9]{1,11}$/;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;
export const CHAT_MAX = 200;

export type ClassId = 'peasant' | 'warrior' | 'rogue' | 'wizard' | 'priest' | 'monk';
export const CLASS_IDS: readonly ClassId[] = ['peasant', 'warrior', 'rogue', 'wizard', 'priest', 'monk'];
export function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && (CLASS_IDS as readonly string[]).includes(v);
}

export type Element = 'none' | 'fire' | 'water' | 'wind' | 'earth' | 'light' | 'dark';
export const ELEMENTS: readonly Element[] = ['none', 'fire', 'water', 'wind', 'earth', 'light', 'dark'];
export const ELEMENT_NAMES: Record<Element, string> = {
  none: '무',
  fire: '불',
  water: '물',
  wind: '바람',
  earth: '땅',
  light: '빛',
  dark: '어둠',
};
export const ELEMENT_COLORS: Record<Element, string> = {
  none: '#cfcfcf',
  fire: '#ff6a3d',
  water: '#4fa3ff',
  wind: '#7fe0a0',
  earth: '#c49a5a',
  light: '#fff3a0',
  dark: '#a070ff',
};

export type StatKey = 'str' | 'int' | 'wis' | 'con' | 'dex';
export const STAT_KEYS: readonly StatKey[] = ['str', 'int', 'wis', 'con', 'dex'];
export const STAT_NAMES: Record<StatKey, string> = {
  str: '힘',
  int: '지능',
  wis: '지혜',
  con: '건강',
  dex: '민첩',
};
export function isStatKey(v: unknown): v is StatKey {
  return typeof v === 'string' && (STAT_KEYS as readonly string[]).includes(v);
}

export type EquipSlot =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'helmet'
  | 'necklace'
  | 'earring'
  | 'ring'
  | 'belt'
  | 'boots';
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'armor',
  'shield',
  'helmet',
  'necklace',
  'earring',
  'ring',
  'belt',
  'boots',
];
export const EQUIP_SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: '무기',
  armor: '갑옷',
  shield: '방패',
  helmet: '투구',
  necklace: '목걸이',
  earring: '귀걸이',
  ring: '반지',
  belt: '허리띠',
  boots: '신발',
};
export function isEquipSlot(v: unknown): v is EquipSlot {
  return typeof v === 'string' && (EQUIP_SLOTS as readonly string[]).includes(v);
}

export type Role = 'player' | 'gm' | 'admin';
export const ROLE_NAMES: Record<Role, string> = { player: '일반', gm: '운영자(GM)', admin: '관리자' };
export function isRole(v: unknown): v is Role {
  return v === 'player' || v === 'gm' || v === 'admin';
}

/** 상태 효과 (버프/디버프) */
export type StatusId =
  | 'armor'
  | 'ironskin'
  | 'might'
  | 'focus'
  | 'hide'
  | 'regen'
  | 'curse'
  | 'poison'
  | 'sleep'
  | 'paralyze';

export interface StatusInfo {
  name: string;
  kind: 'buff' | 'debuff';
  color: string;
  /** potency 기본값 */
  potency: number;
  desc: string;
}

export const STATUS_INFO: Record<StatusId, StatusInfo> = {
  armor: { name: '보호', kind: 'buff', color: '#7fb7ff', potency: 20, desc: 'AC가 낮아집니다(방어 증가)' },
  ironskin: { name: '철갑', kind: 'buff', color: '#c0c0c0', potency: 30, desc: '받는 피해가 줄어듭니다' },
  might: { name: '광폭', kind: 'buff', color: '#ff7f50', potency: 25, desc: '물리 피해가 증가합니다' },
  focus: { name: '집중', kind: 'buff', color: '#b388ff', potency: 25, desc: '마법 피해와 회복량이 증가합니다' },
  hide: { name: '은신', kind: 'buff', color: '#6d6d8f', potency: 100, desc: '몬스터가 알아채지 못합니다. 공격하면 풀립니다' },
  regen: { name: '재생', kind: 'buff', color: '#7fff9f', potency: 10, desc: '매초 체력이 회복됩니다' },
  curse: { name: '저주', kind: 'debuff', color: '#9b30ff', potency: 25, desc: 'AC가 높아집니다(방어 감소)' },
  poison: { name: '중독', kind: 'debuff', color: '#5fbf3f', potency: 10, desc: '매초 체력이 감소합니다' },
  sleep: { name: '수면', kind: 'debuff', color: '#8fa8ff', potency: 0, desc: '움직일 수 없습니다. 피해를 받으면 깨어납니다' },
  paralyze: { name: '마비', kind: 'debuff', color: '#ffe14f', potency: 0, desc: '움직이거나 행동할 수 없습니다' },
};

export const STATUS_IDS = Object.keys(STATUS_INFO) as StatusId[];
export function isStatusId(v: unknown): v is StatusId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(STATUS_INFO, v);
}

/** 레벨 구간별 서클 (어둠의 전설 스타일) */
export function circleOf(level: number): number {
  if (level <= 10) return 1;
  if (level <= 40) return 2;
  if (level <= 70) return 3;
  if (level <= 98) return 4;
  return 5;
}

export const CLASS_FALLBACK_NAMES: Record<ClassId, string> = {
  peasant: '평민',
  warrior: '전사',
  rogue: '도적',
  wizard: '마법사',
  priest: '성직자',
  monk: '무도가',
};

/** 헤어 색 팔레트 */
export const HAIR_COLORS: readonly string[] = [
  '#2b1d14',
  '#5a3a22',
  '#8b5a2b',
  '#c99a4b',
  '#e8d08a',
  '#d0d0d0',
  '#8a1c1c',
  '#d0532a',
  '#2a4d8f',
  '#3e7d3a',
  '#6b2d8f',
  '#1a1a1a',
];
export const HAIR_STYLES = 6;
export const SKIN_COLOR = '#f1c9a5';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString('ko-KR');
}
