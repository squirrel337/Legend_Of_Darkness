// 떠 있는 창들: NPC 대화, 상점, 기술 배우기(스킬트리 조건), 창고, 그룹 초대, 입력 상자
import type { ClassId } from '../../shared/constants';
import type { DialogOption, InvSlot, LearnEntry } from '../../shared/protocol';
import type { Game } from '../game';
import { profInfo, refreshLearnEntries, reqText } from '../progression';
import { portraitUrl } from '../render/chibi';
import { abilityIconUrl, iconUrl } from '../render/icons';
import { fmt, h, makeDraggable } from './dom';
import { abilityTooltip, itemTooltip } from './tooltip';

export class Win {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly titleEl: HTMLElement;

  constructor(
    root: HTMLElement,
    cls: string,
    private readonly onClose?: () => void,
  ) {
    this.titleEl = h('div', { class: 'win-title-text' });
    const closeBtn = h('button', { class: 'win-close', title: '닫기 (Esc)', onclick: () => this.close() }, '×');
    const head = h('div', { class: 'win-head' }, this.titleEl, closeBtn);
    this.body = h('div', { class: 'win-body' });
    this.el = h('div', { class: `win ${cls} hidden` }, head, this.body);
    makeDraggable(this.el, head);
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(title: string, ...content: (Node | string | null)[]): void {
    this.titleEl.textContent = title;
    this.body.replaceChildren(...content.filter((c): c is Node | string => c !== null));
    this.el.classList.remove('hidden');
  }

  close(): void {
    if (!this.open) return;
    this.el.classList.add('hidden');
    this.onClose?.();
  }
}

export class Windows {
  readonly dialog: Win;
  readonly shop: Win;
  readonly learn: Win;
  readonly storage: Win;
  readonly prompt: Win;
  readonly invite: Win;
  /** 현재 대화 중인 NPC 엔티티 id */
  npcId: number | null = null;
  /** 열려 있는 기술 배우기 창의 내용 (서버가 보낸 그대로, 상태가 바뀌면 다시 판정해 그림) */
  private learnData: { npc: number; name: string; classId: ClassId; list: LearnEntry[] } | null = null;
  /** 배운 기술을 목록에서 숨길지 */
  private hideLearned = false;
  /** 마지막으로 그린 배우기 목록 (같으면 다시 그리지 않음) */
  private learnKey = '';

  constructor(
    root: HTMLElement,
    private readonly game: Game,
  ) {
    this.dialog = new Win(root, 'win-dialog', () => this.onDialogClosed());
    this.shop = new Win(root, 'win-shop', () => this.game.panel.setInvMode('normal'));
    this.learn = new Win(root, 'win-learn');
    this.storage = new Win(root, 'win-storage', () => this.game.panel.setInvMode('normal'));
    this.prompt = new Win(root, 'win-prompt');
    this.invite = new Win(root, 'win-prompt');
  }

  private onDialogClosed(): void {
    if (this.npcId !== null && !this.shop.open && !this.learn.open && !this.storage.open) {
      this.game.net.send({ t: 'pick', npc: this.npcId, key: 'close' });
    }
  }

  /** Esc: 위에 떠 있는 창부터 닫습니다. 닫은 창이 있으면 true */
  closeTop(): boolean {
    for (const w of [this.prompt, this.invite, this.shop, this.learn, this.storage, this.dialog]) {
      if (w.open) {
        w.close();
        return true;
      }
    }
    return false;
  }

  closeAll(): void {
    for (const w of [this.prompt, this.shop, this.learn, this.storage, this.dialog]) w.el.classList.add('hidden');
    this.game.panel.setInvMode('normal');
    this.npcId = null;
  }

  /** NPC가 멀어지면 창을 닫습니다 */
  checkDistance(): void {
    if (this.npcId === null) return;
    const npc = this.game.state.entities.get(this.npcId);
    const me = this.game.state.me;
    if (!npc || !me || Math.abs(npc.x - me.x) > 5 || Math.abs(npc.y - me.y) > 5) {
      if (this.dialog.open || this.shop.open || this.learn.open || this.storage.open) this.closeAll();
    }
  }

