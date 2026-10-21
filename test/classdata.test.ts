// 직업별 게임 데이터(기술·장비·소환수·길드장·상점·전리품)가 서로 맞물리는지 확인합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ASSAIL_COOLDOWN_MS, SKILL_GCD_MS, STATUS_INFO, type ClassId, type StatusId } from '../src/shared/constants';
import {
  CRIT_MULT,
  acMagicMultiplier,
  acMultiplier,
  computeDerived,
  critChance,
  elementMultiplier,
  hitChance,
  magicBase,
  monsterStats,
  physicalBase,
  type DerivedStats,
} from '../src/shared/formulas';
import { tileInfo } from '../src/shared/tiles';
import type { AbilityDef, ItemDef, LootEntry } from '../src/shared/types';
import { loadConfig } from '../src/server/config';
import { GameData } from '../src/server/gamedata';
import { emptyEquipment, normalizeCharacter, type CharacterData } from '../src/server/storage';
import { autoAllocateOnData, bestGearFor, equipError, setLevelOnData } from '../src/server/systems/character';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);
const cfg = loadConfig({ ADMIN_PASSWORD: 'x', DATA_DIR: os.tmpdir() } as NodeJS.ProcessEnv);

const NEW_CLASSES: ClassId[] = ['summoner', 'bard', 'beastkin', 'archer', 'gladiator'];
const TIER_LEVELS = [5, 12, 25, 40, 55, 70, 85, 99];
const WEAPON_SHAPE: Partial<Record<ClassId, string>> = {
  summoner: 'book',
  bard: 'lute',
  beastkin: 'gauntlet',
  archer: 'bow',
  gladiator: 'dualsword',
};
const ABILITY_PREFIX: Partial<Record<ClassId, string>> = { summoner: 's_', bard: 'b_', beastkin: 'k_', archer: 'a_', gladiator: 'g_' };
/** 클라이언트가 그릴 수 있는 시각 효과 키 */
const FX_KEYS = new Set(
  (
    'slash stab punch smash whirl dash throw shadow ki bolt explosion impact heal buff debuff cleanse holy revive sleep ' +
    'paralyze poison meditate teleport arrow volley music summon claw roar twinslash mark'
  ).split(' '),
);

function charOf(classId: ClassId, level: number): CharacterData {
  const d = normalizeCharacter({ name: '시험', passwordHash: 'x', inventory: [], equipment: emptyEquipment() });
  d.classId = classId;
  d.level = level;
  return d;
}

const abilitiesOf = (cls: ClassId): AbilityDef[] => [...gd.abilities.values()].filter((a) => a.classId === cls);

/** 한 캐릭터가 함께 배울 수 있는 기술 묶음. 수인은 계통(포유류·조류·파충류)마다 공통 기술 + 그 계통 기술 */
interface Kit {
  label: string;
  cls: ClassId;
  list: AbilityDef[];
}
const kitsOf = (cls: ClassId): Kit[] => {
  const all = abilitiesOf(cls);
  const typeOf = (a: AbilityDef) => gd.nodeOf(a.id)?.node.beastType;
  if (!all.some(typeOf)) return [{ label: cls, cls, list: all }];
  return gd.progression.second.beastTypes.map((b) => ({ label: `${cls}(${b.name})`, cls, list: all.filter((a) => !typeOf(a) || typeOf(a) === b.id) }));
};
const gearOf =(cls: ClassId, slot: 'weapon' | 'armor'): ItemDef[] =>
  [...gd.items.values()].filter((it) => it.slot === slot && it.classes?.includes(cls)).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

// ───────────────────────── 밸런스 모델 ─────────────────────────
// 같은 레벨 몬스터 하나를 상대로 한 초당 기대 피해. 능력치는 직업 비율대로 자동 분배하고, 레벨에 맞는 최고 장비를 입힙니다.
// 평타와 피해 기술은 각자의 재사용 대기마다 씁니다 (평타와 기술의 대기는 따로 돌아감). 명중률·치명타·대상 AC를 반영하고,
// 중독/출혈은 유지율만큼 더합니다. buffed 는 자기 강화(광폭·야수화·신속)와 대상 약화(표식·저주)를 유지율만큼,
// 은신 기습은 은신 재사용 대기마다 한 번 반영한 값입니다.

