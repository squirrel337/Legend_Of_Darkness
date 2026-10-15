// 클라이언트가 알고 있는 게임 상태
import { WALK_MS, type ClassId, type Dir, type Role, type StatusId } from '../shared/constants';
import type {
  ClientGameData,
  EntitySnapshot,
  GroupMember,
  InvSlot,
  MapView,
  PublicMonsterDef,
  SelfState,
} from '../shared/protocol';
import type { AbilityDef, ClassDef, HumanLook, ItemDef } from '../shared/types';
import { tileInfo } from '../shared/tiles';

export interface CEntity {
  id: number;
  type: 'player' | 'monster' | 'npc' | 'item';
  name: string;
  x: number;
  y: number;
  dir: Dir;
  // 이동 보간
  fromX: number;
  fromY: number;
  moveStart: number;
  moveDur: number;
  // 표시 정보
  look?: HumanLook;
  def?: string;
  title?: string;
  level: number;
  hpPct: number;
  ghost: boolean;
  role?: Role;
  classId?: ClassId;
  statuses: StatusId[];
  item?: string | null;
  qty?: number;
  // 애니메이션
  actKind?: 'attack' | 'cast' | 'skill';
  actStart: number;
  hitFlash: number;
  bubble?: { text: string; until: number };
  dying?: number;
  showHpUntil: number;
}

export function entityFromSnapshot(s: EntitySnapshot): CEntity {
  const e: CEntity = {
    id: s.id,
    type: s.type,
    name: s.name,
    x: s.x,
    y: s.y,
    dir: s.dir,
    fromX: s.x,
    fromY: s.y,
    moveStart: 0,
    moveDur: 0,
    level: 0,
    hpPct: 100,
    ghost: false,
    statuses: [],
    actStart: 0,
    hitFlash: 0,
    showHpUntil: 0,
  };
  switch (s.type) {
    case 'player':
      e.look = s.look;
      e.level = s.level;
      e.hpPct = s.hpPct;
      e.ghost = s.ghost;
      e.role = s.role;
      e.classId = s.classId;
      e.statuses = s.statuses;
      break;
    case 'monster':
      e.def = s.def;
      e.level = s.level;
      e.hpPct = s.hpPct;
      e.statuses = s.statuses;
      break;
    case 'npc':
      e.def = s.def;
      e.look = s.look;
      if (s.title) e.title = s.title;
      break;
    case 'item':
      e.item = s.item;
      e.qty = s.qty;
      break;
  }
  return e;
}

/** 보간된 현재 위치 (타일 단위 실수) */
export function entityPos(e: CEntity, now: number): { x: number; y: number; moving: boolean; t: number } {
  if (e.moveDur <= 0) return { x: e.x, y: e.y, moving: false, t: 1 };
  const t = Math.min(1, (now - e.moveStart) / e.moveDur);
  if (t >= 1) return { x: e.x, y: e.y, moving: false, t: 1 };
  return { x: e.fromX + (e.x - e.fromX) * t, y: e.fromY + (e.y - e.fromY) * t, moving: true, t };
}

export function startMove(e: CEntity, x: number, y: number, now: number, dur = WALK_MS): void {
  const cur = entityPos(e, now);
  e.fromX = cur.x;
  e.fromY = cur.y;
  e.x = x;
  e.y = y;
  e.moveStart = now;
  e.moveDur = dur;
}

export function snapTo(e: CEntity, x: number, y: number): void {
  e.x = x;
  e.y = y;
  e.fromX = x;
  e.fromY = y;
  e.moveDur = 0;
}

export class ClientState {
  data!: ClientGameData;
  items = new Map<string, ItemDef>();
  abilities = new Map<string, AbilityDef>();
  classes = new Map<string, ClassDef>();
  monsters = new Map<string, PublicMonsterDef>();
  mapNames = new Map<string, string>();

  selfId = 0;
  self: SelfState | null = null;
  inventory: (InvSlot | null)[] = [];
  gold = 0;
  skills: string[] = [];
  spells: string[] = [];
  cooldowns = new Map<string, { start: number; end: number }>();
  group: GroupMember[] | null = null;

  map: MapView | null = null;
  warpSet = new Set<number>();
  entities = new Map<number, CEntity>();
  targetId: number | null = null;

  setData(data: ClientGameData): void {
    this.data = data;
    this.items = new Map(data.items.map((i) => [i.id, i]));
    this.abilities = new Map(data.abilities.map((a) => [a.id, a]));
    this.classes = new Map(data.classes.map((c) => [c.id, c]));
    this.monsters = new Map(data.monsters.map((m) => [m.id, m]));
    this.mapNames = new Map(data.maps.map((m) => [m.id, m.name]));
  }

  get me(): CEntity | undefined {
    return this.entities.get(this.selfId);
  }

  setMap(map: MapView): void {
    this.map = map;
    this.warpSet = new Set(map.warps.map((w) => w.y * this.mapWidth + w.x));
    this.entities.clear();
    this.targetId = null;
  }

  get mapWidth(): number {
    return this.map?.tiles[0]?.length ?? 0;
  }

  get mapHeight(): number {
    return this.map?.tiles.length ?? 0;
  }

  tileAt(x: number, y: number): string | undefined {
    return this.map?.tiles[y]?.[x];
  }

  walkable(x: number, y: number): boolean {
    return tileInfo(this.tileAt(x, y)).walkable;
  }

  isWarp(x: number, y: number): boolean {
    return this.warpSet.has(y * this.mapWidth + x);
  }

  /** 칸을 막는 엔티티가 있는지 (자기 자신 제외) */
  blockedByEntity(x: number, y: number, ghost: boolean): boolean {
    for (const e of this.entities.values()) {
      if (e.id === this.selfId || e.dying) continue;
      if (e.x !== x || e.y !== y) continue;
      if (e.type === 'npc') return true;
      if (ghost) continue;
      if (e.type === 'monster') return true;
      if (e.type === 'player' && !e.ghost) return true;
    }
    return false;
  }

  itemName(id: string): string {
    return this.items.get(id)?.name ?? id;
  }

  className(id: string): string {
    return this.classes.get(id)?.name ?? id;
  }
}
