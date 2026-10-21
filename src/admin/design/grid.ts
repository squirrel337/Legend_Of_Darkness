// 스킬트리 편집 격자의 크기와 선수과목 화살표 길 (DOM 없이, test/admin-design-grid.test.ts 가 확인).
import { detourPoints, pathHits, roundedPath, type Box } from '../../shared/tree-route';

// 격자 크기 (px)
export const COLW = 160;
export const ROWH = 112;
export const GUT = 92;
export const TOP = 30;
export const NW = 144;
export const NH = 66;

/** 노드 왼쪽 위 좌표 */
export const cellPos = (row: number, col: number) => ({ x: GUT + col * COLW + (COLW - NW) / 2, y: TOP + row * ROWH + (ROWH - NH) / 2 });

/** 화살표가 피해야 할 노드 자리 (아래의 잇는 점 포함) */
export function nodeBox(p: { x: number; y: number }): Box {
  return { x: p.x - 4, y: p.y - 4, w: NW + 8, h: NH + 16 };
}

/** 선수과목 화살표의 베지어 조절점: 앞 노드 아래의 잇는 점 밑에서 시작해 뒤 노드 위쪽 가운데로 */
function edgeCurve(a: { x: number; y: number }, b: { x: number; y: number }): [number, number][] {
  const sx = a.x + NW / 2;
  const sy = a.y + NH + 8;
  const tx = b.x + NW / 2;
  const ty = b.y - 1;
  const dy = Math.max(28, Math.abs(ty - sy) / 2);
  return [
    [sx, sy],
    [sx, sy + dy],
    [tx, ty - dy],
    [tx, ty],
  ];
}

/** 곡선 위 t (0~1) 자리 */
function curvePoint(c: [number, number][], t: number): [number, number] {
  const [p0, p1, p2, p3] = c as [[number, number], [number, number], [number, number], [number, number]];
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [f(0), f(1)];
}

/**
 * 선수과목 화살표: 앞 노드 아래의 잇는 점에서 뒤 노드 위쪽 가운데로 휘어 들어가는 곡선.
 * 이 곡선이 다른 노드(others) 뒤로 지나가면 그 노드에서 나온 화살표처럼 보이므로, 앞 노드 밑의 줄 사이 틈 →
 * 뒤 노드 옆(앞 노드 쪽)의 열 사이 길 → 뒤 노드 위의 틈으로 돌아 들어갑니다 (틈과 길에는 노드가 없음).
 * label 은 필요 숙련도 글씨 자리: 뒤 노드 가까이, 한 기술에서 여러 갈래로 나가도 글씨가 겹치지 않게.
 */
export function edgeRoute(a: { x: number; y: number }, b: { x: number; y: number }, others: readonly Box[] = []): { d: string; label: [number, number] } {
  const c = edgeCurve(a, b);
  const [p0, p1, p2, p3] = c as [[number, number], [number, number], [number, number], [number, number]];
  const d = `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
  if (!pathHits(d, others)) return { d, label: curvePoint(c, 0.66) };
  const gap = (ROWH - NH) / 2;
  const ax = a.x + NW / 2;
  const bx = b.x + NW / 2;
  const gapA = a.y + NH + gap;
  const gapB = b.y - gap;
  const lane = bx + (ax < bx ? -1 : 1) * (COLW / 2);
  const pts = detourPoints({ x: ax, y: p0[1] }, gapA, { x: bx, y: p3[1] }, gapB, lane);
  return { d: roundedPath(pts, 10), label: [bx, gapB + (b.y - gapB) / 2] };
}
