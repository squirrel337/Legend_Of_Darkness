// 웹 관리자 페이지용 REST API (/api/admin/...)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CLASS_IDS, EQUIP_SLOTS, STAT_KEYS } from '../../shared/constants';
import { AdminSessions, clientIp, RateLimiter, safeEqual } from '../auth';
import { log } from '../log';
import type { World } from '../world/World';
import type { AdminResult } from './AdminService';
import { DesignApi } from './design';

const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '요청이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return reject(new HttpError(400, 'JSON 객체가 필요합니다.'));
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'JSON 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? Math.round(n) : NaN;
};
const optInt = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : int(v));

type Action = (b: Record<string, unknown>, actor: string, name: string) => AdminResult | Promise<AdminResult>;

export class AdminApi {
  readonly sessions = new AdminSessions();
  private readonly loginLimiter = new RateLimiter(10, 60_000);
  private readonly actions: Record<string, Action>;
  /** "직업·스킬트리" 탭 (/design...) */
  private readonly design: DesignApi;

  constructor(private readonly world: World) {
    this.design = new DesignApi(world);
    const a = world.admin;
    this.actions = {
      setLevel: (b, actor, name) => a.setLevel(actor, name, int(b.level)),
      addLevels: (b, actor, name) => a.addLevels(actor, name, int(b.n)),
      addExp: (b, actor, name) => a.addExp(actor, name, int(b.amount)),
      setStat: (b, actor, name) => a.setStat(actor, name, str(b.stat) as never, int(b.value)),
      maxStats: (_b, actor, name) => a.maxStats(actor, name),
      addStatPoints: (b, actor, name) => a.addStatPoints(actor, name, int(b.n)),
      autoStats: (_b, actor, name) => a.autoStats(actor, name),
      resetStats: (_b, actor, name) => a.resetStats(actor, name),
      setBonus: (b, actor, name) => a.setBonus(actor, name, int(b.hp), int(b.mp)),
      setClass: (b, actor, name) => a.setClass(actor, name, str(b.classId)),
      learnAll: (_b, actor, name) => a.learnAll(actor, name),
      learnAbility: (b, actor, name) => a.learnAbility(actor, name, str(b.query)),
      forgetAbility: (b, actor, name) => a.forgetAbility(actor, name, str(b.id)),
      giveGear: (_b, actor, name) => a.giveGear(actor, name),
      maxOut: (b, actor, name) => a.maxOut(actor, name, str(b.classId) || undefined),
      giveItem: (b, actor, name) => a.giveItem(actor, name, str(b.item), int(b.qty ?? 1)),
      removeItem: (b, actor, name) => a.removeItem(actor, name, int(b.slot)),
      clearInventory: (_b, actor, name) => a.clearInventory(actor, name),
      unequipAll: (_b, actor, name) => a.unequipAll(actor, name),
      addGold: (b, actor, name) => a.addGold(actor, name, int(b.amount)),
      setGold: (b, actor, name) => a.setGold(actor, name, int(b.amount)),
      heal: (_b, actor, name) => a.heal(actor, name),
      revive: (_b, actor, name) => a.revive(actor, name),
      setGod: (b, actor, name) => a.setGod(actor, name, typeof b.on === 'boolean' ? b.on : null),
      teleport: (b, actor, name) => a.teleport(actor, name, str(b.map), optInt(b.x), optInt(b.y)),
      setRole: (b, actor, name) => a.setRole(actor, name, str(b.role)),
      ban: (b, actor, name) => a.ban(actor, name, str(b.reason)),
      unban: (_b, actor, name) => a.unban(actor, name),
      kick: (b, actor, name) => a.kick(actor, name, str(b.reason) || undefined),
      setPassword: (b, actor, name) => a.setPassword(actor, name, str(b.password)),
      delete: (_b, actor, name) => a.deleteCharacter(actor, name),
    };
  }

  private clientIp(req: IncomingMessage): string {
    return clientIp(req, this.world.config.trustProxy);
  }

