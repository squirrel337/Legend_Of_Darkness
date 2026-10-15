// 관리자 기능 모음. 운영자(GM) 채팅 명령어와 웹 관리자 페이지가 모두 이 기능을 사용합니다.
// 접속 중인 캐릭터는 즉시 화면에 반영되고, 접속하지 않은 캐릭터는 저장 파일이 바로 수정됩니다.
import {
  CLASS_IDS,
  EQUIP_SLOTS,
  INVENTORY_SIZE,
  STAT_KEYS,
  formatNumber,
  isClassId,
  isRole,
  isStatKey,
  NAME_REGEX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  type ClassId,
  type Role,
  type StatKey,
} from '../../shared/constants';
import { computeDerived, expToNext, type DerivedStats } from '../../shared/formulas';
import { applyRuntimeSettings, runtimeSettingsOf, saveSettings, type RuntimeSettings } from '../config';
import { hashPassword } from '../auth';
import { log } from '../log';
import type { CharacterData } from '../storage';
import {
  addExpToData,
  addItem,
  addToStorage,
  autoAllocateOnData,
  bestGearFor,
  learnOnData,
  resetStatsOnData,
  setClassOnData,
  setLevelOnData,
  unequipToBag,
} from '../systems/character';
import { cleanseDebuffs, revivePlayer } from '../systems/combat';
import { onLevelUp } from '../systems/progression';
import { Monster } from '../world/Monster';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

export interface AdminResult {
  ok: boolean;
  msg: string;
}

const ok = (msg: string): AdminResult => ({ ok: true, msg });
const fail = (msg: string): AdminResult => ({ ok: false, msg });

export interface CharacterSummary {
  name: string;
  level: number;
  classId: ClassId;
  role: Role;
  online: boolean;
  banned: boolean;
  mapId: string;
  gold: number;
  lastLoginAt: number;
  createdAt: number;
  ghost: boolean;
}

export class AdminService {
  constructor(private readonly world: World) {}

  private get cfg() {
    return this.world.config;
  }

  /**
   * 캐릭터를 찾아 작업을 실행하고, 접속 중이면 화면에 반영하고 아니면 저장합니다.
   */
  private edit(actor: string, action: string, name: string, fn: (d: CharacterData, p: Player | undefined) => AdminResult): AdminResult {
    const p = this.world.findPlayer(name);
    const data = p?.data ?? this.world.store.get(name);
    if (!data) return fail(`'${name}' 캐릭터를 찾을 수 없습니다.`);
    const before = p ? p.data.level : data.level;
    const res = fn(data, p);
    if (!res.ok) return res;
    if (p) {
      p.recompute();
      if (p.data.level > before) onLevelUp(p, p.data.level - before);
      p.markInv();
      p.markAbilities();
      p.markSelf();
      p.broadcastLook();
      this.world.groups.touch(p);
    } else {
      void this.world.store.save(data);
    }
    this.world.audit.write(actor, action, data.name, res.msg);
    return res;
  }

  // ───────────────────────── 성장 ─────────────────────────

  setLevel(actor: string, name: string, level: number): AdminResult {
    if (!Number.isFinite(level)) return fail('레벨 값이 올바르지 않습니다.');
    return this.edit(actor, 'setLevel', name, (d) => {
      setLevelOnData(d, this.cfg, level);
      return ok(`${d.name}의 레벨을 ${d.level}(으)로 설정했습니다. (남은 능력치 포인트 ${d.statPoints})`);
    });
  }

  addLevels(actor: string, name: string, n: number): AdminResult {
    if (!Number.isInteger(n) || n === 0) return fail('올릴 레벨 수가 올바르지 않습니다.');
    const cur = this.world.findPlayer(name)?.data.level ?? this.world.store.get(name)?.level;
    if (cur === undefined) return fail(`'${name}' 캐릭터를 찾을 수 없습니다.`);
    return this.setLevel(actor, name, cur + n);
  }

