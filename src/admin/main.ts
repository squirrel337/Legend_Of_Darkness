// 웹 관리자 페이지 (/admin)
import { CLASS_FALLBACK_NAMES, EQUIP_SLOT_NAMES, ROLE_NAMES, STAT_NAMES, type EquipSlot, type Role, type StatKey } from '../shared/constants';
import { clear, fmt, h } from '../client/ui/dom';
import { designDirty, renderDesign } from './design';
import type { ApiReply } from './design/state';

interface CharSummary {
  name: string;
  level: number;
  classId: string;
  role: Role;
  online: boolean;
  banned: boolean;
  mapId: string;
  gold: number;
  lastLoginAt: number;
  createdAt: number;
  ghost: boolean;
}

interface CharDetail extends CharSummary {
  exp: number;
  expNext: number;
  stats: Record<StatKey, number>;
  statPoints: number;
  bonusHp: number;
  bonusMp: number;
  hp: number;
  mp: number;
  x: number;
  y: number;
  inventory: ({ item: string; qty: number } | null)[];
  equipment: Record<EquipSlot, string | null>;
  skills: string[];
  spells: string[];
  storage: { item: string; qty: number }[];
  storageGold: number;
  kills: number;
  deaths: number;
  playTimeSec: number;
  godMode: boolean;
  banReason: string;
  lastIp: string;
  derived: { maxHp: number; maxMp: number; ac: number; str: number; int: number; wis: number; con: number; dex: number } | null;
  // 성장 체계 (docs/progression.md)
  rebirths?: number;
  ascended?: boolean;
  abilityLevel?: number;
  abilityExp?: number;
  beastType?: string | null;
  prof?: Record<string, number>;
}

interface GameDataResp {
  classes: { id: string; name: string }[];
  /** 수인 계통 (직업·스킬트리 탭에서 고침) */
  beastTypes?: { id: string; name: string }[];
  items: { id: string; name: string; type: string; slot: string | null; level: number }[];
  abilities: { id: string; name: string; kind: string; classId: string; level: number }[];
  maps: { id: string; name: string; spawn: { x: number; y: number }; levelRange: [number, number] | null }[];
  monsters: { id: string; name: string; level: number }[];
  maxLevel: number;
  statCap: number;
}

interface Status {
  serverName: string;
  uptimeSec: number;
  online: number;
  characters: number;
  memoryMb: number;
  maps: { id: string; name: string; players: number; monsters: number }[];
  settings: Record<string, unknown>;
  maxLevel: number;
  statCap: number;
}

type View = 'dash' | 'chars' | 'char' | 'design' | 'settings' | 'audit';
const VIEWS: readonly View[] = ['dash', 'chars', 'design', 'settings', 'audit'];

const app = document.getElementById('app')!;
const TOKEN_KEY = 'lod-admin-token';
let token: string | null = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}
/** 주소의 #design 같은 꼬리로 처음 볼 화면을 정함 (새로 고쳐도 같은 탭) */
let view: View = VIEWS.find((v) => location.hash === `#${v}`) ?? 'dash';
let currentChar = '';
let charQuery = '';
let gd: GameDataResp | null = null;
let refreshTimer = 0;
const main = h('main');

function saveToken(t: string | null): void {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장 불가 환경 */
  }
}

class AuthError extends Error {
  override name = 'AuthError';
}

/** 관리자 API 호출 (HTTP 상태와 함께). 로그인이 풀렸으면 로그인 화면으로 */
async function request<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<ApiReply<T>> {
  const res = await fetch('/api/admin' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({ ok: false, msg: '응답을 읽을 수 없습니다.' }))) as T & { ok: boolean; msg?: string };
  if (res.status === 401 && path !== '/login') {
    saveToken(null);
    render();
    throw new AuthError(json.msg ?? '로그인이 필요합니다.');
  }
  return { status: res.status, json };
}

async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T & { ok: boolean; msg?: string }> {
  return (await request<T>(body === undefined ? 'GET' : 'POST', path, body)).json;
}

