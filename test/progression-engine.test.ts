// 성장 체계 엔진을 실제 서버로 확인합니다: 숙련도에 따른 위력·상태 이상 확률과 숙련도 오르기, 몬스터 처치의 어빌 경험치,
// 전직 전 직업의 기술 쓰기(자동사냥 포함), NPC 대화(전직·환골탈태·승급 장인·2차 직업 인도자·길드장의 스킬트리 배우기).
// 서버는 IP 당 캐릭터를 10개까지 만들 수 있어 캐릭터를 아껴 씁니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DEFAULT_AUTO_SETTINGS } from '../src/shared/autohunt';
import type { ClassId } from '../src/shared/constants';
import { abilityExpToNext } from '../src/shared/progression';
import { startServer, type RunningServer } from '../src/server/app';
import { applyDamage, monsterUseAbility, playerUseAbility, removeStatus } from '../src/server/systems/combat';
import { rebirthOnData } from '../src/server/systems/progression';
import type { NpcDef } from '../src/shared/types';
import type { MapInstance } from '../src/server/world/MapInstance';
import { Monster } from '../src/server/world/Monster';
import { Npc } from '../src/server/world/Npc';
import type { Player } from '../src/server/world/Player';
import { Client, create, sleep, testConfig, until, type Msg } from './helpers';

let dataDir = '';
let srv: RunningServer;
let gm: Client;

const world = () => srv.world;
const data = () => srv.world.data;
const training = () => srv.world.maps.get('training')!;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-prog-engine-'));
  srv = await startServer(testConfig(dataDir));
  gm = await Client.connect(srv.port);
  create(gm, '운영자'); // 첫 캐릭터는 관리자
  await gm.waitFor('welcome');
});

after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function join(name: string): Promise<{ c: Client; p: Player }> {
  const c = await Client.connect(srv.port);
  create(c, name);
  await c.waitFor('welcome');
  await c.self();
  return { c, p: world().findPlayer(name)! };
}

/** 직업/레벨을 정하고 기술을 숙련도 prof 로 배우게 합니다 */
function become(p: Player, cls: ClassId, level: number, learn: Record<string, number> = {}): void {
  const a = world().admin;
  assert.ok(a.setClass('테스트', p.name, cls).ok);
  assert.ok(a.setLevel('테스트', p.name, level).ok);
  for (const [id, prof] of Object.entries(learn)) {
    if (!p.data.skills.includes(id) && !p.data.spells.includes(id)) assert.ok(a.learnAbility('테스트', p.name, id).ok, id);
    p.data.prof[id] = prof;
  }
  p.recompute();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}

/** 움직이지도 반격하지도 않는 몬스터를 놓습니다 (앞 시험이 남긴 몬스터가 그 칸에 있으면 치움) */
function spawn(map: MapInstance, id: string, x: number, y: number, hp?: number): Monster {
  const left = map.creatureAt(x, y);
  if (left && left.kind === 'monster') despawn(left as Monster);
  assert.ok(map.isFree(x, y), `(${x},${y}) 칸이 비어 있어야 함`);
  const m = new Monster(world().allocId(), data().monsters.get(id)!);
  m.x = x;
  m.y = y;
  m.homeX = x;
  m.homeY = y;
  if (hp !== undefined) m.hp = hp;
  m.nextMoveAt = Date.now() + 600_000;
  m.nextAttackAt = Date.now() + 600_000;
  m.nextSpellAt = Date.now() + 600_000;
  map.add(m);
  return m;
}

function despawn(...ms: Monster[]): void {
  for (const m of ms) {
    m.dead = true;
    m.map?.remove(m);
  }
}

function place(p: Player, map: MapInstance, x: number, y: number, dir: 0 | 1 | 2 | 3 = 2): void {
  if (!(p.map === map && p.x === x && p.y === y)) world().transfer(p, map, x, y);
  assert.equal(p.map, map);
  p.dir = dir;
}