  showDialog(npc: number, name: string, title: string | undefined, text: string, options: DialogOption[]): void {
    this.npcId = npc;
    this.shop.el.classList.add('hidden');
    this.learn.el.classList.add('hidden');
    this.storage.el.classList.add('hidden');
    this.game.panel.setInvMode('normal');
    // 전직·승급·2차 전직의 조건 줄("○ 순수 체력 …", "× 경험치 …")은 채움/모자람 색으로
    const paragraphs = text.split('\n').map((l) => h('p', { class: l.startsWith('○ ') ? 'cond-ok' : l.startsWith('× ') ? 'cond-bad' : undefined }, l));
    const opts = h(
      'div',
      { class: 'dialog-options' },
      ...options.map((o, i) =>
        h(
          'button',
          {
            class: 'btn option',
            onclick: () => {
              if (o.key === 'close') {
                this.npcId = null;
                this.dialog.el.classList.add('hidden');
              }
              this.game.net.send({ t: 'pick', npc, key: o.key });
            },
          },
          h('small', null, `${i + 1}. `),
          o.label,
        ),
      ),
    );
    const look = this.game.state.entities.get(npc)?.look;
    this.dialog.show(
      title ? `${name} — ${title}` : name,
      h(
        'div',
        { class: 'dialog-wrap' },
        look ? h('div', { class: 'npc-portrait' }, h('img', { src: portraitUrl(look, 150, 190, 2.9), alt: name, draggable: false })) : null,
        h('div', { class: 'dialog-main' }, h('div', { class: 'dialog-text' }, ...paragraphs), opts),
      ),
    );
  }

  /** 대화창이 열려 있을 때 숫자키로 선택지 고르기 */
  pickByNumber(n: number): boolean {
    if (!this.dialog.open) return false;
    const btns = this.dialog.body.querySelectorAll<HTMLButtonElement>('.dialog-options .btn');
    const b = btns[n];
    if (!b) return false;
    b.click();
    return true;
  }

