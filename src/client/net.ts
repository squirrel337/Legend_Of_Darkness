// 서버와의 WebSocket 연결
import type { C2S, S2C } from '../shared/protocol';

export type MessageHandler = (msg: S2C) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handler: MessageHandler = () => {};
  onClose: (code: number, reason: string) => void = () => {};
  onOpen: () => void = () => {};
  latency = 0;
  private pingTimer = 0;

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.onOpen();
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 5000);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const list = Array.isArray(data) ? data : [data];
      for (const m of list) {
        const msg = m as S2C;
        if (msg.t === 'pong') {
          this.latency = Math.round(performance.now() - msg.ts);
          continue;
        }
        try {
          this.handler(msg);
        } catch (e) {
          console.error('메시지 처리 오류', msg, e);
        }
      }
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pingTimer);
      this.ws = null;
      this.onClose(ev.code, ev.reason);
    };
  }

  setHandler(h: MessageHandler): void {
    this.handler = h;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
  }
}