  /** /api/admin 로 시작하는 요청을 처리합니다. 처리했으면 true */
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!pathname.startsWith('/api/admin')) return false;
    try {
      await this.route(req, res, pathname.slice('/api/admin'.length) || '/');
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { ok: false, msg: e.message });
      else {
        log.error('관리자 API 오류:', e);
        sendJson(res, 500, { ok: false, msg: '서버 오류가 발생했습니다.' });
      }
    }
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    const ip = this.clientIp(req);
    if (path === '/login' && method === 'POST') {
      if (!this.loginLimiter.hit(ip)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 1분 뒤에 다시 시도하세요.');
      const body = await readBody(req);
      if (!safeEqual(str(body.password), this.world.config.adminPassword)) {
        log.warn(`관리자 로그인 실패 (${ip})`);
        throw new HttpError(401, '비밀번호가 틀렸습니다.');
      }
      this.loginLimiter.reset(ip);
      const s = this.sessions.create(ip);
      this.world.audit.write(`web(${ip})`, 'login');
      return sendJson(res, 200, { ok: true, token: s.token, expiresAt: s.expiresAt });
    }

    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const session = this.sessions.validate(token);
    if (!session) throw new HttpError(401, '로그인이 필요합니다.');
    const actor = `web(${ip})`;
    const admin = this.world.admin;

    if (path === '/logout' && method === 'POST') {
      this.sessions.revoke(session.token);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/status' && method === 'GET') return sendJson(res, 200, { ok: true, status: admin.status() });
    if (path === '/gamedata' && method === 'GET') return sendJson(res, 200, { ok: true, ...this.gamedata() });
    if (path === '/settings' && method === 'GET') return sendJson(res, 200, { ok: true, settings: admin.settings() });
    if (path === '/settings' && method === 'POST') return sendJson(res, 200, admin.updateSettings(actor, await readBody(req)));
    if (path === '/announce' && method === 'POST') return sendJson(res, 200, admin.announce(actor, str((await readBody(req)).text)));
    if (path === '/save' && method === 'POST') return sendJson(res, 200, admin.saveAll(actor));
    if (path === '/audit' && method === 'GET') return sendJson(res, 200, { ok: true, entries: this.world.audit.list(200) });
    const designReply = await this.design.handle(method, path, () => readBody(req), actor);
    if (designReply) return sendJson(res, designReply.status, designReply.body);

    const url = new URL(req.url ?? '/', 'http://x');
    if (path === '/characters' && method === 'GET') {
      return sendJson(res, 200, { ok: true, characters: admin.listCharacters(url.searchParams.get('q') ?? '') });
    }
    const m = /^\/characters\/([^/]+)(?:\/([A-Za-z]+))?$/.exec(path);
    if (m) {
      const name = decodeURIComponent(m[1]!);
      const action = m[2];
      if (!action && method === 'GET') {
        const d = admin.characterDetail(name);
        if (!d) throw new HttpError(404, '캐릭터를 찾을 수 없습니다.');
        return sendJson(res, 200, { ok: true, character: d });
      }
      if (action && method === 'POST') {
        const fn = this.actions[action];
        if (!fn) throw new HttpError(404, `알 수 없는 작업: ${action}`);
        const result = await fn(await readBody(req), actor, name);
        const detail = action === 'delete' ? null : admin.characterDetail(name);
        return sendJson(res, result.ok ? 200 : 400, { ...result, character: detail });
      }
    }
    throw new HttpError(404, '알 수 없는 요청입니다.');
  }

  private gamedata() {
    const d = this.world.data;
    return {
      classes: [...d.classes.values()].map((c) => ({ id: c.id, name: c.name })),
      classIds: CLASS_IDS,
      statKeys: STAT_KEYS,
      equipSlots: EQUIP_SLOTS,
      items: [...d.items.values()].map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type,
        slot: i.slot ?? null,
        level: i.level ?? 0,
        classes: i.classes ?? null,
        price: i.price,
      })),
      abilities: [...d.abilities.values()]
        .filter((a) => a.classId !== 'monster')
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind, classId: a.classId, level: a.level })),
      maps: [...d.maps.values()].map((m) => ({ id: m.id, name: m.name, spawn: m.spawn, levelRange: m.levelRange ?? null })),
      monsters: [...d.monsters.values()].map((m) => ({ id: m.id, name: m.name, level: m.level })),
      maxLevel: this.world.config.maxLevel,
      statCap: this.world.config.statCap,
    };
  }
}
