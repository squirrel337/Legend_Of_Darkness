// 서버 조립: 설정 → 게임 데이터 → 저장소 → 월드 → HTTP/WebSocket
import type http from 'node:http';
import { WebSocketServer } from 'ws';
import { AdminApi } from './admin/api';
import { clientIp } from './auth';
import type { ServerConfig } from './config';
import { GameData } from './gamedata';
import { createHttpServer } from './http';
import { log } from './log';
import { defaultLimits, Session } from './net/Session';
import { AuditLog, CharacterStore } from './storage';
import { World } from './world/World';

export interface RunningServer {
  world: World;
  http: http.Server;
  wss: WebSocketServer;
  port: number;
  /** 저장 후 종료 */
  close(): Promise<void>;
}

export async function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const data = GameData.load(cfg.gamedataDir);
  log.info(
    `게임 데이터: 맵 ${data.maps.size}, 아이템 ${data.items.size}, 기술/마법 ${data.abilities.size}, 몬스터 ${data.monsters.size}, NPC ${data.npcs.size}`,
  );
  const store = new CharacterStore(cfg.dataDir);
  store.load((id) => data.items.has(id));
  const audit = new AuditLog(cfg.dataDir);
  const world = new World(cfg, data, store, audit);
  const api = new AdminApi(world);
  const server = createHttpServer(world, api);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const limits = defaultLimits();
  const perIp = new Map<string, number>();
  // 응답 없는 연결 정리 (30초마다 ping, 다음 차례까지 pong 이 없으면 끊음)
  const alive = new WeakMap<object, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        /* 이미 닫힘 */
      }
    }
  }, 30_000);

  wss.on('connection', (ws, req) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const ip = clientIp(req, cfg.trustProxy);
    const count = (perIp.get(ip) ?? 0) + 1;
    if (count > cfg.maxConnectionsPerIp) {
      ws.close(4001, 'too many connections');
      return;
    }
    perIp.set(ip, count);
    ws.on('close', () => {
      const c = (perIp.get(ip) ?? 1) - 1;
      if (c <= 0) perIp.delete(ip);
      else perIp.set(ip, c);
    });
    new Session(ws, ip, world, limits).start();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  world.start();

  let closing = false;
  return {
    world,
    http: server,
    wss,
    port,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      world.stop();
      for (const p of [...world.players.values()]) {
        p.send({ t: 'kick', reason: '서버 점검으로 접속이 종료됩니다.' });
        world.leaveGame(p);
      }
      await store.flush();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
