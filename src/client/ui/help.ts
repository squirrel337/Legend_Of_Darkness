// 도움말 창 (H 키)
import { h } from './dom';

const KEYS: [string, string][] = [
  ['방향키', '이동 (마우스로 땅을 클릭해도 이동)'],
  ['스페이스', '앞의 적 공격 (누르고 있으면 계속, 인접한 대상 쪽으로 자동으로 돌아섬)'],
  ['1 ~ 0', '아래 칸(소지품/기술/마법)의 1~10번째 칸 사용'],
  ['A / S / D / F / G', '아래 칸 바꾸기: 소지품 / 기술 / 마법 / 대화 기록 / 능력치'],
  ['C', '캐릭터 정보 (일러스트와 장비)'],
  ['M', '지도 켜기/끄기'],
  ['Q / W', '체력 물약 / 마나 물약 사용'],
  ['Tab', '가까운 몬스터를 대상으로 지정'],
  ['클릭', '몬스터·사람: 대상 지정 / NPC: 대화 / 아이템: 줍기'],
  ['E', '발밑(또는 앞)의 아이템 줍기'],
  ['R', '유령일 때 마을로 돌아가기'],
  ['Enter', '대화 입력 (!외치기  @이름 귓속말  #그룹)'],
  ['Esc', '창 닫기 / 대상 해제'],
  ['F2', '운영자 도구 (운영자만)'],
  ['H', '이 도움말'],
];

const TIPS = [
  '5레벨이 되면 마을의 길드장에게서 직업을 고를 수 있습니다. 직업을 고르면 시작 장비를 받습니다.',
  '목걸이는 공격 속성, 허리띠는 방어 속성을 정합니다. 불>바람>땅>물>불, 빛과 어둠은 서로에게 강합니다.',
  'AC는 낮을수록(음수일수록) 받는 피해가 줄어듭니다.',
  '죽으면 유령이 됩니다. 신전의 사제에게 말을 걸면 부활합니다. 성직자의 부활 마법으로도 살아날 수 있습니다.',
  '만렙(99) 이후 쌓인 경험치는 승급 장인 오그마에게 가서 최대 체력/마나로 바꿀 수 있습니다.',
  '창고지기 오언에게 물건과 골드를 맡길 수 있습니다.',
];

export class Help {
  readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = h(
      'div',
      { class: 'help hidden', onclick: () => this.toggle(false) },
      h(
        'div',
        { class: 'help-box', onclick: (e: Event) => e.stopPropagation() },
        h('h2', null, '조작 방법'),
        h('table', null, ...KEYS.map(([k, d]) => h('tr', null, h('td', { class: 'key' }, k), h('td', null, d)))),
        h('h2', null, '알아 두면 좋은 것'),
        h('ul', null, ...TIPS.map((t) => h('li', null, t))),
        h('button', { class: 'btn primary', onclick: () => this.toggle(false) }, '닫기'),
      ),
    );
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    this.el.classList.toggle('hidden', force === undefined ? this.open : !force);
  }
}
