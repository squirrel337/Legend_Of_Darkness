// 고전 화면의 이름표·말풍선·글꼴·메시지 색 점검.
// 말풍선 줄바꿈과 모양은 순수 함수로, 그리기는 호출을 기록하는 가짜 캔버스로, 글꼴과 색은 정적 파일로 확인합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  BUBBLE_FADE_MS,
  BUBBLE_GAP,
  BUBBLE_HANG_MAX,
  BUBBLE_LINE_H,
  BUBBLE_MAX_LINES,
  BUBBLE_TEXT_W,
  FontGate,
  LABEL_FONT,
  LABEL_OUTLINE,
  PIXEL_FONT,
  bubbleAlpha,
  bubbleLifts,
  bubbleShape,
  bubbleText,
  drawBubble,
  drawOutlinedText,
  entityLabel,
  wrapBubble,
  type LabelOptions,
  type LabelSubject,
  type PixelCtx,
  type Rect,
} from '../src/client/render/labels';
import { ROOT } from './helpers';

/** 도트 글꼴(갈무리 모노 11, 12px)과 같은 폭: 반각(라틴-1) 6px, 한글·전각 12px */
const cellW = (s: string): number => {
  let w = 0;
  for (const ch of s) w += /^[\u0000-ÿ]$/.test(ch) ? 6 : 12;
  return w;
};

class RecCtx implements PixelCtx {
  font = '12px test';
  fillStyle: unknown = '#000000';
  globalAlpha = 1;
  textAlign = 'start';
  textBaseline = 'alphabetic';
  readonly ops: { op: 'rect' | 'text'; x: number; y: number; w?: number; h?: number; text?: string; fill: unknown; alpha: number }[] = [];
  private readonly stack: [unknown, number, string, string][] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: 'rect', x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha });
  }
  fillText(text: string, x: number, y: number): void {
    this.ops.push({ op: 'text', x, y, text, fill: this.fillStyle, alpha: this.globalAlpha });
  }
  measureText(text: string): { width: number } {
    return { width: cellW(text) };
  }
  save(): void {
    this.stack.push([this.fillStyle, this.globalAlpha, this.textAlign, this.textBaseline]);
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) [this.fillStyle, this.globalAlpha, this.textAlign, this.textBaseline] = s;
  }
}

/** 칸들이 덮는 픽셀 (같은 목록 안에서 겹치면 실패) */
function pixels(rects: Rect[], what: string): Set<string> {
  const s = new Set<string>();
  for (const r of rects) {
    for (const v of [r.x, r.y, r.w, r.h]) assert.ok(Number.isInteger(v), `${what}: 정수가 아닌 값 ${JSON.stringify(r)}`);
    assert.ok(r.w > 0 && r.h > 0, `${what}: 빈 칸 ${JSON.stringify(r)}`);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const k = `${x},${y}`;
        assert.ok(!s.has(k), `${what}: ${k} 가 두 번 칠해짐 (반투명이면 더 진해짐)`);
        s.add(k);
      }
  }
  return s;
}

// ───────────────────────── 말풍선 줄바꿈 ─────────────────────────

test('말풍선은 원작(R2)처럼 `이름: 대사`를 한글 9자(108px)마다 글자 단위로 꽉 채워 줄바꿈한다', () => {
  const text = bubbleText('떠돌이약장수', '운영진을 사칭하는 사기단은 조심해야지.');
  assert.equal(text, '떠돌이약장수: 운영진을 사칭하는 사기단은 조심해야지.');
  // R2 화면의 줄 나눔과 똑같습니다 (낱말 중간에서도 자름)
  assert.deepEqual(wrapBubble(text, BUBBLE_TEXT_W, cellW), ['떠돌이약장수: 운영', '진을 사칭하는 사기', '단은 조심해야지.']);
});

