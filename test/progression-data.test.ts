// 성장 체계 데이터: 스킬트리(배치·선수과목·숙련도·재료·계통)가 실제로 배울 수 있게 짜였는지,
// 2차 직업 인도자와 길드장이 마을에 맞게 서 있는지, progression.json 이 설계 문서(docs/progression.md)와 같은지 확인합니다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CLASS_IDS, MAX_ABILITIES, SKILL_GCD_MS, STAT_KEYS, type ClassId, type StatKey } from '../src/shared/constants';
import { autoAllocate, START_STAT } from '../src/shared/formulas';
import {
  classTier,
  FIRST_CLASSES,
  learnStatus,
  profGainChance,
  rebirthName,
  SECOND_CLASSES,
  type FirstClassId,
  type LearnContext,
  type SkillTreeNode,
} from '../src/shared/progression';
import { tileInfo } from '../src/shared/tiles';
import type { AbilityDef } from '../src/shared/types';
import { loadConfig } from '../src/server/config';
import { GameData } from '../src/server/gamedata';

const DIR = path.resolve(import.meta.dirname, '..', 'gamedata');
const gd = GameData.load(DIR);
const cfg = loadConfig({ ADMIN_PASSWORD: 'x', DATA_DIR: os.tmpdir() } as NodeJS.ProcessEnv);
const P = gd.progression;

const needOf = (n: SkillTreeNode): number => n.abilityLevel ?? n.level ?? 0;
const ab = (id: string): AbilityDef => gd.abilities.get(id)!;
const nameOf = (id: string): string => gd.abilities.get(id)?.name ?? id;
/** 트리마다 노드 */
const treeNodes = (cls: ClassId): SkillTreeNode[] => gd.treeOf(cls).nodes;
const allNodes = (): { cls: ClassId; node: SkillTreeNode }[] => CLASS_IDS.flatMap((cls) => treeNodes(cls).map((node) => ({ cls, node })));

/** 숙련도 0 에서 prof 까지 올리는 데 드는 평균 사용 횟수 (오를 확률의 역수 합) */
function usesToReach(prof: number): number {
  let n = 0;
  for (let p = 0; p < prof; p++) n += 1 / profGainChance(p, P.proficiency);
  return n;
}

/** 그 기술을 재사용 대기마다 써서 prof 까지 올리는 데 드는 분 */
const practiceMinutes = (id: string, prof: number): number => (usesToReach(prof) * Math.max(ab(id).cooldownMs, SKILL_GCD_MS)) / 60_000;

/** 직업 비율대로 자동 분배했을 때 그 레벨의 기본 능력치 */
function statsAt(cls: ClassId, level: number): Record<StatKey, number> {
  const add = autoAllocate(gd.classes.get(cls)!.statWeights, (level - 1) * cfg.statPointsPerLevel);
  return Object.fromEntries(STAT_KEYS.map((k) => [k, START_STAT + add[k]])) as Record<StatKey, number>;
}

/**
 * cls 트리에서 배울 수 있는 기술 (조건을 모두 채워 갈 때): 필요 레벨은 최대 레벨, 필요 어빌은 어빌 최대 안,
 * 선수과목은 이미 배운 것(숙련도는 써서 올릴 수 있다고 봄), 능력치는 statsFrom 이 주는 값으로, 수인 계통은 beastType 만.
 */
function learnable(cls: ClassId, inherited: ReadonlySet<string>, beastType: string | null, statsFrom: (n: SkillTreeNode) => Record<StatKey, number>): Set<string> {
  const cap = classTier(cls) === 2 ? P.ability.maxLevel : cfg.maxLevel;
  const known = new Set(inherited);
  for (const n of treeNodes('peasant')) known.add(n.ability);
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of treeNodes(cls)) {
      if (known.has(n.ability) || needOf(n) > cap) continue;
      if (n.beastType !== undefined && n.beastType !== beastType) continue;
      if (!n.requires.every((r) => known.has(r.ability))) continue;
      const stats = statsFrom(n);
      if (!STAT_KEYS.every((k) => (n.stats?.[k] ?? 0) <= stats[k])) continue;
      known.add(n.ability);
      changed = true;
    }
  }
  return known;
}

const firstLearnable = (cls: FirstClassId): Set<string> => learnable(cls, new Set(), null, (n) => statsAt(cls, needOf(n)));

