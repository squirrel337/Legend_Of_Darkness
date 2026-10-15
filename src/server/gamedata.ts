// gamedata/*.json 을 읽고 검증합니다. 잘못된 데이터가 있으면 어디가 문제인지 알려 주고 서버를 시작하지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASS_IDS,
  ELEMENTS,
  EQUIP_SLOTS,
  isClassId,
  isStatKey,
  isStatusId,
  type ClassId,
} from '../shared/constants';
import { isKnownTile, tileInfo } from '../shared/tiles';
import type {
  AbilityDef,
  ClassDef,
  ItemDef,
  MapDef,
  MonsterDef,
  NpcDef,
  PublicServerInfo,
} from '../shared/types';
import type { ClientGameData } from '../shared/protocol';

export class GameDataError extends Error {}

function fail(where: string, msg: string): never {
  throw new GameDataError(`[게임 데이터 오류] ${where}: ${msg}`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(path.basename(file), `JSON을 읽을 수 없습니다 — ${(e as Error).message}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isElement = (v: unknown) => typeof v === 'string' && (ELEMENTS as readonly string[]).includes(v);

const TARGETINGS = ['front', 'around', 'around8', 'self', 'enemy', 'ally', 'enemyArea', 'line'];
const EFFECT_TYPES = ['physical', 'magic', 'heal', 'status', 'cleanse', 'revive', 'restoreMp', 'sacrifice', 'dash'];
const SERVICE_TYPES = ['shop', 'buy', 'class', 'revive', 'heal', 'ascend', 'teleport', 'resetStats', 'storage', 'talk'];
const BODY_PLANS = [
  'rat',
  'bat',
  'spider',
  'wolf',
  'humanoid',
  'skeleton',
  'ghost',
  'slime',
  'golem',
  'beast',
  'dragon',
  'eye',
  'dummy',
  'serpent',
  'plant',
];

export class GameData {
  readonly classes = new Map<ClassId, ClassDef>();
  readonly items = new Map<string, ItemDef>();
  readonly abilities = new Map<string, AbilityDef>();
  readonly monsters = new Map<string, MonsterDef>();
  readonly npcs = new Map<string, NpcDef>();
  readonly maps = new Map<string, MapDef>();
  private clientCache: { key: string; json: ClientGameData } | null = null;

  static load(dir: string): GameData {
    const gd = new GameData();
    const list = (name: string): unknown[] => {
      const v = readJson(path.join(dir, name));
      if (!Array.isArray(v)) fail(name, '최상위가 배열이어야 합니다.');
      return v;
    };
    for (const raw of list('classes.json')) gd.addClass(raw);
    for (const id of CLASS_IDS) if (!gd.classes.has(id)) fail('classes.json', `직업 '${id}' 정의가 없습니다.`);
    for (const raw of list('items.json')) gd.addItem(raw);
    for (const raw of list('abilities.json')) gd.addAbility(raw);
    for (const raw of list('monsters.json')) gd.addMonster(raw);
    for (const raw of list('npcs.json')) gd.addNpc(raw);
    const mapDir = path.join(dir, 'maps');
    if (!fs.existsSync(mapDir)) fail('maps', '맵 폴더가 없습니다.');
    for (const f of fs.readdirSync(mapDir).sort()) {
      if (!f.endsWith('.json')) continue;
      gd.addMap(readJson(path.join(mapDir, f)), f);
    }
    // 마을 → 권장 레벨이 없는 맵 → 권장 레벨 순으로 정렬 (목록 표시용)
    const ordered = [...gd.maps.values()].sort((a, b) => {
      if (a.id === 'town' || b.id === 'town') return a.id === 'town' ? -1 : 1;
      return (a.levelRange?.[0] ?? -1) - (b.levelRange?.[0] ?? -1);
    });
    gd.maps.clear();
    for (const m of ordered) gd.maps.set(m.id, m);
    gd.crossCheck();
    return gd;
  }

  private addClass(raw: unknown): void {
    if (!isObj(raw) || !isClassId(raw.id)) fail('classes.json', `잘못된 직업 항목 ${JSON.stringify(raw).slice(0, 80)}`);
    const c = raw as unknown as ClassDef;
    const where = `classes.json(${c.id})`;
    if (!isStr(c.name)) fail(where, 'name 이 필요합니다.');
    for (const k of ['baseHp', 'baseMp', 'hpPerLevel', 'mpPerLevel', 'hpPerCon', 'mpPerWis'] as const) {
      if (!isNum(c[k]) || c[k] < 0) fail(where, `${k} 는 0 이상의 숫자여야 합니다.`);
    }
    if (!isObj(c.statWeights)) fail(where, 'statWeights 가 필요합니다.');
    for (const k of Object.keys(c.statWeights)) if (!isStatKey(k)) fail(where, `알 수 없는 능력치 ${k}`);
    if (this.classes.has(c.id)) fail(where, '중복된 직업입니다.');
    this.classes.set(c.id, c);
  }

  private addItem(raw: unknown): void {
    if (!isObj(raw) || !isStr(raw.id)) fail('items.json', `id 없는 항목 ${JSON.stringify(raw).slice(0, 80)}`);
    const it = raw as unknown as ItemDef;
    const where = `items.json(${it.id})`;
    if (this.items.has(it.id)) fail(where, '중복된 id 입니다.');
    if (!isStr(it.name)) fail(where, 'name 이 필요합니다.');
    if (!['equip', 'consumable', 'material'].includes(it.type)) fail(where, `type 은 equip/consumable/material 중 하나여야 합니다.`);
    if (it.type === 'equip') {
      if (!it.slot || !(EQUIP_SLOTS as readonly string[]).includes(it.slot)) fail(where, '장비에는 올바른 slot 이 필요합니다.');
      if (it.stack && it.stack !== 1) fail(where, '장비는 겹칠 수 없습니다 (stack=1).');
    }
    if (it.dmg !== undefined && (!Array.isArray(it.dmg) || it.dmg.length !== 2 || !it.dmg.every(isNum) || it.dmg[0] > it.dmg[1]))
      fail(where, 'dmg 는 [최소, 최대] 형식이어야 합니다.');
    if (!isNum(it.price) || it.price < 0) fail(where, 'price 는 0 이상이어야 합니다.');
    if (it.stack !== undefined && (!Number.isInteger(it.stack) || it.stack < 1)) fail(where, 'stack 은 1 이상의 정수여야 합니다.');
    if (it.classes) for (const c of it.classes) if (!isClassId(c)) fail(where, `알 수 없는 직업 ${c}`);
    if (it.offense !== undefined && !isElement(it.offense)) fail(where, 'offense 속성이 올바르지 않습니다.');
    if (it.defense !== undefined && !isElement(it.defense)) fail(where, 'defense 속성이 올바르지 않습니다.');
    if (it.use?.status !== undefined && !isStatusId(it.use.status)) fail(where, 'use.status 가 올바르지 않습니다.');
    if (it.type === 'consumable' && !it.use) fail(where, '소모품에는 use 가 필요합니다.');
    if (!isObj(it.icon) || !isStr(it.icon.shape) || !isStr(it.icon.color)) fail(where, 'icon 이 필요합니다.');
    this.items.set(it.id, it);
  }

  private addAbility(raw: unknown): void {
    if (!isObj(raw) || !isStr(raw.id)) fail('abilities.json', `id 없는 항목 ${JSON.stringify(raw).slice(0, 80)}`);
    const a = raw as unknown as AbilityDef;
    const where = `abilities.json(${a.id})`;
    if (this.abilities.has(a.id)) fail(where, '중복된 id 입니다.');
    if (!isStr(a.name)) fail(where, 'name 이 필요합니다.');
    if (a.kind !== 'skill' && a.kind !== 'spell') fail(where, 'kind 는 skill 또는 spell 이어야 합니다.');
    if (!isClassId(a.classId) && a.classId !== 'monster') fail(where, `알 수 없는 직업 ${a.classId}`);
    for (const k of ['level', 'price', 'mp', 'cooldownMs'] as const) if (!isNum(a[k]) || a[k] < 0) fail(where, `${k} 는 0 이상이어야 합니다.`);
    if (!TARGETINGS.includes(a.targeting)) fail(where, `targeting 은 ${TARGETINGS.join('/')} 중 하나여야 합니다.`);
    if (a.element !== undefined && a.element !== 'weapon' && !isElement(a.element)) fail(where, 'element 가 올바르지 않습니다.');
    if (!Array.isArray(a.effects) || a.effects.length === 0) fail(where, 'effects 가 필요합니다.');
    for (const e of a.effects) {
      if (!isObj(e) || !EFFECT_TYPES.includes(e.type as string)) fail(where, `알 수 없는 효과 ${JSON.stringify(e)}`);
      if (e.type === 'status' && !isStatusId(e.status)) fail(where, `알 수 없는 상태 ${String(e.status)}`);
      if ((e.type === 'magic' || e.type === 'heal') && e.stat !== undefined && !isStatKey(e.stat)) fail(where, `알 수 없는 능력치 ${String(e.stat)}`);
    }
    if (!isObj(a.icon)) fail(where, 'icon 이 필요합니다.');
    this.abilities.set(a.id, a);
  }

  private addMonster(raw: unknown): void {
    if (!isObj(raw) || !isStr(raw.id)) fail('monsters.json', `id 없는 항목 ${JSON.stringify(raw).slice(0, 80)}`);
    const m = raw as unknown as MonsterDef;
    const where = `monsters.json(${m.id})`;
    if (this.monsters.has(m.id)) fail(where, '중복된 id 입니다.');
    if (!isStr(m.name)) fail(where, 'name 이 필요합니다.');
    if (!Number.isInteger(m.level) || m.level < 1 || m.level > 999) fail(where, 'level 은 1~999 정수여야 합니다.');
    if (!isObj(m.look) || !BODY_PLANS.includes(m.look.body)) fail(where, `look.body 는 ${BODY_PLANS.join('/')} 중 하나여야 합니다.`);
    if (m.element !== undefined && !isElement(m.element)) fail(where, 'element 가 올바르지 않습니다.');
    if (m.atkElement !== undefined && !isElement(m.atkElement)) fail(where, 'atkElement 가 올바르지 않습니다.');
    for (const l of m.loot ?? []) {
      if (!this.items.has(l.item)) fail(where, `전리품 아이템 '${l.item}' 이 items.json 에 없습니다.`);
      if (!isNum(l.chance) || l.chance < 0 || l.chance > 1) fail(where, `전리품 확률은 0~1 이어야 합니다 (${l.item}).`);
    }
    for (const s of m.spells ?? []) if (!this.abilities.has(s.id)) fail(where, `마법 '${s.id}' 이 abilities.json 에 없습니다.`);
    this.monsters.set(m.id, m);
  }

  private addNpc(raw: unknown): void {
    if (!isObj(raw) || !isStr(raw.id)) fail('npcs.json', `id 없는 항목 ${JSON.stringify(raw).slice(0, 80)}`);
    const n = raw as unknown as NpcDef;
    const where = `npcs.json(${n.id})`;
    if (this.npcs.has(n.id)) fail(where, '중복된 id 입니다.');
    if (!isStr(n.name)) fail(where, 'name 이 필요합니다.');
    if (!isObj(n.look)) fail(where, 'look 이 필요합니다.');
    if (!Array.isArray(n.services)) fail(where, 'services 배열이 필요합니다.');
    for (const s of n.services) {
      if (!isObj(s) || !SERVICE_TYPES.includes(s.type as string)) fail(where, `알 수 없는 서비스 ${JSON.stringify(s)}`);
      if (s.type === 'shop') for (const id of s.items) if (!this.items.has(id)) fail(where, `상점 아이템 '${id}' 이 없습니다.`);
      if (s.type === 'class' && !isClassId(s.classId)) fail(where, `알 수 없는 직업 ${s.classId}`);
    }
    this.npcs.set(n.id, n);
  }

  private addMap(raw: unknown, file: string): void {
    if (!isObj(raw) || !isStr(raw.id)) fail(`maps/${file}`, 'id 가 필요합니다.');
    const m = raw as unknown as MapDef;
    const where = `maps/${file}(${m.id})`;
    if (this.maps.has(m.id)) fail(where, '중복된 맵 id 입니다.');
    if (!isStr(m.name)) fail(where, 'name 이 필요합니다.');
    if (!Array.isArray(m.tiles) || m.tiles.length === 0) fail(where, 'tiles 가 필요합니다.');
    const w = m.tiles[0]!.length;
    m.tiles.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== w) fail(where, `${y}번째 줄의 길이가 ${w} 이 아닙니다.`);
      for (const ch of row) if (!isKnownTile(ch)) fail(where, `${y}번째 줄에 알 수 없는 타일 문자 '${ch}'`);
    });
    const walkable = (x: number, y: number) =>
      y >= 0 && y < m.tiles.length && x >= 0 && x < w && tileInfo(m.tiles[y]![x]).walkable;
    if (!isObj(m.spawn) || !walkable(m.spawn.x, m.spawn.y)) fail(where, 'spawn 위치가 걸을 수 있는 칸이어야 합니다.');
    m.warps ??= [];
    m.npcs ??= [];
    m.spawns ??= [];
    for (const wp of m.warps) if (!walkable(wp.x, wp.y)) fail(where, `워프 (${wp.x},${wp.y}) 가 걸을 수 있는 칸이 아닙니다.`);
    for (const n of m.npcs) {
      if (!this.npcs.has(n.npc)) fail(where, `NPC '${n.npc}' 이 npcs.json 에 없습니다.`);
      if (!walkable(n.x, n.y)) fail(where, `NPC '${n.npc}' 위치가 걸을 수 있는 칸이 아닙니다.`);
    }
    for (const s of m.spawns) {
      if (!this.monsters.has(s.monster)) fail(where, `몬스터 '${s.monster}' 이 monsters.json 에 없습니다.`);
      if (!Number.isInteger(s.count) || s.count < 0 || s.count > 500) fail(where, `몬스터 수가 올바르지 않습니다 (${s.monster}).`);
    }
    this.maps.set(m.id, m);
  }

  private crossCheck(): void {
    if (!this.maps.has('town')) fail('maps', "시작 마을 맵 'town' 이 필요합니다.");
    for (const m of this.maps.values()) {
      for (const wp of m.warps) {
        const t = this.maps.get(wp.to);
        if (!t) fail(`maps(${m.id})`, `워프 목적지 맵 '${wp.to}' 이 없습니다.`);
        const row = t.tiles[wp.ty];
        if (!row || !tileInfo(row[wp.tx]).walkable) fail(`maps(${m.id})`, `워프 도착 지점 ${wp.to}(${wp.tx},${wp.ty}) 이 걸을 수 없는 칸입니다.`);
      }
    }
    for (const n of this.npcs.values()) {
      for (const s of n.services) {
        if (s.type === 'teleport')
          for (const d of s.dests) if (!this.maps.has(d.map)) fail(`npcs.json(${n.id})`, `이동 목적지 맵 '${d.map}' 이 없습니다.`);
      }
    }
    for (const c of this.classes.values())
      for (const id of c.starterItems ?? []) if (!this.items.has(id)) fail(`classes.json(${c.id})`, `시작 아이템 '${id}' 이 없습니다.`);
  }

  clientData(server: PublicServerInfo): ClientGameData {
    const key = JSON.stringify(server);
    if (this.clientCache?.key === key) return this.clientCache.json;
    const json: ClientGameData = {
      classes: [...this.classes.values()],
      items: [...this.items.values()],
      abilities: [...this.abilities.values()],
      monsters: [...this.monsters.values()].map((m) => ({
        id: m.id,
        name: m.name,
        level: m.level,
        look: m.look,
        ...(m.boss ? { boss: true } : {}),
      })),
      maps: [...this.maps.values()].map((m) => ({ id: m.id, name: m.name, ...(m.levelRange ? { levelRange: m.levelRange } : {}) })),
      server,
    };
    this.clientCache = { key, json };
    return json;
  }

  /** 이름(한글) 또는 id 로 아이템을 찾습니다. 공백은 무시합니다. */
  findItem(query: string): ItemDef | undefined {
    return findByNameOrId(this.items, query);
  }

  findMonster(query: string): MonsterDef | undefined {
    return findByNameOrId(this.monsters, query);
  }

  findAbility(query: string): AbilityDef | undefined {
    return findByNameOrId(this.abilities, query);
  }

  findMap(query: string): MapDef | undefined {
    return findByNameOrId(this.maps, query);
  }
}

function findByNameOrId<T extends { id: string; name: string }>(map: Map<string, T>, query: string): T | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const direct = map.get(q);
  if (direct) return direct;
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const nq = norm(q);
  let partial: T | undefined;
  for (const v of map.values()) {
    if (norm(v.name) === nq || v.id.toLowerCase() === nq) return v;
    if (!partial && norm(v.name).includes(nq)) partial = v;
  }
  return partial;
}
