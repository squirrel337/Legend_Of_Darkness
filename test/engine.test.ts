// 새 직업용 전투 엔진: 원거리 평타, 그룹 대상, 연타/흡혈, 새 상태 효과, 신속, 소환수 (실제 서버로 확인)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ASSAIL_COOLDOWN_MS, type ClassId } from '../src/shared/constants';
import { startServer, type RunningServer } from '../src/server/app';
import { applyDamage, applyStatus, physicalAttack, playerAssail, playerUseAbility, removeStatus, tickStatuses } from '../src/server/systems/combat';
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
const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-engine-'));
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
  return { c, p: world().findPlayer(name)! };
}

/** 직업/레벨을 정하고 기술을 배우고 시작 장비를 바로 착용시킵니다 */
function become(p: Player, cls: ClassId, level: number, learn: string[] = []): void {
  const a = world().admin;
  assert.ok(a.setClass('테스트', p.name, cls).ok);
  assert.ok(a.setLevel('테스트', p.name, level).ok);
  for (const id of learn) assert.ok(a.learnAbility('테스트', p.name, id).ok, id);
  for (const id of data().classes.get(cls)!.starterItems ?? []) {
    const it = data().items.get(id)!;
    p.data.equipment[it.slot!] = id;
  }
  p.recompute();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
}

/** 정해진 칸에 몬스터를 놓습니다. 기본으로 움직이지도 반격하지도 않게 묶어 둡니다 */
function spawn(map: MapInstance, id: string, x: number, y: number, frozen = true): Monster {
  assert.ok(map.isFree(x, y), `(${x},${y}) 칸이 비어 있어야 함`);
  const m = new Monster(world().allocId(), data().monsters.get(id)!);
  m.x = x;
  m.y = y;
  m.homeX = x;
  m.homeY = y;
  if (frozen) {
    m.nextMoveAt = Date.now() + 600_000;
    m.nextAttackAt = Date.now() + 600_000;
  }
  map.add(m);
  return m;
}

function despawn(...ms: Monster[]): void {
  for (const m of ms) {
    m.dead = true;
    m.map?.remove(m);
  }
}