/** 이 안에서만 Math.random 을 고정합니다 */
function withRandom<T>(v: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => v;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/** 재사용 대기를 지우고 기술을 씁니다 */
function use(p: Player, id: string, target?: number): void {
  p.gcdUntil = 0;
  p.cooldowns.delete(id);
  p.mp = p.maxMp;
  playerUseAbility(world(), p, id, target);
}

/** 명중하고 치명타는 아닌 난수 (숙련도도 오르지 않게 0.5 이상은 쓰지 않음) */
const HIT = 0.1;

let fighter: { c: Client; p: Player };

test('숙련도 배율: 같은 기술이 숙련도 0 이면 70%, 100 이면 115% 의 피해·회복', async () => {
  fighter = await join('숙련전사');
  const { p } = fighter;
  become(p, 'warrior', 40, { w_strike: 0, first_aid: 0 });
  // 피해·회복량이 커야 반올림의 영향이 작음
  p.data.stats = { str: 255, int: 3, wis: 3, con: 200, dex: 3 };
  p.recompute();
  const tr = training();
  place(p, tr, 3, 12, 1); // 동쪽을 봄
  const target = spawn(tr, 'goblin', 4, 12, 1_000_000);
  const hitOnce = (prof: number): number => {
    p.data.prof.w_strike = prof;
    const before = target.hp;
    // 배율은 쓰기 직전의 숙련도로 정함 (쓴 뒤에 숙련도가 올라도 이번 피해와는 상관없음)
    withRandom(HIT, () => use(p, 'w_strike'));
    return before - target.hp;
  };
  const d0 = hitOnce(0);
  const d100 = hitOnce(100);
  assert.ok(d0 > 0 && d100 > 0, `${d0} ${d100}`);
  // 반올림을 빼면 115/70 배
  assert.ok(Math.abs(d100 / d0 - 1.15 / 0.7) < 0.03, `${d0} → ${d100}`);
  const d50 = hitOnce(50);
  assert.ok(Math.abs(d50 / d0 - 0.925 / 0.7) < 0.03, `${d0} → ${d50}`);
  despawn(target);

  // 회복도 같은 배율
  const healOnce = (prof: number): number => {
    p.data.prof.first_aid = prof;
    p.hp = 1;
    withRandom(0.99, () => use(p, 'first_aid'));
    return p.hp - 1;
  };
  const h0 = healOnce(0);
  const h100 = healOnce(100);
  assert.ok(h0 > 0, `${h0}`);
  assert.ok(Math.abs(h100 / h0 - 1.15 / 0.7) < 0.03, `${h0} → ${h100}`);
});

test('숙련도: 기술을 실제로 쓰면 확률로 1 오르고 { t: "prof" } 로 알린다, 10 단위와 최대에서는 채팅으로도', async () => {
  const { c, p } = fighter;
  const tr = training();
  place(p, tr, 3, 12, 1);
  const target = spawn(tr, 'goblin', 4, 12, 1_000_000);
  p.data.prof.w_strike = 8;
  let mark = c.mark;
  // 난수 0: 명중하고 숙련도도 오름 (치명타도 나지만 피해만 커짐)
  withRandom(0, () => use(p, 'w_strike'));
  assert.equal(p.data.prof.w_strike, 9);
  let m = await c.waitFor('prof', (x) => x.id === 'w_strike', mark);
  assert.equal(m.prof, 9);
  // 난수가 오를 확률보다 크면 그대로
  withRandom(0.99, () => use(p, 'w_strike'));
  assert.equal(p.data.prof.w_strike, 9);
  mark = c.mark;
  withRandom(0, () => use(p, 'w_strike'));
  m = await c.waitFor('prof', (x) => x.id === 'w_strike', mark);
  assert.equal(m.prof, 10);
  await c.waitFor('chat', (x) => x.ch === 'system' && x.text.includes('강타의 숙련도가 10'), mark);
  p.data.prof.w_strike = 99;
  mark = c.mark;
  withRandom(0, () => use(p, 'w_strike'));
  await c.waitFor('chat', (x) => x.ch === 'system' && x.text.includes('최대(100)'), mark);
  withRandom(0, () => use(p, 'w_strike'));
  assert.equal(p.data.prof.w_strike, 100, '최대에서 멈춤');
  // 마나가 모자라거나 재사용 대기 중이라 쓰지 못하면 오르지 않음
  p.data.prof.w_strike = 20;
  p.gcdUntil = 0;
  p.cooldowns.set('w_strike', Date.now() + 60_000);
  withRandom(0, () => playerUseAbility(world(), p, 'w_strike', undefined));
  assert.equal(p.data.prof.w_strike, 20);
  // 저장해도 남음
  world().saveAll();
  await world().store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'characters', '숙련전사.json'), 'utf8'));
  assert.equal(saved.prof.w_strike, 20);
  despawn(target);
});

