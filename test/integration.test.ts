// 실제 서버를 띄우고 WebSocket/HTTP 로 게임 흐름을 확인하는 통합 테스트
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { EntitySnapshot } from '../src/shared/protocol';
import { startServer, type RunningServer } from '../src/server/app';
import type { ServerConfig } from '../src/server/config';
import { applyDamage } from '../src/server/systems/combat';
import { ADMIN_PW, Client, create, httpJson, testConfig } from './helpers';

let dataDir = '';
let cfg: ServerConfig;
let srv: RunningServer;

const http = (pathname: string, body?: unknown, token?: string) => httpJson(srv.port, pathname, body, token);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-it-'));
  cfg = testConfig(dataDir);
  srv = await startServer(cfg);
});

after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let admin: Client;
let player: Client;

test('첫 캐릭터는 관리자, 그다음은 일반 권한', async () => {
  admin = await Client.connect(srv.port);
  create(admin, '관리자');
  await admin.waitFor('welcome');
  assert.equal((await admin.self()).role, 'admin');

  player = await Client.connect(srv.port);
  create(player, '모험가');
  await player.waitFor('welcome');
  const s = await player.self();
  assert.equal(s.role, 'player');
  assert.equal(s.level, 1);
  assert.equal(s.classId, 'peasant');
  assert.equal(s.equipment.weapon, 'w_common_1');
  const map = await player.waitFor('map');
  assert.equal(map.map.id, 'town');
  // 자기 자신의 스냅샷도 받아야 화면에 그릴 수 있음
  await player.waitFor('add', (m) => m.e.id === s.id);
});

test('잘못된 이름, 중복 이름, 틀린 비밀번호는 거부된다', async () => {
  const c = await Client.connect(srv.port);
  create(c, '1번');
  assert.match((await c.waitFor('authFail')).msg, /이름/);
  const m1 = c.mark;
  create(c, '모험가');
  assert.match((await c.waitFor('authFail', () => true, m1)).msg, /이미/);
  const m2 = c.mark;
  c.send({ t: 'login', name: '모험가', password: 'wrong-pass' });
  assert.match((await c.waitFor('authFail', () => true, m2)).msg, /비밀번호/);
  c.close();
});

test('이동: 정상 이동은 반영되고, 어긋난 좌표는 보정된다', async () => {
  const p = srv.world.findPlayer('모험가')!;
  const { x, y } = p;
  const mark = player.mark;
  player.send({ t: 'walk', dir: 0, x, y });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual([p.x, p.y], [x, y - 1]);
  assert.ok(!player.msgs.slice(mark).some((m) => m.t === 'pos'));
  player.send({ t: 'walk', dir: 0, x: 0, y: 0 });
  const pos = await player.waitFor('pos', () => true, mark);
  assert.deepEqual([pos.x, pos.y], [x, y - 1]);
});

test('체력 회복은 아무 입력이 없어도 클라이언트에 전달된다', async () => {
  const p = srv.world.findPlayer('모험가')!;
  const mark = player.mark;
  p.hp = 1;
  const v = await player.waitFor('vitals', (m) => m.hp > 1, mark, 3500);
  assert.ok(v.hp > 1 && v.hp <= v.maxHp);
});

test('일반 플레이어는 운영자 명령을 쓸 수 없다', async () => {
  const mark = player.mark;
  await player.chat('/레벨 99');
  const err = await player.waitFor('chat', (m) => m.ch === 'error', mark);
  assert.match(err.text, /알 수 없는 명령어/);
  assert.equal(srv.world.findPlayer('모험가')!.level, 1);
});

test('운영자 명령으로 다른 캐릭터를 성장시킨다', async () => {
  const mark = player.mark;
  await admin.chat('/레벨 모험가 30');
  const s = await player.self((x) => x.level === 30, mark);
  assert.equal(s.statPoints, 29 * cfg.statPointsPerLevel);
  await admin.chat('/아이템 모험가 엘릭서 3');
  await player.waitFor('inv', (m) => m.slots.some((x) => x?.item === 'elixir' && x.qty === 3), mark);
  await admin.chat('/골드 모험가 1만');
  await player.self((x) => x.gold === 100 + 10000, mark);
  await admin.chat('/직업 모험가 전사');
  await player.self((x) => x.classId === 'warrior', mark);
  await admin.chat('/배우기 모험가 전부');
  await player.waitFor('abilities', (m) => m.skills.includes('w_strike') && m.skills.includes('first_aid'), mark);
});

test('@이름 으로 대상을 지정하면 없는 캐릭터일 때 나에게 적용되지 않는다', async () => {
  const me = srv.world.findPlayer('관리자')!;
  const before = me.level;
  const mark = admin.mark;
  await admin.chat('/레벨업 @없는사람 10');
  const err = await admin.waitFor('chat', (m) => m.ch === 'error', mark);
  assert.match(err.text, /찾을 수 없습니다/);
  assert.equal(me.level, before);
  const pm = player.mark;
  await admin.chat('/레벨업 @모험가 2');
  await player.self((s) => s.level === 32, pm);
});

