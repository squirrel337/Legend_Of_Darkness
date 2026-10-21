// 도움말 창 (H 키)
import type { PublicProgression } from '../../shared/progression';
import { clear, h } from './dom';

const KEYS: [string, string][] = [
  ['방향키', '이동 (마우스로 땅을 클릭해도 이동)'],
  ['스페이스', '앞의 적 공격 (누르고 있으면 계속, 인접한 대상 쪽으로 자동으로 돌아섬)'],
  ['1 ~ 0', '아래 칸(소지품/기술/마법)의 1~10번째 칸 사용'],
  ['A / S / D / F / G', '아래 칸 바꾸기: 소지품 / 기술 / 마법 / 대화 기록 / 능력치'],
  ['C', '캐릭터 정보 (일러스트와 장비, 칭호·전직 횟수·어빌)'],
  ['K', '스킬트리 (배운 기술과 숙련도, 다음에 배울 기술과 모자란 조건)'],
  ['M', '지도 켜기/끄기'],
  ['Q / W', '체력 물약 / 마나 물약 사용'],
  ['Tab', '가까운 몬스터를 대상으로 지정'],
  ['클릭', '몬스터·사람: 대상 지정 / NPC: 대화 / 아이템: 줍기'],
  ['E', '발밑(또는 앞)의 아이템 줍기'],
  ['R', '유령일 때 마을로 돌아가기'],
  ['Z / Shift+Z', '자동사냥 켜기·끄기 / 자동사냥 설정'],
  ['Enter', '대화 입력 (!외치기  @이름 귓속말  #그룹)'],
  ['Esc', '창 닫기 / 대상 해제'],
  ['F2', '운영자 도구 (운영자만)'],
  ['H', '이 도움말'],
];

/** 알아 두면 좋은 것 (성장 규칙의 수치는 서버 설정에서) */
function tips(p: PublicProgression | null): string[] {
  const lv = p?.rebirth.level ?? 99;
  const title = p?.ascend.title || '마스터';
  const max = p?.proficiency.max ?? 100;
  const abMax = p?.ability.maxLevel ?? 99;
  return [
    '5레벨이 되면 마을의 길드장에게서 1차 직업(전사·도적·마법사·성직자·무도가)을 고를 수 있습니다. 직업을 고르면 시작 장비를 받습니다.',
    '기술·마법은 지금 직업의 길드장에게서 배웁니다. 레벨·골드·재료와 선수과목(먼저 배운 기술의 숙련도)이 필요하며, K 키의 스킬트리에서 모자란 조건을 볼 수 있습니다.',
    `숙련도는 기술·마법을 쓸 때마다 확률로 1씩 올라 최대 ${max} 이 되고, 높을수록 위력과 상태 이상 확률이 커집니다. 수련장의 허수아비로도 올릴 수 있습니다.`,
    `${lv}레벨이 되면 새로 걸을 직업의 길드장에게서 전직(무도가는 환골탈태)해 1레벨부터 다시 시작할 수 있습니다. 배운 기술과 숙련도, 산 체력·마나, 장비와 골드는 그대로입니다 (1레벨로 입을 수 없는 장비는 벗겨 소지품에 넣어 줍니다).`,
    `승급 장인 오그마는 ${lv}레벨부터 경험치로 최대 체력·마나를, 최대 체력으로 능력치를 바꿔 주고, 조건을 채우면 승급시켜 줍니다 (칭호 "${title}").`,
    `승급한 뒤 2차 직업 인도자에게 2차 전직하면 레벨은 그대로이고 어빌리티 레벨(어빌)이 1부터 ${abMax}까지 오릅니다. 2차 직업 기술은 필요 어빌로 배웁니다.`,
    '목걸이는 공격 속성, 허리띠는 방어 속성을 정합니다. 불>바람>땅>물>불, 빛과 어둠은 서로에게 강합니다.',
    'AC는 낮을수록(음수일수록) 받는 피해가 줄어듭니다.',
    '죽으면 유령이 됩니다. 신전의 사제에게 말을 걸면 부활합니다. 성직자의 부활 마법으로도 살아날 수 있습니다.',
    '창고지기 오언에게 물건과 골드를 맡길 수 있습니다.',
  ];
}

export class Help {
  readonly el: HTMLElement;
  private readonly tipList: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly progression: () => PublicProgression | null = () => null,
  ) {
    this.tipList = h('ul');
    this.el = h(
      'div',
      { class: 'help hidden', onclick: () => this.toggle(false) },
      h(
        'div',
        { class: 'help-box', onclick: (e: Event) => e.stopPropagation() },
        h('h2', null, '조작 방법'),
        h('table', null, ...KEYS.map(([k, d]) => h('tr', null, h('td', { class: 'key' }, k), h('td', null, d)))),
        h('h2', null, '알아 두면 좋은 것'),
        this.tipList,
        h('button', { class: 'btn primary', onclick: () => this.toggle(false) }, '닫기'),
      ),
    );
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  toggle(force?: boolean): void {
    const on = force === undefined ? !this.open : force;
    // 여는 순간의 서버 설정으로 (관리자가 성장 규칙을 바꿨을 수 있음)
    if (on) {
      clear(this.tipList);
      for (const t of tips(this.progression())) this.tipList.appendChild(h('li', null, t));
    }
    this.el.classList.toggle('hidden', !on);
  }
}
