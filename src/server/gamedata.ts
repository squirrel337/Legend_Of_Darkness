// gamedata/*.json 을 읽고 검증합니다. 잘못된 데이터가 있으면 어디가 문제인지 알려 주고 서버를 시작하지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASS_FALLBACK_NAMES,
  CLASS_IDS,
  ELEMENTS,
  EQUIP_SLOTS,
  isClassId,
  isStatKey,
  isStatusId,
  MAX_BONUS,
  MAX_EXP_GRANT,
  MAX_STAT_VALUE,
  type ClassId,
} from '../shared/constants';
import {
  classTier,
  CONDITION_TYPES,
  FIRST_CLASSES,
  publicProgression,
  SECOND_CLASSES,
  TREE_MAX_COLS,
  TREE_MAX_ROWS,
  type AbilityPatch,
  type Condition,
  type DesignIssue,
  type ProgressionConfig,
  type SkillTreeConfig,
  type SkillTreeNode,
  type SkillTreesConfig,
} from '../shared/progression';
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

const TARGETINGS = ['front', 'around', 'around8', 'self', 'enemy', 'ally', 'enemyArea', 'line', 'party'];
const EFFECT_TYPES = ['physical', 'magic', 'heal', 'status', 'cleanse', 'revive', 'restoreMp', 'sacrifice', 'dash', 'summon'];
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const SERVICE_TYPES = ['shop', 'buy', 'class', 'revive', 'heal', 'ascend', 'secondJob', 'teleport', 'resetStats', 'storage', 'talk'];
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
  /**
   * 성장 규칙 (gamedata/progression.json). 관리자가 바꾸면 applyDesign 이 통째로 바꿔 끼우므로,
   * 오래 붙잡아 두지 말고 쓸 때마다 world.data.progression 으로 읽으세요.
   */
  progression!: ProgressionConfig;
  /** 직업별 스킬트리 (gamedata/skilltrees.json). progression 과 마찬가지로 바꿔 끼워집니다 */
  skillTrees!: SkillTreesConfig;
  /** 설계 검사의 경고 (서버 시작 때 기록에 남기고 관리자 편집기에 보여 줌) */
  designWarnings: DesignIssue[] = [];
  /** 기술 id → 그 기술이 있는 트리의 직업과 노드 */
  private treeIndex = new Map<string, { classId: ClassId; node: SkillTreeNode }>();
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
    // 성장 체계 설계: 다른 데이터가 모두 읽힌 뒤에 (기술·아이템 id 를 맞춰 봄)
    const design = { progression: readJson(path.join(dir, 'progression.json')), skillTrees: readJson(path.join(dir, 'skilltrees.json')) };
    const issues = checkDesign(design, gd);
    const err = issues.find((i) => i.level === 'error');
    if (err) fail(err.where, err.msg);
    gd.setDesign(design.progression as ProgressionConfig, normalizeSkillTrees(design.skillTrees), issues);
    return gd;
  }

  /** 검사를 통과한 설계를 바꿔 끼웁니다 (트리 색인과 클라이언트용 데이터도 새로) */
  private setDesign(progression: ProgressionConfig, skillTrees: SkillTreesConfig, issues: DesignIssue[]): void {
    this.progression = clone(progression);
    this.skillTrees = skillTrees;
    this.designWarnings = issues.filter((i) => i.level === 'warn');
    this.treeIndex.clear();
    for (const classId of CLASS_IDS) for (const node of skillTrees.trees[classId].nodes) this.treeIndex.set(node.ability, { classId, node });
    this.clientCache = null;
  }

  /** 직업의 스킬트리 */
  treeOf(classId: ClassId): SkillTreeConfig {
    return this.skillTrees.trees[classId];
  }

  /** 기술이 있는 트리의 직업과 노드 (어느 트리에도 없으면 배울 수 없는 기술) */
  nodeOf(abilityId: string): { classId: ClassId; node: SkillTreeNode } | undefined {
    return this.treeIndex.get(abilityId);
  }

  /**
   * 관리자 편집기가 저장한 설계를 검사해 실행 중인 게임 데이터에 바로 반영합니다 (서버를 끄지 않고).
   * 주지 않은 부분은 지금 값을 그대로 씁니다. 오류가 하나라도 있으면 아무것도 바꾸지 않고, 돌려주는 목록에 오류가 들어 있습니다.
   * 파일 쓰기·판 기록·접속자에게 { t: 'design' } 보내기·플레이어 다시 계산은 부르는 쪽(관리자 트랙의 design.ts)이 합니다.
   */
  applyDesign(next: DesignUpdate): DesignIssue[] {
    const patches = next.abilities ?? [];
    const issues = checkAbilityPatches(patches, this);
    if (issues.some(isError)) return issues;
    // 기술 이름이 바뀌어도 검사 메시지가 새 이름을 쓰도록, 고친 기술로 검사합니다
    const abilities = new Map(this.abilities);
    for (const p of patches) abilities.set(p.id, { ...abilities.get(p.id)!, ...pickPatch(p) });
    const design = { progression: next.progression ?? this.progression, skillTrees: next.skillTrees ?? this.skillTrees };
    issues.push(...checkDesign(design, { classes: this.classes, items: this.items, abilities }));
    if (issues.some(isError)) return issues;
    for (const p of patches) Object.assign(this.abilities.get(p.id)!, pickPatch(p));
    this.setDesign(design.progression as ProgressionConfig, normalizeSkillTrees(design.skillTrees), issues);
    return issues;
  }

  /**
   * gamedata 폴더의 progression.json 과 skilltrees.json 을 다시 읽어 applyDesign 합니다
   * (기술 수정은 applyDesign 의 abilities 로 넘기므로 abilities.json 은 다시 읽지 않음). 읽지 못하면 오류 하나를 돌려줍니다.
   */
  reloadDesign(dir: string): DesignIssue[] {
    let progression: unknown;
    let skillTrees: unknown;
    try {
      progression = readJson(path.join(dir, 'progression.json'));
      skillTrees = readJson(path.join(dir, 'skilltrees.json'));
    } catch (e) {
      return [{ level: 'error', where: 'gamedata', msg: (e as Error).message }];
    }
    return this.applyDesign({ progression, skillTrees });
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
    if (it.range !== undefined) {
      if (!isInt(it.range, 1, 10)) fail(where, 'range 는 1~10 정수여야 합니다.');
      if (it.slot !== 'weapon') fail(where, 'range 는 무기에만 쓸 수 있습니다.');
    }
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
      if (e.type === 'physical') {
        if (e.hits !== undefined && !isInt(e.hits, 1, 5)) fail(where, 'physical.hits 는 1~5 정수여야 합니다.');
        if (e.lifesteal !== undefined && (!isNum(e.lifesteal) || e.lifesteal < 0 || e.lifesteal > 1)) fail(where, 'physical.lifesteal 은 0~1 이어야 합니다.');
      }
      if (e.type === 'summon') {
        if (!isStr(e.monster)) fail(where, 'summon.monster 가 필요합니다.');
        if (!isNum(e.durationMs) || e.durationMs <= 0) fail(where, 'summon.durationMs 는 0보다 커야 합니다.');
        if (!isInt(e.max, 1, 5)) fail(where, 'summon.max 는 1~5 정수여야 합니다.');
        if (e.count !== undefined && !isInt(e.count, 1, 3)) fail(where, 'summon.count 는 1~3 정수여야 합니다.');
      }
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
    if (n.look.outfit !== undefined && !isClassId(n.look.outfit)) fail(where, `look.outfit 은 ${CLASS_IDS.join('/')} 중 하나여야 합니다.`);
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
    // 소환 기술은 summon: true 인 몬스터만 부를 수 있고, 소환수는 맵에 생성되지 않습니다
    for (const a of this.abilities.values()) {
      for (const e of a.effects) {
        if (e.type !== 'summon') continue;
        const m = this.monsters.get(e.monster);
        if (!m) fail(`abilities.json(${a.id})`, `소환할 몬스터 '${e.monster}' 이 없습니다.`);
        if (!m.summon) fail(`abilities.json(${a.id})`, `'${e.monster}' 은 소환수(summon: true)가 아닙니다.`);
      }
    }
    for (const m of this.maps.values())
      for (const s of m.spawns)
        if (this.monsters.get(s.monster)?.summon) fail(`maps(${m.id})`, `소환수 '${s.monster}' 은 맵에 생성할 수 없습니다.`);
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
        ...(m.summon ? { summon: true } : {}),
      })),
      maps: [...this.maps.values()].map((m) => ({ id: m.id, name: m.name, ...(m.levelRange ? { levelRange: m.levelRange } : {}) })),
      server,
      skillTrees: this.skillTrees.trees,
      progression: publicProgression(this.progression),
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