test('닫는 문장 부호(! ? . 등)는 줄 첫머리로 넘기지 않고 앞줄 끝에 매단다 (한 자 폭까지)', () => {
  const lines = wrapBubble(bubbleText('나그네', '안녕하세요! 오늘 사냥 같이 가실래요?'), BUBBLE_TEXT_W, cellW);
  assert.deepEqual(lines, ['나그네: 안녕하세요!', '오늘 사냥 같이 가', '실래요?']);
  assert.equal(cellW(lines[0]!), BUBBLE_TEXT_W + 6);
  // 매달 수 있는 폭을 넘으면 어쩔 수 없이 다음 줄로
  const many = wrapBubble('가'.repeat(9) + '!!!', BUBBLE_TEXT_W, cellW);
  assert.deepEqual(many, ['가'.repeat(9) + '!!', '!']);
  for (const l of wrapBubble('그래요? 정말요! 좋아요. 그럼, 내일 봐요~ 안녕히 계세요… 잘 자요!', BUBBLE_TEXT_W, cellW, 10))
    assert.ok(cellW(l) <= BUBBLE_TEXT_W + BUBBLE_HANG_MAX, l);
});

test('긴 말은 최대 4줄, 마지막 줄은 줄임표로 끝나고 모든 줄이 폭 안에 든다', () => {
  const long = bubbleText(
    '나그네',
    '오늘은 남쪽 숲에서 들개를 잡고 저녁에는 마을 광장에서 만나서 같이 동굴 깊은 곳까지 내려가 보기로 해요 다들 물약은 꼭 챙겨 오세요',
  );
  const lines = wrapBubble(long, BUBBLE_TEXT_W, cellW);
  assert.equal(lines.length, BUBBLE_MAX_LINES);
  assert.ok(lines[lines.length - 1]!.endsWith('…'), lines.join(' / '));
  for (const l of lines) {
    // 폭을 넘는 줄은 끝에 매단 문장 부호 때문일 때만 (한 자 폭까지)
    assert.ok(cellW(l) <= BUBBLE_TEXT_W || (cellW(l) <= BUBBLE_TEXT_W + BUBBLE_HANG_MAX && /[.,!?~…]$/.test(l)), `${l} 폭 ${cellW(l)}`);
    assert.ok(!/^\s/.test(l) && !/\s$/.test(l), `줄 앞뒤 빈칸: "${l}"`);
  }
  // 줄임표 앞까지는 원문을 순서대로 담습니다 (빈칸은 줄 경계에서만 빠짐)
  const kept = lines.join('').replace('…', '').replace(/\s/g, '');
  assert.ok(long.replace(/\s/g, '').startsWith(kept));
  // 한 줄로 제한하면 그 줄이 줄임표로 끝남
  const one = wrapBubble(long, BUBBLE_TEXT_W, cellW, 1);
  assert.equal(one.length, 1);
  assert.ok(one[0]!.endsWith('…') && cellW(one[0]!) <= BUBBLE_TEXT_W);
});

test('짧은 말은 한 줄 그대로, 빈 말은 줄이 없고, 딱 맞는 말은 줄임표가 붙지 않는다', () => {
  assert.deepEqual(wrapBubble('운영자: 안녕', BUBBLE_TEXT_W, cellW), ['운영자: 안녕']);
  assert.deepEqual(wrapBubble('   ', BUBBLE_TEXT_W, cellW), []);
  // 한글 36자 = 9자씩 정확히 4줄 → 줄임표 없음, 한 자라도 넘치면 줄임표
  const lines = wrapBubble('가'.repeat(36), BUBBLE_TEXT_W, cellW);
  assert.deepEqual(lines, Array(4).fill('가'.repeat(9)));
  const over = wrapBubble('가'.repeat(37), BUBBLE_TEXT_W, cellW);
  assert.deepEqual(over, [...Array(3).fill('가'.repeat(9)), '가'.repeat(8) + '…']);
});

