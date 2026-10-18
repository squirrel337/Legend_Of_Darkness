// 자동사냥: 실제 서버를 띄워 서버가 대신 걷고, 싸우고, 회복하고, 줍고, 멈추는지 확인합니다
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DEFAULT_AUTO_SETTINGS, sanitizeAutoSettings, type AutoSettings } from '../src/shared/autohunt';
import { startServer, type RunningServer } from '../src/server/app';
import { AUTO_STEP_MS, autoHuntTick } from '../src/server/systems/autohunt';
import { countItem } from '../src/server/systems/character';
import { applyDamage, applyStatus } from '../src/server/systems/combat';
import { dropToGround } from '../src/server/systems/ground';
import type { MapInstance } from '../src/server/world/MapInstance';
import { Monster } from '../src/server/world/Monster';
import type { Player } from '../src/server/world/Player';
import { Client, create, sleep, testConfig, until } from './helpers';

let dataDir = '';
let srv: RunningServer;
let field: MapInstance;
const GM = '운영자';
// 서버는 IP 당 캐릭터 생성을 10개로 제한하므로 캐릭터를 아껴 씁니다
let gm: { c: Client; p: Player };
let settingsChar: { c: Client; p: Player };

const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

async function join(name: string): Promise<{ c: Client; p: Player }> {
  const c = await Client.connect(srv.port);
  create(c, name);
  await c.waitFor('welcome');
  await c.self();
  return { c, p: srv.world.findPlayer(name)! };
}

/** 앞에서 만든 캐릭터로 다시 접속합니다 (새 캐릭터는 10개를 이미 다 만들었음) */
async function rejoin(name: string): Promise<{ c: Client; p: Player }> {
  const c = await Client.connect(srv.port);
  c.send({ t: 'login', name, password: 'pass1234' });
  await c.waitFor('welcome');
  await c.self();
  return { c, p: srv.world.findPlayer(name)! };
}

/** 사냥터를 비웁니다 (몬스터 생성기와 몬스터, 바닥 아이템) */
function clearField(): void {
  field.spawners.length = 0;
  for (const m of [...field.monsters]) {
    m.dead = true;
    field.remove(m);
  }
  for (const it of [...field.items]) field.remove(it);
}

/** 사방 r칸이 모두 걸을 수 있는 빈 칸 */
function openSpot(r: number, avoid: { x: number; y: number }[] = []): { x: number; y: number } {
  for (let y = r; y < field.height - r; y++) {
    for (let x = r; x < field.width - r; x++) {
      if (avoid.some((a) => cheb(a, { x, y }) <= r * 2 + 2)) continue;
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) ok = field.isFree(x + dx, y + dy) && !field.isWarpTile(x + dx, y + dy);
      if (ok) return { x, y };
    }
  }
  throw new Error('빈 사냥터 자리를 찾지 못했습니다');
}

function place(p: Player, at: { x: number; y: number }): void {
  srv.world.transfer(p, field, at.x, at.y);
  assert.equal(p.map, field);
}

function spawn(id: string, x: number, y: number, hp?: number): Monster {
  const m = new Monster(srv.world.allocId(), srv.world.data.monsters.get(id)!);
  m.x = x;
  m.y = y;
  m.homeX = x;
  m.homeY = y;
  if (hp !== undefined) m.hp = Math.min(m.hp, hp);
  field.add(m);
  return m;
}

/** 움직이지도 공격하지도 못하게 (테스트를 흔들지 않도록) */
const freeze = (m: Monster) => applyStatus(m, 'paralyze', 120_000, undefined, null);

function startAuto(c: Client, settings: Partial<AutoSettings> = {}): number {
  const mark = c.mark;
  c.send({ t: 'auto', on: true, settings: { ...DEFAULT_AUTO_SETTINGS, ...settings } });
  return mark;
}

function stopAll(...ps: Player[]): void {
  for (const p of ps) {
    p.auto = null;
    p.data.godMode = false;
  }
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-auto-'));
  srv = await startServer(testConfig(dataDir));
  field = srv.world.maps.get('forest')!;
  clearField();
  // 첫 캐릭터(관리자)는 '다른 사람' 역할을 맡습니다
  gm = await join(GM);
});