  showShop(npc: number, name: string, items: { item: string; price: number }[], sell: boolean): void {
    this.npcId = npc;
    this.dialog.el.classList.add('hidden');
    const st = this.game.state;
    const goldEl = h('div', { class: 'shop-gold' }, `가진 골드: ${fmt(st.gold)}`);
    const rows = items.map(({ item, price }) => {
      const def = st.items.get(item);
      if (!def) return null;
      const stack = def.type !== 'equip' && (def.stack ?? 1) > 1;
      const qty = h('input', { type: 'number', class: 'qty-input', min: 1, max: 1000, value: '1' });
      const usable = (!def.level || (st.self?.level ?? 0) >= def.level) && (!def.classes?.length || def.classes.includes(st.self?.classId as never));
      const row = h(
        'div',
        { class: `shop-row ${usable ? '' : 'unusable'}` },
        h('img', { src: iconUrl(def.icon, 30), alt: '' }),
        h('div', { class: 'shop-name' }, def.name, def.level && def.level > 1 ? h('small', null, ` Lv.${def.level}`) : null),
        h('div', { class: 'shop-price' }, `${fmt(price)} G`),
        stack ? qty : null,
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => this.game.net.send({ t: 'buy', npc, item, qty: stack ? Math.max(1, Math.floor(Number(qty.value) || 1)) : 1 }),
          },
          '사기',
        ),
      );
      this.game.tooltip.attach(row, () => itemTooltip(def, { myLevel: st.self?.level, myClass: st.self?.classId, price }));
      return row;
    });
    const content: (Node | null)[] = [goldEl];
    if (rows.length) content.push(h('div', { class: 'shop-list' }, ...rows.filter((r): r is HTMLDivElement => r !== null)));
    if (sell) {
      content.push(
        h(
          'div',
          { class: 'shop-sell' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => this.game.panel.setInvMode(this.game.panel.invMode === 'sell' ? 'normal' : 'sell'),
            },
            '물건 팔기 (소지품에서 클릭)',
          ),
          h('small', null, ' 판매가는 구매가의 절반입니다.'),
        ),
      );
    }
    this.shop.show(`${name}의 상점`, ...content);
    if (sell && rows.length === 0) this.game.panel.setInvMode('sell');
  }

  refreshShopGold(): void {
    const g = this.shop.body.querySelector('.shop-gold');
    if (g) g.textContent = `가진 골드: ${fmt(this.game.state.gold)}`;
  }

  /** 길드장의 기술 배우기 창: classId 트리의 기술마다 배우는 조건(채움/모자람)과 배우기 단추 */
  showLearn(npc: number, name: string, classId: ClassId, list: LearnEntry[]): void {
    this.npcId = npc;
    this.dialog.el.classList.add('hidden');
    // 서버가 막 보낸 판정을 그대로 그림 (배운 직후라면 내 상태 메시지보다 먼저 옴)
    this.learnData = { npc, name, classId, list };
    this.renderLearn(list, true);
  }

  /**
   * 기술 배우기 창이 열린 채로 골드·소지품·기술·숙련도가 바뀌면 지금 상태로 다시 판정합니다.
   * force: 설계가 바뀌었을 때처럼 목록이 같아도 (기술 이름·설명이 바뀌었을 수 있어) 다시 그림
   */
  refreshLearn(force = false): void {
    const d = this.learnData;
    if (!d || !this.learn.open) return;
    const st = this.game.state;
    const ctx = st.learnContext();
    if (!ctx) return;
    this.renderLearn(refreshLearnEntries(d.classId, d.list, st.data.skillTrees[d.classId], ctx), force);
  }

  private renderLearn(list: LearnEntry[], force: boolean): void {
    const d = this.learnData;
    if (!d) return;
    const st = this.game.state;
    // 배운 줄의 숙련도는 목록에 없으므로 숙련도도 함께 비교
    const key = JSON.stringify([list, this.hideLearned, st.gold, st.self?.prof]);
    if (!force && key === this.learnKey) return;
    this.learnKey = key;
    const scroll = this.learn.body.querySelector('.learn-list')?.scrollTop ?? 0;
    const prof = st.data.progression.proficiency;
    const className = st.className(d.classId);
    const second = list.some((a) => a.abilityLevel > 0);
    const rows = list.map((a) => {
      const def = st.abilities.get(a.id);
      if (!def || (this.hideLearned && a.learned)) return null;
      const need = a.abilityLevel > 0 ? `어빌 ${a.abilityLevel}` : `Lv.${a.level}`;
      let side: HTMLElement;
      if (a.learned) {
        const p = profInfo(st.prof(a.id), prof);
        side = h(
          'div',
          { class: 'learn-side' },
          h('span', { class: 'learned-tag' }, '배움'),
          h('span', { class: `learn-prof${p.maxed ? ' max' : ''}`, title: `숙련도 ${p.prof} / ${p.max} · 위력 ${p.effectPct}%` }, `숙련 ${p.prof}`, h('i', null, h('b', { style: { width: `${p.ratio * 100}%` } }))),
        );
      } else {
        side = h(
          'div',
          { class: 'learn-side' },
          h('span', { class: 'shop-price' }, a.price ? `${fmt(a.price)} G` : '무료'),
          h(
            'button',
            {
              class: `btn small${a.learnable ? ' primary' : ''}`,
              disabled: !a.learnable,
              title: a.learnable ? '배우기 (골드와 재료를 냅니다)' : (a.reason ?? ''),
              onclick: () => this.game.net.send({ t: 'learnAbility', npc: d.npc, id: a.id }),
            },
            '배우기',
          ),
        );
      }
      const row = h(
        'div',
        { class: `learn-row ${a.learned ? 'learned' : a.learnable ? 'learnable' : 'locked'}` },
        h('img', { src: abilityIconUrl(def.icon, 30), alt: '' }),
        h('div', { class: 'learn-name' }, def.name, h('small', null, ` ${def.kind === 'skill' ? '기술' : '마법'} · ${need}`)),
        side,
        // 배운 기술은 조건 대신 숙련도만
        !a.learned && a.reqs.length
          ? h('div', { class: 'learn-reqs' }, ...a.reqs.map((r) => h('span', { class: `req ${r.met ? 'met' : 'unmet'}` }, `${r.met ? '✓' : '✗'} ${reqText(r)}`)))
          : null,
      );
      // 조건은 줄에 이미 보이므로 툴팁에는 설명과 숙련도만
      this.game.tooltip.attach(row, () =>
        abilityTooltip(def, {
          ...(a.learned ? { prof: { value: st.prof(a.id), cfg: prof } } : {}),
          extra: a.learned ? '이미 배웠습니다' : a.learnable ? `배울 수 있습니다 · ${a.price ? fmt(a.price) + ' 골드' : '무료'}` : (a.reason ?? ''),
        }),
      );
      return row;
    });
    const shown = rows.filter((r): r is HTMLDivElement => r !== null);
    const can = list.filter((a) => a.learnable).length;
    const learned = list.filter((a) => a.learned).length;
    const toggle = h('input', {
      type: 'checkbox',
      checked: this.hideLearned,
      onchange: (e: Event) => {
        this.hideLearned = (e.target as HTMLInputElement).checked;
        this.refreshLearnNow();
      },
    });
    const listEl = h(
      'div',
      { class: 'shop-list learn-list' },
      ...(shown.length ? shown : [h('div', { class: 'hint center' }, list.length ? '모두 배웠습니다.' : '이 길드에서 배울 기술이 없습니다.')]),
    );
    this.learn.show(
      `${d.name} — ${d.classId === 'peasant' ? '기본' : className} 기술·마법 배우기`,
      h(
        'div',
        { class: 'learn-head' },
        h('span', { class: 'shop-gold' }, `가진 골드 ${fmt(st.gold)}`),
        h('span', { class: 'learn-count' }, `배울 수 있는 것 ${can}개 · 배운 것 ${learned}/${list.length}`),
        h('label', { class: 'inline learn-filter' }, toggle, '배운 것 숨기기'),
      ),
      listEl,
      h(
        'div',
        { class: 'hint' },
        `조건을 모두 채우면 배울 수 있습니다. 재료는 배울 때 사라집니다. ${second ? '2차 직업 기술은 필요 레벨 대신 필요 어빌을 봅니다. ' : ''}`,
        h('span', { class: 'dim' }, 'K 키: 스킬트리에서 선수과목 연결 보기'),
      ),
    );
    listEl.scrollTop = scroll;
  }

  /** 숨기기를 바꿨을 때: 지금 상태로 곧바로 다시 그림 */
  private refreshLearnNow(): void {
    this.learnKey = '';
    this.refreshLearn();
  }

  showStorage(npc: number, slots: InvSlot[], gold: number): void {
    this.npcId = npc;
    this.dialog.el.classList.add('hidden');
    const st = this.game.state;
    const grid = h('div', { class: 'slot-grid storage-grid' });
    slots.forEach((s, i) => {
      const def = st.items.get(s.item);
      if (!def) return;
      const slot = h(
        'div',
        { class: 'slot' },
        h('img', { src: iconUrl(def.icon), alt: def.name }),
        s.qty > 1 ? h('span', { class: 'qty' }, String(s.qty)) : null,
      );
      slot.addEventListener('click', () => this.game.net.send({ t: 'withdraw', npc, index: i, qty: s.qty }));
      this.game.tooltip.attach(slot, () => itemTooltip(def, { qty: s.qty }));
      grid.appendChild(slot);
    });
    const amount = h('input', { type: 'number', class: 'qty-input wide', min: 1, placeholder: '골드' });
    this.storage.show(
      '창고',
      h('div', { class: 'shop-gold' }, `맡긴 골드: ${fmt(gold)} · 가진 골드: ${fmt(st.gold)}`),
      h(
        'div',
        { class: 'row' },
        amount,
        h('button', { class: 'btn small', onclick: () => this.game.net.send({ t: 'depositGold', npc, amount: Math.floor(Number(amount.value) || 0) }) }, '맡기기'),
        h('button', { class: 'btn small', onclick: () => this.game.net.send({ t: 'withdrawGold', npc, amount: Math.floor(Number(amount.value) || 0) }) }, '찾기'),
      ),
      h('div', { class: 'hint' }, `창고 물건 (${slots.length}/60) — 클릭하면 꺼냅니다. 맡기려면 소지품의 물건을 클릭하세요.`),
      grid,
    );
    this.game.panel.setInvMode('deposit');
  }

  /** 숫자 입력 상자 */
  askNumber(title: string, label: string, max: number, onOk: (n: number) => void): void {
    const input = h('input', { type: 'number', class: 'qty-input wide', min: 1, max, value: String(max) });
    const ok = () => {
      const n = Math.max(1, Math.min(max, Math.floor(Number(input.value) || 0)));
      this.prompt.close();
      if (n > 0) onOk(n);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok();
      if (e.key === 'Escape') this.prompt.close();
    });
    this.prompt.show(title, h('p', null, label), input, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: ok }, '확인'), h('button', { class: 'btn', onclick: () => this.prompt.close() }, '취소')));
    setTimeout(() => input.select(), 20);
  }

  showInvite(from: string): void {
    this.invite.show(
      '그룹 초대',
      h('p', null, `${from}님이 그룹에 초대했습니다.`),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              this.game.net.send({ t: 'groupReply', accept: true });
              this.invite.close();
            },
          },
          '수락',
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              this.game.net.send({ t: 'groupReply', accept: false });
              this.invite.close();
            },
          },
          '거절',
        ),
      ),
    );
  }
}
