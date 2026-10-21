// 캐릭터 창 (C): 내 캐릭터 일러스트를 가운데 두고 양옆에 장비 칸, 아래에 주요 정보와 성장(칭호·전직·어빌·수인 계통)
import { EQUIP_SLOT_NAMES, circleOf, type EquipSlot } from '../../shared/constants';
import type { Game } from '../game';
import { abilityExpPct, abilityExpTitle, beastTypeName, classLabel, rebirthWord } from '../progression';
import { portraitUrl } from '../render/chibi';
import { iconUrl } from '../render/icons';
import { fmt, h } from './dom';
import { itemTooltip } from './tooltip';
import { Win } from './windows';

const LEFT: EquipSlot[] = ['helmet', 'weapon', 'armor', 'shield', 'boots'];
const RIGHT: EquipSlot[] = ['earring', 'necklace', 'ring', 'belt'];

export class CharWindow {
  private readonly win: Win;

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.win = new Win(root, 'win-char');
  }

  get open(): boolean {
    return this.win.open;
  }

  toggle(force?: boolean): void {
    const on = force ?? !this.open;
    if (on) this.render();
    else this.win.close();
  }

  close(): void {
    this.win.close();
  }

  /** 정보가 바뀌었을 때 (열려 있으면 다시 그림) */
  refresh(): void {
    if (this.open) this.render();
  }

  private render(): void {
    const st = this.game.state;
    const s = st.self;
    const me = st.me;
    if (!s || !me?.look) return;
    const slot = (eq: EquipSlot) => {
      const id = s.equipment[eq];
      const def = id ? st.items.get(id) : undefined;
      const el = h(
        'div',
        { class: `slot equip ${def ? '' : 'empty'}`, title: def ? '' : EQUIP_SLOT_NAMES[eq] },
        def ? h('img', { src: iconUrl(def.icon), alt: def.name }) : h('span', { class: 'eq-label' }, EQUIP_SLOT_NAMES[eq]),
      );
      if (def) {
        el.addEventListener('click', () => this.game.net.send({ t: 'unequip', eq }));
        this.game.tooltip.attach(el, () => itemTooltip(def, { myLevel: s.level, myClass: s.classId }));
      }
      return h('div', { class: 'eq-cell' }, el, h('small', null, EQUIP_SLOT_NAMES[eq]));
    };
    const cls = st.classes.get(s.classId);
    const kv = (a: string, b: string) => h('div', { class: 'kv' }, h('span', null, a), h('b', null, b));
    const prog = st.data.progression;
    const label = classLabel(st.className(s.classId), s, prog.second.beastTypes);
    const ab = abilityExpPct(s);
    this.win.show(
      '캐릭터 정보',
      h(
        'div',
        { class: 'char-win' },
        h('div', { class: 'eq-col' }, ...LEFT.map(slot)),
        h(
          'div',
          { class: `char-portrait ${s.ghost ? 'ghost' : ''}`, style: { borderColor: cls?.color ?? '#d9b45a' } },
          h('img', { src: portraitUrl(me.look, 200, 240, 3.5), alt: s.name, draggable: false }),
          h(
            'div',
            { class: 'char-plate' },
            s.title ? h('em', { class: 'char-title' }, s.title) : null,
            h('b', null, s.name),
            h('span', null, `${label} · ${s.level}레벨 · ${circleOf(s.level)}서클`),
          ),
        ),
        h('div', { class: 'eq-col' }, ...RIGHT.map(slot)),
      ),
      h(
        'div',
        { class: 'char-info' },
        kv('체력', `${fmt(s.hp)} / ${fmt(s.maxHp)}`),
        kv('마나', `${fmt(s.mp)} / ${fmt(s.maxMp)}`),
        kv('AC', String(s.stats.ac)),
        kv('무기 피해', `${s.stats.dmgMin}~${s.stats.dmgMax}`),
        kv('금화', fmt(st.gold)),
        kv('처치', fmt(s.kills)),
        kv('칭호', s.title || '없음'),
        kv(`${rebirthWord(s.classId, prog)} 횟수`, `${fmt(s.rebirths)}회`),
        ab !== null ? kv('어빌', s.abilityExpNext > 0 ? `${s.abilityLevel} (${ab.toFixed(1)}%)` : `${s.abilityLevel} (만렙)`) : null,
        s.classId === 'beastkin' ? kv('수인 계통', s.beastType ? beastTypeName(s.beastType, prog.second.beastTypes) : '아직 고르지 않음') : null,
        ab !== null
          ? h('div', { class: 'char-abil', title: abilityExpTitle(s) }, h('span', null, '어빌 경험치'), h('div', { class: 'bar small' }, h('div', { class: 'bar-fill abil', style: { width: `${ab}%` } })))
          : null,
      ),
      h('div', { class: 'hint center' }, '장비 칸을 클릭하면 벗습니다 · 능력치 분배는 G'),
    );
  }
}
