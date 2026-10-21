// 성장 체계 엔진을 실제 서버로 확인합니다: 숙련도에 따른 위력·상태 이상 확률과 숙련도 오르기, 몬스터 처치의 어빌 경험치,
// 전직 전 직업의 기술 쓰기(자동사냥 포함). 서버는 IP 당 캐릭터를 10개까지 만들 수 있어 캐릭터를 아껴 씁니다.
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
import type { MapInstance } from '../src/server/world/MapInstance';
import { Monster } from '../src/server/world/Monster';
import type { Player } from '../src/server/world/Player';
import { Client, create, sleep, testConfig, until } from './helpers';

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