test('줄 폭은 글자 수가 아니라 잰 폭으로 정한다 (반각 영문·숫자는 18자씩)', () => {
  assert.deepEqual(wrapBubble('a'.repeat(40), BUBBLE_TEXT_W, cellW), ['a'.repeat(18), 'a'.repeat(18), 'a'.repeat(4)]);
  // 폭을 재는 함수가 다르면 (예: 대체 글꼴) 그에 맞춰 나눕니다
  const lines = wrapBubble('가'.repeat(10), 50, (s) => [...s].length * 10);
  assert.deepEqual(lines, ['가가가가가', '가가가가가']);
});

test('결합 문자와 이모지는 쪼개지 않는다', () => {
  const text = 'é'.repeat(20) + '👍🏽'.repeat(6);
  const lines = wrapBubble(text, 60, cellW, 10);
  assert.equal(lines.join(''), text);
  for (const l of lines) assert.ok(!/^[́\u{1F3FD}]/u.test(l), `줄이 결합 문자로 시작: ${JSON.stringify(l)}`);
});

test('말풍선은 끝나기 300ms 전부터 흐려져 끝나면 사라진다', () => {
  const until = 10_000;
  assert.equal(bubbleAlpha(until - 4000, until), 1);
  assert.equal(bubbleAlpha(until - BUBBLE_FADE_MS, until), 1);
  assert.equal(bubbleAlpha(until - BUBBLE_FADE_MS / 2, until), 0.5);
  assert.equal(bubbleAlpha(until, until), 0);
  assert.equal(bubbleAlpha(until + 50, until), 0);
});

// ───────────────────────── 말풍선 모양 ─────────────────────────

test('말풍선 모양: 정수 픽셀, 바탕과 테두리가 겹치지 않고, 테두리가 바탕을 빈틈없이 둘러싸며, 꼬리 끝이 말하는 사람 위', () => {
  for (const [textW, n, ax] of [
    [108, 3, 400],
    [60, 1, 123],
    [7, 1, 0],
    [108, 4, -77],
  ] as const) {
    const s = bubbleShape(textW, n, ax, 200);
    assert.equal(s.w, textW + 19); // 원작 R2: 한 줄을 꽉 채운 108px → 127px
    assert.equal(s.h, 12 * n + 7); // 원작 R2: 3줄 = 43px
    assert.equal(s.tipY, 200);
    assert.equal(s.tipX, ax);
    assert.equal(s.y + s.h - 1 + 3, s.tipY);
    const fill = pixels(s.fill, '바탕');
    const border = pixels(s.border, '테두리');
    for (const k of fill) assert.ok(!border.has(k), `바탕과 테두리가 겹침 ${k}`);
    // 바탕의 모든 픽셀은 상하좌우가 바탕 또는 테두리 (바깥으로 새지 않음)
    for (const k of fill) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nk = `${x + dx},${y + dy}`;
        assert.ok(fill.has(nk) || border.has(nk), `바탕 ${k} 옆 ${nk} 가 비어 있음`);
      }
    }
    // 줄마다 한 덩어리 (구멍 없음), 꼬리 끝은 한 점
    const rows = new Map<number, number[]>();
    for (const k of [...fill, ...border]) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      rows.set(y, [...(rows.get(y) ?? []), x]);
    }
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      assert.equal(xs[xs.length - 1]! - xs[0]! + 1, xs.length, `${y} 줄에 빈틈`);
    }
    assert.deepEqual(rows.get(s.tipY), [s.tipX]);
    assert.equal(Math.min(...rows.keys()), s.y);
    // 글자는 테두리 안쪽: 첫 줄 위 2px, 왼쪽 7px·오른쪽 10px 여백(원작 R2 와 같음), 마지막 줄 아래 4px 여백
    assert.equal(s.textX, s.x + 8);
    assert.equal(s.x + s.w - 1 - (s.textX + textW), 10);
    assert.equal(s.baseline - 11, s.y + 3);
    assert.equal(s.y + s.h - 1 - (s.baseline + (n - 1) * BUBBLE_LINE_H - 1), 5);
  }
});