after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('설정 값은 안전한 범위로 고쳐진다', () => {
  const s = sanitizeAutoSettings({ hpPct: 500, mpPct: -3, radius: 1000, maxLevelGap: 3.6, abilities: ['a', 'a', 'b', 7, ''], pickup: 'yes', buffs: false });
  assert.equal(s.hpPct, 95);
  assert.equal(s.mpPct, 0);
  assert.equal(s.radius, 30);
  assert.equal(s.maxLevelGap, 4);
  assert.deepEqual(s.abilities, ['a', 'b']);
  assert.equal(s.pickup, DEFAULT_AUTO_SETTINGS.pickup);
  assert.equal(s.buffs, false);
  assert.deepEqual(sanitizeAutoSettings(null), { ...DEFAULT_AUTO_SETTINGS, abilities: [] });
  assert.equal(sanitizeAutoSettings({ radius: 1 }).radius, 3);
});

test('마을에서는 켜지지 않는다', async () => {
  settingsChar = await join('설정왕');
  const { c, p } = settingsChar;
  assert.equal(p.map?.id, 'town');
  const mark = startAuto(c);
  const m = await c.waitFor('auto', () => true, mark);
  assert.equal(m.on, false);
  assert.match(m.reason ?? '', /마을/);
  assert.equal(p.auto, null);
});

test('다른 맵으로 옮겨지면 멈추고, 켜진 동안 받은 설정은 검사해서 반영한다', async () => {
  clearField();
  const { c, p } = settingsChar;
  const at = openSpot(3);
  place(p, at);
  let mark = startAuto(c);
  await c.waitFor('auto', (m) => m.on, mark);
  const anchor = { ...p.auto!.anchor };
  // 켜진 동안 설정만 바꿈 (사냥 구역은 그대로)
  mark = c.mark;
  c.send({ t: 'auto', on: true, settings: { radius: 999, hpPct: -5, abilities: 'x' } as unknown as AutoSettings });
  await c.waitFor('auto', (m) => m.on, mark);
  assert.equal(p.auto!.settings.radius, 30);
  assert.equal(p.auto!.settings.hpPct, 0);
  assert.deepEqual(p.auto!.settings.abilities, []);
  assert.deepEqual(p.auto!.anchor, anchor);

  mark = c.mark;
  const plains = srv.world.maps.get('plains')!;
  srv.world.transfer(p, plains, plains.def.spawn.x, plains.def.spawn.y);
  const off = await c.waitFor('auto', (m) => !m.on, mark);
  assert.match(off.reason ?? '', /옮겨/);
  assert.equal(p.auto, null);
  // 꺼져 있을 때 끄기를 보내도 답을 받음 (화면과 서버 상태가 어긋나지 않게)
  mark = c.mark;
  c.send({ t: 'auto', on: false });
  const ack = await c.waitFor('auto', () => true, mark);
  assert.equal(ack.on, false);
  c.close();
});

test('가까운 몬스터를 찾아가 쓰러뜨리고, 서버가 보낸 걸음이 본인에게도 전달된다', async () => {
  clearField();
  const { c, p } = await join('사냥꾼');
  const at = openSpot(4);
  place(p, at);
  const rats = [spawn('rat', at.x + 3, at.y, 6), spawn('rat', at.x - 2, at.y + 3, 6), spawn('rat', at.x, at.y - 4, 6)];
  const kills = p.data.kills;
  const mark = startAuto(c, { radius: 12, hpPct: 30 });
  const on = await c.waitFor('auto', (m) => m.on, mark);
  assert.ok(on.state);
  await until(() => rats.every((r) => r.dead), 25_000);
  assert.ok(p.data.kills >= kills + 3, '처치 수가 늘어남');
  assert.ok(p.auto && p.auto.kills >= 3);
  assert.ok(
    c.msgs.slice(mark).some((m) => m.t === 'walk' && m.id === p.id),
    '본인 캐릭터의 걸음을 본인도 받음',
  );
  assert.ok(
    c.msgs.slice(mark).some((m) => m.t === 'auto' && m.on && m.state === 'fighting'),
    '상태가 바뀌면 알려 줌',
  );
  assert.ok(p.auto, '사냥감이 없어도 계속 켜져 있음');
  stopAll(p);
  c.close();
});

