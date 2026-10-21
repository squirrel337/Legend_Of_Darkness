// 직업·스킬트리 편집기의 작은 도우미: 큰 수 읽기(1억, 2억 5000만), SVG 만들기, 다시 그린 뒤 입력 칸 초점 되살리기
import { formatNumber } from '../../shared/constants';
import { h } from '../../client/ui/dom';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 사람이 쓴 수를 읽습니다: "14000", "14,000", "50만", "1억", "2억 5000만", "1.5억". 못 읽으면 NaN.
 * 소수가 남으면 반올림합니다.
 */
export function parseAmount(text: string): number {
  const s = text.replace(/[,\s_]/g, '');
  if (!s) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = /^(-)?(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?(\d+)?$/.exec(s);
  if (!m || (!m[2] && !m[3] && !m[4])) return NaN;
  const v = Number(m[2] ?? 0) * 1e8 + Number(m[3] ?? 0) * 1e4 + Number(m[4] ?? 0);
  return Math.round(m[1] ? -v : v);
}

/** 퍼센트 글자 → 비율 ("35" → 0.35, "3.5%" → 0.035) */
export function parsePercent(text: string): number {
  const s = text.replace(/[%\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s) / 100;
}

/** 비율 → 퍼센트 글자 (0.35 → "35", 0.035 → "3.5") */
export const pct = (v: number) => String(Math.round(v * 10000) / 100);

/** 천 단위 쉼표 */
export const fmtNum = (n: number) => formatNumber(n);

/** 짧은 골드 표시 (노드 칸처럼 좁은 곳): 2,000 · 1.2만 · 12만 · 1억 */
export function shortGold(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n < 10_000) return formatNumber(n);
  if (n < 100_000_000) return `${trim(n / 10_000)}만`;
  return `${trim(n / 100_000_000)}억`;
}

/**
 * 받침에 맞는 조사를 붙입니다: josa('강타', '을', '를') → '강타를'. 한글로 끝나지 않으면 '을(를)'.
 * '으로/로'는 ㄹ 받침이면 '로'.
 */
export function josa(word: string, withBatchim: string, without: string): string {
  const last = word.charAt(word.length - 1);
  const code = word.charCodeAt(word.length - 1);
  let jong: number;
  if (/\d/.test(last)) {
    // 숫자는 읽는 소리로: 0 으로 끝나면 십·백·천·만(받침 있음), 일·삼·육·칠·팔은 받침, 이·사·오·구는 없음 (일·칠·팔은 ㄹ)
    const d = Number(last);
    jong = d === 0 ? 1 : [1, 7, 8].includes(d) ? 8 : [3, 6].includes(d) ? 1 : 0;
  } else if (code >= 0xac00 && code <= 0xd7a3) jong = (code - 0xac00) % 28;
  else return `${word}${withBatchim}(${without})`;
  if (withBatchim === '으로' && jong === 8) return `${word}로`;
  return word + (jong ? withBatchim : without);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}

/** 다시 그리기 전에 초점이 있던 입력 칸(data-k)과 글자 선택을 기억해 두었다가 되살립니다 */
export function keepFocus(root: HTMLElement, draw: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active && root.contains(active) ? active.dataset.k : undefined;
  let sel: [number, number] | null = null;
  if (key && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try {
      if (active.selectionStart !== null && active.selectionEnd !== null) sel = [active.selectionStart, active.selectionEnd];
    } catch {
      sel = null;
    }
  }
  // 스크롤되는 상자의 위치도 그대로
  const scrolls = new Map<string, [number, number]>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-scroll]')) scrolls.set(el.dataset.scroll!, [el.scrollLeft, el.scrollTop]);
  draw();
  for (const el of root.querySelectorAll<HTMLElement>('[data-scroll]')) {
    const s = scrolls.get(el.dataset.scroll!);
    if (s) {
      el.scrollLeft = s[0];
      el.scrollTop = s[1];
    }
  }
  if (!key) return;
  const next = root.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (sel && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
    try {
      next.setSelectionRange(sel[0], sel[1]);
    } catch {
      /* 숫자 칸은 선택 범위가 없음 */
    }
  }
}