// ───────────────────────── 성장 체계 설계 검사 (progression.json, skilltrees.json) ─────────────────────────
// 서버 시작(GameData.load)과 관리자 편집기의 저장(applyDesign)이 같은 검사를 씁니다. 관리자 트랙은 저장하기 전에
// checkDesign / checkAbilityPatches 로 미리 검사해 편집기에 문제 목록을 보여 줄 수 있습니다.
// 문제를 모두 모아 돌려주며, level 'error' 가 하나라도 있으면 그 설계는 쓸 수 없습니다.

/** 설계 검사에 필요한 다른 게임 데이터 (GameData 를 그대로 넘기면 됩니다) */
export interface DesignRefs {
  readonly classes: ReadonlyMap<ClassId, ClassDef>;
  readonly items: ReadonlyMap<string, ItemDef>;
  readonly abilities: ReadonlyMap<string, AbilityDef>;
  /** 서버 최대 레벨 (주지 않으면 999 까지 허용, 게임은 서버 최대 레벨로 다시 자름) */
  readonly maxLevel?: number;
}

/** applyDesign 에 넘기는 새 설계 (아직 검사 전이라 unknown). 주지 않은 부분은 지금 값을 그대로 씁니다 */
export interface DesignUpdate {
  progression?: unknown;
  skillTrees?: unknown;
  /** 기술의 이름·설명·마나·재사용 대기 수정 */
  abilities?: AbilityPatch[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isError = (i: DesignIssue) => i.level === 'error';

/** 한 파일의 검사 결과를 모읍니다. 위치는 "파일(경로)" 로 적습니다 */
class IssueList {
  readonly list: DesignIssue[] = [];
  constructor(private readonly file: string) {}
  private where(p: string): string {
    return p ? `${this.file}(${p})` : this.file;
  }
  error(p: string, msg: string): void {
    this.list.push({ level: 'error', where: this.where(p), msg });
  }
  warn(p: string, msg: string): void {
    this.list.push({ level: 'warn', where: this.where(p), msg });
  }
}

/** 정해진 항목 말고 다른 것이 있으면 (대개 오타) 오류 */
function onlyKeys(out: IssueList, w: string, o: Record<string, unknown>, keys: readonly string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) out.error(w, `알 수 없는 항목 '${k}' 이(가) 있습니다. (쓸 수 있는 항목: ${keys.join(', ')})`);
}

function intField(out: IssueList, w: string, o: Record<string, unknown>, key: string, lo: number, hi: number, optional = false): number | undefined {
  const v = o[key];
  if (v === undefined && optional) return undefined;
  if (!isInt(v, lo, hi)) {
    out.error(w, `${key} 는 ${lo}~${hi >= Number.MAX_SAFE_INTEGER ? '' : hi} 사이의 정수여야 합니다. (지금: ${JSON.stringify(v) ?? '없음'})`);
    return undefined;
  }
  return v;
}

function numField(out: IssueList, w: string, o: Record<string, unknown>, key: string, lo: number, hi: number): number | undefined {
  const v = o[key];
  if (!isNum(v) || v < lo || v > hi) {
    out.error(w, `${key} 는 ${lo}~${hi} 사이의 숫자여야 합니다. (지금: ${JSON.stringify(v) ?? '없음'})`);
    return undefined;
  }
  return v;
}

function boolField(out: IssueList, w: string, o: Record<string, unknown>, key: string): void {
  if (typeof o[key] !== 'boolean') out.error(w, `${key} 는 true 또는 false 여야 합니다.`);
}

const designClassName = (refs: DesignRefs, id: ClassId): string => refs.classes.get(id)?.name ?? CLASS_FALLBACK_NAMES[id];

/** keys 의 직업마다 하나씩 값이 있는 객체인지 확인하고, 값마다 fn 으로 검사합니다 */
function perClass<K extends ClassId>(
  out: IssueList,
  refs: DesignRefs,
  w: string,
  v: unknown,
  keys: readonly K[],
  fn: (val: unknown, w: string, id: K) => void,
): void {
  if (!isObj(v)) {
    out.error(w, `직업별 객체여야 합니다. (${keys.join(', ')})`);
    return;
  }
  for (const k of Object.keys(v))
    if (!(keys as readonly string[]).includes(k)) out.error(w, `여기에는 ${keys.map((id) => designClassName(refs, id)).join('·')}만 적을 수 있습니다. ('${k}')`);
  for (const k of keys) {
    if (!(k in v)) out.error(w, `${designClassName(refs, k)}(${k}) 항목이 없습니다.`);
    else fn(v[k], `${w}.${k}`, k);
  }
}

/** 직업 id 배열 (allowed 중에서, 겹치지 않게) */
function classList(out: IssueList, refs: DesignRefs, w: string, v: unknown, allowed: readonly ClassId[]): void {
  if (!Array.isArray(v)) {
    out.error(w, '직업 id 배열이어야 합니다.');
    return;
  }
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || !(allowed as readonly string[]).includes(x))
      out.error(w, `'${String(x)}' 은(는) 여기에 쓸 수 없습니다. (${allowed.map((id) => `${designClassName(refs, id)}(${id})`).join(', ')} 중에서)`);
    else if (seen.has(x)) out.error(w, `${designClassName(refs, x as ClassId)} 이(가) 두 번 있습니다.`);
    seen.add(String(x));
  }
}