test('체력이 기준보다 낮으면 물약을 마신다', async () => {
  clearField();
  const { c, p } = await join('물약러');
  place(p, openSpot(3));
  // 응급 처치는 쓰지 못하게 해서 물약을 쓰게 함
  p.cooldowns.set('first_aid', Date.now() + 120_000);
  const before = countItem(p.data, 'pot_hp_1');
  assert.ok(before > 0);
  p.hp = Math.max(1, Math.floor(p.maxHp * 0.3));
  p.markVitals();
  const mark = startAuto(c, { hpPct: 90 });
  await until(() => countItem(p.data, 'pot_hp_1') < before, 6000);
  assert.ok(p.hp > Math.floor(p.maxHp * 0.3));
  await c.waitFor('auto', (m) => m.on && m.state === 'healing', mark);
  stopAll(p);
  c.close();
});

test('내 전리품은 줍고, 다른 사람의 전리품은 줍지 않는다', async () => {
  clearField();
  const { c, p } = await join('줍는이');
  const at = openSpot(4);
  place(p, at);
  const mine = dropToGround(srv.world, field, at.x + 2, at.y + 1, 'mat_rat_tail', 2, p.name)!;
  const theirs = dropToGround(srv.world, field, at.x - 2, at.y, 'mat_web', 1, '다른사람')!;
  const gold = dropToGround(srv.world, field, at.x, at.y - 3, null, 77, p.name)!;
  const goldBefore = p.data.gold;
  startAuto(c, { radius: 6 });
  await until(() => mine.map === null && gold.map === null, 10_000);
  assert.equal(countItem(p.data, 'mat_rat_tail'), 2);
  assert.equal(p.data.gold, goldBefore + 77);
  await sleep(1500);
  assert.equal(theirs.map, field, '남의 전리품은 그대로');
  assert.equal(countItem(p.data, 'mat_web'), 0);
  // 오류 메시지가 대화창을 도배하지 않음
  assert.ok(c.msgs.filter((m) => m.t === 'chat' && m.ch === 'error').length <= 1);

  // 소지품이 가득 차면 줍기만 멈추고 사냥은 계속합니다 (알림은 한 번)
  p.data.inventory = p.data.inventory.map((slot) => slot ?? { item: 'mat_bone', qty: 1 });
  const mark = c.mark;
  const more = dropToGround(srv.world, field, p.x, p.y + 1, 'mat_web', 1, p.name)!;
  const full = await c.waitFor('notice', (m) => m.text.includes('가득'), mark);
  assert.equal(full.kind, 'warn');
  await sleep(600);
  assert.equal(more.map, field);
  assert.ok(p.auto?.pickupOff, '줍기를 멈춤');
  assert.equal(c.msgs.slice(mark).filter((m) => m.t === 'notice' && m.text.includes('가득')).length, 1);
  stopAll(p);
  c.close();
});

test('물약이 떨어지고 맞아서 위험하면 귀환 주문서로 마을에 돌아간다', async () => {
  clearField();
  const { c, p } = await join('귀환이');
  const at = openSpot(3);
  place(p, at);
  p.data.inventory = p.data.inventory.map((slot) => (slot && slot.item.startsWith('pot_') ? null : slot));
  p.cooldowns.set('first_aid', Date.now() + 120_000);
  const scrolls = countItem(p.data, 'scroll_recall');
  assert.ok(scrolls > 0);
  // 나를 노리는 몬스터 (움직이지 못하게 해서 실제로 때리지는 않음)
  const enemy = spawn('goblin', at.x + 1, at.y, 500);
  freeze(enemy);
  enemy.target = p;
  p.hp = Math.max(1, Math.floor(p.maxHp * 0.1));
  const mark = startAuto(c, { hpPct: 50, recall: true });
  const off = await c.waitFor('auto', (m) => !m.on, mark, 6000);
  assert.match(off.reason ?? '', /귀환/);
  assert.equal(p.map?.id, 'town');
  assert.equal(countItem(p.data, 'scroll_recall'), scrolls - 1);
  assert.equal(p.auto, null);
  c.close();
});