let toastTimer = 0;
function toast(msg: string, ok = true): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast ${ok ? '' : 'error'}`, role: 'status' }, msg);
  document.body.appendChild(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 4000);
}

const className = (id: string) => gd?.classes.find((c) => c.id === id)?.name ?? CLASS_FALLBACK_NAMES[id as keyof typeof CLASS_FALLBACK_NAMES] ?? id;
const itemName = (id: string) => gd?.items.find((i) => i.id === id)?.name ?? id;
const abilityName = (id: string) => gd?.abilities.find((a) => a.id === id)?.name ?? id;
const mapName = (id: string) => gd?.maps.find((m) => m.id === id)?.name ?? id;
const when = (ms: number) => (ms ? new Date(ms).toLocaleString('ko-KR') : '-');
const beastName = (id: string) => gd?.beastTypes?.find((b) => b.id === id)?.name ?? id;
const dur = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  return `${d ? d + '일 ' : ''}${hh}시간 ${mm}분`;
};

// ───────────────────────── 로그인 ─────────────────────────

function renderLogin(): void {
  const pw = h('input', { type: 'password', placeholder: '관리자 비밀번호', autocomplete: 'current-password' });
  const msg = h('div', { class: 'muted' }, '서버를 처음 실행할 때 콘솔에 표시된 비밀번호(또는 .env 의 ADMIN_PASSWORD)를 입력하세요.');
  const submit = async (e: Event) => {
    e.preventDefault();
    const r = await api<{ token?: string }>('/login', { password: pw.value });
    if (r.ok && r.token) {
      saveToken(r.token);
      render();
    } else msg.textContent = r.msg ?? '로그인 실패';
  };
  app.replaceChildren(
    h(
      'div',
      { class: 'login' },
      h('form', { class: 'login-card', onsubmit: submit }, h('h1', null, '관리자 로그인'), h('div', { class: 'muted' }, '어둠의 전설 개인 서버'), pw, h('button', { class: 'btn primary', type: 'submit' }, '로그인'), msg),
    ),
  );
  pw.focus();
}

// ───────────────────────── 공통 ─────────────────────────

function render(): void {
  window.clearInterval(refreshTimer);
  if (!token) return renderLogin();
  const stats = h('div', { class: 'stats' });
  const navBtn = (id: View, label: string) =>
    h(
      'button',
      {
        class: view === id || (id === 'chars' && view === 'char') ? 'active' : '',
        onclick: () => {
          if (view === 'design' && id !== 'design' && designDirty()) toast('직업·스킬트리에 저장하지 않은 바뀐 곳이 있습니다. 탭으로 돌아오면 그대로 있습니다.', false);
          view = id;
          try {
            history.replaceState(null, '', id === 'dash' ? location.pathname : `#${id}`);
          } catch {
            /* 주소를 바꿀 수 없는 환경 */
          }
          render();
        },
      },
      label,
    );
  app.replaceChildren(
    h(
      'div',
      { class: 'top' },
      h('h1', null, '어둠의 전설 관리자'),
      stats,
      h('a', { class: 'btn small', href: '/', target: '_blank', rel: 'noopener' }, '게임 열기'),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            await api('/logout', {}).catch(() => undefined);
            saveToken(null);
            render();
          },
        },
        '로그아웃',
      ),
    ),
    h('nav', { class: 'nav' }, navBtn('dash', '대시보드'), navBtn('chars', '캐릭터'), navBtn('design', '직업·스킬트리'), navBtn('settings', '서버 설정'), navBtn('audit', '작업 기록')),
    main,
  );
  void loadTop(stats);
  void loadView();
}

async function loadTop(el: HTMLElement): Promise<void> {
  try {
    if (!gd) gd = (await api<GameDataResp>('/gamedata')) as GameDataResp;
    const r = await api<{ status: Status }>('/status');
    const s = r.status;
    el.replaceChildren(
      h('span', null, s.serverName),
      h('span', null, `접속 ${s.online}명`),
      h('span', null, `캐릭터 ${s.characters}명`),
      h('span', null, `가동 ${dur(s.uptimeSec)}`),
    );
  } catch (e) {
    if (!(e instanceof AuthError)) toast('서버 상태를 불러오지 못했습니다.', false);
  }
}

