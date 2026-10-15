// 오른쪽 창: 미니맵 + 소지품/기술/마법/능력치 탭
import {
  ELEMENT_NAMES,
  EQUIP_SLOTS,
  EQUIP_SLOT_NAMES,
  INVENTORY_SIZE,
  STAT_KEYS,
  STAT_NAMES,
  circleOf,
  type EquipSlot,
} from '../../shared/constants';
import type { Game } from '../game';
import { iconUrl } from '../render/icons';
import { clear, fmt, h } from './dom';
import { abilityTooltip, itemTooltip } from './tooltip';

export type TabId = 'inv' | 'skills' | 'spells' | 'stats';
const TAB_KEYS: Record<TabId, string> = { inv: 'A', skills: 'S', spells: 'D', stats: 'G' };
const TAB_NAMES: Record<TabId, string> = { inv: '소지품', skills: '기술', spells: '마법', stats: '능력치' };
const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export class Panel {
  readonly el: HTMLElement;
  readonly minimap: HTMLCanvasElement;
  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly bodies = new Map<TabId, HTMLElement>();
  tab: TabId = 'skills';
  private cdEls = new Map<string, HTMLElement>();
  /** 상점 판매/창고 맡기기 모드일 때 소지품 클릭 동작 */
  invMode: 'normal' | 'sell' | 'deposit' = 'normal';
  private readonly invModeBanner: HTMLElement;
  collapsed = false;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.minimap = h('canvas', { class: 'minimap' });
    const tabBar = h('div', { class: 'panel-tabs' });
    for (const id of ['inv', 'skills', 'spells', 'stats'] as TabId[]) {
      const b = h('button', { class: 'ptab', onclick: () => this.setTab(id) }, TAB_NAMES[id], h('small', null, TAB_KEYS[id]));
      this.tabs.set(id, b);
      tabBar.appendChild(b);
      this.bodies.set(id, h('div', { class: 'panel-body hidden' }));
    }
    this.invModeBanner = h('div', { class: 'inv-mode hidden' });
    const toggle = h('button', { class: 'panel-toggle', title: '창 접기/펴기', onclick: () => this.toggle() }, '≡');
    this.el = h(
      'div',
      { class: 'panel' },
      toggle,
      h('div', { class: 'minimap-wrap' }, this.minimap),
      tabBar,
      this.invModeBanner,
      ...this.bodies.values(),
    );
    root.appendChild(this.el);
    this.setTab('skills');
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.el.classList.toggle('collapsed', this.collapsed);
  }

  setTab(id: TabId): void {
    this.tab = id;
    for (const [k, b] of this.tabs) b.classList.toggle('active', k === id);
    for (const [k, b] of this.bodies) b.classList.toggle('hidden', k !== id);
    this.render(id);
    if (this.collapsed) this.toggle();
  }

  setInvMode(mode: 'normal' | 'sell' | 'deposit'): void {
    this.invMode = mode;
    this.invModeBanner.classList.toggle('hidden', mode === 'normal');
    this.invModeBanner.textContent =
      mode === 'sell' ? '판매 모드: 팔 물건을 클릭하세요 (Shift+클릭: 전부)' : mode === 'deposit' ? '창고 모드: 맡길 물건을 클릭하세요' : '';
    if (mode !== 'normal') this.setTab('inv');
    else this.render('inv');
  }

  render(id: TabId = this.tab): void {
    if (id === 'inv') this.renderInventory();
    else if (id === 'skills') this.renderAbilities('skill');
    else if (id === 'spells') this.renderAbilities('spell');
    else this.renderStats();
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
    body.append(
      grid,
      h(
        'div',
        { class: 'inv-foot' },
        h('span', null, `${fmt(st.gold)} 골드`),
        h('span', { class: 'hint' }, '클릭: 사용/장비 · 우클릭: 버리기 · 끌어서 이동'),
      ),
    );
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
    if (list.length === 0) {
      body.appendChild(
        h(
          'div',
          { class: 'empty-msg' },
          kind === 'skill'
            ? '배운 기술이 없습니다. 5레벨이 되면 길드에서 직업을 고르고 기술을 배울 수 있습니다.'
            : '배운 마법이 없습니다. 마법사/성직자 길드에서 마법을 배울 수 있습니다.',
        ),
      );
      return;
    }
    const grid = h('div', { class: 'slot-grid' });
    this.cdEls.clear();
    list.forEach((id, i) => {
      const def = st.abilities.get(id);
      if (!def) return;
      const cd = h('div', { class: 'cd' });
      this.cdEls.set(id, cd);
      const slot = h(
        'div',
        { class: 'slot ability', draggable: true },
        h('img', { src: iconUrl(def.icon), alt: def.name, draggable: false }),
        cd,
        i < 10 ? h('span', { class: 'hotkey' }, HOTKEYS[i]) : null,
        def.mp ? h('span', { class: 'mp-cost' }, String(def.mp)) : null,
      );
      slot.addEventListener('click', () => this.game.useAbility(id));
      this.game.tooltip.attach(slot, () => abilityTooltip(def));
      this.wireDrag(slot, kind, i);
      grid.appendChild(slot);
    });
    body.append(grid, h('div', { class: 'inv-foot' }, h('span', { class: 'hint' }, '숫자키/클릭: 사용 · 마법은 클릭으로 지정한 대상에게')));
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
      el.style.background = `conic-gradient(rgba(0,0,0,0.65) ${p * 360}deg, transparent 0)`;
    }
  }

  private renderStats(): void {
    const body = this.bodies.get('stats')!;
    clear(body);
    const st = this.game.state;
    const s = st.self;
    if (!s) return;
    const cls = st.className(s.classId);
    const eqGrid = h('div', { class: 'equip-grid' });
    for (const slot of EQUIP_SLOTS) {
      const id = s.equipment[slot];
      const def = id ? st.items.get(id) : undefined;
      const el = h(
        'div',
        { class: `slot equip ${def ? '' : 'empty'}`, title: EQUIP_SLOT_NAMES[slot] },
        def ? h('img', { src: iconUrl(def.icon), alt: def.name }) : h('span', { class: 'eq-label' }, EQUIP_SLOT_NAMES[slot]),
      );
      if (def) {
        el.addEventListener('click', () => this.game.net.send({ t: 'unequip', eq: slot as EquipSlot }));
        this.game.tooltip.attach(el, () => itemTooltip(def));
      }
      eqGrid.appendChild(el);
    }
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
    const row = (a: string, b: string) => h('div', { class: 'kv' }, h('span', null, a), h('b', null, b));
    body.append(
      h(
        'div',
        { class: 'char-card' },
        h('div', { class: 'char-name' }, s.name),
        h('div', { class: 'char-sub' }, `${cls} · ${s.level}레벨 · ${circleOf(s.level)}서클`),
      ),
      h('div', { class: 'section-title' }, '장비 (클릭: 벗기)'),
      eqGrid,
      h('div', { class: 'section-title' }, `능력치 ${s.statPoints > 0 ? `— 남은 포인트 ${s.statPoints}` : ''}`),
      ...statRows,
      h('div', { class: 'section-title' }, '전투 정보'),
      row('최대 체력 / 마나', `${fmt(s.maxHp)} / ${fmt(s.maxMp)}`),
      row('AC (낮을수록 단단함)', String(s.stats.ac)),
      row('무기 피해', `${s.stats.dmgMin} ~ ${s.stats.dmgMax}${s.stats.dmgBonus ? ` +${s.stats.dmgBonus}` : ''}`),
      row('명중 / 마법 위력', `+${s.stats.hit}% / +${s.stats.magic}%`),
      row('공격 / 방어 속성', `${ELEMENT_NAMES[s.stats.offense]} / ${ELEMENT_NAMES[s.stats.defense]}`),
      row('승급 보너스', `체력 +${fmt(s.bonusHp)} / 마나 +${fmt(s.bonusMp)}`),
      row('처치 / 사망', `${fmt(s.kills)} / ${fmt(s.deaths)}`),
    );
  }

  /** 단축키 1~0 → 현재 탭의 칸 번호 */
  hotkeyIndex(key: string): number {
    return HOTKEYS.indexOf(key);
  }
}
