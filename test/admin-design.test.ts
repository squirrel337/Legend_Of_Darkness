// 관리자 페이지 "직업·스킬트리" 편집기 API: 로그인, 검사만(dryRun), 저장(파일·판 기록·바로 반영·접속자 알림·감사 기록),
// 판이 어긋날 때의 거절, 여러 곳 한 번에 저장, 판 기록과 되돌리기, 요청 모양·크기·경로 검사를 실제 서버로 확인합니다.
// 서버는 gamedata 의 임시 복사본을 쓰므로 저장해도 저장소의 gamedata 파일은 바뀌지 않습니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { DesignHistoryDetail, DesignSaveBody } from '../src/shared/design-edit';
import type { DesignBundle, DesignHistoryList, DesignSaveResult, ProgressionConfig, SkillTreeConfig, SkillTreesConfig } from '../src/shared/progression';
import { startServer, type RunningServer } from '../src/server/app';
import { formatSkillTrees, GameData } from '../src/server/gamedata';
import { ADMIN_PW, Client, create, ROOT, testConfig } from './helpers';

let dataDir = '';
let gdDir = '';
let srv: RunningServer;
let token = '';
let watcher: Client;
/** 처음 gamedata 파일 내용 (파일 이름 → 글) */
const original = new Map<string, string>();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** 처음 gamedata 의 회오리 베기 (트리 데이터가 바뀌어도 시험이 맞도록 처음 값과 비교) */
let whirl0: { level: number; requires: { ability: string; prof: number }[] };
const historyDir = () => path.join(dataDir, 'design-history');
const historyFiles = () => (fs.existsSync(historyDir()) ? fs.readdirSync(historyDir()).sort() : []);
const gdText = (f: string) => fs.readFileSync(path.join(gdDir, f), 'utf8');