test('화면 가장자리에서는 몸통만 안쪽으로 밀고 꼬리는 말하는 사람을 가리킨다', () => {
  const left = bubbleShape(108, 2, 30, 100, 2, 800);
  assert.equal(left.x, 2);
  assert.equal(left.tipX, 30);
  const right = bubbleShape(108, 2, 790, 100, 2, 800);
  assert.equal(right.x + right.w, 800);
  assert.equal(right.tipX, 790);
  // 사람이 모서리보다 더 바깥이면 꼬리는 둥근 모서리를 피한 곳까지만
  const edge = bubbleShape(108, 1, 0, 100, 2, 800);
  assert.equal(edge.x, 2);
  assert.equal(edge.tipX, edge.x + 9);
  // 범위가 몸통보다 좁으면 밀지 않음
  assert.equal(bubbleShape(108, 1, 50, 100, 0, 40).tipX, 50);
});

test('겹치는 말풍선: 가까운 사람 것은 제자리, 먼 사람 것은 겹치지 않을 때까지 위로, 꼬리는 길어져 그대로 사람을 가리킨다', () => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // 같은 자리 두 사람 (먼 사람의 머리가 화면 위쪽): 먼 사람 말풍선이 가까운 사람 말풍선 위로 틈을 두고 올라감
  const near = bubbleShape(108, 2, 300, 200);
  const far = bubbleShape(108, 1, 310, 190);
  assert.ok(overlaps(near, far), '시험 전제: 제자리면 겹침');
  const lifts = bubbleLifts([far, near], [far.tipY, near.tipY]);
  assert.equal(lifts[1], 0, '가까운 사람은 제자리');
  assert.equal(lifts[0], far.y - (near.y - BUBBLE_GAP - far.h));
  const up = bubbleShape(108, 1, 310, 190, -Infinity, Infinity, lifts[0]);
  assert.equal(up.y + up.h + BUBBLE_GAP, near.y, '틈을 두고 바로 위');
  assert.equal(up.lift, lifts[0]);
  assert.deepEqual([up.tipX, up.tipY], [far.tipX, far.tipY], '꼬리 끝은 그대로 머리 위');
  // 올린 말풍선도 바탕과 테두리가 겹치지 않고, 줄마다 한 덩어리 (꼬리는 1px 줄로 이어짐)
  const fill = pixels(up.fill, '바탕');
  const border = pixels(up.border, '테두리');
  for (const k of fill) assert.ok(!border.has(k));
  const rows = new Map<number, number[]>();
  for (const k of [...fill, ...border]) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    rows.set(y, [...(rows.get(y) ?? []), x]);
  }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    assert.equal(xs[xs.length - 1]! - xs[0]! + 1, xs.length, `${y} 줄에 빈틈`);
  }
  for (let y = up.y + up.h + 3; y <= up.tipY; y++) assert.deepEqual(rows.get(y), [up.tipX], `꼬리 줄 ${y}`);
  // 셋이 한 자리에 모이면 차례로 쌓이고, 넣는 순서와 상관없음
  const a = bubbleShape(60, 1, 400, 300);
  const b = bubbleShape(60, 1, 405, 296);
  const c = bubbleShape(60, 2, 395, 292);
  const l1 = bubbleLifts([a, b, c], [300, 296, 292]);
  const l2 = bubbleLifts([c, a, b], [292, 300, 296]);
  assert.deepEqual([l2[1], l2[2], l2[0]], l1);
  const placed = [a, b, c].map((s, i) => ({ ...s, y: s.y - l1[i]! }));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlaps(placed[i]!, placed[j]!), `${i}·${j} 겹침`);
  assert.equal(l1[0], 0);
  assert.ok(placed[2]!.y < placed[1]!.y && placed[1]!.y < placed[0]!.y, '먼 사람일수록 위');
  // 가로로 떨어져 있거나 세로로 이미 떨어져 있으면 그대로
  assert.deepEqual(bubbleLifts([bubbleShape(108, 2, 100, 200), bubbleShape(108, 2, 300, 195)], [200, 195]), [0, 0]);
  assert.deepEqual(bubbleLifts([bubbleShape(108, 1, 100, 200), bubbleShape(108, 1, 100, 160)], [200, 160]), [0, 0]);
});