test('숙련도: 해로운 상태가 걸릴 확률에도 배율 (확률이 없으면 1로 보고 곱함), 몬스터의 기술은 그대로', async () => {
  const { p } = fighter;
  become(p, 'rogue', 40, { r_poison: 0 });
  const tr = training();
  place(p, tr, 3, 12, 1);
  const target = spawn(tr, 'goblin', 4, 12, 1_000_000);
  // 독 바르기의 중독은 확률이 없음(늘 걸림): 숙련도 0 이면 70% → 난수 0.8 이면 안 걸림
  p.data.prof.r_poison = 0;
  withRandom(0.8, () => use(p, 'r_poison'));
  // 피해를 줬어도(난수 0.8: 명중) 중독은 안 걸림
  assert.equal(target.statuses.has('poison'), false);
  p.data.prof.r_poison = 100;
  withRandom(0.8, () => use(p, 'r_poison'));
  assert.equal(target.statuses.has('poison'), true, '숙련도 100 이면 115% → 1 로 잘려 늘 걸림');
  despawn(target);
  // 수면(85%): 숙련도 0 → 59.5%, 100 → 97.75%
  become(p, 'wizard', 40, { z_sleep: 0 });
  const sleeper = spawn(tr, 'goblin', 4, 12, 1_000_000);
  withRandom(0.7, () => use(p, 'z_sleep', sleeper.id));
  assert.equal(sleeper.statuses.has('sleep'), false);
  p.data.prof.z_sleep = 100;
  withRandom(0.7, () => use(p, 'z_sleep', sleeper.id));
  assert.equal(sleeper.statuses.has('sleep'), true);
  despawn(sleeper);
  // 몬스터의 기술은 숙련도와 상관없음: 확률이 없는 저주는 난수와 상관없이 늘 걸림
  const caster = spawn(tr, 'goblin', 4, 12, 1_000_000);
  assert.ok(withRandom(0.99, () => monsterUseAbility(world(), caster, data().abilities.get('mon_curse')!, p)));
  assert.equal(p.statuses.has('curse'), true);
  removeStatus(p, 'curse');
  despawn(caster);
});

test('어빌 경험치: 2차 직업이 몬스터를 잡으면 받은 경험치의 25% 를 함께 받고, 모이면 어빌 업 (1차 직업은 없음)', async () => {
  const { c, p } = await join('어빌궁사');
  become(p, 'archer', 99);
  assert.equal(p.data.abilityLevel, 1);
  const tr = training();
  place(p, tr, 3, 12, 1);
  const need = abilityExpToNext(1, data().progression.ability);
  p.data.abilityExp = need - 1;
  const hp0 = p.maxHp;
  const mp0 = p.maxMp;
  const wolf = spawn(tr, 'goblin', 4, 12);
  const exp = wolf.stats.exp * world().config.expRate;
  const share = Math.floor(Math.floor(exp) * data().progression.ability.expRatio);
  assert.ok(share >= 1, `고블린 경험치 ${exp}`);
  const mark = c.mark;
  applyDamage(world(), p, wolf, wolf.hp + 10, 'phys');
  assert.ok(wolf.dead);
  const gain = await c.waitFor('gain', (m) => m.exp > 0, mark);
  assert.equal(gain.abilityExp, share);
  const up = await c.waitFor('abilityLevelUp', () => true, mark);
  assert.equal(up.abilityLevel, 2);
  assert.equal(p.data.abilityLevel, 2);
  assert.equal(p.data.abilityExp, need - 1 + share - need);
  assert.equal(p.maxHp - hp0, 30, '어빌이 오르면 최대 체력 +30');
  assert.equal(p.maxMp - mp0, 15, '최대 마나 +15');
  const s = await c.self((x) => x.abilityLevel === 2, mark);
  assert.equal(s.abilityExpNext, abilityExpToNext(2, data().progression.ability));
  await c.waitFor('notice', (m) => m.text.includes('어빌 2'), mark);

  // 1차 직업은 어빌 경험치를 받지 않음
  become(p, 'rogue', 99);
  const rat = spawn(tr, 'rat', 4, 12);
  const mark2 = c.mark;
  applyDamage(world(), p, rat, rat.hp + 10, 'phys');
  const g2 = await c.waitFor('gain', (m) => m.exp > 0, mark2);
  assert.equal(g2.abilityExp, undefined);
  assert.equal(p.data.abilityLevel, 0);
  c.close();
});

test('전직 전 직업의 기술: 전사였다가 도적으로 전직해도 강타를 쓸 수 있고, 자동사냥도 그 기술을 쓴다', async () => {
  const { c, p } = fighter;
  become(p, 'warrior', 99, { w_strike: 100 });
  // 전직: 레벨 1 도적, 강타는 그대로
  const d = p.data;
  d.exp = 200_000_000;
  d.stats = { str: 200, int: 3, wis: 50, con: 255, dex: 80 };
  d.bonusHp = 8000;
  d.bonusMp = 2500;
  const r = rebirthOnData(d, data(), world().config, 'rogue');
  assert.ok(r.ok, r.msg);
  p.recompute();
  assert.equal(d.classId, 'rogue');
  assert.ok(d.skills.includes('w_strike'));
  const tr = training();
  place(p, tr, 3, 12, 1);
  const target = spawn(tr, 'goblin', 4, 12, 1_000_000);
  const before = target.hp;
  withRandom(HIT, () => use(p, 'w_strike'));
  assert.ok(target.hp < before, '이전 직업의 기술로 피해를 줌');
  despawn(target);

  // 자동사냥: 고른 기술이 이전 직업(전사)의 강타여도 씀
  const forest = world().maps.get('forest')!;
  forest.spawners.length = 0;
  for (const m of [...forest.monsters]) despawn(m);
  const spot = forest.findFreeNear(20, 20, 10)!;
  place(p, forest, spot.x, spot.y);
  p.data.godMode = true;
  const rat = spawn(forest, 'rat', spot.x + 3, spot.y, 200);
  rat.nextMoveAt = Date.now() + 600_000;
  const mark = c.mark;
  c.send({ t: 'auto', on: true, settings: { ...DEFAULT_AUTO_SETTINGS, radius: 8, hpPct: 0, abilities: ['w_strike'] } });
  await c.waitFor('auto', (m) => m.on, mark);
  await until(() => c.msgs.slice(mark).some((m) => m.t === 'cooldown' && m.id === 'w_strike'), 15_000);
  p.auto = null;
  p.data.godMode = false;
  despawn(rat);
  await sleep(50);
});

