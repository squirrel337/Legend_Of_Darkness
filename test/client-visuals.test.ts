// 클라이언트 그림(치비 캐릭터·아이콘·효과)과 소환수 판별 점검.
// 캔버스 대신 호출을 기록하는 가짜 컨텍스트로 그려서, 예외나 잘못된 수(NaN, 음수 반지름)가 없는지 봅니다.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CLASS_IDS, HAIR_STYLES, type Dir } from '../src/shared/constants';
import type { MonsterSnapshot } from '../src/shared/protocol';
import type { HumanLook, IconShape } from '../src/shared/types';
import { chebyshev, entityFromSnapshot, isAlly, isHostile } from '../src/client/state';
import { ROOT } from './helpers';

// 클라이언트 그림 모듈은 DOM 형식을 쓰므로 서버 tsconfig 의 형식 검사 밖에서 불러옵니다
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

interface Mock {
  ctx: unknown;
  bad: string[];
  calls: () => number;
  /** 그리기 호출 기록 (mockCtx(true) 일 때만) */
  log: [string, unknown[]][];
}

function mockCtx(record = false): Mock {
  const bad: string[] = [];
  const log: [string, unknown[]][] = [];
  let calls = 0;
  const grad = { addColorStop: () => {} };
  const store: Record<string, unknown> = { canvas: { width: 100, height: 100 }, globalAlpha: 1 };
  const check = (name: string, args: unknown[]) => {
    for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${name}(${args.join(',')})`);
    // 실제 캔버스는 음수 반지름에서 예외를 던짐
    const r = name === 'arc' ? [args[2]] : name === 'ellipse' ? [args[2], args[3]] : name === 'roundRect' ? [args[4]] : [];
    for (const v of r) if (typeof v === 'number' && v < 0) bad.push(`${name} 음수 반지름 ${v}`);
  };
  const ctx = new Proxy(store, {
    get(t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in t) return t[prop];
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient')
        return (...a: unknown[]) => {
          check(prop, a);
          if (record) log.push([prop, a]);
          return grad;
        };
      if (prop === 'measureText') return () => ({ width: 10 });
      return (...a: unknown[]) => {
        calls++;
        check(prop, a);
        if (record) log.push([prop, a]);
      };
    },
    set(t, prop, v) {
      if (typeof prop === 'string') {
        t[prop] = v;
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${prop}=${v}`);
      }
      return true;
    },
  });
  return { ctx, bad, calls: () => calls, log };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Mat = [number, number, number, number, number, number];

/**
 * 그린 것이 차지하는 범위를 재는 가짜 캔버스.
 * 변환(이동·확대·회전)과 잘라내기(clip, 경계 상자로)를 따르고, 곡선·호는 촘촘히 짚어 보며, 선은 굵기의 절반만큼 넓힙니다.
 * 번지는 빛(그라디언트)은 투명한 가장자리까지 모두 셉니다 (넉넉하게).
 */
