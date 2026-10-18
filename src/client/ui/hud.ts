// 화면 정보: 아래 패널의 체력/마나 게이지와 상태 줄, 화면 위의 대상·그룹·미니맵·상태 효과·알림
import { STATUS_INFO, circleOf } from '../../shared/constants';
import type { GroupMember } from '../../shared/protocol';
import type { Game } from '../game';
import { portraitUrl } from '../render/chibi';
import { clear, fmt, h } from './dom';
import type { BottomFrame } from './frame';

export class Hud {
  readonly minimap: HTMLCanvasElement;
  private readonly minimapWrap: HTMLElement;
  private readonly hpNum: HTMLElement;
  private readonly mpNum: HTMLElement;
  private readonly hpTube: HTMLElement;
  private readonly mpTube: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly mpFill: HTMLElement;
  private readonly coord: HTMLElement;
  private readonly mapName: HTMLElement;
  private readonly goldEl: HTMLElement;
  private readonly expFill: HTMLElement;
  private readonly expText: HTMLElement;
  private readonly levelEl: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly buffs: HTMLElement;
  private readonly target: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetFill: HTMLElement;
  private readonly group: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly gainBox: HTMLElement;
  private readonly mapTitle: HTMLElement;
  private readonly face: HTMLElement;
  private readonly faceImg: HTMLImageElement;
  private faceKey = '';
  private statusEnd = new Map<string, number>();
  private lastMapId = '';
  showMinimap = true;

  constructor(
    root: HTMLElement,
    frame: BottomFrame,
    private readonly game: Game,
  ) {
    // ── 넓은 화면에서 왼쪽 끝에 보이는 내 캐릭터 초상 ──
    this.faceImg = h('img', { alt: '', draggable: false });
    this.face = h('div', { class: 'lod-face', title: '캐릭터 정보 (C)', onclick: () => game.charWin.toggle() }, this.faceImg);
    frame.left.before(this.face);

    // ── 아래 패널 왼쪽: 체력/마나 관 ──
    this.hpFill = h('div', { class: 'fill' });
    this.mpFill = h('div', { class: 'fill' });
    this.hpTube = h('div', { class: 'tube hp', title: '체력' }, this.hpFill, h('div', { class: 'glass' }));
    this.mpTube = h('div', { class: 'tube mp', title: '마나' }, this.mpFill, h('div', { class: 'glass' }));
    this.hpNum = h('b');
    this.mpNum = h('b');
    frame.left.append(
      h('div', { class: 'vital-num hp', title: '체력' }, h('span', { class: 'lbl' }, '체력'), this.hpNum),
      h('div', { class: 'tubes' }, this.hpTube, this.mpTube),
      h('div', { class: 'vital-num mp', title: '마나' }, h('span', { class: 'lbl' }, '마나'), this.mpNum),
    );

    // ── 아래 패널 맨 아래: 좌표·지역·골드·경험치 ──
    this.coord = h('span', { class: 'st-coord' });
    this.mapName = h('span', { class: 'st-map' });
    this.goldEl = h('span', { class: 'st-gold' });
    this.expFill = h('i');
    this.expText = h('span');
    this.levelEl = h('span', { class: 'st-level' });
    this.pointsEl = h('span', { class: 'st-points hidden', title: 'G: 능력치 분배' });
    frame.status.append(
      this.coord,
      this.mapName,
      this.levelEl,
      h('span', { class: 'st-exp', title: '경험치' }, h('span', { class: 'exp-bar' }, this.expFill), this.expText),
      this.goldEl,
      this.pointsEl,
    );

    // ── 화면 위 ──
    this.minimap = h('canvas', { class: 'minimap' });
    this.buffs = h('div', { class: 'buffs' });
    this.minimapWrap = h('div', { class: 'minimap-wrap', title: 'M: 지도 켜기/끄기' }, this.minimap);
    this.targetName = h('div', { class: 'target-name' });
    this.targetFill = h('div', { class: 'bar-fill hp' });
    this.target = h('div', { class: 'target-frame hidden' }, this.targetName, h('div', { class: 'bar small' }, this.targetFill));
    this.group = h('div', { class: 'group-frame hidden' });
    this.ghost = h(
      'div',
      { class: 'ghost-banner hidden' },
      h('b', null, '유령 상태입니다.'),
      ' 신전의 사제(브리드)에게 말을 걸면 부활할 수 있습니다. ',
      h('button', { class: 'btn small', onclick: () => game.recall() }, '마을로 돌아가기 (R)'),
    );
    this.notices = h('div', { class: 'notices' });
    this.gainBox = h('div', { class: 'gains' });
    this.mapTitle = h('div', { class: 'map-title hidden' });
    root.append(
      h('div', { class: 'hud-right' }, this.minimapWrap, this.buffs),
      this.target,
      this.group,
      this.ghost,
      this.notices,
      this.gainBox,
      this.mapTitle,
    );
  }

