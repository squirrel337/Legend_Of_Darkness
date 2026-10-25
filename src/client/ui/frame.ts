// 화면 아래에 고정된 클래식 패널의 뼈대.
// 왼쪽: 체력/마나 게이지 · 가운데: 메시지 줄, 칸(소지품/기술/마법/대화/능력치), 상태 줄 · 오른쪽: 탭/메뉴 단추
import { h } from './dom';

export class BottomFrame {
  readonly el: HTMLElement;
  readonly left: HTMLElement;
  readonly message: HTMLElement;
  readonly pane: HTMLElement;
  readonly status: HTMLElement;
  readonly right: HTMLElement;

  constructor(root: HTMLElement) {
    this.left = h('div', { class: 'lod-left' });
    this.message = h('div', { class: 'lod-msg' });
    this.pane = h('div', { class: 'lod-pane' });
    this.status = h('div', { class: 'lod-status' });
    this.right = h('div', { class: 'lod-right' });
    this.el = h(
      'div',
      { class: 'lod-panel' },
      h('div', { class: 'lod-inner' }, this.left, h('div', { class: 'lod-center' }, this.message, this.pane, this.status), this.right),
    );
    root.appendChild(this.el);
  }
}

/** 단추에 쓰는 작은 그림 (SVG). 모두 직접 그린 단순한 도형입니다. */
const ICONS: Record<string, string> = {
  bag: '<path d="M7 8 Q7 4 12 4 Q17 4 17 8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 8.5 H19.5 L18.2 20 H5.8 Z" fill="currentColor" opacity=".9"/><path d="M9 12 H15" stroke="#2a1608" stroke-width="1.6"/>',
  sword: '<path d="M18.5 3.5 L20.5 5.5 L10 16 L8 14 Z" fill="currentColor"/><path d="M6 12 L12 18 M5 19 L8.5 15.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  spark: '<path d="M12 2 L14 9.5 L21.5 12 L14 14.5 L12 22 L10 14.5 L2.5 12 L10 9.5 Z" fill="currentColor"/><circle cx="18.5" cy="5.5" r="1.6" fill="currentColor"/>',
  talk: '<path d="M3.5 5 H20.5 V15.5 H11 L6 20 V15.5 H3.5 Z" fill="currentColor"/><path d="M7 9 H17 M7 12 H14" stroke="#2a1608" stroke-width="1.4"/>',
  stats: '<rect x="4" y="12" width="3.4" height="8" fill="currentColor"/><rect x="10.3" y="7" width="3.4" height="13" fill="currentColor"/><rect x="16.6" y="3.5" width="3.4" height="16.5" fill="currentColor"/>',
  person: '<circle cx="12" cy="7.2" r="4" fill="currentColor"/><path d="M4.5 21 Q4.5 12.5 12 12.5 Q19.5 12.5 19.5 21 Z" fill="currentColor"/>',
  tree: '<path d="M12 7 V11.5 M12 11.5 Q6.2 11.5 6.2 16 M12 11.5 Q17.8 11.5 17.8 16" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="9" y="2.5" width="6" height="6" rx="1" fill="currentColor"/><rect x="3.2" y="15.5" width="6" height="6" rx="1" fill="currentColor"/><rect x="14.8" y="15.5" width="6" height="6" rx="1" fill="currentColor"/>',
  group: '<circle cx="8.5" cy="8" r="3.2" fill="currentColor"/><circle cx="16" cy="8.6" r="2.8" fill="currentColor" opacity=".8"/><path d="M2.5 20 Q2.5 13 8.5 13 Q14.5 13 14.5 20 Z" fill="currentColor"/><path d="M13.5 13.8 Q20.5 12.6 21.5 20 H15.8" fill="currentColor" opacity=".8"/>',
  map: '<path d="M3 6 L9 3.5 L15 6 L21 3.5 V18 L15 20.5 L9 18 L3 20.5 Z" fill="currentColor"/><path d="M9 3.5 V18 M15 6 V20.5" stroke="#2a1608" stroke-width="1.3"/>',
  help: '<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M9.2 9.4 Q9.4 6.6 12.2 6.6 Q15 6.8 14.8 9.4 Q14.6 11 12.4 12 V14" fill="none" stroke="#2a1608" stroke-width="2" stroke-linecap="round"/><circle cx="12.4" cy="17.2" r="1.3" fill="#2a1608"/>',
  crown: '<path d="M3.5 18 L2.5 7.5 L8 11.5 L12 4.5 L16 11.5 L21.5 7.5 L20.5 18 Z" fill="currentColor"/><rect x="3.5" y="18.6" width="17" height="2.2" fill="currentColor"/>',
  home: '<path d="M3 11.5 L12 3.5 L21 11.5 H18.5 V20.5 H14 V15 H10 V20.5 H5.5 V11.5 Z" fill="currentColor"/>',
  auto: '<path d="M12 3.5 A8.5 8.5 0 1 1 3.6 13.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M1.2 10.6 L3.8 14.4 L7.2 11.6 Z" fill="currentColor"/><path d="M9.5 8 L16 12 L9.5 16 Z" fill="currentColor"/>',
};

export function svgIcon(name: keyof typeof ICONS | string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}