// ───────────────────────── 트리 모양 ─────────────────────────

test('스킬트리: 칸마다 그 직업의 기술, 위 줄일수록 먼저 열리고, 갈래(열)에는 이름이 있다', () => {
  for (const cls of CLASS_IDS) {
    const t = gd.treeOf(cls);
    assert.ok(t.nodes.length > 0, `${cls}: 빈 트리`);
    for (const n of t.nodes) {
      assert.equal(ab(n.ability)?.classId, cls, `${cls}/${n.ability}`);
      if (classTier(cls) === 2) assert.ok(n.abilityLevel !== undefined && n.level === undefined, `${n.ability}: 2차 직업은 필요 어빌`);
      else assert.ok(n.level !== undefined && n.abilityLevel === undefined, `${n.ability}: 필요 레벨`);
    }
    // 줄 = 필요 레벨(어빌) 단계: 먼저 열리는 기술일수록 위에
    for (const a of t.nodes)
      for (const b of t.nodes)
        if (needOf(a) < needOf(b)) assert.ok(a.row < b.row, `${cls}: ${nameOf(a.ability)}(${needOf(a)}) 이 ${nameOf(b.ability)}(${needOf(b)}) 보다 아래 줄`);
    // 갈래 이름이 모든 열에 있고, 이름만 있는 빈 열은 없음
    const cols = Math.max(...t.nodes.map((n) => n.col)) + 1;
    assert.equal(t.columns?.length, cols, `${cls}: 갈래 이름 ${t.columns?.length ?? 0}개 / 열 ${cols}개`);
    for (let c = 0; c < cols; c++) assert.ok(t.nodes.some((n) => n.col === c), `${cls}: ${t.columns![c]} 열이 비어 있음`);
  }
});

test('선수과목: 돌고 돌지 않고, 같은 트리면 먼저 열리는 기술, 다른 트리면 평민이나 이어받는 1차 직업의 기술', () => {
  const graph = new Map(allNodes().map(({ node }) => [node.ability, node.requires.map((r) => r.ability)]));
  // 순환 검사 (깊이 우선)
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    state.set(id, 1);
    for (const next of graph.get(id) ?? []) {
      assert.notEqual(state.get(next), 1, `순환: ${[...trail, id, next].map(nameOf).join(' → ')}`);
      if (!state.has(next)) visit(next, [...trail, id]);
    }
    state.set(id, 2);
  };
  for (const id of graph.keys()) if (!state.has(id)) visit(id, []);

  for (const { cls, node } of allNodes()) {
    for (const r of node.requires) {
      const at = gd.nodeOf(r.ability);
      assert.ok(at, `${node.ability}: 선수과목 ${r.ability} 이 어느 트리에도 없음`);
      assert.ok(r.prof >= 0 && r.prof <= P.proficiency.max, `${node.ability}: 숙련도 ${r.prof}`);
      if (at.classId === cls) {
        // 같은 트리: 먼저 열려 숙련도를 올릴 시간이 있어야 함
        assert.ok(needOf(at.node) < needOf(node), `${nameOf(node.ability)}(${needOf(node)}) ← ${nameOf(r.ability)}(${needOf(at.node)}) 이 먼저 열리지 않음`);
      } else if (at.classId !== 'peasant') {
        // 다른 트리: 2차 직업이 이어받는 1차 직업의 기술만 (그 밖의 직업 기술은 가졌다는 보장이 없음)
        const from: readonly ClassId[] = classTier(cls) === 2 ? P.second.from[cls as (typeof SECOND_CLASSES)[number]] : [];
        assert.ok(from.includes(at.classId), `${cls}/${node.ability}: ${at.classId} 의 기술 ${r.ability} 은 이 직업이 가졌다는 보장이 없음`);
      }
      // 수인 계통 기술은 공통 기술이나 같은 계통 기술만 선수과목으로
      if (node.beastType !== undefined) {
        const bt = at.node.beastType;
        assert.ok(bt === undefined || bt === node.beastType, `${node.ability}(${node.beastType}) ← ${r.ability}(${bt})`);
      }
    }
  }
});

