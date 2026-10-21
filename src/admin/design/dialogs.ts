// 편집기의 대화 상자: 바뀐 곳 보기, 판 기록(비교·되돌리기), 저장이 다른 저장과 겹쳤을 때
import { h } from '../../client/ui/dom';
import { diffDesign, stableJson, type DesignChange } from '../../shared/design-edit';
import type { DesignHistoryEntry } from '../../shared/progression';
import type { Ctx } from './ctx';

/** 대화 상자 하나를 열고, 닫힐 때 지웁니다 */
export function openDialog(title: string, body: Node, buttons: HTMLElement[] = [], wide = false): HTMLDialogElement {
  document.querySelector('dialog.dz-dialog')?.remove();
  const close = h('button', { class: 'btn small', type: 'button' }, '닫기');
  const dlg = h(
    'dialog',
    { class: `dz-dialog${wide ? ' wide' : ''}`, 'aria-label': title },
    h('div', { class: 'dz-dh' }, h('b', null, title), h('span', { class: 'dz-spacer' }), close),
    h('div', { class: 'dz-db' }, body),
    buttons.length ? h('div', { class: 'dz-df' }, ...buttons) : null,
  );
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function changeList(list: DesignChange[], empty: string): HTMLElement {
  if (!list.length) return h('p', { class: 'dz-hint' }, empty);
  const groups: [string, DesignChange[]][] = [
    ['스킬트리', list.filter((c) => c.area === 'tree')],
    ['기술 값', list.filter((c) => c.area === 'ability')],
    ['성장 규칙', list.filter((c) => c.area === 'progression')],
  ];
  return h(
    'div',
    { class: 'dz-changes' },
    ...groups.filter(([, l]) => l.length).map(([t, l]) => h('section', null, h('h4', null, `${t} (${l.length})`), h('ul', null, ...l.map((c) => h('li', null, c.label))))),
  );
}

/** 저장하지 않은 바뀐 곳과 저장할 때 보낼 내용 */
export function showChanges(ctx: Ctx): void {
  const s = ctx.store;
  const body = s.saveBody();
  const json = JSON.stringify(body, null, 2);
  openDialog(
    '저장하지 않은 바뀐 곳',
    h(
      'div',
      null,
      changeList(s.changes(), '바뀐 곳이 없습니다.'),
      h('details', { class: 'dz-details' }, h('summary', null, `저장할 때 보낼 내용 (${(json.length / 1024).toFixed(1)}KB)`), h('pre', { class: 'dz-pre' }, json)),
    ),
    [
      h(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          disabled: !s.dirty,
          onclick: () => {
            if (!window.confirm('저장하지 않은 바뀐 곳을 모두 버리고 서버의 설계로 돌아갈까요? (되돌리기로 다시 살릴 수 있음)')) return;
            s.discard();
            document.querySelector<HTMLDialogElement>('dialog.dz-dialog')?.close();
            ctx.toast('바뀐 곳을 버렸습니다. (되돌리기 Ctrl+Z)');
          },
        },
        '모두 버리기',
      ),
    ],
    true,
  );
}

const KIND: Record<DesignHistoryEntry['kind'], string> = { skilltree: '스킬트리', progression: '성장 규칙', restore: '되돌리기' };

