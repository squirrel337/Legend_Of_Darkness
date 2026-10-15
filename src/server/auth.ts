// 비밀번호 해시, 요청 횟수 제한, 관리자 세션
import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const key = await scrypt(password, salt, n, r, p);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** 문자열 비교를 일정한 시간에 수행합니다 */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** 키(IP 등)별로 일정 시간 안의 시도 횟수를 제한합니다 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 허용되면 true. 기록도 함께 남깁니다. */
  hit(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10000) this.prune(now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [k, arr] of this.hits) if (arr.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

/** 초당 일정량이 채워지는 토큰 버킷 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(n = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export interface AdminSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
}

export class AdminSessions {
  private sessions = new Map<string, AdminSession>();

  constructor(private readonly ttlMs = 12 * 60 * 60 * 1000) {}

  create(ip: string): AdminSession {
    const now = Date.now();
    const s: AdminSession = { token: crypto.randomBytes(32).toString('hex'), createdAt: now, expiresAt: now + this.ttlMs, ip };
    this.sessions.set(s.token, s);
    return s;
  }

  validate(token: string | undefined): AdminSession | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return s;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }
}
