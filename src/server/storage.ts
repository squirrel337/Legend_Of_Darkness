// 캐릭터 저장소. data/characters/<이름>.json 파일 하나에 캐릭터 하나를 저장합니다.
// 서버 시작 시 모든 캐릭터를 메모리로 읽어 두고, 변경 시 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 안전하게 저장합니다.
import fs from 'node:fs';
import path from 'node:path';
import {
  EQUIP_SLOTS,
  INVENTORY_SIZE,
  isClassId,
  isDir,
  isRole,
  isStatusId,
  MAX_BONUS,
  NAME_REGEX,
  type ClassId,
  type Dir,
  type EquipSlot,
  type Role,
  type StatusId,
} from '../shared/constants';
import { classTier, PROF_MIGRATED } from '../shared/progression';
import type { InvSlot } from '../shared/protocol';
import type { StatBlock } from '../shared/types';
import { log } from './log';

export const STORAGE_SLOTS = 60;

export interface CharacterData {
  version: 1;
  name: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number;
  lastIp: string;
  role: Role;
  banned: boolean;
  banReason: string;
  gender: 'm' | 'f';
  hairStyle: number;
  hairColor: number;
  classId: ClassId;
  level: number;
  /** 현재 레벨에서 쌓인 경험치 (만렙이면 승급용으로 계속 쌓임) */
  exp: number;
  stats: StatBlock;
  statPoints: number;
  /** 승급 장인에게 산 최대 체력·마나. 체력을 팔거나(능력치 교환) 바치면(2차 전직) 줄어 음수가 될 수 있습니다 */
  bonusHp: number;
  bonusMp: number;
  hp: number;
  mp: number;
  gold: number;
  mapId: string;
  x: number;
  y: number;
  dir: Dir;
  ghost: boolean;
  inventory: (InvSlot | null)[];
  equipment: Record<EquipSlot, string | null>;
  skills: string[];
  spells: string[];
  storage: InvSlot[];
  storageGold: number;
  kills: number;
  deaths: number;
  playTimeSec: number;
  godMode: boolean;
  /** 기술/마법 재사용 가능 시각 (다시 접속해도 유지) */
  cooldowns: Record<string, number>;
  /** 남아 있는 버프/디버프 (다시 접속해도 유지) */
  statusSave: SavedStatus[];
  // ── 성장 체계 (docs/progression.md) ──
  /** 전직(환골탈태) 횟수 */
  rebirths: number;
  /** 승급했는지 (칭호, 2차 전직 조건) */
  ascended: boolean;
  /** 어빌리티 레벨: 0 = 2차 직업이 아님, 2차 직업은 1부터 (2차 직업이면 늘 1 이상) */
  abilityLevel: number;
  /** 지금 어빌 레벨에서 쌓인 어빌 경험치 */
  abilityExp: number;
  /** 수인 계통 id (progression.json 의 second.beastTypes). 수인이 아니거나 아직 고르지 않았으면 null */
  beastType: string | null;
  /** 배운 기술·마법의 숙련도 (기술 id → 0 ~ 숙련도 최대). 배운 것마다 항목이 있습니다 */
  prof: Record<string, number>;
}

