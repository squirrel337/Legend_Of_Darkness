// 굽기 일꾼: 바닥 조각과 벽·나무·물체 그림을 화면 밖 작업자(Web Worker)에서 굽고, 다 되면 받아서 넘깁니다.
// 그림 하나를 굽는 데 수십 ms 가 걸려도 게임 화면이 멈추지 않게 합니다 (처음 가는 맵, 순간이동,
// 걸으며 처음 보는 물체). 일마다 우선순위가 있어 화면에 보이는 것을 먼저, 둘레 조각·맵 전체 미리 굽기는 나중에 합니다.
// 작업자를 쓸 수 없으면(오래된 브라우저, 시험) async 가 false 이고, 요청한 쪽이 그 자리에서 굽습니다.
import { pixelsToCanvas, type BakeJob, type BakeMap, type BakedImage, type FromWorker, type ToWorker } from './bake-types';

/** 작업자 수 상한 (코어가 넉넉해도 둘이면 맵 하나를 1초 안에 다 구움) */
const MAX_WORKERS = 2;
/**
 * 작업자마다 한꺼번에 맡겨 두는 일 수. 결과는 게임 화면이 프레임 사이에 받으므로 조금씩 맡기면 작업자가
 * 프레임마다 쉬게 됨 (벽 그림 하나는 1ms 남짓, 바닥 조각은 5~10ms). 너무 많이 맡기면 새로 급해진 일이 기다림
 */
const IN_FLIGHT = 6;
/** 몇 프레임 동안 다시 요청하지 않은 일은 뒤로 미룸 (화면 밖으로 나간 것) */
const STALE_FRAMES = 2;
const STALE_PRIO = 1e6;

interface Pending {
  key: string;
  job: BakeJob;
  prio: number;
  /** 마지막으로 요청한 프레임 */
  frame: number;
  /** 작업자에게 보낸 일 번호 (아직 안 보냈으면 0) */
  id: number;
  done: (img: BakedImage | null) => void;
}

interface Slot {
  worker: Worker;
  /** 맡겨 두고 아직 답을 받지 못한 일 수 */
  busy: number;
}

