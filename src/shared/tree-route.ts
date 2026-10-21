// 스킬트리 그림(게임 안 K 창, 관리자 편집기)의 선수과목 선이 다른 칸을 지나가지 않게 하는 도우미.
// 선이 다른 칸 뒤로 지나가면 그 칸에서 나온 선처럼 보여 선수과목을 잘못 읽게 되므로,
// 곧은 곡선이 다른 칸에 걸리면 칸이 없는 줄 사이 틈과 열 사이 길로 돌아가게 그립니다.

export interface Pt {
  x: number;
  y: number;
}

/** 피해야 할 자리 (왼쪽 위 + 크기) */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** SVG path(M·L·C 만)를 따라 촘촘하게 찍은 점들 */
export function samplePath(d: string): Pt[] {
  const tok = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cmd = '';
  let cur: Pt = { x: 0, y: 0 };
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/^[MLC]$/.test(tok[i]!)) cmd = tok[i++]!;
    if (cmd === 'M') {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === 'L') {
      const p = { x: num(), y: num() };
      const n = Math.max(2, Math.ceil(Math.hypot(p.x - cur.x, p.y - cur.y) / 3));
      for (let k = 1; k <= n; k++) pts.push({ x: cur.x + ((p.x - cur.x) * k) / n, y: cur.y + ((p.y - cur.y) * k) / n });
      cur = p;
    } else if (cmd === 'C') {
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      const p3 = { x: num(), y: num() };
      for (let k = 1; k <= 40; k++) {
        const t = k / 40;
        const u = 1 - t;
        pts.push({
          x: u * u * u * cur.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * cur.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
      cur = p3;
    } else break;
  }
  return pts;
}

/** 선이 상자 하나라도 지나가는지 */
export function pathHits(d: string, boxes: readonly Box[]): boolean {
  if (boxes.length === 0) return false;
  return samplePath(d).some((p) => boxes.some((b) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h));
}

const round = (v: number) => Math.round(v * 10) / 10;

/** 꺾은선을 모서리가 둥근(반지름 r) path 로. 같은 점이 이어지면 하나로 봅니다 */
export function roundedPath(points: readonly Pt[], r: number): string {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  if (pts.length === 0) return '';
  let d = `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i]!;
    const next = pts[i + 1];
    if (!next) {
      d += ` L ${round(v.x)} ${round(v.y)}`;
      break;
    }
    const prev = pts[i - 1]!;
    const lin = Math.hypot(v.x - prev.x, v.y - prev.y);
    const lout = Math.hypot(next.x - v.x, next.y - v.y);
    const rr = Math.min(r, lin / 2, lout / 2);
    const s = { x: v.x - ((v.x - prev.x) / lin) * rr, y: v.y - ((v.y - prev.y) / lin) * rr };
    const e = { x: v.x + ((next.x - v.x) / lout) * rr, y: v.y + ((next.y - v.y) / lout) * rr };
    d += ` L ${round(s.x)} ${round(s.y)} C ${round(v.x)} ${round(v.y)}, ${round(v.x)} ${round(v.y)}, ${round(e.x)} ${round(e.y)}`;
  }
  return d;
}

/**
 * 돌아가는 선의 꺾는 점: 출발점 → 출발 칸 밑(위)의 줄 사이 틈(gapA) → (줄을 건너뛰면) 도착 칸 옆의 열 사이 길(lane)을 따라
 * 도착 칸 위(아래)의 틈(gapB)까지 → 도착 칸 가운데 위로 → 도착점. 틈과 길에는 칸이 없으므로 다른 칸을 지나지 않습니다.
 * 같은 줄이면 gapA === gapB (줄 위의 틈) 로 줍니다.
 */
export function detourPoints(start: Pt, gapA: number, end: Pt, gapB: number, lane: number): Pt[] {
  const pts: Pt[] = [start, { x: start.x, y: gapA }];
  if (gapA !== gapB) pts.push({ x: lane, y: gapA }, { x: lane, y: gapB });
  pts.push({ x: end.x, y: gapB }, end);
  return pts;
}
