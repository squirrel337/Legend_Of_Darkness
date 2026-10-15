// 바닥에 떨어진 아이템/골드
import type { GroundItemSnapshot } from '../../shared/protocol';
import { Entity } from './entities';

export class GroundItem extends Entity {
  readonly kind = 'item' as const;

  constructor(
    id: number,
    /** null 이면 골드 */
    readonly itemId: string | null,
    public qty: number,
    readonly displayName: string,
    /** 이 플레이어만 줍을 수 있는 기간 */
    readonly owner: string | null,
    readonly ownerUntil: number,
    readonly expiresAt: number,
  ) {
    super(id);
  }

  get name(): string {
    return this.displayName;
  }

  get blocks(): boolean {
    return false;
  }

  snapshot(): GroundItemSnapshot {
    return {
      type: 'item',
      id: this.id,
      x: this.x,
      y: this.y,
      dir: this.dir,
      name: this.displayName,
      item: this.itemId,
      qty: this.qty,
    };
  }
}
