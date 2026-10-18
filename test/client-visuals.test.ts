// 클라이언트 그림(치비 캐릭터·아이콘·효과)과 소환수 판별 점검.
// 캔버스 대신 호출을 기록하는 가짜 컨텍스트로 그려서, 예외나 잘못된 수(NaN, 음수 반지름)가 없는지 봅니다.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CLASS_IDS, type Dir } from '../src/shared/constants';
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
}

function mockCtx(): Mock {
  const bad: string[] = [];
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
          return grad;
        };
      if (prop === 'measureText') return () => ({ width: 10 });
      return (...a: unknown[]) => {
        calls++;
        check(prop, a);
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
  return { ctx, bad, calls: () => calls };
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
