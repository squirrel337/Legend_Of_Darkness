// 접속 / 캐릭터 만들기 화면
import { HAIR_COLORS, HAIR_STYLES, NAME_REGEX, PASSWORD_MIN, type Dir } from '../../shared/constants';
import type { PublicServerInfo } from '../../shared/types';
import { drawHuman } from '../render/sprites';
import { h } from './dom';

export interface LoginHandlers {
  login(name: string, password: string): void;
  create(o: { name: string; password: string; gender: 'm' | 'f'; hairStyle: number; hairColor: number; invite?: string }): void;
}

export class LoginScreen {
  readonly el: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly serverName: HTMLElement;
  private readonly motd: HTMLElement;
  private readonly inviteRow: HTMLElement;
  private readonly createTabBtn: HTMLButtonElement;
  private mode: 'login' | 'create' = 'login';
  private readonly loginForm: HTMLFormElement;
  private readonly createForm: HTMLFormElement;
  private gender: 'm' | 'f' = 'm';
  private hairStyle = 0;
  private hairColor = 1;
  private preview: HTMLCanvasElement;
  private raf = 0;
  private busy = false;
  private server: PublicServerInfo | null = null;

  constructor(root: HTMLElement, private readonly handlers: LoginHandlers) {
    this.msg = h('div', { class: 'login-msg' });
    this.serverName = h('div', { class: 'login-server' }, '서버에 연결하는 중...');
    this.motd = h('div', { class: 'login-motd' });

    const lname = h('input', { type: 'text', name: 'name', placeholder: '캐릭터 이름', autocomplete: 'username', maxLength: 12 });
    const lpass = h('input', { type: 'password', name: 'password', placeholder: '비밀번호', autocomplete: 'current-password', maxLength: 64 });
    this.loginForm = h(
      'form',
      {
        class: 'login-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (this.busy) return;
          if (!lname.value.trim() || !lpass.value) return this.error('이름과 비밀번호를 입력하세요.');
          this.setBusy(true);
          this.handlers.login(lname.value.trim(), lpass.value);
        },
      },
      h('label', null, '캐릭터 이름', lname),
      h('label', null, '비밀번호', lpass),
      h('button', { type: 'submit', class: 'btn primary' }, '접속하기'),
    );

