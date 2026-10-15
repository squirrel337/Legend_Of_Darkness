// 채팅창
import { CHAT_MAX } from '../../shared/constants';
import type { ChatChannel } from '../../shared/protocol';
import { h } from './dom';

const MAX_LINES = 200;

export class ChatBox {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly log: HTMLElement;
  private history: string[] = [];
  private histIdx = -1;

  constructor(
    root: HTMLElement,
    private readonly onSend: (text: string) => void,
  ) {
    this.log = h('div', { class: 'chat-log' });
    this.input = h('input', {
      class: 'chat-input',
      type: 'text',
      maxLength: CHAT_MAX,
      placeholder: 'Enter: 대화  (!외치기  @이름 귓속말  #그룹  /도움말)',
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
    this.el = h('div', { class: 'chat' }, this.log, this.input);
    root.appendChild(this.el);
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }

  focus(prefix = ''): void {
    if (prefix && !this.input.value) this.input.value = prefix;
    this.input.focus();
  }

  add(ch: ChatChannel, text: string, from?: string): void {
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 30;
    const label: Record<ChatChannel, string> = {
      say: '',
      shout: '[외침] ',
      whisper: '[귓속말] ',
      group: '[그룹] ',
      system: '',
      notice: '[알림] ',
      gm: '[GM] ',
      error: '',
    };
    const line = h(
      'div',
      { class: `chat-line ch-${ch}` },
      label[ch],
      from ? h('b', null, `${from}: `) : null,
      text,
    );
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}