function checkCondition(out: IssueList, refs: DesignRefs, w: string, c: unknown, profMax: number, maxLv: number): void {
  if (!isObj(c) || typeof c.type !== 'string') {
    out.error(w, '조건은 { "type": "..." } 모양의 객체여야 합니다.');
    return;
  }
  const keys = (...k: string[]) => onlyKeys(out, w, c, ['type', ...k]);
  switch (c.type) {
    case 'level':
      keys('min');
      intField(out, w, c, 'min', 1, maxLv);
      break;
    case 'ascended':
      keys();
      break;
    case 'rebirths':
      keys('min');
      intField(out, w, c, 'min', 0, 1_000_000);
      break;
    case 'pureHp':
    case 'pureMp':
      keys('min');
      intField(out, w, c, 'min', 0, MAX_BONUS);
      break;
    case 'exp':
      keys('min', 'consume');
      intField(out, w, c, 'min', 0, MAX_EXP_GRANT);
      boolField(out, w, c, 'consume');
      break;
    case 'payHp':
    case 'payMp':
      keys('amount');
      intField(out, w, c, 'amount', 1, MAX_BONUS);
      break;
    case 'gold':
      keys('min', 'consume');
      intField(out, w, c, 'min', 0, Number.MAX_SAFE_INTEGER);
      boolField(out, w, c, 'consume');
      break;
    case 'item':
      keys('item', 'qty', 'consume');
      if (!isStr(c.item) || !refs.items.has(c.item)) out.error(w, `아이템 '${String(c.item)}' 이 items.json 에 없습니다.`);
      intField(out, w, c, 'qty', 1, 1_000_000);
      boolField(out, w, c, 'consume');
      break;
    case 'skillProf': {
      keys('ability', 'min');
      const a = isStr(c.ability) ? refs.abilities.get(c.ability) : undefined;
      if (!a || a.classId === 'monster') out.error(w, `기술 '${String(c.ability)}' 이 abilities.json 에 없거나 몬스터 전용입니다.`);
      intField(out, w, c, 'min', 0, profMax);
      break;
    }
    default:
      out.error(w, `알 수 없는 조건 종류 '${c.type}' (쓸 수 있는 것: ${CONDITION_TYPES.join(', ')})`);
  }
}