export class Baker {
  /** 작업자를 쓸 수 있는지. false 면 요청한 쪽이 그 자리에서 굽습니다 */
  async = false;
  private started = false;
  private slots: Slot[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly byId = new Map<number, Pending>();
  private readonly maps = new Map<string, BakeMap>();
  private nextId = 1;
  private frame = 0;

  /** url: 작업자 스크립트 주소, maxWorkers: 작업자 수 상한, inFlight: 작업자마다 한꺼번에 맡겨 두는 일 수 */
  constructor(
    private readonly url: () => string | URL,
    private readonly maxWorkers = MAX_WORKERS,
    private readonly inFlight = IN_FLIGHT,
  ) {}

  /** 작업자를 띄웁니다 (브라우저에서 처음 부를 때 한 번). 실패하면 그 자리에서 굽기 */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof Worker !== 'function') return;
    const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 2;
    const n = Math.max(1, Math.min(this.maxWorkers, cores - 1));
    try {
      for (let i = 0; i < n; i++) {
        const worker = new Worker(this.url());
        const slot: Slot = { worker, busy: 0 };
        worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(slot, ev.data);
        worker.onerror = (ev) => {
          ev.preventDefault();
          this.fail();
        };
        // 쉬는 동안 바닥 무늬를 미리 만들어 둠 (작업자마다 한 벌씩; 맵에 처음 들어갈 때 기다리지 않게)
        worker.postMessage({ t: 'warm' } satisfies ToWorker);
        this.slots.push(slot);
      }
      this.async = true;
    } catch {
      this.fail();
    }
  }

  /** 작업자를 쓸 수 없게 됨: 남은 일은 버리고 (요청한 쪽이 다음 프레임에 그 자리에서 구움) 이제부터 그 자리에서 굽기 */
  private fail(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.async = false;
    const left = [...this.pending.values()];
    this.pending.clear();
    this.byId.clear();
    for (const p of left) p.done(null);
  }

  /** 프레임마다 한 번: 오래 요청하지 않은 일을 가려내는 기준 */
  tick(): void {
    this.frame++;
  }

  /** 맵 타일을 작업자들에게 알립니다 (같은 열쇠는 한 번만). 다른 맵의 바닥 조각 일은 버림 */
  setMap(key: string, map: BakeMap): void {
    for (const [k, p] of this.pending) {
      if (p.job.kind === 'chunk' && p.job.map !== key && !p.id) {
        this.pending.delete(k);
        p.done(null);
      }
    }
    if (this.maps.has(key)) return;
    this.maps.set(key, map);
    if (this.maps.size > 4) this.maps.delete(this.maps.keys().next().value!);
    const msg: ToWorker = { t: 'map', key, map: { id: map.id, dark: map.dark, tiles: map.tiles } };
    for (const s of this.slots) s.worker.postMessage(msg);
  }

  /** 이 열쇠의 일이 진행 중인지 */
  has(key: string): boolean {
    return this.pending.has(key);
  }

  /**
   * 굽기 요청. 같은 열쇠는 한 번만 굽고 (다시 요청하면 우선순위만 바뀜), 다 되면 done(그림) 을 부릅니다.
   * prio 가 작을수록 먼저. 작업자가 그림을 못 만들면 done(null). 작업자에게는 flush() 때 맡깁니다.
   */
  request(key: string, job: BakeJob, prio: number, done: (img: BakedImage | null) => void): void {
    let p = this.pending.get(key);
    if (!p) {
      p = { key, job, prio, frame: this.frame, id: 0, done };
      this.pending.set(key, p);
    } else if (p.frame !== this.frame || prio < p.prio) p.prio = prio;
    p.frame = this.frame;
  }

  /** 이번 프레임의 요청을 다 받은 뒤: 일이 모자란 작업자에게 가장 급한 일부터 고루 맡깁니다 */
  flush(): void {
    for (let d = 1; d <= this.inFlight; d++) for (const s of this.slots) if (s.busy < d && !this.dispatch(s)) return;
  }

  /** 작업자 하나에 가장 급한 일 하나를 맡김 (맡길 일이 없으면 false) */
  private dispatch(s: Slot): boolean {
    let best: Pending | null = null;
    let bp = Infinity;
    for (const p of this.pending.values()) {
      if (p.id) continue;
      const e = this.frame - p.frame > STALE_FRAMES ? p.prio + STALE_PRIO : p.prio;
      if (e < bp) {
        bp = e;
        best = p;
      }
    }
    if (!best) return false;
    best.id = this.nextId++;
    this.byId.set(best.id, best);
    s.busy++;
    const msg: ToWorker = { t: 'job', id: best.id, job: best.job };
    s.worker.postMessage(msg);
    return true;
  }

  private receive(slot: Slot, m: FromWorker): void {
    const p = this.byId.get(m.id);
    slot.busy = Math.max(0, slot.busy - 1);
    if (p) {
      this.byId.delete(m.id);
      this.pending.delete(p.key);
      let img: BakedImage | null = null;
      if (m.t === 'done' && m.w > 0) img = m.bitmap ?? (m.data ? pixelsToCanvas({ w: m.w, h: m.h, data: new Uint8ClampedArray(m.data) }) : null);
      else if (m.t === 'fail') console.warn('그림 굽기 실패', p.job, m.error);
      p.done(img);
    }
    while (slot.busy < this.inFlight && this.dispatch(slot));
  }
}

/** 게임 화면이 함께 쓰는 굽기 일꾼 (작업자 스크립트는 game.js 옆의 bake-worker.js) */
export const baker = new Baker(() => new URL('bake-worker.js', import.meta.url));
