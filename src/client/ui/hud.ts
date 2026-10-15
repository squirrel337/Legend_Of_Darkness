// 화면 위 정보: 체력/마나/경험치, 상태 효과, 대상, 지역 이름, 그룹, 유령 안내, 알림
import { STATUS_INFO, circleOf } from '../../shared/constants';
import type { GroupMember } from '../../shared/protocol';
import type { Game } from '../game';
import { clear, fmt, h } from './dom';

export class Hud {
  readonly el: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly mpFill: HTMLElement;
  private readonly mpText: HTMLElement;
  private readonly expFill: HTMLElement;
  private readonly expText: HTMLElement;
  private readonly charLine: HTMLElement;
  private readonly goldLine: HTMLElement;
  private readonly buffs: HTMLElement;
  private readonly mapName: HTMLElement;
  private readonly mapSub: HTMLElement;
  private readonly target: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetFill: HTMLElement;
  private readonly group: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly gainBox: HTMLElement;
  private statusEnd = new Map<string, number>();

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.hpFill = h('div', { class: 'bar-fill hp' });
    this.hpText = h('div', { class: 'bar-text' });
    this.mpFill = h('div', { class: 'bar-fill mp' });
    this.mpText = h('div', { class: 'bar-text' });
    this.expFill = h('div', { class: 'bar-fill exp' });
    this.expText = h('div', { class: 'bar-text' });
    this.charLine = h('div', { class: 'char-line' });
    this.goldLine = h('div', { class: 'gold-line' });
    this.buffs = h('div', { class: 'buffs' });
    this.mapName = h('div', { class: 'map-name' });
    this.mapSub = h('div', { class: 'map-sub' });
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
    this.el = h(
      'div',
      { class: 'hud' },
      h('div', { class: 'map-info' }, this.mapName, this.mapSub),
      this.target,
      this.group,
      this.ghost,
      this.notices,
      this.gainBox,
      h(
        'div',
        { class: 'status-bar' },
        this.buffs,
        h('div', { class: 'status-top' }, this.charLine, this.goldLine),
        h('div', { class: 'bar' }, this.hpFill, this.hpText),
        h('div', { class: 'bar' }, this.mpFill, this.mpText),
        h('div', { class: 'bar exp-bar' }, this.expFill, this.expText),
      ),
    );
    root.appendChild(this.el);
  }

  updateSelf(): void {
    const s = this.game.state.self;
    if (!s) return;
    this.updateVitals();
    const cls = this.game.state.className(s.classId);
    const parts: (Node | string | null)[] = [
      h('b', null, s.name),
      ` ${cls} · ${s.level}레벨 · ${circleOf(s.level)}서클`,
      s.role !== 'player' ? h('span', { class: 'gm-badge' }, s.role === 'admin' ? '관리자' : 'GM') : null,
      s.god ? h('span', { class: 'god-badge' }, '무적') : null,
      s.statPoints > 0 ? h('span', { class: 'points-badge', title: 'G 키: 능력치 분배' }, `포인트 ${s.statPoints}`) : null,
    ];
    this.charLine.replaceChildren(...parts.filter((x): x is Node | string => x !== null));
    this.goldLine.textContent = `${fmt(this.game.state.gold)} 골드`;
    if (s.expNext > 0) {
      const pct = Math.min(100, (s.exp / s.expNext) * 100);
      this.expFill.style.width = `${pct}%`;
      this.expText.textContent = `경험치 ${fmt(s.exp)} / ${fmt(s.expNext)} (${pct.toFixed(1)}%)`;
    } else {
      this.expFill.style.width = '100%';
      this.expText.textContent = `만렙! 승급용 경험치 ${fmt(s.exp)}`;
    }
    this.ghost.classList.toggle('hidden', !s.ghost);
    const now = performance.now();
    this.statusEnd = new Map(s.statuses.map((st) => [st.id, now + st.ms]));
    this.renderBuffs();
  }

  updateVitals(): void {
    const s = this.game.state.self;
    if (!s) return;
    const hpPct = s.maxHp > 0 ? (s.hp / s.maxHp) * 100 : 0;
    const mpPct = s.maxMp > 0 ? (s.mp / s.maxMp) * 100 : 0;
    this.hpFill.style.width = `${hpPct}%`;
    this.mpFill.style.width = `${mpPct}%`;
    this.hpText.textContent = `체력 ${fmt(s.hp)} / ${fmt(s.maxHp)}`;
    this.mpText.textContent = `마나 ${fmt(s.mp)} / ${fmt(s.maxMp)}`;
    this.hpFill.classList.toggle('low', hpPct < 30);
  }

  updateGold(): void {
    this.goldLine.textContent = `${fmt(this.game.state.gold)} 골드`;
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
          h('small', null, `${sec}초`),
        ),
      );
    }
  }

  updateMap(): void {
    const m = this.game.state.map;
    if (!m) return;
    this.mapName.textContent = m.name;
    this.updateCoords();
  }

  updateCoords(): void {
    const m = this.game.state.map;
    const me = this.game.state.me;
    if (!m || !me) return;
    const lr = m.levelRange ? `권장 ${m.levelRange[0]}~${m.levelRange[1]}레벨 · ` : m.safe ? '안전 지대 · ' : '';
    this.mapSub.textContent = `${lr}(${me.x}, ${me.y})`;
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
      h('div', { class: 'group-title' }, '그룹'),
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
    const n = h('div', { class: `notice ${kind}` }, text);
    this.notices.appendChild(n);
    while (this.notices.children.length > 4) this.notices.firstChild?.remove();
    setTimeout(() => n.classList.add('fade'), 2800);
    setTimeout(() => n.remove(), 3600);
  }

  gain(exp: number, gold: number): void {
    const parts: string[] = [];
    if (exp > 0) parts.push(`경험치 +${fmt(exp)}`);
    if (gold > 0) parts.push(`골드 +${fmt(gold)}`);
    if (!parts.length) return;
    const g = h('div', { class: 'gain' }, parts.join('  '));
    this.gainBox.appendChild(g);
    while (this.gainBox.children.length > 5) this.gainBox.firstChild?.remove();
    setTimeout(() => g.remove(), 2200);
  }
}