export interface SavedStatus {
  id: StatusId;
  until: number;
  potency: number;
  sourceLevel: number;
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function emptyEquipment(): Record<EquipSlot, string | null> {
  const eq = {} as Record<EquipSlot, string | null>;
  for (const s of EQUIP_SLOTS) eq[s] = null;
  return eq;
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};
const int = (v: unknown, def: number, min = -Infinity, max = Infinity) => Math.round(num(v, def, min, max));
const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
/** 숙련도 저장값의 한계 (progression.json 의 숙련도 최대는 이보다 작음, 게임은 그 최대로 다시 자름) */
const PROF_LIMIT = 1000;

/** 저장 파일을 읽어 빠진 값을 채우고 형식을 바로잡습니다 (구버전 호환) */
export function normalizeCharacter(raw: unknown, knownItem?: (id: string) => boolean): CharacterData {
  if (typeof raw !== 'object' || raw === null) throw new Error('캐릭터 데이터가 객체가 아닙니다.');
  const r = raw as Record<string, unknown>;
  const name = str(r.name, '');
  if (!name) throw new Error('이름이 없습니다.');
  const statsRaw = (r.stats ?? {}) as Record<string, unknown>;
  const okItem = (id: unknown): id is string => typeof id === 'string' && (!knownItem || knownItem(id));
  const slot = (v: unknown): InvSlot | null => {
    if (!v || typeof v !== 'object') return null;
    const s = v as Record<string, unknown>;
    if (!okItem(s.item)) {
      if (typeof s.item === 'string') log.warn(`[${name}] 알 수 없는 아이템 '${s.item}' 을(를) 제거했습니다.`);
      return null;
    }
    const qty = int(s.qty, 1, 1, 1_000_000);
    return { item: s.item, qty };
  };
  const invRaw = Array.isArray(r.inventory) ? r.inventory : [];
  const inventory: (InvSlot | null)[] = [];
  for (let i = 0; i < INVENTORY_SIZE; i++) inventory.push(slot(invRaw[i]));
  const equipment = emptyEquipment();
  const eqRaw = (r.equipment ?? {}) as Record<string, unknown>;
  for (const s of EQUIP_SLOTS) equipment[s] = okItem(eqRaw[s]) ? (eqRaw[s] as string) : null;
  const storageRaw = Array.isArray(r.storage) ? r.storage : [];
  const storage = storageRaw.map(slot).filter((s): s is InvSlot => s !== null).slice(0, STORAGE_SLOTS);
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const dir = r.dir;
  const classId: ClassId = isClassId(r.classId) ? r.classId : 'peasant';
  const skills = strList(r.skills);
  const spells = strList(r.spells);
  // 2차 직업이면 어빌리티 레벨이 늘 1 이상 (이 체계 전에 2차 직업을 고른 캐릭터는 1부터), 아니면 0
  const second = classTier(classId) === 2;
  return {
    version: 1,
    name,
    passwordHash: str(r.passwordHash, ''),
    createdAt: num(r.createdAt, Date.now()),
    lastLoginAt: num(r.lastLoginAt, 0),
    lastIp: str(r.lastIp, ''),
    role: isRole(r.role) ? r.role : 'player',
    banned: r.banned === true,
    banReason: str(r.banReason, ''),
    gender: r.gender === 'f' ? 'f' : 'm',
    hairStyle: int(r.hairStyle, 0, 0, 99),
    hairColor: int(r.hairColor, 0, 0, 99),
    classId,
    level: int(r.level, 1, 1, 9999),
    exp: num(r.exp, 0, 0),
    stats: {
      str: int(statsRaw.str, 3, 1),
      int: int(statsRaw.int, 3, 1),
      wis: int(statsRaw.wis, 3, 1),
      con: int(statsRaw.con, 3, 1),
      dex: int(statsRaw.dex, 3, 1),
    },
    statPoints: int(r.statPoints, 0, 0),
    bonusHp: int(r.bonusHp, 0, -MAX_BONUS, MAX_BONUS),
    bonusMp: int(r.bonusMp, 0, -MAX_BONUS, MAX_BONUS),
    hp: int(r.hp, 1, 0),
    mp: int(r.mp, 0, 0),
    gold: int(r.gold, 0, 0, Number.MAX_SAFE_INTEGER),
    mapId: str(r.mapId, 'town'),
    x: int(r.x, -1),
    y: int(r.y, -1),
    dir: isDir(dir) ? dir : 2,
    ghost: r.ghost === true,
    inventory,
    equipment,
    skills,
    spells,
    storage,
    storageGold: int(r.storageGold, 0, 0, Number.MAX_SAFE_INTEGER),
    kills: int(r.kills, 0, 0),
    deaths: int(r.deaths, 0, 0),
    playTimeSec: int(r.playTimeSec, 0, 0),
    godMode: r.godMode === true,
    cooldowns: parseCooldowns(r.cooldowns),
    statusSave: parseStatuses(r.statusSave),
    rebirths: int(r.rebirths, 0, 0, 1_000_000),
    ascended: r.ascended === true,
    abilityLevel: second ? int(r.abilityLevel, 1, 1, 999) : 0,
    abilityExp: second ? num(r.abilityExp, 0, 0) : 0,
    beastType: classId === 'beastkin' && typeof r.beastType === 'string' && r.beastType ? r.beastType.slice(0, 32) : null,
    prof: parseProf(r.prof, [...skills, ...spells]),
  };
}

/**
 * 배운 기술·마법마다 숙련도 하나. 숙련도 항목(prof)이 아예 없는 저장 파일(이 체계 전의 캐릭터)은 배운 기술을 모두
 * 숙련도 최대(PROF_MIGRATED)로 옮깁니다. 항목이 있는데 값이 없거나 숫자가 아니면(손으로 고쳤거나 망가진 저장) 가장 낮은 0.
 * 배우지 않은 기술의 항목은 버립니다.
 */
function parseProf(v: unknown, learned: string[]): Record<string, number> {
  if (v === undefined) return Object.fromEntries(learned.map((id) => [id, PROF_MIGRATED]));
  const raw = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const id of learned) {
    const n = raw[id];
    out[id] = typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(PROF_LIMIT, Math.max(0, n))) : 0;
  }
  return out;
}

function parseCooldowns(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (typeof t === 'number' && Number.isFinite(t) && k.length <= 64) out[k] = t;
  }
  return out;
}

function parseStatuses(v: unknown): SavedStatus[] {
  if (!Array.isArray(v)) return [];
  const out: SavedStatus[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (!isStatusId(r.id)) continue;
    out.push({ id: r.id, until: num(r.until, 0), potency: num(r.potency, 0), sourceLevel: num(r.sourceLevel, 1) });
  }
  return out;
}

function fileNameFor(name: string): string {
  // 정상적인 이름(한글/영문/숫자)은 그대로 파일명으로 쓰고, 그 밖의 문자는 인코딩합니다
  const key = nameKey(name);
  return (NAME_REGEX.test(key) ? key : encodeURIComponent(key)) + '.json';
}