test('사냥 구역(반경) 밖으로 나가지 않고, 구역 밖 몬스터는 노리지 않는다', async () => {
  clearField();
  const { c, p } = await join('제자리');
  const at = openSpot(6);
  place(p, at);
  const inside = spawn('rat', at.x + 2, at.y + 1, 6);
  const outside = [spawn('rat', at.x + 6, at.y, 30), spawn('rat', at.x, at.y - 6, 30), spawn('rat', at.x - 5, at.y + 5, 30)];
  outside.forEach(freeze);
  startAuto(c, { radius: 3 });
  let maxDist = 0;
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    maxDist = Math.max(maxDist, cheb(p, at));
    await sleep(25);
  }
  assert.ok(maxDist <= 3, `반경 3을 넘지 않음 (최대 ${maxDist})`);
  assert.ok(inside.dead, '구역 안 몬스터는 처치');
  for (const m of outside) {
    assert.equal(m.damageBy.has(p.name), false, '구역 밖 몬스터는 건드리지 않음');
    assert.equal(m.dead, false);
  }
  assert.ok(p.auto, '계속 켜져 있음');
  stopAll(p);
  c.close();
});

test('그룹이 아닌 다른 사람이 싸우는 몬스터와 다른 사람의 소환수는 노리지 않는다', async () => {
  clearField();
  const { c, p } = await join('양보왕');
  const other = gm;
  const at = openSpot(4);
  place(p, at);
  place(other.p, { x: at.x + 3, y: at.y + 3 });
  other.p.data.godMode = true;
  p.data.godMode = true;
  // 다른 사람이 먼저 때린 몬스터
  const taken = spawn('rat', at.x + 2, at.y, 30);
  taken.target = other.p;
  taken.damageBy.set(other.p.name, 3);
  freeze(taken);
  // 다른 사람의 소환수
  const fox = new Monster(srv.world.allocId(), srv.world.data.monsters.get('spirit_fox')!, 5);
  fox.x = at.x - 1;
  fox.y = at.y;
  fox.owner = other.p;
  fox.expireAt = Date.now() + 60_000;
  other.p.summons.add(fox);
  field.add(fox);
  freeze(fox);
  const foxHp = fox.hp;
  startAuto(c, { radius: 6 });
  const end = Date.now() + 3500;
  while (Date.now() < end) {
    assert.notEqual(p.auto?.target, taken);
    assert.notEqual(p.auto?.target, fox);
    await sleep(50);
  }
  assert.equal(taken.damageBy.has(p.name), false);
  assert.equal(fox.damageBy.has(p.name), false);
  assert.equal(fox.hp, foxHp);
  // 아무도 싸우지 않는 몬스터는 노림
  const free = spawn('rat', at.x, at.y - 2, 6);
  await until(() => free.dead, 8000);
  stopAll(p, other.p);
  other.p.summons.clear();
  c.close();
});

test('마법사는 공격 마법을 쓰며 사냥한다', async () => {
  clearField();
  const { c, p } = await join('불꽃술사');
  const w = srv.world.admin;
  assert.ok(w.setLevel(GM, p.name, 10).ok);
  assert.ok(w.setClass(GM, p.name, 'wizard').ok);
  assert.ok(w.learnAbility(GM, p.name, 'z_fire1').ok);
  p.mp = p.maxMp;
  const at = openSpot(5);
  place(p, at);
  const rat = spawn('rat', at.x + 4, at.y, 40);
  freeze(rat);
  const mpBefore = p.mp;
  startAuto(c, { radius: 8 });
  await until(() => rat.dead, 12_000);
  assert.ok(p.cooldowns.has('z_fire1'), '불씨를 사용함');
  assert.ok(p.mp < mpBefore || p.mp === p.maxMp);
  stopAll(p);
  c.close();
});