const OLD_PHYSICAL: ClassId[] = ['warrior', 'rogue', 'monk'];
const NEW_PHYSICAL: ClassId[] = ['beastkin', 'archer', 'gladiator'];

function derivedAt(cls: ClassId, level: number): DerivedStats {
  const d = charOf(cls, 1);
  setLevelOnData(d, cfg, level);
  autoAllocateOnData(d, gd, cfg);
  return computeDerived({ cls: gd.classes.get(cls)!, level, stats: d.stats, bonusHp: 0, bonusMp: 0, equipment: bestGearFor(d, gd) });
}

const monsterAt = (level: number) => monsterStats({ id: 'x', name: 'x', level, look: { body: 'rat', color: '#000000' } });

interface Dps {
  base: number;
  buffed: number;
}
const dpsCache = new Map<string, Dps>();

/** 직업(수인은 계통 묶음)의 초당 기대 피해. cls 만 주면 그 직업의 기술 전부 */
function dpsOf(who: ClassId | Kit, level: number): Dps {
  const kit = typeof who === 'string' ? { label: who, cls: who, list: abilitiesOf(who) } : who;
  const cls = kit.cls;
  const key = `${kit.label}:${level}`;
  const cached = dpsCache.get(key);
  if (cached) return cached;
  const d = derivedAt(cls, level);
  const m = monsterAt(level);
  const roll = (d.dmgMin + d.dmgMax) / 2;
  const hit = hitChance(d.dex, level, m.dex, level, d.hit);
  /** 초당 rate 배율만큼 치는 물리 공격의 초당 기대 피해 */
  const phys = (rate: number, critBonus: number, ac: number): number =>
    physicalBase(d, level, roll) * rate * hit * (1 + (CRIT_MULT - 1) * critChance(d.dex, critBonus)) * acMultiplier(ac);
  const strikes: { rate: number; critBonus: number }[] = [{ rate: 1000 / ASSAIL_COOLDOWN_MS, critBonus: 0 }];
  let magic = 0; // AC 적용 전 마법 피해/초
  const dots = new Map<StatusId, number>();
  let might = 1;
  let speed = 1;
  let mark = 1;
  let curse = 0;
  const mine = kit.list.filter((a) => a.level <= level);
  const hideCd = mine.find((a) => a.effects.some((e) => e.type === 'status' && e.status === 'hide'))?.cooldownMs;
  let ambush: { rate: number; critBonus: number } | null = null;
  for (const a of mine) {
    const cd = Math.max(a.cooldownMs, SKILL_GCD_MS) / 1000;
    for (const e of a.effects) {
      if (e.type === 'physical') {
        const total = e.mult * (e.hits ?? 1);
        strikes.push({ rate: total / cd, critBonus: e.critBonus ?? 0 });
        if (hideCd !== undefined && e.hideBonus) {
          const rate = (total * e.hideBonus) / (Math.max(hideCd, a.cooldownMs) / 1000);
          if (!ambush || rate > ambush.rate) ambush = { rate, critBonus: e.critBonus ?? 0 };
        }
      } else if (e.type === 'magic') {
        magic += magicBase(e.base, e.ratio, d[e.stat ?? 'int'], level, d.magic) / cd;
      } else if (e.type === 'status') {
        const up = Math.min(1, e.durationMs / Math.max(1, a.cooldownMs)) * (e.chance ?? 1);
        const pot = e.potency ?? STATUS_INFO[e.status].potency;
        if (e.status === 'poison' || e.status === 'bleed') dots.set(e.status, Math.max(dots.get(e.status) ?? 0, (pot + level * 1.5) * up));
        if (e.status === 'might' || e.status === 'beast') might *= 1 + (pot / 100) * up;
        if (e.status === 'haste') speed *= up / Math.max(0.5, 1 - pot / 100) + (1 - up);
        if (e.status === 'mark') mark = Math.max(mark, 1 + (pot / 100) * up);
        if (e.status === 'curse') curse = Math.max(curse, pot * up);
      }
    }
  }
  const sum = (list: { rate: number; critBonus: number }[], ac: number) => list.reduce((s, x) => s + phys(x.rate, x.critBonus, ac), 0);
  const dot = [...dots.values()].reduce((s, v) => s + v, 0);
  const base = sum(strikes, m.ac) + magic * acMagicMultiplier(m.ac) + dot;
  const buffedStrikes = ambush ? [...strikes, ambush] : strikes;
  const buffed = (sum(buffedStrikes, m.ac + curse) * might + magic * acMagicMultiplier(m.ac + curse)) * speed * mark + dot;
  const out = { base, buffed };
  dpsCache.set(key, out);
  return out;
}