export class CharacterStore {
  private readonly dir: string;
  private readonly chars = new Map<string, CharacterData>();
  private writeChains = new Map<string, Promise<void>>();
  /** 시작할 때 폴더에 있던 캐릭터 파일 수 (읽기에 실패한 파일 포함) */
  filesAtLoad = 0;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'characters');
  }

  /** 모든 캐릭터 파일을 읽습니다 */
  load(knownItem?: (id: string) => boolean): void {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      this.filesAtLoad++;
      const file = path.join(this.dir, f);
      try {
        const data = normalizeCharacter(JSON.parse(fs.readFileSync(file, 'utf8')), knownItem);
        const key = nameKey(data.name);
        if (this.chars.has(key)) {
          log.warn(`중복된 캐릭터 파일을 건너뜁니다: ${f}`);
          continue;
        }
        this.chars.set(key, data);
      } catch (e) {
        log.error(`캐릭터 파일 ${f} 을(를) 읽지 못했습니다: ${(e as Error).message}`);
      }
    }
    log.info(`캐릭터 ${this.chars.size}명을 불러왔습니다.`);
  }

  get size(): number {
    return this.chars.size;
  }

  get(name: string): CharacterData | undefined {
    return this.chars.get(nameKey(name));
  }

  has(name: string): boolean {
    return this.chars.has(nameKey(name));
  }

  all(): CharacterData[] {
    return [...this.chars.values()];
  }

  /** 새 캐릭터를 등록하고 바로 저장합니다 */
  async create(data: CharacterData): Promise<void> {
    const key = nameKey(data.name);
    if (this.chars.has(key)) throw new Error('이미 존재하는 이름입니다.');
    this.chars.set(key, data);
    await this.save(data);
  }

  /** 비동기 저장. 같은 캐릭터의 저장은 순서대로 처리됩니다. */
  save(data: CharacterData): Promise<void> {
    const json = JSON.stringify(data, null, 1);
    const file = path.join(this.dir, fileNameFor(data.name));
    return this.enqueue(data.name, async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, json);
      await fs.promises.rename(tmp, file);
    });
  }

  /** 같은 캐릭터 파일에 대한 작업(저장/삭제)을 순서대로 실행합니다 */
  private enqueue(name: string, job: () => Promise<void>): Promise<void> {
    const key = nameKey(name);
    const prev = this.writeChains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(job)
      .catch((e: Error) => log.error(`캐릭터 ${name} 파일 작업 실패: ${e.message}`));
    this.writeChains.set(key, next);
    void next.finally(() => {
      if (this.writeChains.get(key) === next) this.writeChains.delete(key);
    });
    return next;
  }

  /** 종료 시 사용하는 동기 저장 */
  saveSync(data: CharacterData): void {
    const file = path.join(this.dir, fileNameFor(data.name));
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
      fs.renameSync(tmp, file);
    } catch (e) {
      log.error(`캐릭터 ${data.name} 저장 실패: ${(e as Error).message}`);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writeChains.values()]);
  }

  async delete(name: string): Promise<boolean> {
    const key = nameKey(name);
    const data = this.chars.get(key);
    if (!data) return false;
    this.chars.delete(key);
    // 앞선 저장이 끝난 뒤에 지우고, 그 사이 같은 이름으로 새로 만든 캐릭터의 저장은 삭제 뒤에 실행되게 합니다
    const file = path.join(this.dir, fileNameFor(data.name));
    await this.enqueue(data.name, () => fs.promises.rm(file, { force: true }));
    return true;
  }
}

/** 관리자 작업 기록 (data/admin-audit.log, 한 줄에 JSON 하나) */
export class AuditLog {
  private readonly file: string;
  private recent: { at: number; actor: string; action: string; target?: string; detail?: string }[] = [];
  /** 쓰는 중인 기록 (순서대로 이어 씀) */
  private pending: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'admin-audit.log');
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      if (fs.existsSync(this.file)) {
        const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-200);
        for (const l of lines) {
          try {
            this.recent.push(JSON.parse(l));
          } catch {
            /* 무시 */
          }
        }
      }
    } catch {
      /* 무시 */
    }
  }

  write(actor: string, action: string, target?: string, detail?: string): void {
    const entry = { at: Date.now(), actor, action, ...(target ? { target } : {}), ...(detail ? { detail } : {}) };
    this.recent.push(entry);
    if (this.recent.length > 200) this.recent.shift();
    // 순서대로 덧붙이고, 서버를 닫을 때 flush 로 끝까지 기다림
    const line = JSON.stringify(entry) + '\n';
    this.pending = this.pending
      .then(() => fs.promises.appendFile(this.file, line))
      .catch((e: Error) => log.error('감사 로그 기록 실패:', e.message));
  }

  /** 아직 쓰는 중인 기록을 기다립니다 (서버를 닫을 때: 닫은 뒤에 파일이 늦게 생기지 않게) */
  flush(): Promise<void> {
    return this.pending;
  }

  list(limit = 100): typeof this.recent {
    return this.recent.slice(-limit).reverse();
  }
}