test('원작처럼 차례로 배운다: 1차 직업은 첫 단계(12레벨까지)만 선수과목 없이, 2차 직업의 첫 기술은 이어받은 1차 직업 기술을 선수과목으로', () => {
  for (const cls of FIRST_CLASSES)
    for (const n of treeNodes(cls))
      if (n.requires.length === 0) assert.ok(needOf(n) <= 12, `${cls}: ${nameOf(n.ability)}(${needOf(n)}) 에 선수과목이 없음`);
  for (const cls of SECOND_CLASSES) {
    const nodes = treeNodes(cls);
    for (const n of nodes) assert.ok(n.requires.length > 0, `${cls}: ${nameOf(n.ability)} 에 선수과목이 없음`);
    const first = Math.min(...nodes.map(needOf));
    for (const n of nodes.filter((x) => needOf(x) === first)) {
      const lineage = n.requires.filter((r) => (P.second.from[cls] as readonly ClassId[]).includes(gd.nodeOf(r.ability)!.classId));
      assert.ok(lineage.length > 0, `${cls}: 첫 기술 ${nameOf(n.ability)} 이 1차 직업 기술을 잇지 않음`);
      for (const r of lineage) assert.ok(r.prof >= 30, `${cls}: ${nameOf(r.ability)} 숙련도 ${r.prof} (충분히 익힌 기술을 이어받음)`);
    }
  }
});

/** 승급한 1차 직업이 반드시 배운 기술: 승급 조건의 핵심 기술과, 그것을 배우려고 먼저 배워야 했던 선수과목들 */
function guaranteedOf(cls: FirstClassId): Set<string> {
  const out = new Set<string>();
  const add = (id: string): void => {
    if (out.has(id)) return;
    out.add(id);
    for (const r of gd.nodeOf(id)?.node.requires ?? []) add(r.ability);
  };
  for (const c of P.ascend.conditions[cls]) if (c.type === 'skillProf') add(c.ability);
  return out;
}

test('2차 직업이 잇는 1차 직업 기술은 승급한 사람이면 반드시 배운 것이라, 그 기술을 안 배워서 2차 직업 트리가 막히는 일이 없다', () => {
  // 2차 직업은 1차 직업 기술을 더 배울 수 없으므로, 선수과목은 승급 핵심 기술과 그 선수과목 중에서만 (숙련도는 써서 올릴 수 있음)
  let checked = 0;
  for (const cls of SECOND_CLASSES)
    for (const n of treeNodes(cls))
      for (const r of n.requires) {
        const at = gd.nodeOf(r.ability)!;
        if (at.classId === cls || at.classId === 'peasant') continue;
        checked++;
        for (const from of P.second.from[cls])
          assert.ok(guaranteedOf(from).has(r.ability), `${cls}/${nameOf(n.ability)} ← ${nameOf(r.ability)}: ${from} 이(가) 승급하며 꼭 배우는 기술이 아님`);
      }
  assert.ok(checked >= SECOND_CLASSES.length, `1차 직업 기술을 잇는 선수과목 ${checked}개`);
});

test('필요 숙련도: 단계가 오를수록 높아지고, 재사용 대기가 긴 기술은 연습 시간이 한 시간 남짓을 넘지 않게', () => {
  for (const cls of CLASS_IDS) {
    const nodes = treeNodes(cls);
    const same = (n: SkillTreeNode) => n.requires.filter((r) => gd.nodeOf(r.ability)?.classId === cls);
    for (const n of nodes)
      for (const r of same(n)) {
        const min = practiceMinutes(r.ability, r.prof);
        assert.ok(min <= 75, `${nameOf(n.ability)} ← ${nameOf(r.ability)} ${r.prof}: 연습 ${min.toFixed(0)}분`);
      }
    const linked = nodes.filter((n) => same(n).length > 0);
    if (linked.length === 0) continue;
    // 첫 단계의 선수과목은 가볍게, 마지막 단계(그 트리에서 가장 늦게 열리는 기술)는 깊이 익혀야
    const lo = Math.min(...linked.map(needOf));
    const hi = Math.max(...linked.map(needOf));
    for (const n of linked.filter((x) => needOf(x) === lo)) for (const r of same(n)) assert.ok(r.prof <= 30, `${cls}: 첫 단계 ${nameOf(n.ability)} ← ${r.prof}`);
    const top = Math.max(...linked.filter((x) => needOf(x) === hi).flatMap((n) => same(n).map((r) => r.prof)));
    assert.ok(top >= 70, `${cls}: 마지막 단계의 선수과목 숙련도 ${top}`);
    // 재사용 대기가 짧은 공격 기술끼리 이은 사슬은 단계마다 더 높은 숙련도를 요구
    for (const c of nodes)
      for (const rc of same(c)) {
        const b = gd.nodeOf(rc.ability)!.node;
        for (const rb of same(b)) {
          if (ab(rb.ability).cooldownMs > 10_000 || ab(rc.ability).cooldownMs > 10_000) continue;
          assert.ok(rc.prof > rb.prof, `${cls}: ${nameOf(rb.ability)}(${rb.prof}) → ${nameOf(b.ability)}(${rc.prof}) → ${nameOf(c.ability)}`);
        }
      }
  }
});

