// WebSocket 메시지 형식 (JSON). 서버는 한 번에 여러 메시지를 배열로 묶어 보낼 수 있습니다.
import type { AutoSettings, AutoState } from './autohunt';
import type { ClassId, Dir, Element, EquipSlot, Role, StatKey, StatusId } from './constants';
import type { LearnStatus, PublicProgression, SkillTreeConfig } from './progression';
import type {
  AbilityDef,
  ClassDef,
  HumanLook,
  ItemDef,
  MonsterLook,
  PublicServerInfo,
  StatBlock,
} from './types';

// ───────────────────────── 엔티티 스냅샷 ─────────────────────────

interface EntityBase {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  name: string;
}

export interface PlayerSnapshot extends EntityBase {
  type: 'player';
  look: HumanLook;
  classId: ClassId;
  level: number;
  ghost: boolean;
  role: Role;
  hpPct: number;
  statuses: StatusId[];
}

export interface MonsterSnapshot extends EntityBase {
  type: 'monster';
  def: string;
  level: number;
  hpPct: number;
  statuses: StatusId[];
  /** 소환수면 주인(플레이어) 엔티티 id */
  ownerId?: number;
  /** 소환수면 주인 이름 */
  ownerName?: string;
}

export interface NpcSnapshot extends EntityBase {
  type: 'npc';
  def: string;
  title?: string;
  look: HumanLook;
}

export interface GroundItemSnapshot extends EntityBase {
  type: 'item';
  /** null 이면 골드 */
  item: string | null;
  qty: number;
}

export type EntitySnapshot = PlayerSnapshot | MonsterSnapshot | NpcSnapshot | GroundItemSnapshot;

// ───────────────────────── 내 캐릭터 상태 ─────────────────────────

export interface SelfStats {
  str: number;
  int: number;
  wis: number;
  con: number;
  dex: number;
  ac: number;
  dmgMin: number;
  dmgMax: number;
  dmgBonus: number;
  hit: number;
  magic: number;
  offense: Element;
  defense: Element;
  /** 무기 사거리 (1 = 근접) */
  range: number;
}

export interface SelfState {
  id: number;
  name: string;
  classId: ClassId;
  level: number;
  exp: number;
  /** 다음 레벨까지 필요한 경험치 (만렙이면 0) */
  expNext: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  gold: number;
  statPoints: number;
  base: StatBlock;
  stats: SelfStats;
  bonusHp: number;
  bonusMp: number;
  role: Role;
  ghost: boolean;
  god: boolean;
  equipment: Record<EquipSlot, string | null>;
  statuses: { id: StatusId; ms: number }[];
  mapId: string;
  kills: number;
  deaths: number;
  // ── 성장 체계 (docs/progression.md) ──
  /** 전직(환골탈태) 횟수 */
  rebirths: number;
  /** 승급했는지 */
  ascended: boolean;
  /** 칭호 (승급하면 progression.json 의 ascend.title, 없으면 빈 문자열) */
  title: string;
  /** 어빌리티 레벨 (2차 직업이 아니면 0) */
  abilityLevel: number;
  /** 지금 어빌 레벨에서 쌓인 어빌 경험치 */
  abilityExp: number;
  /** 다음 어빌 레벨까지 필요한 어빌 경험치 (2차 직업이 아니거나 만렙이면 0) */
  abilityExpNext: number;
  /** 수인 계통 id (수인이 아니거나 아직 고르지 않았으면 null) */
  beastType: string | null;
  /** 배운 기술·마법의 숙련도 (기술 id → 0 ~ 숙련도 최대). 오를 때는 'prof' 메시지로 한 칸씩 옵니다 */
  prof: Record<string, number>;
}

export interface InvSlot {
  item: string;
  qty: number;
}

export interface MapView {
  id: string;
  name: string;
  tiles: string[];
  safe: boolean;
  dark: boolean;
  levelRange?: [number, number];
  warps: { x: number; y: number; label: string; minLevel?: number }[];
}

export interface PublicMonsterDef {
  id: string;
  name: string;
  level: number;
  look: MonsterLook;
  boss?: boolean;
  /** 소환수 전용 */
  summon?: boolean;
}

export interface ClientGameData {
  classes: ClassDef[];
  items: ItemDef[];
  abilities: AbilityDef[];
  monsters: PublicMonsterDef[];
  maps: { id: string; name: string; levelRange?: [number, number] }[];
  server: PublicServerInfo;
  /** 직업별 스킬트리 (gamedata/skilltrees.json 그대로: 칸 배치와 배우는 조건) */
  skillTrees: Record<ClassId, SkillTreeConfig>;
  /** 성장 규칙 중 클라이언트가 쓰는 부분 */
  progression: PublicProgression;
}

/** 길드장의 기술 배우기 창에 보이는 기술 하나 (스킬트리 노드의 조건과 지금 상태) */
export interface LearnEntry extends LearnStatus {
  /** 기술 id */
  id: string;
  /** 필요 레벨 (1차 직업·평민 기술, 없으면 0) */
  level: number;
  /** 필요 어빌리티 레벨 (2차 직업 기술, 없으면 0) */
  abilityLevel: number;
  /** 내는 골드 */
  price: number;
}

export interface GroupMember {
  name: string;
  level: number;
  classId: ClassId;
  hpPct: number;
  mpPct: number;
  online: boolean;
  sameMap: boolean;
  leader: boolean;
}

export type ChatChannel = 'say' | 'shout' | 'whisper' | 'group' | 'system' | 'notice' | 'gm' | 'error';

export type DamageKind = 'phys' | 'crit' | 'magic' | 'heal' | 'miss' | 'dot' | 'mp' | 'immune';