// ───────────────────────── NPC 대화: 전직·승급·2차 전직·배우기 ─────────────────────────

/** 어느 맵에서든 이 NPC 를 찾습니다 */
function npcEntity(defId: string): Npc {
  for (const map of world().maps.values()) for (const n of map.npcs) if (n.def.id === defId) return n;
  throw new Error(`NPC ${defId} 가 없음`);
}

/** NPC 옆 (대화 거리 안) 으로 옮깁니다 */
function near(p: Player, npc: Npc): void {
  const spot = npc.map!.findFreeNear(npc.x, npc.y, 3)!;
  world().transfer(p, npc.map!, spot.x, spot.y);
  assert.ok(Math.abs(p.x - npc.x) <= 4 && Math.abs(p.y - npc.y) <= 4);
}

async function talk(c: Client, npc: Npc): Promise<Msg<'dialog'>> {
  const mark = c.mark;
  c.send({ t: 'talk', npc: npc.id });
  return c.waitFor('dialog', () => true, mark);
}

async function pick(c: Client, npc: Npc, key: string): Promise<Msg<'dialog'>> {
  const mark = c.mark;
  c.send({ t: 'pick', npc: npc.id, key });
  return c.waitFor('dialog', () => true, mark);
}

const keys = (d: Msg<'dialog'>) => d.options.map((o) => o.key);

/** 전직 조건을 채운 99레벨 전사 (순수 체력 14,530 · 마력 3,604, 경험치 1억 5천만) */
function readyWarrior(p: Player, learn: Record<string, number> = {}): void {
  become(p, 'warrior', 99, learn);
  p.data.stats = { str: 200, int: 3, wis: 50, con: 255, dex: 80 };
  Object.assign(p.data, { exp: 150_000_000, bonusHp: 8000, bonusMp: 2500, ascended: false });
  p.recompute();
}

test('전직: 99레벨 1차 직업은 새 직업의 길드장에게 조건을 보고 전직한다 (배운 기술·숙련도는 그대로, 무도가로는 못 감)', async () => {
  const { c, p } = await join('전직대기');
  readyWarrior(p, { w_strike: 77 });
  p.data.exp = 99_000_000;
  const rogueMaster = npcEntity('rogue_master');
  near(p, rogueMaster);
  let d = await talk(c, rogueMaster);
  const opt = d.options.find((o) => o.key === 'rebirth:rogue');
  assert.ok(opt, keys(d).join(','));
  assert.match(opt.label, /전직: 도적\(으\)로 다시 태어나기/);
  // 경험치가 모자라면 조건을 줄마다 보여 주고 "예" 가 없음
  d = await pick(c, rogueMaster, 'rebirth:rogue');
  assert.match(d.text, /○ 순수 체력 14,000 이상 \(지금 14,530\)/);
  assert.match(d.text, /× 경험치 1억 \(써서 없어짐\) \(지금 9,900만\)/);
  assert.ok(!keys(d).includes('rebirth:rogue:yes'));
  d = await pick(c, rogueMaster, 'rebirth:rogue:yes');
  assert.equal(p.data.classId, 'warrior', '억지로 골라도 조건이 모자라면 그대로');
  // 무도 사범은 전사에게 전직을 내놓지 않고, 억지로 골라도 거절
  const monkMaster = npcEntity('monk_master');
  near(p, monkMaster);
  p.data.exp = 150_000_000;
  d = await talk(c, monkMaster);
  assert.ok(!keys(d).some((k) => k.startsWith('rebirth:')), keys(d).join(','));
  d = await pick(c, monkMaster, 'rebirth:monk:yes');
  assert.match(d.text, /전사은\(는\) 무도가\(으\)로 전직할 수 없습니다/);
  assert.equal(p.data.classId, 'warrior');
  // 조건을 채우면 "예"
  near(p, rogueMaster);
  d = await pick(c, rogueMaster, 'rebirth:rogue');
  assert.ok(keys(d).includes('rebirth:rogue:yes'), d.text);
  const mark = c.mark;
  d = await pick(c, rogueMaster, 'rebirth:rogue:yes');
  assert.ok(keys(d).includes('learn:rogue'));
  const s = await c.self((x) => x.classId === 'rogue', mark);
  assert.equal(s.level, 1);
  assert.equal(s.exp, 0);
  assert.equal(s.rebirths, 1);
  assert.deepEqual(s.base, { str: 3, int: 3, wis: 3, con: 3, dex: 3 });
  assert.equal(s.statPoints, 0);
  assert.equal(s.bonusHp, 8000, '산 체력은 그대로');
  assert.equal(s.prof.w_strike, 77, '숙련도도 그대로');
  assert.equal(s.hp, s.maxHp);
  const ab = await c.waitFor('abilities', () => true, mark);
  assert.ok(ab.skills.includes('w_strike'), '전사 기술을 그대로 가짐');
  await c.waitFor('chat', (m) => m.ch === 'notice' && m.text.includes('전직대기님이 도적(으)로 전직했습니다'), mark);
  // 전사 길드장은 이제 기술을 가르치지 않음 (지금 직업의 트리만)
  const warriorMaster = npcEntity('warrior_master');
  near(p, warriorMaster);
  d = await talk(c, warriorMaster);
  assert.ok(!keys(d).includes('learn:warrior'));
  c.close();
});

