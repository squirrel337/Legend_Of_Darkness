// 게임 데이터(gamedata/*.json)의 형식 정의
import type { ClassId, Dir, Element, EquipSlot, StatKey, StatusId } from './constants';

export interface StatBlock {
  str: number;
  int: number;
  wis: number;
  con: number;
  dex: number;
}

export type IconShape =
  | 'sword'
  | 'axe'
  | 'dagger'
  | 'claw'
  | 'staff'
  | 'mace'
  | 'stick'
  | 'armor'
  | 'robe'
  | 'gi'
  | 'leather'
  | 'helmet'
  | 'shield'
  | 'necklace'
  | 'earring'
  | 'ring'
  | 'belt'
  | 'boots'
  | 'potion'
  | 'scroll'
  | 'gem'
  | 'bone'
  | 'pelt'
  | 'wing'
  | 'tail'
  | 'web'
  | 'ear'
  | 'scale'
  | 'orb'
  | 'coin'
  | 'slash'
  | 'burst'
  | 'bolt'
  | 'heart'
  | 'cross'
  | 'fist'
  | 'eye'
  | 'shieldIcon'
  | 'skull'
  | 'wave'
  | 'leaf'
  | 'star';

export interface IconSpec {
  shape: IconShape;
  color: string;
  color2?: string;
}

/** 장비가 주는 추가 능력치 */
export interface ItemBonus {
  str?: number;
  int?: number;
  wis?: number;
  con?: number;
  dex?: number;
  hp?: number;
  mp?: number;
  /** 명중 보정 (%) */
  hit?: number;
  /** 물리 피해 고정 추가 */
  dmg?: number;
  /** 마법 피해/회복 증가 (%) */
  magic?: number;
}

export interface ItemUse {
  hp?: number;
  mp?: number;
  hpPct?: number;
  mpPct?: number;
  /** 마을 귀환 */
  recall?: boolean;
  /** 해로운 상태 해제 */
  cure?: boolean;
  /** 경험치 획득 */
  exp?: number;
  /** 걸리는 버프 */
  status?: StatusId;
  statusMs?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  type: 'equip' | 'consumable' | 'material';
  slot?: EquipSlot;
  /** 착용/사용 가능 레벨 */
  level?: number;
  /** 착용 가능 직업 (없으면 모두) */
  classes?: ClassId[];
  /** 무기 피해 [최소, 최대] */
  dmg?: [number, number];
  /** AC (음수일수록 방어력이 높음) */
  ac?: number;
  bonus?: ItemBonus;
  /** 공격 속성 (목걸이) */
  offense?: Element;
  /** 방어 속성 (허리띠) */
  defense?: Element;
  /** 상점 구매 가격. 판매 가격은 절반 */
  price: number;
  /** 최대 겹침 수 (1이면 겹치지 않음) */
  stack?: number;
  use?: ItemUse;
  icon: IconSpec;
  desc?: string;
}

export type Targeting =
  /** 바라보는 앞 칸 */
  | 'front'
  /** 주변 4칸 */
  | 'around'
  /** 주변 8칸 */
  | 'around8'
  /** 자기 자신 */
  | 'self'
  /** 적 하나 (사거리 내) */
  | 'enemy'
  /** 아군 하나 (대상이 없으면 자신) */
  | 'ally'
  /** 적 하나 + 그 주변 */
  | 'enemyArea'
  /** 앞으로 일직선 */
  | 'line';

export type AbilityEffect =
  /** 무기 기반 물리 피해 */
  | { type: 'physical'; mult: number; bonus?: number; critBonus?: number; hideBonus?: number }
  /** 능력치 기반 마법 피해 */
  | { type: 'magic'; base: number; ratio: number; stat?: StatKey }
  /** 회복 */
  | { type: 'heal'; base: number; ratio: number; stat?: StatKey }
  /** 상태 효과 부여 */
  | { type: 'status'; status: StatusId; durationMs: number; chance?: number; potency?: number }
  /** 해로운 상태 해제 */
  | { type: 'cleanse' }
  /** 유령 상태의 대상을 부활 */
  | { type: 'revive'; hpPct: number }
  /** 마나 회복 (최대치 비율) */
  | { type: 'restoreMp'; pct: number }
  /** 자신의 체력을 소모해 큰 피해 */
  | { type: 'sacrifice'; hpPct: number; mult: number }
  /** 앞으로 돌진 */
  | { type: 'dash'; distance: number };

