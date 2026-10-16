// 대화: 패널의 메시지 줄(입력 겸용), 화면 왼쪽 위의 최근 대화, F 창의 전체 기록
import { CHAT_MAX } from '../../shared/constants';
import type { ChatChannel } from '../../shared/protocol';
import { h } from './dom';
import type { BottomFrame } from './frame';

const MAX_LINES = 200;
const OVERLAY_LINES = 6;
const OVERLAY_MS = 9000;

const LABEL: Record<ChatChannel, string> = {
  say: '',
  shout: '[외침] ',
  whisper: '[귓속말] ',
  group: '[그룹] ',
  system: '',
  notice: '[알림] ',
  gm: '[GM] ',
  error: '',
};

export class ChatBox {
  readonly input: HTMLInputElement;
  /** F 창에 붙이는 전체 기록 */
  readonly log: HTMLElement;
  private readonly lineText: HTMLElement;
  private readonly overlay: HTMLElement;
  private history: string[] = [];
  private histIdx = -1;

  constructor(
    root: HTMLElement,
    frame: BottomFrame,
    private readonly onSend: (text: string) => void,
  ) {
    this.log = h('div', { class: 'chat-log' });
    this.overlay = h('div', { class: 'chat-overlay' });
    this.lineText = h('span', { class: 'msg-text' }, 'Enter 를 누르면 대화할 수 있습니다.');
    this.input = h('input', {
      class: 'chat-input hidden',
      type: 'text',
      maxLength: CHAT_MAX,
      placeholder: '대화  (!외치기  @이름 귓속말  #그룹  /도움말)',
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) {
          this.onSend(text);
          this.history.unshift(text);
          if (this.history.length > 50) this.history.pop();
        }
        this.input.value = '';
        this.histIdx = -1;
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'ArrowUp') {
        if (this.histIdx < this.history.length - 1) this.input.value = this.history[++this.histIdx] ?? '';
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.histIdx = Math.max(-1, this.histIdx - 1);
        this.input.value = this.histIdx >= 0 ? (this.history[this.histIdx] ?? '') : '';
        e.preventDefault();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => this.showInput(false));
    frame.message.append(h('span', { class: 'msg-prompt' }, '▶'), this.lineText, this.input);
    frame.message.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) {
        e.preventDefault();
        this.focus();
      }
    });
    root.appendChild(this.overlay);
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }

  private showInput(on: boolean): void {
    this.input.classList.toggle('hidden', !on);
    this.lineText.classList.toggle('hidden', on);
  }

  focus(prefix = ''): void {
    this.showInput(true);
    if (prefix && !this.input.value) this.input.value = prefix;
    this.input.focus();
  }

  add(ch: ChatChannel, text: string, from?: string): void {
    const parts = (cls: string) =>
      h('div', { class: `${cls} ch-${ch}` }, LABEL[ch], from ? h('b', null, `${from}: `) : null, text);
    // 전체 기록
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 30;
    this.log.appendChild(parts('chat-line'));
    while (this.log.children.length > MAX_LINES) this.log.firstChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    // 메시지 줄
    this.lineText.className = `msg-text ch-${ch}`;
    this.lineText.textContent = `${LABEL[ch]}${from ? `${from}: ` : ''}${text}`;
    // 화면 왼쪽 위
    const ol = parts('ol');
    this.overlay.appendChild(ol);
    while (this.overlay.children.length > OVERLAY_LINES) this.overlay.firstChild?.remove();
    window.setTimeout(() => ol.classList.add('fade'), OVERLAY_MS);
    window.setTimeout(() => ol.remove(), OVERLAY_MS + 900);
  }
}