export interface DialogOption {
  key: string;
  label: string;
}

// ───────────────────────── 서버 → 클라이언트 ─────────────────────────

export type S2C =
  | { t: 'hello'; version: number; server: PublicServerInfo }
  | { t: 'authFail'; msg: string }
  | { t: 'welcome'; selfId: number; data: ClientGameData }
  | { t: 'self'; s: SelfState }
  | { t: 'vitals'; hp: number; mp: number; maxHp: number; maxMp: number }
  | { t: 'inv'; slots: (InvSlot | null)[]; gold: number }
  | { t: 'abilities'; skills: string[]; spells: string[] }
  | { t: 'cooldown'; id: string; ms: number }
  | { t: 'map'; map: MapView; entities: EntitySnapshot[]; x: number; y: number; dir: Dir }
  | { t: 'add'; e: EntitySnapshot }
  | { t: 'remove'; id: number; fx?: 'death' | 'warp' | 'pickup' }
  | { t: 'walk'; id: number; x: number; y: number; dir: Dir }
  | { t: 'turn'; id: number; dir: Dir }
  | { t: 'jump'; id: number; x: number; y: number; dir: Dir }
  | { t: 'pos'; x: number; y: number; dir: Dir }
  | { t: 'act'; id: number; a: 'attack' | 'cast' | 'skill'; dir: Dir }
  | { t: 'dmg'; id: number; v: number; k: DamageKind; hp: number }
  | { t: 'fx'; fx: string; id?: number; x?: number; y?: number; from?: number; el?: Element }
  | { t: 'look'; id: number; look: HumanLook; ghost: boolean; level: number; classId: ClassId; role: Role }
  | { t: 'statuses'; id: number; statuses: StatusId[] }
  | { t: 'chat'; ch: ChatChannel; text: string; from?: string; id?: number }
  | { t: 'dialog'; npc: number; name: string; title?: string; text: string; options: DialogOption[] }
  | { t: 'shop'; npc: number; name: string; items: { item: string; price: number }[]; sell: boolean }
  /** 길드장의 기술 배우기 창: classId 직업 트리의 기술들 (필요 레벨·어빌 순) */
  | { t: 'learn'; npc: number; name: string; classId: ClassId; list: LearnEntry[] }
  | { t: 'storage'; npc: number; slots: InvSlot[]; gold: number }
  | { t: 'closeDialog' }
  | { t: 'group'; members: GroupMember[] | null }
  | { t: 'groupInvite'; from: string }
  | { t: 'notice'; text: string; kind?: 'info' | 'warn' | 'good' }
  | { t: 'levelUp'; level: number }
  /** 어빌리티 레벨이 올랐을 때 */
  | { t: 'abilityLevelUp'; abilityLevel: number }
  /** 얻은 경험치·골드. abilityExp 는 2차 직업이 함께 얻은 어빌 경험치 */
  | { t: 'gain'; exp: number; gold: number; abilityExp?: number }
  /** 숙련도가 올랐을 때 (SelfState.prof 의 한 칸만 바꿈) */
  | { t: 'prof'; id: string; prof: number }
  /** 관리자가 직업·스킬트리 설계를 바꿔 서버가 바로 반영했을 때 (접속 중인 모두에게, welcome 의 같은 항목을 바꿔 끼움) */
  | { t: 'design'; abilities: AbilityDef[]; skillTrees: Record<ClassId, SkillTreeConfig>; progression: PublicProgression }
  | { t: 'pong'; ts: number }
  | { t: 'kick'; reason: string }
  /** 자동사냥 상태. reason 은 꺼진 이유 등 */
  | { t: 'auto'; on: boolean; state?: AutoState; reason?: string };

// ───────────────────────── 클라이언트 → 서버 ─────────────────────────

export type C2S =
  | { t: 'login'; name: string; password: string }
  | {
      t: 'create';
      name: string;
      password: string;
      gender: 'm' | 'f';
      hairStyle: number;
      hairColor: number;
      invite?: string;
    }
  | { t: 'walk'; dir: Dir; x: number; y: number }
  | { t: 'turn'; dir: Dir }
  /** 평타. target 은 원거리 무기일 때 노릴 대상 (없으면 가까운 적) */
  | { t: 'attack'; target?: number }
  | { t: 'ability'; id: string; target?: number }
  | { t: 'useItem'; slot: number }
  | { t: 'equip'; slot: number }
  | { t: 'unequip'; eq: EquipSlot }
  | { t: 'dropItem'; slot: number; qty: number }
  | { t: 'dropGold'; amount: number }
  | { t: 'pickup' }
  | { t: 'moveItem'; from: number; to: number }
  | { t: 'moveAbility'; kind: 'skill' | 'spell'; from: number; to: number }
  | { t: 'chat'; text: string }
  | { t: 'talk'; npc: number }
  | { t: 'pick'; npc: number; key: string }
  | { t: 'buy'; npc: number; item: string; qty: number }
  | { t: 'sell'; npc: number; slot: number; qty: number }
  | { t: 'learnAbility'; npc: number; id: string }
  | { t: 'deposit'; npc: number; slot: number; qty: number }
  | { t: 'withdraw'; npc: number; index: number; qty: number }
  | { t: 'depositGold'; npc: number; amount: number }
  | { t: 'withdrawGold'; npc: number; amount: number }
  | { t: 'stat'; stat: StatKey; n: number }
  | { t: 'recall' }
  | { t: 'groupReply'; accept: boolean }
  /** 자동사냥 켜기/끄기 (켤 때 설정을 함께 보냄) */
  | { t: 'auto'; on: boolean; settings?: AutoSettings }
  | { t: 'ping'; ts: number };

export type C2SType = C2S['t'];