export interface AbilityDef {
  id: string;
  name: string;
  kind: 'skill' | 'spell';
  /** 배울 수 있는 직업. 'monster'는 몬스터 전용 */
  classId: ClassId | 'monster';
  /** 배울 수 있는 레벨 */
  level: number;
  /** 배우는 비용 (골드) */
  price: number;
  mp: number;
  cooldownMs: number;
  targeting: Targeting;
  /** 대상 지정형 사거리 (칸) */
  range?: number;
  /** 'weapon'이면 장비의 공격 속성을 따름 */
  element?: Element | 'weapon';
  effects: AbilityEffect[];
  /** 클라이언트 시각 효과 키 */
  fx?: string;
  icon: IconSpec;
  desc: string;
}

export type BodyPlan =
  | 'rat'
  | 'bat'
  | 'spider'
  | 'wolf'
  | 'humanoid'
  | 'skeleton'
  | 'ghost'
  | 'slime'
  | 'golem'
  | 'beast'
  | 'dragon'
  | 'eye'
  | 'dummy'
  | 'serpent'
  | 'plant';

export interface MonsterLook {
  body: BodyPlan;
  color: string;
  color2?: string;
  /** 크기 배율 (기본 1) */
  size?: number;
  eye?: string;
}

export interface LootEntry {
  item: string;
  /** 0~1 확률 */
  chance: number;
  qty?: [number, number];
}

export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  /** 지정하지 않으면 레벨로 자동 계산 */
  hp?: number;
  dmg?: [number, number];
  ac?: number;
  exp?: number;
  gold?: [number, number];
  /** 자동 계산값에 곱하는 배율 */
  hpMult?: number;
  dmgMult?: number;
  expMult?: number;
  element?: Element;
  atkElement?: Element;
  /** 먼저 공격하는지 */
  aggressive?: boolean;
  aggroRange?: number;
  moveMs?: number;
  attackMs?: number;
  /** 사용 마법 */
  spells?: { id: string; chance: number }[];
  loot?: LootEntry[];
  look: MonsterLook;
  boss?: boolean;
  /** 움직이지도 공격하지도 않음 (수련용 허수아비) */
  passive?: boolean;
  desc?: string;
}

export interface HumanLook {
  gender: 'm' | 'f';
  hairStyle: number;
  hairColor: string;
  /** 옷 색 */
  body: string;
  body2?: string;
  /** 옷 모양 (직업 의상). 없으면 평민 옷 */
  outfit?: ClassId;
  /** 손에 든 무기 모양 */
  weapon?: IconShape;
  weaponColor?: string;
  helmet?: string;
  shield?: string;
}

export type NpcService =
  | { type: 'shop'; label?: string; items: string[] }
  | { type: 'buy'; label?: string }
  | { type: 'class'; classId: ClassId }
  | { type: 'revive' }
  | { type: 'heal'; price?: number }
  | { type: 'ascend' }
  | {
      type: 'teleport';
      label?: string;
      /** x, y를 생략하면 그 맵의 기본 도착 지점(spawn)으로 이동 */
      dests: { label: string; map: string; x?: number; y?: number; price?: number; minLevel?: number }[];
    }
  | { type: 'resetStats'; price: number }
  | { type: 'storage' }
  | { type: 'talk'; label: string; text: string };

export interface NpcDef {
  id: string;
  name: string;
  title?: string;
  look: HumanLook;
  greeting: string;
  services: NpcService[];
}

export interface ClassDef {
  id: ClassId;
  name: string;
  desc: string;
  color: string;
  baseHp: number;
  baseMp: number;
  hpPerLevel: number;
  mpPerLevel: number;
  hpPerCon: number;
  mpPerWis: number;
  /** 능력치 자동 분배 비율 */
  statWeights: Partial<Record<StatKey, number>>;
  /** 직업을 선택할 때 받는 아이템 */
  starterItems?: string[];
}

export interface WarpDef {
  x: number;
  y: number;
  to: string;
  tx: number;
  ty: number;
  minLevel?: number;
  label?: string;
}

export interface SpawnDef {
  monster: string;
  count: number;
  area?: { x: number; y: number; w: number; h: number };
  respawnMs?: number;
}

export interface MapNpcDef {
  npc: string;
  x: number;
  y: number;
  dir?: Dir;
}

export interface MapDef {
  id: string;
  name: string;
  tiles: string[];
  /** 안전 지대 (몬스터/전투 없음) */
  safe?: boolean;
  /** 어두운 지역 (클라이언트가 시야를 어둡게 표시) */
  dark?: boolean;
  /** 레벨 안내 (표시용) */
  levelRange?: [number, number];
  spawn: { x: number; y: number };
  warps: WarpDef[];
  npcs: MapNpcDef[];
  spawns: SpawnDef[];
}

/** 서버 설정 중 클라이언트에 알려주는 값 */
export interface PublicServerInfo {
  name: string;
  motd: string;
  expRate: number;
  goldRate: number;
  dropRate: number;
  maxLevel: number;
  statCap: number;
  classLevel: number;
  registration: 'open' | 'invite' | 'closed';
}
