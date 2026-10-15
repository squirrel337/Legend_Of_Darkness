// WebSocket 메시지 형식 (JSON). 서버는 한 번에 여러 메시지를 배열로 묶어 보낼 수 있습니다.
import type { ClassId, Dir, Element, EquipSlot, Role, StatKey, StatusId } from './constants';
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
}

export interface ClientGameData {
  classes: ClassDef[];
  items: ItemDef[];
  abilities: AbilityDef[];
  monsters: PublicMonsterDef[];
  maps: { id: string; name: string; levelRange?: [number, number] }[];
  server: PublicServerInfo;
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
  | {
      t: 'learn';
      npc: number;
      name: string;
      list: { id: string; level: number; price: number; learned: boolean }[];
    }
  | { t: 'storage'; npc: number; slots: InvSlot[]; gold: number }
  | { t: 'closeDialog' }
  | { t: 'group'; members: GroupMember[] | null }
  | { t: 'groupInvite'; from: string }
  | { t: 'notice'; text: string; kind?: 'info' | 'warn' | 'good' }
  | { t: 'levelUp'; level: number }
  | { t: 'gain'; exp: number; gold: number }
  | { t: 'pong'; ts: number }
  | { t: 'kick'; reason: string };

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
  | { t: 'attack' }
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
  | { t: 'ping'; ts: number };

export type C2SType = C2S['t'];
