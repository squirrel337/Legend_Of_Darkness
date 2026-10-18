// 게임 클라이언트 본체: 서버 메시지 처리, 입력, 이동 예측, 화면 갱신
import {
  DIR_DX,
  DIR_DY,
  NPC_TALK_RANGE,
  dirTowards,
  type Dir,
} from '../shared/constants';
import type { S2C } from '../shared/protocol';
import type { PublicServerInfo } from '../shared/types';
import { Net } from './net';
import { AssailPacer } from './assail';
import { chebyshev, isAlly, isHostile } from './state';
import { Renderer } from './render/renderer';
import { ClientState, entityFromSnapshot, entityPos, snapTo, startMove, type CEntity } from './state';
import { AutoHuntUi, installAutoKeys } from './ui/autohunt';
import { ChatBox } from './ui/chat';
import { CharWindow } from './ui/charwin';
import { h } from './ui/dom';
import { BottomFrame } from './ui/frame';
import { GmTool } from './ui/gm';
import { Help } from './ui/help';
import { Hud } from './ui/hud';
import { LoginScreen } from './ui/login';
import { Panel } from './ui/panel';
import { Tooltip } from './ui/tooltip';
import { Windows } from './ui/windows';

const ARROWS: Record<string, Dir> = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
const DEATH_FADE_MS = 500;

/** 클릭 이동이 끝나면 할 일. range 가 있으면 활로 다가가는 중: 그 사거리 안에 들어오면 멈추고 쏨 */
type Pending = { kind: 'talk' | 'pickup' | 'approach'; id: number; range?: number } | null;