/** 이름표가 붙은 입력 칸 묶음 */
export function field(label: string, control: Node, hint?: string | Node | null): HTMLElement {
  return h('label', { class: 'dz-field' }, h('span', { class: 'dz-label' }, label), control, hint ? h('small', { class: 'dz-hint' }, hint) : null);
}

export interface NumOpts {
  min?: number;
  max?: number;
  /** 큰 수 (글자 칸에 1억 같은 단위를 쓸 수 있고, 옆에 읽기 쉬운 값을 보여 줌) */
  big?: boolean;
  /** 비어 있어도 됨 (onCommit 에 null) */
  optional?: boolean;
  placeholder?: string;
  width?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * 수 입력 칸. 값을 바꾸고 칸을 떠나거나 Enter 를 누르면(change) onCommit. 범위 밖이면 가장 가까운 값으로 맞춥니다.
 * 못 읽는 글자면 원래 값으로 돌려 놓고 onError 로 알립니다.
 */
export function numInput(key: string, value: number | null | undefined, onCommit: (v: number | null) => void, o: NumOpts = {}, onError?: (msg: string) => void): HTMLInputElement {
  const text = value === null || value === undefined ? '' : o.big ? fmtNum(value) : String(value);
  const el = h('input', {
    type: 'text',
    inputmode: 'numeric',
    class: `dz-num${o.big ? ' big' : ''}`,
    value: text,
    'data-k': key,
    ...(o.placeholder ? { placeholder: o.placeholder } : {}),
    ...(o.title ? { title: o.title } : {}),
    ...(o.width ? { style: `width:${o.width}` } : {}),
    disabled: o.disabled === true,
    autocomplete: 'off',
  });
  el.addEventListener('change', () => {
    const raw = el.value.trim();
    if (!raw) {
      if (o.optional) return onCommit(null);
      el.value = text;
      onError?.('값을 비울 수 없습니다.');
      return;
    }
    const n = o.big ? parseAmount(raw) : Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) {
      el.value = text;
      onError?.(`'${raw}'은(는) 수가 아닙니다.`);
      return;
    }
    const v = clamp(Math.round(n), o.min ?? -Infinity, o.max ?? Infinity);
    if (v !== value) onCommit(v);
    else el.value = text;
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
  return el;
}

/** 글자 입력 칸 (change 때 onCommit) */
export function textInput(key: string, value: string, onCommit: (v: string) => void, o: { maxLength?: number; placeholder?: string; width?: string } = {}): HTMLInputElement {
  const el = h('input', {
    type: 'text',
    value,
    'data-k': key,
    autocomplete: 'off',
    ...(o.maxLength ? { maxLength: o.maxLength } : {}),
    ...(o.placeholder ? { placeholder: o.placeholder } : {}),
    ...(o.width ? { style: `width:${o.width}` } : {}),
  });
  el.addEventListener('change', () => {
    if (el.value !== value) onCommit(el.value);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
  return el;
}

/** 고르는 칸 */
export function selectInput(key: string, value: string, options: { value: string; label: string; group?: string; disabled?: boolean }[], onCommit: (v: string) => void, title?: string): HTMLSelectElement {
  const groups = new Map<string, HTMLElement[]>();
  const plain: HTMLElement[] = [];
  for (const o of options) {
    const opt = h('option', { value: o.value, selected: o.value === value, disabled: o.disabled === true }, o.label);
    if (o.group) {
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(opt);
    } else plain.push(opt);
  }
  const el = h('select', { 'data-k': key, ...(title ? { title, 'aria-label': title } : {}) }, ...plain, ...[...groups].map(([label, opts]) => h('optgroup', { label }, ...opts)));
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

/** 켜고 끄는 칸 */
export function checkInput(key: string, checked: boolean, label: string, onCommit: (v: boolean) => void, disabled = false): HTMLElement {
  const box = h('input', { type: 'checkbox', checked, 'data-k': key, disabled });
  box.addEventListener('change', () => onCommit(box.checked));
  return h('label', { class: 'dz-check' }, box, h('span', null, label));
}
