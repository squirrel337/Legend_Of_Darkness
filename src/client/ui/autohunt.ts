// 자동사냥 화면: 진행 표시줄과 설정 창. 설정은 캐릭터마다 이 브라우저에 저장합니다.
import {
  AUTO_RADIUS_MAX,
  AUTO_RADIUS_MIN,
  AUTO_STATE_NAMES,
  DEFAULT_AUTO_SETTINGS,
  sanitizeAutoSettings,
  type AutoSettings,
  type AutoState,
} from '../../shared/autohunt';
import { STATUS_INFO } from '../../shared/constants';
import type { AbilityDef } from '../../shared/types';
import type { Game } from '../game';
import { abilityIconUrl } from '../render/icons';
import { h } from './dom';
import { abilityTooltip } from './tooltip';
import { Win } from './windows';

const STORAGE_PREFIX = 'lod.autohunt.';

/**
 * Shift+Z: 자동사냥 설정 창, Esc: 설정 창 닫기.
 * 게임의 키 처리(Z: 켜기/끄기, Esc)보다 먼저 가로챕니다. 해제 함수를 돌려줍니다.
 */
export function installAutoKeys(active: () => boolean, open: () => void, closeIfOpen: () => boolean): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!active()) return;
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
    if (e.key === 'Escape' && closeIfOpen()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.code !== 'KeyZ' || !e.shiftKey || e.repeat || typing) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

/** 자동사냥이 쓰는 기술의 쓰임새 (설정 창 표시용) */
function abilityRole(def: AbilityDef): string {
  const fx = def.effects;
  if (fx.some((e) => e.type === 'summon')) return '소환';
  const enemy = ['front', 'around', 'around8', 'enemy', 'enemyArea', 'line'].includes(def.targeting);
  if (enemy && fx.some((e) => e.type === 'physical' || e.type === 'magic' || e.type === 'sacrifice')) return '공격';
  if (enemy && fx.some((e) => e.type === 'status' && STATUS_INFO[e.status].kind === 'debuff' && e.status !== 'sleep')) return '약화';
  if (enemy) return '';
  if (fx.some((e) => e.type === 'dash' || e.type === 'revive')) return '';
  if (fx.some((e) => e.type === 'heal')) return '회복';
  if (fx.some((e) => e.type === 'restoreMp')) return '마나';
  if (fx.some((e) => e.type === 'status' && STATUS_INFO[e.status].kind === 'buff' && e.status !== 'hide')) return '강화';
  return '';
}