/** progression.json 내용을 검사합니다 */
export function checkProgression(raw: unknown, refs: DesignRefs): DesignIssue[] {
  const out = new IssueList('progression.json');
  if (!isObj(raw)) {
    out.error('', '최상위가 객체여야 합니다.');
    return out.list;
  }
  onlyKeys(out, '', raw, ['version', 'rebirth', 'ascend', 'second', 'ability', 'proficiency']);
  if (raw.version !== 1) out.error('version', 'version 은 1 이어야 합니다.');
  const maxLv = refs.maxLevel ?? 999;
  const section = (key: string, keys: readonly string[]): Record<string, unknown> | undefined => {
    const v = raw[key];
    if (!isObj(v)) {
      out.error(key, `${key} 객체가 필요합니다.`);
      return undefined;
    }
    onlyKeys(out, key, v, keys);
    return v;
  };

  // 숙련도 (skillProf 조건의 최대를 정하므로 먼저)
  let profMax = 100;
  const prof = section('proficiency', ['max', 'baseChance', 'slowdown', 'minChance', 'effectMin', 'effectMax']);
  if (prof) {
    profMax = intField(out, 'proficiency', prof, 'max', 1, 1000) ?? 100;
    const base = numField(out, 'proficiency', prof, 'baseChance', 0, 1);
    numField(out, 'proficiency', prof, 'slowdown', 0, 1);
    const min = numField(out, 'proficiency', prof, 'minChance', 0, 1);
    if (base !== undefined && min !== undefined && min > base)
      out.warn('proficiency', 'minChance 가 baseChance 보다 커서 숙련도와 상관없이 늘 같은 확률로 오릅니다.');
    const lo = numField(out, 'proficiency', prof, 'effectMin', 0.01, 10);
    const hi = numField(out, 'proficiency', prof, 'effectMax', 0.01, 10);
    if (lo !== undefined && hi !== undefined && hi < lo) out.error('proficiency', 'effectMax 는 effectMin 이상이어야 합니다.');
  }
  const conditionList = (v: unknown, w: string): void => {
    if (!Array.isArray(v)) return out.error(w, '조건 목록(배열)이어야 합니다.');
    v.forEach((c, i) => checkCondition(out, refs, `${w}[${i}]`, c, profMax, maxLv));
  };

  // 어빌리티
  const ab = section('ability', ['maxLevel', 'expRatio', 'hpPerLevel', 'mpPerLevel']);
  if (ab) {
    intField(out, 'ability', ab, 'maxLevel', 1, 999);
    numField(out, 'ability', ab, 'expRatio', 0, 10);
    intField(out, 'ability', ab, 'hpPerLevel', 0, 100_000);
    intField(out, 'ability', ab, 'mpPerLevel', 0, 100_000);
  }

  // 전직
  const rb = section('rebirth', ['level', 'restartLevel', 'allowAfterAscend', 'targets', 'conditions', 'names']);
  if (rb) {
    const lv = intField(out, 'rebirth', rb, 'level', 1, maxLv);
    intField(out, 'rebirth', rb, 'restartLevel', 1, lv ?? maxLv);
    boolField(out, 'rebirth', rb, 'allowAfterAscend');
    perClass(out, refs, 'rebirth.targets', rb.targets, FIRST_CLASSES, (v, w, id) => {
      classList(out, refs, w, v, FIRST_CLASSES);
      if (Array.isArray(v) && v.length === 0) out.warn(w, `${designClassName(refs, id)}은(는) 전직할 수 없습니다 (갈 수 있는 직업이 없음).`);
    });
    perClass(out, refs, 'rebirth.conditions', rb.conditions, FIRST_CLASSES, conditionList);
    perClass(out, refs, 'rebirth.names', rb.names, FIRST_CLASSES, (v, w) => {
      if (!isStr(v) || v.length > 12) out.error(w, '이름은 1~12자 글자여야 합니다.');
    });
  }

  // 승급
  const as = section('ascend', ['level', 'expTrade', 'hpToStat', 'conditions', 'title']);
  if (as) {
    intField(out, 'ascend', as, 'level', 1, maxLv);
    if (!isObj(as.expTrade)) out.error('ascend.expTrade', 'expTrade 는 { "exp", "hp", "mp" } 객체여야 합니다.');
    else {
      onlyKeys(out, 'ascend.expTrade', as.expTrade, ['exp', 'hp', 'mp']);
      intField(out, 'ascend.expTrade', as.expTrade, 'exp', 1, MAX_EXP_GRANT);
      intField(out, 'ascend.expTrade', as.expTrade, 'hp', 0, 1_000_000);
      intField(out, 'ascend.expTrade', as.expTrade, 'mp', 0, 1_000_000);
    }
    if (!isObj(as.hpToStat)) out.error('ascend.hpToStat', 'hpToStat 은 { "hp", "stat" } 객체여야 합니다.');
    else {
      onlyKeys(out, 'ascend.hpToStat', as.hpToStat, ['hp', 'stat']);
      intField(out, 'ascend.hpToStat', as.hpToStat, 'hp', 1, MAX_BONUS);
      intField(out, 'ascend.hpToStat', as.hpToStat, 'stat', 1, 1000);
    }
    if (!isStr(as.title) || as.title.length > 12) out.error('ascend.title', '칭호는 1~12자 글자여야 합니다.');
    perClass(out, refs, 'ascend.conditions', as.conditions, FIRST_CLASSES, (v, w, id) => {
      conditionList(v, w);
      // 숙련도 조건의 기술은 대개 그 직업의 핵심 기술
      if (Array.isArray(v))
        v.forEach((c, i) => {
          const a = isObj(c) && c.type === 'skillProf' && isStr(c.ability) ? refs.abilities.get(c.ability) : undefined;
          if (a && a.classId !== id) out.warn(`${w}[${i}]`, `${a.name} 은(는) ${designClassName(refs, id)}의 기술이 아닙니다.`);
        });
    });
  }

  // 2차 전직
  const sc = section('second', ['from', 'conditions', 'beastTypes']);
  if (sc) {
    perClass(out, refs, 'second.from', sc.from, SECOND_CLASSES, (v, w, id) => {
      classList(out, refs, w, v, FIRST_CLASSES);
      if (Array.isArray(v) && v.length === 0) out.warn(w, `${designClassName(refs, id)}(으)로 2차 전직할 수 있는 1차 직업이 없습니다.`);
    });
    perClass(out, refs, 'second.conditions', sc.conditions, SECOND_CLASSES, conditionList);
    if (!Array.isArray(sc.beastTypes) || sc.beastTypes.length === 0)
      out.error('second.beastTypes', '수인 계통이 하나 이상 있어야 합니다. ([{ "id": "mammal", "name": "포유류" }, ...])');
    else {
      const ids = new Set<string>();
      sc.beastTypes.forEach((b: unknown, i: number) => {
        const w = `second.beastTypes[${i}]`;
        if (!isObj(b)) return out.error(w, '계통은 { "id", "name" } 객체여야 합니다.');
        onlyKeys(out, w, b, ['id', 'name']);
        if (!isStr(b.id) || !/^[a-z][a-z0-9_]{0,23}$/.test(b.id)) out.error(w, 'id 는 영문 소문자로 시작하는 24자 이하의 영문 소문자·숫자·_ 여야 합니다.');
        else if (ids.has(b.id)) out.error(w, `계통 id '${b.id}' 가 두 번 있습니다.`);
        else ids.add(b.id);
        if (!isStr(b.name) || b.name.length > 12) out.error(w, '이름은 1~12자 글자여야 합니다.');
      });
    }
  }
  return out.list;
}

