// 아래 패널의 가운데 칸(소지품/기술/마법/대화/능력치)과 오른쪽 단추들
import { ELEMENT_NAMES, INVENTORY_SIZE, STAT_KEYS, STAT_NAMES, circleOf } from '../../shared/constants';
import type { Game } from '../game';
import { abilityExpPct, abilityExpTitle, classLabel, profInfo, rebirthWord } from '../progression';
import { abilityIconUrl, iconUrl } from '../render/icons';
import { clear, fmt, h } from './dom';
import { svgIcon, type BottomFrame } from './frame';
import { abilityTooltip, itemTooltip } from './tooltip';

export type TabId = 'inv' | 'skills' | 'spells' | 'chat' | 'stats';
const TABS: { id: TabId; key: string; name: string; icon: string }[] = [
  { id: 'inv', key: 'A', name: '소지품', icon: 'bag' },
  { id: 'skills', key: 'S', name: '기술', icon: 'sword' },
  { id: 'spells', key: 'D', name: '마법', icon: 'spark' },
  { id: 'chat', key: 'F', name: '대화', icon: 'talk' },
  { id: 'stats', key: 'G', name: '능력치', icon: 'stats' },
];
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** 칸 수 (3줄 x 16칸) */
const PANE_SLOTS = 48;
const AUTO_TITLE_OFF = '자동사냥 켜기 (Z) · 오른쪽 클릭/Shift+Z: 설정';
const AUTO_TITLE_ON = '자동사냥 끄기 (Z) · 오른쪽 클릭/Shift+Z: 설정';

export class Panel {
  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly bodies = new Map<TabId, HTMLElement>();
  tab: TabId = 'skills';
  private cdEls = new Map<string, HTMLElement>();
  /** 기술 칸 아래의 숙련도 막대 (숙련도가 오르면 그 칸만 고침) */
  private profEls = new Map<string, HTMLElement>();
  /** 상점 판매/창고 맡기기 모드일 때 소지품 클릭 동작 */
  invMode: 'normal' | 'sell' | 'deposit' = 'normal';
  private readonly invModeBanner: HTMLElement;
  private readonly gmBtn: HTMLButtonElement;
  /** 자동사냥 단추 (켜져 있으면 'on' 클래스) */
  readonly autoBtn: HTMLButtonElement;
  private readonly recallBtn: HTMLButtonElement;

