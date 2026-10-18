// 고전 도트 캐릭터(classic-*.ts)의 순수한 부분 점검 (DOM 없음):
// 자세 → 그림 번호 양자화, 겉모습 서명, 캐시 개수 제한, 머리 모양·의상·모자 해석, 그림 크기와 키.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLASS_IDS, type Dir } from '../src/shared/constants';
import type { HumanLook, IconShape } from '../src/shared/types';
import { ART_H, ART_OX, ART_OY, ART_W, makeArtBuffer, renderClassicFrame } from '../src/client/render/classic-art';
import { CLASSIC_IDLE_MS, LruCache, lookSignature, quantizePose, type ClassicPose } from '../src/client/render/classic-core';
import { CLASSIC_FRAMES_PER_ANIM, HAIR_F, HAIR_M, P, costumeOf, coversHair, gripOf, hairStyleOf, headGearOf, type ClassicAnim, type ClassicFrame, type HairStyleId } from '../src/client/render/classic-kit';
import { OUTLINE_PART, PixelBuf, SOFT_PART } from '../src/client/render/classic-raster';
import { parseColor, ramp } from '../src/client/render/classic-palette';

const pose = (p: Partial<ClassicPose>): ClassicPose => ({ dir: 1, walk: null, act: null, time: 0, ...p });

test('양자화: 방향 → 앞/뒤 그림과 좌우 뒤집기', () => {
  const want: Record<Dir, [string, boolean]> = { 0: ['B', false], 1: ['F', false], 2: ['F', true], 3: ['B', true] };
  for (const d of [0, 1, 2, 3] as Dir[]) {
    const q = quantizePose(pose({ dir: d }));
    assert.equal(q.frame.view, want[d][0], `dir ${d}`);
    assert.equal(q.flip, want[d][1], `dir ${d}`);
  }
});

test('양자화: 행동 진행 0~1 → 4장, 종류별로 다른 열쇠', () => {
  const cases: [number, number][] = [
    [0, 0],
    [0.249, 0],
    [0.25, 1],
    [0.5, 2],
    [0.74, 2],
    [0.75, 3],
    [0.999, 3],
    [1, 3],
    [1.4, 3],
    [-0.2, 0],
  ];
  for (const [act, f] of cases) {
    const q = quantizePose(pose({ act, actKind: 'attack' }));
    assert.equal(q.frame.anim, 'attack');
    assert.equal(q.frame.f, f, `act ${act}`);
  }
  assert.equal(quantizePose(pose({ act: 0.3, actKind: 'cast' })).frame.anim, 'cast');
  assert.equal(quantizePose(pose({ act: 0.3, actKind: 'skill' })).frame.anim, 'skill');
  assert.equal(quantizePose(pose({ act: 0.3 })).frame.anim, 'attack', '종류가 없으면 공격');
  const keys = new Set(['attack', 'cast', 'skill'].map((k) => quantizePose(pose({ act: 0.3, actKind: k as ClassicPose['actKind'] })).key));
  assert.equal(keys.size, 3);
  // 행동이 걷기보다 우선
  assert.equal(quantizePose(pose({ act: 0.3, walk: 0.5 })).frame.anim, 'attack');
});

test('양자화: 걷기는 두 칸(step 0/1)에 걸쳐 4장을 차례로', () => {
  const seq: number[] = [];
  for (const step of [0, 1]) for (const walk of [0, 0.25, 0.5, 0.75, 0.99]) seq.push(quantizePose(pose({ walk, step })).frame.f);
  assert.deepEqual(seq, [0, 0, 1, 1, 1, 2, 2, 3, 3, 3]);
  for (const s of seq) assert.ok(s >= 0 && s < CLASSIC_FRAMES_PER_ANIM);
  assert.equal(quantizePose(pose({ walk: 0.2, step: 3 })).frame.f, quantizePose(pose({ walk: 0.2, step: 1 })).frame.f, 'step 은 홀짝만 봄');
});

