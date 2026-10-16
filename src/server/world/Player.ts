// 접속 중인 플레이어
import {
  EQUIP_SLOTS,
  HAIR_COLORS,
  WALK_MS,
  type Element,
  type StatusId,
} from '../../shared/constants';
import { computeDerived, expToNext, type DerivedStats } from '../../shared/formulas';
import type { ClassDef, HumanLook, ItemDef } from '../../shared/types';
import type { PlayerSnapshot, S2C, SelfState } from '../../shared/protocol';
import { TokenBucket } from '../auth';
import type { CharacterData } from '../storage';
import { Creature } from './entities';
import type { World } from './World';
import type { Npc } from './Npc';
import type { Group } from '../systems/groups';

/** 플레이어와 연결된 네트워크 세션 */
export interface PlayerLink {
  readonly ip: string;
  send(msg: S2C): void;
  close(reason: string): void;
  /** 바뀐 상태를 곧 보내도록 예약 */
  touch(): void;
}

export class Player extends Creature {
  readonly kind = 'player' as const;
  derived!: DerivedStats;
  cls!: ClassDef;

  nextAssailAt = 0;
  gcdUntil = 0;
  nextItemAt = 0;
  readonly cooldowns = new Map<string, number>();
  /** 걷기 속도 제한: 순간적으로 몰려 들어오는 입력은 조금 허용하고 평균 속도를 제한 */
  readonly moveBucket: TokenBucket;
  /** 초당 메시지 수 제한 */
  readonly msgBucket = new TokenBucket(60, 30);
  group: Group | null = null;
  pendingInviteFrom: string | null = null;
  pendingInviteAt = 0;
  lastWhisperFrom: string | null = null;
  talkingTo: Npc | null = null;
  readonly loginAt = Date.now();
  saveDirty = false;

  private dirtySelf = false;
  private dirtyInv = false;
  private dirtyAbilities = false;
  private dirtyVitals = false;

  constructor(
    id: number,
    readonly world: World,
    readonly data: CharacterData,
    public link: PlayerLink,
  ) {
    super(id);
    this.x = data.x;
    this.y = data.y;
    this.dir = data.dir;
    this.moveBucket = new TokenBucket(3, 1000 / (WALK_MS * 0.8));
    // 저장된 재사용 대기와 상태 효과를 되살립니다 (다시 접속해서 초기화하지 못하게)
    const now = Date.now();
    for (const [ability, until] of Object.entries(data.cooldowns)) if (until > now) this.cooldowns.set(ability, until);
    if (!data.ghost) {
      for (const st of data.statusSave) {
        if (st.until > now) this.statuses.set(st.id, { ...st, sourceId: id, nextTickAt: now + 1000 });
      }
    }
    this.recompute(false);
  }

  get name(): string {
    return this.data.name;
  }

  get hp(): number {
    return this.data.hp;
  }
  set hp(v: number) {
    this.data.hp = v;
  }
  get mp(): number {
    return this.data.mp;
  }
  set mp(v: number) {
    this.data.mp = v;
  }

  get level(): number {
    return this.data.level;
  }
  get maxHp(): number {
    return this.derived.maxHp;
  }
  get maxMp(): number {
    return this.derived.maxMp;
  }
  get ac(): number {
    return this.derived.ac;
  }
  get dex(): number {
    return this.derived.dex;
  }
  get defenseElement(): Element {
    return this.derived.defense;
  }
  get offenseElement(): Element {
    return this.derived.offense;
  }
  get isDead(): boolean {
    return this.data.ghost;
  }
  get blocks(): boolean {
    return !this.data.ghost;
  }
  get isGm(): boolean {
    return this.data.role === 'gm' || this.data.role === 'admin';
  }
  get isAdmin(): boolean {
    return this.data.role === 'admin';
  }
  get god(): boolean {
    return this.data.godMode;
  }

  equippedDefs(): ItemDef[] {
    const out: ItemDef[] = [];
    for (const s of EQUIP_SLOTS) {
      const id = this.data.equipment[s];
      const def = id ? this.world.data.items.get(id) : undefined;
      if (def) out.push(def);
    }
    return out;
  }

  /** 장비/레벨/능력치가 바뀌면 다시 계산합니다 */
  recompute(notify = true): void {
    this.cls = this.world.data.classes.get(this.data.classId) ?? this.world.data.classes.get('peasant')!;
    const statuses: { id: StatusId; potency: number }[] = [];
    for (const s of this.statuses.values()) statuses.push({ id: s.id, potency: s.potency });
    this.derived = computeDerived({
      cls: this.cls,
      level: this.data.level,
      stats: this.data.stats,
      bonusHp: this.data.bonusHp,
      bonusMp: this.data.bonusMp,
      equipment: this.equippedDefs(),
      statuses,
    });
    if (this.data.hp > this.derived.maxHp) this.data.hp = this.derived.maxHp;
    if (this.data.mp > this.derived.maxMp) this.data.mp = this.derived.maxMp;
    if (!this.data.ghost && this.data.hp <= 0) this.data.hp = 1;
    if (notify) this.markSelf();
  }