async function call<T = Record<string, unknown>>(method: string, p: string, body?: unknown, auth = true): Promise<{ status: number; json: T }> {
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/admin${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
}

const bundle = async () => (await call<DesignBundle>('GET', '/design')).json;
const save = (p: string, body: unknown, method = 'PUT') => call<DesignSaveResult>(method, p, body);

/** 바뀐 줄 (같은 줄 수의 두 글에서 다른 줄 번호) */
function changedLines(a: string, b: string): number[] {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, '줄 수가 같아야 함');
  return x.flatMap((l, i) => (l === y[i] ? [] : [i]));
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-data-'));
  gdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-gd-'));
  fs.cpSync(path.join(ROOT, 'gamedata'), gdDir, { recursive: true });
  for (const f of fs.readdirSync(gdDir)) if (f.endsWith('.json')) original.set(f, gdText(f));
  srv = await startServer(testConfig(dataDir, { GAMEDATA_DIR: gdDir }));
  const w = srv.world.data.nodeOf('w_whirl')!.node;
  whirl0 = { level: w.level!, requires: clone(w.requires) };
  watcher = await Client.connect(srv.port);
  create(watcher, '구경꾼');
  await watcher.waitFor('welcome');
  const login = await fetch(`http://127.0.0.1:${srv.port}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PW }),
  });
  token = String(((await login.json()) as { token: string }).token);
});

after(async () => {
  watcher?.close();
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(gdDir, { recursive: true, force: true });
});

test('편집기 API 는 관리자 로그인 뒤에만 열리고, 지금 설계와 고를 거리(기술·아이템·직업)를 판 표시와 함께 준다', async () => {
  assert.equal((await call('GET', '/design', undefined, false)).status, 401);
  assert.equal((await call('PUT', '/design/skilltree/warrior', {}, false)).status, 401);
  assert.equal((await call('POST', '/design/restore', {}, false)).status, 401);
  const b = await bundle();
  assert.equal(b.ok, true);
  assert.match(b.rev, /^[0-9a-f]{16}$/);
  assert.deepEqual(b.skillTrees, clone(srv.world.data.skillTrees));
  assert.deepEqual(b.progression, clone(srv.world.data.progression));
  assert.ok(b.abilities.length > 0 && b.abilities.every((a) => a.classId !== 'monster'));
  assert.ok(b.items.some((i) => i.id === 'mat_wolf_pelt' && i.type === 'material'));
  assert.deepEqual(
    b.classes.filter((c) => c.tier === 2).map((c) => c.id),
    ['summoner', 'bard', 'beastkin', 'archer', 'gladiator'],
  );
  assert.equal(b.classes.find((c) => c.id === 'archer')!.name, '궁사');
  assert.equal(b.maxLevel, srv.world.config.maxLevel);
  assert.deepEqual(b.warnings, []);
  // 같은 설계면 판 표시도 같음
  assert.equal((await bundle()).rev, b.rev);
});

test('검사만(dryRun): 고친 트리를 검사해 문제의 자리를 알려 주고, 아무것도 바꾸지 않는다', async () => {
  const b = await bundle();
  const tree = clone(b.skillTrees.trees.warrior);
  tree.nodes.find((n) => n.ability === 'w_whirl')!.requires = [{ ability: 'w_strike', prof: 30 }];
  const ok = await save('/design/skilltree/warrior', { rev: b.rev, tree, dryRun: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.ok, true);
  assert.deepEqual(ok.json.issues, []);
  // 순환은 오류: 400 과 함께 어느 트리의 어느 기술인지
  tree.nodes.find((n) => n.ability === 'w_strike')!.requires = [{ ability: 'w_whirl', prof: 0 }];
  const bad = await save('/design/skilltree/warrior', { rev: b.rev, tree, dryRun: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.ok, false);
  const cyc = bad.json.issues.find((i) => i.level === 'error' && /돌고 돕니다/.test(i.msg));
  assert.ok(cyc && cyc.where.startsWith('skilltrees.json(warrior/'), JSON.stringify(bad.json.issues));
  // 여러 곳 한 번에(PUT /design)의 검사는 판이 달라도 검사하고 서버의 판을 알려 줌
  const tree2 = clone(b.skillTrees.trees.warrior);
  tree2.nodes.find((n) => n.ability === 'w_whirl')!.level = 150;
  const stale = await save('/design', { rev: '0000000000000000', skillTrees: { warrior: tree2 }, dryRun: true } satisfies DesignSaveBody);
  assert.equal(stale.status, 200, JSON.stringify(stale.json));
  assert.equal(stale.json.rev, b.rev);
  // 서버 최대 레벨보다 높은 필요 레벨은 경고
  assert.ok(stale.json.issues.some((i) => i.level === 'warn' && i.where === 'skilltrees.json(warrior/w_whirl)' && /최대 레벨/.test(i.msg)));
  // 편집기의 실시간 검사(PUT /design 의 dryRun)는 설계 오류도 200 으로, ok: false 와 문제 목록
  const cyc2 = await save('/design', { rev: b.rev, skillTrees: { warrior: tree }, dryRun: true } satisfies DesignSaveBody);
  assert.equal(cyc2.status, 200);
  assert.equal(cyc2.json.ok, false);
  assert.ok(cyc2.json.issues.some((i) => i.level === 'error' && /돌고 돕니다/.test(i.msg)));
  // 아무것도 바뀌지 않음
  for (const [f, t] of original) assert.equal(gdText(f), t, f);
  assert.deepEqual(historyFiles(), []);
  assert.deepEqual(srv.world.data.nodeOf('w_whirl')!.node.requires, whirl0.requires);
  assert.equal((await bundle()).rev, b.rev);
});

test('트리 저장: 파일에는 바꾼 줄만 쓰고, 이전 판을 남기고, 서버를 끄지 않고 바로 반영해 접속자에게 알린다', async () => {
  const b = await bundle();
  const tree = clone(b.skillTrees.trees.warrior);
  const whirl = tree.nodes.find((n) => n.ability === 'w_whirl')!;
  whirl.level = whirl0.level + 3;
  whirl.gold = 900;
  whirl.items = [{ item: 'mat_wolf_pelt', qty: 3 }];
  whirl.requires = [{ ability: 'w_strike', prof: 30 }];
  whirl.stats = { str: 20 };
  const mark = watcher.mark;
  const r = await save('/design/skilltree/warrior', { rev: b.rev, tree, abilities: [{ id: 'w_whirl', name: '큰 회오리', mp: 9 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.match(r.json.msg, /바로 반영/);
  assert.notEqual(r.json.rev, b.rev);
  assert.deepEqual(r.json.issues, [], '노드의 레벨·골드를 abilities.json 에도 맞추므로 경고가 남지 않음');
  assert.equal((await bundle()).rev, r.json.rev);

  // 실행 중인 게임 데이터
  const gd = srv.world.data;
  assert.deepEqual(gd.nodeOf('w_whirl')!.node.requires, [{ ability: 'w_strike', prof: 30 }]);
  const def = gd.abilities.get('w_whirl')!;
  assert.equal(def.name, '큰 회오리');
  assert.equal(def.mp, 9);
  assert.equal(def.level, whirl0.level + 3);
  assert.equal(def.price, 900);
  assert.deepEqual(gd.designWarnings, []);

  // 파일: 스킬트리와 기술 파일의 그 기술 줄만 바뀌고, 다른 파일은 그대로, 임시 파일도 남지 않음
  assert.equal(changedLines(original.get('skilltrees.json')!, gdText('skilltrees.json')).length, 1);
  assert.equal(gdText('skilltrees.json'), formatSkillTrees(gd.skillTrees));
  const abLines = changedLines(original.get('abilities.json')!, gdText('abilities.json'));
  assert.equal(abLines.length, 1);
  assert.match(gdText('abilities.json').split('\n')[abLines[0]!]!, new RegExp(`"id":"w_whirl".*"name":"큰 회오리".*"level":${whirl0.level + 3}.*"price":900`));
  for (const [f, t] of original) if (f !== 'skilltrees.json' && f !== 'abilities.json') assert.equal(gdText(f), t, f);
  assert.deepEqual(fs.readdirSync(gdDir).sort(), [...original.keys(), 'maps'].sort());
  // 서버를 다시 켜도 같은 설계 (세 파일이 서로 맞음)
  const reloaded = GameData.load(gdDir);
  assert.deepEqual(reloaded.designWarnings, []);
  assert.equal(reloaded.abilities.get('w_whirl')!.name, '큰 회오리');

  // 판 기록: 저장하기 바로 전의 설계
  const files = historyFiles();
  assert.equal(files.length, 1);
  assert.match(files[0]!, /^\d{13}-skilltree-warrior\.json$/);
  const hist = JSON.parse(fs.readFileSync(path.join(historyDir(), files[0]!), 'utf8')) as {
    actor: string;
    summary: string;
    design: { skillTrees: SkillTreesConfig; abilities: { id: string; name: string; level: number }[] };
  };
  assert.match(hist.actor, /^web\(/);
  assert.match(hist.summary, new RegExp(`전사 트리: 큰 회오리 조건 \\(레벨 ${whirl0.level}→${whirl0.level + 3}.*이름 회오리 베기→큰 회오리`));
  assert.equal(hist.design.skillTrees.trees.warrior.nodes.find((n) => n.ability === 'w_whirl')!.level, whirl0.level);
  const oldWhirl = hist.design.abilities.find((a) => a.id === 'w_whirl')!;
  assert.equal(oldWhirl.name, '회오리 베기');
  assert.equal(oldWhirl.level, whirl0.level);

  // 접속자에게 새 설계
  const msg = await watcher.waitFor('design', () => true, mark);
  assert.equal(msg.abilities.find((a) => a.id === 'w_whirl')!.name, '큰 회오리');
  assert.deepEqual(msg.skillTrees.warrior.nodes.find((n) => n.ability === 'w_whirl')!.items, [{ item: 'mat_wolf_pelt', qty: 3 }]);
  assert.ok(!('conditions' in msg.progression.rebirth));
  // 감사 기록
  const audit = srv.world.audit.list(5);
  assert.ok(audit.some((e) => e.action === 'saveDesign' && e.target === '전사 트리' && /회오리/.test(e.detail ?? '')), JSON.stringify(audit));
});

test('그사이 다른 곳에서 저장했으면(판이 어긋나면) 409 로 거절하고 아무것도 바꾸지 않는다', async () => {
  const b = await bundle();
  const before = gdText('skilltrees.json');
  const tree = clone(b.skillTrees.trees.rogue);
  tree.nodes[0]!.gold = 123;
  const old = historyFiles().length;
  const r = await save('/design/skilltree/rogue', { rev: 'ffffffffffffffff', tree });
  assert.equal(r.status, 409);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.rev, b.rev, '서버의 판을 알려 줌');
  assert.equal(gdText('skilltrees.json'), before);
  assert.equal(historyFiles().length, old);
  assert.notEqual(srv.world.data.treeOf('rogue').nodes[0]!.gold, 123);
});

test('여러 곳을 한 번에 저장(PUT /design): 트리 둘과 성장 규칙을 판 기록 하나로, 칭호처럼 접속자의 상태도 다시 계산한다', async () => {
  const b = await bundle();
  const p = srv.world.findPlayer('구경꾼')!;
  p.data.ascended = true;
  const prog = clone(b.progression);
  prog.ascend.title = '대가';
  prog.second.beastTypes.push({ id: 'insect', name: '곤충' });
  const beast = clone(b.skillTrees.trees.beastkin);
  // 새 계통을 쓰는 노드와 그 계통을 더하는 성장 규칙을 함께 저장 (따로 저장하면 순서에 따라 거짓 오류)
  beast.nodes.find((n) => n.ability === 'k_bite')!.beastType = 'insect';
  const glad = clone(b.skillTrees.trees.gladiator);
  glad.nodes.find((n) => n.ability === 'g_whirl')!.requires.push({ ability: 'w_strike', prof: 50 });
  const before = historyFiles().length;
  const mark = watcher.mark;
  const body: DesignSaveBody = { rev: b.rev, progression: prog, skillTrees: { beastkin: beast, gladiator: glad } };
  const r = await save('/design', body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const files = historyFiles();
  assert.equal(files.length, before + 1);
  assert.match(files[files.length - 1]!, /^\d{13}-skilltree\.json$/, '여러 직업을 고치면 직업 없이');
  const gd = srv.world.data;
  assert.equal(gd.progression.ascend.title, '대가');
  assert.equal(gd.nodeOf('k_bite')!.node.beastType, 'insect');
  assert.ok(gd.nodeOf('g_whirl')!.node.requires.some((r) => r.ability === 'w_strike' && r.prof === 50));
  // 성장 규칙 파일: 칭호와 새 계통이 들어 있고, 서버를 다시 켜도 같은 설계
  assert.match(gdText('progression.json'), /"title": "대가"/);
  assert.match(gdText('progression.json'), /\{ "id": "insect", "name": "곤충" \}/);
  const reloaded = GameData.load(gdDir);
  assert.equal(reloaded.nodeOf('k_bite')!.node.beastType, 'insect');
  assert.deepEqual(reloaded.designWarnings, []);
  // 접속자: 새 설계와, 다시 계산한 내 상태(칭호)
  const d = await watcher.waitFor('design', () => true, mark);
  assert.equal(d.progression.ascend.title, '대가');
  assert.deepEqual(
    d.progression.second.beastTypes.map((x) => x.id),
    ['mammal', 'bird', 'reptile', 'insect'],
  );
  await watcher.self((s) => s.title === '대가', mark);
});

test('판 기록: 목록은 새것부터, 판 하나를 볼 수 있고, 되돌리면 파일과 게임이 그 판으로 돌아가며 되돌린 것도 기록에 남는다', async () => {
  const list = (await call<DesignHistoryList>('GET', '/design/history')).json;
  assert.equal(list.ok, true);
  assert.equal(list.entries.length, 2);
  assert.ok(list.entries[0]!.at > list.entries[1]!.at, '새것부터');
  const first = list.entries[1]!;
  assert.equal(first.kind, 'skilltree');
  assert.equal(first.classId, 'warrior');
  const detail = await call<DesignHistoryDetail>('GET', `/design/history/${first.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.entry.id, first.id);
  assert.equal(detail.json.design.skillTrees.trees.warrior.nodes.find((n) => n.ability === 'w_whirl')!.level, whirl0.level);
  assert.equal(detail.json.design.progression.ascend.title, '마스터');

  const b = await bundle();
  const mark = watcher.mark;
  const r = await save('/design/restore', { id: first.id, rev: b.rev }, 'POST');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.msg, /되돌렸습니다/);
  // 처음 파일과 글자 하나 다르지 않게 돌아옴
  for (const f of ['skilltrees.json', 'progression.json', 'abilities.json']) assert.equal(gdText(f), original.get(f), f);
  const gd = srv.world.data;
  assert.equal(gd.abilities.get('w_whirl')!.name, '회오리 베기');
  assert.equal(gd.abilities.get('w_whirl')!.level, whirl0.level);
  assert.equal(gd.progression.ascend.title, '마스터');
  assert.deepEqual(gd.designWarnings, []);
  await watcher.waitFor('design', (m) => m.progression.ascend.title === '마스터', mark);
  const after1 = (await call<DesignHistoryList>('GET', '/design/history')).json.entries;
  assert.equal(after1.length, 3);
  assert.equal(after1[0]!.kind, 'restore');
  assert.match(after1[0]!.summary, /판으로 되돌림/);
  // 되돌린 기록의 판은 되돌리기 바로 전 (칭호 '대가')
  const back = await call<DesignHistoryDetail>('GET', `/design/history/${after1[0]!.id}`);
  assert.equal(back.json.design.progression.ascend.title, '대가');
  assert.ok(srv.world.audit.list(3).some((e) => e.action === 'restoreDesign'));
  // 같은 설계를 다시 저장하면 바뀐 것이 없어 기록을 남기지 않음
  const same = await save('/design/progression', { rev: (await bundle()).rev, progression: gd.progression });
  assert.equal(same.status, 200);
  assert.match(same.json.msg, /바뀐 것이 없습니다/);
  assert.equal((await call<DesignHistoryList>('GET', '/design/history')).json.entries.length, 3);
});