test('환골탈태: 99레벨 무도가는 무도 사범에게서 무도가로만 다시 태어난다', async () => {
  const { c, p } = await join('무도가');
  become(p, 'monk', 99, { m_punch: 100 });
  p.data.stats = { str: 100, int: 3, wis: 50, con: 255, dex: 100 };
  Object.assign(p.data, { exp: 100_000_000, bonusHp: 8000, bonusMp: 4500 });
  p.recompute();
  // 다른 길드장은 무도가에게 전직을 내놓지 않음
  const warriorMaster = npcEntity('warrior_master');
  near(p, warriorMaster);
  let d = await talk(c, warriorMaster);
  assert.ok(!keys(d).some((k) => k.startsWith('rebirth:')));
  d = await pick(c, warriorMaster, 'rebirth:warrior:yes');
  assert.match(d.text, /무도가은\(는\) 전사\(으\)로 환골탈태할 수 없습니다/);
  const monkMaster = npcEntity('monk_master');
  near(p, monkMaster);
  d = await talk(c, monkMaster);
  const opt = d.options.find((o) => o.key === 'rebirth:monk');
  assert.ok(opt);
  assert.match(opt.label, /환골탈태/);
  d = await pick(c, monkMaster, 'rebirth:monk');
  assert.match(d.text, /환골탈태하면 1레벨/);
  assert.match(d.text, /무도가\(으\)로 환골탈태하는 조건/);
  const mark = c.mark;
  await pick(c, monkMaster, 'rebirth:monk:yes');
  const s = await c.self((x) => x.level === 1, mark);
  assert.equal(s.classId, 'monk');
  assert.equal(s.rebirths, 1);
  await c.waitFor('notice', (m) => m.text.includes('환골탈태했습니다'), mark);
  c.close();
});

test('승급 장인: 경험치로 체력·마나를 사고, 체력으로 능력치를 사고, 핵심 기술 숙련도까지 채우면 승급해 마스터가 된다', async () => {
  const { c, p } = await join('승급대기');
  become(p, 'warrior', 99, { w_ironwall: 100, w_crash: 99 });
  p.data.stats = { str: 200, int: 3, wis: 50, con: 255, dex: 80 };
  // 순수 체력 6,530 + 10,500 = 17,030 (승급 17,000), 경험치 2억 5천만 + 50만 × 5
  Object.assign(p.data, { exp: 250_000_000 + 5 * 500_000, bonusHp: 10_500, bonusMp: 4000, statPoints: 0 });
  p.recompute();
  const smith = npcEntity('ascension');
  near(p, smith);
  let d = await talk(c, smith);
  assert.ok(keys(d).includes('ascend'));
  d = await pick(c, smith, 'ascend');
  assert.deepEqual(keys(d), ['ascend:hp', 'ascend:mp', 'ascend:stat', 'ascend:do', 'back']);
  assert.match(d.text, /쌓인 경험치: 2억 5,250만/);
  d = await pick(c, smith, 'ascend:hp');
  assert.deepEqual(keys(d), ['ascend:hp:1', 'ascend:hp:10', 'ascend:hp:100', 'ascend:hp:505', 'ascend']);
  let mark = c.mark;
  d = await pick(c, smith, 'ascend:hp:5');
  assert.match(d.text, /최대 체력 \+500/);
  let s = await c.self((x) => x.bonusHp === 11_000, mark);
  assert.equal(s.exp, 250_000_000);
  // 체력 → 능력치: 순수 체력 17,530 에서 150 을 팔아도 승급 조건(17,000)은 채움
  mark = c.mark;
  d = await pick(c, smith, 'ascend:stat:1');
  s = await c.self((x) => x.statPoints === 1, mark);
  assert.equal(s.bonusHp, 11_000 - 150);
  // 직업 기본 체력 아래로는 팔 수 없음
  d = await pick(c, smith, 'ascend:stat:1000');
  assert.match(d.text, /직업 기본 체력\(3,980\) 아래로는 팔 수 없습니다/);
  assert.equal(p.data.statPoints, 1);
  // 필살 숙련도 99: 조건이 모자라 "예" 가 없음
  d = await pick(c, smith, 'ascend:do');
  assert.match(d.text, /× 필살 숙련도 100 이상 \(지금 99\)/);
  assert.ok(!keys(d).includes('ascend:do:yes'));
  p.data.prof.w_crash = 100;
  d = await pick(c, smith, 'ascend:do');
  assert.ok(keys(d).includes('ascend:do:yes'), d.text);
  mark = c.mark;
  d = await pick(c, smith, 'ascend:do:yes');
  s = await c.self((x) => x.ascended, mark);
  assert.equal(s.title, '마스터');
  assert.equal(s.exp, 0);
  assert.equal(s.classId, 'warrior');
  await c.waitFor('chat', (m) => m.ch === 'notice' && m.text.includes('승급대기님이 승급하여 마스터'), mark);
  // 승급한 뒤에는 전직을 내놓지 않음
  readyWarrior(p);
  p.data.ascended = true;
  const rogueMaster = npcEntity('rogue_master');
  near(p, rogueMaster);
  d = await talk(c, rogueMaster);
  assert.ok(!keys(d).some((k) => k.startsWith('rebirth:')));
  d = await pick(c, rogueMaster, 'rebirth:rogue:yes');
  assert.match(d.text, /승급한 뒤에는 전직할 수 없습니다/);
  assert.equal(p.data.classId, 'warrior');
  c.close();
});