/** 이 안에서만 Math.random 을 고정합니다 (명중/치명타 판정을 정해 두기 위해) */
function withRandom<T>(v: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => v;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

function place(p: Player, map: MapInstance, x: number, y: number, dir: 0 | 1 | 2 | 3 = 2): void {
  if (!(p.map === map && p.x === x && p.y === y)) world().transfer(p, map, x, y);
  assert.equal(p.map, map);
  p.dir = dir;
}

/** 명중하고 치명타는 아닌 난수 */
const HIT = 0.1;

const dmgCount = (c: Client, since: number, id: number) =>
  c.msgs.slice(since).filter((m) => m.t === 'dmg' && m.id === id && m.k !== 'heal' && m.k !== 'mp').length;

let archer: { c: Client; p: Player };

test('활: 4칸 떨어진 몬스터를 노려 쏘고, 사거리 밖이나 마을에서는 아무 일도 없다', async () => {
  archer = await join('궁수');
  const { c, p } = archer;
  become(p, 'archer', 20);
  const range = p.derived.range;
  assert.ok(range > 1, '활은 원거리 무기');
  const tr = training();
  place(p, tr, 2, 12, 2); // 남쪽을 보고 있음
  const rat = spawn(tr, 'rat', 2 + Math.min(4, range), 12);
  const hp0 = rat.hp;
  let mark = c.mark;
  c.send({ t: 'attack', target: rat.id });
  await c.waitFor('fx', (m) => m.fx === 'arrow' && m.id === rat.id && m.from === p.id, mark);
  await c.waitFor('dmg', (m) => m.id === rat.id, mark);
  assert.equal(p.dir, 1, '쏠 때 대상 쪽(동쪽)으로 돌아섬');
  await c.waitFor('act', (m) => m.id === p.id && m.a === 'attack', mark);
  // 명중을 고정하면 반드시 피해
  p.nextAssailAt = 0;
  withRandom(HIT, () => playerAssail(world(), p, rat.id));
  assert.ok(rat.dead || rat.hp < hp0, '화살이 맞음');
  despawn(rat);

  // 사거리 밖의 대상은 맞지 않음 (다른 적이 사거리 안에 있으면 그쪽을 쏠 수는 있음)
  const far = spawn(tr, 'rat', 2 + range + 2, 12);
  const farHp = far.hp;
  p.nextAssailAt = 0;
  mark = c.mark;
  playerAssail(world(), p, far.id);
  await c.waitFor('act', (m) => m.id === p.id, mark);
  await sleep(50);
  assert.equal(far.hp, farHp);
  assert.ok(!c.msgs.slice(mark).some((m) => m.t === 'fx' && m.id === far.id));
  despawn(far);

  // 마을: 쏘는 동작만 하고 피해는 없음
  const town = world().town;
  place(p, town, town.def.spawn.x, town.def.spawn.y);
  const spot = town.findFreeNear(p.x + 3, p.y)!;
  const tRat = spawn(town, 'rat', spot.x, spot.y);
  p.nextAssailAt = 0;
  mark = c.mark;
  c.send({ t: 'attack', target: tRat.id });
  await c.waitFor('act', (m) => m.id === p.id && m.a === 'attack', mark);
  await sleep(80);
  assert.equal(tRat.hp, tRat.maxHp);
  assert.ok(!c.msgs.slice(mark).some((m) => (m.t === 'fx' && m.fx === 'arrow') || (m.t === 'dmg' && m.id === tRat.id)));
  assert.ok(!c.msgs.slice(mark).some((m) => m.t === 'chat' && m.ch === 'error'), '오류 메시지를 쏟아내지 않음');
  despawn(tRat);
  place(p, training(), 2, 14);
});

test('그룹 노래: 자신과 근처 그룹원에게만 걸린다', async () => {
  const bard = await join('바드');
  const mate = await join('동료');
  become(bard.p, 'bard', 10, ['b_valor']);
  const tr = training();
  place(bard.p, tr, 4, 11);
  place(mate.p, tr, 7, 11);
  place(archer.p, tr, 6, 9); // 가깝지만 그룹이 아님
  const g = world().groups;
  g.invite(bard.p, mate.p.name);
  g.reply(mate.p, true);
  assert.ok(g.sameGroup(bard.p.name, mate.p.name));
  const status = data().abilities.get('b_valor')!.effects.find((e) => e.type === 'status')!;
  assert.equal(status.type, 'status');
  const mark = mate.c.mark;
  playerUseAbility(world(), bard.p, 'b_valor', undefined);
  if (status.type !== 'status') return;
  assert.ok(bard.p.hasStatus(status.status), '시전자');
  assert.ok(mate.p.hasStatus(status.status), '그룹원');
  assert.ok(!archer.p.hasStatus(status.status), '그룹이 아닌 사람');
  await mate.c.waitFor('statuses', (m) => m.id === mate.p.id && m.statuses.includes(status.status), mark);
  removeStatus(bard.p, status.status);
  removeStatus(mate.p, status.status);
  bard.c.close();
  mate.c.close();
});

test('쌍검 베기는 두 번 치고, 할퀴기는 준 피해만큼 체력을 회복한다', async () => {
  const glad = await join('검투사');
  become(glad.p, 'gladiator', 30, ['g_twin']);
  const tr = training();
  place(glad.p, tr, 4, 13, 1);
  const dummy = spawn(tr, 'dummy', 5, 13);
  let mark = glad.c.mark;
  const hp0 = dummy.hp;
  withRandom(HIT, () => playerUseAbility(world(), glad.p, 'g_twin', undefined));
  await glad.c.waitFor('dmg', (m) => m.id === dummy.id, mark);
  await sleep(60);
  assert.equal(dmgCount(glad.c, mark, dummy.id), 2, '두 번 맞음');
  assert.ok(dummy.hp < hp0);
  despawn(dummy);
  place(glad.p, tr, 18, 14);

  const beast = await join('수인');
  become(beast.p, 'beastkin', 30, ['k_rend']);
  place(beast.p, tr, 4, 13, 1);
  const d2 = spawn(tr, 'dummy', 5, 13);
  beast.p.hp = Math.floor(beast.p.maxHp / 2);
  const before = beast.p.hp;
  mark = beast.c.mark;
  withRandom(HIT, () => playerUseAbility(world(), beast.p, 'k_rend', undefined));
  assert.ok(d2.hp < d2.maxHp, '피해를 줌');
  assert.ok(beast.p.hp > before, `흡혈로 회복 (${before} → ${beast.p.hp})`);
  await beast.c.waitFor('dmg', (m) => m.id === beast.p.id && m.k === 'heal' && m.v > 0, mark);
  despawn(d2);
  glad.c.close();
  beast.c.close();
});

test('출혈은 매초 체력을 깎지만 죽이지 않고, 표식은 받는 피해를, 야수화는 받는 피해를 줄인다', async () => {
  const tr = training();
  const { c, p } = archer;
  const rat = spawn(tr, 'rat', 12, 13);
  assert.ok(applyStatus(rat, 'bleed', 5000, 500, p));
  const mark = c.mark;
  const now = Date.now();
  tickStatuses(rat, now + 1100);
  assert.equal(rat.hp, 1, '출혈로는 죽지 않음 (체력 1)');
  assert.ok(!rat.dead);
  await c.waitFor('dmg', (m) => m.id === rat.id && m.k === 'dot', mark);
  tickStatuses(rat, now + 2200);
  assert.equal(rat.hp, 1);
  despawn(rat);

  const d = spawn(tr, 'dummy', 14, 13);
  let hp = d.hp;
  applyDamage(world(), null, d, 100, 'phys');
  assert.equal(hp - d.hp, 100);
  applyStatus(d, 'mark', 5000, 50, p);
  hp = d.hp;
  applyDamage(world(), null, d, 100, 'phys');
  assert.equal(hp - d.hp, 150, '표식 50%');
  removeStatus(d, 'mark');
  applyStatus(d, 'beast', 5000, 30, d);
  hp = d.hp;
  applyDamage(world(), null, d, 100, 'phys');
  assert.equal(hp - d.hp, 90, '야수화는 받는 피해 10% 감소');
  despawn(d);
});

test('회피 100%면 물리 공격이 모두 빗나가고, 야수화는 주는 물리 피해를 늘린다', () => {
  const tr = training();
  const { p } = archer;
  const d = spawn(tr, 'dummy', 14, 13);
  applyStatus(d, 'evade', 5000, 100, d);
  const hp0 = d.hp;
  for (let i = 0; i < 30; i++) assert.equal(physicalAttack(world(), p, d, { mult: 1, element: 'none' }), 0);
  assert.equal(d.hp, hp0);
  removeStatus(d, 'evade');
  // 같은 난수로 비교: 야수화 30% → 피해가 늘어남
  const plain = withRandom(HIT, () => physicalAttack(world(), p, d, { mult: 1, element: 'none' }));
  applyStatus(p, 'beast', 5000, 30, p);
  const boosted = withRandom(HIT, () => physicalAttack(world(), p, d, { mult: 1, element: 'none' }));
  removeStatus(p, 'beast');
  assert.ok(plain > 0 && boosted > plain, `${plain} → ${boosted}`);
  despawn(d);
});

test('신속은 평타와 기술의 재사용 대기를 줄인다 (최소 절반)', async () => {
  const { c, p } = archer;
  const tr = training();
  place(p, tr, 2, 14);
  let now = Date.now();
  // 평타 간격은 'assail' 재사용 대기 메시지로도 알려 줌 (클라이언트가 연타 간격을 맞춤)
  const assailMs = async (ms: number, since: number) => (await c.waitFor('cooldown', (m) => m.id === 'assail', since)).ms === ms;
  p.nextAssailAt = 0;
  let mark = c.mark;
  playerAssail(world(), p, undefined, now);
  assert.equal(p.nextAssailAt - now, ASSAIL_COOLDOWN_MS);
  assert.ok(await assailMs(ASSAIL_COOLDOWN_MS, mark));
  applyStatus(p, 'haste', 10_000, 40, p);
  now += 5000;
  mark = c.mark;
  playerAssail(world(), p, undefined, now);
  assert.equal(p.nextAssailAt - now, Math.round(ASSAIL_COOLDOWN_MS * 0.6));
  assert.ok(await assailMs(Math.round(ASSAIL_COOLDOWN_MS * 0.6), mark), '신속이면 줄어든 간격을 보냄');
  removeStatus(p, 'haste');
  applyStatus(p, 'haste', 10_000, 90, p);
  now += 5000;
  mark = c.mark;
  playerAssail(world(), p, undefined, now);
  assert.equal(p.nextAssailAt - now, Math.round(ASSAIL_COOLDOWN_MS * 0.5), '최소 0.5배');
  assert.ok(await assailMs(Math.round(ASSAIL_COOLDOWN_MS * 0.5), mark));
  // 재사용 대기 중이라 무시된 평타는 메시지를 보내지 않음
  mark = c.mark;
  playerAssail(world(), p, undefined, now + 10);
  await sleep(50);
  assert.ok(!c.msgs.slice(mark).some((m) => m.t === 'cooldown' && m.id === 'assail'));

  // 기술: 재사용 대기 메시지도 줄어든 값
  become(p, 'archer', 20, ['a_aimed']);
  const def = data().abilities.get('a_aimed')!;
  const rat = spawn(tr, 'rat', 5, 14);
  p.gcdUntil = 0;
  mark = c.mark;
  playerUseAbility(world(), p, 'a_aimed', rat.id);
  const cd = await c.waitFor('cooldown', (m) => m.id === 'a_aimed', mark);
  assert.equal(cd.ms, Math.round(def.cooldownMs * 0.5));
  assert.ok(p.gcdUntil - Date.now() <= 250 * 0.5 + 5);
  removeStatus(p, 'haste');
  despawn(rat);
});

let summoner: { c: Client; p: Player };
const foxesOf = (p: Player) => [...p.summons];

test('소환: 마을에서는 거절되고 (마나/재사용 대기 소모 없음), 사냥터에서는 주인이 있는 소환수가 나온다', async () => {
  summoner = await join('소환사');
  const { c, p } = summoner;
  become(p, 'summoner', 30, ['s_fox']);
  const town = world().town;
  place(p, town, town.def.spawn.x, town.def.spawn.y);
  const mp = p.mp;
  let mark = c.mark;
  c.send({ t: 'ability', id: 's_fox' });
  const err = await c.waitFor('chat', (m) => m.ch === 'error', mark);
  assert.match(err.text, /마을에서는 소환할 수 없습니다/);
  assert.equal(p.mp, mp);
  assert.ok(!p.cooldowns.has('s_fox'));
  assert.equal(p.summons.size, 0);

  const tr = training();
  place(p, tr, 10, 12);
  mark = c.mark;
  c.send({ t: 'ability', id: 's_fox' });
  const add = await c.waitFor('add', (m) => m.e.type === 'monster' && m.e.def === 'spirit_fox', mark);
  assert.equal(add.e.type, 'monster');
  if (add.e.type !== 'monster') return;
  assert.equal(add.e.ownerId, p.id);
  assert.equal(add.e.ownerName, p.name);
  assert.equal(add.e.level, p.level, '소환자 레벨에 맞춤');
  await c.waitFor('fx', (m) => m.fx === 'summon' && m.id === add.e.id, mark);
  assert.equal(p.summons.size, 1);
  const fox = foxesOf(p)[0]!;
  assert.equal(fox.owner, p);
  assert.ok(fox.expireAt > Date.now());
  assert.ok(chebyshev(fox, p) <= 2);

  // 최대 수(1)를 넘으면 오래된 소환수가 돌아감. 사냥터에서는 마나를 씀
  p.cooldowns.delete('s_fox');
  p.gcdUntil = 0;
  p.mp = p.maxMp;
  playerUseAbility(world(), p, 's_fox', undefined);
  assert.equal(p.mp, p.maxMp - data().abilities.get('s_fox')!.mp);
  assert.ok(p.cooldowns.has('s_fox'));
  assert.equal(p.summons.size, 1);
  assert.notEqual(foxesOf(p)[0], fox);
  assert.ok(!tr.monsters.has(fox));
});

test('소환수는 같은 편이라 주인도 다른 플레이어도 때릴 수 없다', () => {
  const { p } = summoner;
  const fox = foxesOf(p)[0]!;
  const tr = training();
  // 같은 동기 구간 안에서 주인을 소환수 옆에 세우고 바로 공격 (그사이 AI 가 움직이지 않음)
  const sides: [number, number, 0 | 1 | 2 | 3][] = [
    [-1, 0, 1],
    [1, 0, 3],
    [0, -1, 2],
    [0, 1, 0],
  ];
  const side = sides.find(([dx, dy]) => tr.isFree(fox.x + dx, fox.y + dy) || (p.x === fox.x + dx && p.y === fox.y + dy))!;
  tr.move(p, fox.x + side[0], fox.y + side[1]);
  p.dir = side[2];
  const hp = fox.hp;
  p.nextAssailAt = 0;
  withRandom(HIT, () => playerAssail(world(), p, undefined));
  assert.equal(fox.hp, hp, '주인의 평타');
  const a = archer.p;
  const near = tr.findFreeNear(fox.x - 2, fox.y + 2)!;
  place(a, tr, near.x, near.y);
  a.nextAssailAt = 0;
  withRandom(HIT, () => playerAssail(world(), a, fox.id));
  assert.equal(fox.hp, hp, '다른 플레이어의 화살');
  a.gcdUntil = 0;
  a.cooldowns.clear();
  withRandom(HIT, () => playerUseAbility(world(), a, 'a_aimed', fox.id));
  assert.equal(fox.hp, hp, '다른 플레이어의 기술');
  place(a, world().town, world().town.def.spawn.x, world().town.def.spawn.y);
});

test('소환수는 근처 몬스터를 잡고, 경험치는 주인이 받는다', async () => {
  const { c, p } = summoner;
  const tr = training();
  const fox = foxesOf(p)[0]!;
  const spot = tr.findFreeNear(p.x - 3, p.y)!;
  const rat = spawn(tr, 'rat', spot.x, spot.y);
  const kills = p.data.kills;
  const mark = c.mark;
  await until(() => rat.dead, 8000);
  assert.equal(p.data.kills, kills + 1, '주인의 처치 수');
  const gain = await c.waitFor('gain', (m) => m.exp > 0, mark);
  assert.ok(gain.exp > 0);
  assert.ok(c.msgs.slice(mark).some((m) => m.t === 'act' && m.id === fox.id && m.a === 'attack'), '소환수가 공격함');
});

test('주인을 노리던 몬스터도 소환수에게 맞으면 소환수를 노리고, 소환수가 싸우는 동안 주인도 전투 중이다', () => {
  const { p } = summoner;
  const tr = training();
  const fox = foxesOf(p)[0]!;
  const spot = tr.findFreeNear(fox.x + 2, fox.y)!;
  const rat = spawn(tr, 'rat', spot.x, spot.y);
  const tiny = { mult: 0.001, element: 'none' as const }; // 1씩만 깎아 쓰러지지 않게
  const inCombat = () => Date.now() - p.lastCombatAt < 1000;
  // 소환수가 때리면: 주인을 노리던 몬스터가 소환수로 돌아섬 (피해는 주인 몫)
  rat.target = p;
  p.lastCombatAt = 0;
  assert.ok(withRandom(HIT, () => physicalAttack(world(), fox, rat, tiny)) > 0);
  assert.equal(rat.target?.id, fox.id, '소환수로 대상을 바꿈');
  assert.ok((rat.damageBy.get(p.name) ?? 0) > 0, '피해는 주인 몫');
  assert.ok(inCombat(), '소환수가 때리면 주인도 전투 중');
  // 빗나가도 마찬가지
  rat.target = p;
  p.lastCombatAt = 0;
  assert.equal(withRandom(0.999, () => physicalAttack(world(), fox, rat, tiny)), 0);
  assert.equal(rat.target?.id, fox.id, '빗나가도 소환수를 노림');
  assert.ok(inCombat(), '빗나가도 전투 중');
  // 소환수와 싸우는 몬스터는 주인이 때려도 소환수를 계속 노림
  withRandom(HIT, () => physicalAttack(world(), p, rat, tiny));
  assert.equal(rat.target?.id, fox.id, '주인이 때려도 그대로');
  // 소환수가 맞아도 주인은 전투 중
  p.lastCombatAt = 0;
  const foxHp = fox.hp;
  applyDamage(world(), rat, fox, 1, 'phys');
  assert.ok(inCombat(), '소환수가 맞아도 주인은 전투 중');
  fox.hp = foxHp;
  despawn(rat);
});

test('소환수는 주인을 노리는 몬스터에게 덤벼 자기 쪽으로 끌어온다', async () => {
  const { p } = summoner;
  const tr = training();
  const fox = foxesOf(p)[0]!;
  // 튼튼하고 묶여 있는 몬스터가 주인을 노리는 중
  const spot = tr.findFreeNear(p.x + 2, p.y)!;
  const knight = spawn(tr, 'crypt_knight', spot.x, spot.y);
  knight.target = p;
  knight.chaseSince = Date.now();
  await until(() => knight.target === fox, 8000);
  await sleep(300);
  assert.equal(knight.target?.id, fox.id, '주인에게 되돌아가지 않음');
  assert.ok(!knight.dead);
  despawn(knight);
});

test('야생 몬스터는 소환수를 노리고, 쓰러진 소환수는 보상 없이 사라진다', async () => {
  const { c, p } = summoner;
  const tr = training();
  const fox = foxesOf(p)[0]!;
  // 주인은 무적이라 몬스터가 노리지 않음 → 소환수를 노려야 함. 소환수는 마비시켜 반격하지 않게
  p.data.godMode = true;
  applyStatus(fox, 'paralyze', 10_000, 0, null);
  const spot = tr.findFreeNear(fox.x + 2, fox.y)!;
  let mark = c.mark;
  const dog = spawn(tr, 'wild_dog', spot.x, spot.y, false);
  await until(() => dog.target === fox, 4000);
  // 다가가서 소환수를 공격 (빗나갈 수도 있으니 공격 동작과 피해 판정 메시지로 확인)
  await c.waitFor('act', (m) => m.id === dog.id && m.a === 'attack', mark, 8000);
  await c.waitFor('dmg', (m) => m.id === fox.id, mark);
  despawn(dog);
  removeStatus(fox, 'paralyze');

  const exp = p.data.exp;
  const kills = p.data.kills;
  mark = c.mark;
  applyDamage(world(), null, fox, 1e9, 'phys');
  assert.ok(fox.dead);
  assert.ok(!tr.monsters.has(fox));
  assert.equal(p.summons.size, 0);
  assert.equal(p.data.exp, exp);
  assert.equal(p.data.kills, kills);
  await c.waitFor('chat', (m) => m.ch === 'system' && m.text.includes('쓰러졌습니다'), mark);
  assert.equal(tr.itemsAt(fox.x, fox.y).length, 0, '전리품 없음');
});

async function summonFox(): Promise<Monster> {
  const { p } = summoner;
  p.cooldowns.delete('s_fox');
  p.gcdUntil = 0;
  p.mp = p.maxMp;
  playerUseAbility(world(), p, 's_fox', undefined);
  assert.equal(p.summons.size, 1);
  return foxesOf(p)[0]!;
}

test('소환수는 시간이 다 되면 돌아간다', async () => {
  const { c, p } = summoner;
  const fox = await summonFox();
  const mark = c.mark;
  fox.expireAt = Date.now() - 1;
  await until(() => !training().monsters.has(fox));
  assert.equal(p.summons.size, 0);
  await c.waitFor('chat', (m) => m.text.includes('돌아갔습니다'), mark);
});

test('소환수는 주인을 따라다니고, 다른 맵까지 따라가며, 마을에 가면 돌아간다', async () => {
  const { c, p } = summoner;
  const tr = training();
  place(p, tr, 2, 12);
  const fox = await summonFox();
  // 아주 멀어지면(15칸 넘게) 주인 곁으로 순간이동 (걸어서는 1초 안에 못 옴)
  let mark = c.mark;
  place(p, tr, 19, 12);
  assert.ok(chebyshev(fox, p) > 15);
  await until(() => chebyshev(fox, p) <= 6, 1000);
  await c.waitFor('jump', (m) => m.id === fox.id, mark);
  // 조금 떨어지면 걸어서 따라옴
  place(p, tr, 14, 12);
  await until(() => chebyshev(fox, p) <= 2, 5000);
  // 다른 맵: 함께 이동
  const forest = world().maps.get('forest')!;
  place(p, forest, forest.def.spawn.x + 4, forest.def.spawn.y);
  assert.equal(fox.map, forest);
  assert.ok(forest.monsters.has(fox) && !tr.monsters.has(fox));
  assert.ok(chebyshev(fox, p) <= 6);
  assert.equal(fox.owner, p);
  // 마을: 돌려보냄
  mark = c.mark;
  place(p, world().town, world().town.def.spawn.x, world().town.def.spawn.y);
  assert.equal(p.summons.size, 0);
  assert.ok(!forest.monsters.has(fox));
  await c.waitFor('chat', (m) => m.ch === 'system' && m.text.includes('소환수'), mark);
});

test('운영자: 소환수는 /몬스터 로 부를 수 없고, /몬스터제거 는 소환수를 남긴다', async () => {
  const tr = training();
  const me = world().findPlayer('운영자')!;
  place(me, tr, 15, 12);
  let mark = gm.mark;
  await gm.chat('/몬스터 여우 정령');
  assert.match((await gm.waitFor('chat', (m) => m.ch === 'error', mark)).text, /소환수는 소환할 수 없습니다/);
  assert.equal(world().admin.spawnMonster(me, 'spirit_fox', 1).ok, false);
  assert.ok(![...tr.monsters].some((m) => m.def.id === 'spirit_fox' && !m.owner));

  const { p } = summoner;
  place(p, tr, 12, 12);
  const fox = await summonFox();
  mark = gm.mark;
  await gm.chat('/몬스터제거');
  await gm.waitFor('chat', (m) => m.ch === 'system' && m.text.includes('제거'), mark);
  assert.ok(tr.monsters.has(fox), '다른 사람의 소환수는 남음');
});

test('주인이 쓰러지거나 접속을 끊으면 소환수가 사라진다', async () => {
  const { c, p } = summoner;
  const tr = training();
  const fox = foxesOf(p)[0]!;
  assert.ok(tr.monsters.has(fox));
  p.data.godMode = false;
  applyDamage(world(), null, p, 1e9, 'phys');
  assert.ok(p.isDead);
  assert.equal(p.summons.size, 0);
  assert.ok(!tr.monsters.has(fox));
  assert.ok(world().admin.revive('테스트', p.name).ok);

  const fox2 = await summonFox();
  assert.ok(tr.monsters.has(fox2));
  c.close();
  await until(() => !world().findPlayer(p.name));
  assert.ok(!tr.monsters.has(fox2));
  assert.equal(p.summons.size, 0);
});