export class Game {
  readonly state = new ClientState();
  readonly net = new Net();
  readonly renderer: Renderer;
  frame!: BottomFrame;
  hud!: Hud;
  chat!: ChatBox;
  charWin!: CharWindow;
  panel!: Panel;
  windows!: Windows;
  gm!: GmTool;
  help!: Help;
  tooltip: Tooltip;
  private login: LoginScreen | null = null;
  private ingame = false;
  private server: PublicServerInfo | null = null;
  private heldDirs: Dir[] = [];
  private attackHeld = false;
  /** 평타 연타 간격 (서버가 알려 주는 실제 간격) */
  private readonly assail = new AssailPacer();
  private path: Dir[] = [];
  private pending: Pending = null;
  private lastHudTick = 0;
  private lastMinimap = 0;
  private kickReason = '';
  private overlay: HTMLElement | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly root: HTMLElement,
  ) {
    this.renderer = new Renderer(canvas, this.state);
    this.tooltip = new Tooltip(root);
  }

  start(): void {
    this.net.setHandler((m) => this.handle(m));
    this.net.onClose = (_code, reason) => this.onDisconnect(reason);
    this.login = new LoginScreen(this.root, {
      login: (name, password) => this.net.send({ t: 'login', name, password }),
      create: (o) => this.net.send({ t: 'create', ...o }),
    });
    this.net.connect();
    window.addEventListener('resize', () => this.renderer.resize());
    this.renderer.resize();
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => {
      this.heldDirs = [];
      this.attackHeld = false;
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.renderer.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    this.canvas.addEventListener('mouseleave', () => (this.renderer.mouse = null));
    this.canvas.addEventListener('click', (e) => this.onCanvasClick(e, false));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onCanvasClick(e, true);
    });
    requestAnimationFrame(this.loop);
  }

  // ───────────────────────── 화면 전환 ─────────────────────────

  private enterGame(): void {
    this.login?.destroy();
    this.login = null;
    if (this.ingame) return;
    this.ingame = true;
    this.root.classList.add('ingame');
    document.body.classList.add('ingame');
    this.frame = new BottomFrame(this.root);
    this.chat = new ChatBox(this.root, this.frame, (text) => this.sendChat(text));
    this.hud = new Hud(this.root, this.frame, this);
    this.windows = new Windows(this.root, this);
    this.gm = new GmTool(this.root, this);
    this.help = new Help(this.root);
    this.charWin = new CharWindow(this.root, this);
    this.panel = new Panel(this.frame, this);
    this.renderer.resize();
  }

  private onDisconnect(reason: string): void {
    if (this.overlay) return;
    const msg = this.kickReason || reason || '서버와의 연결이 끊어졌습니다.';
    if (!this.ingame && this.login) {
      this.login.error(`서버에 연결할 수 없습니다. ${msg === '서버와의 연결이 끊어졌습니다.' ? '' : msg} 잠시 후 새로고침 해 주세요.`);
    }
    this.overlay = h(
      'div',
      { class: 'disconnect' },
      h('div', { class: 'disconnect-box' }, h('h2', null, '연결 끊김'), h('p', null, msg), h('button', { class: 'btn primary', onclick: () => location.reload() }, '다시 접속')),
    );
    if (this.ingame) this.root.appendChild(this.overlay);
  }

  // ───────────────────────── 서버 메시지 ─────────────────────────

  private handle(m: S2C): void {
    const st = this.state;
    const now = performance.now();
    switch (m.t) {
      case 'hello':
        this.server = m.server;
        this.login?.setServer(m.server);
        document.title = `${m.server.name} — 어둠의 전설`;
        break;
      case 'authFail':
        this.login?.error(m.msg);
        break;
      case 'welcome':
        st.setData(m.data);
        st.selfId = m.selfId;
        this.enterGame();
        break;
      case 'self': {
        const prev = st.self;
        st.self = m.s;
        st.gold = m.s.gold;
        this.hud.updateSelf();
        this.hud.updateFace();
        this.panel.updateButtons();
        if (this.panel.tab === 'stats') this.panel.render('stats');
        this.charWin.refresh();
        if (prev && prev.role !== m.s.role) this.gm.close();
        break;
      }
      case 'vitals':
        if (st.self) {
          st.self.hp = m.hp;
          st.self.mp = m.mp;
          st.self.maxHp = m.maxHp;
          st.self.maxMp = m.maxMp;
          this.hud.updateVitals();
        }
        break;
      case 'inv':
        st.inventory = m.slots;
        st.gold = m.gold;
        if (this.panel.tab === 'inv') this.panel.render('inv');
        this.hud.updateGold();
        this.windows.refreshShopGold();
        this.charWin.refresh();
        break;
      case 'abilities':
        st.skills = m.skills;
        st.spells = m.spells;
        if (this.panel.tab === 'skills' || this.panel.tab === 'spells') this.panel.render();
        break;
      case 'cooldown':
        // 'assail' 은 기술의 재사용 대기가 아니라 평타 연타 간격 (기술 칸에는 표시하지 않음)
        if (m.id === 'assail') this.assail.confirmed(m.ms, now);
        else st.cooldowns.set(m.id, { start: now, end: now + m.ms });
        break;
      case 'map':
        st.setMap(m.map);
        for (const e of m.entities) st.entities.set(e.id, entityFromSnapshot(e));
        this.path = [];
        this.pending = null;
        this.windows.closeAll();
        this.hud.updateMap();
        break;
      case 'add': {
        const e = entityFromSnapshot(m.e);
        const old = st.entities.get(e.id);
        if (old && old.id === st.selfId) {
          // 내 캐릭터 정보 갱신 (위치는 유지)
          old.look = e.look;
          old.ghost = e.ghost;
          old.level = e.level;
          old.role = e.role;
          old.classId = e.classId;
          old.statuses = e.statuses;
          snapTo(old, e.x, e.y);
        } else st.entities.set(e.id, e);
        if (e.id === st.selfId) {
          this.hud.updateMap();
          this.hud.updateFace();
        }
        break;
      }
      case 'remove': {
        const e = st.entities.get(m.id);
        if (!e) break;
        if (m.fx === 'death') {
          e.dying = now;
          setTimeout(() => {
            if (st.entities.get(m.id) === e) st.entities.delete(m.id);
          }, DEATH_FADE_MS);
        } else st.entities.delete(m.id);
        if (st.targetId === m.id) st.targetId = null;
        break;
      }
      case 'walk': {
        const e = st.entities.get(m.id);
        if (!e) break;
        e.dir = m.dir;
        startMove(e, m.x, m.y, now);
        break;
      }
      case 'turn': {
        const e = st.entities.get(m.id);
        if (e && (e.id !== st.selfId || this.autoOn)) e.dir = m.dir;
        break;
      }
      case 'jump': {
        const e = st.entities.get(m.id);
        if (!e) break;
        snapTo(e, m.x, m.y);
        e.dir = m.dir;
        if (e.id === st.selfId) this.path = [];
        break;
      }
      case 'pos': {
        const me = st.me;
        if (!me) break;
        snapTo(me, m.x, m.y);
        me.dir = m.dir;
        this.path = [];
        break;
      }
      case 'act': {
        const e = st.entities.get(m.id);
        if (!e) break;
        e.actKind = m.a;
        e.actStart = now;
        if (e.id !== st.selfId || this.autoOn) e.dir = m.dir;
        break;
      }
      case 'dmg': {
        const e = st.entities.get(m.id);
        if (!e) break;
        e.hpPct = m.hp;
        if (m.k !== 'heal' && m.k !== 'mp' && m.k !== 'miss' && m.v > 0) {
          e.hitFlash = now;
          e.showHpUntil = now + 5000;
        }
        if (m.v > 0 || m.k === 'miss' || m.k === 'immune') {
          this.renderer.effects.damage(e.id, this.renderer.entityPoint(e, now), m.v, m.k, e.id === st.selfId, now);
        }
        break;
      }
      case 'fx': {
        const target = m.id !== undefined ? st.entities.get(m.id) : undefined;
        const from = m.from !== undefined ? st.entities.get(m.from) : undefined;
        const at = target ? this.renderer.entityPoint(target, now) : m.x !== undefined && m.y !== undefined ? { sx: (m.x - m.y) * 32, sy: (m.x + m.y) * 16 + 16 } : null;
        if (!at) break;
        this.renderer.effects.fx(m.fx, m.el, target?.id ?? null, at, from?.id ?? null, from ? this.renderer.entityPoint(from, now) : null, now, from?.dir);
        if (m.fx === 'levelup' && target) this.renderer.effects.text(target.id, at, 'LEVEL UP!', '#ffe066', now, 18, 1800);
        break;
      }
      case 'look': {
        const e = st.entities.get(m.id);
        if (!e) break;
        e.look = m.look;
        e.ghost = m.ghost;
        e.level = m.level;
        e.classId = m.classId;
        e.role = m.role;
        if (e.id === st.selfId) {
          this.charWin.refresh();
          this.hud.updateFace();
        }
        break;
      }
      case 'statuses': {
        const e = st.entities.get(m.id);
        if (e) e.statuses = m.statuses;
        break;
      }
      case 'chat': {
        this.chat.add(m.ch, m.text, m.from);
        if (m.id !== undefined && (m.ch === 'say' || m.ch === 'shout')) {
          const e = st.entities.get(m.id);
          if (e) e.bubble = { text: m.text, until: now + 4000 };
        }
        break;
      }
      case 'dialog':
        this.windows.showDialog(m.npc, m.name, m.title, m.text, m.options);
        break;
      case 'shop':
        this.windows.showShop(m.npc, m.name, m.items, m.sell);
        break;
      case 'learn':
        this.windows.showLearn(m.npc, m.name, m.list);
        break;
      case 'storage':
        this.windows.showStorage(m.npc, m.slots, m.gold);
        break;
      case 'closeDialog':
        this.windows.closeAll();
        break;
      case 'group':
        st.group = m.members;
        this.hud.updateGroup(m.members);
        break;
      case 'groupInvite':
        this.windows.showInvite(m.from);
        break;
      case 'notice':
        this.hud.notice(m.text, m.kind);
        break;
      case 'levelUp':
        break;
      case 'gain': {
        this.hud.gain(m.exp, m.gold);
        const me = st.me;
        if (me && m.exp > 0) this.renderer.effects.text(me.id, this.renderer.entityPoint(me, now), `+${m.exp.toLocaleString('ko-KR')} EXP`, '#c9a7ff', now, 12, 1300);
        break;
      }
      case 'kick':
        this.kickReason = m.reason;
        break;
      case 'pong':
        break;
      case 'auto':
        this.onAuto(m);
        break;
    }
  }

  // ───────────────────────── 루프 ─────────────────────────

  private loop = (): void => {
    const now = performance.now();
    if (this.ingame && this.state.me) {
      this.updateMovement(now);
      if (this.attackHeld) this.tryAttack(now);
      this.renderer.render(now);
      this.panel.tickCooldowns(now);
      if (now - this.lastHudTick > 200) {
        this.lastHudTick = now;
        this.hud.tick();
        this.windows.checkDistance();
      }
      if (now - this.lastMinimap > 150 && this.hud.showMinimap) {
        this.lastMinimap = now;
        this.renderer.drawMinimap(this.hud.minimap, now);
      }
    } else if (this.ingame) {
      this.renderer.render(now);
    }
    requestAnimationFrame(this.loop);
  };

  private updateMovement(now: number): void {
    const st = this.state;
    const me = st.me;
    const self = st.self;
    if (!me || !self) return;
    // 자동사냥 중에는 서버가 걷게 합니다 (클라이언트는 걷기를 보내지 않음)
    if (this.autoOn) return;
    const pos = entityPos(me, now);
    if (pos.moving && pos.t < 0.82) return;
    const held = this.heldDirs.length ? this.heldDirs[this.heldDirs.length - 1]! : null;
    const dir: Dir | null = held ?? this.path[0] ?? null;
    if (dir === null) {
      if (!pos.moving && this.pending) this.arrive();
      return;
    }
    if (me.statuses.includes('sleep') || me.statuses.includes('paralyze')) return;
    const nx = me.x + DIR_DX[dir]!;
    const ny = me.y + DIR_DY[dir]!;
    const blocked = !st.walkable(nx, ny) || st.blockedByEntity(nx, ny, self.ghost);
    if (blocked) {
      if (me.dir !== dir) {
        me.dir = dir;
        this.net.send({ t: 'turn', dir });
      }
      if (held === null) {
        // 경로가 막혔으면 다시 계산 (활로 다가가는 중이면 대상의 지금 자리에서 사거리 안까지만, 이미 안이면 쏨)
        const goal = this.renderer.walkTarget;
        this.path = [];
        if (this.pending?.range) this.resumeRanged();
        else if (goal && (goal.x !== me.x || goal.y !== me.y)) {
          const p = this.findPath(me.x, me.y, goal.x, goal.y, this.pending !== null);
          if (p) this.path = p;
          else this.pending = null;
        }
      }
      return;
    }
    if (held === null) this.path.shift();
    else {
      this.path = [];
      this.pending = null;
    }
    me.dir = dir;
    this.net.send({ t: 'walk', dir, x: me.x, y: me.y });
    startMove(me, nx, ny, now);
    if (st.isWarp(nx, ny)) this.path = [];
    // 활로 다가가는 중: 이 걸음으로 사거리 안에 들어오면 더 걷지 않음 (멈추면 arrive 에서 쏨)
    if (this.pendingInRange(nx, ny)) this.path = [];
  }

  /** 클릭 이동이 끝났을 때 예약된 행동 */
  private arrive(): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    const st = this.state;
    const me = st.me;
    const e = st.entities.get(p.id);
    if (!me || !e) return;
    if (p.kind === 'talk') this.talkTo(e);
    else if (p.kind === 'pickup' && e.x === me.x && e.y === me.y) this.net.send({ t: 'pickup' });
    // 활: 사거리 안이면 쏘고, 그동안 대상이 물러났으면 지금 자리 기준으로 다시 다가감
    else if (p.kind === 'approach' && p.range && isHostile(e)) this.approachRanged(e, p.range);
    else if (p.kind === 'approach') this.faceTowards(e);
  }

  private faceTowards(e: CEntity): void {
    const me = this.state.me;
    if (!me) return;
    const d = dirTowards(me.x, me.y, e.x, e.y);
    if (d !== null && d !== me.dir) {
      me.dir = d;
      this.net.send({ t: 'turn', dir: d });
    }
  }

  // ───────────────────────── 자동사냥 ─────────────────────────
  // 자동사냥은 서버가 대신 움직이고 싸웁니다. 켜져 있는 동안 클라이언트는 걷기를 보내지 않고,
  // 서버가 보내는 걸음/방향을 그대로 그립니다. 방향키나 땅 클릭으로 직접 움직이면 꺼집니다.

  /** 서버가 알려 준 자동사냥 상태 */
  autoOn = false;
  private autoUiInst: AutoHuntUi | null = null;
  /** 사용자가 끄기를 눌렀는지 (꺼진 이유 알림의 색) */
  private autoUserOff = false;
  /** Shift+Z: 자동사냥 설정 창, Esc: 닫기 (해제 함수) */
  private readonly autoKeysOff = installAutoKeys(
    () => this.ingame,
    () => this.openAutoSettings(),
    () => this.autoUiInst?.closeSettings() ?? false,
  );

  private get autoUi(): AutoHuntUi {
    this.autoUiInst ??= new AutoHuntUi(this.root, this);
    return this.autoUiInst;
  }

  /** 자동사냥 켜기/끄기 (Z 키, 패널의 '자동' 단추) */
  toggleAuto(): void {
    if (!this.ingame) return;
    if (this.autoOn) {
      this.autoUserOff = true;
      this.net.send({ t: 'auto', on: false });
      this.setAutoLocal(false);
      return;
    }
    this.autoUserOff = false;
    this.path = [];
    this.pending = null;
    this.net.send({ t: 'auto', on: true, settings: this.autoUi.settings() });
  }

  /** 자동사냥 설정 창 (Shift+Z, '자동' 단추 오른쪽 클릭) */
  openAutoSettings(): void {
    if (this.ingame) this.autoUi.openSettings();
  }

  /** 설정 창에서 값을 바꿨을 때: 켜져 있으면 새 설정으로 이어 갑니다 */
  autoSettingsChanged(): void {
    if (this.autoOn) this.net.send({ t: 'auto', on: true, settings: this.autoUi.settings() });
  }

  private setAutoLocal(on: boolean, state?: Extract<S2C, { t: 'auto' }>['state']): void {
    this.autoOn = on;
    this.panel.setAuto(on);
    this.autoUi.setState(on, state);
  }

  private onAuto(m: Extract<S2C, { t: 'auto' }>): void {
    const was = this.autoOn;
    if (m.on) {
      // 서버가 움직이므로 클릭 이동 예약은 버립니다
      this.path = [];
      this.pending = null;
      this.heldDirs = [];
    }
    this.setAutoLocal(m.on, m.state);
    if (m.on && !was) this.hud.notice('자동사냥을 시작합니다. (Z: 끄기 · Shift+Z: 설정)', 'good');
    if (!m.on && m.reason) this.hud.notice(m.reason, this.autoUserOff ? 'info' : 'warn');
    if (!m.on) this.autoUserOff = false;
  }

  /** 사용자가 직접 움직이면 자동사냥을 끕니다 */
  private cancelAuto(): void {
    if (!this.autoOn) return;
    this.autoUserOff = true;
    this.net.send({ t: 'auto', on: false });
    // 서버의 답을 기다리지 않고 바로 직접 조작으로 넘어갑니다
    this.setAutoLocal(false);
  }

  // ───────────────────────── 행동 ─────────────────────────

  sendChat(text: string): void {
    this.net.send({ t: 'chat', text });
  }

  recall(): void {
    this.net.send({ t: 'recall' });
  }

  /** 인접한 공격 대상: 지정한 대상 우선, 없으면 바라보는 쪽, 그다음 아무 인접 몬스터 (소환수 제외) */
  private adjacentEnemy(): CEntity | null {
    const st = this.state;
    const me = st.me;
    if (!me) return null;
    const adj = (e: CEntity) => isHostile(e) && Math.abs(e.x - me.x) + Math.abs(e.y - me.y) === 1;
    const t = st.targetId !== null ? st.entities.get(st.targetId) : undefined;
    if (t && adj(t)) return t;
    const fx = me.x + DIR_DX[me.dir]!;
    const fy = me.y + DIR_DY[me.dir]!;
    let any: CEntity | null = null;
    for (const e of st.entities.values()) {
      if (!adj(e)) continue;
      if (e.x === fx && e.y === fy) return e;
      any ??= e;
    }
    return any;
  }

  /** 장착한 무기의 사거리 (1 = 근접, 활은 더 김) */
  private weaponRange(): number {
    return Math.max(1, this.state.self?.stats.range ?? 1);
  }

  /** 원거리 평타 대상: 지정한 적이 사거리 안이면 그 적, 아니면 사거리 안의 가장 가까운 적 (바라보는 쪽 우선) */
  private rangedTarget(range: number): CEntity | null {
    const st = this.state;
    const me = st.me;
    if (!me) return null;
    const inRange = (e: CEntity) => isHostile(e) && !(e.x === me.x && e.y === me.y) && chebyshev(e.x, e.y, me.x, me.y) <= range;
    const t = st.targetId !== null ? st.entities.get(st.targetId) : undefined;
    if (t && inRange(t)) return t;
    let best: CEntity | null = null;
    let bestScore = Infinity;
    for (const e of st.entities.values()) {
      if (!inRange(e)) continue;
      const facing = dirTowards(me.x, me.y, e.x, e.y) === me.dir;
      // 가까운 순 (같으면 바라보는 쪽, 그다음 가로·세로 거리가 짧은 쪽)
      const score = chebyshev(e.x, e.y, me.x, me.y) - (facing ? 0.5 : 0) + (Math.abs(e.x - me.x) + Math.abs(e.y - me.y)) * 0.01;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    // 지정한 대상이 없거나 사라졌으면 자동으로 고른 적을 대상으로
    if (best && (!t || !isHostile(t))) st.targetId = best.id;
    return best;
  }

  private tryAttack(now: number): void {
    if (!this.assail.ready(now)) return;
    const me = this.state.me;
    const self = this.state.self;
    if (!me || self?.ghost) return;
    const pos = entityPos(me, now);
    if (pos.moving && pos.t < 0.6) return;
    const range = this.weaponRange();
    if (range > 1) {
      // 활: 붙지 않아도 사거리 안의 적을 겨눔
      const t = this.rangedTarget(range);
      if (t) {
        this.faceTowards(t);
        this.net.send({ t: 'attack', target: t.id });
      } else this.net.send({ t: 'attack' });
    } else {
      const t = this.adjacentEnemy();
      if (t) this.faceTowards(t);
      this.net.send({ t: 'attack' });
    }
    // 다음 평타는 서버가 알려 준 실제 간격(신속 반영) 뒤에 (실제 판정은 서버)
    this.assail.sent(now);
    me.actKind = 'attack';
    me.actStart = now;
  }

  /** 활을 든 채 적을 누르면: 사거리 안이면 바로 쏘고, 아니면 사거리에 들어올 때까지만 걸어감 (도착하면 쏨) */
  private approachRanged(e: CEntity, range: number): void {
    const me = this.state.me;
    if (!me) return;
    if (chebyshev(e.x, e.y, me.x, me.y) <= range) {
      this.cancelAuto();
      this.path = [];
      this.pending = null;
      this.faceTowards(e);
      this.tryAttack(performance.now());
      return;
    }
    // 사거리를 예약에 실어 두면 길찾기·다시 찾기·도착이 모두 사거리 기준
    this.walkTo(e.x, e.y, { kind: 'approach', id: e.id, range });
  }

  /** 활로 다가가다 길이 막혔을 때: 대상의 지금 자리 기준으로 다시 다가감 (이미 사거리 안이면 쏨) */
  private resumeRanged(): void {
    const p = this.pending;
    this.pending = null;
    this.path = [];
    if (!p?.range) return;
    const e = this.state.entities.get(p.id);
    if (e && isHostile(e)) this.approachRanged(e, p.range);
  }

  /** 활로 다가가는 중이고 (x, y) 가 대상의 사거리 안인지 */
  private pendingInRange(x: number, y: number): boolean {
    const p = this.pending;
    if (!p?.range) return false;
    const e = this.state.entities.get(p.id);
    return e !== undefined && chebyshev(x, y, e.x, e.y) <= p.range;
  }

  useAbility(id: string): void {
    const st = this.state;
    const def = st.abilities.get(id);
    if (!def) return;
    const t = st.targetId !== null ? st.entities.get(st.targetId) : undefined;
    let target: number | undefined;
    if ((def.targeting === 'enemy' || def.targeting === 'enemyArea') && t && isHostile(t)) {
      target = t.id;
      this.faceTowards(t);
    }
    if (def.targeting === 'ally' && t?.type === 'player') target = t.id;
    if (def.targeting === 'front' || def.targeting === 'line') {
      const adj = this.adjacentEnemy();
      if (adj) this.faceTowards(adj);
      else if (t && isHostile(t)) this.faceTowards(t);
    }
    this.net.send(target !== undefined ? { t: 'ability', id, target } : { t: 'ability', id });
  }

  onInventoryClick(slot: number, shift: boolean): void {
    const s = this.state.inventory[slot];
    if (!s) return;
    const mode = this.panel.invMode;
    const npc = this.windows.npcId;
    if (mode === 'sell' && npc !== null) {
      if (shift || s.qty === 1) this.net.send({ t: 'sell', npc, slot, qty: s.qty });
      else this.windows.askNumber('팔기', `${this.state.itemName(s.item)} 몇 개를 팔까요?`, s.qty, (n) => this.net.send({ t: 'sell', npc, slot, qty: n }));
      return;
    }
    if (mode === 'deposit' && npc !== null) {
      this.net.send({ t: 'deposit', npc, slot, qty: s.qty });
      return;
    }
    this.net.send({ t: 'useItem', slot });
  }

  promptDrop(slot: number): void {
    const s = this.state.inventory[slot];
    if (!s) return;
    const name = this.state.itemName(s.item);
    if (s.qty > 1) this.windows.askNumber('버리기', `${name} 몇 개를 버릴까요?`, s.qty, (n) => this.net.send({ t: 'dropItem', slot, qty: n }));
    else this.windows.askNumber('버리기', `${name}을(를) 바닥에 버릴까요? (1 입력)`, 1, () => this.net.send({ t: 'dropItem', slot, qty: 1 }));
  }

  private usePotion(kind: 'hp' | 'mp'): void {
    const inv = this.state.inventory;
    let best = -1;
    let bestVal = Infinity;
    inv.forEach((s, i) => {
      if (!s) return;
      const def = this.state.items.get(s.item);
      const v = kind === 'hp' ? (def?.use?.hp ?? 0) : (def?.use?.mp ?? 0);
      if (v > 0 && v < bestVal) {
        best = i;
        bestVal = v;
      }
    });
    if (best < 0) {
      this.hud.notice(kind === 'hp' ? '체력 물약이 없습니다.' : '마나 물약이 없습니다.', 'warn');
      return;
    }
    this.net.send({ t: 'useItem', slot: best });
  }

  private talkTo(e: CEntity): void {
    const me = this.state.me;
    if (!me) return;
    if (Math.max(Math.abs(e.x - me.x), Math.abs(e.y - me.y)) <= NPC_TALK_RANGE) {
      this.net.send({ t: 'talk', npc: e.id });
      return;
    }
    this.walkTo(e.x, e.y, { kind: 'talk', id: e.id });
  }

  private walkTo(x: number, y: number, pending: Pending): void {
    const me = this.state.me;
    if (!me) return;
    this.cancelAuto();
    const path = this.findPath(me.x, me.y, x, y, pending !== null && pending.kind !== 'pickup', pending?.range);
    if (!path) {
      this.hud.notice('그곳으로 갈 수 없습니다.', 'warn');
      return;
    }
    this.path = path;
    this.pending = pending;
    this.renderer.walkTarget = { x, y, until: performance.now() + 1500 };
    if (path.length === 0) this.arrive();
  }

  /** BFS 길찾기. adjacent=true 면 목표 옆 칸까지, range > 1 이면 목표에서 그 거리(가로·세로·대각선) 안의 칸까지 */
  private findPath(sx: number, sy: number, tx: number, ty: number, adjacent: boolean, range = 1): Dir[] | null {
    const st = this.state;
    const W = st.mapWidth;
    const H = st.mapHeight;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const ghost = st.self?.ghost ?? false;
    const goal = (x: number, y: number) =>
      range > 1
        ? chebyshev(x, y, tx, ty) <= range && !(x === tx && y === ty)
        : adjacent
          ? Math.abs(x - tx) + Math.abs(y - ty) <= 1 && !(x === tx && y === ty)
          : x === tx && y === ty;
    if (goal(sx, sy)) return [];
    const prev = new Map<number, number>();
    const start = sy * W + sx;
    prev.set(start, -1);
    const q = [start];
    for (let i = 0; i < q.length && i < 6000; i++) {
      const k = q[i]!;
      const x = k % W;
      const y = (k - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (prev.has(nk)) continue;
        const isGoal = goal(nx, ny);
        if (!st.walkable(nx, ny)) continue;
        if (st.blockedByEntity(nx, ny, ghost)) continue;
        if (st.isWarp(nx, ny) && !(nx === tx && ny === ty)) continue;
        prev.set(nk, k);
        if (isGoal) {
          const dirs: Dir[] = [];
          let c = nk;
          while (prev.get(c) !== -1) {
            const p = prev.get(c)!;
            const cx = c % W;
            const cy = (c - cx) / W;
            const px = p % W;
            const py = (p - px) / W;
            dirs.unshift(dirTowards(px, py, cx, cy) as Dir);
            c = p;
          }
          return dirs;
        }
        q.push(nk);
      }
    }
    return null;
  }

  private cycleTarget(): void {
    const st = this.state;
    const me = st.me;
    if (!me) return;
    const list = [...st.entities.values()]
      .filter((e) => isHostile(e))
      .map((e) => ({ e, d: Math.abs(e.x - me.x) + Math.abs(e.y - me.y) }))
      .filter((x) => x.d <= 12)
      .sort((a, b) => a.d - b.d);
    if (!list.length) {
      st.targetId = null;
      return;
    }
    const idx = list.findIndex((x) => x.e.id === st.targetId);
    st.targetId = list[(idx + 1) % list.length]!.e.id;
  }

  // ───────────────────────── 입력 ─────────────────────────

  private onCanvasClick(ev: MouseEvent, right: boolean): void {
    if (!this.ingame) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const now = performance.now();
    const st = this.state;
    const e = this.renderer.pickEntity(mx, my, now);
    if (e && e.id !== st.selfId) {
      if (e.type === 'monster') {
        // 아군 소환수는 공격 대상으로 고르지 않음 (이름은 늘 머리 위에 보임)
        if (isAlly(e)) return;
        if (st.targetId === e.id || right) {
          st.targetId = e.id;
          const range = this.weaponRange();
          if (range > 1) this.approachRanged(e, range);
          else this.walkTo(e.x, e.y, { kind: 'approach', id: e.id });
        } else st.targetId = e.id;
        return;
      }
      if (e.type === 'player') {
        st.targetId = e.id;
        return;
      }
      if (e.type === 'npc') {
        this.talkTo(e);
        return;
      }
      if (e.type === 'item') {
        const me = st.me;
        if (me && me.x === e.x && me.y === e.y) this.net.send({ t: 'pickup' });
        else this.walkTo(e.x, e.y, { kind: 'pickup', id: e.id });
        return;
      }
    }
    if (right) return;
    const t = this.renderer.screenToTile(mx, my);
    if (st.walkable(t.x, t.y)) this.walkTo(t.x, t.y, null);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.ingame) return;
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    const dir = ARROWS[e.key];
    if (dir !== undefined) {
      e.preventDefault();
      this.cancelAuto();
      if (!this.heldDirs.includes(dir)) this.heldDirs.push(dir);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!this.attackHeld) {
        this.attackHeld = true;
        this.tryAttack(performance.now());
      }
      return;
    }
    if (e.repeat && !/^[0-9]$/.test(e.key)) return;
    if (/^[0-9]$/.test(e.key)) {
      const idx = this.panel.hotkeyIndex(e.key);
      if (this.windows.pickByNumber(idx)) return;
      this.useHotkey(idx);
      return;
    }
    switch (e.code) {
      case 'KeyA':
        return this.panel.setTab('inv');
      case 'KeyS':
        return this.panel.setTab('skills');
      case 'KeyD':
        return this.panel.setTab('spells');
      case 'KeyF':
        return this.panel.setTab('chat');
      case 'KeyG':
        return this.panel.setTab('stats');
      case 'KeyC':
        return this.charWin.toggle();
      case 'KeyM':
        return this.hud.toggleMinimap();
      case 'KeyZ':
        return this.toggleAuto();
      case 'KeyH':
        return this.help.toggle();
      case 'KeyE':
        return this.net.send({ t: 'pickup' });
      case 'KeyR':
        if (this.state.self?.ghost) this.recall();
        return;
      case 'KeyQ':
        return this.usePotion('hp');
      case 'KeyW':
        return this.usePotion('mp');
      case 'Tab':
        e.preventDefault();
        return this.cycleTarget();
      case 'F1':
        e.preventDefault();
        return this.help.toggle();
      case 'F2':
        e.preventDefault();
        return this.gm.toggle();
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        return this.chat.focus();
      case 'Slash':
        e.preventDefault();
        return this.chat.focus('/');
      case 'Escape':
        if (this.help.open) return this.help.toggle(false);
        if (this.windows.closeTop()) return;
        if (this.charWin.open) return this.charWin.close();
        if (this.gm.open) return this.gm.close();
        this.state.targetId = null;
        this.path = [];
        this.pending = null;
        return;
    }
  }

  private useHotkey(idx: number): void {
    const st = this.state;
    switch (this.panel.tab) {
      case 'inv':
        if (st.inventory[idx]) this.onInventoryClick(idx, false);
        return;
      case 'spells': {
        const id = st.spells[idx];
        if (id) this.useAbility(id);
        return;
      }
      default: {
        const id = st.skills[idx];
        if (id) this.useAbility(id);
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const dir = ARROWS[e.key];
    if (dir !== undefined) this.heldDirs = this.heldDirs.filter((d) => d !== dir);
    if (e.key === ' ') this.attackHeld = false;
  }
}