async function loadView(): Promise<void> {
  clear(main);
  main.className = view === 'design' ? 'wide' : '';
  main.append(h('div', { class: 'muted' }, '불러오는 중...'));
  try {
    if (!gd) gd = (await api<GameDataResp>('/gamedata')) as GameDataResp;
    if (view === 'dash') await renderDash();
    else if (view === 'chars') await renderChars();
    else if (view === 'char') await renderChar(currentChar);
    else if (view === 'design')
      await renderDesign(main, {
        request,
        toast,
        // 기술 이름·수인 계통이 바뀌었을 수 있으니 다른 탭이 쓰는 게임 데이터 목록을 다음에 새로 받음
        saved: () => (gd = null),
      });
    else if (view === 'settings') await renderSettings();
    else await renderAudit();
  } catch (e) {
    if (e instanceof AuthError) return;
    clear(main);
    main.append(h('div', { class: 'box' }, `오류: ${(e as Error).message}`));
  }
}

// ───────────────────────── 대시보드 ─────────────────────────

async function renderDash(): Promise<void> {
  const r = await api<{ status: Status }>('/status');
  const s = r.status;
  clear(main);
  const card = (label: string, value: string) => h('div', { class: 'card' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  const ann = h('input', { type: 'text', placeholder: '모든 접속자에게 보낼 공지', class: 'input-wide' });
  const rateInput = (k: string) => h('input', { type: 'number', step: '0.5', min: 0, value: String(s.settings[k]), class: 'input-num' });
  const exp = rateInput('expRate');
  const gold = rateInput('goldRate');
  const drop = rateInput('dropRate');
  main.append(
    h('div', { class: 'cards' }, card('접속 중', `${s.online}명`), card('전체 캐릭터', `${s.characters}명`), card('가동 시간', dur(s.uptimeSec)), card('메모리', `${s.memoryMb} MB`)),
    h(
      'div',
      { class: 'grid2' },
      h(
        'div',
        { class: 'box' },
        h('h2', null, '서버 배율'),
        h('div', { class: 'row' }, '경험치 x', exp, '골드 x', gold, '드롭 x', drop),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const res = await api('/settings', { expRate: Number(exp.value), goldRate: Number(gold.value), dropRate: Number(drop.value) });
              toast(res.msg ?? '', res.ok);
            },
          },
          '배율 적용',
        ),
        h('p', { class: 'hint' }, '바로 적용되고 서버를 다시 켜도 유지됩니다. 접속자에게 변경 공지가 나갑니다.'),
      ),
      h(
        'div',
        { class: 'box' },
        h('h2', null, '공지와 저장'),
        h(
          'div',
          { class: 'row' },
          ann,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                const res = await api('/announce', { text: ann.value });
                toast(res.msg ?? '', res.ok);
                if (res.ok) ann.value = '';
              },
            },
            '공지 보내기',
          ),
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const res = await api('/save', {});
              toast(res.msg ?? '', res.ok);
            },
          },
          '접속 중인 캐릭터 지금 저장',
        ),
      ),
    ),
    h(
      'div',
      { class: 'box' },
      h('h2', null, '지역별 현황'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, '지역'), h('th', null, 'ID'), h('th', { class: 'num' }, '플레이어'), h('th', { class: 'num' }, '몬스터'))),
          h('tbody', null, ...s.maps.map((m) => h('tr', null, h('td', null, m.name), h('td', { class: 'muted' }, m.id), h('td', { class: 'num' }, String(m.players)), h('td', { class: 'num' }, String(m.monsters))))),
        ),
      ),
    ),
  );
  refreshTimer = window.setInterval(() => {
    if (view === 'dash' && !document.hidden && !main.contains(document.activeElement)) void renderDash().catch(() => undefined);
  }, 10000);
}

// ───────────────────────── 캐릭터 목록 ─────────────────────────