  /** 내 모습이 바뀌면 초상을 다시 그림 */
  updateFace(): void {
    const me = this.game.state.me;
    const ghost = this.game.state.self?.ghost ?? false;
    if (!me?.look) return;
    const key = JSON.stringify(me.look);
    if (key !== this.faceKey) {
      this.faceKey = key;
      this.faceImg.src = portraitUrl(me.look, 160, 196, 2.9);
    }
    this.face.classList.toggle('ghost', ghost);
  }

  toggleMinimap(): void {
    this.showMinimap = !this.showMinimap;
    this.minimapWrap.classList.toggle('hidden', !this.showMinimap);
  }

  updateSelf(): void {
    const s = this.game.state.self;
    if (!s) return;
    this.updateVitals();
    this.levelEl.textContent = `${this.game.state.className(s.classId)} Lv.${s.level} · ${circleOf(s.level)}서클${s.role !== 'player' ? (s.role === 'admin' ? ' · 관리자' : ' · GM') : ''}${s.god ? ' · 무적' : ''}`;
    this.levelEl.classList.toggle('gm', s.role !== 'player');
    if (s.expNext > 0) {
      const pct = Math.min(100, (s.exp / s.expNext) * 100);
      this.expFill.style.width = `${pct}%`;
      this.expText.textContent = `${pct.toFixed(1)}%`;
      this.expText.parentElement!.title = `경험치 ${fmt(s.exp)} / ${fmt(s.expNext)}`;
    } else {
      this.expFill.style.width = '100%';
      this.expText.textContent = '만렙';
      this.expText.parentElement!.title = `승급용 경험치 ${fmt(s.exp)}`;
    }
    this.pointsEl.classList.toggle('hidden', s.statPoints <= 0);
    this.pointsEl.textContent = `포인트 ${s.statPoints}`;
    this.ghost.classList.toggle('hidden', !s.ghost);
    this.updateGold();
    const now = performance.now();
    this.statusEnd = new Map(s.statuses.map((st) => [st.id, now + st.ms]));
    this.renderBuffs();
  }

  updateVitals(): void {
    const s = this.game.state.self;
    if (!s) return;
    const hpPct = s.maxHp > 0 ? (s.hp / s.maxHp) * 100 : 0;
    const mpPct = s.maxMp > 0 ? (s.mp / s.maxMp) * 100 : 0;
    this.hpFill.style.height = `${hpPct}%`;
    this.mpFill.style.height = `${mpPct}%`;
    this.hpNum.textContent = fmt(s.hp);
    this.mpNum.textContent = fmt(s.mp);
    this.hpTube.title = `체력 ${fmt(s.hp)} / ${fmt(s.maxHp)}`;
    this.mpTube.title = `마나 ${fmt(s.mp)} / ${fmt(s.maxMp)}`;
    this.hpTube.classList.toggle('low', hpPct < 30);
  }

  updateGold(): void {
    this.goldEl.textContent = `금화 ${fmt(this.game.state.gold)}`;
  }

  private renderBuffs(): void {
    clear(this.buffs);
    const now = performance.now();
    for (const [id, end] of this.statusEnd) {
      const info = STATUS_INFO[id as keyof typeof STATUS_INFO];
      if (!info) continue;
      const sec = Math.max(0, Math.ceil((end - now) / 1000));
      this.buffs.appendChild(
        h(
          'div',
          { class: `buff ${info.kind}`, style: { borderColor: info.color }, title: `${info.name}: ${info.desc}` },
          h('span', { style: { color: info.color } }, info.name),
          h('small', null, sec >= 60 ? `${Math.floor(sec / 60)}분` : `${sec}초`),
        ),
      );
    }
  }