/**
 * skilltrees.json 내용을 검사합니다. progression 을 주면 숙련도 최대·어빌 최대·수인 계통까지 맞춰 봅니다
 * (주지 않으면 숙련도 100, 어빌 999 까지 허용하고 계통은 보지 않음).
 */
export function checkSkillTrees(raw: unknown, refs: DesignRefs, progression?: ProgressionConfig): DesignIssue[] {
  const out = new IssueList('skilltrees.json');
  if (!isObj(raw)) {
    out.error('', '최상위가 객체여야 합니다.');
    return out.list;
  }
  onlyKeys(out, '', raw, ['version', 'trees']);
  if (raw.version !== 1) out.error('version', 'version 은 1 이어야 합니다.');
  const trees = raw.trees;
  if (!isObj(trees)) {
    out.error('trees', 'trees 객체가 필요합니다. ({ "warrior": { "nodes": [...] }, ... })');
    return out.list;
  }
  const maxLv = refs.maxLevel ?? 999;
  const profMax = progression?.proficiency.max ?? 100;
  const abilMax = progression?.ability.maxLevel ?? 999;
  const beastIds = progression ? progression.second.beastTypes.map((b) => b.id) : null;
  const aname = (id: string) => refs.abilities.get(id)?.name ?? id;
  for (const k of Object.keys(trees)) if (!isClassId(k)) out.error(k, `알 수 없는 직업 '${k}' 의 트리입니다.`);
  /** 기술 → 선수과목들 (순환 검사용) */
  const reqs = new Map<string, string[]>();
  /** 기술 → 놓인 트리의 직업과 필요 레벨(어빌) */
  const placed = new Map<string, { classId: ClassId; need: number }>();

  for (const classId of CLASS_IDS) {
    const t = trees[classId];
    if (t === undefined) {
      out.error(classId, '이 직업의 트리가 없습니다. 배울 기술이 없으면 { "nodes": [] } 로 적어 주세요.');
      continue;
    }
    if (!isObj(t)) {
      out.error(classId, '트리는 { "nodes": [...] } 모양의 객체여야 합니다.');
      continue;
    }
    onlyKeys(out, classId, t, ['columns', 'nodes']);
    if (
      t.columns !== undefined &&
      (!Array.isArray(t.columns) || t.columns.length > TREE_MAX_COLS || !t.columns.every((c) => typeof c === 'string' && c.length <= 12))
    )
      out.error(`${classId}/columns`, `열 제목은 ${TREE_MAX_COLS}개까지, 각각 12자 이하의 글자여야 합니다.`);
    if (!Array.isArray(t.nodes)) {
      out.error(classId, 'nodes 배열이 필요합니다.');
      continue;
    }
    const tier = classTier(classId);
    const cells = new Map<string, string>();
    t.nodes.forEach((n: unknown, i: number) => {
      const w = `${classId}/${isObj(n) && isStr(n.ability) ? n.ability : `#${i}`}`;
      if (!isObj(n)) return out.error(w, '노드는 객체여야 합니다.');
      onlyKeys(out, w, n, ['ability', 'row', 'col', 'level', 'abilityLevel', 'gold', 'items', 'requires', 'stats', 'beastType']);
      const a = isStr(n.ability) ? refs.abilities.get(n.ability) : undefined;
      if (!a) return out.error(w, `기술 '${String(n.ability)}' 이 abilities.json 에 없습니다.`);
      if (a.classId !== classId)
        out.error(
          w,
          a.classId === 'monster'
            ? `${a.name} 은(는) 몬스터 전용 기술입니다.`
            : `${a.name} 은(는) ${designClassName(refs, a.classId)}의 기술입니다. 그 직업의 트리에 넣어 주세요.`,
        );
      if (placed.has(a.id)) out.error(w, `${a.name} 이(가) 트리에 두 번 있습니다.`);
      // 칸
      const row = intField(out, w, n, 'row', 0, TREE_MAX_ROWS - 1);
      const col = intField(out, w, n, 'col', 0, TREE_MAX_COLS - 1);
      if (row !== undefined && col !== undefined) {
        const other = cells.get(`${row},${col}`);
        if (other) out.error(w, `칸 (줄 ${row}, 칸 ${col}) 에 이미 ${aname(other)} 이(가) 있습니다.`);
        else cells.set(`${row},${col}`, a.id);
      }
      // 필요 레벨 / 어빌
      const level = intField(out, w, n, 'level', 1, maxLv, true);
      const abilityLevel = intField(out, w, n, 'abilityLevel', 1, abilMax, true);
      if (tier === 2) {
        if (n.abilityLevel === undefined) out.error(w, '2차 직업 기술에는 필요 어빌(abilityLevel)이 있어야 합니다.');
      } else {
        if (n.level === undefined) out.error(w, '필요 레벨(level)이 있어야 합니다.');
        if (n.abilityLevel !== undefined) out.error(w, '필요 어빌(abilityLevel)은 2차 직업 트리에서만 씁니다.');
      }
      const gold = intField(out, w, n, 'gold', 0, 1_000_000_000_000);
      // 재료
      if (n.items !== undefined) {
        if (!Array.isArray(n.items)) out.error(w, 'items 는 [{ "item": id, "qty": 개수 }] 배열이어야 합니다.');
        else {
          const seen = new Set<string>();
          n.items.forEach((x: unknown, j: number) => {
            const ww = `${w}.items[${j}]`;
            if (!isObj(x)) return out.error(ww, '재료는 { "item": id, "qty": 개수 } 객체여야 합니다.');
            onlyKeys(out, ww, x, ['item', 'qty']);
            if (!isStr(x.item) || !refs.items.has(x.item)) out.error(ww, `아이템 '${String(x.item)}' 이 items.json 에 없습니다.`);
            else if (seen.has(x.item)) out.error(ww, '같은 재료가 두 번 있습니다. 개수를 합쳐 주세요.');
            else seen.add(x.item);
            intField(out, ww, x, 'qty', 1, 1000);
          });
        }
      }
      // 선수과목
      const reqIds: string[] = [];
      if (n.requires !== undefined) {
        if (!Array.isArray(n.requires)) out.error(w, 'requires 는 [{ "ability": id, "prof": 숙련도 }] 배열이어야 합니다.');
        else
          n.requires.forEach((x: unknown, j: number) => {
            const ww = `${w}.requires[${j}]`;
            if (!isObj(x)) return out.error(ww, '선수과목은 { "ability": id, "prof": 숙련도 } 객체여야 합니다.');
            onlyKeys(out, ww, x, ['ability', 'prof']);
            const ra = isStr(x.ability) ? refs.abilities.get(x.ability) : undefined;
            if (!ra || ra.classId === 'monster') out.error(ww, `선수과목 '${String(x.ability)}' 이 abilities.json 에 없거나 몬스터 전용입니다.`);
            else if (ra.id === a.id) out.error(ww, '자기 자신을 선수과목으로 둘 수 없습니다.');
            else if (reqIds.includes(ra.id)) out.error(ww, `선수과목 ${ra.name} 이(가) 두 번 있습니다.`);
            else reqIds.push(ra.id);
            intField(out, ww, x, 'prof', 0, profMax);
          });
      }
      // 능력치
      if (n.stats !== undefined) {
        if (!isObj(n.stats)) out.error(w, 'stats 는 { "str": 50 } 같은 객체여야 합니다.');
        else
          for (const [k, v] of Object.entries(n.stats)) {
            if (!isStatKey(k)) out.error(w, `알 수 없는 능력치 '${k}' (str/int/wis/con/dex)`);
            else if (!isInt(v, 1, MAX_STAT_VALUE)) out.error(w, `필요 능력치 ${k} 는 1~${MAX_STAT_VALUE} 사이의 정수여야 합니다.`);
          }
      }
      // 수인 계통
      if (n.beastType !== undefined) {
        if (classId !== 'beastkin') out.error(w, '계통(beastType)은 수인 트리에서만 씁니다.');
        else if (!isStr(n.beastType)) out.error(w, 'beastType 은 계통 id 글자여야 합니다.');
        else if (beastIds && !beastIds.includes(n.beastType))
          out.error(w, `알 수 없는 수인 계통 '${n.beastType}' (progression.json 의 second.beastTypes: ${beastIds.join(', ')})`);
      }
      // abilities.json 의 기본값과 다르면 알림 (서클·밸런스 계산은 abilities.json 의 level/price 를 봄)
      const need = tier === 2 ? abilityLevel : level;
      if (need !== undefined && need !== a.level)
        out.warn(w, `필요 ${tier === 2 ? '어빌' : '레벨'} ${need} 이(가) abilities.json 의 level ${a.level} 과 다릅니다.`);
      if (gold !== undefined && gold !== a.price) out.warn(w, `골드 ${gold} 이(가) abilities.json 의 price ${a.price} 와 다릅니다.`);
      if (!placed.has(a.id)) placed.set(a.id, { classId, need: need ?? 0 });
      reqs.set(a.id, reqIds);
    });
  }

  // 선수과목: 어느 트리에도 없으면 배울 수 없어 오류, 같은 트리에서 더 늦게 열리면 경고, 돌고 돌면 오류
  for (const [id, list] of reqs) {
    const me = placed.get(id)!;
    for (const r of list) {
      const p = placed.get(r);
      if (!p) out.error(`${me.classId}/${id}`, `선수과목 ${aname(r)} 은(는) 어느 트리에도 없어 배울 수 없습니다.`);
      else if (p.classId === me.classId && p.need > me.need)
        out.warn(`${me.classId}/${id}`, `선수과목 ${aname(r)}(${p.need}) 이(가) 이 기술(${me.need})보다 늦게 열립니다.`);
    }
  }
  for (const cycle of findCycles(reqs))
    out.error(`${placed.get(cycle[0]!)?.classId ?? '?'}/${cycle[0]}`, `선수과목이 돌고 돕니다: ${[...cycle, cycle[0]!].map(aname).join(' → ')}`);
  // 트리에 없는 기술은 아무도 배울 수 없음
  for (const a of refs.abilities.values())
    if (a.classId !== 'monster' && !placed.has(a.id)) out.warn(a.classId, `${a.name}(${a.id}) 은(는) 트리에 없어 배울 수 없습니다.`);
  return out.list;
}