  constructor(
    frame: BottomFrame,
    private readonly game: Game,
  ) {
    const tabRow = h('div', { class: 'tab-btns' });
    for (const t of TABS) {
      const b = h('button', { class: 'tab-btn', title: `${t.name} (${t.key})`, onclick: () => this.setTab(t.id) }, svgIcon(t.icon), h('span', { class: 'k' }, t.key));
      this.tabs.set(t.id, b);
      tabRow.appendChild(b);
      const body = h('div', { class: `pane-body pane-${t.id} hidden` });
      this.bodies.set(t.id, body);
      frame.pane.appendChild(body);
    }
    this.invModeBanner = h('div', { class: 'inv-mode hidden' });
    frame.pane.appendChild(this.invModeBanner);
    const menu = (icon: string, label: string, title: string, onclick: () => void) =>
      h('button', { class: 'menu-btn', title, onclick }, svgIcon(icon), h('span', null, label));
    this.gmBtn = menu('crown', '운영자', '운영자 도구 (F2)', () => game.gm.toggle());
    this.autoBtn = menu('auto', '자동', AUTO_TITLE_OFF, () => game.toggleAuto());
    this.autoBtn.classList.add('auto-btn');
    this.autoBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      game.openAutoSettings();
    });
    this.recallBtn = menu('home', '귀환', '유령일 때 마을로 돌아가기 (R)', () => game.recall());
    this.gmBtn.classList.add('hidden');
    this.recallBtn.classList.add('hidden');
    frame.right.append(
      tabRow,
      h(
        'div',
        { class: 'menu-btns' },
        menu('person', '캐릭터', '캐릭터 정보와 장비 (C)', () => game.charWin.toggle()),
        menu('tree', '트리', '스킬트리: 배운 기술·숙련도·배울 수 있는 기술 (K)', () => game.skillTree.toggle()),
        menu('map', '지도', '지도 켜기/끄기 (M)', () => game.hud.toggleMinimap()),
        menu('help', '도움말', '조작 방법 (H)', () => game.help.toggle()),
        this.autoBtn,
        this.gmBtn,
        this.recallBtn,
      ),
    );
    this.bodies.get('chat')!.appendChild(game.chat.log);
    this.setTab('skills');
  }

  /** 자동사냥 단추: 켜져 있으면 빛나는 모양 */
  setAuto(on: boolean): void {
    this.autoBtn.classList.toggle('on', on);
    this.autoBtn.title = on ? AUTO_TITLE_ON : AUTO_TITLE_OFF;
  }

  /** 권한/유령 상태에 따라 단추를 보이거나 숨깁니다 */
  updateButtons(): void {
    const s = this.game.state.self;
    this.gmBtn.classList.toggle('hidden', !s || s.role === 'player');
    this.recallBtn.classList.toggle('hidden', !s?.ghost);
  }

  setTab(id: TabId): void {
    this.tab = id;
    for (const [k, b] of this.tabs) b.classList.toggle('active', k === id);
    for (const [k, b] of this.bodies) b.classList.toggle('hidden', k !== id);
    this.render(id);
    if (id === 'chat') {
      const log = this.game.chat.log;
      log.scrollTop = log.scrollHeight;
    }
  }

  setInvMode(mode: 'normal' | 'sell' | 'deposit'): void {
    this.invMode = mode;
    this.invModeBanner.classList.toggle('hidden', mode === 'normal');
    this.invModeBanner.textContent =
      mode === 'sell' ? '판매: 팔 물건을 클릭 (Shift+클릭: 전부)' : mode === 'deposit' ? '창고: 맡길 물건을 클릭' : '';
    if (mode !== 'normal') this.setTab('inv');
    else if (this.tab === 'inv') this.render('inv');
  }

  render(id: TabId = this.tab): void {
    if (id === 'inv') this.renderInventory();
    else if (id === 'skills') this.renderAbilities('skill');
    else if (id === 'spells') this.renderAbilities('spell');
    else if (id === 'stats') this.renderStats();
  }

  private renderInventory(): void {
    const body = this.bodies.get('inv')!;
    clear(body);
    const st = this.game.state;
    const grid = h('div', { class: 'slot-grid' });
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = st.inventory[i] ?? null;
      const def = s ? st.items.get(s.item) : undefined;
      const slot = h(
        'div',
        { class: `slot ${def ? '' : 'empty'}`, draggable: !!def, dataset: { idx: String(i) } },
        def ? h('img', { src: iconUrl(def.icon), alt: def.name, draggable: false }) : null,
        s && s.qty > 1 ? h('span', { class: 'qty' }, String(s.qty)) : null,
        i < 10 ? h('span', { class: 'hotkey' }, HOTKEYS[i]) : null,
      );
      if (def && s) {
        slot.addEventListener('click', (e) => this.game.onInventoryClick(i, e.shiftKey));
        slot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.game.promptDrop(i);
        });
        this.game.tooltip.attach(slot, () =>
          itemTooltip(def, {
            qty: s.qty,
            myLevel: st.self?.level,
            myClass: st.self?.classId,
            ...(this.invMode === 'sell' ? { sellPrice: Math.floor(def.price / 2) } : {}),
          }),
        );
      }
      this.wireDrag(slot, 'inv', i);
      grid.appendChild(slot);
    }
    body.appendChild(grid);
  }

  private wireDrag(el: HTMLElement, kind: 'inv' | 'skill' | 'spell', idx: number): void {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', `${kind}:${idx}`);
      this.game.tooltip.hide();
    });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const data = e.dataTransfer?.getData('text/plain') ?? '';
      const [k, from] = data.split(':');
      if (k !== kind || from === undefined) return;
      const f = Number(from);
      if (f === idx) return;
      if (kind === 'inv') this.game.net.send({ t: 'moveItem', from: f, to: idx });
      else this.game.net.send({ t: 'moveAbility', kind, from: f, to: idx });
    });
  }

  private renderAbilities(kind: 'skill' | 'spell'): void {
    const tab: TabId = kind === 'skill' ? 'skills' : 'spells';
    const body = this.bodies.get(tab)!;
    clear(body);
    const st = this.game.state;
    const list = kind === 'skill' ? st.skills : st.spells;
    const grid = h('div', { class: 'slot-grid' });
    this.cdEls.clear();
    this.profEls.clear();
    for (let i = 0; i < PANE_SLOTS; i++) {
      const id = list[i];
      const def = id ? st.abilities.get(id) : undefined;
      if (!id || !def) {
        const empty = h('div', { class: 'slot empty' }, i < 10 ? h('span', { class: 'hotkey' }, HOTKEYS[i]) : null);
        // 빈 칸에 놓으면 맨 뒤로 옮김
        if (list.length > 0) this.wireDrag(empty, kind, list.length - 1);
        grid.appendChild(empty);
        continue;
      }
      const cd = h('div', { class: 'cd' });
      this.cdEls.set(id, cd);
      // 숙련도: 칸 아래의 가는 막대 (최대면 금빛)
      const prof = h('span', { class: 'prof-bar' }, h('i'));
      this.profEls.set(id, prof);
      this.setProfBar(prof, st.prof(id));
      const slot = h(
        'div',
        { class: 'slot ability', draggable: true },
        h('img', { src: abilityIconUrl(def.icon), alt: def.name, draggable: false }),
        cd,
        prof,
        i < 10 ? h('span', { class: 'hotkey' }, HOTKEYS[i]) : null,
        def.mp ? h('span', { class: 'mp-cost' }, String(def.mp)) : null,
      );
      slot.addEventListener('click', () => this.game.useAbility(id));
      this.game.tooltip.attach(slot, () => abilityTooltip(def, { prof: { value: st.prof(id), cfg: st.data.progression.proficiency } }));
      this.wireDrag(slot, kind, i);
      grid.appendChild(slot);
    }
    body.appendChild(grid);
    if (list.length === 0) {
      body.appendChild(
        h(
          'div',
          { class: 'pane-empty' },
          kind === 'skill'
            ? '배운 기술이 없습니다. 5레벨이 되면 마을의 길드에서 직업을 고르고 기술을 배울 수 있습니다.'
            : '배운 마법이 없습니다. 마법사·성직자 길드에서 마법을 배울 수 있습니다.',
        ),
      );
    }
  }

  private setProfBar(el: HTMLElement, prof: number): void {
    const p = profInfo(prof, this.game.state.data.progression.proficiency);
    el.classList.toggle('max', p.maxed);
    (el.firstElementChild as HTMLElement).style.width = `${p.ratio * 100}%`;
  }

  /** 숙련도가 올랐을 때 ('prof'): 그 칸의 막대만 고치고 잠깐 빛나게 */
  updateProf(id: string): void {
    const el = this.profEls.get(id);
    if (!el) return;
    this.setProfBar(el, this.game.state.prof(id));
    const slot = el.parentElement;
    if (!slot) return;
    slot.classList.remove('prof-up');
    void slot.offsetWidth;
    slot.classList.add('prof-up');
  }

  /** 매 프레임: 재사용 대기 표시 */
  tickCooldowns(now: number): void {
    if (this.tab !== 'skills' && this.tab !== 'spells') return;
    for (const [id, el] of this.cdEls) {
      const cd = this.game.state.cooldowns.get(id);
      if (!cd || now >= cd.end) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      const p = (cd.end - now) / (cd.end - cd.start);
      el.style.display = 'block';
      el.style.background = `conic-gradient(rgba(0,0,0,0.68) ${p * 360}deg, transparent 0)`;
    }
  }

  private renderStats(): void {
    const body = this.bodies.get('stats')!;
    clear(body);
    const st = this.game.state;
    const s = st.self;
    if (!s) return;
    const row = (a: string, b: string) => h('div', { class: 'kv' }, h('span', null, a), h('b', null, b));
    const statRows = STAT_KEYS.map((k) => {
      const base = s.base[k];
      const total = s.stats[k];
      return h(
        'div',
        { class: 'stat-row' },
        h('span', { class: 'stat-name' }, STAT_NAMES[k]),
        h('span', { class: 'stat-val' }, String(total), total !== base ? h('small', null, ` (${base})`) : null),
        s.statPoints > 0
          ? h(
              'button',
              {
                class: 'btn tiny',
                title: '클릭: +1 / Shift+클릭: +10',
                onclick: (e: MouseEvent) => this.game.net.send({ t: 'stat', stat: k, n: e.shiftKey ? Math.min(10, s.statPoints) : 1 }),
              },
              '+',
            )
          : null,
      );
    });
    const pct = s.expNext > 0 ? Math.min(100, (s.exp / s.expNext) * 100) : 100;
    const prog = st.data.progression;
    const ab = abilityExpPct(s);
    body.append(
      h(
        'div',
        { class: 'stats-cols' },
        h(
          'div',
          { class: `stats-col${ab !== null ? ' has-abil' : ''}` },
          h(
            'div',
            { class: 'char-name' },
            s.name,
            s.title ? h('span', { class: 'title-badge' }, s.title) : null,
            s.rebirths > 0 ? h('small', { class: 'rebirths' }, ` ${rebirthWord(s.classId, prog)} ${s.rebirths}회`) : null,
          ),
          h('div', { class: 'char-sub' }, `${classLabel(st.className(s.classId), s, prog.second.beastTypes)} · ${s.level}레벨 · ${circleOf(s.level)}서클`),
          row('경험치', s.expNext > 0 ? `${fmt(s.exp)} / ${fmt(s.expNext)}` : `만렙 (${fmt(s.exp)})`),
          // 2차 직업은 레벨이 99 그대로라 경험치 막대 대신 어빌 경험치 막대
          ab === null ? h('div', { class: 'bar tiny exp' }, h('div', { class: 'bar-fill exp', style: { width: `${pct}%` } })) : null,
          ab !== null ? row(`어빌 ${s.abilityLevel}`, s.abilityExpNext > 0 ? `${fmt(s.abilityExp)} / ${fmt(s.abilityExpNext)}` : '어빌 만렙') : null,
          ab !== null ? h('div', { class: 'bar tiny abil', title: abilityExpTitle(s) }, h('div', { class: 'bar-fill abil', style: { width: `${ab}%` } })) : null,
          h('button', { class: 'btn small', onclick: () => this.game.charWin.toggle(true) }, '장비·일러스트 (C)'),
        ),
        h(
          'div',
          { class: 'stats-col' },
          h('div', { class: 'section-title' }, s.statPoints > 0 ? `능력치 · 남은 포인트 ${s.statPoints}` : '능력치'),
          ...statRows,
        ),
        h(
          'div',
          { class: 'stats-col' },
          h('div', { class: 'section-title' }, '전투'),
          row('최대 체력/마나', `${fmt(s.maxHp)} / ${fmt(s.maxMp)}`),
          row('AC', String(s.stats.ac)),
          row('무기 피해', `${s.stats.dmgMin}~${s.stats.dmgMax}${s.stats.dmgBonus ? ` +${s.stats.dmgBonus}` : ''}`),
          row('명중 / 마법', `+${s.stats.hit}% / +${s.stats.magic}%`),
          row('공격/방어 속성', `${ELEMENT_NAMES[s.stats.offense]} / ${ELEMENT_NAMES[s.stats.defense]}`),
        ),
      ),
    );
  }

  /** 단축키 1~0 → 현재 칸 번호 */
  hotkeyIndex(key: string): number {
    return HOTKEYS.indexOf(key);
  }
}