function boundsCtx(): { ctx: unknown; box: Box } {
  const empty = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const grow = (b: Box, x: number, y: number) => {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  };
  const box = empty();
  let m: Mat = [1, 0, 0, 1, 0, 0];
  let clip: Box | null = null;
  let lineWidth = 1;
  let path = empty();
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const stack: { m: Mat; clip: Box | null; lineWidth: number }[] = [];
  const mul = (n: Mat) => {
    const [a, b, c, d, e, f] = m;
    m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
  };
  const pt = (x: number, y: number) => grow(path, m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  const paint = (pad: number) => {
    const b = { x0: path.x0 - pad, y0: path.y0 - pad, x1: path.x1 + pad, y1: path.y1 + pad };
    const c = clip ? { x0: Math.max(b.x0, clip.x0), y0: Math.max(b.y0, clip.y0), x1: Math.min(b.x1, clip.x1), y1: Math.min(b.y1, clip.y1) } : b;
    if (c.x0 > c.x1 || c.y0 > c.y1) return;
    grow(box, c.x0, c.y0);
    grow(box, c.x1, c.y1);
  };
  const N = 32;
  const arc = (x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean) => {
    const T = Math.PI * 2;
    const d = a1 - a0;
    const sweep = !ccw ? (d >= T ? T : ((d % T) + T) % T) : -d >= T ? -T : -(((-d % T) + T) % T);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i <= N * 2; i++) {
      const a = a0 + (sweep * i) / (N * 2);
      const ex = Math.cos(a) * rx;
      const ey = Math.sin(a) * ry;
      cx = x + ex * cr - ey * sr;
      cy = y + ex * sr + ey * cr;
      pt(cx, cy);
    }
  };
  const rect = (x: number, y: number, w: number, h: number) => {
    pt(x, y);
    pt(x + w, y + h);
    pt(x + w, y);
    pt(x, y + h);
  };
  const api: Record<string, unknown> = {
    save: () => stack.push({ m: [...m], clip, lineWidth }),
    restore: () => {
      const s = stack.pop();
      if (s) ({ m, clip, lineWidth } = s);
    },
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
    rotate: (a: number) => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
    beginPath: () => (path = empty()),
    moveTo: (x: number, y: number) => {
      cx = sx = x;
      cy = sy = y;
      pt(x, y);
    },
    lineTo: (x: number, y: number) => {
      cx = x;
      cy = y;
      pt(x, y);
    },
    quadraticCurveTo: (qx: number, qy: number, x: number, y: number) => {
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        pt(u * u * cx + 2 * u * t * qx + t * t * x, u * u * cy + 2 * u * t * qy + t * t * y);
      }
      cx = x;
      cy = y;
    },
    bezierCurveTo: (ax: number, ay: number, bx: number, by: number, x: number, y: number) => {
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        pt(u * u * u * cx + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x, u * u * u * cy + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y);
      }
      cx = x;
      cy = y;
    },
    arc: (x: number, y: number, r: number, a0: number, a1: number, ccw = false) => arc(x, y, r, r, 0, a0, a1, ccw),
    ellipse: (x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) => arc(x, y, rx, ry, rot, a0, a1, ccw),
    rect,
    roundRect: rect,
    closePath: () => {
      cx = sx;
      cy = sy;
    },
    fill: () => paint(0),
    stroke: () => paint((lineWidth / 2) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))),
    fillRect: (x: number, y: number, w: number, h: number) => {
      const keep = path;
      path = empty();
      rect(x, y, w, h);
      paint(0);
      path = keep;
    },
    clip: () => {
      const c = clip;
      clip = c ? { x0: Math.max(path.x0, c.x0), y0: Math.max(path.y0, c.y0), x1: Math.min(path.x1, c.x1), y1: Math.min(path.y1, c.y1) } : { ...path };
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  const ctx = new Proxy(api, {
    get: (t, prop) => (typeof prop !== 'string' ? undefined : prop in t ? t[prop] : () => {}),
    set: (_t, prop, v) => {
      if (prop === 'lineWidth') lineWidth = v as number;
      return true;
    },
  });
  return { ctx, box };
}

const WEAPONS: (IconShape | undefined)[] = [undefined, 'sword', 'axe', 'dagger', 'claw', 'staff', 'mace', 'stick', 'bow', 'lute', 'book', 'gauntlet', 'dualsword'];
const NEW_CLASSES = ['summoner', 'bard', 'beastkin', 'archer', 'gladiator'] as const;

test('치비: 모든 직업 의상 x 무기 x 방향 x 자세를 예외·NaN 없이 그린다', async () => {
  const { drawChibi } = await load('src/client/render/chibi.ts');
  let n = 0;
  for (const outfit of CLASS_IDS) {
    for (const gender of ['m', 'f'] as const) {
      for (const weapon of WEAPONS) {
        for (const extra of [{}, { helmet: '#c9cfd6' }, { shield: '#b0b8c0' }]) {
          const look: HumanLook = { gender, hairStyle: n % 6, hairColor: '#8b5a2b', body: '#4a6a3a', body2: '#8b8b8b', outfit, weaponColor: '#8b8b8b', ...extra };
          if (weapon) look.weapon = weapon;
          for (const dir of [0, 1, 2, 3] as Dir[]) {
            const poses = [
              { walk: null, act: null },
              { walk: 0.4, act: null, step: 1 },
              { walk: null, act: 0.15, actKind: 'attack' },
              { walk: null, act: 0.4, actKind: 'attack' },
              { walk: null, act: 0.7, actKind: 'skill' },
              { walk: null, act: 0.5, actKind: 'cast' },
              { walk: null, act: null, showcase: true },
              { walk: null, act: null, ghost: true },
              { walk: null, act: 0.3, beast: true },
            ];
            for (const p of poses) {
              const m = mockCtx();
              drawChibi(m.ctx, look, { dir, time: 1234 + n, ...p }, { detail: n % 2 ? 'portrait' : 'sprite' });
              assert.deepEqual(m.bad, [], `${outfit}/${gender}/${weapon}/${dir}/${JSON.stringify(p)}`);
              assert.ok(m.calls() > 50, '실제로 무언가를 그림');
              n++;
            }
          }
        }
      }
    }
  }
});

