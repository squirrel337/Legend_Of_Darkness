// 권한, 시도 횟수 제한, 악용 방지 등 보안 관련 동작을 실제 서버로 확인하는 통합 테스트
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MAX_STAT_POINTS } from '../src/shared/constants';
import { startServer, type RunningServer } from '../src/server/app';
import { nameKey } from '../src/server/storage';
import { applyDamage, applyStatus } from '../src/server/systems/combat';
import { dropToGround, MAX_PLAYER_DROPS } from '../src/server/systems/ground';
import { Client, create, httpJson, testConfig, until } from './helpers';

let dataDir = '';
let srv: RunningServer;
let token = '';
let leader: Client; // 둘째 (관리자)
let op: Client; // 운영자 (일반 → 2단계에서 ADMIN_CHARACTERS 로 관리자)
let gm: Client; // 일반 (GM)

const http = (pathname: string, body?: unknown) => httpJson(srv.port, pathname, body, token);
const action = (name: string, act: string, body: Record<string, unknown> = {}) =>
  http(`/api/admin/characters/${encodeURIComponent(name)}/${act}`, body);

async function join(name: string): Promise<Client> {
  const c = await Client.connect(srv.port);
  create(c, name);
  await c.waitFor('welcome');
  return c;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-sec-'));
  srv = await startServer(testConfig(dataDir));
});

after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('첫 캐릭터 관리자 권한은 한 번뿐: 그 캐릭터를 지워도 다음 사람은 관리자가 되지 않는다', async () => {
  const first = await join('첫째');
  assert.equal((await first.self()).role, 'admin');
  const login = await httpJson(srv.port, '/api/admin/login', { password: 'test-admin-pass' });
  token = login.json.token as string;
  const del = await action('첫째', 'delete');
  assert.equal(del.status, 200, String(del.json.msg));
  assert.equal(srv.world.store.has('첫째'), false);
  first.close();

  leader = await join('둘째');
  assert.equal((await leader.self()).role, 'player');
  op = await join('운영자');
  gm = await join('일반');
  assert.equal((await action('둘째', 'setRole', { role: 'admin' })).status, 200);
  assert.equal((await action('일반', 'setRole', { role: 'gm' })).status, 200);
  await leader.self((s) => s.role === 'admin');
  await gm.self((s) => s.role === 'gm');
});

test('GM 은 관리자나 다른 GM 에게 운영자 명령을 쓸 수 없다', async () => {
  const world = srv.world;
  let mark = gm.mark;
  await gm.chat('/레벨 @둘째 50');
  assert.match((await gm.waitFor('chat', (m) => m.ch === 'error', mark)).text, /같거나 높은 권한/);
  assert.equal(world.findPlayer('둘째')!.level, 1);
  mark = gm.mark;
  await gm.chat('/소환 @둘째');
  assert.match((await gm.waitFor('chat', (m) => m.ch === 'error', mark)).text, /같거나 높은 권한/);
  // 일반 플레이어에게는 쓸 수 있음
  const om = op.mark;
  await gm.chat('/레벨 @운영자 5');
  await op.self((s) => s.level === 5, om);
  // 관리자는 누구에게나
  const gmMark = gm.mark;
  await leader.chat('/레벨 @일반 7');
  await gm.self((s) => s.level === 7, gmMark);
});

test('관리자가 줄 수 있는 값에는 상한이 있다', () => {
  const a = srv.world.admin;
  const p = srv.world.findPlayer('운영자')!;
  assert.equal(a.addStatPoints('둘째', '운영자', 1e12).ok, false);
  assert.equal(a.setStat('둘째', '운영자', 'str', 1e12).ok, false);
  assert.equal(a.addExp('둘째', '운영자', 1e300).ok, false);
  const before = p.data.statPoints;
  assert.ok(a.addStatPoints('둘째', '운영자', MAX_STAT_POINTS).ok);
  assert.ok(a.addStatPoints('둘째', '운영자', MAX_STAT_POINTS).ok);
  assert.equal(p.data.statPoints, MAX_STAT_POINTS, '합계도 상한을 넘지 않음');
  assert.ok(a.autoStats('둘째', '운영자').ok);
  assert.ok(a.addStatPoints('둘째', '운영자', -MAX_STAT_POINTS).ok);
  assert.equal(p.data.statPoints, 0);
  assert.ok(before >= 0);
});

