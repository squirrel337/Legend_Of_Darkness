// 직업별 게임 데이터(기술·장비·소환수·길드장·상점·전리품)가 서로 맞물리는지 확인합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { ClassId } from '../src/shared/constants';
import { tileInfo } from '../src/shared/tiles';
import type { AbilityDef, ItemDef, LootEntry } from '../src/shared/types';
import { GameData } from '../src/server/gamedata';
import { emptyEquipment, normalizeCharacter, type CharacterData } from '../src/server/storage';
import { bestGearFor, equipError } from '../src/server/systems/character';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);

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
const gearOf = (cls: ClassId, slot: 'weapon' | 'armor'): ItemDef[] =>
  [...gd.items.values()].filter((it) => it.slot === slot && it.classes?.includes(cls)).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

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
    const list = abilitiesOf(cls);
    assert.ok(list.length >= 10 && list.length <= 12, `${cls}: 기술 ${list.length}개`);
    assert.ok(list.filter((a) => a.level <= 12).length >= 2, `${cls}: 12레벨 이하 기술이 2개 미만`);
    assert.ok(list.some((a) => a.level >= 80), `${cls}: 80레벨 이상 기술 없음`);
    for (const a of list) {
      assert.ok(a.id.startsWith(ABILITY_PREFIX[cls]!), `${a.id}: id 접두어`);
      assert.ok(a.fx && FX_KEYS.has(a.fx), `${a.id}: 알 수 없는 fx ${a.fx}`);
      assert.ok(a.desc.length > 0 && /[가-힣]/.test(a.name), `${a.id}: 한글 이름/설명`);
    }
  }
  // 바드의 노래는 그룹 전체에 걸린다
  assert.ok(abilitiesOf('bard').filter((a) => a.targeting === 'party').length >= 4);
  // 수인은 흡혈, 검투사는 연속 베기, 궁수는 멀리서 쏘는 기술이 중심
  assert.ok(abilitiesOf('beastkin').some((a) => a.effects.some((e) => e.type === 'physical' && (e.lifesteal ?? 0) > 0)));
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