    const cname = h('input', { type: 'text', placeholder: '한글/영문 2~12자', maxLength: 12, autocomplete: 'off' });
    const cpass = h('input', { type: 'password', placeholder: `${PASSWORD_MIN}자 이상`, autocomplete: 'new-password', maxLength: 64 });
    const cpass2 = h('input', { type: 'password', placeholder: '비밀번호 확인', autocomplete: 'new-password', maxLength: 64 });
    const invite = h('input', { type: 'text', placeholder: '관리자에게 받은 초대 코드', maxLength: 100 });
    this.inviteRow = h('label', { class: 'hidden' }, '초대 코드', invite);
    this.preview = h('canvas', { class: 'preview', width: 120, height: 130 });
    const genderBtns = (['m', 'f'] as const).map((g) =>
      h('button', { type: 'button', class: `btn small ${g === this.gender ? 'active' : ''}`, onclick: () => this.setGender(g, genderBtns) }, g === 'm' ? '남자' : '여자'),
    );
    const styleBtns = Array.from({ length: HAIR_STYLES }, (_, i) =>
      h('button', { type: 'button', class: `btn small ${i === this.hairStyle ? 'active' : ''}`, onclick: () => this.setStyle(i, styleBtns) }, String(i + 1)),
    );
    const colorBtns = HAIR_COLORS.map((c, i) =>
      h('button', {
        type: 'button',
        class: `swatch ${i === this.hairColor ? 'active' : ''}`,
        style: { background: c },
        title: `머리색 ${i + 1}`,
        onclick: () => this.setColor(i, colorBtns),
      }),
    );
    this.createForm = h(
      'form',
      {
        class: 'login-form hidden',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (this.busy) return;
          const name = cname.value.trim();
          if (!NAME_REGEX.test(name)) return this.error('이름은 한글/영문으로 시작하는 2~12자(한글·영문·숫자)로 정하세요.');
          if (cpass.value.length < PASSWORD_MIN) return this.error(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`);
          if (cpass.value !== cpass2.value) return this.error('비밀번호 확인이 일치하지 않습니다.');
          this.setBusy(true);
          this.handlers.create({
            name,
            password: cpass.value,
            gender: this.gender,
            hairStyle: this.hairStyle,
            hairColor: this.hairColor,
            ...(invite.value ? { invite: invite.value.trim() } : {}),
          });
        },
      },
      h(
        'div',
        { class: 'create-grid' },
        h(
          'div',
          null,
          h('label', null, '캐릭터 이름', cname),
          h('label', null, '비밀번호', cpass),
          h('label', null, '비밀번호 확인', cpass2),
          this.inviteRow,
        ),
        h(
          'div',
          { class: 'create-look' },
          this.preview,
          h('div', { class: 'row' }, ...genderBtns),
          h('div', { class: 'row-label' }, '머리 모양'),
          h('div', { class: 'row' }, ...styleBtns),
          h('div', { class: 'row-label' }, '머리 색'),
          h('div', { class: 'row swatches' }, ...colorBtns),
        ),
      ),
      h('button', { type: 'submit', class: 'btn primary' }, '캐릭터 만들기'),
    );

    const loginTab = h('button', { type: 'button', class: 'tab active', onclick: () => this.setMode('login') }, '접속하기');
    this.createTabBtn = h('button', { type: 'button', class: 'tab', onclick: () => this.setMode('create') }, '새 캐릭터');
    this.el = h(
      'div',
      { class: 'login-screen' },
      h(
        'div',
        { class: 'login-box' },
        h('h1', { class: 'logo' }, '어둠의 전설'),
        h('div', { class: 'logo-sub' }, 'LEGEND OF DARKNESS · PRIVATE SERVER'),
        this.serverName,
        this.motd,
        h('div', { class: 'tabs' }, loginTab, this.createTabBtn),
        this.loginForm,
        this.createForm,
        this.msg,
        h('div', { class: 'login-foot' }, '이 게임은 어둠의 전설에서 영감을 받아 새로 만든 팬 프로젝트이며, 넥슨의 공식 서비스가 아닙니다.'),
      ),
    );
    root.appendChild(this.el);
    const tick = (t: number) => {
      this.drawPreview(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    setTimeout(() => lname.focus(), 50);
  }

  private setMode(m: 'login' | 'create'): void {
    this.mode = m;
    this.loginForm.classList.toggle('hidden', m !== 'login');
    this.createForm.classList.toggle('hidden', m !== 'create');
    const tabs = this.el.querySelectorAll('.tab');
    tabs[0]?.classList.toggle('active', m === 'login');
    tabs[1]?.classList.toggle('active', m === 'create');
    this.msg.textContent = '';
    if (m === 'create' && this.server?.registration === 'closed') this.error('이 서버는 새 캐릭터 생성을 막아 두었습니다.');
  }

  private setGender(g: 'm' | 'f', btns: HTMLElement[]): void {
    this.gender = g;
    btns.forEach((b, i) => b.classList.toggle('active', (i === 0 ? 'm' : 'f') === g));
  }

  private setStyle(i: number, btns: HTMLElement[]): void {
    this.hairStyle = i;
    btns.forEach((b, j) => b.classList.toggle('active', j === i));
  }

  private setColor(i: number, btns: HTMLElement[]): void {
    this.hairColor = i;
    btns.forEach((b, j) => b.classList.toggle('active', j === i));
  }

  private drawPreview(t: number): void {
    if (this.mode !== 'create') return;
    const ctx = this.preview.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
    ctx.translate(60, 112);
    ctx.scale(2, 2);
    const dir = (Math.floor(t / 1500) % 4) as Dir;
    drawHuman(
      ctx,
      { gender: this.gender, hairStyle: this.hairStyle, hairColor: HAIR_COLORS[this.hairColor]!, body: '#8a7a66', weapon: 'stick', weaponColor: '#8a6a45' },
      { dir, walk: (t % 600) / 600, act: null, time: t },
    );
  }

  setServer(info: PublicServerInfo): void {
    this.server = info;
    this.serverName.textContent = `${info.name}  ·  경험치 x${info.expRate}  골드 x${info.goldRate}  드롭 x${info.dropRate}`;
    this.motd.textContent = info.motd;
    this.inviteRow.classList.toggle('hidden', info.registration !== 'invite');
    this.createTabBtn.classList.toggle('hidden', info.registration === 'closed');
  }

  error(text: string): void {
    this.setBusy(false);
    this.msg.textContent = text;
    this.msg.classList.add('error');
  }

  info(text: string): void {
    this.msg.textContent = text;
    this.msg.classList.remove('error');
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('button[type=submit]')) btn.disabled = b;
    if (b) this.info('잠시만 기다려 주세요...');
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }
}