test('양자화: 가만히는 시간으로 숨쉬기 4장, 유령은 늘 가만히, 이상한 값도 안전', () => {
  const fs = [0, 0.26, 0.51, 0.76].map((k) => quantizePose(pose({ time: k * CLASSIC_IDLE_MS })).frame.f);
  assert.deepEqual(fs, [0, 1, 2, 3]);
  assert.equal(quantizePose(pose({ time: CLASSIC_IDLE_MS * 7 + 1 })).frame.f, 0, '주기마다 반복');
  assert.equal(quantizePose(pose({ time: -5 })).frame.anim, 'idle');
  const g = quantizePose(pose({ ghost: true, walk: 0.5, act: 0.5, beast: true }));
  assert.equal(g.frame.anim, 'idle');
  assert.equal(g.frame.ghost, true);
  assert.equal(g.frame.beast, false, '유령은 야수화 그림을 쓰지 않음');
  assert.notEqual(g.key, quantizePose(pose({})).key);
  assert.notEqual(quantizePose(pose({ beast: true })).key, quantizePose(pose({})).key);
  for (const bad of [NaN, Infinity, -Infinity]) {
    const q = quantizePose(pose({ time: bad, act: null, walk: null }));
    assert.ok(q.frame.f >= 0 && q.frame.f < 4);
    const w = quantizePose(pose({ walk: bad }));
    assert.ok(w.frame.f >= 0 && w.frame.f < 4);
  }
});

test('겉모습 서명: 같은 값이면 같고, 그림을 바꾸는 값이 하나라도 다르면 다름', () => {
  const base: HumanLook = { gender: 'm', hairStyle: 2, hairColor: '#8B5A2B', body: '#4a6a3a', body2: '#9fe07a', outfit: 'archer', weapon: 'bow', weaponColor: '#7fe0a0' };
  const sig = lookSignature(base);
  assert.equal(lookSignature({ ...base }), sig, '다른 객체라도 값이 같으면 같음');
  assert.equal(lookSignature({ ...base, hairColor: '#8b5a2b' }), sig, '색은 대소문자 구분 없음');
  const changes: Partial<HumanLook>[] = [
    { gender: 'f' },
    { hairStyle: 3 },
    { hairColor: '#000000' },
    { body: '#ffffff' },
    { body2: '#123456' },
    { outfit: 'warrior' },
    { weapon: 'sword' },
    { weaponColor: '#ff0000' },
    { helmet: '#9aa0a6' },
    { shield: '#8a6a45' },
  ];
  const all = new Set([sig]);
  for (const c of changes) {
    const s = lookSignature({ ...base, ...c });
    assert.notEqual(s, sig, JSON.stringify(c));
    all.add(s);
  }
  assert.equal(all.size, changes.length + 1);
  // 같은 객체는 기억해 둠 (바꿔도 그대로 - 클라이언트는 겉모습이 바뀌면 새 객체를 받음)
  const obj: HumanLook = { ...base };
  const first = lookSignature(obj);
  obj.body = '#000000';
  assert.equal(lookSignature(obj), first);
});

test('LRU 캐시: 개수 제한, 오래 안 쓴 것부터 버림, 꺼내면 최근으로', () => {
  const c = new LruCache<number>(3);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.get('a'), 1);
  c.set('d', 4);
  assert.equal(c.size, 3);
  assert.equal(c.has('b'), false, 'b 가 가장 오래 안 씀');
  assert.deepEqual(c.keys(), ['c', 'a', 'd']);
  c.set('c', 30);
  assert.deepEqual(c.keys(), ['a', 'd', 'c']);
  for (let i = 0; i < 1000; i++) c.set(`k${i}`, i);
  assert.equal(c.size, 3);
  assert.deepEqual(c.keys(), ['k997', 'k998', 'k999']);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get('k999'), undefined);
});