async function renderChars(): Promise<void> {
  const r = await api<{ characters: CharSummary[] }>(`/characters?q=${encodeURIComponent(charQuery)}`);
  clear(main);
  const q = h('input', { type: 'search', placeholder: '이름으로 찾기', value: charQuery, class: 'input-wide' });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      charQuery = q.value;
      void renderChars();
    }
  });
  const rows = r.characters.map((c) =>
    h(
      'tr',
      {
        class: 'click',
        onclick: () => {
          currentChar = c.name;
          view = 'char';
          void loadView();
        },
      },
      h('td', null, h('b', null, c.name)),
      h('td', { class: 'num' }, String(c.level)),
      h('td', null, className(c.classId)),
      h('td', null, h('span', { class: `badge ${c.role !== 'player' ? 'admin' : ''}` }, ROLE_NAMES[c.role])),
      h(
        'td',
        null,
        c.online ? h('span', { class: 'badge on' }, '접속 중') : h('span', { class: 'badge' }, '오프라인'),
        c.banned ? h('span', { class: 'badge ban' }, ' 금지') : null,
        c.ghost ? h('span', { class: 'badge' }, ' 유령') : null,
      ),
      h('td', null, mapName(c.mapId)),
      h('td', { class: 'num' }, fmt(c.gold)),
      h('td', { class: 'muted' }, when(c.lastLoginAt)),
    ),
  );
  main.append(
    h(
      'div',
      { class: 'box' },
      h('div', { class: 'row' }, q, h('button', { class: 'btn', onclick: () => ((charQuery = q.value), void renderChars()) }, '검색')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h('tr', null, h('th', null, '이름'), h('th', { class: 'num' }, '레벨'), h('th', null, '직업'), h('th', null, '권한'), h('th', null, '상태'), h('th', null, '위치'), h('th', { class: 'num' }, '골드'), h('th', null, '마지막 접속')),
          ),
          h('tbody', null, ...rows),
        ),
      ),
      r.characters.length === 0 ? h('p', { class: 'muted' }, '캐릭터가 없습니다. 게임 화면에서 새 캐릭터를 만들어 보세요.') : null,
    ),
  );
  q.focus();
}

// ───────────────────────── 캐릭터 상세 ─────────────────────────

async function act(name: string, action: string, body: Record<string, unknown> = {}, confirmMsg?: string): Promise<void> {
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const r = await api<{ character: CharDetail | null }>(`/characters/${encodeURIComponent(name)}/${action}`, body);
  toast(r.msg ?? (r.ok ? '완료' : '실패'), r.ok);
  if (action === 'delete' && r.ok) {
    view = 'chars';
    return void loadView();
  }
  if (r.character) drawChar(r.character);
}

async function renderChar(name: string): Promise<void> {
  const r = await api<{ character: CharDetail }>(`/characters/${encodeURIComponent(name)}`);
  if (!r.ok) {
    clear(main);
    main.append(h('div', { class: 'box' }, r.msg ?? '캐릭터를 찾을 수 없습니다.'));
    return;
  }
  drawChar(r.character);
}