test('요청 검사: 모르는 항목·잘못된 모양·다른 직업의 기술·몬스터 기술·너무 큰 본문·이상한 판 id 는 거절하고, 정해진 세 파일 말고는 쓰지 않는다', async () => {
  const b = await bundle();
  const before = new Map([...original.keys()].map((f) => [f, gdText(f)]));
  const histBefore = historyFiles();
  const tree = clone(b.skillTrees.trees.warrior);
  const cases: [string, string, unknown, number, RegExp?][] = [
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree, extra: 1 }, 400, /알 수 없는 항목 'extra'/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree: [1, 2] }, 400, /tree/],
    ['PUT', '/design/skilltree/warrior', { tree }, 400, /rev/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree, dryRun: 'yes' }, 400, /dryRun/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree, abilities: [{ id: 'r_stab', name: '찌르기2' }] }, 400, /이 직업의 기술이 아니/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree, abilities: [{ id: 'w_strike', name: 'x'.repeat(21) }] }, 400, /이름은 1~20자/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree: { nodes: [{ ability: 'w_strike', row: 0, col: 0, level: 5, gold: 0, __proto__x: 1 }] } }, 400, /__proto__x/],
    ['PUT', '/design', { rev: b.rev, abilities: [{ id: 'mon_poison', name: '독' }] }, 400, /몬스터 전용/],
    ['PUT', '/design/skilltree/warrior', { rev: b.rev, tree, abilities: [null] }, 400, /기술 수정은/],
    ['PUT', '/design', { rev: b.rev, abilities: ['w_strike'] }, 400, /기술 수정은/],
    ['PUT', '/design', { rev: b.rev, abilities: [{ id: 'w_strike', name: '강타\n[관리자] 가짜 기록' }] }, 400, /줄바꿈이나 제어 문자/],
    ['PUT', '/design/progression', { rev: b.rev, progression: { ...b.progression, ascend: { ...b.progression.ascend, title: '마\u0007스터' } } }, 400, /제어 문자/],
    ['PUT', '/design', { rev: b.rev, dryRun: true, skillTrees: JSON.parse('{"warrior":' + '['.repeat(40) + ']'.repeat(40) + '}') }, 400, /깊게/],
    ['PUT', '/design', { rev: b.rev, skillTrees: { pirate: tree } }, 400, /pirate/],
    ['PUT', '/design', { rev: b.rev, skillTrees: { warrior: { ...tree, nodes: [...tree.nodes, { ...tree.nodes[0]!, row: 39 }] } } }, 400, /두 번/],
    ['PUT', '/design/progression', { rev: b.rev, progression: { ...b.progression, version: 2 } }, 400, /version/],
    ['PUT', '/design/progression', { rev: b.rev }, 400, /progression/],
    ['POST', '/design/restore', { id: '../../../etc/passwd', rev: b.rev }, 404],
    ['POST', '/design/restore', { id: '1761000000000-skilltree-warrior', rev: b.rev }, 404],
    ['POST', '/design/restore', { id: 5, rev: b.rev }, 400],
    ['GET', '/design/history/..%2F..%2Fadmin-audit', undefined, 404],
    ['GET', '/design/history/1761000000000-skilltree-..', undefined, 404],
    ['PUT', '/design/skilltree/..%2Fprogression', { rev: b.rev, progression: b.progression }, 404],
    ['PUT', '/design/skilltree/pirate', { rev: b.rev, tree }, 404],
    ['DELETE', '/design', undefined, 405],
    ['PUT', '/design', '[1,2,3]', 400],
    ['PUT', '/design', '{"rev":', 400],
  ];
  for (const [method, p, body, status, re] of cases) {
    const r = await call<DesignSaveResult>(method, p, body);
    assert.equal(r.status, status, `${method} ${p} ${JSON.stringify(body)?.slice(0, 80)} → ${JSON.stringify(r.json).slice(0, 200)}`);
    if (re) assert.ok(re.test(`${r.json.msg} ${JSON.stringify(r.json.issues ?? [])}`), `${p}: ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  // 너무 큰 본문
  const big = await call('PUT', '/design', { rev: b.rev, pad: 'x'.repeat(300 * 1024) });
  assert.equal(big.status, 413);
  // 아무것도 바뀌지 않음
  for (const [f, t] of before) assert.equal(gdText(f), t, f);
  assert.deepEqual(historyFiles(), histBefore);
  assert.deepEqual(fs.readdirSync(gdDir).sort(), [...original.keys(), 'maps'].sort());
});

test('판 기록은 정해진 수만 남기고 오래된 것부터 지운다 (규칙에 맞지 않는 파일 이름은 건드리지 않음)', async () => {
  fs.mkdirSync(historyDir(), { recursive: true });
  const fake = { version: 1, actor: 'test', summary: '옛 판', design: { progression: {}, skillTrees: {}, abilities: [] } };
  for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(historyDir(), `${1_600_000_000_000 + i}-progression.json`), JSON.stringify(fake));
  fs.writeFileSync(path.join(historyDir(), 'memo.txt'), '관리자 메모');
  const b = await bundle();
  const tree: SkillTreeConfig = clone(b.skillTrees.trees.priest);
  tree.columns = ['치유', '보호'];
  const r = await save('/design/skilltree/priest', { rev: b.rev, tree });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const files = historyFiles().filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 200);
  assert.ok(!files.includes('1600000000000-progression.json'), '가장 오래된 것부터 지움');
  assert.ok(files.some((f) => /-skilltree-priest\.json$/.test(f)), '새 판은 남음');
  assert.ok(fs.existsSync(path.join(historyDir(), 'memo.txt')));
  const list = (await call<DesignHistoryList>('GET', '/design/history')).json.entries;
  assert.equal(list.length, 100, '목록은 새것부터 100개');
  assert.equal(list[0]!.classId, 'priest');
  // 망가진 판(설계가 비어 있음)으로는 되돌릴 수 없음: 검사 오류
  const broken = await save('/design/restore', { id: '1600000000204-progression', rev: r.json.rev }, 'POST');
  assert.equal(broken.status, 400);
  assert.ok(broken.json.issues.some((i) => i.level === 'error' && i.where.startsWith('progression.json')));
});

test('되돌리려는 판이 지금 데이터와 맞지 않으면(없는 기술) 400 과 이유를 알려 주고 아무것도 바꾸지 않는다', async () => {
  const b = await bundle();
  const design = {
    progression: b.progression,
    skillTrees: clone(b.skillTrees) as SkillTreesConfig,
    abilities: b.abilities.map((a) => ({ id: a.id, name: a.name, desc: a.desc, mp: a.mp, cooldownMs: a.cooldownMs, level: a.level, price: a.price })),
  };
  design.skillTrees.trees.warrior.nodes.push({ ability: 'w_removed', row: 30, col: 0, level: 50, gold: 0, items: [], requires: [] });
  const id = `${Date.now() - 1000}-skilltree-warrior`;
  fs.writeFileSync(path.join(historyDir(), `${id}.json`), JSON.stringify({ version: 1, id, actor: 'test', summary: '', design }));
  const before = gdText('skilltrees.json');
  const r = await save('/design/restore', { id, rev: b.rev }, 'POST');
  assert.equal(r.status, 400);
  assert.ok(r.json.issues.some((i) => i.level === 'error' && /w_removed/.test(i.msg)), JSON.stringify(r.json.issues));
  assert.equal(gdText('skilltrees.json'), before);
  const prog: ProgressionConfig = srv.world.data.progression;
  assert.equal(prog.ascend.title, '마스터');
});

test('손으로 고쳐 트리와 어긋난 기술의 레벨은, 바꾼 곳이 없어도 저장하면 트리에 맞춰 abilities.json 에 쓴다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-sync-'));
  const gd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-sync-gd-'));
  fs.cpSync(path.join(ROOT, 'gamedata'), gd2, { recursive: true });
  const file = path.join(gd2, 'abilities.json');
  const orig = fs.readFileSync(file, 'utf8');
  const edited = orig.replace(/("id":"w_whirl"[^\n]*?"level":)(\d+),/, (_m, head: string, lv: string) => `${head}${Number(lv) + 1},`);
  assert.notEqual(edited, orig);
  fs.writeFileSync(file, edited);
  const s2 = await startServer(testConfig(dir, { GAMEDATA_DIR: gd2 }));
  try {
    assert.ok(s2.world.data.designWarnings.some((w) => w.where === 'skilltrees.json(warrior/w_whirl)'), '불러올 때 경고');
    const base = `http://127.0.0.1:${s2.port}/api/admin`;
    const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PW }) });
    const auth = { Authorization: `Bearer ${String(((await login.json()) as { token: string }).token)}` };
    const rev = ((await (await fetch(`${base}/design`, { headers: auth })).json()) as DesignBundle).rev;
    const res = await fetch(`${base}/design`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ rev }) });
    const json = (await res.json()) as DesignSaveResult;
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.match(json.msg, /저장했습니다/);
    assert.equal(fs.readFileSync(file, 'utf8'), orig, '트리의 레벨로 맞춰 처음 파일 그대로');
    assert.deepEqual(s2.world.data.designWarnings, []);
    const hist = fs.readdirSync(path.join(dir, 'design-history'));
    assert.equal(hist.length, 1);
    assert.match((JSON.parse(fs.readFileSync(path.join(dir, 'design-history', hist[0]!), 'utf8')) as { summary: string }).summary, /레벨·가격을 스킬트리에 맞춤/);
  } finally {
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(gd2, { recursive: true, force: true });
  }
});

