// 맵 위에 존재하는 모든 것(플레이어, 몬스터, NPC, 바닥 아이템)의 공통 기반
import type { Dir, Element, StatusId } from '../../shared/constants';
import type { EntitySnapshot } from '../../shared/protocol';
import type { MapInstance } from './MapInstance';

export type EntityKind = 'player' | 'monster' | 'npc' | 'item';

export abstract class Entity {
  abstract readonly kind: EntityKind;
  map: MapInstance | null = null;
  x = 0;
  y = 0;
  dir: Dir = 2;

  constructor(readonly id: number) {}

  abstract get name(): string;
  abstract snapshot(): EntitySnapshot;
  /** 다른 생물이 이 칸을 지나갈 수 없게 막는지 */
  abstract get blocks(): boolean;
}

export interface ActiveStatus {
  id: StatusId;
  until: number;
  potency: number;
  /** 지속 피해/회복을 건 쪽 (중독 시전자의 레벨 계산 등) */
  sourceLevel: number;
  sourceId: number;
  nextTickAt: number;
}

/** 체력/마나/상태 효과를 가진 존재 (플레이어, 몬스터) */
export abstract class Creature extends Entity {
  abstract hp: number;
  abstract mp: number;
  readonly statuses = new Map<StatusId, ActiveStatus>();
  lastCombatAt = 0;

  abstract get maxHp(): number;
  abstract get maxMp(): number;
  abstract get level(): number;
  /** 최종 AC (상태 효과 포함) */
  abstract get ac(): number;
  abstract get dex(): number;
  abstract get defenseElement(): Element;
  abstract get offenseElement(): Element;
  abstract get isDead(): boolean;

  hasStatus(id: StatusId): boolean {
    return this.statuses.has(id);
  }

  statusPotency(id: StatusId): number {
    return this.statuses.get(id)?.potency ?? 0;
  }

  /** 잠들거나 마비되면 행동할 수 없습니다 */
  get canAct(): boolean {
    return !this.isDead && !this.statuses.has('sleep') && !this.statuses.has('paralyze');
  }

  get hpPct(): number {
    return this.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((this.hp / this.maxHp) * 100))) : 0;
  }

  visibleStatuses(): StatusId[] {
    return [...this.statuses.keys()];
  }
}