test('길드장에게 전직하면 직업이 바뀌고 시작 장비를 착용한다', async () => {
  const c = await Client.connect(srv.port);
  create(c, '신입');
  await c.waitFor('welcome');
  const town = await c.waitFor('map', (m) => m.map.id === 'town');
  const master = town.entities.find((e) => e.type === 'npc' && e.def === 'warrior_master')!;
  // 레벨이 모자라면 거절
  c.send({ t: 'talk', npc: master.id });
  await admin.chat(`/보내기 @신입 town ${master.x + 2} ${master.y}`);
  await new Promise((r) => setTimeout(r, 150));
  let mark = c.mark;
  c.send({ t: 'pick', npc: master.id, key: 'class:warrior:yes' });
  assert.match((await c.waitFor('dialog', () => true, mark)).text, /레벨/);
  await admin.chat('/레벨 @신입 5');
  mark = c.mark;
  c.send({ t: 'pick', npc: master.id, key: 'class:warrior:yes' });
  const s = await c.self((x) => x.classId === 'warrior', mark);
  assert.equal(s.equipment.weapon, 'w_warrior_1');
  assert.equal(s.equipment.armor, 'a_warrior_1');
  // 직업 갑옷을 입으면 그 직업의 의상으로 보임
  assert.equal(srv.world.findPlayer('신입')!.look().outfit, 'warrior');
  const inv = await c.waitFor('inv', (m) => m.slots.some((x) => x?.item === 'w_common_1'), mark);
  assert.ok(inv.slots.some((x) => x?.item === 'a_common_1'), '원래 장비는 소지품으로');
  c.close();
});

test('NPC 상점에서 물건을 산다', async () => {
  await admin.chat('/보내기 모험가 town 15 20');
  const p = srv.world.findPlayer('모험가')!;
  await new Promise((r) => setTimeout(r, 150));
  const town = (await player.waitFor('map', (m) => m.map.id === 'town')).entities;
  const store = town.find((e): e is Extract<EntitySnapshot, { type: 'npc' }> => e.type === 'npc' && e.def === 'general_store')!;
  assert.ok(Math.abs(store.x - p.x) <= 4 && Math.abs(store.y - p.y) <= 4, `상점 근처 (${p.x},${p.y})`);
  const mark = player.mark;
  player.send({ t: 'talk', npc: store.id });
  const dlg = await player.waitFor('dialog', () => true, mark);
  assert.ok(dlg.options.some((o) => o.key === 'shop:0'));
  player.send({ t: 'pick', npc: store.id, key: 'shop:0' });
  const shop = await player.waitFor('shop', () => true, mark);
  assert.ok(shop.items.some((i) => i.item === 'pot_hp_1'));
  const goldBefore = p.data.gold;
  player.send({ t: 'buy', npc: store.id, item: 'pot_hp_1', qty: 5 });
  await player.waitFor('inv', () => p.data.gold === goldBefore - 100, mark);
});

test('전투: 몬스터를 마법으로 쓰러뜨리면 경험치와 골드를 얻는다', async () => {
  await admin.chat('/만렙 마법사');
  await admin.chat('/이동 forest');
  await admin.waitFor('map', (m) => m.map.id === 'forest');
  const mark = admin.mark;
  await admin.chat('/몬스터 들쥐 1');
  const added = await admin.waitFor('add', (m) => m.e.type === 'monster', mark);
  admin.send({ t: 'ability', id: 'z_fire4', target: added.e.id });
  await admin.waitFor('dmg', (m) => m.id === added.e.id, mark);
  await admin.waitFor('remove', (m) => m.id === added.e.id && m.fx === 'death', mark);
  const gain = await admin.waitFor('gain', (m) => m.exp > 0, mark);
  assert.ok(gain.exp > 0);
  await admin.waitFor('cooldown', (m) => m.id === 'z_fire4', mark);
});

test('마을에서는 공격 기술을 쓸 수 없다', async () => {
  const p = srv.world.findPlayer('모험가')!;
  assert.equal(p.map?.id, 'town');
  const mark = player.mark;
  player.send({ t: 'ability', id: 'w_strike' });
  const err = await player.waitFor('chat', (m) => m.ch === 'error', mark);
  assert.match(err.text, /마을/);
});