function drawChar(c: CharDetail): void {
  const data = gd!;
  clear(main);
  const name = c.name;
  const btn = (label: string, fn: () => void, cls = '') => h('button', { class: `btn small ${cls}`, onclick: fn }, label);
  const num = (value: number | string, w = 'input-num') => h('input', { type: 'text', value: String(value), class: w, inputmode: 'numeric' });
  const parse = (el: HTMLInputElement) => {
    const v = el.value.replace(/[,\s]/g, '');
    const m = /^(-?\d+(?:\.\d+)?)(만|억)?$/.exec(v);
    if (!m) return NaN;
    return Math.round(Number(m[1]) * (m[2] === '억' ? 1e8 : m[2] === '만' ? 1e4 : 1));
  };
  const classSel = (withCurrent: boolean) =>
    h(
      'select',
      null,
      ...(withCurrent ? [h('option', { value: '' }, '현재 직업 유지')] : []),
      ...data.classes.filter((x) => !withCurrent || x.id !== 'peasant').map((x) => h('option', { value: x.id, selected: !withCurrent && x.id === c.classId }, x.name)),
    );

  // 성장
  const maxCls = classSel(true);
  const lv = num(c.level);
  const exp = num('100만');
  const pts = num(100);
  const statInputs = (Object.keys(STAT_NAMES) as StatKey[]).map((k) => [k, num(c.stats[k])] as const);
  const bonusHp = num(c.bonusHp);
  const bonusMp = num(c.bonusMp);
  const cls = classSel(false);
  const gold = num('100만');
  const itemInput = h('input', { type: 'text', list: 'admin-items', placeholder: '아이템 이름 또는 ID', class: 'input-wide' });
  const itemQty = num(1);
  const learnInput = h('input', { type: 'text', list: 'admin-abilities', placeholder: '기술/마법 이름', class: 'input-wide' });
  const mapSel = h('select', null, ...data.maps.map((m) => h('option', { value: m.id, selected: m.id === c.mapId }, m.name)));
  const tx = num('', 'input-num');
  const ty = num('', 'input-num');
  tx.placeholder = 'x (생략 가능)';
  ty.placeholder = 'y (생략 가능)';
  const roleSel = h('select', null, ...(['player', 'gm', 'admin'] as Role[]).map((r) => h('option', { value: r, selected: r === c.role }, ROLE_NAMES[r])));
  const banReason = h('input', { type: 'text', placeholder: '금지 사유', class: 'input-wide' });
  const newPw = h('input', { type: 'password', placeholder: '새 비밀번호', autocomplete: 'new-password', class: 'input-num' });

  const derived = c.derived;
  const kv = (label: string, value: string) => h('div', null, h('span', null, label), h('b', null, value));
  const expText = c.expNext > 0 ? `${fmt(c.exp)} / ${fmt(c.expNext)}` : `${fmt(c.exp)} (만렙, 승급용)`;

  const inv = c.inventory
    .map((s, i) => (s ? { s, i } : null))
    .filter((x): x is { s: { item: string; qty: number }; i: number } => x !== null);

  main.append(
    h('button', { class: 'btn small back', onclick: () => ((view = 'chars'), void loadView()) }, '← 캐릭터 목록'),
    h(
      'div',
      { class: 'box' },
      h(
        'div',
        { class: 'detail-head' },
        h('h2', null, name),
        h('span', null, `${className(c.classId)} · ${c.level}레벨`),
        c.online ? h('span', { class: 'badge on' }, '접속 중') : h('span', { class: 'badge' }, '오프라인'),
        c.role !== 'player' ? h('span', { class: 'badge admin' }, ROLE_NAMES[c.role]) : null,
        c.banned ? h('span', { class: 'badge ban' }, `접속 금지 ${c.banReason ? `(${c.banReason})` : ''}`) : null,
        c.ghost ? h('span', { class: 'badge' }, '유령') : null,
        c.godMode ? h('span', { class: 'badge on' }, '무적') : null,
        h('button', { class: 'btn small', onclick: () => void renderChar(name) }, '새로고침'),
      ),
      h(
        'div',
        { class: 'kv' },
        kv('경험치', expText),
        kv('체력', derived ? `${fmt(c.hp)} / ${fmt(derived.maxHp)}` : fmt(c.hp)),
        kv('마나', derived ? `${fmt(c.mp)} / ${fmt(derived.maxMp)}` : fmt(c.mp)),
        kv('AC', derived ? String(derived.ac) : '-'),
        kv('골드 (창고)', `${fmt(c.gold)} (${fmt(c.storageGold)})`),
        kv('남은 능력치 포인트', String(c.statPoints)),
        kv('위치', `${mapName(c.mapId)} (${c.x}, ${c.y})`),
        kv('처치 / 사망', `${fmt(c.kills)} / ${fmt(c.deaths)}`),
        kv('플레이 시간', dur(c.playTimeSec)),
        kv('마지막 접속', when(c.lastLoginAt)),
        kv('마지막 IP', c.lastIp || '-'),
        kv('만든 날', when(c.createdAt)),
        // 성장 체계: 전직 횟수, 승급, 2차 직업의 어빌, 수인 계통
        kv('전직 횟수', `${c.rebirths ?? 0}번`),
        kv('승급', c.ascended ? '함' : '아직'),
        c.abilityLevel ? kv('어빌 (어빌 경험치)', `${c.abilityLevel} (${fmt(c.abilityExp ?? 0)})`) : null,
        c.classId === 'beastkin' ? kv('수인 계통', c.beastType ? beastName(c.beastType) : '아직 고르지 않음') : null,
      ),
    ),
    h(
      'div',
      { class: 'grid2' },
      h(
        'div',
        { class: 'box' },
        h('h2', null, '빠른 성장'),
        h('div', { class: 'row' }, btn('만렙 세팅', () => act(name, 'maxOut', maxCls.value ? { classId: maxCls.value } : {}), 'primary'), maxCls),
        h('p', { class: 'hint' }, `레벨 ${data.maxLevel} + 모든 능력치 ${data.statCap} + 모든 기술/마법 + 레벨에 맞는 최고 장비 + 완전 회복`),
        h('div', { class: 'row' }, btn('레벨 +1', () => act(name, 'addLevels', { n: 1 })), btn('레벨 +10', () => act(name, 'addLevels', { n: 10 })), lv, btn('레벨 설정', () => act(name, 'setLevel', { level: parse(lv) }))),
        h('div', { class: 'row' }, exp, btn('경험치 지급', () => act(name, 'addExp', { amount: parse(exp) })), h('span', { class: 'hint' }, '예: 100만, 1억')),
        h('div', { class: 'row' }, btn('모든 능력치 최대', () => act(name, 'maxStats')), btn('남은 포인트 자동 분배', () => act(name, 'autoStats')), btn('능력치 초기화', () => act(name, 'resetStats'))),
        h('div', { class: 'row' }, pts, btn('능력치 포인트 지급', () => act(name, 'addStatPoints', { n: parse(pts) }))),
        h('div', { class: 'row' }, btn('모든 기술/마법 배우기', () => act(name, 'learnAll')), btn('레벨에 맞는 최고 장비', () => act(name, 'giveGear'))),
        h('div', { class: 'row' }, cls, btn('직업 변경', () => act(name, 'setClass', { classId: cls.value }))),
      ),
      h(
        'div',
        { class: 'box' },
        h('h2', null, '능력치 직접 설정'),
        ...statInputs.map(([k, input]) => h('div', { class: 'row' }, h('span', { style: 'width:44px' }, STAT_NAMES[k]), input, btn('설정', () => act(name, 'setStat', { stat: k, value: parse(input) })))),
        h('div', { class: 'row' }, '승급 보너스 체력', bonusHp, '마나', bonusMp, btn('설정', () => act(name, 'setBonus', { hp: parse(bonusHp), mp: parse(bonusMp) }))),
        h('h2', { style: 'margin-top:14px' }, '골드'),
        h('div', { class: 'row' }, gold, btn('지급', () => act(name, 'addGold', { amount: parse(gold) })), btn('이 값으로 설정', () => act(name, 'setGold', { amount: parse(gold) }))),
      ),
    ),
    h(
      'div',
      { class: 'grid2' },
      h(
        'div',
        { class: 'box' },
        h('h2', null, '아이템'),
        h('datalist', { id: 'admin-items' }, ...data.items.map((i) => h('option', { value: i.name }, `${i.id}${i.level ? ` · Lv.${i.level}` : ''}`))),
        h('div', { class: 'row' }, itemInput, itemQty, btn('지급', () => act(name, 'giveItem', { item: itemInput.value, qty: parse(itemQty) || 1 }), 'primary')),
        h('div', { class: 'hint' }, '소지품이 가득 차면 창고로 들어갑니다.'),
        h('h2', { style: 'margin-top:12px' }, '장비'),
        h(
          'div',
          { class: 'chips' },
          ...(Object.keys(EQUIP_SLOT_NAMES) as EquipSlot[]).map((s) => h('span', { class: 'chip' }, `${EQUIP_SLOT_NAMES[s]}: ${c.equipment[s] ? itemName(c.equipment[s]!) : '없음'}`, ' ')),
        ),
        h('div', { class: 'row', style: 'margin-top:8px' }, btn('장비 모두 벗기기', () => act(name, 'unequipAll'))),
        h('h2', { style: 'margin-top:12px' }, `소지품 (${inv.length}/48)`),
        inv.length
          ? h('div', { class: 'chips' }, ...inv.map(({ s, i }) => h('span', { class: 'chip' }, `${itemName(s.item)}${s.qty > 1 ? ` x${s.qty}` : ''}`, h('button', { title: '제거', onclick: () => act(name, 'removeItem', { slot: i }) }, '×'))))
          : h('div', { class: 'muted' }, '비어 있음'),
        inv.length ? h('div', { class: 'row', style: 'margin-top:8px' }, btn('소지품 비우기', () => act(name, 'clearInventory', {}, '소지품을 모두 지울까요?'), 'danger')) : null,
        c.storage.length ? h('div', { class: 'hint', style: 'margin-top:8px' }, `창고: ${c.storage.map((s) => `${itemName(s.item)}${s.qty > 1 ? ` x${s.qty}` : ''}`).join(', ')}`) : null,
      ),
      h(
        'div',
        { class: 'box' },
        h('h2', null, `기술 ${c.skills.length} · 마법 ${c.spells.length}`, h('small', { class: 'muted', style: 'font-weight:400' }, ' (옆의 수는 숙련도)')),
        h('datalist', { id: 'admin-abilities' }, ...data.abilities.map((a) => h('option', { value: a.name }, `${className(a.classId)} · Lv.${a.level}`))),
        h('div', { class: 'row' }, learnInput, btn('배우게 하기', () => act(name, 'learnAbility', { query: learnInput.value }))),
        h(
          'div',
          { class: 'chips' },
          ...[...c.skills, ...c.spells].map((id) =>
            h(
              'span',
              { class: 'chip', title: c.prof?.[id] !== undefined ? `숙련도 ${c.prof[id]}` : '' },
              abilityName(id),
              c.prof?.[id] !== undefined ? h('small', { class: 'muted' }, ` ${c.prof[id]}`) : null,
              h('button', { title: '잊게 하기', onclick: () => act(name, 'forgetAbility', { id }) }, '×'),
            ),
          ),
        ),
        h('h2', { style: 'margin-top:14px' }, '상태'),
        h('div', { class: 'row' }, btn('완전 회복', () => act(name, 'heal')), btn('부활', () => act(name, 'revive')), btn(c.godMode ? '무적 끄기' : '무적 켜기', () => act(name, 'setGod', { on: !c.godMode }))),
        h('h2', { style: 'margin-top:14px' }, '이동'),
        h('div', { class: 'row' }, mapSel, tx, ty, btn('이동시키기', () => act(name, 'teleport', { map: mapSel.value, x: tx.value || undefined, y: ty.value || undefined }))),
      ),
    ),
    h(
      'div',
      { class: 'box' },
      h('h2', null, '계정 관리'),
      h('div', { class: 'row' }, '권한', roleSel, btn('권한 변경', () => act(name, 'setRole', { role: roleSel.value })), h('span', { class: 'hint' }, '운영자(GM)/관리자는 게임 안에서 F2 운영자 도구와 / 명령어를 쓸 수 있습니다.')),
      h('div', { class: 'row' }, newPw, btn('비밀번호 바꾸기', () => act(name, 'setPassword', { password: newPw.value }))),
      h(
        'div',
        { class: 'row' },
        banReason,
        c.banned ? btn('접속 금지 해제', () => act(name, 'unban')) : btn('접속 금지', () => act(name, 'ban', { reason: banReason.value }, `${name}의 접속을 금지할까요?`), 'danger'),
        c.online ? btn('강제 접속 종료', () => act(name, 'kick', { reason: banReason.value })) : null,
      ),
      h(
        'div',
        { class: 'row' },
        btn(
          '캐릭터 삭제',
          () => {
            const typed = window.prompt(`삭제하려면 캐릭터 이름(${name})을 입력하세요. 되돌릴 수 없습니다.`);
            if (typed === name) void act(name, 'delete');
          },
          'danger',
        ),
      ),
    ),
  );
}