  addExp(actor: string, name: string, amount: number): AdminResult {
    if (!Number.isFinite(amount) || amount <= 0) return fail('경험치 값이 올바르지 않습니다.');
    return this.edit(actor, 'addExp', name, (d, p) => {
      const lv = addExpToData(d, this.cfg, Math.floor(amount));
      if (p) p.send({ t: 'gain', exp: Math.floor(amount), gold: 0 });
      return ok(`${d.name}에게 경험치 ${formatNumber(amount)}을(를) 주었습니다.${lv > 0 ? ` (레벨 +${lv} → ${d.level})` : ''}`);
    });
  }

  setStat(actor: string, name: string, stat: StatKey | 'all', value: number): AdminResult {
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) return fail('능력치 값은 1 이상의 정수여야 합니다.');
    if (stat !== 'all' && !isStatKey(stat)) return fail('능력치 이름이 올바르지 않습니다. (힘/지능/지혜/건강/민첩/all)');
    return this.edit(actor, 'setStat', name, (d) => {
      const keys = stat === 'all' ? STAT_KEYS : [stat];
      for (const k of keys) d.stats[k] = value;
      return ok(`${d.name}의 ${stat === 'all' ? '모든 능력치' : stat}를 ${value}(으)로 설정했습니다.`);
    });
  }

  maxStats(actor: string, name: string): AdminResult {
    return this.setStat(actor, name, 'all', this.cfg.statCap);
  }

  addStatPoints(actor: string, name: string, n: number): AdminResult {
    if (!Number.isInteger(n) || n === 0) return fail('포인트 값이 올바르지 않습니다.');
    return this.edit(actor, 'addStatPoints', name, (d) => {
      d.statPoints = Math.max(0, d.statPoints + n);
      return ok(`${d.name}의 능력치 포인트: ${d.statPoints}`);
    });
  }

  autoStats(actor: string, name: string): AdminResult {
    return this.edit(actor, 'autoStats', name, (d) => {
      const n = autoAllocateOnData(d, this.world.data, this.cfg);
      return ok(`${d.name}의 능력치 포인트 ${n}개를 직업에 맞게 자동 분배했습니다.`);
    });
  }

  resetStats(actor: string, name: string): AdminResult {
    return this.edit(actor, 'resetStats', name, (d) => {
      const n = resetStatsOnData(d);
      return ok(`${d.name}의 능력치를 초기화했습니다. (포인트 ${n} 반환)`);
    });
  }

  setBonus(actor: string, name: string, hp: number, mp: number): AdminResult {
    if (!Number.isInteger(hp) || !Number.isInteger(mp) || hp < 0 || mp < 0) return fail('보너스 값은 0 이상의 정수여야 합니다.');
    return this.edit(actor, 'setBonus', name, (d) => {
      d.bonusHp = hp;
      d.bonusMp = mp;
      return ok(`${d.name}의 승급 보너스: 체력 +${hp}, 마나 +${mp}`);
    });
  }

  setClass(actor: string, name: string, classId: string): AdminResult {
    if (!isClassId(classId)) return fail(`직업은 ${CLASS_IDS.join('/')} 중 하나여야 합니다.`);
    return this.edit(actor, 'setClass', name, (d) => {
      setClassOnData(d, this.world.data, classId);
      return ok(`${d.name}의 직업을 ${this.world.data.classes.get(classId)!.name}(으)로 바꿨습니다.`);
    });
  }

  /** 현재 직업(+공용)의 모든 기술/마법을 배우게 합니다 */
  learnAll(actor: string, name: string): AdminResult {
    return this.edit(actor, 'learnAll', name, (d) => {
      let n = 0;
      for (const a of this.world.data.abilities.values()) {
        if (a.classId !== d.classId && a.classId !== 'peasant') continue;
        if (learnOnData(d, a)) n++;
      }
      return ok(`${d.name}이(가) 기술/마법 ${n}개를 새로 배웠습니다.`);
    });
  }

  learnAbility(actor: string, name: string, query: string): AdminResult {
    const a = this.world.data.findAbility(query);
    if (!a || a.classId === 'monster') return fail(`'${query}' 기술을 찾을 수 없습니다.`);
    return this.edit(actor, 'learn', name, (d) => {
      if (!learnOnData(d, a)) return fail('이미 배웠거나 더 배울 수 없습니다.');
      return ok(`${d.name}이(가) ${a.name}을(를) 배웠습니다.`);
    });
  }

  forgetAbility(actor: string, name: string, abilityId: string): AdminResult {
    return this.edit(actor, 'forget', name, (d) => {
      const before = d.skills.length + d.spells.length;
      d.skills = d.skills.filter((s) => s !== abilityId);
      d.spells = d.spells.filter((s) => s !== abilityId);
      if (d.skills.length + d.spells.length === before) return fail('배우지 않은 기술입니다.');
      return ok(`${d.name}의 기술 ${abilityId}을(를) 지웠습니다.`);
    });
  }

  /** 직업과 레벨에 맞는 최고 장비를 지급하고 착용시킵니다 */
  giveGear(actor: string, name: string): AdminResult {
    return this.edit(actor, 'giveGear', name, (d) => {
      const gear = bestGearFor(d, this.world.data);
      for (const it of gear) {
        if (d.equipment[it.slot!] === it.id) continue;
        unequipToBag(d, this.world.data, it.slot!);
        d.equipment[it.slot!] = it.id;
      }
      return ok(`${d.name}에게 장비 ${gear.length}개를 지급하고 착용시켰습니다: ${gear.map((g) => g.name).join(', ')}`);
    });
  }

  /** 한 번에 최고 상태로: 만렙 + 능력치 최대 + 모든 기술 + 최고 장비 + 완전 회복 */
  maxOut(actor: string, name: string, classId?: string): AdminResult {
    const p = this.world.findPlayer(name);
    const data = p?.data ?? this.world.store.get(name);
    if (!data) return fail(`'${name}' 캐릭터를 찾을 수 없습니다.`);
    if (classId) {
      const r = this.setClass(actor, name, classId);
      if (!r.ok) return r;
    } else if (data.classId === 'peasant') {
      return fail('평민은 최고 장비가 없습니다. 직업을 함께 지정하세요. 예) /만렙 이름 전사');
    }
    const steps = [
      this.setLevel(actor, name, this.cfg.maxLevel),
      this.setStat(actor, name, 'all', this.cfg.statCap),
      this.edit(actor, 'clearStatPoints', name, (d) => {
        d.statPoints = 0;
        return ok('능력치 포인트 정리');
      }),
      this.learnAll(actor, name),
      this.giveGear(actor, name),
      this.heal(actor, name),
    ];
    const bad = steps.find((s) => !s.ok && !s.msg.includes('부활'));
    if (bad) return bad;
    return ok(`${data.name}을(를) 최고 상태로 만들었습니다! (레벨 ${this.cfg.maxLevel}, 능력치 ${this.cfg.statCap}, 모든 기술, 최고 장비)`);
  }

  // ───────────────────────── 아이템/골드 ─────────────────────────

  giveItem(actor: string, name: string, query: string, qty = 1): AdminResult {
    const def = this.world.data.findItem(query);
    if (!def) return fail(`'${query}' 아이템을 찾을 수 없습니다.`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) return fail('수량은 1~100000 사이여야 합니다.');
    return this.edit(actor, 'giveItem', name, (d) => {
      let left = addItem(d, def, qty);
      if (left > 0) left = addToStorage(d, def, left);
      const given = qty - left;
      if (given <= 0) return fail('소지품과 창고가 모두 가득 찼습니다.');
      return ok(`${d.name}에게 ${def.name} ${given}개를 주었습니다.${left > 0 ? ` (${left}개는 공간 부족)` : ''}`);
    });
  }

  removeItem(actor: string, name: string, slot: number): AdminResult {
    if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SIZE) return fail('슬롯 번호가 올바르지 않습니다.');
    return this.edit(actor, 'removeItem', name, (d) => {
      const s = d.inventory[slot];
      if (!s) return fail('빈 슬롯입니다.');
      d.inventory[slot] = null;
      return ok(`${d.name}의 소지품에서 ${this.world.data.items.get(s.item)?.name ?? s.item} ${s.qty}개를 제거했습니다.`);
    });
  }

  clearInventory(actor: string, name: string): AdminResult {
    return this.edit(actor, 'clearInventory', name, (d) => {
      for (let i = 0; i < INVENTORY_SIZE; i++) d.inventory[i] = null;
      return ok(`${d.name}의 소지품을 비웠습니다.`);
    });
  }

  unequipAll(actor: string, name: string): AdminResult {
    return this.edit(actor, 'unequipAll', name, (d) => {
      for (const s of EQUIP_SLOTS) unequipToBag(d, this.world.data, s);
      return ok(`${d.name}의 장비를 모두 벗겼습니다.`);
    });
  }

  addGold(actor: string, name: string, amount: number): AdminResult {
    if (!Number.isInteger(amount)) return fail('골드 값이 올바르지 않습니다.');
    return this.edit(actor, 'addGold', name, (d, p) => {
      d.gold = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, d.gold + amount));
      if (p && amount > 0) p.send({ t: 'gain', exp: 0, gold: amount });
      return ok(`${d.name}의 골드: ${formatNumber(d.gold)}`);
    });
  }

  setGold(actor: string, name: string, amount: number): AdminResult {
    if (!Number.isInteger(amount) || amount < 0) return fail('골드 값이 올바르지 않습니다.');
    return this.edit(actor, 'setGold', name, (d) => {
      d.gold = Math.min(Number.MAX_SAFE_INTEGER, amount);
      return ok(`${d.name}의 골드를 ${formatNumber(d.gold)}(으)로 설정했습니다.`);
    });
  }

  // ───────────────────────── 상태/이동 ─────────────────────────

  heal(actor: string, name: string): AdminResult {
    return this.edit(actor, 'heal', name, (d, p) => {
      if (p) {
        if (p.isDead) revivePlayer(p, 1);
        p.recompute(false);
        p.hp = p.maxHp;
        p.mp = p.maxMp;
        cleanseDebuffs(p);
        p.map?.broadcast({ t: 'fx', fx: 'heal', id: p.id });
      } else {
        const der = this.derivedOf(d);
        d.ghost = false;
        d.hp = der.maxHp;
        d.mp = der.maxMp;
      }
      return ok(`${d.name}을(를) 완전히 회복시켰습니다.`);
    });
  }

  revive(actor: string, name: string): AdminResult {
    return this.edit(actor, 'revive', name, (d, p) => {
      if (p) {
        if (!revivePlayer(p, 1)) return fail(`${d.name}은(는) 유령 상태가 아닙니다.`);
      } else {
        if (!d.ghost) return fail(`${d.name}은(는) 유령 상태가 아닙니다.`);
        d.ghost = false;
        d.hp = 1;
      }
      return ok(`${d.name}을(를) 부활시켰습니다.`);
    });
  }

  setGod(actor: string, name: string, on: boolean | null): AdminResult {
    return this.edit(actor, 'setGod', name, (d, p) => {
      d.godMode = on === null ? !d.godMode : on;
      if (p && d.godMode) for (const m of p.map?.monsters ?? []) if (m.target === p) m.target = null;
      return ok(`${d.name}의 무적 모드: ${d.godMode ? '켜짐' : '꺼짐'}`);
    });
  }

  teleport(actor: string, name: string, mapQuery: string, x?: number, y?: number): AdminResult {
    const mapDef = this.world.data.findMap(mapQuery);
    if (!mapDef) return fail(`'${mapQuery}' 맵을 찾을 수 없습니다. (${[...this.world.data.maps.values()].map((m) => m.id).join(', ')})`);
    const map = this.world.maps.get(mapDef.id)!;
    const tx = x ?? mapDef.spawn.x;
    const ty = y ?? mapDef.spawn.y;
    if (!map.inBounds(tx, ty)) return fail('좌표가 맵 밖입니다.');
    const p = this.world.findPlayer(name);
    if (p) {
      this.world.transfer(p, map, tx, ty);
      p.map?.broadcast({ t: 'fx', fx: 'teleport', id: p.id });
      this.world.audit.write(actor, 'teleport', p.name, `${map.id} ${tx},${ty}`);
      return ok(`${p.name}을(를) ${mapDef.name}(${p.x}, ${p.y})(으)로 이동시켰습니다.`);
    }
    return this.edit(actor, 'teleport', name, (d) => {
      d.mapId = map.id;
      d.x = tx;
      d.y = ty;
      return ok(`${d.name}의 위치를 ${mapDef.name}(${tx}, ${ty})(으)로 바꿨습니다.`);
    });
  }

  // ───────────────────────── 계정 관리 ─────────────────────────

  setRole(actor: string, name: string, role: string): AdminResult {
    if (!isRole(role)) return fail('권한은 player/gm/admin 중 하나여야 합니다.');
    return this.edit(actor, 'setRole', name, (d) => {
      d.role = role;
      return ok(`${d.name}의 권한을 ${role}(으)로 바꿨습니다.`);
    });
  }

  ban(actor: string, name: string, reason: string): AdminResult {
    const res = this.edit(actor, 'ban', name, (d) => {
      d.banned = true;
      d.banReason = reason.slice(0, 200);
      return ok(`${d.name}을(를) 접속 금지했습니다.${reason ? ` (사유: ${reason})` : ''}`);
    });
    const p = this.world.findPlayer(name);
    if (res.ok && p) this.world.kick(p, `접속이 금지되었습니다. ${reason}`);
    return res;
  }

  unban(actor: string, name: string): AdminResult {
    return this.edit(actor, 'unban', name, (d) => {
      d.banned = false;
      d.banReason = '';
      return ok(`${d.name}의 접속 금지를 풀었습니다.`);
    });
  }

  kick(actor: string, name: string, reason = '운영자에 의해 접속이 종료되었습니다.'): AdminResult {
    const p = this.world.findPlayer(name);
    if (!p) return fail(`${name}님은 접속 중이 아닙니다.`);
    this.world.kick(p, reason);
    this.world.audit.write(actor, 'kick', p.name, reason);
    return ok(`${p.name}님을 접속 종료시켰습니다.`);
  }

  async setPassword(actor: string, name: string, password: string): Promise<AdminResult> {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return fail(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.`);
    const data = this.world.findPlayer(name)?.data ?? this.world.store.get(name);
    if (!data) return fail(`'${name}' 캐릭터를 찾을 수 없습니다.`);
    data.passwordHash = await hashPassword(password);
    void this.world.store.save(data);
    this.world.audit.write(actor, 'setPassword', data.name);
    return ok(`${data.name}의 비밀번호를 바꿨습니다.`);
  }

  async deleteCharacter(actor: string, name: string): Promise<AdminResult> {
    const p = this.world.findPlayer(name);
    if (p) this.world.kick(p, '캐릭터가 삭제되었습니다.');
    const okDel = await this.world.store.delete(name);
    if (!okDel) return fail(`'${name}' 캐릭터를 찾을 수 없습니다.`);
    this.world.audit.write(actor, 'delete', name);
    return ok(`${name} 캐릭터를 삭제했습니다.`);
  }

  // ───────────────────────── 서버 ─────────────────────────

  announce(actor: string, text: string): AdminResult {
    const t = text.trim().slice(0, 300);
    if (!t) return fail('공지 내용을 입력하세요.');
    this.world.announce(`[공지] ${t}`);
    this.world.broadcastAll({ t: 'notice', text: t, kind: 'info' });
    this.world.audit.write(actor, 'announce', undefined, t);
    return ok('공지를 보냈습니다.');
  }

  settings(): RuntimeSettings {
    return runtimeSettingsOf(this.cfg);
  }

  updateSettings(actor: string, patch: Record<string, unknown>): AdminResult {
    const err = applyRuntimeSettings(this.cfg, patch);
    if (err) return fail(err);
    try {
      saveSettings(this.cfg);
    } catch (e) {
      log.error('설정 저장 실패:', (e as Error).message);
    }
    this.world.audit.write(actor, 'settings', undefined, JSON.stringify(patch));
    const s = this.cfg;
    this.world.announce(`[서버] 경험치 x${s.expRate} / 골드 x${s.goldRate} / 드롭 x${s.dropRate}`);
    return ok('설정을 저장했습니다.');
  }

  spawnMonster(actor: Player, query: string, count: number): AdminResult {
    const def = this.world.data.findMonster(query);
    if (!def) return fail(`'${query}' 몬스터를 찾을 수 없습니다.`);
    const map = actor.map;
    if (!map) return fail('맵에 있지 않습니다.');
    if (map.safe) return fail('안전 지대(마을)에는 몬스터를 소환할 수 없습니다.');
    const n = Math.max(1, Math.min(50, Math.floor(count)));
    let made = 0;
    for (let i = 0; i < n; i++) {
      const spot = map.findFreeNear(actor.x, actor.y, 6);
      if (!spot) break;
      const m = new Monster(this.world.allocId(), def);
      m.x = spot.x;
      m.y = spot.y;
      m.homeX = spot.x;
      m.homeY = spot.y;
      map.add(m);
      made++;
    }
    this.world.audit.write(actor.name, 'spawn', undefined, `${def.id} x${made} @${map.id}`);
    return ok(`${def.name} ${made}마리를 소환했습니다.`);
  }

  killAll(actor: Player): AdminResult {
    const map = actor.map;
    if (!map) return fail('맵에 있지 않습니다.');
    let n = 0;
    for (const m of [...map.monsters]) {
      if (m.def.passive) continue;
      m.dead = true;
      map.remove(m, 'death');
      m.spawner?.onDeath(m, Date.now());
      n++;
    }
    this.world.audit.write(actor.name, 'killAll', undefined, map.id);
    return ok(`몬스터 ${n}마리를 제거했습니다.`);
  }

  saveAll(actor: string): AdminResult {
    this.world.saveAll();
    this.world.audit.write(actor, 'saveAll');
    return ok(`접속 중인 캐릭터 ${this.world.players.size}명을 저장했습니다.`);
  }

  // ───────────────────────── 조회 ─────────────────────────

  /** 접속하지 않은 캐릭터의 최종 능력치 계산 */
  derivedOf(d: CharacterData): DerivedStats {
    const equipment = EQUIP_SLOTS.map((s) => (d.equipment[s] ? this.world.data.items.get(d.equipment[s]!) : undefined)).filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
    return computeDerived({
      cls: this.world.data.classes.get(d.classId)!,
      level: d.level,
      stats: d.stats,
      bonusHp: d.bonusHp,
      bonusMp: d.bonusMp,
      equipment,
    });
  }

  status() {
    const mem = process.memoryUsage();
    return {
      serverName: this.cfg.serverName,
      uptimeSec: Math.floor((Date.now() - this.world.startedAt) / 1000),
      online: this.world.players.size,
      characters: this.world.store.size,
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      maps: [...this.world.maps.values()].map((m) => ({
        id: m.id,
        name: m.def.name,
        players: m.players.size,
        monsters: m.monsters.size,
      })),
      settings: this.settings(),
      maxLevel: this.cfg.maxLevel,
      statCap: this.cfg.statCap,
    };
  }

  summary(d: CharacterData): CharacterSummary {
    const p = this.world.findPlayer(d.name);
    return {
      name: d.name,
      level: d.level,
      classId: d.classId,
      role: d.role,
      online: !!p,
      banned: d.banned,
      mapId: p?.map?.id ?? d.mapId,
      gold: d.gold,
      lastLoginAt: d.lastLoginAt,
      createdAt: d.createdAt,
      ghost: d.ghost,
    };
  }

  listCharacters(query = ''): CharacterSummary[] {
    const q = query.trim().toLowerCase();
    return this.world.store
      .all()
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .map((d) => this.summary(d))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.level - a.level || a.name.localeCompare(b.name));
  }

  characterDetail(name: string) {
    const p = this.world.findPlayer(name);
    if (p) p.syncData();
    const d = p?.data ?? this.world.store.get(name);
    if (!d) return null;
    const { passwordHash: _ph, ...rest } = d;
    void _ph;
    return {
      ...rest,
      online: !!p,
      expNext: d.level >= this.cfg.maxLevel ? 0 : expToNext(d.level),
      derived: p ? p.derived : this.derivedOf(d),
    };
  }
}

/** 새 캐릭터 이름 검사 */
export function validateName(name: string): string | null {
  if (!NAME_REGEX.test(name)) return '이름은 한글/영문으로 시작하는 2~12자(한글·영문·숫자)여야 합니다.';
  return null;
}