// ───────────────────────── 재료 ─────────────────────────

/** 아이템 → 떨어뜨리는 (맵에 나오는) 몬스터의 가장 낮은 레벨. 상점에서 팔면 0 */
function sourceLevel(itemId: string): number | undefined {
  const sold = [...gd.npcs.values()].some((n) => n.services.some((s) => s.type === 'shop' && s.items.includes(itemId)));
  if (sold) return 0;
  const spawned = new Set([...gd.maps.values()].flatMap((m) => m.spawns.filter((s) => s.count > 0).map((s) => s.monster)));
  const levels = [...gd.monsters.values()]
    .filter((m) => spawned.has(m.id) && !m.summon && (m.loot ?? []).some((l) => l.item === itemId && l.chance > 0))
    .map((m) => m.level);
  return levels.length ? Math.min(...levels) : undefined;
}

test('재료는 몬스터가 떨어뜨리거나 상점에서 사고, 1차 직업 재료는 그 레벨 무렵의 사냥터에서 구한다', () => {
  let used = 0;
  for (const { cls, node } of allNodes()) {
    for (const it of node.items) {
      used++;
      const def = gd.items.get(it.item);
      assert.ok(def, `${node.ability}: 재료 ${it.item} 없음`);
      assert.equal(def.type, 'material', `${it.item}: 재료가 아님`);
      assert.ok(it.qty >= 1 && it.qty <= (def.stack ?? 1), `${node.ability}: ${it.item} ${it.qty}개`);
      const lv = sourceLevel(it.item);
      assert.ok(lv !== undefined, `${node.ability}: ${def.name} 을(를) 얻을 곳이 없음`);
      // 1차 직업은 레벨을 올리는 길에 구할 수 있어야 (조금 위 사냥터까지). 2차 직업은 99레벨이라 어디서든
      if (classTier(cls) < 2) assert.ok(lv <= needOf(node) + 5, `${nameOf(node.ability)}(${needOf(node)}): ${def.name} 은 ${lv}레벨 몬스터부터`);
    }
  }
  assert.ok(used >= 60, `재료 조건 ${used}개`);
  // 새 재료 불도마뱀 비늘은 수정 동굴의 불도마뱀이 떨어뜨림
  assert.ok(gd.monsters.get('salamander')!.loot!.some((l) => l.item === 'mat_salamander_scale'));
});

// ───────────────────────── 배울 수 있는 길 ─────────────────────────

test('1차 직업은 최대 레벨 안에 트리를 모두 배우고, 승급의 핵심 기술 2개도 그 안에 있다 (능력치는 직업 비율대로 분배한 값으로)', () => {
  for (const cls of FIRST_CLASSES) {
    const known = firstLearnable(cls);
    for (const n of treeNodes(cls)) assert.ok(known.has(n.ability), `${cls}: ${nameOf(n.ability)} 을(를) 배울 수 없음`);
    const core = P.ascend.conditions[cls].flatMap((c) => (c.type === 'skillProf' ? [c.ability] : []));
    assert.equal(core.length, 2, cls);
    for (const id of core) {
      const at = gd.nodeOf(id);
      assert.equal(at?.classId, cls, `${cls}: 핵심 기술 ${nameOf(id)} 이 이 직업 트리에 없음`);
      assert.ok(needOf(at.node) <= P.ascend.level, `${cls}: ${nameOf(id)} 은 ${needOf(at.node)}레벨`);
      assert.ok(known.has(id));
    }
  }
});

