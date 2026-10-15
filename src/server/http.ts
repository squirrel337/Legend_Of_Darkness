// HTTP 서버: 게임/관리자 페이지 정적 파일과 관리자 API
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AdminApi } from './admin/api';
import { sendJson } from './admin/api';
import type { World } from './world/World';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

const ROUTES: Record<string, string> = {
  '/': 'index.html',
  '/admin': 'admin.html',
  '/admin/': 'admin.html',
};

export function createHttpServer(world: World, api: AdminApi): http.Server {
  const publicDir = path.resolve(world.config.publicDir);
  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    void (async () => {
      if (await api.handle(req, res, pathname)) return;
      if (pathname === '/api/status') {
        return sendJson(res, 200, {
          ok: true,
          name: world.config.serverName,
          online: world.players.size,
          uptimeSec: Math.floor((Date.now() - world.startedAt) / 1000),
        });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const rel = ROUTES[pathname] ?? pathname.replace(/^\/+/, '');
      const file = path.resolve(publicDir, rel);
      if (!file.startsWith(publicDir + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다.');
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(file).pipe(res);
      });
    })();
  });
}