// ───────────────────────── 그리기 ─────────────────────────

test('말풍선 그리기: 반투명 바탕 → 흰 테두리 → 흰 글자, 흐려질 때 투명도를 곱함', () => {
  const ctx = new RecCtx();
  ctx.globalAlpha = 0.8;
  const lines = ['떠돌이약장수: 운영', '진을 사칭하는 사기', '단은 조심해야지.'];
  const s = bubbleShape(108, lines.length, 300, 150);
  drawBubble(ctx, lines, s, 0.5);
  const rects = ctx.ops.filter((o) => o.op === 'rect');
  const texts = ctx.ops.filter((o) => o.op === 'text');
  assert.equal(rects.length, s.fill.length + s.border.length);
  assert.ok(rects.slice(0, s.fill.length).every((o) => o.fill === 'rgba(0,0,0,0.5)'));
  assert.ok(rects.slice(s.fill.length).every((o) => o.fill === '#ffffff'));
  assert.deepEqual(
    texts.map((o) => [o.text, o.x, o.y, o.fill]),
    lines.map((l, i) => [l, s.textX, s.baseline + i * BUBBLE_LINE_H, '#ffffff']),
  );
  assert.ok(ctx.ops.every((o) => Math.abs(o.alpha - 0.4) < 1e-9), '전체 투명도 0.8 × 흐려짐 0.5');
  assert.equal(ctx.globalAlpha, 0.8, '그린 뒤 원래 상태로');
  // 다 흐려졌거나 줄이 없으면 아무것도 그리지 않음
  const none = new RecCtx();
  drawBubble(none, lines, s, 0);
  drawBubble(none, [], s, 1);
  assert.equal(none.ops.length, 0);
});

test('이름표 글자: 1px 외곽선(8방향)을 먼저, 본색을 마지막에, 가운데 맞춘 정수 위치에 그린다', () => {
  const ctx = new RecCtx();
  const w = drawOutlinedText(ctx, '나그네 Lv.12', 100.4, 50.6, '#ffb0b0');
  assert.equal(w, 72);
  const t = ctx.ops.filter((o) => o.op === 'text');
  assert.equal(t.length, 9);
  const main = t[8]!;
  assert.deepEqual([main.x, main.y, main.fill], [64, 51, '#ffb0b0']);
  const offs = t.slice(0, 8).map((o) => `${o.x - main.x},${o.y - main.y}`);
  assert.equal(new Set(offs).size, 8);
  for (const o of t.slice(0, 8)) {
    assert.equal(o.fill, LABEL_OUTLINE);
    assert.ok(Math.abs(o.x - main.x) <= 1 && Math.abs(o.y - main.y) <= 1 && (o.x !== main.x || o.y !== main.y));
  }
  assert.equal(ctx.textAlign, 'left');
  assert.equal(ctx.textBaseline, 'alphabetic');
});

// ───────────────────────── 글꼴 기다리기 ─────────────────────────

/** 대기 중인 프라미스 콜백까지 모두 돌립니다 */
const settle = () => new Promise<void>((r) => setImmediate(r));

test('글꼴 문: 도트 글꼴을 받을 때까지 닫혀 있다가 받으면 열리고, 줄바꿈 캐시 번호가 바뀐다', async () => {
  const loads: string[] = [];
  let resolve!: () => void;
  let timeout!: () => void;
  let waited = 0;
  const gate = new FontGate(
    () => ({
      load: (font, text) => {
        loads.push(`${font}|${text}`);
        return new Promise<void>((r) => (resolve = r));
      },
    }),
    3000,
    (fn, ms) => {
      timeout = fn;
      waited = ms;
    },
  );
  assert.equal(gate.ready(), false);
  assert.equal(gate.ready(), false);
  // 한 번만, 캔버스와 같은 12px 도트 글꼴을 한글·영문이 든 글자로 받음
  assert.deepEqual(loads, [`12px "${PIXEL_FONT}"|가A`]);
  assert.equal(waited, 3000);
  const gen = gate.gen;
  resolve();
  await settle();
  assert.equal(gate.ready(), true);
  assert.equal(gate.gen, gen + 1);
  // 이미 받았으면 기다리는 시간이 지나도 그대로
  timeout();
  assert.equal(gate.gen, gen + 1);
});