test('2차 직업은 이어받은 1차 직업 기술로 어빌 최대 안에 트리를 모두 배우고, 수인은 계통마다 공통 + 그 계통 기술을 모두 배운다', () => {
  for (const cls of SECOND_CLASSES) {
    for (const from of P.second.from[cls]) {
      const inherited = firstLearnable(from);
      // 2차 직업은 승급한 레벨 그대로: 능력치는 1차 직업 때 분배한 그대로
      const stats = statsAt(from, P.ascend.level);
      const types = cls === 'beastkin' ? P.second.beastTypes.map((b) => b.id) : [null];
      for (const bt of types) {
        const known = learnable(cls, inherited, bt, () => stats);
        for (const n of treeNodes(cls)) {
          const mine = n.beastType === undefined || n.beastType === bt;
          assert.equal(known.has(n.ability), mine, `${from} → ${cls}${bt ? `(${bt})` : ''}: ${nameOf(n.ability)}`);
        }
        // 한 길(평민 → 1차 → 2차)로 배우는 기술·마법은 자리 수 안
        for (const kind of ['skill', 'spell'] as const) {
          const count = [...known].filter((id) => ab(id).kind === kind).length;
          assert.ok(count <= MAX_ABILITIES, `${from} → ${cls}: ${kind} ${count}개`);
        }
      }
    }
  }
});

test('서버와 화면이 함께 쓰는 learnStatus 로 실제 트리를 보면: 돌진은 회오리 베기 숙련도 40과 뼛조각 3개, 수인 계통 기술은 그 계통만', () => {
  const ctx = (o: Partial<LearnContext> & { profs?: Record<string, number>; bag?: Record<string, number> } = {}): LearnContext => {
    const profs = o.profs ?? {};
    const bag = o.bag ?? {};
    return {
      classId: 'warrior',
      level: 25,
      abilityLevel: 0,
      gold: 1_000_000,
      stats: statsAt('warrior', o.level ?? 25),
      beastType: null,
      learnedCount: () => Object.keys(profs).length,
      learned: (id) => id in profs,
      prof: (id) => profs[id] ?? 0,
      itemCount: (id) => bag[id] ?? 0,
      ability: (id) => gd.abilities.get(id),
      itemName: (id) => gd.items.get(id)?.name ?? id,
      beastTypeName: (id) => P.second.beastTypes.find((b) => b.id === id)?.name ?? id,
      ...o,
    };
  };
  const charge = gd.nodeOf('w_charge')!;
  const ready = { profs: { w_strike: 60, w_whirl: 40 }, bag: { mat_bone: 3 } };
  assert.equal(learnStatus('warrior', charge.node, ctx(ready)).learnable, true);
  assert.match(learnStatus('warrior', charge.node, ctx({ ...ready, profs: { w_strike: 60, w_whirl: 39 } })).reason!, /회오리 베기 숙련도 40/);
  assert.match(learnStatus('warrior', charge.node, ctx({ ...ready, bag: { mat_bone: 2 } })).reason!, /뼛조각 3개/);
  assert.match(learnStatus('warrior', charge.node, ctx({ ...ready, level: 24 })).reason!, /레벨 25/);
  // 수인: 어빌로 배우고, 계통 기술은 그 계통만 (공통 기술은 누구나)
  const beast = (beastType: string, id: string) =>
    learnStatus('beastkin', gd.nodeOf(id)!.node, ctx({ classId: 'beastkin', level: 99, abilityLevel: 25, beastType, profs: { k_beast: 10 }, bag: { mat_fang: 5, mat_bat_wing: 5, mat_salamander_scale: 3 } }));
  assert.equal(beast('mammal', 'k_pounce').learnable, true);
  assert.equal(beast('bird', 'k_dive').learnable, true);
  assert.equal(beast('reptile', 'k_venom').learnable, true);
  assert.match(beast('bird', 'k_pounce').reason!, /포유류 계통/);
  assert.match(beast('mammal', 'k_venom').reason!, /파충류 계통/);
});

