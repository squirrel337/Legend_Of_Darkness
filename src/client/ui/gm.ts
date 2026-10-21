// 운영자(GM) 도구 창: 버튼 하나로 캐릭터를 빠르게 성장시킵니다. 내부적으로 채팅 명령어를 보냅니다.
import type { Game } from '../game';
import { h, makeDraggable } from './dom';

const CLASS_OPTIONS: [string, string][] = [
  ['전사', '전사'],
  ['도적', '도적'],
  ['마법사', '마법사'],
  ['성직자', '성직자'],
  ['무도가', '무도가'],
  ['소환사', '소환사'],
  ['바드', '바드'],
  ['수인', '수인'],
  ['궁사', '궁사'],
  ['검투사', '검투사'],
  ['평민', '평민'],
];

export class GmTool {
  readonly el: HTMLElement;
  private readonly target: HTMLInputElement;
  private readonly rateInputs: HTMLInputElement[] = [];
  private built = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
  ) {
    this.target = h('input', { type: 'text', placeholder: '비우면 나 자신', maxLength: 12, class: 'gm-target' });
    this.el = h('div', { class: 'win win-gm hidden' });
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(): void {
    const self = this.game.state.self;
    if (!self || self.role === 'player') {
      this.game.hud.notice('운영자 권한이 없습니다.', 'warn');
      return;
    }
    if (!this.built) this.build();
    this.el.classList.toggle('hidden');
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  /** 대상 이름을 앞에 붙여 명령을 보냅니다 */
  private cmd(name: string, ...args: (string | number)[]): void {
    const t = this.target.value.trim().replace(/^@/, '');
    const parts = [`/${name}`];
    if (t) parts.push(`@${t}`);
    for (const a of args) if (String(a).trim() !== '') parts.push(String(a));
    this.game.sendChat(parts.join(' '));
  }

  private build(): void {
    this.built = true;
    const g = this.game;
    const st = g.state;
    const isAdmin = st.self?.role === 'admin';
    const btn = (label: string, fn: () => void, cls = '') => h('button', { class: `btn small ${cls}`, onclick: fn }, label);
    const sel = (opts: [string, string][]) => h('select', null, ...opts.map(([v, l]) => h('option', { value: v }, l)));

    const levelInput = h('input', { type: 'number', min: 1, max: st.data.server.maxLevel, value: String(st.data.server.maxLevel), class: 'num' });
    const expInput = h('input', { type: 'text', value: '100만', class: 'num' });
    const goldInput = h('input', { type: 'text', value: '100만', class: 'num' });
    const classSel = sel(CLASS_OPTIONS);
    const maxClassSel = sel([['', '현재 직업'], ...CLASS_OPTIONS.filter(([v]) => v !== '평민')]);

    const itemInput = h('input', { type: 'text', placeholder: '아이템 이름 (예: 엘릭서)', list: 'gm-items', class: 'wide' });
    const itemList = h('datalist', { id: 'gm-items' }, ...st.data.items.map((i) => h('option', { value: i.name })));
    const itemQty = h('input', { type: 'number', min: 1, value: '1', class: 'num' });

    const mapSel = sel(st.data.maps.map((m) => [m.id, `${m.name}${m.levelRange ? ` (${m.levelRange[0]}~${m.levelRange[1]})` : ''}`]));
    // 소환수 전용 몬스터는 맵에 불러낼 수 없으므로 목록에서 뺌
    const monSel = sel(st.data.monsters.filter((m) => !m.summon).map((m) => [m.name, `${m.name} Lv.${m.level}${m.boss ? ' ★' : ''}`]));
    const monCount = h('input', { type: 'number', min: 1, max: 50, value: '3', class: 'num' });
    const announce = h('input', { type: 'text', placeholder: '공지 내용', class: 'wide' });
    const who = h('input', { type: 'text', placeholder: '이름', class: 'num' });

    const rates = (['경험치', '골드', '드롭'] as const).map((label, i) => {
      const key = (['expRate', 'goldRate', 'dropRate'] as const)[i]!;
      const input = h('input', { type: 'number', min: 0, step: '0.5', value: String(st.data.server[key]), class: 'num' });
      this.rateInputs.push(input);
      return h('label', { class: 'inline' }, label, ' x', input);
    });

    const section = (title: string, ...rows: (Node | null)[]) => h('div', { class: 'gm-section' }, h('div', { class: 'section-title' }, title), ...rows);
    const row = (...c: (Node | string | null)[]) => h('div', { class: 'row' }, ...c);

    const head = h('div', { class: 'win-head' }, h('div', { class: 'win-title-text' }, '운영자 도구 (F2)'), h('button', { class: 'win-close', onclick: () => this.close() }, '×'));
    const body = h(
      'div',
      { class: 'win-body' },
      row(h('label', { class: 'inline' }, '대상 캐릭터 ', this.target), h('span', { class: 'hint' }, '접속하지 않은 캐릭터도 됩니다')),
      section(
        '빠른 성장',
        row(
          btn('만렙 세팅', () => this.cmd('만렙', maxClassSel.value), 'primary'),
          maxClassSel,
          h('span', { class: 'hint' }, '레벨 최대 + 능력치 최대 + 모든 기술 + 최고 장비'),
        ),
        row(
          btn('레벨 +1', () => this.cmd('레벨업', 1)),
          btn('레벨 +10', () => this.cmd('레벨업', 10)),
          levelInput,
          btn('레벨 설정', () => this.cmd('레벨', levelInput.value)),
        ),
        row(expInput, btn('경험치 주기', () => this.cmd('경험치', expInput.value)), goldInput, btn('골드 주기', () => this.cmd('골드', goldInput.value))),
        row(
          btn('능력치 최대', () => this.cmd('스탯최대')),
          btn('포인트 +100', () => this.cmd('포인트', 100)),
          btn('포인트 자동 분배', () => this.cmd('자동분배')),
          btn('능력치 초기화', () => this.cmd('스탯초기화')),
        ),
        row(btn('모든 기술/마법 배우기', () => this.cmd('배우기', '전부')), btn('레벨에 맞는 최고 장비', () => this.cmd('장비'))),
        row(classSel, btn('직업 바꾸기', () => this.cmd('직업', classSel.value))),
      ),
      section(
        '상태',
        row(btn('완전 회복', () => this.cmd('회복')), btn('부활', () => this.cmd('부활')), btn('무적 켜기', () => this.cmd('무적', '켜기')), btn('무적 끄기', () => this.cmd('무적', '끄기'))),
      ),
      section('아이템 지급', row(itemInput, itemQty, btn('지급', () => itemInput.value.trim() && this.cmd('아이템', itemInput.value.trim(), itemQty.value))), itemList),
      section(
        '이동',
        row(mapSel, btn('내가 이동', () => g.sendChat(`/이동 ${mapSel.value}`)), btn('대상 보내기', () => this.target.value.trim() && g.sendChat(`/보내기 ${this.target.value.trim()} ${mapSel.value}`))),
        row(who, btn('소환', () => who.value.trim() && g.sendChat(`/소환 ${who.value.trim()}`)), btn('찾아가기', () => who.value.trim() && g.sendChat(`/찾아가기 ${who.value.trim()}`))),
      ),
      section('몬스터', row(monSel, monCount, btn('소환', () => g.sendChat(`/몬스터 ${monSel.value} ${monCount.value}`)), btn('이 맵 몬스터 제거', () => g.sendChat('/몬스터제거')))),
      isAdmin
        ? section(
            '서버 배율 (관리자)',
            row(
              ...rates,
              btn('적용', () => {
                const [e, gg, d] = this.rateInputs.map((i) => i.value);
                g.sendChat(`/배율 경험치 ${e}`);
                g.sendChat(`/배율 골드 ${gg}`);
                g.sendChat(`/배율 드롭 ${d}`);
              }),
            ),
          )
        : null,
      section('공지', row(announce, btn('보내기', () => announce.value.trim() && (g.sendChat(`/공지 ${announce.value.trim()}`), (announce.value = ''))))),
      h('div', { class: 'hint' }, '결과는 채팅창에 표시됩니다. 웹 관리자 페이지(/admin)에서도 같은 작업을 할 수 있습니다.'),
    );
    for (const input of body.querySelectorAll('input, select')) {
      input.addEventListener('keydown', (e) => e.stopPropagation());
    }
    this.el.replaceChildren(head, body);
    makeDraggable(this.el, head);
    void this.root;
  }
}