  look(): HumanLook {
    const items = this.world.data.items;
    const armor = this.data.equipment.armor ? items.get(this.data.equipment.armor) : undefined;
    const weapon = this.data.equipment.weapon ? items.get(this.data.equipment.weapon) : undefined;
    const helmet = this.data.equipment.helmet ? items.get(this.data.equipment.helmet) : undefined;
    const shield = this.data.equipment.shield ? items.get(this.data.equipment.shield) : undefined;
    const look: HumanLook = {
      gender: this.data.gender,
      hairStyle: this.data.hairStyle,
      hairColor: HAIR_COLORS[this.data.hairColor % HAIR_COLORS.length]!,
      body: armor?.icon.color ?? '#8a7a66',
    };
    if (armor?.icon.color2) look.body2 = armor.icon.color2;
    // 직업 전용 갑옷이면 그 직업의 의상으로 그립니다
    if (armor?.classes?.length) look.outfit = armor.classes[0];
    if (weapon) {
      look.weapon = weapon.icon.shape;
      look.weaponColor = weapon.icon.color;
    }
    if (helmet) look.helmet = helmet.icon.color;
    if (shield) look.shield = shield.icon.color;
    return look;
  }

  snapshot(): PlayerSnapshot {
    return {
      type: 'player',
      id: this.id,
      x: this.x,
      y: this.y,
      dir: this.dir,
      name: this.name,
      look: this.look(),
      classId: this.data.classId,
      level: this.data.level,
      ghost: this.data.ghost,
      role: this.data.role,
      hpPct: this.hpPct,
      statuses: this.visibleStatuses(),
    };
  }

  selfState(): SelfState {
    const d = this.derived;
    const now = Date.now();
    const maxLevel = this.world.config.maxLevel;
    return {
      id: this.id,
      name: this.name,
      classId: this.data.classId,
      level: this.data.level,
      exp: Math.floor(this.data.exp),
      expNext: this.data.level >= maxLevel ? 0 : expToNext(this.data.level),
      hp: this.data.hp,
      mp: this.data.mp,
      maxHp: d.maxHp,
      maxMp: d.maxMp,
      gold: this.data.gold,
      statPoints: this.data.statPoints,
      base: { ...this.data.stats },
      stats: {
        str: d.str,
        int: d.int,
        wis: d.wis,
        con: d.con,
        dex: d.dex,
        ac: d.ac,
        dmgMin: d.dmgMin,
        dmgMax: d.dmgMax,
        dmgBonus: d.dmgBonus,
        hit: d.hit,
        magic: d.magic,
        offense: d.offense,
        defense: d.defense,
      },
      bonusHp: this.data.bonusHp,
      bonusMp: this.data.bonusMp,
      role: this.data.role,
      ghost: this.data.ghost,
      god: this.data.godMode,
      equipment: { ...this.data.equipment },
      statuses: [...this.statuses.values()].map((s) => ({ id: s.id, ms: Math.max(0, s.until - now) })),
      mapId: this.map?.id ?? this.data.mapId,
      kills: this.data.kills,
      deaths: this.data.deaths,
    };
  }

  send(msg: S2C): void {
    this.link.send(msg);
  }

  sys(text: string): void {
    this.send({ t: 'chat', ch: 'system', text });
  }

  err(text: string): void {
    this.send({ t: 'chat', ch: 'error', text });
  }

  notice(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    this.send({ t: 'notice', text, kind });
  }

  markSelf(): void {
    this.dirtySelf = true;
    this.saveDirty = true;
    this.link.touch();
  }
  markInv(): void {
    this.dirtyInv = true;
    this.saveDirty = true;
    this.link.touch();
  }
  markAbilities(): void {
    this.dirtyAbilities = true;
    this.saveDirty = true;
    this.link.touch();
  }
  markVitals(): void {
    this.dirtyVitals = true;
    this.link.touch();
  }

  /** 바뀐 상태를 클라이언트로 보냅니다 (세션이 메시지를 내보내기 직전에 호출) */
  flushDirty(): void {
    if (this.dirtySelf) {
      this.link.send({ t: 'self', s: this.selfState() });
      this.dirtySelf = false;
      this.dirtyVitals = false;
    } else if (this.dirtyVitals) {
      this.link.send({ t: 'vitals', hp: this.data.hp, mp: this.data.mp, maxHp: this.derived.maxHp, maxMp: this.derived.maxMp });
      this.dirtyVitals = false;
    }
    if (this.dirtyInv) {
      this.link.send({ t: 'inv', slots: this.data.inventory, gold: this.data.gold });
      this.dirtyInv = false;
    }
    if (this.dirtyAbilities) {
      this.link.send({ t: 'abilities', skills: this.data.skills, spells: this.data.spells });
      this.dirtyAbilities = false;
    }
  }

  /** 저장 직전에 위치 등을 캐릭터 데이터에 반영합니다 */
  syncData(): CharacterData {
    if (this.map) {
      this.data.mapId = this.map.id;
      this.data.x = this.x;
      this.data.y = this.y;
      this.data.dir = this.dir;
    }
    const now = Date.now();
    const cds: Record<string, number> = {};
    for (const [ability, until] of this.cooldowns) if (until > now) cds[ability] = until;
    this.data.cooldowns = cds;
    this.data.statusSave = [...this.statuses.values()]
      .filter((st) => st.until > now)
      .map((st) => ({ id: st.id, until: st.until, potency: st.potency, sourceLevel: st.sourceLevel }));
    return this.data;
  }

  /** 다른 플레이어에게 보이는 겉모습이 바뀌었음을 알립니다 */
  broadcastLook(): void {
    this.map?.broadcast({
      t: 'look',
      id: this.id,
      look: this.look(),
      ghost: this.data.ghost,
      level: this.data.level,
      classId: this.data.classId,
      role: this.data.role,
    });
  }
}
