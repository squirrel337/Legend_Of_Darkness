// 게임 월드: 모든 맵과 플레이어, 주기적인 처리(틱), 접속/이동/저장
import type { S2C } from '../../shared/protocol';
import { AdminService } from '../admin/AdminService';
import { regenAmounts } from '../../shared/formulas';
import type { PublicServerInfo } from '../../shared/types';
import type { ServerConfig } from '../config';
import type { GameData } from '../gamedata';
import { log } from '../log';
import { nameKey, type AuditLog, type CharacterData, type CharacterStore } from '../storage';
import { monsterRegen, monsterTick } from '../systems/ai';
import { tickStatuses } from '../systems/combat';
import { GroupManager } from '../systems/groups';
import { MapInstance } from './MapInstance';
import { Npc } from './Npc';
import { Player, type PlayerLink } from './Player';
import { Spawner } from './Spawner';

export const TICK_MS = 100;

export class World {
  readonly maps = new Map<string, MapInstance>();
  readonly players = new Map<string, Player>();
  readonly groups: GroupManager;
  readonly admin: AdminService;
  readonly startedAt = Date.now();
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  private lastSecond = 0;
  private lastRegen = 0;
  private lastSave = Date.now();

  constructor(
    readonly config: ServerConfig,
    readonly data: GameData,
    readonly store: CharacterStore,
    readonly audit: AuditLog,
  ) {
    this.groups = new GroupManager(this);
    this.admin = new AdminService(this);
    for (const def of data.maps.values()) {
      const map = new MapInstance(def);
      for (const n of def.npcs) {
        const npcDef = data.npcs.get(n.npc)!;
        const npc = new Npc(this.allocId(), npcDef);
        npc.x = n.x;
        npc.y = n.y;
        npc.dir = n.dir ?? 2;
        map.add(npc);
      }
      for (const s of def.spawns) map.spawners.push(new Spawner(map, s, data.monsters.get(s.monster)!, () => this.allocId()));
      this.maps.set(def.id, map);
    }
  }

  allocId(): number {
    return this.nextId++;
  }

  get town(): MapInstance {
    return this.maps.get('town')!;
  }