/** 소환사가 그 레벨에 부를 수 있는 소환수를 모두 불렀을 때의 초당 기대 피해 (근접 + 마법) */
function petDpsAt(level: number): number {
  const m = monsterAt(level);
  let dps = 0;
  for (const a of abilitiesOf('summoner')) {
    if (a.level > level) continue;
    for (const e of a.effects) {
      if (e.type !== 'summon') continue;
      const def = gd.monsters.get(e.monster)!;
      const s = monsterStats({ ...def, level });
      const hit = hitChance(s.dex, level, m.dex, level, 0);
      let one = (((s.dmg[0] + s.dmg[1]) / 2) * hit * acMultiplier(m.ac)) / ((def.attackMs ?? 1400) / 1000);
      for (const sp of def.spells ?? []) {
        const sd = gd.abilities.get(sp.id)!;
        // 몬스터 마법은 재사용 대기가 끝난 뒤 1초마다 chance 확률로 씁니다
        const every = sd.cooldownMs / 1000 + 1 / sp.chance;
        for (const ef of sd.effects) if (ef.type === 'magic') one += (magicBase(ef.base, ef.ratio, s.int, level, 0) * acMagicMultiplier(m.ac)) / every;
      }
      dps += one * e.max;
    }
  }
  return dps;
}

test('새 직업이 포함된 게임 데이터가 오류 없이 로드되고, 시작 장비를 바로 입을 수 있다', () => {
  assert.doesNotThrow(() => GameData.load(DIR));
  for (const cls of NEW_CLASSES) {
    const c = gd.classes.get(cls);
    assert.ok(c, cls);
    assert.deepEqual(c.starterItems, [`w_${cls}_1`, `a_${cls}_1`]);
    for (const id of c.starterItems ?? []) assert.equal(equipError(charOf(cls, 5), gd.items.get(id)!), null, `${cls}: ${id}`);
  }
});

test('모든 직업은 1~99레벨 사이에 9개 이상의 기술을 가지며, 전직하자마자 배울 기술이 있다', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'abilities.json'), 'utf8')) as AbilityDef[];
  assert.equal(new Set(raw.map((a) => a.id)).size, raw.length, '기술 id 중복');
  for (const c of gd.classes.values()) {
    if (c.id === 'peasant') continue;
    const list = abilitiesOf(c.id);
    assert.ok(list.length >= 9, `${c.id}: 기술 ${list.length}개`);
    assert.ok(list.some((a) => a.level <= 5), `${c.id}: 5레벨 기술 없음`);
    for (const a of list) assert.ok(Number.isInteger(a.level) && a.level >= 1 && a.level <= 99, `${a.id}: 레벨 ${a.level}`);
    // 높은 레벨 기술일수록 비싸다
    const sorted = [...list].sort((a, b) => a.level - b.level);
    for (let i = 1; i < sorted.length; i++)
      assert.ok(sorted[i]!.price >= sorted[i - 1]!.price, `${c.id}: ${sorted[i]!.id} 가격이 ${sorted[i - 1]!.id} 보다 낮음`);
  }
  for (const cls of NEW_CLASSES) {
    // 한 캐릭터가 배울 수 있는 기술 수 (수인은 계통마다: 공통 + 그 계통)
    for (const kit of kitsOf(cls)) {
      const list = kit.list;
      assert.ok(list.length >= 10 && list.length <= 12, `${kit.label}: 기술 ${list.length}개`);
      assert.ok(list.filter((a) => a.level <= 12).length >= 2, `${kit.label}: 12레벨 이하 기술이 2개 미만`);
      assert.ok(list.some((a) => a.level >= 80), `${kit.label}: 80레벨 이상 기술 없음`);
    }
    for (const a of abilitiesOf(cls)) {
      assert.ok(a.id.startsWith(ABILITY_PREFIX[cls]!), `${a.id}: id 접두어`);
      assert.ok(a.fx && FX_KEYS.has(a.fx), `${a.id}: 알 수 없는 fx ${a.fx}`);
      assert.ok(a.desc.length > 0 && /[가-힣]/.test(a.name), `${a.id}: 한글 이름/설명`);
    }
  }
  // 바드의 노래는 그룹 전체에 걸린다
  assert.ok(abilitiesOf('bard').filter((a) => a.targeting === 'party').length >= 4);
  // 수인은 (어느 계통이든) 흡혈, 검투사는 연속 베기, 궁수는 멀리서 쏘는 기술이 중심
  for (const kit of kitsOf('beastkin'))
    assert.ok(kit.list.some((a) => a.effects.some((e) => e.type === 'physical' && (e.lifesteal ?? 0) > 0)), kit.label);
  assert.ok(abilitiesOf('gladiator').filter((a) => a.effects.some((e) => e.type === 'physical' && (e.hits ?? 1) > 1)).length >= 4);
  assert.ok(abilitiesOf('archer').filter((a) => ['enemy', 'enemyArea', 'line'].includes(a.targeting)).length >= 6);
});

