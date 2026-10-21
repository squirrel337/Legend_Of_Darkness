// 관리자 편집기 격자의 선수과목 화살표: 다른 노드 뒤로 지나가 그 노드에서 나온 화살표처럼 보이지 않게 돌아가는지.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cellPos, COLW, edgeRoute, NH, nodeBox, NW } from '../src/admin/design/grid';
import type { SkillTreeNode, SkillTreesConfig } from '../src/shared/progression';
import { samplePath } from '../src/shared/tree-route';
import { ROOT } from './helpers';

/** 화살표가 지나가는 다른 노드 */
function crossed(nodes: readonly SkillTreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    for (const r of n.requires ?? []) {
      const p = nodes.find((x) => x.ability === r.ability);
      if (!p) continue;
      const others = nodes.filter((x) => x !== p && x !== n);
      const pts = samplePath(edgeRoute(cellPos(p.row, p.col), cellPos(n.row, n.col), others.map((x) => nodeBox(cellPos(x.row, x.col)))).d);
      for (const o of others) {
        const b = cellPos(o.row, o.col);
        if (pts.some((q) => q.x > b.x && q.x < b.x + NW && q.y > b.y && q.y < b.y + NH)) out.push(`${p.ability}→${n.ability} 이(가) ${o.ability}`);
      }
    }
  }
  return out;
}

const node = (ability: string, row: number, col: number, requires: { ability: string; prof: number }[] = []): SkillTreeNode => ({
  ability,
  row,
  col,
  level: 1,
  gold: 0,
  items: [],
  requires,
});

test('편집기 화살표: 곧은 곡선이 다른 노드 뒤로 지나가면 줄 사이 틈과 열 사이 길로 돌아 뒤 노드 위로 들어간다', () => {
  const nodes = [node('strike', 0, 0), node('whirl', 1, 0, [{ ability: 'strike', prof: 20 }]), node('shout', 2, 2, [{ ability: 'strike', prof: 30 }])];
  const a = cellPos(0, 0);
  const b = cellPos(2, 2);
  const straight = edgeRoute(a, b);
  const whirl = cellPos(1, 0);
  assert.ok(
    samplePath(straight.d).some((q) => q.x > whirl.x && q.x < whirl.x + NW && q.y > whirl.y && q.y < whirl.y + NH),
    '곧은 곡선은 회오리 베기 노드를 지남',
  );
  const route = edgeRoute(a, b, [nodeBox(whirl)]);
  assert.notEqual(route.d, straight.d);
  assert.deepEqual(crossed(nodes), []);
  // 뒤 노드(열 2) 왼쪽의 열 사이 길을 지나 뒤 노드 위쪽 가운데로 (화살촉이 아래를 향하게 마지막은 곧게 내려감)
  const lane = b.x + NW / 2 - COLW / 2;
  assert.ok(route.d.includes(`L ${lane} `), route.d);
  assert.ok(route.d.endsWith(`L ${b.x + NW / 2} ${b.y - 1}`), route.d);
  // 숙련도 글씨는 뒤 노드 바로 위
  assert.equal(route.label[0], b.x + NW / 2);
  assert.ok(route.label[1] < b.y && route.label[1] > b.y - (cellPos(1, 0).y - cellPos(0, 0).y) / 2);
  // 가로막는 노드가 없으면 그대로 곧은 곡선
  assert.equal(edgeRoute(a, b, [nodeBox(cellPos(0, 3))]).d, straight.d);
});

test('편집기 화살표: 돌아가는 화살표 둘이 같은 길을 쓰면 비켜 나란히 간다', () => {
  const nodes = [
    node('strike', 0, 0),
    node('whirl', 1, 0, [{ ability: 'strike', prof: 20 }]),
    node('shout', 2, 1, [
      { ability: 'strike', prof: 30 },
      { ability: 'whirl', prof: 20 },
    ]),
    node('charge', 3, 1, [{ ability: 'whirl', prof: 40 }]),
  ];
  assert.deepEqual(crossed(nodes), []);
  const laneUse = new Map<number, number>();
  const boxes = (except: string[]) => nodes.filter((x) => !except.includes(x.ability)).map((x) => nodeBox(cellPos(x.row, x.col)));
  const r1 = edgeRoute(cellPos(0, 0), cellPos(2, 1), boxes(['strike', 'shout']), laneUse);
  const r2 = edgeRoute(cellPos(1, 0), cellPos(3, 1), boxes(['whirl', 'charge']), laneUse);
  const lane = cellPos(2, 1).x + NW / 2 - COLW / 2;
  assert.ok(r1.d.includes(`L ${lane} `), r1.d);
  assert.ok(!r2.d.includes(`L ${lane} `), r2.d);
  assert.ok(r2.d.includes(`L ${lane - 4} `), r2.d);
});

test('편집기 화살표: 실제 스킬트리의 모든 직업에서 다른 노드를 지나지 않는다', () => {
  const trees = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamedata', 'skilltrees.json'), 'utf8')) as SkillTreesConfig;
  for (const [cls, tree] of Object.entries(trees.trees)) assert.deepEqual(crossed(tree.nodes), [], cls);
});