  start(): void {
    this.tick(Date.now());
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (e) {
        log.error('틱 처리 중 오류:', e);
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(now: number): void {
    const second = now - this.lastSecond >= 1000;
    if (second) this.lastSecond = now;
    const regen = now - this.lastRegen >= 2000;
    if (regen) this.lastRegen = now;

    for (const map of this.maps.values()) {
      for (const sp of map.spawners) sp.tick(now);
      const active = map.players.size > 0;
      for (const m of map.monsters) {
        if (active) monsterTick(this, m, now);
        else if (m.target) m.target = null;
        tickStatuses(m, now);
        if (second) monsterRegen(m, now);
      }
      for (const it of map.items) if (it.expiresAt <= now) map.remove(it);
    }
    for (const p of this.players.values()) {
      tickStatuses(p, now);
      if (regen && !p.isDead && p.map) {
        const r = regenAmounts(p.derived, p.map.safe, now - p.lastCombatAt < 6000);
        const hp = Math.min(p.maxHp - p.hp, r.hp);
        const mp = Math.min(p.maxMp - p.mp, r.mp);
        if (hp > 0) p.hp += hp;
        if (mp > 0) p.mp += mp;
        if (hp > 0 || mp > 0) p.markVitals();
      }
    }
    if (second) this.groups.sync();
    if (now - this.lastSave >= this.config.autosaveSeconds * 1000) {
      this.lastSave = now;
      this.saveAll();
    }
  }

  publicInfo(): PublicServerInfo {
    const c = this.config;
    return {
      name: c.serverName,
      motd: c.motd,
      expRate: c.expRate,
      goldRate: c.goldRate,
      dropRate: c.dropRate,
      maxLevel: c.maxLevel,
      statCap: c.statCap,
      classLevel: c.classLevel,
      registration: c.registration,
    };
  }

  findPlayer(name: string): Player | undefined {
    return this.players.get(nameKey(name));
  }

  /** 캐릭터가 게임에 들어옵니다 */
  enterGame(link: PlayerLink, data: CharacterData): Player {
    if (this.config.adminCharacters.includes(nameKey(data.name)) && data.role !== 'admin') {
      data.role = 'admin';
      log.info(`${data.name} 에게 ADMIN_CHARACTERS 설정에 따라 관리자 권한을 부여했습니다.`);
    }
    data.lastLoginAt = Date.now();
    data.lastIp = link.ip;
    const p = new Player(this.allocId(), this, data, link);
    this.players.set(nameKey(data.name), p);
    p.send({ t: 'welcome', selfId: p.id, data: this.data.clientData(this.publicInfo()) });
    let map = this.maps.get(data.mapId) ?? this.town;
    let spot = map.isWalkable(data.x, data.y) ? map.findFreeNear(data.x, data.y) : null;
    if (!spot) spot = map.findFreeNear(map.def.spawn.x, map.def.spawn.y);
    if (!spot) {
      map = this.town;
      spot = map.findFreeNear(map.def.spawn.x, map.def.spawn.y) ?? { ...map.def.spawn };
    }
    this.placePlayer(p, map, spot.x, spot.y, data.dir);
    p.markInv();
    p.markAbilities();
    p.markSelf();
    if (this.config.motd) p.send({ t: 'chat', ch: 'notice', text: this.config.motd });
    if (p.isDead) p.sys('유령 상태입니다. 신전의 사제에게 가면 부활할 수 있습니다. (R 키: 마을로 돌아가기)');
    if (p.data.statPoints > 0) p.sys(`분배하지 않은 능력치 포인트가 ${p.data.statPoints} 있습니다. (G 키)`);
    if (p.isGm) p.sys('운영자 권한이 있습니다. /도움말 로 명령어를 볼 수 있고, F2 키로 운영자 도구를 열 수 있습니다.');
    log.info(`접속: ${data.name} (${link.ip}) — 현재 ${this.players.size}명`);
    return p;
  }

  /** 캐릭터가 게임에서 나갑니다 (저장 포함) */
  leaveGame(p: Player): void {
    if (this.players.get(nameKey(p.name)) !== p) return;
    this.groups.onLogout(p);
    p.syncData();
    p.data.playTimeSec += Math.floor((Date.now() - p.loginAt) / 1000);
    p.map?.remove(p);
    this.players.delete(nameKey(p.name));
    void this.store.save(p.data);
    log.info(`접속 종료: ${p.name} — 현재 ${this.players.size}명`);
  }

  /** 맵에 플레이어를 놓습니다 (맵 이동 포함) */
  placePlayer(p: Player, map: MapInstance, x: number, y: number, dir?: number): void {
    if (p.map) p.map.remove(p, 'warp');
    p.x = x;
    p.y = y;
    if (dir === 0 || dir === 1 || dir === 2 || dir === 3) p.dir = dir;
    p.talkingTo = null;
    p.send({ t: 'map', map: map.view, entities: map.snapshotFor(p), x, y, dir: p.dir });
    map.add(p);
    p.data.mapId = map.id;
    p.markSelf();
    this.groups.touch(p);
  }

  /** 다른 맵(또는 같은 맵의 다른 위치)으로 이동시킵니다 */
  transfer(p: Player, map: MapInstance, x: number, y: number): void {
    const spot = map.findFreeNear(x, y) ?? map.findFreeNear(map.def.spawn.x, map.def.spawn.y) ?? { x, y };
    if (p.map === map) {
      map.move(p, spot.x, spot.y);
      map.broadcast({ t: 'jump', id: p.id, x: spot.x, y: spot.y, dir: p.dir });
      p.send({ t: 'pos', x: spot.x, y: spot.y, dir: p.dir });
      return;
    }
    this.placePlayer(p, map, spot.x, spot.y);
  }

  broadcastAll(msg: S2C): void {
    for (const p of this.players.values()) p.send(msg);
  }

  announce(text: string): void {
    this.broadcastAll({ t: 'chat', ch: 'notice', text });
  }

  /** 접속 중인 모든 캐릭터를 저장합니다 */
  saveAll(sync = false): void {
    for (const p of this.players.values()) {
      p.syncData();
      if (sync) this.store.saveSync(p.data);
      else void this.store.save(p.data);
      p.saveDirty = false;
    }
  }

  kick(p: Player, reason: string): void {
    p.send({ t: 'kick', reason });
    p.link.close(reason);
    this.leaveGame(p);
  }
}