test('치비: 새 직업은 평민 옷과 다르게 그려진다 (의상별 그리기 호출 수가 다름)', async () => {
  const { drawChibi } = await load('src/client/render/chibi.ts');
  const count = (outfit: HumanLook['outfit'], weapon?: IconShape) => {
    const m = mockCtx();
    const look: HumanLook = { gender: 'm', hairStyle: 0, hairColor: '#5a3a22', body: '#a08a6a', ...(outfit ? { outfit } : {}), ...(weapon ? { weapon } : {}) };
    drawChibi(m.ctx, look, { dir: 1, walk: null, act: null, time: 0 });
    return m.calls();
  };
  const base = count('peasant');
  for (const c of NEW_CLASSES) assert.notEqual(count(c), base, `${c} 의상이 평민과 같음`);
  // 무기마다 그림이 다름
  const plain = count('peasant');
  for (const w of ['bow', 'lute', 'book', 'gauntlet', 'dualsword'] as const) assert.ok(count('peasant', w) > plain, `${w} 무기를 그리지 않음`);
});

test('치비 초상화: 모든 의상·무기·머리·투구/방패가 쓰이는 초상화 액자 안에 들어온다 (잘리지 않음)', async () => {
  const { drawChibi } = await load('src/client/render/chibi.ts');
  // portraitUrl(look, w, h, scale) 을 부르는 곳: 캐릭터 발이 (w/2, h-10) 에 서고 scale 배로 그려짐
  const frames: [string, number, number, number][] = [
    ['캐릭터 창', 200, 240, 3.5],
    ['접속 화면', 170, 210, 3.0],
    ['HUD 얼굴', 160, 196, 2.9],
    ['NPC 대화창', 150, 190, 2.9],
  ];
  const over: string[] = [];
  for (const outfit of CLASS_IDS)
    for (const gender of ['m', 'f'] as const)
      for (let hair = 0; hair < HAIR_STYLES; hair++)
        for (const weapon of WEAPONS)
          for (const extra of [{}, { helmet: '#c9cfd6' }, { shield: '#b0b8c0' }, { helmet: '#c9cfd6', shield: '#b0b8c0' }]) {
            const look: HumanLook = { gender, hairStyle: hair, hairColor: '#8b5a2b', body: '#4a6a3a', body2: '#8b8b8b', outfit, weaponColor: '#c9c9c9', ...extra };
            if (weapon) look.weapon = weapon;
            const { ctx, box } = boundsCtx();
            // 초상화와 같은 자세. 발밑 그림자는 원래 아래 여백에서 잘리게 둔 것이라 빼고 잼
            drawChibi(ctx, look, { dir: 1, walk: null, act: null, time: 0, showcase: true }, { detail: 'portrait', shadow: false });
            for (const [name, w, h, s] of frames) {
              // 반대쪽을 보는 초상화(dir 2)는 좌우만 뒤집히므로 양쪽 모두 반폭 안이어야 함
              const half = w / 2 / s;
              if (box.x0 < -half || box.x1 > half || box.y0 < -(h - 10) / s || box.y1 > 10 / s)
                over.push(`${name} ${outfit}/${gender}/머리${hair}/${weapon ?? '맨손'}/${Object.keys(extra).join('+') || '-'}: x ${box.x0.toFixed(1)}..${box.x1.toFixed(1)}, 위 ${box.y0.toFixed(1)}`);
            }
          }
  assert.deepEqual(over.slice(0, 8), [], `${over.length}개 조합이 액자 밖으로 나감`);
});

test('아이콘: 모든 모양을 예외·NaN 없이 그린다', async () => {
  const { drawIcon } = await load('src/client/render/icons.ts');
  const shapes: IconShape[] = [
    'sword', 'axe', 'dagger', 'claw', 'staff', 'mace', 'stick', 'armor', 'robe', 'gi', 'leather', 'helmet', 'shield', 'necklace', 'earring',
    'ring', 'belt', 'boots', 'potion', 'scroll', 'gem', 'bone', 'pelt', 'wing', 'tail', 'web', 'ear', 'scale', 'orb', 'coin',
    'bow', 'lute', 'book', 'gauntlet', 'dualsword', 'arrow', 'note', 'paw', 'swords', 'spirit',
    'slash', 'burst', 'bolt', 'heart', 'cross', 'fist', 'eye', 'shieldIcon', 'skull', 'wave', 'leaf', 'star',
  ];
  for (const shape of shapes) {
    for (const color of ['#8b8b8b', '#ff6a3d', 'rgb(120,200,90)']) {
      const m = mockCtx();
      drawIcon(m.ctx, { shape, color, color2: '#ffe680' }, 34);
      assert.deepEqual(m.bad, [], shape);
      assert.ok(m.calls() > 2, `${shape} 아이콘이 비어 있음`);
    }
  }
});

