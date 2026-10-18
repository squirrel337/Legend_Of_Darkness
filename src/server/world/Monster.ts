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
  /** 노리는 대상. 야생 몬스터는 플레이어나 소환수, 소환수는 야생 몬스터 */
  target: Creature | null = null;
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
  /** 소환수면 주인 (플레이어 편에서 싸움) */
  owner: Player | null = null;
  /** 소환수가 사라지는 시각 (0 이면 없음) */
  expireAt = 0;
  private readonly lvl: number;

  /** level 을 주면 그 레벨에 맞춰 능력치를 계산합니다 (소환수) */
  constructor(
    id: number,
    readonly def: MonsterDef,
    level?: number,
  ) {
    super(id);
    this.lvl = level ?? def.level;
    this.stats = monsterStats(level !== undefined ? { ...def, level } : def);
    this.hp = this.stats.hp;
  }

  get name(): string {
    return this.def.name;
  }
  get level(): number {
    return this.lvl;
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
  /** 플레이어가 부른 소환수인지 */
  get isSummon(): boolean {
    return this.owner !== null;
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
      level: this.lvl,
      hpPct: this.hpPct,
      statuses: this.visibleStatuses(),
      ...(this.owner ? { ownerId: this.owner.id, ownerName: this.owner.name } : {}),
    };
  }

  addDamage(player: Player, amount: number): void {
    this.damageBy.set(player.name, (this.damageBy.get(player.name) ?? 0) + amount);
  }
}