/** 2차 직업 인도자 (데이터에 아직 없을 수 있으므로 시험용으로 마을에 세움) */
let guide: Npc | null = null;
function secondJobGuide(): Npc {
  if (guide) return guide;
  const town = world().maps.get('town')!;
  const def: NpcDef = {
    id: 'test_second_guide',
    name: '시험 인도자',
    title: '2차 직업 인도자',
    look: npcEntity('ascension').def.look,
    greeting: '2차 직업의 길을 묻는가?',
    services: [{ type: 'secondJob' }],
  };
  data().npcs.set(def.id, def);
  const npc = new Npc(world().allocId(), def);
  const spot = town.findFreeNear(town.def.spawn.x, town.def.spawn.y, 12)!;
  npc.x = spot.x;
  npc.y = spot.y;
  town.add(npc);
  guide = npc;
  return npc;
}

test('2차 전직: 인도자에게 승급한 도적이 궁사로 (레벨 99 그대로, 어빌 1, 경험치·체력·마력을 씀), 갈 수 없는 길은 거절', async () => {
  const { c, p } = await join('이차궁사');
  become(p, 'rogue', 99, { r_stab: 100 });
  p.data.stats = { str: 100, int: 3, wis: 100, con: 100, dex: 200 };
  Object.assign(p.data, { exp: 900_000_000, ascended: true, bonusHp: 300, bonusMp: 0 });
  p.recompute();
  const g = secondJobGuide();
  near(p, g);
  let d = await talk(c, g);
  assert.ok(keys(d).includes('second'));
  assert.ok(!keys(d).includes('beast'));
  d = await pick(c, g, 'second');
  assert.deepEqual(keys(d), ['second:archer', 'back']);
  d = await pick(c, g, 'second:gladiator:yes');
  assert.match(d.text, /그 길로 갈 수 없다/);
  d = await pick(c, g, 'second:archer');
  assert.match(d.text, /○ 승급을 마침/);
  assert.match(d.text, /× 경험치 10억 \(써서 없어짐\) \(지금 9억\)/);
  assert.ok(!keys(d).includes('second:archer:yes'));
  const hp0 = p.data.bonusHp;
  d = await pick(c, g, 'second:archer:yes');
  assert.equal(p.data.classId, 'rogue');
  assert.equal(p.data.bonusHp, hp0, '모자라면 체력도 바치지 않음');
  p.data.exp = 1_100_000_000;
  d = await pick(c, g, 'second:archer');
  assert.ok(keys(d).includes('second:archer:yes'), d.text);
  const mark = c.mark;
  await pick(c, g, 'second:archer:yes');
  const s = await c.self((x) => x.classId === 'archer', mark);
  assert.equal(s.level, 99);
  assert.equal(s.abilityLevel, 1);
  assert.equal(s.abilityExpNext, abilityExpToNext(1, data().progression.ability));
  assert.equal(s.exp, 100_000_000);
  assert.equal(s.bonusHp, hp0 - 500);
  assert.equal(s.bonusMp, -500);
  assert.equal(s.title, '마스터');
  d = await pick(c, g, 'second');
  assert.match(d.text, /이미 궁사의 길/);
  c.close();
});