/** 판 기록: 목록, 지금과 비교, 되돌리기 */
export async function showHistory(ctx: Ctx): Promise<void> {
  const s = ctx.store;
  let list: DesignHistoryEntry[];
  try {
    list = (await s.history()).entries;
  } catch (e) {
    return ctx.toast((e as Error).message, false);
  }
  const detail = h('div', { class: 'dz-hdetail' }, h('p', { class: 'dz-hint' }, '판을 고르면 그 판으로 되돌릴 때 무엇이 바뀌는지 보여 줍니다.'));
  const compare = async (e: DesignHistoryEntry, row: HTMLElement) => {
    for (const r of row.parentElement?.children ?? []) r.classList.toggle('sel', r === row);
    detail.replaceChildren(h('p', { class: 'dz-hint' }, '불러오는 중…'));
    try {
      const d = await s.historyDetail(e.id);
      const now = s.asDesign(s.base);
      const back = { progression: d.design.progression, skillTrees: d.design.skillTrees, abilities: d.design.abilities };
      const changes = diffDesign(now, back, s.diffNames(), (id) => {
        const c = s.def(id)?.classId;
        return c && c !== 'monster' ? c : undefined;
      });
      const same = stableJson(now) === stableJson(back);
      detail.replaceChildren(
        h('h4', null, `${new Date(e.at).toLocaleString('ko-KR')} 저장 바로 전의 설계`),
        h('p', { class: 'dz-hint' }, `이 저장: ${e.summary || '-'} (${e.actor})`),
        h('h4', null, '이 판으로 되돌리면 바뀌는 곳'),
        changeList(changes, same ? '지금 서버의 설계와 같습니다.' : '바뀐 곳이 없습니다.'),
        h(
          'div',
          { class: 'dz-actions' },
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              disabled: changes.length === 0,
              onclick: () => void restore(ctx, e),
            },
            '이 판으로 되돌리기',
          ),
        ),
      );
    } catch (err) {
      detail.replaceChildren(h('p', { class: 'dz-issue error' }, (err as Error).message));
    }
  };
  const rows = list.map((e) => {
    const row = h(
      'button',
      { class: 'dz-hrow', type: 'button' },
      h('span', { class: 'dz-htime' }, new Date(e.at).toLocaleString('ko-KR')),
      h('span', { class: `dz-hkind ${e.kind}` }, e.classId ? `${s.className(e.classId)} 트리` : e.kind === 'skilltree' ? '여러 곳' : KIND[e.kind]),
      h('span', { class: 'dz-hsum' }, e.summary || '-'),
      h('small', null, e.actor),
    );
    row.addEventListener('click', () => void compare(e, row));
    return row;
  });
  openDialog(
    '판 기록',
    h(
      'div',
      { class: 'dz-history' },
      h(
        'div',
        null,
        h('p', { class: 'dz-hint' }, '저장할 때마다 그 저장 바로 전의 설계를 data/design-history/ 에 남깁니다 (새것부터, 오래된 것은 200개 넘으면 지움). 되돌리면 지금 설계도 기록에 남아 다시 되돌릴 수 있습니다.'),
        rows.length ? h('div', { class: 'dz-hlist' }, ...rows) : h('p', { class: 'dz-hint' }, '아직 저장한 적이 없습니다.'),
      ),
      detail,
    ),
    [],
    true,
  );
}

async function restore(ctx: Ctx, e: DesignHistoryEntry): Promise<void> {
  const s = ctx.store;
  const lose = s.dirty ? '\n\n저장하지 않은 바뀐 곳은 버려집니다.' : '';
  if (!window.confirm(`${new Date(e.at).toLocaleString('ko-KR')} 판으로 되돌릴까요? 게임에 바로 반영됩니다.${lose}`)) return;
  try {
    const r = await s.restore(e.id);
    if (r.status === 409) {
      ctx.toast('그사이 다른 곳에서 저장했습니다. 새로 불러온 뒤 다시 해 주세요.', false);
      return;
    }
    if (!r.ok) {
      ctx.toast(r.msg, false);
      if (r.issues?.length) s.setIssues(r.issues);
      return;
    }
    document.querySelector<HTMLDialogElement>('dialog.dz-dialog')?.close();
    ctx.toast(r.msg);
  } catch (err) {
    if ((err as Error).name !== 'AuthError') ctx.toast(`되돌리지 못했습니다: ${(err as Error).message}`, false);
  }
}

/** 저장이 그사이 다른 저장과 겹쳤을 때 */
export function showConflict(ctx: Ctx): void {
  const s = ctx.store;
  const dlg = openDialog(
    '그사이 다른 곳에서 저장했습니다',
    h(
      'div',
      null,
      h('p', null, '이 편집기를 연 뒤에 다른 창이나 다른 관리자가 설계를 저장했습니다.'),
      h('ul', null, h('li', null, '새로 불러오기: 내 바뀐 곳을 버리고 지금 서버의 설계를 엽니다.'), h('li', null, '내 것으로 덮어쓰기: 내가 고친 곳(직업 트리·성장 규칙·기술 값)만 내 것으로 저장합니다. 내가 고치지 않은 곳은 다른 저장 그대로입니다.')),
    ),
    [
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            dlg.close();
            await s.reload();
            ctx.toast('서버의 설계를 새로 불러왔습니다.');
          },
        },
        '새로 불러오기',
      ),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            dlg.close();
            const r = await s.save(true);
            if (r === 'conflict') ctx.toast('또 겹쳤습니다. 잠시 뒤 다시 해 주세요.', false);
          },
        },
        '내 것으로 덮어쓰기',
      ),
    ],
  );
}