test('일반 플레이어는 명령어도 채팅 속도 제한을 받는다', async () => {
  const mark = op.mark;
  for (let i = 0; i < 8; i++) op.send({ t: 'chat', text: '/누구' });
  await op.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('너무 빠르게'), mark);
});

test('그룹 초대: 시간이 지났거나 초대한 사람이 그룹장이 아니게 되면 수락할 수 없다', async () => {
  const world = srv.world;
  const lp = world.findPlayer('둘째')!;
  const gp = world.findPlayer('일반')!;
  const target = world.findPlayer('운영자')!;
  let mark = op.mark;
  world.groups.invite(lp, '운영자');
  await op.waitFor('groupInvite', (m) => m.from === '둘째', mark);
  target.pendingInviteAt -= 61_000;
  op.send({ t: 'groupReply', accept: true });
  await op.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('만료'), mark);
  assert.equal(world.groups.groupOf('운영자'), undefined);

  // 일반이 운영자를 초대한 뒤, 일반이 둘째의 그룹에 들어감 → 예전 초대로 둘째의 그룹에 끼어들 수 없음
  mark = op.mark;
  world.groups.invite(gp, '운영자');
  world.groups.invite(lp, '일반');
  world.groups.reply(gp, true);
  assert.equal(world.groups.groupOf('일반'), world.groups.groupOf('둘째'));
  op.send({ t: 'groupReply', accept: true });
  await op.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('그룹장이 아니라서'), mark);
  assert.equal(world.groups.groupOf('운영자'), undefined);
  world.groups.leave(gp, true);
  assert.equal(world.groups.groupOf('둘째'), undefined, '두 명뿐이던 그룹은 해산');
});

test('유령은 상점을 쓸 수 없고, NPC 대화에서도 부활 외의 서비스가 보이지 않는다', async () => {
  const world = srv.world;
  const p = world.findPlayer('운영자')!;
  const town = world.maps.get('town')!;
  const store = [...town.npcs].find((n) => n.def.id === 'general_store')!;
  world.transfer(p, town, store.x + 2, store.y);
  let mark = op.mark;
  applyDamage(world, null, p, 10_000_000, 'phys');
  await op.self((s) => s.ghost, mark);
  const gold = p.data.gold;
  op.send({ t: 'buy', npc: store.id, item: 'pot_hp_1', qty: 1 });
  await op.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('유령'), mark);
  assert.equal(p.data.gold, gold);
  mark = op.mark;
  op.send({ t: 'talk', npc: store.id });
  const dlg = await op.waitFor('dialog', (m) => m.npc === store.id, mark);
  assert.ok(!dlg.options.some((o) => o.key.startsWith('shop') || o.key.startsWith('sell')), JSON.stringify(dlg.options));
  assert.ok(world.admin.revive('둘째', '운영자').ok);
  assert.equal(p.isDead, false);
});

test('유령이 된 사람은 처치 보상을 받지 않고, 살아서 마무리한 사람이 받는다', async () => {
  const world = srv.world;
  const killer = world.findPlayer('둘째')!;
  const ghost = world.findPlayer('운영자')!;
  const forest = world.maps.get('forest')!;
  const { x, y } = forest.def.spawn;
  world.transfer(killer, forest, x, y);
  world.transfer(ghost, forest, x, y);
  const known = new Set(forest.monsters);
  assert.ok(world.admin.spawnMonster(killer, '들쥐', 1).ok);
  const m = [...forest.monsters].find((mm) => !known.has(mm))!;
  m.addDamage(ghost, 1_000_000);
  applyDamage(world, null, ghost, 10_000_000, 'phys');
  assert.ok(ghost.isDead);
  const k0 = killer.data.kills;
  const g0 = ghost.data.kills;
  applyDamage(world, killer, m, 10_000_000, 'phys');
  assert.ok(m.dead);
  assert.equal(killer.data.kills, k0 + 1);
  assert.equal(ghost.data.kills, g0);
  assert.ok(world.admin.revive('둘째', '운영자').ok);
  const town = world.maps.get('town')!;
  world.transfer(killer, town, town.def.spawn.x, town.def.spawn.y);
  world.transfer(ghost, town, town.def.spawn.x, town.def.spawn.y);
});