test('글꼴 문: 받지 못하면 기다린 뒤 대체 글꼴로 열리고, 나중에라도 받으면 다시 잰다', async () => {
  let resolve!: () => void;
  let timeout!: () => void;
  const slow = new FontGate(
    () => ({ load: () => new Promise<void>((r) => (resolve = r)) }),
    3000,
    (fn) => (timeout = fn),
  );
  assert.equal(slow.ready(), false);
  timeout();
  assert.equal(slow.ready(), true);
  const gen = slow.gen;
  resolve();
  await settle();
  assert.equal(slow.gen, gen + 1, '늦게 받은 글꼴로 다시 재도록 번호가 바뀜');
  // 받기가 실패하거나(거부) 글꼴 문자열에서 바로 오류가 나도 열림
  const failed = new FontGate(() => ({ load: () => Promise.reject(new Error('404')) }), 3000, () => {});
  assert.equal(failed.ready(), false);
  await settle();
  assert.equal(failed.ready(), true);
  const broken = new FontGate(
    () => ({
      load: () => {
        throw new SyntaxError('bad font');
      },
    }),
    3000,
    () => {},
  );
  assert.equal(broken.ready(), true);
  // document.fonts 가 없는 곳(서버 쪽 테스트 등)에서는 바로 열림
  assert.equal(new FontGate(() => undefined).ready(), true);
});

// ───────────────────────── 이름표 규칙 ─────────────────────────

test('이름표는 원작처럼 마우스를 올렸거나 대상으로 고른 것만 보인다 (자기 자신·우두머리·소환수 포함)', () => {
  const base = { level: 7, ghost: false };
  const cases: [LabelSubject, Partial<LabelOptions>, { text: string; color: string; title?: string }][] = [
    [{ id: 1, type: 'player', name: '운영자', ...base }, {}, { text: '운영자', color: '#b8ffb8' }],
    [{ id: 2, type: 'player', name: '나그네', ...base }, {}, { text: '나그네', color: '#ffffff' }],
    [{ id: 3, type: 'player', name: '관리인', role: 'gm', ...base }, {}, { text: '관리인', color: '#ffd76b' }],
    [{ id: 4, type: 'player', name: '유령', ...base, ghost: true }, {}, { text: '유령', color: '#a8b8e8' }],
    [{ id: 5, type: 'npc', name: '브리드', title: '사제', ...base }, {}, { text: '브리드', color: '#ffe9a8', title: '[사제]' }],
    [{ id: 6, type: 'npc', name: '경비병', ...base }, {}, { text: '경비병', color: '#ffe9a8' }],
    [{ id: 7, type: 'monster', name: '들개', ...base }, {}, { text: '들개 Lv.7', color: '#ffb0b0' }],
    [{ id: 8, type: 'monster', name: '고블린 족장', ...base }, { boss: true }, { text: '고블린 족장 Lv.7', color: '#ff9f6b' }],
    [{ id: 9, type: 'monster', name: '바람의 정령', ownerName: '아리', ...base }, { ally: true }, { text: '바람의 정령 (아리)', color: '#8dff9a' }],
    [{ id: 10, type: 'item', name: '', item: 'potion_hp', qty: 3, ...base }, { itemName: '빨간 물약' }, { text: '빨간 물약 x3', color: '#fff3a0' }],
    [{ id: 11, type: 'item', name: '', item: 'potion_hp', ...base }, { itemName: '빨간 물약' }, { text: '빨간 물약', color: '#fff3a0' }],
    [{ id: 12, type: 'item', name: '', item: null, qty: 12345, ...base }, {}, { text: '12,345 골드', color: '#fff3a0' }],
  ];
  for (const [e, extra, want] of cases) {
    const o = (more: Partial<LabelOptions>): LabelOptions => ({ hovered: false, targeted: false, selfId: 1, ally: false, boss: false, ...extra, ...more });
    assert.equal(entityLabel(e, o({})), null, `${e.type} ${e.name}: 평소에는 숨김`);
    assert.deepEqual(entityLabel(e, o({ hovered: true })), want, `${e.type} ${e.name}: 마우스를 올리면 보임`);
    assert.deepEqual(entityLabel(e, o({ targeted: true })), want, `${e.type} ${e.name}: 대상이면 보임`);
  }
});

