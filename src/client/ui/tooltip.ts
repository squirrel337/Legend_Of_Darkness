// 아이템/기술 설명 툴팁
import { CLASS_FALLBACK_NAMES, ELEMENT_NAMES, EQUIP_SLOT_NAMES, STAT_NAMES, type StatKey } from '../../shared/constants';
import type { ProficiencyConfig, ReqStatus } from '../../shared/progression';
import type { AbilityDef, ItemDef } from '../../shared/types';
import { profChanceLine, profInfo, reqText } from '../progression';
import { fmt, h } from './dom';

const TARGETING_NAMES: Record<string, string> = {
  front: '앞의 적',
  around: '주변 4칸',
  around8: '주변 8칸',
  self: '자신',
  enemy: '적 하나',
  ally: '아군 하나',
  enemyArea: '적과 그 주변',
  line: '앞쪽 일직선',
  party: '자신과 그룹원',
};

export class Tooltip {
  readonly el = h('div', { class: 'tooltip hidden' });

  constructor(root: HTMLElement) {
    root.appendChild(this.el);
  }

  showAt(x: number, y: number, content: HTMLElement): void {
    this.el.replaceChildren(content);
    this.el.classList.remove('hidden');
    const r = this.el.getBoundingClientRect();
    let left = x + 16;
    let top = y + 12;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > window.innerHeight - 8) top = window.innerHeight - r.height - 8;
    this.el.style.left = `${Math.max(4, left)}px`;
    this.el.style.top = `${Math.max(4, top)}px`;
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  /** 요소에 마우스를 올리면 툴팁이 뜨도록 연결 */
  attach(el: HTMLElement, make: () => HTMLElement | null): void {
    el.addEventListener('mouseenter', (e) => {
      const c = make();
      if (c) this.showAt(e.clientX, e.clientY, c);
    });
    el.addEventListener('mousemove', (e) => {
      if (!this.el.classList.contains('hidden')) this.showAt(e.clientX, e.clientY, this.el.firstElementChild as HTMLElement);
    });
    el.addEventListener('mouseleave', () => this.hide());
  }
}

export function itemTooltip(def: ItemDef, opts: { qty?: number; myLevel?: number; myClass?: string; price?: number; sellPrice?: number } = {}): HTMLElement {
  const lines: (HTMLElement | string)[] = [];
  const bad = (cond: boolean) => (cond ? 'tt-bad' : '');
  lines.push(h('div', { class: 'tt-title' }, def.name, opts.qty && opts.qty > 1 ? ` x${opts.qty}` : ''));
  if (def.type === 'equip' && def.slot) lines.push(h('div', { class: 'tt-sub' }, EQUIP_SLOT_NAMES[def.slot]));
  if (def.type === 'consumable') lines.push(h('div', { class: 'tt-sub' }, '소모품'));
  if (def.type === 'material') lines.push(h('div', { class: 'tt-sub' }, '전리품'));
  if (def.dmg) lines.push(h('div', null, `피해 ${def.dmg[0]} ~ ${def.dmg[1]}`));
  if (def.slot === 'weapon' && (def.range ?? 1) > 1) lines.push(h('div', { class: 'tt-range' }, `사거리 ${def.range}칸 (원거리)`));
  if (def.ac) lines.push(h('div', null, `AC ${def.ac > 0 ? '+' : ''}${def.ac}`));
  if (def.bonus) {
    for (const [k, v] of Object.entries(def.bonus)) {
      if (!v) continue;
      const label =
        k in STAT_NAMES ? STAT_NAMES[k as StatKey] : k === 'hp' ? '최대 체력' : k === 'mp' ? '최대 마나' : k === 'hit' ? '명중' : k === 'dmg' ? '추가 피해' : k === 'magic' ? '마법 위력' : k;
      lines.push(h('div', { class: 'tt-bonus' }, `${label} +${v}${k === 'hit' || k === 'magic' ? '%' : ''}`));
    }
  }
  if (def.offense) lines.push(h('div', { class: 'tt-elem' }, `공격 속성: ${ELEMENT_NAMES[def.offense]}`));
  if (def.defense) lines.push(h('div', { class: 'tt-elem' }, `방어 속성: ${ELEMENT_NAMES[def.defense]}`));
  if (def.use) {
    const u = def.use;
    if (u.hp) lines.push(h('div', null, `체력 +${fmt(u.hp)}`));
    if (u.mp) lines.push(h('div', null, `마나 +${fmt(u.mp)}`));
    if (u.exp) lines.push(h('div', null, `경험치 +${fmt(u.exp)}`));
  }
  if (def.level && def.level > 1)
    lines.push(h('div', { class: bad(opts.myLevel !== undefined && opts.myLevel < def.level) }, `필요 레벨 ${def.level}`));
  if (def.classes?.length)
    lines.push(
      h(
        'div',
        { class: bad(!!opts.myClass && !def.classes.includes(opts.myClass as never)) },
        `직업: ${def.classes.map((c) => CLASS_FALLBACK_NAMES[c]).join(', ')}`,
      ),
    );
  if (def.desc) lines.push(h('div', { class: 'tt-desc' }, def.desc));
  if (opts.price !== undefined) lines.push(h('div', { class: 'tt-price' }, `구매가 ${fmt(opts.price)} 골드`));
  if (opts.sellPrice !== undefined) lines.push(h('div', { class: 'tt-price' }, opts.sellPrice > 0 ? `판매가 ${fmt(opts.sellPrice)} 골드` : '팔 수 없음'));
  return h('div', null, lines);
}