test('직접 걸으면 멈추고, 캐릭터가 쓰러져도 멈춘다', async () => {
  clearField();
  const { c, p } = await join('멈춤이');
  const at = openSpot(3);
  place(p, at);
  let mark = startAuto(c);
  await c.waitFor('auto', (m) => m.on, mark);
  // 서버가 걷게 한 걸음을 아직 받지 못한 클라이언트가 옛 자리에서 걸어도(거절되는 걸음) 바로 멈추고,
  // 위치를 바로잡아 준 뒤로는 서버가 더 걷게 하지 않습니다
  mark = c.mark;
  c.send({ t: 'walk', dir: 2, x: p.x + 5, y: p.y });
  const stale = await c.waitFor('auto', (m) => !m.on, mark);
  assert.match(stale.reason ?? '', /직접/);
  await c.waitFor('pos', () => true, mark);
  assert.equal(p.auto, null);
  const corrected = c.mark;
  const stoppedAt = { x: p.x, y: p.y };
  await sleep(700);
  assert.deepEqual({ x: p.x, y: p.y }, stoppedAt);
  assert.equal(c.msgs.slice(corrected).filter((m) => m.t === 'walk' && m.id === p.id).length, 0);

  mark = startAuto(c);
  await c.waitFor('auto', (m) => m.on, mark);
  mark = c.mark;
  c.send({ t: 'walk', dir: 2, x: p.x, y: p.y });
  const off = await c.waitFor('auto', (m) => !m.on, mark);
  assert.match(off.reason ?? '', /직접/);
  assert.equal(p.auto, null);

  mark = startAuto(c);
  await c.waitFor('auto', (m) => m.on, mark);
  mark = c.mark;
  applyDamage(srv.world, null, p, 10_000_000, 'phys');
  const dead = await c.waitFor('auto', (m) => !m.on, mark);
  assert.match(dead.reason ?? '', /쓰러져/);
  assert.equal(p.auto, null);
  c.close();
});

test('범위 기술은 그룹이 아닌 다른 사람이 싸우는 몬스터를 함께 맞히지 않는다', async () => {
  clearField();
  const { c, p } = await rejoin('사냥꾼');
  const admin = srv.world.admin;
  const other = gm.p;
  assert.ok(admin.setLevel(GM, p.name, 30).ok);
  assert.ok(admin.setClass(GM, p.name, 'warrior').ok);
  assert.ok(admin.learnAll(GM, p.name).ok);
  for (const id of ['w_whirl', 'w_quake', 'w_cleave']) assert.ok(p.data.skills.includes(id));
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  const at = openSpot(4);
  place(p, at);
  place(other, { x: at.x, y: at.y + 3 });
  other.data.godMode = true;
  // 다른 사람이 싸우는 몬스터: 내 바로 아래 (주변 4칸·8칸 기술에 맞는 자리)
  const theirs = spawn('goblin', at.x, at.y + 1);
  theirs.target = other;
  theirs.damageBy.set(other.name, 5);
  freeze(theirs);
  // 내 사냥감: 내 오른쪽
  const mine = spawn('goblin', at.x + 1, at.y);
  mine.target = p;
  freeze(mine);
  startAuto(c, { radius: 6 });
  await until(() => mine.dead, 15_000);
  assert.equal(theirs.damageBy.has(p.name), false, '남이 싸우는 몬스터는 주변 기술에도 맞지 않음');
  assert.equal(theirs.hp, theirs.maxHp);

  // 함께 맞는 몬스터가 모두 내 사냥감이면 주변 기술을 씁니다
  stopAll(p);
  clearField();
  place(p, at);
  p.cooldowns.clear();
  p.mp = p.maxMp;
  const pair = [spawn('goblin', at.x + 1, at.y), spawn('goblin', at.x - 1, at.y)];
  for (const m of pair) {
    m.target = p;
    freeze(m);
  }
  startAuto(c, { radius: 6 });
  await until(() => p.cooldowns.has('w_whirl') || p.cooldowns.has('w_quake'), 6000);

  // 대상 지정 범위 마법: 대상 옆에 남이 싸우는 몬스터가 있으면 한 대상 마법만 씁니다
  stopAll(p);
  clearField();
  assert.ok(admin.setLevel(GM, p.name, 45).ok);
  assert.ok(admin.setClass(GM, p.name, 'wizard').ok);
  assert.ok(admin.learnAll(GM, p.name).ok);
  assert.ok(p.data.spells.includes('z_fire3'));
  p.cooldowns.clear();
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  place(p, at);
  place(other, { x: at.x + 3, y: at.y + 3 });
  other.data.godMode = true;
  const target = spawn('goblin', at.x + 3, at.y);
  target.target = p;
  freeze(target);
  const beside = spawn('goblin', at.x + 3, at.y + 1);
  beside.target = other;
  beside.damageBy.set(other.name, 5);
  freeze(beside);
  startAuto(c, { radius: 6 });
  await until(() => target.dead, 15_000);
  assert.equal(beside.damageBy.has(p.name), false, '대상 옆의 남이 싸우는 몬스터는 범위 마법에 맞지 않음');
  stopAll(p, other);
  c.close();
});