test('새 직업은 레벨에 맞는 무기 8단계와 갑옷 8단계를 가진다', () => {
  for (const cls of NEW_CLASSES) {
    for (const slot of ['weapon', 'armor'] as const) {
      const list = gearOf(cls, slot);
      assert.equal(list.length, 8, `${cls} ${slot}`);
      assert.deepEqual(
        list.map((it) => it.level),
        TIER_LEVELS,
        `${cls} ${slot} 레벨`,
      );
      list.forEach((it, i) => {
        assert.equal(it.id, `${slot === 'weapon' ? 'w' : 'a'}_${cls}_${i + 1}`);
        assert.deepEqual(it.classes, [cls]);
        assert.equal(equipError(charOf(cls, it.level!), it), null, `${it.id}: ${it.level}레벨에 착용`);
        assert.match(equipError(charOf(cls, it.level! - 1), it) ?? '', /레벨/, `${it.id}: 레벨 제한`);
        assert.match(equipError(charOf('warrior', 99), it) ?? '', /직업/, `${it.id}: 직업 제한`);
        if (i > 0) assert.ok(it.price > list[i - 1]!.price, `${it.id}: 가격`);
        if (slot === 'weapon') {
          assert.equal(it.icon.shape, WEAPON_SHAPE[cls], `${it.id}: 무기 모양`);
          assert.ok(it.dmg && it.dmg[0] <= it.dmg[1], `${it.id}: 피해`);
          if (i > 0) assert.ok(it.dmg![1] > list[i - 1]!.dmg![1], `${it.id}: 피해가 늘어나야 함`);
        } else {
          assert.ok((it.ac ?? 0) < 0, `${it.id}: AC`);
          if (i > 0) assert.ok(it.ac! < list[i - 1]!.ac!, `${it.id}: AC가 좋아져야 함`);
        }
      });
    }
  }
});

test('새 직업도 레벨 5/40/99에서 착용 가능한 최고 장비를 받는다', () => {
  for (const cls of NEW_CLASSES) {
    for (const lv of [5, 40, 99]) {
      const d = charOf(cls, lv);
      const gear = bestGearFor(d, gd);
      for (const g of gear) assert.equal(equipError(d, g), null, `${cls} ${lv} ${g.id}`);
      const weapon = gear.find((g) => g.slot === 'weapon');
      const armor = gear.find((g) => g.slot === 'armor');
      assert.ok(weapon?.classes?.includes(cls), `${cls} ${lv} 무기 ${weapon?.id}`);
      assert.ok(armor?.classes?.includes(cls), `${cls} ${lv} 갑옷 ${armor?.id}`);
      assert.equal(weapon!.level, Math.max(...TIER_LEVELS.filter((l) => l <= lv)), `${cls} ${lv} 무기 단계`);
    }
  }
});

