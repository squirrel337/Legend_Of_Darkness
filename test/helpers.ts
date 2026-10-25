// 통합 테스트용 도우미: WebSocket 클라이언트와 서버 설정
import path from 'node:path';
import { WebSocket } from 'ws';
import type { C2S, S2C, SelfState } from '../src/shared/protocol';
import { loadConfig, type ServerConfig } from '../src/server/config';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const ADMIN_PW = 'test-admin-pass';

export function testConfig(dataDir: string, extra: Record<string, string> = {}): ServerConfig {
  return loadConfig(
    {
      PORT: '0',
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: ADMIN_PW,
      GAMEDATA_DIR: path.join(ROOT, 'gamedata'),
      PUBLIC_DIR: path.join(ROOT, 'public'),
      LOG_LEVEL: 'warn',
      ...extra,
    } as NodeJS.ProcessEnv,
    ROOT,
  );
}

export type Msg<T extends S2C['t']> = Extract<S2C, { t: T }>;

export class Client {
  readonly msgs: S2C[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const v = JSON.parse(d.toString()) as S2C | S2C[];
      for (const m of Array.isArray(v) ? v : [v]) this.msgs.push(m);
    });
  }

  static async connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = new Client(ws);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    await c.waitFor('hello');
    return c;
  }

  send(m: C2S): void {
    this.ws.send(JSON.stringify(m));
  }

  get mark(): number {
    return this.msgs.length;
  }

  async waitFor<T extends S2C['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, since = 0, timeout = 4000): Promise<Msg<T>> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (let i = this.msgs.length - 1; i >= since; i--) {
        const m = this.msgs[i]!;
        if (m.t === t && pred(m as Msg<T>)) return m as Msg<T>;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`'${t}' 메시지를 기다리다 시간 초과 (최근: ${this.msgs.slice(-5).map((m) => m.t).join(',')})`);
  }

  async self(pred: (s: SelfState) => boolean = () => true, since = 0): Promise<SelfState> {
    return (await this.waitFor('self', (m) => pred(m.s), since)).s;
  }

  async chat(text: string): Promise<void> {
    this.send({ t: 'chat', text });
    await new Promise((r) => setTimeout(r, 60));
  }

  close(): void {
    this.ws.close();
  }
}

export async function httpJson(
  port: number,
  pathname: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

export const create = (c: Client, name: string) => c.send({ t: 'create', name, password: 'pass1234', gender: 'm', hairStyle: 0, hairColor: 0 });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeout = 4000): Promise<void> {
  const end = Date.now() + timeout;
  while (!cond()) {
    if (Date.now() > end) throw new Error('조건을 기다리다 시간 초과');
    await sleep(20);
  }
}
