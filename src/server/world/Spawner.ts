// 맵의 몬스터 생성기: 정해진 수를 유지하고, 죽으면 일정 시간 뒤 다시 생성합니다.
import type { MonsterDef, SpawnDef } from '../../shared/types';
import type { MapInstance } from './MapInstance';
import { Monster } from './Monster';

const DEFAULT_RESPAWN_MS = 12_000;

export class Spawner {
  readonly alive = new Set<Monster>();
  private readonly respawnAt: number[] = [];
  private initialized = false;

  constructor(
    readonly map: MapInstance,
    readonly def: SpawnDef,
    readonly monsterDef: MonsterDef,
    private readonly allocId: () => number,
  ) {}

  get respawnMs(): number {
    return this.def.respawnMs ?? (this.monsterDef.boss ? 300_000 : DEFAULT_RESPAWN_MS);
  }

  /** 몬스터가 죽었을 때 */
  onDeath(m: Monster, now: number): void {
    if (!this.alive.delete(m)) return;
    this.respawnAt.push(now + this.respawnMs);
  }

  tick(now: number): void {
    if (!this.initialized) {
      this.initialized = true;
      for (let i = 0; i < this.def.count; i++) this.spawnOne();
      return;
    }
    for (let i = this.respawnAt.length - 1; i >= 0; i--) {
      if (this.respawnAt[i]! <= now) {
        if (this.spawnOne()) this.respawnAt.splice(i, 1);
        else this.respawnAt[i] = now + 3000; // 자리가 없으면 잠시 후 다시 시도
      }
    }
  }

  /** 즉시 전부 다시 채웁니다 (관리자 명령) */
  refill(): number {
    let n = 0;
    this.respawnAt.length = 0;
    while (this.alive.size < this.def.count && this.spawnOne()) n++;
    return n;
  }

  private spawnOne(): boolean {
    const pos = this.map.randomFreeTile(this.def.area, 4);
    if (!pos) return false;
    const m = new Monster(this.allocId(), this.monsterDef);
    m.x = pos.x;
    m.y = pos.y;
    m.homeX = pos.x;
    m.homeY = pos.y;
    m.dir = Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3;
    m.spawner = this;
    m.nextMoveAt = Date.now() + Math.random() * 3000;
    this.alive.add(m);
    this.map.add(m);
    return true;
  }
}