test('머리 모양: 플레이어 번호(0~5)와 남녀로 8가지 이름 모양이 모두 나오고, 남녀가 다름', () => {
  const named: HairStyleId[] = ['spiky', 'long', 'ponytail', 'short', 'bob', 'twintail', 'wild', 'braid'];
  const seen = new Set<HairStyleId>();
  for (const gender of ['m', 'f'] as const) for (let i = 0; i < 6; i++) seen.add(hairStyleOf({ gender, hairStyle: i }));
  for (const n of named) assert.ok(seen.has(n), `${n} 모양이 없음`);
  let differ = 0;
  for (let i = 0; i < 6; i++) if (hairStyleOf({ gender: 'm', hairStyle: i }) !== hairStyleOf({ gender: 'f', hairStyle: i })) differ++;
  assert.ok(differ >= 4, '남녀 모양이 대부분 다름');
  // 이름이 같은 모양(긴 머리·포니테일)도 남녀 그림은 다름 (앞머리·얼굴)
  for (let i = 0; i < 6; i++) {
    const head = (gender: 'm' | 'f') => {
      const b = renderClassicFrame({ gender, hairStyle: i, hairColor: '#5a3a22', body: '#a08a6a' }, { view: 'F', anim: 'idle', f: 0, ghost: false, beast: false });
      const out: number[] = [];
      for (let i2 = 0; i2 < b.part.length; i2++) if (b.part[i2] === P.hair || b.part[i2] === P.hairBack) out.push(i2);
      return out.join(',');
    };
    assert.notEqual(head('m'), head('f'), `머리 모양 ${i}`);
  }
  assert.equal(new Set(HAIR_M).size, HAIR_M.length);
  assert.equal(new Set(HAIR_F).size, HAIR_F.length);
  // 큰 번호·음수·이상한 값도 목록 안의 모양
  for (const n of [6, 7, 8, 99, -1, -13, 2.7, NaN]) {
    assert.ok(HAIR_M.includes(hairStyleOf({ gender: 'm', hairStyle: n })), String(n));
    assert.ok(HAIR_F.includes(hairStyleOf({ gender: 'f', hairStyle: n })), String(n));
  }
});

test('의상: 11개 직업이 서로 다른 옷이고, 평민은 남녀가 다름 (민소매·반바지 / 민소매 원피스)', () => {
  const sigOf = (c: ReturnType<typeof costumeOf>) => JSON.stringify(c);
  const sigs = new Set(CLASS_IDS.map((id) => sigOf(costumeOf(id, 'm'))));
  assert.equal(sigs.size, CLASS_IDS.length);
  const pm = costumeOf('peasant', 'm');
  const pf = costumeOf('peasant', 'f');
  assert.equal(pm.top, 'tank');
  assert.equal(pm.legs, 'shorts');
  assert.equal(pf.top, 'dress');
  assert.equal(pm.sleeve, 'none');
  assert.deepEqual(costumeOf(undefined, 'm'), pm, '의상이 없으면 평민');
  // 직업별 특징
  assert.ok(costumeOf('warrior', 'm').pauldrons && costumeOf('warrior', 'm').cape);
  assert.ok(costumeOf('rogue', 'm').scarf);
  assert.equal(costumeOf('wizard', 'm').skirt, 'robe');
  assert.ok(costumeOf('priest', 'f').stole);
  assert.ok(costumeOf('monk', 'm').wraps);
  assert.ok(costumeOf('summoner', 'm').talisman);
  assert.equal(costumeOf('bard', 'm').cape, 'short');
  assert.ok(costumeOf('beastkin', 'f').tail && costumeOf('beastkin', 'f').ears);
  assert.ok(costumeOf('archer', 'm').quiver && costumeOf('archer', 'm').bracers);
  assert.equal(costumeOf('gladiator', 'm').skirt, 'straps');
  assert.equal(costumeOf('gladiator', 'm').feet, 'greaves');
});