test('2차 전직: 수인은 계통(포유류·조류·파충류)을 고르고 바꿀 수 없다, 계통이 없는 옛 수인은 인도자에게서 한 번 고른다', async () => {
  const { c, p } = await join('이차수인');
  become(p, 'monk', 99, { m_punch: 100 });
  p.data.stats = { str: 100, int: 3, wis: 50, con: 255, dex: 100 };
  Object.assign(p.data, { exp: 1_000_000_000, ascended: true, bonusHp: 0, bonusMp: 1000 });
  p.recompute();
  const g = secondJobGuide();
  near(p, g);
  let d = await pick(c, g, 'second:beastkin');
  assert.deepEqual(keys(d), ['second:beastkin:mammal', 'second:beastkin:bird', 'second:beastkin:reptile', 'second']);
  d = await pick(c, g, 'second:beastkin:bird');
  assert.match(d.text, /조류 계통의 수인이\(가\) 되겠는가/);
  assert.ok(keys(d).includes('second:beastkin:bird:yes'));
  const mark = c.mark;
  await pick(c, g, 'second:beastkin:bird:yes');
  const s = await c.self((x) => x.classId === 'beastkin', mark);
  assert.equal(s.beastType, 'bird');
  d = await talk(c, g);
  assert.ok(!keys(d).includes('beast'), '계통이 있으면 고르기 없음');
  d = await pick(c, g, 'beast:mammal:yes');
  assert.match(d.text, /이미 조류 계통이다/);
  assert.equal(p.data.beastType, 'bird');
  // 계통이 없는 옛 수인
  p.data.beastType = null;
  d = await talk(c, g);
  assert.ok(keys(d).includes('beast'));
  d = await pick(c, g, 'beast');
  assert.deepEqual(keys(d), ['beast:mammal', 'beast:bird', 'beast:reptile', 'back']);
  d = await pick(c, g, 'beast:reptile');
  assert.ok(keys(d).includes('beast:reptile:yes'));
  await pick(c, g, 'beast:reptile:yes');
  assert.equal(p.data.beastType, 'reptile');
  c.close();
});

test('배우기: 길드장은 스킬트리 조건(선수과목 숙련도·재료·골드)으로 가르치고, 2차 직업 스승은 어빌로 가르친다', async () => {
  const { c, p } = await join('배움이');
  // 회오리 베기: 늑대 가죽 3개 + 강타 숙련도 30
  const before = structuredClone(data().skillTrees);
  const trees = structuredClone(before);
  const whirl = trees.trees.warrior.nodes.find((n) => n.ability === 'w_whirl')!;
  whirl.items = [{ item: 'mat_wolf_pelt', qty: 3 }];
  whirl.requires = [{ ability: 'w_strike', prof: 30 }];
  assert.deepEqual(data().applyDesign({ skillTrees: trees }).filter((i) => i.level === 'error'), []);
  try {
    become(p, 'warrior', 12, { w_strike: 29 });
    p.data.gold = 1000;
    assert.ok(world().admin.giveItem('테스트', p.name, 'mat_wolf_pelt', 3).ok);
    const master = npcEntity('warrior_master');
    near(p, master);
    await talk(c, master);
    let mark = c.mark;
    c.send({ t: 'learnAbility', npc: master.id, id: 'w_whirl' });
    await c.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('선수과목이 필요합니다: 강타 숙련도 30 이상'), mark);
    assert.ok(!p.data.skills.includes('w_whirl'));
    p.data.prof.w_strike = 30;
    mark = c.mark;
    c.send({ t: 'learnAbility', npc: master.id, id: 'w_whirl' });
    const learn = await c.waitFor('learn', () => true, mark);
    assert.equal(learn.list.find((e) => e.id === 'w_whirl')!.learned, true);
    assert.ok(p.data.skills.includes('w_whirl'));
    assert.equal(p.data.prof.w_whirl, 0);
    assert.equal(p.data.gold, 200);
    assert.equal(p.data.inventory.filter((s) => s?.item === 'mat_wolf_pelt').length, 0, '재료를 씀');
    await c.waitFor('chat', (m) => m.ch === 'system' && m.text.includes('800 골드, 늑대 가죽 3개를 냈습니다'), mark);
    // 다른 직업의 트리는 그 길드장도 가르치지 않음 (지금 직업만)
    const rogueMaster = npcEntity('rogue_master');
    near(p, rogueMaster);
    mark = c.mark;
    c.send({ t: 'learnAbility', npc: rogueMaster.id, id: 'r_stab' });
    await c.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('지금 직업의 기술만'), mark);
    // 2차 직업 기술은 레벨이 아니라 어빌로 (첫 기술의 선수과목인 1차 직업 기술은 승급한 사람이면 배워 둔 것)
    const firstReqs = Object.fromEntries((data().nodeOf('a_aimed')?.node.requires ?? []).map((r) => [r.ability, r.prof]));
    become(p, 'archer', 99, firstReqs);
    p.data.gold = 1000;
    const archerMaster = npcEntity('archer_master');
    near(p, archerMaster);
    let d = await talk(c, archerMaster);
    assert.ok(keys(d).includes('learn:archer'));
    mark = c.mark;
    c.send({ t: 'learnAbility', npc: archerMaster.id, id: 'a_aimed' });
    await c.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('어빌 5 이상'), mark);
    p.data.abilityLevel = 5;
    mark = c.mark;
    c.send({ t: 'learnAbility', npc: archerMaster.id, id: 'a_aimed' });
    await c.waitFor('learn', () => true, mark);
    assert.ok(p.data.skills.includes('a_aimed'));
    d = await talk(c, archerMaster);
    assert.ok(!keys(d).some((k) => k.startsWith('class:')), '2차 직업 스승은 직업 선택이 없음');
  } finally {
    assert.deepEqual(data().applyDesign({ skillTrees: before }).filter((i) => i.level === 'error'), []);
  }
  c.close();
});