test('활만 사거리가 길고, 궁수의 무기는 모두 활이다', () => {
  for (const it of gd.items.values()) {
    if (it.slot !== 'weapon') continue;
    if (it.icon.shape === 'bow') {
      assert.ok((it.range ?? 1) > 1, `${it.id}: 활 사거리`);
      assert.ok(it.range! <= 10);
    } else assert.ok((it.range ?? 1) === 1, `${it.id}: 근접 무기인데 사거리 ${it.range}`);
  }
  for (const it of gearOf('archer', 'weapon')) assert.equal(it.icon.shape, 'bow', it.id);
  // 활은 멀리서 쏘고 민첩이 명중·치명타까지 올려 주므로, 같은 단계의 장검보다 피해가 훨씬 낮고 명중 보너스가 없다
  const swords = gearOf('warrior', 'weapon');
  gearOf('archer', 'weapon').forEach((bow, i) => {
    assert.ok(!bow.bonus?.hit, `${bow.id}: 활에 명중 보너스`);
    assert.ok(bow.dmg![1] <= 0.7 * swords[i]!.dmg![1], `${bow.id}: 피해 ${bow.dmg} / ${swords[i]!.id} ${swords[i]!.dmg}`);
  });
});

test('소환 기술은 소환수만 부르고, 소환수는 맵에 생성되지 않는다', () => {
  const summoned = new Set<string>();
  for (const a of gd.abilities.values()) {
    for (const e of a.effects) {
      if (e.type !== 'summon') continue;
      const m = gd.monsters.get(e.monster);
      assert.ok(m, `${a.id}: 몬스터 ${e.monster} 없음`);
      assert.equal(m.summon, true, `${a.id}: ${e.monster} 는 소환수가 아님`);
      assert.equal(a.classId, 'summoner', `${a.id}: 소환은 소환사 전용`);
      summoned.add(e.monster);
    }
  }
  const summons = [...gd.monsters.values()].filter((m) => m.summon);
  assert.ok(summons.length >= 6, `소환수 ${summons.length}종`);
  for (const m of summons) {
    assert.ok(summoned.has(m.id), `${m.id}: 부르는 기술이 없음`);
    assert.ok(!m.loot || m.loot.length === 0, `${m.id}: 소환수는 전리품이 없어야 함`);
    assert.ok(!m.boss && !m.passive, m.id);
  }
  for (const map of gd.maps.values())
    for (const s of map.spawns) assert.ok(!gd.monsters.get(s.monster)?.summon, `${map.id}: 소환수 ${s.monster} 가 맵에 생성됨`);
});

test('소환수를 모두 불러도 다른 직업 한 명의 몫을 넘지 않는다', () => {
  // 소환수는 소환자 레벨의 몬스터로 계산되므로, 배율을 "같은 레벨 몬스터 몇 마리 몫"으로 더해 상한을 둡니다
  let power = 0;
  let hp = 0;
  for (const a of abilitiesOf('summoner'))
    for (const e of a.effects) {
      if (e.type !== 'summon') continue;
      const def = gd.monsters.get(e.monster)!;
      assert.ok((e.count ?? 1) <= e.max, `${a.id}: 한 번에 부르는 수가 최대 수보다 많음`);
      // 1400ms 는 몬스터의 기본 공격 간격
      power += ((def.dmgMult ?? 1) * e.max * 1400) / (def.attackMs ?? 1400);
      hp += (def.hpMult ?? 1) * e.max;
    }
  assert.ok(power <= 2, `소환수 전체의 공격 ${power.toFixed(2)}마리 몫 (2 이하)`);
  assert.ok(hp <= 7, `소환수 전체의 체력 ${hp.toFixed(2)}마리 몫 (7 이하)`);
  for (const lv of [25, 35, 55, 88, 99]) {
    const pets = petDpsAt(lv);
    const warrior = dpsOf('warrior', lv).base;
    assert.ok(pets <= 0.6 * warrior, `${lv}레벨: 소환수 ${pets.toFixed(0)} / 전사 ${warrior.toFixed(0)}`);
    if (lv >= 35) assert.ok(pets >= 0.25 * warrior, `${lv}레벨: 소환수가 너무 약함 ${pets.toFixed(0)} / 전사 ${warrior.toFixed(0)}`);
  }
});