export class AutoHuntUi {
  private readonly bar: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly win: Win;
  private cur: AutoSettings = { ...DEFAULT_AUTO_SETTINGS, abilities: [] };
  private loadedFor = '';
  private resendTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.stateEl = h('span', { class: 'auto-state' });
    this.bar = h(
      'div',
      { class: 'auto-bar hidden', title: 'Z: 자동사냥 켜기/끄기 · Shift+Z: 설정' },
      h('span', { class: 'auto-spin' }),
      h('b', null, '자동사냥'),
      h('span', { class: 'auto-sep' }, '·'),
      this.stateEl,
      h('button', { class: 'btn tiny', title: '자동사냥 설정 (Shift+Z)', onclick: () => this.openSettings() }, '설정'),
      h('button', { class: 'btn tiny', title: '자동사냥 끄기 (Z)', onclick: () => this.game.toggleAuto() }, '끄기'),
    );
    root.appendChild(this.bar);
    this.win = new Win(root, 'win-auto');
  }

  /** 현재 캐릭터의 설정 (저장된 것이 없으면 기본값) */
  settings(): AutoSettings {
    const name = this.game.state.self?.name ?? '';
    if (name !== this.loadedFor) {
      this.loadedFor = name;
      this.cur = this.load(name);
    }
    return { ...this.cur, abilities: [...this.cur.abilities] };
  }

  private load(name: string): AutoSettings {
    try {
      const raw = name ? localStorage.getItem(STORAGE_PREFIX + name) : null;
      if (raw) return sanitizeAutoSettings(JSON.parse(raw));
    } catch {
      /* 저장소를 쓸 수 없으면 기본값 */
    }
    return { ...DEFAULT_AUTO_SETTINGS, abilities: [] };
  }

  private save(): void {
    this.cur = sanitizeAutoSettings(this.cur);
    try {
      if (this.loadedFor) localStorage.setItem(STORAGE_PREFIX + this.loadedFor, JSON.stringify(this.cur));
    } catch {
      /* 저장하지 못해도 이번 접속 동안은 그대로 씁니다 */
    }
    // 켜져 있으면 새 설정을 보냅니다 (끌어서 바꾸는 동안 여러 번 보내지 않게 잠깐 모아서)
    window.clearTimeout(this.resendTimer);
    this.resendTimer = window.setTimeout(() => this.game.autoSettingsChanged(), 350);
  }

  /** 서버가 알려 준 상태를 화면에 표시 */
  setState(on: boolean, state?: AutoState): void {
    this.bar.classList.toggle('hidden', !on);
    if (state) this.stateEl.textContent = AUTO_STATE_NAMES[state];
    this.bar.dataset.state = state ?? '';
    if (this.win.open) this.renderFooter();
  }

  // ───────────────────────── 설정 창 ─────────────────────────

  private footer: HTMLElement | null = null;

  openSettings(): void {
    if (this.closeSettings()) return;
    this.settings();
    this.render();
  }

  /** 설정 창이 열려 있으면 닫고 true */
  closeSettings(): boolean {
    if (!this.win.open) return false;
    this.win.close();
    return true;
  }

  private render(): void {
    const s = this.cur;
    const slider = (label: string, key: 'hpPct' | 'mpPct' | 'radius', min: number, max: number, step: number, text: (v: number) => string) => {
      const out = h('span', { class: 'auto-val' }, text(s[key]));
      const input = h('input', {
        type: 'range',
        min,
        max,
        step,
        value: String(s[key]),
        oninput: () => {
          this.cur[key] = Number(input.value);
          out.textContent = text(this.cur[key]);
        },
        onchange: () => this.save(),
      });
      return h('label', { class: 'auto-row' }, h('span', { class: 'auto-label' }, label), input, out);
    };
    const check = (key: 'pickup' | 'buffs' | 'recall' | 'autoAbilities', label: string, tip: string) =>
      h(
        'label',
        { class: 'auto-check', title: tip },
        h('input', {
          type: 'checkbox',
          checked: s[key],
          onchange: (e: Event) => {
            this.cur[key] = (e.target as HTMLInputElement).checked;
            this.save();
          },
        }),
        label,
      );
    const gap = h('input', {
      type: 'number',
      class: 'qty-input',
      min: 0,
      max: 99,
      value: String(s.maxLevelGap),
      onchange: () => {
        this.cur.maxLevelGap = Math.max(0, Math.min(99, Math.floor(Number(gap.value) || 0)));
        gap.value = String(this.cur.maxLevelGap);
        this.save();
      },
    });
    gap.addEventListener('keydown', (e) => e.stopPropagation());
    this.footer = h('div', { class: 'auto-foot' });
    this.win.show(
      '자동사냥 설정',
      h('div', { class: 'section-title' }, '회복'),
      slider('체력', 'hpPct', 0, 95, 5, (v) => (v > 0 ? `${v}% 아래에서 회복` : '쓰지 않음')),
      slider('마나', 'mpPct', 0, 95, 5, (v) => (v > 0 ? `${v}% 아래에서 회복` : '쓰지 않음')),
      h('div', { class: 'section-title' }, '사냥'),
      slider('범위', 'radius', AUTO_RADIUS_MIN, AUTO_RADIUS_MAX, 1, (v) => `시작한 곳에서 ${v}칸`),
      h('label', { class: 'auto-row' }, h('span', { class: 'auto-label' }, '레벨'), gap, h('span', { class: 'auto-val' }, '내 레벨 + 이만큼까지 (0: 제한 없음)')),
      h(
        'div',
        { class: 'auto-checks' },
        check('pickup', '전리품 줍기', '내 전리품과 주인 없는 물건을 줍습니다'),
        check('buffs', '강화 유지', '꺼진 강화 기술을 다시 걸고, 소환수를 부릅니다'),
        check('recall', '위험하면 귀환', '물약이 떨어져 위험하면 귀환 주문서로 마을에 돌아갑니다'),
        check('autoAbilities', '공격 기술 자동', '아래에서 고른 기술이 없으면 배운 공격 기술을 알아서 씁니다'),
      ),
      h('div', { class: 'section-title' }, '쓸 기술 (위에 있을수록 먼저)'),
      this.abilityList(),
      this.footer,
    );
    this.renderFooter();
  }

  private abilityList(): HTMLElement {
    const st = this.game.state;
    const learned = [...st.skills, ...st.spells].map((id) => st.abilities.get(id)).filter((d): d is AbilityDef => d !== undefined);
    const chosen = this.cur.abilities.filter((id) => learned.some((d) => d.id === id));
    const rest = learned.filter((d) => !chosen.includes(d.id));
    const order = [...chosen.map((id) => learned.find((d) => d.id === id)!), ...rest];
    const list = h('div', { class: 'auto-abilities' });
    if (order.length === 0) {
      list.appendChild(h('div', { class: 'hint' }, '배운 기술이 없습니다. 평타로 사냥합니다.'));
      return list;
    }
    const move = (id: string, d: -1 | 1) => {
      const arr = this.cur.abilities.filter((x) => learned.some((l) => l.id === x));
      const i = arr.indexOf(id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      this.cur.abilities = arr;
      this.save();
      list.replaceWith(this.abilityList());
    };
    order.forEach((def) => {
      const on = chosen.includes(def.id);
      const idx = chosen.indexOf(def.id);
      const role = abilityRole(def);
      const box = h('input', {
        type: 'checkbox',
        checked: on,
        onchange: () => {
          const arr = this.cur.abilities.filter((x) => learned.some((l) => l.id === x));
          this.cur.abilities = box.checked ? [...arr, def.id] : arr.filter((x) => x !== def.id);
          this.save();
          list.replaceWith(this.abilityList());
        },
      });
      const row = h(
        'div',
        { class: `auto-ab ${on ? 'on' : ''}` },
        box,
        h('img', { src: abilityIconUrl(def.icon, 24), alt: '', draggable: false }),
        h('span', { class: 'auto-ab-name' }, def.name, h('small', null, ` ${def.kind === 'skill' ? '기술' : '마법'}${def.mp ? ` · 마나 ${def.mp}` : ''}`)),
        role ? h('span', { class: 'auto-ab-role' }, role) : null,
        h('button', { class: 'btn tiny', title: '먼저 쓰기', disabled: !on || idx <= 0, onclick: () => move(def.id, -1) }, '▲'),
        h('button', { class: 'btn tiny', title: '나중에 쓰기', disabled: !on || idx < 0 || idx >= chosen.length - 1, onclick: () => move(def.id, 1) }, '▼'),
      );
      this.game.tooltip.attach(row, () => abilityTooltip(def));
      list.appendChild(row);
    });
    list.appendChild(
      h(
        'div',
        { class: 'hint' },
        chosen.length > 0 ? '고른 기술만 고른 순서대로 씁니다. 회복 기술은 체력이 낮으면 언제나 씁니다.' : '고른 기술이 없으면 배운 공격 기술 중 좋은 것을 알아서 씁니다.',
      ),
    );
    return list;
  }

  private renderFooter(): void {
    if (!this.footer) return;
    const on = this.game.autoOn;
    this.footer.replaceChildren(
      h(
        'button',
        {
          class: 'btn',
          title: '설정을 처음 값으로 되돌립니다',
          onclick: () => {
            this.cur = { ...DEFAULT_AUTO_SETTINGS, abilities: [] };
            this.save();
            this.render();
          },
        },
        '기본값',
      ),
      h('span', { class: 'auto-foot-gap' }),
      h('button', { class: `btn ${on ? '' : 'primary'}`, onclick: () => this.game.toggleAuto() }, on ? '자동사냥 끄기' : '자동사냥 시작'),
      h('button', { class: 'btn', onclick: () => this.win.close() }, '닫기'),
    );
  }
}