/** 선수과목 그래프(기술 → 선수과목들)의 순환을 찾습니다. 순환마다 그 안의 기술 id 들 (같은 순환은 한 번만) */
function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const state = new Map<string, 1 | 2>(); // 1: 살펴보는 중, 2: 끝
  const stack: string[] = [];
  const out: string[][] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      const s = state.get(next);
      if (s === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cycle);
        }
      } else if (s === undefined && graph.has(next)) visit(next);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of graph.keys()) if (!state.has(id)) visit(id);
  return out;
}

/**
 * 두 설계 파일을 함께 검사합니다 (서버 시작, 관리자 저장 전).
 * progression.json 에 오류가 없으면 그 값으로 스킬트리의 숙련도·어빌·계통까지 맞춰 보고,
 * 전직·승급·2차 전직의 숙련도 조건 기술이 어느 트리에도 없으면 경고합니다.
 */
export function checkDesign(design: { progression: unknown; skillTrees: unknown }, refs: DesignRefs): DesignIssue[] {
  const p = checkProgression(design.progression, refs);
  const progOk = !p.some(isError);
  const t = checkSkillTrees(design.skillTrees, refs, progOk ? (design.progression as ProgressionConfig) : undefined);
  const issues = [...p, ...t];
  if (progOk && !t.some(isError)) {
    const trees = normalizeSkillTrees(design.skillTrees);
    const inTree = new Set(CLASS_IDS.flatMap((c) => trees.trees[c].nodes.map((n) => n.ability)));
    const cfg = design.progression as ProgressionConfig;
    const lists: [string, Condition[]][] = [
      ...FIRST_CLASSES.map((c): [string, Condition[]] => [`rebirth.conditions.${c}`, cfg.rebirth.conditions[c]]),
      ...FIRST_CLASSES.map((c): [string, Condition[]] => [`ascend.conditions.${c}`, cfg.ascend.conditions[c]]),
      ...SECOND_CLASSES.map((c): [string, Condition[]] => [`second.conditions.${c}`, cfg.second.conditions[c]]),
    ];
    for (const [w, list] of lists)
      list.forEach((c, i) => {
        if (c.type === 'skillProf' && !inTree.has(c.ability))
          issues.push({
            level: 'warn',
            where: `progression.json(${w}[${i}])`,
            msg: `${refs.abilities.get(c.ability)?.name ?? c.ability} 은(는) 트리에 없어 배울 수 없습니다.`,
          });
      });
  }
  return issues;
}