test('새 근접·원거리 직업의 피해는 기존 직업과 비슷하고, 궁수는 멀리서 쏘는 만큼 전사보다 약하다', () => {
  for (const lv of [25, 55, 88]) {
    const war = dpsOf('warrior', lv);
    const arch = dpsOf('archer', lv);
    assert.ok(arch.base <= 0.9 * war.base, `${lv}레벨 궁수 ${arch.base.toFixed(0)} / 전사 ${war.base.toFixed(0)}`);
    assert.ok(arch.buffed <= 0.9 * war.buffed, `${lv}레벨 궁수(강화) ${arch.buffed.toFixed(0)} / 전사 ${war.buffed.toFixed(0)}`);
  }
  for (let lv = 10; lv <= 99; lv++) {
    for (const k of ['base', 'buffed'] as const) {
      const old = OLD_PHYSICAL.map((c) => dpsOf(c, lv)[k]);
      const best = Math.max(...old);
      const worst = Math.min(...old);
      // 수인은 계통(포유류·조류·파충류)마다 따로: 어느 계통을 골라도 같은 범위 안
      for (const kit of NEW_PHYSICAL.flatMap(kitsOf)) {
        const v = dpsOf(kit, lv)[k];
        // 궁수는 기존 직업 중 가장 센 직업을 넘지 않고, 수인·검투사는 10% 넘게 앞서지 않는다
        const cap = kit.cls === 'archer' ? 1 : 1.1;
        assert.ok(v <= cap * best, `${lv}레벨 ${kit.label}(${k}) ${v.toFixed(0)} / 기존 최고 ${best.toFixed(0)}`);
        assert.ok(v >= 0.8 * worst, `${lv}레벨 ${kit.label}(${k}) ${v.toFixed(0)} / 기존 최저 ${worst.toFixed(0)}`);
      }
    }
  }
});

test('공격·속도 강화와 그룹에 거는 노래는 재사용 대기보다 오래가지 않는다', () => {
  // 지속 시간이 재사용 대기보다 길면 공짜로 계속 켜 둘 수 있어, 직업 고유의 강화 기술이 의미를 잃습니다
  const OFFENSIVE: StatusId[] = ['might', 'focus', 'haste', 'beast'];
  for (const a of gd.abilities.values()) {
    if (a.classId === 'monster') continue;
    for (const e of a.effects) {
      if (e.type !== 'status') continue;
      if (a.targeting === 'party' || (a.targeting === 'self' && OFFENSIVE.includes(e.status)))
        assert.ok(e.durationMs <= a.cooldownMs, `${a.id}: ${e.status} ${e.durationMs / 1000}초 / 재사용 ${a.cooldownMs / 1000}초`);
    }
  }
});

test('후반 공격 마법의 고정 속성은 그 레벨대 몬스터 대부분에게 저항받지 않고, 소환사의 마지막 마법에는 속성이 있다', () => {
  for (const a of gd.abilities.values()) {
    if (a.classId === 'monster' || a.level < 60 || !a.element || a.element === 'weapon' || a.element === 'none') continue;
    if (!a.effects.some((e) => e.type === 'magic')) continue;
    const el = a.element;
    const band = [...gd.monsters.values()].filter((m) => !m.summon && !m.passive && m.level >= a.level - 10 && m.level <= a.level + 20);
    const resisted = band.filter((m) => elementMultiplier(el, m.element ?? 'none') < 1);
    assert.ok(resisted.length * 2 < band.length, `${a.id}(${el}): ${a.level}레벨대 몬스터 ${band.length}종 중 ${resisted.length}종이 저항`);
  }
  // 소환사의 궁극 마법은 목걸이의 공격 속성을 따르거나 속성이 정해져 있다
  const finale = abilitiesOf('summoner').filter((a) => a.level >= 80 && a.effects.some((e) => e.type === 'magic'));
  assert.ok(finale.length > 0);
  for (const a of finale) assert.ok(a.element && a.element !== 'none', `${a.id}: 속성 없음`);
});

test('새 직업 갑옷의 색(게임 속 옷 색)은 서로도, 다른 갑옷과도 겹치지 않는다', () => {
  const armors = [...gd.items.values()].filter((it) => it.slot === 'armor');
  for (const cls of NEW_CLASSES)
    for (const it of gearOf(cls, 'armor')) {
      const same = armors.filter((o) => o !== it && o.icon.color.toLowerCase() === it.icon.color.toLowerCase());
      assert.deepEqual(
        same.map((o) => o.id),
        [],
        `${it.id}: 옷 색 ${it.icon.color}`,
      );
    }
});

