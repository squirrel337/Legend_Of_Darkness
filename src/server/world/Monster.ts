// 몬스터
import type { Element } from '../../shared/constants';
import { monsterStats, type MonsterStats } from '../../shared/formulas';
import type { MonsterDef } from '../../shared/types';
import type { MonsterSnapshot } from '../../shared/protocol';
import { Creature } from './entities';
import type { Player } from './Player';
import type { Spawner } from './Spawner';

export class Monster extends Creature {
  readonly kind = 'monster' as const;
  readonly stats: MonsterStats;
  hp: number;
  mp = 0;
  homeX = 0;
  homeY = 0;
  target: Player | null = null;
  nextMoveAt = 0;
  nextAttackAt = 0;
  nextSpellAt = 0;
  lastDamagedAt = 0;
  /** 추격을 시작한 시각 (너무 오래 쫓으면 포기) */
  chaseSince = 0;
  readonly spellCooldowns = new Map<string, number>();
  /** 플레이어 이름 → 준 피해 (경험치/전리품 판정용) */
  readonly damageBy = new Map<string, number>();
  dead = false;
  /** GM이 소환한 몬스터는 생성기 없이 존재 */
  spawner: Spawner | null = null;

  constructor(
    id: number,
    readonly def: MonsterDef,
  ) {
    super(id);
    this.stats = monsterStats(def);
    this.hp = this.stats.hp;
  }

  get name(): string {
    return this.def.name;
  }
  get level(): number {
    return this.def.level;
  }
  get maxHp(): number {
    return this.stats.hp;
  }
  get maxMp(): number {
    return 0;
  }
  get ac(): number {
    return this.stats.ac + this.statusPotency('curse') - this.statusPotency('armor');
  }
  get dex(): number {
    return this.stats.dex;
  }
  get defenseElement(): Element {
    return this.def.element ?? 'none';
  }
  get offenseElement(): Element {
    return this.def.atkElement ?? 'none';
  }
  get isDead(): boolean {
    return this.dead;
  }
  get blocks(): boolean {
    return !this.dead;
  }

  snapshot(): MonsterSnapshot {
    return {
      type: 'monster',
      id: this.id,
      x: this.x,
      y: this.y,
      dir: this.dir,
      name: this.def.name,
      def: this.def.id,
      level: this.def.level,
      hpPct: this.hpPct,
      statuses: this.visibleStatuses(),
    };
  }

  addDamage(player: Player, amount: number): void {
    this.damageBy.set(player.name, (this.damageBy.get(player.name) ?? 0) + amount);
  }
}