export interface AbilityTipOpts {
  /** 맨 아래 금색 한 줄 (가격·필요 레벨 등) */
  extra?: string;
  /** 배운 기술이면 숙련도 (막대와 위력 배율, 오를 확률) */
  prof?: { value: number; cfg: ProficiencyConfig };
  /** 배우는 조건 (채운 것은 초록, 모자란 것은 빨강) */
  reqs?: ReqStatus[];
}

export function abilityTooltip(def: AbilityDef, opts: AbilityTipOpts = {}): HTMLElement {
  const p = opts.prof ? profInfo(opts.prof.value, opts.prof.cfg) : null;
  return h(
    'div',
    null,
    h('div', { class: 'tt-title' }, def.name),
    h('div', { class: 'tt-sub' }, `${def.kind === 'skill' ? '기술' : '마법'} · ${TARGETING_NAMES[def.targeting] ?? def.targeting}${def.range ? ` · 사거리 ${def.range}칸` : ''}`),
    def.element && def.element !== 'weapon' && def.element !== 'none' ? h('div', { class: 'tt-elem' }, `${ELEMENT_NAMES[def.element]} 속성`) : null,
    def.mp ? h('div', null, `마나 ${def.mp}`) : null,
    def.cooldownMs ? h('div', null, `재사용 ${(def.cooldownMs / 1000).toFixed(1)}초`) : null,
    p && opts.prof
      ? h(
          'div',
          { class: 'tt-prof' },
          h('div', { class: 'tt-prof-row' }, h('span', null, `숙련도 ${p.prof} / ${p.max}`), h('span', { class: `tt-prof-bar ${p.maxed ? 'max' : ''}` }, h('i', { style: { width: `${p.ratio * 100}%` } }))),
          h('div', { class: 'tt-prof-sub' }, `위력 ${p.effectPct}% · ${profChanceLine(p.prof, opts.prof.cfg)}`),
        )
      : null,
    h('div', { class: 'tt-desc' }, def.desc),
    opts.reqs?.length ? h('div', { class: 'tt-reqs' }, ...opts.reqs.map((r) => h('div', { class: r.met ? 'tt-ok' : 'tt-bad' }, `${r.met ? '✓' : '✗'} ${reqText(r)}`))) : null,
    opts.extra ? h('div', { class: 'tt-price' }, opts.extra) : null,
  );
}
