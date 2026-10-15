// 맵 하나의 실행 상태: 타일, 엔티티, 점유 칸, 몬스터 생성기
import type { MapDef, WarpDef } from '../../shared/types';
import type { EntitySnapshot, MapView, S2C } from '../../shared/protocol';
import { tileInfo } from '../../shared/tiles';
import type { Creature, Entity } from './entities';
import type { Player } from './Player';
import type { Monster } from './Monster';
import type { Npc } from './Npc';
import type { GroundItem } from './GroundItem';
import type { Spawner } from './Spawner';

const DIRS4: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export class MapInstance {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  private readonly walkableTiles: Uint8Array;
  private readonly warps = new Map<number, WarpDef>();
  private readonly occ = new Map<number, Creature>();
  readonly entities = new Map<number, Entity>();
  readonly players = new Set<Player>();
  readonly monsters = new Set<Monster>();
  readonly npcs = new Set<Npc>();
  readonly items = new Set<GroundItem>();
  readonly spawners: Spawner[] = [];
  readonly view: MapView;

  constructor(readonly def: MapDef) {
    this.id = def.id;
    this.height = def.tiles.length;
    this.width = def.tiles[0]!.length;
    this.walkableTiles = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      const row = def.tiles[y]!;
      for (let x = 0; x < this.width; x++) this.walkableTiles[y * this.width + x] = tileInfo(row[x]).walkable ? 1 : 0;
    }
    for (const w of def.warps) this.warps.set(this.idx(w.x, w.y), w);
    this.view = {
      id: def.id,
      name: def.name,
      tiles: def.tiles,
      safe: def.safe === true,
      dark: def.dark === true,
      ...(def.levelRange ? { levelRange: def.levelRange } : {}),
      warps: def.warps.map((w) => ({ x: w.x, y: w.y, label: w.label ?? w.to, ...(w.minLevel ? { minLevel: w.minLevel } : {}) })),
    };
  }

  get safe(): boolean {
    return this.def.safe === true;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.walkableTiles[this.idx(x, y)] === 1;
  }

  creatureAt(x: number, y: number): Creature | undefined {
    return this.inBounds(x, y) ? this.occ.get(this.idx(x, y)) : undefined;
  }

  /** NPC 포함, 칸을 막고 있는 엔티티 */
  blockerAt(x: number, y: number): Entity | undefined {
    const c = this.creatureAt(x, y);
    if (c) return c;
    for (const n of this.npcs) if (n.x === x && n.y === y) return n;
    return undefined;
  }

  isFree(x: number, y: number): boolean {
    return this.isWalkable(x, y) && this.blockerAt(x, y) === undefined;
  }

  warpAt(x: number, y: number): WarpDef | undefined {
    return this.inBounds(x, y) ? this.warps.get(this.idx(x, y)) : undefined;
  }

  isWarpTile(x: number, y: number): boolean {
    return this.warpAt(x, y) !== undefined;
  }

  /** 엔티티를 맵에 추가하고 다른 플레이어에게 알립니다 */
  add(e: Entity): void {
    e.map = this;
    this.entities.set(e.id, e);
    switch (e.kind) {
      case 'player':
        this.players.add(e as Player);
        break;
      case 'monster':
        this.monsters.add(e as Monster);
        break;
      case 'npc':
        this.npcs.add(e as Npc);
        break;
      case 'item':
        this.items.add(e as GroundItem);
        break;
    }
    if (e.blocks && (e.kind === 'player' || e.kind === 'monster')) this.occ.set(this.idx(e.x, e.y), e as Creature);
    const snap = e.snapshot();
    this.broadcast({ t: 'add', e: snap }, e.kind === 'player' ? (e as Player) : undefined);
  }

  remove(e: Entity, fx?: 'death' | 'warp' | 'pickup'): void {
    if (!this.entities.has(e.id)) return;
    this.entities.delete(e.id);
    this.players.delete(e as Player);
    this.monsters.delete(e as Monster);
    this.npcs.delete(e as Npc);
    this.items.delete(e as GroundItem);
    const k = this.idx(e.x, e.y);
    if (this.occ.get(k) === e) this.occ.delete(k);
    e.map = null;
    this.broadcast(fx ? { t: 'remove', id: e.id, fx } : { t: 'remove', id: e.id });
  }

  /** 좌표만 옮깁니다 (알림은 호출한 쪽에서) */
  move(e: Entity, nx: number, ny: number): void {
    const k = this.idx(e.x, e.y);
    if (this.occ.get(k) === e) this.occ.delete(k);
    e.x = nx;
    e.y = ny;
    if (e.blocks && (e.kind === 'player' || e.kind === 'monster')) this.occ.set(this.idx(nx, ny), e as Creature);
  }

  /** 엔티티의 '칸 막음' 여부가 바뀌었을 때 (유령이 되거나 부활할 때) */
  refreshBlocking(e: Creature): void {
    const k = this.idx(e.x, e.y);
    if (e.blocks) {
      if (!this.occ.has(k)) this.occ.set(k, e);
    } else if (this.occ.get(k) === e) this.occ.delete(k);
  }

  broadcast(msg: S2C, except?: Player): void {
    for (const p of this.players) if (p !== except) p.send(msg);
  }

  broadcastNear(msg: S2C, x: number, y: number, range: number, except?: Player): void {
    for (const p of this.players) {
      if (p === except) continue;
      if (Math.abs(p.x - x) <= range && Math.abs(p.y - y) <= range) p.send(msg);
    }
  }

  /** (x,y) 근처에서 비어 있는 칸을 찾습니다 (워프 칸 제외) */
  findFreeNear(x: number, y: number, maxDist = 8): { x: number; y: number } | null {
    if (this.isFree(x, y) && !this.isWarpTile(x, y)) return { x, y };
    if (!this.inBounds(x, y)) return null;
    const seen = new Set<number>([this.idx(x, y)]);
    let frontier: [number, number][] = [[x, y]];
    for (let d = 0; d < maxDist; d++) {
      const next: [number, number][] = [];
      for (const [cx, cy] of frontier) {
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const k = this.idx(nx, ny);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!this.isWalkable(nx, ny)) continue;
          if (this.isFree(nx, ny) && !this.isWarpTile(nx, ny)) return { x: nx, y: ny };
          next.push([nx, ny]);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return null;
  }

  /** 구역 안의 무작위 빈 칸. 워프 주변(avoidRadius)은 피합니다. */
  randomFreeTile(area: { x: number; y: number; w: number; h: number } | undefined, avoidRadius: number, rnd = Math.random): { x: number; y: number } | null {
    const ax = Math.max(0, area?.x ?? 0);
    const ay = Math.max(0, area?.y ?? 0);
    const aw = Math.min(this.width - ax, area?.w ?? this.width);
    const ah = Math.min(this.height - ay, area?.h ?? this.height);
    if (aw <= 0 || ah <= 0) return null;
    const nearWarp = (x: number, y: number) => {
      for (const w of this.def.warps) if (Math.abs(w.x - x) + Math.abs(w.y - y) <= avoidRadius) return true;
      return Math.abs(this.def.spawn.x - x) + Math.abs(this.def.spawn.y - y) <= avoidRadius;
    };
    for (let i = 0; i < 80; i++) {
      const x = ax + Math.floor(rnd() * aw);
      const y = ay + Math.floor(rnd() * ah);
      if (this.isFree(x, y) && !this.isWarpTile(x, y) && !nearWarp(x, y)) return { x, y };
    }
    // 무작위로 못 찾으면 구역 전체를 훑습니다
    for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) if (this.isFree(x, y) && !this.isWarpTile(x, y) && !nearWarp(x, y)) return { x, y };
    return null;
  }

  itemsAt(x: number, y: number): GroundItem[] {
    const out: GroundItem[] = [];
    for (const it of this.items) if (it.x === x && it.y === y) out.push(it);
    return out;
  }

  snapshotFor(viewer: Player): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const e of this.entities.values()) if (e !== viewer) out.push(e.snapshot());
    return out;
  }

  /**
   * from 에서 to 로 가는 다음 한 걸음을 BFS로 구합니다 (최대 range 칸 탐색).
   * 목표 칸 자체는 막혀 있어도(목표 생물이 서 있어도) 됩니다.
   */
  nextStepTowards(fx: number, fy: number, tx: number, ty: number, range: number): { x: number; y: number } | null {
    if (fx === tx && fy === ty) return null;
    const startK = this.idx(fx, fy);
    const targetK = this.idx(tx, ty);
    const prev = new Map<number, number>();
    prev.set(startK, -1);
    const queue: number[] = [startK];
    let found = -1;
    for (let qi = 0; qi < queue.length && qi < 2500; qi++) {
      const k = queue[qi]!;
      const cx = k % this.width;
      const cy = (k - cx) / this.width;
      if (Math.abs(cx - fx) + Math.abs(cy - fy) > range) continue;
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.inBounds(nx, ny)) continue;
        const nk = this.idx(nx, ny);
        if (prev.has(nk)) continue;
        if (nk === targetK) {
          prev.set(nk, k);
          found = nk;
          break;
        }
        if (!this.isFree(nx, ny) || this.isWarpTile(nx, ny)) continue;
        prev.set(nk, k);
        queue.push(nk);
      }
      if (found >= 0) break;
    }
    if (found < 0) return null;
    let k = found;
    while (prev.get(k) !== startK) {
      const p = prev.get(k);
      if (p === undefined || p < 0) return null;
      k = p;
    }
    if (k === targetK) return null; // 이미 인접
    const x = k % this.width;
    return { x, y: (k - x) / this.width };
  }
}
