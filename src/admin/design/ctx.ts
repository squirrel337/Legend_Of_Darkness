// 편집기 화면들이 함께 쓰는 것: 상태, 다시 그리기 요청, 검사 결과에 따라 바뀌는 자리(live), 알림
import { h } from '../../client/ui/dom';
import type { DesignIssue } from '../../shared/progression';
import { parseWhere, type DesignStore, type IssueRef } from './state';

export interface Ctx {
  store: DesignStore;
  toast(msg: string, ok?: boolean): void;
  /** 다음 그림 차례에 화면 전체를 다시 그림 (입력 칸 초점은 되살림) */
  render(): void;
  /** 검사 결과가 올 때마다 update 를 다시 부르는 자리 (화면 전체를 다시 그리지 않아 입력 중인 글자가 사라지지 않음) */
  live<T extends HTMLElement | SVGElement>(el: T, update: (el: T) => void): T;
}

/** 검사 문제 한 줄 (누르면 그 자리로) */
export function issueRow(i: DesignIssue, onGo?: () => void): HTMLElement {
  const label = i.level === 'error' ? '오류' : '경고';
  return h(
    onGo ? 'button' : 'div',
    { class: `dz-issue ${i.level}`, ...(onGo ? { type: 'button', onclick: onGo } : {}), title: i.where },
    h('b', null, label),
    h('span', null, i.msg),
  );
}

/**
 * 검사 문제 중 pick 에 맞는 것을 보여 주는 칸 (없으면 비어 있음).
 * 편집 칸 바로 아래에 두어 "저장할 때 어디가 틀렸는지"를 그 자리에서 보여 줍니다.
 */
export function issueSlot(ctx: Ctx, pick: (i: DesignIssue, ref: IssueRef) => boolean, cls = 'dz-inline'): HTMLElement {
  return ctx.live(h('div', { class: cls }), (el) => {
    const list = ctx.store.issues.filter((i) => pick(i, parseWhere(i.where)));
    el.replaceChildren(...list.map((i) => issueRow(i)));
    el.hidden = list.length === 0;
  });
}

/** progression.json 의 자리 하나에 딱 맞는 문제 */
export const atPath = (path: string) => (i: DesignIssue, r: IssueRef) => r.file === 'progression' && r.path === path;

/** 카드 */
export function card(title: string | Node | null, ...kids: (Node | string | null | false | undefined)[]): HTMLElement {
  return h('section', { class: 'dz-card' }, title ? h('h3', null, title) : null, ...kids);
}