// ───────────────────────── 설정 ─────────────────────────

async function renderSettings(): Promise<void> {
  const r = await api<{ settings: Record<string, string | number> }>('/settings');
  const s = r.settings;
  clear(main);
  const field = (key: string, label: string, input: HTMLInputElement | HTMLSelectElement, hint?: string) =>
    h('div', { class: 'row' }, h('label', { style: 'width:150px' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const text = (k: string, wide = true) => h('input', { type: 'text', value: String(s[k] ?? ''), class: wide ? 'input-wide' : 'input-num' });
  const number = (k: string, step = '1') => h('input', { type: 'number', step, value: String(s[k] ?? 0), class: 'input-num' });
  const serverName = text('serverName');
  const motd = text('motd');
  const exp = number('expRate', '0.5');
  const gold = number('goldRate', '0.5');
  const drop = number('dropRate', '0.5');
  const reg = h('select', null, ...[['open', '누구나 가입'], ['invite', '초대 코드 필요'], ['closed', '가입 막기']].map(([v, l]) => h('option', { value: v, selected: s.registration === v }, l)));
  const invite = text('inviteCode', false);
  const death = number('deathExpPenalty', '0.01');
  const startLevel = number('startLevel');
  const classLevel = number('classLevel');
  main.append(
    h(
      'div',
      { class: 'box' },
      h('h2', null, '서버 설정 (실행 중에 바로 적용)'),
      field('serverName', '서버 이름', serverName),
      field('motd', '접속 인사말', motd),
      field('expRate', '경험치 배율', exp),
      field('goldRate', '골드 배율', gold),
      field('dropRate', '드롭 배율', drop),
      field('registration', '새 캐릭터 생성', reg, '"초대 코드 필요"면 아래 코드를 아는 사람만 만들 수 있습니다.'),
      field('inviteCode', '초대 코드', invite),
      field('deathExpPenalty', '사망 경험치 손실', death, '0 ~ 1 (0.05 = 현재 레벨 경험치의 5%)'),
      field('startLevel', '새 캐릭터 시작 레벨', startLevel),
      field('classLevel', '직업 선택 레벨', classLevel),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const res = await api('/settings', {
              serverName: serverName.value,
              motd: motd.value,
              expRate: Number(exp.value),
              goldRate: Number(gold.value),
              dropRate: Number(drop.value),
              registration: reg.value,
              inviteCode: invite.value,
              deathExpPenalty: Number(death.value),
              startLevel: Number(startLevel.value),
              classLevel: Number(classLevel.value),
            });
            toast(res.msg ?? '', res.ok);
          },
        },
        '저장',
      ),
      h('p', { class: 'hint' }, '포트, 데이터 폴더, 관리자 비밀번호, 최대 레벨 같은 설정은 .env 파일에서 바꾸고 서버를 다시 시작하세요.'),
    ),
  );
}

// ───────────────────────── 작업 기록 ─────────────────────────

async function renderAudit(): Promise<void> {
  const r = await api<{ entries: { at: number; actor: string; action: string; target?: string; detail?: string }[] }>('/audit');
  clear(main);
  main.append(
    h(
      'div',
      { class: 'box' },
      h('h2', null, '관리자 작업 기록 (최근 200개)'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, '시각'), h('th', null, '누가'), h('th', null, '작업'), h('th', null, '대상'), h('th', null, '내용'))),
          h(
            'tbody',
            null,
            ...r.entries.map((e) => h('tr', null, h('td', { class: 'muted' }, when(e.at)), h('td', null, e.actor), h('td', null, e.action), h('td', null, e.target ?? ''), h('td', { style: 'white-space:normal' }, e.detail ?? ''))),
          ),
        ),
      ),
    ),
  );
}

render();