test('사망하면 유령이 되고, 마을로 돌아가 신전 사제에게 부활한다', async () => {
  const world = srv.world;
  const p = world.findPlayer('모험가')!;
  const mark = player.mark;
  applyDamage(world, null, p, 10_000_000, 'phys');
  await player.self((s) => s.ghost && s.hp === 0, mark);
  assert.equal(p.blocks, false, '유령은 길을 막지 않음');
  // 유령은 공격할 수 없음
  player.send({ t: 'ability', id: 'w_strike' });
  await player.waitFor('chat', (m) => m.ch === 'error' && m.text.includes('유령'), mark);
  // 이미 마을에 있으면 같은 맵 안에서 순간이동(pos), 다른 맵이면 새 맵(map) 메시지를 받습니다
  const before = player.mark;
  player.send({ t: 'recall' });
  await player.waitFor('pos', () => true, before).catch(() => player.waitFor('map', (m) => m.map.id === 'town', before));
  assert.equal(p.map?.id, 'town');
  const town = await player.waitFor('map', (m) => m.map.id === 'town');
  const priest = town.entities.find((e) => e.type === 'npc' && e.def === 'temple_priest')!;
  assert.ok(Math.abs(priest.x - p.x) <= 4 && Math.abs(priest.y - p.y) <= 4, '신전 사제 근처로 이동');
  player.send({ t: 'talk', npc: priest.id });
  const dlg = await player.waitFor('dialog', (m) => m.npc === priest.id, mark);
  assert.ok(dlg.options.some((o) => o.key === 'revive'));
  player.send({ t: 'pick', npc: priest.id, key: 'revive' });
  const s = await player.self((x) => !x.ghost, mark);
  assert.equal(s.hp, s.maxHp);
  assert.equal(p.blocks, true);
});

test('그룹 초대와 수락, 그룹 대화', async () => {
  const mark = player.mark;
  await admin.chat('/파티 초대 모험가');
  await player.waitFor('groupInvite', (m) => m.from === '관리자', mark);
  player.send({ t: 'groupReply', accept: true });
  const g = await player.waitFor('group', (m) => (m.members?.length ?? 0) === 2, mark);
  assert.ok(g.members!.some((m) => m.name === '관리자' && m.leader));
  await player.chat('#안녕하세요');
  await admin.waitFor('chat', (m) => m.ch === 'group' && m.text === '안녕하세요' && m.from === '모험가');
  await player.chat('/파티 탈퇴');
  await player.waitFor('group', (m) => m.members === null, mark);
});

test('관리자 REST API: 인증, 목록, 접속 중인 캐릭터 즉시 반영', async () => {
  assert.equal((await http('/api/admin/status')).status, 401);
  assert.equal((await http('/api/admin/login', { password: 'nope' })).status, 401);
  const login = await http('/api/admin/login', { password: ADMIN_PW });
  assert.equal(login.status, 200);
  const token = login.json.token as string;
  const list = await http('/api/admin/characters', undefined, token);
  const names = (list.json.characters as { name: string }[]).map((c) => c.name);
  for (const n of ['관리자', '모험가', '신입']) assert.ok(names.includes(n), n);
  const search = await http(`/api/admin/characters?q=${encodeURIComponent('모험')}`, undefined, token);
  assert.deepEqual((search.json.characters as { name: string }[]).map((c) => c.name), ['모험가']);
  const mark = player.mark;
  const r = await http(`/api/admin/characters/${encodeURIComponent('모험가')}/setLevel`, { level: 77 }, token);
  assert.equal(r.status, 200, String(r.json.msg));
  await player.self((s) => s.level === 77, mark);
  const bad = await http(`/api/admin/characters/${encodeURIComponent('모험가')}/setClass`, { classId: 'dragon' }, token);
  assert.equal(bad.status, 400);
  const settings = await http('/api/admin/settings', { expRate: 5 }, token);
  assert.equal(settings.status, 200);
  assert.equal(srv.world.config.expRate, 5);
  const audit = await http('/api/admin/audit', undefined, token);
  assert.ok((audit.json.entries as { action: string }[]).some((e) => e.action === 'setLevel'));
});

test('정적 파일: 경로 탐색은 막힌다', async () => {
  const res = await fetch(`http://127.0.0.1:${srv.port}/..%2f..%2fpackage.json`);
  assert.ok(res.status === 403 || res.status === 404);
  const index = await fetch(`http://127.0.0.1:${srv.port}/`);
  assert.equal(index.status, 200);
  assert.ok(index.headers.get('content-security-policy'));
});

test('저장: 서버를 다시 켜도 캐릭터가 남아 있다', async () => {
  player.close();
  admin.close();
  await new Promise((r) => setTimeout(r, 200));
  await srv.close();
  srv = await startServer(cfg);
  const c = await Client.connect(srv.port);
  c.send({ t: 'login', name: '모험가', password: 'pass1234' });
  const s = await c.self();
  assert.equal(s.level, 77);
  assert.equal(s.classId, 'warrior');
  const inv = await c.waitFor('inv');
  assert.ok(inv.slots.some((x) => x?.item === 'elixir'));
  assert.ok(inv.slots.some((x) => x?.item === 'pot_hp_1' && x.qty >= 5));
  c.close();
});