test('필살로 스스로 깎은 체력은 맞은 피해로 치지 않는다 (귀환 주문서·엘릭서를 낭비하지 않음)', async () => {
  clearField();
  const { c, p } = await rejoin('제자리');
  const admin = srv.world.admin;
  assert.ok(admin.setLevel(GM, p.name, 60).ok);
  assert.ok(admin.setClass(GM, p.name, 'warrior').ok);
  assert.ok(admin.learnAbility(GM, p.name, 'w_crash').ok);
  // 물약은 없고 귀환 주문서는 있음
  p.data.inventory = p.data.inventory.map((s) => (s && s.item.startsWith('pot_') ? null : s));
  if (countItem(p.data, 'scroll_recall') === 0) assert.ok(admin.giveItem(GM, p.name, 'scroll_recall', 1).ok);
  const scrolls = countItem(p.data, 'scroll_recall');
  p.cooldowns.set('first_aid', Date.now() + 120_000);
  p.hp = p.maxHp;
  const at = openSpot(3);
  place(p, at);
  // 나를 노리지만 움직이지 못하는 단단한 몬스터 (실제로 때리지는 않음)
  const boss = spawn('dark_lord', at.x + 1, at.y);
  boss.target = p;
  freeze(boss);
  const settings = { hpPct: 30, recall: true, abilities: ['w_crash'], buffs: false, radius: 6 };
  let mark = startAuto(c, settings);
  await until(() => p.cooldowns.has('w_crash'), 5000);
  assert.ok(p.hp <= Math.ceil(p.maxHp * 0.55), '필살로 체력을 절반 씀');
  await sleep(1200);
  assert.ok(p.auto, '체력이 기준보다 높으면 계속 사냥함');
  assert.equal(p.map, field);
  assert.equal(countItem(p.data, 'scroll_recall'), scrolls, '귀환 주문서를 쓰지 않음');
  assert.equal(c.msgs.slice(mark).some((m) => m.t === 'auto' && !m.on), false, '꺼졌다는 알림이 없음');

  // 필살 뒤 기준 아래로 내려가도 위급한 것은 아니므로 엘릭서가 아닌 보통 물약을 마십니다
  assert.ok(admin.giveItem(GM, p.name, 'pot_hp_3', 5).ok);
  assert.ok(admin.giveItem(GM, p.name, 'elixir', 2).ok);
  const elixirs = countItem(p.data, 'elixir');
  const pots = countItem(p.data, 'pot_hp_3');
  p.cooldowns.delete('w_crash');
  p.hp = p.maxHp;
  mark = startAuto(c, { ...settings, hpPct: 60 });
  await until(() => countItem(p.data, 'pot_hp_3') < pots, 5000);
  assert.ok(p.cooldowns.has('w_crash'));
  assert.equal(countItem(p.data, 'elixir'), elixirs, '엘릭서는 위급할 때만');
  stopAll(p);
  c.close();
});

