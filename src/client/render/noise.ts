// 결정적 잡음 도우미: 정수 해시, 시드 난수, 이어 붙여도 이음매가 없는 주기 값 잡음.
// DOM 을 쓰지 않으므로 서버 쪽 테스트에서도 그대로 불러올 수 있습니다.

/** 정수 좌표 → 32비트 해시 (같은 입력이면 언제나 같은 값) */
export function hashU32(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

/** 정수 좌표 → 0~1 */
export function hash01(x: number, y: number, seed = 0): number {
  return hashU32(x, y, seed) / 4294967296;
}

/** 시드 난수 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * w×h 크기의 주기 값 잡음 (0~1). 격자 간격 cx, cy 는 w, h 의 약수여야 합니다.
 * 오른쪽 끝과 왼쪽 끝, 위와 아래가 그대로 이어집니다.
 */
export function periodicNoise(w: number, h: number, cx: number, cy: number, seed: number): Float32Array {
  const gx = Math.max(1, Math.round(w / cx));
  const gy = Math.max(1, Math.round(h / cy));
  const lat = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) lat[j * gx + i] = hash01(i, j, seed);
  // 가로 보간 자리와 무게는 줄과 상관없으므로 한 번만 계산
  const ia = new Int32Array(w);
  const ib = new Int32Array(w);
  const tw = new Float32Array(w);
  const sx = gx / w;
  for (let x = 0; x < w; x++) {
    const fx = x * sx;
    const i0 = Math.floor(fx);
    ia[x] = i0 % gx;
    ib[x] = (i0 + 1) % gx;
    tw[x] = smooth(fx - i0);
  }
  const out = new Float32Array(w * h);
  const sy = gy / h;
  const row0 = new Float32Array(gx);
  for (let y = 0; y < h; y++) {
    const fy = y * sy;
    const j0 = Math.floor(fy);
    const ty = smooth(fy - j0);
    const r0 = (j0 % gy) * gx;
    const r1 = ((j0 + 1) % gy) * gx;
    // 이 줄의 격자 값 (세로 보간을 먼저)
    for (let i = 0; i < gx; i++) row0[i] = lat[r0 + i]! + (lat[r1 + i]! - lat[r0 + i]!) * ty;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = row0[ia[x]!]!;
      out[o + x] = a + (row0[ib[x]!]! - a) * tw[x]!;
    }
  }
  return out;
}