test('수인 계통: 계통마다 같은 레벨·가격 칸의 줄이 야수화에서 갈라져 그 계통 안에서 끝까지 이어진다', () => {
  const nodes = treeNodes('beastkin');
  const lines = P.second.beastTypes.map((b) => ({ ...b, nodes: nodes.filter((n) => n.beastType === b.id).sort((x, y) => needOf(x) - needOf(y)) }));
  const slots = (list: SkillTreeNode[]) => list.map((n) => `${needOf(n)}:${n.gold}`).join(',');
  for (const line of lines) {
    assert.ok(line.nodes.length >= 4, `${line.name}: 계통 기술 ${line.nodes.length}개`);
    assert.equal(slots(line.nodes), slots(lines[0]!.nodes), `${line.name}: 레벨·가격 칸이 ${lines[0]!.name} 과 다름`);
    // 한 열에 위에서 아래로 한 줄
    assert.equal(new Set(line.nodes.map((n) => n.col)).size, 1, `${line.name}: 여러 열에 흩어짐`);
    line.nodes.forEach((n, i) => {
      assert.equal(ab(n.ability).classId, 'beastkin');
      if (i === 0) {
        // 줄의 시작은 공통 기술(야수화)에서
        assert.deepEqual(
          n.requires.map((r) => r.ability),
          ['k_beast'],
          `${line.name}: 첫 기술 ${nameOf(n.ability)}`,
        );
      } else assert.ok(n.requires.some((r) => r.ability === line.nodes[i - 1]!.ability), `${line.name}: ${nameOf(n.ability)} 이 앞 기술을 잇지 않음`);
    });
  }
  // 공통 기술에는 계통이 없고, 계통 줄은 서로 다른 열
  assert.equal(new Set(lines.map((l) => l.nodes[0]!.col)).size, lines.length);
  const common = nodes.filter((n) => n.beastType === undefined);
  assert.ok(common.length >= 5, `공통 기술 ${common.length}개`);
  for (const n of common) for (const l of lines) assert.notEqual(n.col, l.nodes[0]!.col, `${nameOf(n.ability)} 이 ${l.name} 열에 있음`);
});

// ───────────────────────── NPC ─────────────────────────

test('2차 직업 인도자: 하나뿐이고, 신전 안 승급 장인 곁의 빈 칸에 서 있으며 마을 어디서든 갈 수 있다', () => {
  const guides = [...gd.npcs.values()].filter((n) => n.services.some((s) => s.type === 'secondJob'));
  assert.equal(guides.length, 1, '2차 직업 인도자 수');
  const guide = guides[0]!;
  assert.equal(guide.title, '2차 직업 인도자');
  assert.ok(/[가-힣]/.test(guide.name) && guide.greeting.length > 0);
  assert.ok(guide.services.some((s) => s.type === 'talk'), '2차 전직 안내');
  const town = gd.maps.get('town')!;
  const placed = town.npcs.filter((p) => p.npc === guide.id);
  assert.equal(placed.length, 1, '마을 배치');
  const { x, y } = placed[0]!;
  // 신전 안: 승급 장인과 같은 바닥(대리석)에서 세 칸 안
  const ascend = town.npcs.find((p) => gd.npcs.get(p.npc)!.services.some((s) => s.type === 'ascend'))!;
  assert.ok(Math.max(Math.abs(ascend.x - x), Math.abs(ascend.y - y)) <= 3, `승급 장인(${ascend.x},${ascend.y}) 과 (${x},${y})`);
  assert.equal(town.tiles[y]![x], town.tiles[ascend.y]![ascend.x], '승급 장인과 같은 바닥');
  for (const w of town.warps) assert.ok(Math.max(Math.abs(w.x - x), Math.abs(w.y - y)) > 1, '워프 옆');
  // NPC 가 선 칸은 지나갈 수 없음: 그래도 걸을 수 있는 칸은 모두 이어져 있고, 모든 NPC 옆에 설 수 있어야
  const H = town.tiles.length;
  const W = town.tiles[0]!.length;
  const npcAt = new Set(town.npcs.map((n) => `${n.x},${n.y}`));
  assert.equal(npcAt.size, town.npcs.length, '같은 칸에 NPC 둘');
  const open = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < W && cy < H && tileInfo(town.tiles[cy]![cx]).walkable && !npcAt.has(`${cx},${cy}`);
  const near = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  assert.ok(near.filter(([dx, dy]) => open(x + dx, y + dy)).length >= 3, '인도자 주변이 막힘');
  const seen = new Set([`${town.spawn.x},${town.spawn.y}`]);
  const q: [number, number][] = [[town.spawn.x, town.spawn.y]];
  while (q.length) {
    const [cx, cy] = q.pop()!;
    for (const [dx, dy] of near) {
      const k = `${cx + dx},${cy + dy}`;
      if (open(cx + dx, cy + dy) && !seen.has(k)) {
        seen.add(k);
        q.push([cx + dx, cy + dy]);
      }
    }
  }
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) if (open(cx, cy)) assert.ok(seen.has(`${cx},${cy}`), `(${cx},${cy}) 에 갈 수 없음`);
  for (const n of town.npcs) assert.ok(near.some(([dx, dy]) => seen.has(`${n.x + dx},${n.y + dy}`)), `${n.npc} 옆에 설 수 없음`);
});