test('새 직업마다 마을의 빈 칸에 길드장이 서 있다', () => {
  const town = gd.maps.get('town')!;
  const seen = new Set<string>();
  for (const n of town.npcs) {
    const key = `${n.x},${n.y}`;
    assert.ok(!seen.has(key), `${n.npc}: (${key}) 에 다른 NPC가 있음`);
    seen.add(key);
  }
  const walk = (x: number, y: number) => tileInfo(town.tiles[y]?.[x]).walkable && !seen.has(`${x},${y}`);
  for (const cls of NEW_CLASSES) {
    const masters = [...gd.npcs.values()].filter((n) => n.services.some((s) => s.type === 'class' && s.classId === cls));
    assert.equal(masters.length, 1, `${cls}: 길드장 수`);
    const npc = masters[0]!;
    assert.ok(/[가-힣]/.test(npc.name) && npc.title && npc.greeting, `${npc.id}: 이름/칭호/인사`);
    assert.equal(npc.look.outfit, cls, `${npc.id}: 의상`);
    assert.equal(npc.look.weapon, WEAPON_SHAPE[cls], `${npc.id}: 무기`);
    assert.ok(npc.services.some((s) => s.type === 'talk'), `${npc.id}: 대화`);
    const placed = town.npcs.filter((p) => p.npc === npc.id);
    assert.equal(placed.length, 1, `${npc.id}: 마을 배치`);
    const { x, y } = placed[0]!;
    assert.ok(tileInfo(town.tiles[y]?.[x]).walkable, `${npc.id}: 걸을 수 없는 칸`);
    assert.ok(!(x === town.spawn.x && y === town.spawn.y), `${npc.id}: 시작 지점`);
    for (const w of town.warps) assert.ok(Math.max(Math.abs(w.x - x), Math.abs(w.y - y)) > 1, `${npc.id}: 워프 옆`);
    const open = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => walk(x + dx!, y + dy!)).length;
    assert.ok(open >= 3, `${npc.id}: 주변이 막혀 있음`);
  }
});

test('무기상과 방어구상이 새 직업 장비 1~6단계를 판다', () => {
  const shopItems = (npcId: string): string[] => {
    const s = gd.npcs.get(npcId)!.services.find((x) => x.type === 'shop');
    return s && s.type === 'shop' ? s.items : [];
  };
  const weapons = shopItems('weaponsmith');
  const armors = shopItems('armorsmith');
  for (const cls of NEW_CLASSES) {
    for (let i = 1; i <= 8; i++) {
      assert.equal(weapons.includes(`w_${cls}_${i}`), i <= 6, `무기상 w_${cls}_${i}`);
      assert.equal(armors.includes(`a_${cls}_${i}`), i <= 6, `방어구상 a_${cls}_${i}`);
    }
  }
});

test('기존 직업 장비가 떨어지는 몬스터는 새 직업 장비도 같은 확률로 떨어뜨린다', () => {
  let checked = 0;
  for (const m of gd.monsters.values()) {
    for (const l of m.loot ?? []) {
      const mm = /^([wa])_warrior_(\d)$/.exec(l.item);
      if (!mm) continue;
      for (const cls of NEW_CLASSES) {
        const id: string = `${mm[1]}_${cls}_${mm[2]}`;
        const found: LootEntry | undefined = m.loot!.find((x) => x.item === id);
        assert.ok(found, `${m.id}: ${id} 없음`);
        assert.equal(found.chance, l.chance, `${m.id}: ${id} 확률`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `검사한 전리품 ${checked}개`);
  // 모든 단계의 새 직업 장비를 어딘가에서 얻을 수 있다
  for (const cls of NEW_CLASSES)
    for (let i = 2; i <= 8; i++)
      for (const p of ['w', 'a'])
        assert.ok(
          [...gd.monsters.values()].some((m) => m.loot?.some((l) => l.item === `${p}_${cls}_${i}`)),
          `${p}_${cls}_${i}: 떨어뜨리는 몬스터가 없음`,
        );
});