test('모자: 투구 색이 있으면 직업별 투구 (chibi.ts 와 같은 규칙), 없으면 직업 기본 모자', () => {
  const h = '#9aa0a6';
  const withHelm: Record<string, string> = {
    peasant: 'horned',
    warrior: 'horned',
    wizard: 'circlet',
    priest: 'circlet',
    summoner: 'circlet',
    rogue: 'halfhelm',
    archer: 'halfhelm',
    monk: 'browguard',
    beastkin: 'browguard',
    bard: 'beret',
    gladiator: 'plumehelm',
  };
  for (const id of CLASS_IDS) assert.equal(headGearOf({ gender: 'm', outfit: id, helmet: h }), withHelm[id], id);
  assert.equal(headGearOf({ gender: 'm', outfit: 'wizard' }), 'pointhat');
  assert.equal(headGearOf({ gender: 'm', outfit: 'priest' }), 'mitre');
  assert.equal(headGearOf({ gender: 'f', outfit: 'priest' }), 'veil');
  assert.equal(headGearOf({ gender: 'm', outfit: 'bard' }), 'featherhat');
  assert.equal(headGearOf({ gender: 'm', outfit: 'peasant' }), 'none');
  assert.equal(headGearOf({ gender: 'm' }), 'none');
  assert.ok(coversHair('horned') && !coversHair('circlet') && !coversHair('none'));
});

test('무기 모양 → 쥐는 방식: 무기 모양은 모두 무언가를 듦', () => {
  const weapons: IconShape[] = ['sword', 'axe', 'dagger', 'claw', 'staff', 'mace', 'stick', 'bow', 'lute', 'book', 'gauntlet', 'dualsword'];
  for (const w of weapons) assert.notEqual(gripOf(w), 'none', w);
  assert.equal(gripOf(undefined), 'none');
  assert.equal(gripOf('bow'), 'bow');
  assert.equal(gripOf('dualsword'), 'dual');
  assert.equal(gripOf('potion'), 'heavy', '무기가 아닌 모양도 손에 듦');
});

test('색: 여러 형식을 읽고, 재질은 어두운 → 밝은 4단계', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#102030'), [16, 32, 48]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.deepEqual(parseColor('이상한 색'), [128, 128, 128]);
  for (const c of ['#000000', '#ffffff', '#8a1c1c', '#3e7d3a', '#9aa0a6']) {
    const m = ramp(c);
    const lum = m.t.map((p) => (p & 255) * 0.3 + ((p >>> 8) & 255) * 0.59 + ((p >>> 16) & 255) * 0.11);
    for (let i = 1; i < 4; i++) assert.ok(lum[i]! >= lum[i - 1]!, `${c} 밝기 순서`);
    assert.ok(lum[3]! - lum[0]! > 20, `${c} 명암 폭`);
  }
});

// ───────────────────────── 실제 그림 ─────────────────────────

const WEAPONS: (IconShape | undefined)[] = [undefined, 'sword', 'axe', 'dagger', 'claw', 'staff', 'mace', 'stick', 'bow', 'lute', 'book', 'gauntlet', 'dualsword'];
const ANIMS: ClassicAnim[] = ['idle', 'walk', 'attack', 'cast', 'skill'];

function opaqueBounds(b: PixelBuf) {
  const bb = b.bounds();
  assert.ok(bb, '그림이 비어 있음');
  return bb;
}