// ───────────────────────── 운영자 도구 ─────────────────────────

/** 운영자 명령을 보내고 그 답(시스템 또는 오류 채팅)을 기다립니다 */
async function gmSays(line: string): Promise<Msg<'chat'>> {
  const mark = gm.mark;
  gm.send({ t: 'chat', text: line });
  return gm.waitFor('chat', (m) => m.ch === 'system' || m.ch === 'error', mark);
}

test('운영자 도구: /어빌 /숙련도 /승급 /전직횟수 /계통 /정보, 만렙 세팅은 숙련도와 2차 직업의 어빌까지 최대로', async () => {
  // 앞 시험에서 만든 캐릭터들 (접속을 끊었으므로 저장 파일을 바로 고침)
  const archer = () => world().store.get('이차궁사')!;
  let r = await gmSays('/어빌 @이차궁사 30');
  assert.equal(r.ch, 'system', r.text);
  assert.equal(archer().abilityLevel, 30);
  assert.equal(archer().abilityExp, 0);
  r = await gmSays('/어빌 @전직대기 5');
  assert.equal(r.ch, 'error');
  assert.match(r.text, /2차 직업이 아니라 어빌이 없습니다/);
  r = await gmSays('/어빌 @이차궁사 100');
  assert.equal(r.ch, 'error', '어빌 최대(99)를 넘을 수 없음');

  r = await gmSays('/숙련도 @이차궁사 급소 찌르기 40');
  assert.equal(r.ch, 'system', r.text);
  assert.equal(archer().prof.r_stab, 40);
  r = await gmSays('/숙련도 @이차궁사 강타 10');
  assert.equal(r.ch, 'error');
  assert.match(r.text, /배우지 않았습니다/);
  r = await gmSays('/숙련도 @이차궁사 급소 찌르기 101');
  assert.equal(r.ch, 'error');
  r = await gmSays('/숙련도 @이차궁사 전부 0');
  assert.ok(Object.values(archer().prof).every((v) => v === 0));
  r = await gmSays('/숙련도 @이차궁사 전부');
  assert.match(r.text, /숙련도를 100\(으\)로/);
  assert.ok(Object.values(archer().prof).every((v) => v === 100));

  r = await gmSays('/승급 @이차궁사 끄기');
  assert.equal(archer().ascended, false);
  r = await gmSays('/승급 @이차궁사');
  assert.equal(archer().ascended, true, '켜기/끄기를 빼면 뒤집음');
  assert.match(r.text, /마스터/);
  r = await gmSays('/전직횟수 @이차궁사 3');
  assert.equal(archer().rebirths, 3);

  r = await gmSays('/계통 @이차수인 포유류');
  assert.equal(r.ch, 'system', r.text);
  assert.equal(world().store.get('이차수인')!.beastType, 'mammal');
  r = await gmSays('/계통 @이차수인 없음');
  assert.equal(world().store.get('이차수인')!.beastType, null);
  r = await gmSays('/계통 @이차궁사 조류');
  assert.equal(r.ch, 'error');

  r = await gmSays('/정보 이차궁사');
  assert.match(r.text, /궁사 99레벨 \(전직 3번 · 마스터 · 어빌 30\)/);

  // 만렙 세팅: 2차 직업이면 어빌 99, 배운 기술·마법은 모두 숙련도 100
  r = await gmSays('/만렙 @배움이');
  assert.equal(r.ch, 'system', r.text);
  const d = world().store.get('배움이')!;
  assert.equal(d.classId, 'archer');
  assert.equal(d.level, world().config.maxLevel);
  assert.equal(d.abilityLevel, data().progression.ability.maxLevel);
  assert.ok(d.skills.length > 5);
  for (const id of [...d.skills, ...d.spells]) assert.equal(d.prof[id], 100, id);
  // 산 체력·마나는 음수도 설정할 수 있음 (팔거나 바친 캐릭터를 고칠 때)
  r = await gmSays('/보너스 @배움이 -150 0');
  assert.equal(r.ch, 'system', r.text);
  assert.equal(d.bonusHp, -150);
});