test('바닥에 버려 둘 수 있는 물건 수에는 상한이 있다', async () => {
  const world = srv.world;
  const p = world.findPlayer('운영자')!;
  const map = p.map!;
  for (let i = 0; i < MAX_PLAYER_DROPS; i++) dropToGround(world, map, p.x, p.y, 'pot_hp_1', 1, null, nameKey(p.name));
  const slot = p.data.inventory.findIndex((s) => s?.item === 'pot_hp_1');
  assert.ok(slot >= 0);
  const qty = p.data.inventory[slot]!.qty;
  const mark = op.mark;
  op.send({ t: 'dropItem', slot, qty: 1 });
  await op.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('너무 많습니다'), mark);
  assert.equal(p.data.inventory[slot]!.qty, qty, '소지품에서 빠지지 않음');
  for (const it of [...map.items]) map.remove(it);
  // 치우고 나면 다시 버릴 수 있음
  op.send({ t: 'dropItem', slot, qty: 1 });
  await until(() => map.items.size === 1);
  assert.equal([...map.items][0]!.droppedBy, nameKey(p.name));
  for (const it of [...map.items]) map.remove(it);
});

test('비밀번호를 여러 번 틀린 캐릭터는 잠시 로그인할 수 없고, 다른 캐릭터는 영향받지 않는다', async () => {
  const world = srv.world;
  // 재접속 후에도 유지되어야 하는 재사용 대기시간/상태 효과 (2단계에서 확인)
  const p = world.findPlayer('운영자')!;
  p.cooldowns.set('first_aid', Date.now() + 10 * 60_000);
  assert.ok(applyStatus(p, 'might', 10 * 60_000, undefined, p));

  const c = await Client.connect(srv.port);
  for (let i = 0; i < 8; i++) {
    const mark = c.mark;
    c.send({ t: 'login', name: '운영자', password: `wrong-${i}` });
    assert.match((await c.waitFor('authFail', () => true, mark)).msg, /틀렸습니다/);
  }
  let mark = c.mark;
  c.send({ t: 'login', name: '운영자', password: 'pass1234' });
  assert.match((await c.waitFor('authFail', () => true, mark)).msg, /너무 많이 틀렸습니다/);
  assert.ok(world.findPlayer('운영자'), '원래 접속은 끊기지 않음');
  mark = c.mark;
  c.send({ t: 'login', name: '일반', password: 'pass1234' });
  assert.equal((await c.self(() => true, mark)).role, 'gm');
  c.close();
});

test('ADMIN_CHARACTERS: 서버를 켜기 전에 있던 캐릭터만 관리자가 되고, 그 이름으로 새로 만들 수는 없다', async () => {
  for (const c of [leader, op, gm]) c.close();
  await until(() => srv.world.players.size === 0);
  await srv.close();
  srv = await startServer(testConfig(dataDir, { ADMIN_CHARACTERS: '운영자,예약이름' }));

  const c = await Client.connect(srv.port);
  c.send({ t: 'login', name: '운영자', password: 'pass1234' });
  const s = await c.self();
  assert.equal(s.role, 'admin');
  // 재사용 대기시간과 상태 효과는 서버를 다시 켜도 유지
  const cd = await c.waitFor('cooldown', (m) => m.id === 'first_aid');
  assert.ok(cd.ms > 60_000, String(cd.ms));
  assert.ok(s.statuses.some((st) => st.id === 'might' && st.ms > 60_000));

  const n = await Client.connect(srv.port);
  create(n, '예약이름');
  assert.match((await n.waitFor('authFail')).msg, /예약된 이름/);
  const mark = n.mark;
  create(n, '셋째');
  assert.equal((await n.self(() => true, mark)).role, 'player', '캐릭터 파일이 있던 서버에서는 첫 캐릭터 관리자 권한이 없음');
  n.close();
  c.close();
});

test('로그인에 성공해도 IP 당 시도 횟수는 초기화되지 않는다', async () => {
  // 바로 앞 테스트에서 운영자로 1번 로그인함 → 9번 더 시도하면 이 IP 의 1분 허용량(10번)을 다 씀
  const c = await Client.connect(srv.port);
  for (let i = 0; i < 9; i++) {
    const mark = c.mark;
    c.send({ t: 'login', name: '없는사람', password: 'wrong-pass' });
    assert.match((await c.waitFor('authFail', () => true, mark)).msg, /틀렸습니다/);
  }
  const mark = c.mark;
  c.send({ t: 'login', name: '운영자', password: 'pass1234' });
  assert.match((await c.waitFor('authFail', () => true, mark)).msg, /너무 많습니다/);
  c.close();
});