/** 검사를 통과한 skilltrees.json 을 게임에서 쓰는 모양으로 (깊은 복사, 빠진 items/requires 는 빈 배열) */
export function normalizeSkillTrees(raw: unknown): SkillTreesConfig {
  type RawNode = Omit<SkillTreeNode, 'items' | 'requires'> & Partial<Pick<SkillTreeNode, 'items' | 'requires'>>;
  const src = raw as { trees: Record<ClassId, { columns?: string[]; nodes: RawNode[] }> };
  const trees = {} as Record<ClassId, SkillTreeConfig>;
  for (const classId of CLASS_IDS) {
    const t = src.trees[classId];
    trees[classId] = {
      ...(t.columns ? { columns: [...t.columns] } : {}),
      nodes: t.nodes.map((n) => ({ ...clone(n), items: clone(n.items ?? []), requires: clone(n.requires ?? []) })),
    };
  }
  return { version: 1, trees };
}

/** 편집기의 기술 수정(이름·설명·마나·재사용 대기)을 검사합니다 (abilities.json) */
export function checkAbilityPatches(patches: unknown, refs: DesignRefs): DesignIssue[] {
  const out = new IssueList('abilities.json');
  if (!Array.isArray(patches)) {
    out.error('', '기술 수정은 배열이어야 합니다.');
    return out.list;
  }
  const seen = new Set<string>();
  patches.forEach((p: unknown, i: number) => {
    const w = isObj(p) && isStr(p.id) ? p.id : `#${i}`;
    if (!isObj(p)) return out.error(w, '기술 수정은 객체여야 합니다.');
    onlyKeys(out, w, p, ['id', 'name', 'desc', 'mp', 'cooldownMs']);
    const a = isStr(p.id) ? refs.abilities.get(p.id) : undefined;
    if (!a || a.classId === 'monster') return out.error(w, `기술 '${String(p.id)}' 이 없거나 몬스터 전용입니다.`);
    if (seen.has(a.id)) out.error(w, '같은 기술을 두 번 고쳤습니다.');
    seen.add(a.id);
    if (p.name !== undefined && (!isStr(p.name) || p.name.length > 20)) out.error(w, '이름은 1~20자 글자여야 합니다.');
    if (p.desc !== undefined && (typeof p.desc !== 'string' || p.desc.length > 300)) out.error(w, '설명은 300자 이하의 글자여야 합니다.');
    intField(out, w, p, 'mp', 0, 100_000, true);
    intField(out, w, p, 'cooldownMs', 0, 3_600_000, true);
  });
  return out.list;
}

/** 기술 수정에서 바꿀 값만 */
function pickPatch(p: AbilityPatch): Partial<AbilityDef> {
  const o: Partial<AbilityDef> = {};
  if (p.name !== undefined) o.name = p.name;
  if (p.desc !== undefined) o.desc = p.desc;
  if (p.mp !== undefined) o.mp = p.mp;
  if (p.cooldownMs !== undefined) o.cooldownMs = p.cooldownMs;
  return o;
}