// ───────────────────────── 글꼴과 메시지 색 (정적 파일) ─────────────────────────

const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');

/** CSS 규칙의 color 값 (var(--x) 는 :root 에서 풀어 줌) */
function cssColor(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{[^}]*?\\bcolor:\\s*([^;]+);`).exec(css);
  assert.ok(m, `${selector} 의 color 를 찾지 못함`);
  let v = m[1]!.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const d = new RegExp(`${ref[1]}:\\s*([^;]+);`).exec(css);
    assert.ok(d, `${ref[1]} 정의 없음`);
    v = d[1]!.trim();
  }
  return v;
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
/** WCAG 대비율 */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = rgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

test('도트 글꼴: woff2 파일과 OFL 라이선스가 함께 있고, CSS 와 캔버스가 같은 글꼴을 쓴다', () => {
  const font = fs.readFileSync(path.join(ROOT, 'public/fonts', `${PIXEL_FONT}.woff2`));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  const license = fs.readFileSync(path.join(ROOT, 'public/fonts/Galmuri-OFL.txt'), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /Lee Minseo/);
  assert.match(css, new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${PIXEL_FONT}'[^}]*url\\('/fonts/${PIXEL_FONT}\\.woff2'\\)`));
  // 캔버스: 도트 글꼴 → 굴림·돋움 → 예전 글꼴 순서
  const order = [`"${PIXEL_FONT}"`, '"Gulim"', '"굴림"', '"Dotum"', '"돋움"', '"Malgun Gothic"', 'sans-serif'].map((f) => LABEL_FONT.indexOf(f));
  assert.ok(order.every((i) => i >= 0), LABEL_FONT);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // 메시지 줄·대화 기록·왼쪽 위 대화도 같은 글꼴, 또렷한 12px
  for (const sel of ['.lod-msg', '.chat-log', '.chat-overlay .ol']) {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, sel);
    assert.match(m[1]!, /font-family:\s*var\(--font-pixel\)/, sel);
    assert.match(m[1]!, /font-size:\s*12px/, sel);
  }
  assert.match(css, new RegExp(`--font-pixel:\\s*'${PIXEL_FONT}', 'Gulim', '굴림', 'Dotum', '돋움'`));
});

test('외침·공지·운영자 알림은 고전 노란 글씨, 다른 대화도 어두운 메시지 줄에서 잘 읽힌다', () => {
  const msgBg = '#130904';
  for (const sel of ['.ch-shout', '.ch-notice', '.ch-gm']) {
    const [r, g, b] = rgb(cssColor(sel));
    assert.ok(r >= 0xe0 && g >= 0xd0 && b <= 0x70, `${sel} 이(가) 노란색이 아님: ${cssColor(sel)}`);
  }
  assert.equal(cssColor('.ch-shout').toLowerCase(), '#f0e040');
  for (const ch of ['say', 'shout', 'whisper', 'group', 'system', 'notice', 'gm', 'error']) {
    const c = cssColor(`.ch-${ch}`);
    assert.ok(contrast(c, msgBg) >= 7, `.ch-${ch} ${c} 대비 ${contrast(c, msgBg).toFixed(1)}`);
  }
  // 시스템 안내는 외침과 구별되는 색
  assert.notEqual(cssColor('.ch-system').toLowerCase(), cssColor('.ch-shout').toLowerCase());
});