test('회복 마법이 공용 대기만 기다리는 중이면 물약 대신 잠깐 기다렸다가 마법으로 회복한다', async () => {
  clearField();
  const { c, p } = await rejoin('물약러');
  const admin = srv.world.admin;
  assert.ok(admin.setLevel(GM, p.name, 10).ok);
  assert.ok(admin.setClass(GM, p.name, 'priest').ok);
  assert.ok(admin.learnAbility(GM, p.name, 'p_heal').ok);
  assert.ok(admin.giveItem(GM, p.name, 'pot_hp_1', 5).ok);
  place(p, openSpot(3));
  const pots = countItem(p.data, 'pot_hp_1');
  // 응급 처치는 쓰지 못하게 하고, 방금 공격 마법을 써서 공용 대기(GCD) 중인 것처럼
  p.cooldowns.set('first_aid', Date.now() + 120_000);
  p.mp = p.maxMp;
  p.hp = Math.floor(p.maxHp * 0.8);
  const hpBefore = p.hp;
  p.gcdUntil = Date.now() + 450;
  startAuto(c, { hpPct: 90 });
  await until(() => p.cooldowns.has('p_heal'), 3000);
  assert.equal(countItem(p.data, 'pot_hp_1'), pots, '공용 대기 동안 물약을 마시지 않음');
  assert.ok(p.hp > hpBefore, '치유 마법으로 회복');
  await sleep(500);
  assert.equal(countItem(p.data, 'pot_hp_1'), pots);
  stopAll(p);
  c.close();
});

test('쓸 기술로 회복·강화 기술만 골랐으면 공격 기술은 알아서 고른다', async () => {
  clearField();
  const { c, p } = await rejoin('양보왕');
  const admin = srv.world.admin;
  assert.ok(admin.setLevel(GM, p.name, 12).ok);
  assert.ok(admin.setClass(GM, p.name, 'warrior').ok);
  assert.ok(admin.learnAbility(GM, p.name, 'w_strike').ok);
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  const at = openSpot(3);
  place(p, at);
  const orc = spawn('orc', at.x + 1, at.y);
  orc.target = p;
  freeze(orc);
  startAuto(c, { abilities: ['first_aid'], autoAbilities: true });
  await until(() => p.cooldowns.has('w_strike'), 5000);
  stopAll(p);
  c.close();
});

test('100ms 틱에서도 한 칸을 평균 AUTO_STEP_MS 정도에 걷고, 직접 걷기보다 빠르지는 않다', async () => {
  clearField();
  const { c, p } = await rejoin('설정왕');
  place(p, openSpot(6));
  const world = srv.world;
  const mark = startAuto(c, { radius: 12 });
  await c.waitFor('auto', (m) => m.on, mark);
  // 실제 틱을 멈추고 100ms 틱을 흉내 내어 걸음 간격을 잽니다
  world.stop();
  const steps: number[] = [];
  try {
    let t = Date.now();
    let last = { x: p.x, y: p.y };
    for (let i = 0; i < 80; i++, t += 100) {
      autoHuntTick(world, p, t);
      if (p.x !== last.x || p.y !== last.y) {
        steps.push(t);
        last = { x: p.x, y: p.y };
      }
    }
  } finally {
    world.start();
  }
  assert.ok(p.auto, '계속 켜져 있음');
  assert.ok(steps.length >= 20, `찾는 동안 계속 걸음 (${steps.length}걸음)`);
  const gaps = steps.slice(1).map((v, i) => v - steps[i]!);
  const avg = (steps[steps.length - 1]! - steps[0]!) / (steps.length - 1);
  assert.ok(avg <= AUTO_STEP_MS + 20, `평균 ${avg.toFixed(0)}ms (틱에 맞추기만 하면 300ms)`);
  assert.ok(Math.min(...gaps) >= 200, `가장 짧은 간격 ${Math.min(...gaps)}ms`);
  stopAll(p);
  c.close();
});