  updateMap(): void {
    const m = this.game.state.map;
    if (!m) return;
    this.mapName.textContent = m.name;
    this.mapName.title = m.levelRange ? `권장 ${m.levelRange[0]}~${m.levelRange[1]}레벨` : m.safe ? '안전 지대' : '';
    this.updateCoords();
    if (m.id !== this.lastMapId) {
      this.lastMapId = m.id;
      this.showMapTitle(m.name, m.levelRange ? `권장 레벨 ${m.levelRange[0]} ~ ${m.levelRange[1]}` : m.safe ? '안전 지대' : '');
    }
  }

  private showMapTitle(name: string, sub: string): void {
    this.mapTitle.replaceChildren(h('div', { class: 'mt-name' }, name), sub ? h('div', { class: 'mt-sub' }, sub) : '');
    this.mapTitle.classList.remove('hidden', 'fade');
    // 다시 시작되도록 강제로 그리기
    void this.mapTitle.offsetWidth;
    this.mapTitle.classList.add('show');
    window.setTimeout(() => this.mapTitle.classList.add('fade'), 2200);
    window.setTimeout(() => {
      this.mapTitle.classList.add('hidden');
      this.mapTitle.classList.remove('show', 'fade');
    }, 3400);
  }

  updateCoords(): void {
    const me = this.game.state.me;
    if (!me) return;
    this.coord.textContent = `X ${me.x}  Y ${me.y}`;
  }

  /** 200ms 마다 */
  tick(): void {
    this.renderBuffs();
    this.updateCoords();
    const st = this.game.state;
    const t = st.targetId !== null ? st.entities.get(st.targetId) : undefined;
    if (!t || t.dying || (t.type !== 'monster' && t.type !== 'player')) {
      this.target.classList.add('hidden');
      if (t?.dying || (st.targetId !== null && !t)) st.targetId = null;
      return;
    }
    this.target.classList.remove('hidden');
    const boss = t.type === 'monster' && t.def ? st.monsters.get(t.def)?.boss : false;
    this.targetName.textContent = `${boss ? '★ ' : ''}${t.name}  Lv.${t.level}`;
    this.targetFill.style.width = `${t.hpPct}%`;
    this.targetFill.className = `bar-fill ${t.type === 'monster' ? 'hp' : 'ally'}`;
  }

  updateGroup(members: GroupMember[] | null): void {
    if (!members) {
      this.group.classList.add('hidden');
      return;
    }
    this.group.classList.remove('hidden');
    this.group.replaceChildren(
      h('div', { class: 'group-title' }, `그룹 (${members.length})`),
      ...members.map((m) =>
        h(
          'div',
          { class: `group-member ${m.online ? '' : 'offline'} ${m.sameMap ? '' : 'far'}` },
          h('div', { class: 'gm-name' }, m.leader ? '★ ' : '', m.name, h('small', null, ` ${m.level} ${this.game.state.className(m.classId)}`)),
          h('div', { class: 'bar tiny' }, h('div', { class: 'bar-fill hp', style: { width: `${m.hpPct}%` } })),
          h('div', { class: 'bar tiny' }, h('div', { class: 'bar-fill mp', style: { width: `${m.mpPct}%` } })),
        ),
      ),
    );
  }

  notice(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    // 아래 메시지 줄에도 남김
    this.game.chat.notice(text, kind);
    const n = h('div', { class: `notice ${kind}` }, text);
    this.notices.appendChild(n);
    while (this.notices.children.length > 4) this.notices.firstChild?.remove();
    setTimeout(() => n.classList.add('fade'), 2800);
    setTimeout(() => n.remove(), 3600);
  }

  gain(exp: number, gold: number): void {
    const parts: string[] = [];
    if (exp > 0) parts.push(`경험치 +${fmt(exp)}`);
    if (gold > 0) parts.push(`금화 +${fmt(gold)}`);
    if (!parts.length) return;
    const g = h('div', { class: 'gain' }, parts.join('  '));
    this.gainBox.appendChild(g);
    while (this.gainBox.children.length > 5) this.gainBox.firstChild?.remove();
    setTimeout(() => g.remove(), 2200);
  }
}