test('그림: 모든 직업 x 성별 x 무기 x 앞뒤 x 동작 x 그림을 예외 없이, 정해진 상자 안에 그림', () => {
  const buf = makeArtBuffer();
  let n = 0;
  CLASS_IDS.forEach((outfit, ci) => {
    for (const gender of ['m', 'f'] as const) {
      // 직업마다 무기 몇 가지씩 (모든 무기가 여러 직업에서 한 번 이상 나옴)
      WEAPONS.forEach((weapon, wi) => {
        if ((wi + ci) % 3 !== 0 && wi !== 0) return;
        const extra = wi % 3 === 0 ? { helmet: '#c9cfd6' } : wi % 3 === 1 ? { shield: '#8a6a45' } : {};
        const look: HumanLook = { gender, hairStyle: (n + wi) % 8, hairColor: '#8b5a2b', body: '#4a6a3a', body2: '#8b8b8b', outfit, weaponColor: '#c9c9c9', ...extra };
        if (weapon) look.weapon = weapon;
        for (const view of ['F', 'B'] as const) {
          for (const anim of ANIMS) {
            for (let f = 0; f < CLASSIC_FRAMES_PER_ANIM; f++) {
              const fr: ClassicFrame = { view, anim, f, ghost: false, beast: f === 3 };
              const b = renderClassicFrame(look, fr, buf);
              const bb = opaqueBounds(b);
              // 반투명 그리기용 버퍼(발 위 165px, 좌우 100px) 안에 들어감
              assert.ok(bb.y >= -165 && bb.y + bb.h <= 25, `${outfit}/${gender}/${weapon}/${view}/${anim}${f} 높이 ${bb.y}`);
              assert.ok(bb.x >= -100 && bb.x + bb.w <= 100, `${outfit}/${gender}/${weapon}/${view}/${anim}${f} 폭`);
              // 작업 버퍼 가장자리에 닿지 않음 (잘린 그림 없음)
              assert.ok(bb.x > -ART_OX && bb.x + bb.w < ART_W - ART_OX && bb.y > -ART_OY && bb.y + bb.h < ART_H - ART_OY, `${outfit}/${weapon}/${view}/${anim}${f} 잘림`);
              n++;
            }
          }
        }
      });
    }
  });
  assert.ok(n > 2000);
});

test('그림: 맨머리 보통 캐릭터의 머리 꼭대기는 발 위 58~62px, 키는 약 1.8~1.9칸', () => {
  const tops: number[] = [];
  for (const gender of ['m', 'f'] as const) {
    for (const hairStyle of [0, 2, 4]) {
      const look: HumanLook = { gender, hairStyle, hairColor: '#5a3a22', body: '#a08a6a' };
      const b = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 0, ghost: false, beast: false });
      const top = b.topY([P.hair, P.hairBack, P.head, P.hat]);
      assert.ok(top !== null);
      tops.push(-top);
      assert.ok(-top >= 56 && -top <= 63, `${gender}${hairStyle}: ${-top}`);
    }
  }
  const avg = tops.reduce((a, b) => a + b, 0) / tops.length;
  assert.ok(avg >= 58 && avg <= 62, `평균 머리 꼭대기 ${avg}`);
  // 머리(정수리~턱)는 키의 1/5 ~ 1/4 쯤
  const look: HumanLook = { gender: 'm', hairStyle: 0, hairColor: '#5a3a22', body: '#a08a6a' };
  const b = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 0, ghost: false, beast: false });
  let chin = 0;
  for (let y = -1; y > -80; y--) for (let x = -20; x < 20; x++) if (b.partAt(x, y) === P.head && y < chin) chin = y;
  let headBottom = -80;
  for (let y = -80; y < 0; y++) for (let x = -20; x < 20; x++) if (b.partAt(x, y) === P.head || b.partAt(x, y) === P.face) headBottom = Math.max(headBottom, y);
  const headH = headBottom + 1 - (b.topY([P.hair, P.hairBack, P.head]) ?? 0);
  const total = -(b.topY() ?? 0);
  assert.ok(headH / total > 0.18 && headH / total < 0.3, `머리 비율 ${headH}/${total}`);
});