test('길드장: 1차 직업 길드장은 전직(무도가는 환골탈태)을 안내하고, 2차 직업 길드장은 그 직업 기술을 가르치며 인도자를 알려 준다', () => {
  const guide = [...gd.npcs.values()].find((n) => n.services.some((s) => s.type === 'secondJob'))!;
  const masterOf = (cls: ClassId) => {
    const list = [...gd.npcs.values()].filter((n) => n.services.some((s) => s.type === 'class' && s.classId === cls));
    assert.equal(list.length, 1, `${cls}: 길드장 수`);
    return list[0]!;
  };
  const talks = (n: ReturnType<typeof masterOf>) => n.services.flatMap((s) => (s.type === 'talk' ? [s] : []));
  for (const cls of FIRST_CLASSES) {
    const m = masterOf(cls);
    const name = rebirthName(cls, P);
    const t = talks(m).find((s) => s.label.includes(name));
    assert.ok(t, `${m.name}: ${name} 안내가 없음`);
    assert.ok(t.text.includes('99레벨'), `${m.name}: ${name} 레벨`);
  }
  for (const cls of SECOND_CLASSES) {
    const m = masterOf(cls);
    assert.equal(m.look.outfit, cls);
    assert.ok(
      talks(m).some((s) => s.text.includes(guide.name) && s.text.includes('어빌')),
      `${m.name}: 2차 전직은 ${guide.name}에게, 기술은 어빌로 배운다는 안내`,
    );
  }
  // 수인 족장은 계통마다 배우는 기술을 알려 줌
  const beast = talks(masterOf('beastkin')).map((s) => s.text).join('\n');
  for (const n of treeNodes('beastkin').filter((x) => x.beastType)) assert.ok(beast.includes(nameOf(n.ability)), `수인 족장: ${nameOf(n.ability)}`);
});

// ───────────────────────── 설계 문서 ─────────────────────────

/** "14,000" → 14000, "1억" → 1억, "2억 5천만" → 2억 5천만 */
function koNumber(s: string): number {
  const t = s.replace(/,/g, '').replace(/\s+/g, '');
  let v = 0;
  let rest = t;
  const eok = /^(\d+)억/.exec(rest);
  if (eok) {
    v += Number(eok[1]) * 100_000_000;
    rest = rest.slice(eok[0].length);
  }
  const cheonman = /^(\d+)천만/.exec(rest);
  if (cheonman) {
    v += Number(cheonman[1]) * 10_000_000;
    rest = rest.slice(cheonman[0].length);
  }
  const man = /^(\d+)만/.exec(rest);
  if (man) {
    v += Number(man[1]) * 10_000;
    rest = rest.slice(man[0].length);
  }
  if (rest) v += Number(rest);
  assert.ok(Number.isFinite(v), `숫자 ${s}`);
  return v;
}

/** 문서에서 heading 으로 시작하는 절의 첫 표 (머리 줄 다음의 줄들을 칸으로 나눔) */
function tableAfter(doc: string, heading: string): string[][] {
  const lines = doc.split('\n');
  const at = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(at >= 0, `문서에 ${heading} 절이 없음`);
  const start = lines.findIndex((l, i) => i > at && l.startsWith('|'));
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i++)
    rows.push(
      lines[i]!.split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  return rows;
}

