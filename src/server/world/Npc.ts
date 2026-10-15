// NPC (상인, 길드장 등)
import type { NpcDef } from '../../shared/types';
import type { NpcSnapshot } from '../../shared/protocol';
import { Entity } from './entities';

export class Npc extends Entity {
  readonly kind = 'npc' as const;

  constructor(
    id: number,
    readonly def: NpcDef,
  ) {
    super(id);
  }

  get name(): string {
    return this.def.name;
  }

  get blocks(): boolean {
    return true;
  }

  snapshot(): NpcSnapshot {
    const s: NpcSnapshot = {
      type: 'npc',
      id: this.id,
      x: this.x,
      y: this.y,
      dir: this.dir,
      name: this.def.name,
      def: this.def.id,
      look: this.def.look,
    };
    if (this.def.title) s.title = this.def.title;
    return s;
  }
}