test('효과: 새 효과 키(화살·연사·음악·소환·할퀴기·포효·쌍검·표식)와 모르는 키를 안전하게 그린다', async () => {
  const { Effects } = await load('src/client/render/effects.ts');
  const names = ['arrow', 'volley', 'music', 'summon', 'claw', 'roar', 'twinslash', 'mark', 'bolt', 'throw', 'no-such-fx'];
  const at = { sx: 100, sy: 80 };
  const from = { sx: 20, sy: 120 };
  for (const name of names) {
    for (const withFrom of [true, false]) {
      const fx = new Effects();
      fx.fx(name, name === 'arrow' ? 'fire' : undefined, 2, at, withFrom ? 1 : null, withFrom ? from : null, 0);
      assert.ok(fx.count > 0, `${name} 효과가 만들어지지 않음`);
      const m = mockCtx();
      for (let t = 0; t <= 2000; t += 40) fx.draw(m.ctx, t, (id: number) => (id === 2 ? at : id === 1 ? from : null), (p: unknown) => p);
      assert.deepEqual(m.bad, [], `${name} (시전자 ${withFrom})`);
      assert.equal(fx.count, 0, `${name} 효과가 끝나지 않음`);
    }
  }
});

test('효과: 아무도 맞히지 못한 화살·연사(시전자 = 대상)는 시전자에게 꽂히지 않고 바라보는 쪽 앞에서 섬광만 터진다', async () => {
  const { Effects } = await load('src/client/render/effects.ts');
  const at = { sx: 200, sy: 160 };
  // 아이소메트릭 화면에서 북·동쪽은 화면 오른쪽, 남·서쪽은 왼쪽
  const sides: [Dir, number][] = [
    [0, 1],
    [1, 1],
    [2, -1],
    [3, -1],
  ];
  for (const name of ['arrow', 'volley']) {
    for (const [dir, side] of sides) {
      const fx = new Effects();
      fx.fx(name, undefined, 7, at, 7, at, 0, dir);
      assert.equal(fx.count, name === 'volley' ? 4 : 1, `${name}: 화살 수만큼 섬광`);
      const m = mockCtx(true);
      for (let t = 0; t <= 1000; t += 20) fx.draw(m.ctx, t, (id: number) => (id === 7 ? at : null), (p: unknown) => p);
      assert.deepEqual(m.bad, [], `${name} d${dir}`);
      assert.equal(fx.count, 0, '효과가 끝남');
      const xs = m.log.filter(([k]) => k === 'arc' || k === 'moveTo' || k === 'lineTo' || k === 'createRadialGradient').map(([, a]) => a[0] as number);
      assert.ok(xs.length > 0, '무언가를 그림');
      // 시전자 몸 한가운데(맞은 자리 불꽃이 그려지던 곳)나 반대쪽에는 아무것도 그리지 않음
      for (const x of xs) assert.ok((x - at.sx) * side > 2, `${name} d${dir}: x=${x} 가 시전자 앞이 아님`);
      // 하늘에서 떨어지는 화살(시전자 머리 위)도 없음
      const ys = m.log.filter(([k]) => k === 'arc' || k === 'moveTo' || k === 'lineTo').map(([, a]) => a[1] as number);
      for (const y of ys) assert.ok(y > at.sy - 50, `${name} d${dir}: 머리 위(${y})에 그림`);
    }
  }
  // 대상이 따로 있으면 예전처럼 날아가 꽂힘 (투사체 + 맞은 자리 불꽃)
  const fx = new Effects();
  fx.fx('arrow', undefined, 2, { sx: 300, sy: 100 }, 1, at, 0, 1);
  assert.equal(fx.count, 2);
});

test('소환수: 주인 정보가 있는 몬스터는 아군이고 공격 대상이 아니다', () => {
  const snap = (extra: Partial<MonsterSnapshot>): MonsterSnapshot => ({ type: 'monster', id: 5, x: 3, y: 4, dir: 1, name: '여우 정령', def: 'spirit_fox', level: 10, hpPct: 100, statuses: [], ...extra });
  const fox = entityFromSnapshot(snap({ ownerId: 1, ownerName: '주인' }));
  assert.equal(fox.ownerId, 1);
  assert.equal(fox.ownerName, '주인');
  assert.ok(isAlly(fox));
  assert.equal(isHostile(fox), false);
  const rat = entityFromSnapshot(snap({ id: 6, def: 'rat', name: '들쥐' }));
  assert.equal(rat.ownerId, undefined);
  assert.equal(isAlly(rat), false);
  assert.ok(isHostile(rat));
  rat.dying = 1;
  assert.equal(isHostile(rat), false, '사라지는 중인 몬스터는 대상이 아님');
  assert.equal(chebyshev(0, 0, 3, -2), 3);
  assert.equal(chebyshev(5, 5, 5, 5), 0);
});