test('progression.json 의 수치는 설계 문서(docs/progression.md)의 표·규칙과 같다', () => {
  const doc = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'docs', 'progression.md'), 'utf8');
  const classByName = (s: string): ClassId => {
    const name = s.replace(/\(.*?\)/g, '').trim();
    const c = [...gd.classes.values()].find((x) => x.name === name);
    assert.ok(c, `문서의 직업 이름 ${s}`);
    return c.id;
  };
  const pure = (list: (typeof P.rebirth.conditions)['warrior']) => ({
    hp: list.find((c) => c.type === 'pureHp')?.min,
    mp: list.find((c) => c.type === 'pureMp')?.min,
    exp: list.find((c) => c.type === 'exp')?.min,
  });
  // 1. 직업 계통: 1차 → 2차
  const lineage = tableAfter(doc, '## 1.');
  assert.equal(lineage.length, SECOND_CLASSES.length);
  for (const [first, second] of lineage) assert.deepEqual(P.second.from[classByName(second!) as (typeof SECOND_CLASSES)[number]], [classByName(first!)]);
  // 2. 전직 조건
  const rebirth = tableAfter(doc, '## 2.');
  assert.equal(rebirth.length, FIRST_CLASSES.length);
  for (const [cls, hp, mp, exp] of rebirth) {
    const id = classByName(cls!) as FirstClassId;
    assert.deepEqual(pure(P.rebirth.conditions[id]), { hp: koNumber(hp!), mp: koNumber(mp!), exp: koNumber(exp!) }, `전직 ${cls}`);
  }
  // 3. 승급 조건과 핵심 기술
  const ascend = tableAfter(doc, '## 3.');
  assert.equal(ascend.length, FIRST_CLASSES.length);
  for (const [cls, hp, mp, skills] of ascend) {
    const id = classByName(cls!) as FirstClassId;
    const conds = P.ascend.conditions[id];
    assert.deepEqual({ hp: pure(conds).hp, mp: pure(conds).mp }, { hp: koNumber(hp!), mp: koNumber(mp!) }, `승급 ${cls}`);
    const names = skills!.replace(/\(.*?\)/g, '').split(',').map((s) => s.trim());
    assert.deepEqual(
      conds.flatMap((c) => (c.type === 'skillProf' ? [nameOf(c.ability)] : [])),
      names,
      `승급 핵심 기술 ${cls}`,
    );
  }
  // 본문의 규칙 수치
  const has = (re: RegExp) => assert.match(doc, re);
  has(new RegExp(`보유 경험치 ${'1억'} \\(써서 없어짐\\)`));
  assert.ok(FIRST_CLASSES.every((c) => pure(P.rebirth.conditions[c]).exp === 100_000_000));
  has(/보유 경험치 2억 5천만 \(써서 없어짐\)/);
  assert.ok(FIRST_CLASSES.every((c) => pure(P.ascend.conditions[c]).exp === 250_000_000));
  has(/경험치 50만 → 체력 \+100 또는 마나 \+50/);
  assert.deepEqual(P.ascend.expTrade, { exp: koNumber('50만'), hp: 100, mp: 50 });
  has(/최대 체력 150을 팔아 능력치 1을 삽니다/);
  assert.deepEqual(P.ascend.hpToStat, { hp: 150, stat: 1 });
  has(/칭호가 "마스터"/);
  assert.equal(P.ascend.title, '마스터');
  has(/보유 경험치 10억, 순수 체력 500·마력 500 을 바침/);
  for (const c of SECOND_CLASSES) {
    const conds = P.second.conditions[c];
    assert.ok(conds.some((x) => x.type === 'ascended'));
    assert.ok(conds.some((x) => x.type === 'exp' && x.min === koNumber('10억') && x.consume));
    assert.ok(conds.some((x) => x.type === 'payHp' && x.amount === 500));
    assert.ok(conds.some((x) => x.type === 'payMp' && x.amount === 500));
  }
  has(/몬스터 경험치의 일정 비율\(기본 25%\)/);
  assert.equal(P.ability.expRatio, 0.25);
  has(/최대 체력 \+30, 최대 마나 \+15/);
  assert.deepEqual([P.ability.hpPerLevel, P.ability.mpPerLevel, P.ability.maxLevel], [30, 15, 99]);
  has(/max\(3%, 35% × \(1 − 0\.8 × 숙련도\/100\)\)/);
  assert.deepEqual([P.proficiency.minChance, P.proficiency.baseChance, P.proficiency.slowdown, P.proficiency.max], [0.03, 0.35, 0.8, 100]);
  has(/70%\(숙련도 0\)에서 115%\(숙련도 100\)/);
  assert.deepEqual([P.proficiency.effectMin, P.proficiency.effectMax], [0.7, 1.15]);
  has(/수인 \(포유류 · 조류 · 파충류 중 하나/);
  assert.deepEqual(
    P.second.beastTypes.map((b) => b.name),
    ['포유류', '조류', '파충류'],
  );
  has(/승급한 뒤에는 전직할 수 없습니다/);
  assert.equal(P.rebirth.allowAfterAscend, false);
});