test('서버가 켜진 뒤 누가 gamedata 파일을 직접 고쳤으면, 그 파일을 덮어쓰게 되는 저장은 거절하고(412) 다른 파일만 쓰는 저장은 받는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-disk-'));
  const gd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-design-disk-gd-'));
  fs.cpSync(path.join(ROOT, 'gamedata'), gd2, { recursive: true });
  const s2 = await startServer(testConfig(dir, { GAMEDATA_DIR: gd2 }));
  try {
    const base = `http://127.0.0.1:${s2.port}/api/admin`;
    const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PW }) });
    const auth = { Authorization: `Bearer ${String(((await login.json()) as { token: string }).token)}` };
    const get = async () => (await (await fetch(`${base}/design`, { headers: auth })).json()) as DesignBundle;
    const put = async (p: string, body: unknown) => {
      const res = await fetch(`${base}${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as DesignSaveResult };
    };
    // 서버가 켜진 뒤 abilities.json 에 손으로 새 기술을 더함 (설명을 고친 것으로 흉내)
    const file = path.join(gd2, 'abilities.json');
    const hand = fs.readFileSync(file, 'utf8').replace('"name":"강타"', '"name":"강타 (손으로 고침)"');
    fs.writeFileSync(file, hand);
    const b = await get();
    assert.ok(b.warnings.some((w) => w.where === 'gamedata' && /abilities\.json/.test(w.msg)), JSON.stringify(b.warnings));
    // 기술 값을 고치는 저장은 abilities.json 을 쓰게 되므로 거절
    const r = await put('/design', { rev: b.rev, abilities: [{ id: 'w_strike', mp: 7 }] });
    assert.equal(r.status, 412, JSON.stringify(r.json));
    assert.match(r.json.msg, /서버 밖에서 바뀌어/);
    assert.equal(fs.readFileSync(file, 'utf8'), hand, '손으로 고친 내용 그대로');
    assert.notEqual(s2.world.data.abilities.get('w_strike')!.mp, 7, '게임에도 반영하지 않음');
    assert.equal(fs.existsSync(path.join(dir, 'design-history')) ? fs.readdirSync(path.join(dir, 'design-history')).length : 0, 0);
    // 성장 규칙만 바꾸는 저장은 abilities.json 을 쓰지 않으므로 받음
    const prog = clone(b.progression);
    prog.ascend.title = '대가';
    const ok = await put('/design/progression', { rev: b.rev, progression: prog });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(fs.readFileSync(file, 'utf8'), hand);
    assert.match(fs.readFileSync(path.join(gd2, 'progression.json'), 'utf8'), /"title": "대가"/);
  } finally {
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(gd2, { recursive: true, force: true });
  }
});
