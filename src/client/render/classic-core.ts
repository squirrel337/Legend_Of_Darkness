// 고전 도트 캐릭터 프레임 캐시의 순수한 부분 (DOM 없음, 테스트용):
// 자세 → 그림 번호 양자화, 겉모습 서명, 개수 제한 LRU 캐시.
import type { Dir } from '../../shared/constants';
import type { HumanLook } from '../../shared/types';
import { CLASSIC_FRAMES_PER_ANIM, type ClassicAnim, type ClassicFrame } from './classic-kit';

/** chibi.ts 의 ChibiPose 와 같은 모양 (그쪽 형식을 그대로 받음) */
export interface ClassicPose {
  dir: Dir;
  /** 걷기 진행 (0~1, 걷지 않으면 null) */
  walk: number | null;
  /** 걸음마다 0/1 번갈아 */
  step?: number;
  /** 행동 진행 (0~1, 없으면 null) */
  act: number | null;
  actKind?: 'attack' | 'cast' | 'skill';
  time: number;
  ghost?: boolean;
  beast?: boolean;
}

/** 숨쉬기 한 주기 (밀리초) */
export const CLASSIC_IDLE_MS = 2400;

/** 유령이 떠오르는 높이 (CSS px) */
export function classicGhostFloat(time: number): number {
  return 3 + Math.sin(time / 380) * 1.6;
}

export interface QuantizedPose {
  frame: ClassicFrame;
  /** 왼쪽을 봄 (좌우 뒤집어 그림) */
  flip: boolean;
  /** 캐시 열쇠 (겉모습 서명 제외) */
  key: string;
}

const frameOf = (t: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(t * n)));

/**
 * 자세를 몇 장의 그림으로 나눕니다.
 * - 앞(dir 1, 2) / 뒤(dir 0, 3), 왼쪽(dir 2, 3)은 뒤집기
 * - 행동: 진행 0~1 → 4장 (공격 / 시전 / 기술)
 * - 걷기: 두 칸(step 0, 1)에 걸쳐 4장 (발 하나씩 내딛기)
 * - 가만히: 숨쉬기 4장
 * - 유령은 늘 가만히 자세 (떠오르기는 그릴 때)
 */
export function quantizePose(p: ClassicPose): QuantizedPose {
  const front = p.dir === 1 || p.dir === 2;
  const flip = p.dir === 2 || p.dir === 3;
  const ghost = p.ghost === true;
  const beast = p.beast === true && !ghost;
  let anim: ClassicAnim;
  let f: number;
  if (p.act !== null && p.act !== undefined && !ghost) {
    anim = p.actKind === 'cast' ? 'cast' : p.actKind === 'skill' ? 'skill' : 'attack';
    f = frameOf(clamp01(p.act), CLASSIC_FRAMES_PER_ANIM);
  } else if (p.walk !== null && p.walk !== undefined && !ghost) {
    anim = 'walk';
    const step = (p.step ?? 0) & 1;
    f = frameOf((step + clamp01(p.walk)) / 2, CLASSIC_FRAMES_PER_ANIM);
  } else {
    anim = 'idle';
    const t = (((p.time % CLASSIC_IDLE_MS) + CLASSIC_IDLE_MS) % CLASSIC_IDLE_MS) / CLASSIC_IDLE_MS;
    f = frameOf(Number.isFinite(t) ? t : 0, CLASSIC_FRAMES_PER_ANIM);
  }
  const view = front ? 'F' : 'B';
  const frame: ClassicFrame = { view, anim, f, ghost, beast };
  return { frame, flip, key: `${view}${anim[0]}${f}${beast ? 'x' : ''}${ghost ? 'g' : ''}` };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v >= 1 ? 0.999999 : v) : 0;
}

const sigs = new WeakMap<HumanLook, string>();

/** 그림을 바꾸는 겉모습 값만 모은 서명 (색은 소문자로) */
export function lookSignature(look: HumanLook): string {
  let s = sigs.get(look);
  if (s === undefined) {
    const c = (v: string | undefined) => (v ? v.trim().toLowerCase() : '-');
    s = [
      look.gender === 'f' ? 'f' : 'm',
      Number.isFinite(look.hairStyle) ? Math.trunc(look.hairStyle) : 0,
      c(look.hairColor),
      c(look.body),
      c(look.body2),
      look.outfit ?? '-',
      look.weapon ?? '-',
      c(look.weaponColor),
      c(look.helmet),
      c(look.shield),
    ].join('|');
    sigs.set(look, s);
  }
  return s;
}

/** 개수로 제한하는 LRU 캐시 (Map 의 넣은 순서를 씀) */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  /** 꺼내면서 가장 최근으로 */
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