test('그림: 1px 외곽선이 실루엣을 감싸고, 유령은 푸르스름하고, 야수화는 기운과 붉은 눈', () => {
  const look: HumanLook = { gender: 'f', hairStyle: 1, hairColor: '#d0532a', body: '#7a5230', outfit: 'beastkin', weapon: 'gauntlet', weaponColor: '#c0c0c0' };
  const b = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 0, ghost: false, beast: false });
  // 칠한 칸의 빈 이웃은 없어야 함 (외곽선이 다 감쌈)
  for (let i = 0; i < b.part.length; i++) {
    const p = b.part[i]!;
    if (p === 0 || p === OUTLINE_PART || p === SOFT_PART) continue;
    const x = i % b.w;
    for (const j of [i - 1, i + 1, i - b.w, i + b.w]) {
      if (j < 0 || j >= b.part.length || Math.abs((j % b.w) - x) > 1) continue;
      assert.notEqual(b.part[j], 0, '외곽선 빈틈');
    }
  }
  const lum = (c: number) => (c & 255) * 0.3 + ((c >>> 8) & 255) * 0.59 + ((c >>> 16) & 255) * 0.11;
  let outl = 0;
  let sum = 0;
  for (let i = 0; i < b.part.length; i++) if (b.part[i] === OUTLINE_PART) (outl++, (sum += lum(b.px[i]!)));
  assert.ok(outl > 100 && sum / outl < 60, '외곽선은 어두움');
  // 유령
  const g = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 0, ghost: true, beast: false });
  let blue = 0;
  let total = 0;
  for (const c of g.px) {
    if (!c) continue;
    total++;
    if (((c >>> 16) & 255) > (c & 255)) blue++;
  }
  assert.ok(blue / total > 0.95, '유령은 푸름');
  // 야수화: 반투명 기운 칸과 붉은 눈
  const x = renderClassicFrame(look, { view: 'F', anim: 'idle', f: 1, ghost: false, beast: true });
  let soft = 0;
  for (const p of x.part) if (p === SOFT_PART) soft++;
  assert.ok(soft > 20, '야수화 기운');
  let red = 0;
  for (let i = 0; i < x.part.length; i++) {
    if (x.part[i] !== P.face) continue;
    const c = x.px[i]!;
    if ((c & 255) > 200 && ((c >>> 8) & 255) < 90) red++;
  }
  assert.ok(red >= 2, '붉은 눈');
});

test('그림: 걷기 4장과 공격 4장은 서로 다르고, 시전에는 손의 빛이 있음', () => {
  const look: HumanLook = { gender: 'm', hairStyle: 1, hairColor: '#2a4d8f', body: '#b0b8c0', outfit: 'warrior', weapon: 'sword', weaponColor: '#7fb7ff', shield: '#8a6a45' };
  const sig = (anim: ClassicAnim, f: number) => {
    const b = renderClassicFrame(look, { view: 'F', anim, f, ghost: false, beast: false });
    return Array.from(b.px).join(',');
  };
  for (const anim of ['walk', 'attack', 'cast'] as const) {
    const s = new Set([0, 1, 2, 3].map((f) => sig(anim, f)));
    assert.ok(s.size >= 3, `${anim} 그림이 거의 같음`);
  }
  assert.notEqual(sig('idle', 0), sig('idle', 1), '숨쉬기');
  const cast = renderClassicFrame(look, { view: 'F', anim: 'cast', f: 2, ghost: false, beast: false });
  let soft = 0;
  for (const p of cast.part) if (p === SOFT_PART) soft++;
  assert.ok(soft > 4, '시전 빛');
  // 왼쪽을 볼 때는 그리는 쪽에서 뒤집으므로 그림 자체는 같음 (방향은 F/B 만)
  const bow: HumanLook = { gender: 'f', hairStyle: 4, hairColor: '#e8d08a', body: '#4a6a3a', outfit: 'archer', weapon: 'bow', weaponColor: '#8a6a45' };
  const shot = [0, 1, 2, 3].map((f) => renderClassicFrame(bow, { view: 'F', anim: 'attack', f, ghost: false, beast: false }).bounds()!);
  assert.ok(shot[1]!.x + shot[1]!.w > 12, '활을 앞으로 겨눔');
});
