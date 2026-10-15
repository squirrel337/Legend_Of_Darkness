// 서버 설정: 환경 변수(.env 파일 포함)에서 읽고, 관리자가 실행 중에 바꾼 값은 data/settings.json에 저장합니다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from './log';

export type RegistrationMode = 'open' | 'invite' | 'closed';

/** 관리자 페이지에서 실행 중에 바꿀 수 있는 설정 */
export interface RuntimeSettings {
  serverName: string;
  motd: string;
  expRate: number;
  goldRate: number;
  dropRate: number;
  registration: RegistrationMode;
  inviteCode: string;
  /** 사망 시 현재 레벨 경험치 손실 비율 (0~1) */
  deathExpPenalty: number;
  /** 새 캐릭터 시작 레벨 */
  startLevel: number;
  /** 직업 선택 가능 레벨 */
  classLevel: number;
}

export interface ServerConfig extends RuntimeSettings {
  host: string;
  port: number;
  dataDir: string;
  gamedataDir: string;
  publicDir: string;
  adminPassword: string;
  adminPasswordGenerated: boolean;
  /** 접속하면 자동으로 관리자 권한을 받는 캐릭터 이름 (소문자) */
  adminCharacters: string[];
  maxLevel: number;
  statCap: number;
  statPointsPerLevel: number;
  autosaveSeconds: number;
  maxPlayers: number;
  maxConnectionsPerIp: number;
  /** 리버스 프록시 뒤에서 X-Forwarded-For 를 신뢰할지 */
  trustProxy: boolean;
  /** 서버의 첫 번째 캐릭터에게 관리자 권한을 줄지 */
  firstCharacterAdmin: boolean;
}

/** .env 파일을 읽어 아직 설정되지 않은 환경 변수만 채웁니다 */
export function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envStr(env: NodeJS.ProcessEnv, key: string, def: string): string {
  const v = env[key];
  return v === undefined || v === '' ? def : v;
}

function envNum(env: NodeJS.ProcessEnv, key: string, def: number, min: number, max: number): number {
  const v = env[key];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    log.warn(`설정 ${key}=${v} 은(는) 숫자가 아닙니다. 기본값 ${def}을(를) 사용합니다.`);
    return def;
  }
  return Math.min(max, Math.max(min, n));
}

function envBool(env: NodeJS.ProcessEnv, key: string, def: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  const dataDir = path.resolve(cwd, envStr(env, 'DATA_DIR', 'data'));
  const registrationRaw = envStr(env, 'REGISTRATION', 'open');
  const registration: RegistrationMode =
    registrationRaw === 'invite' || registrationRaw === 'closed' ? registrationRaw : 'open';

  let adminPassword = envStr(env, 'ADMIN_PASSWORD', '');
  let adminPasswordGenerated = false;
  if (!adminPassword) {
    // 비밀번호를 지정하지 않으면 무작위로 만들어 data/admin-password.txt 에 저장
    const file = path.join(dataDir, 'admin-password.txt');
    try {
      if (fs.existsSync(file)) adminPassword = fs.readFileSync(file, 'utf8').trim();
    } catch {
      /* 무시 */
    }
    if (!adminPassword) {
      adminPassword = crypto.randomBytes(12).toString('base64url');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, adminPassword + '\n', { mode: 0o600 });
    }
    adminPasswordGenerated = true;
  }

  const cfg: ServerConfig = {
    host: envStr(env, 'HOST', '0.0.0.0'),
    port: envNum(env, 'PORT', 7777, 0, 65535),
    serverName: envStr(env, 'SERVER_NAME', '어둠의 전설 개인 서버'),
    motd: envStr(env, 'MOTD', '던모르 마을에 오신 것을 환영합니다! 도움말은 H 키를 누르세요.'),
    dataDir,
    gamedataDir: path.resolve(cwd, envStr(env, 'GAMEDATA_DIR', 'gamedata')),
    publicDir: path.resolve(cwd, envStr(env, 'PUBLIC_DIR', 'public')),
    adminPassword,
    adminPasswordGenerated,
    adminCharacters: envStr(env, 'ADMIN_CHARACTERS', '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    registration,
    inviteCode: envStr(env, 'INVITE_CODE', ''),
    expRate: envNum(env, 'EXP_RATE', 1, 0, 100000),
    goldRate: envNum(env, 'GOLD_RATE', 1, 0, 100000),
    dropRate: envNum(env, 'DROP_RATE', 1, 0, 1000),
    maxLevel: Math.round(envNum(env, 'MAX_LEVEL', 99, 1, 999)),
    statCap: Math.round(envNum(env, 'STAT_CAP', 255, 10, 100000)),
    statPointsPerLevel: Math.round(envNum(env, 'STAT_POINTS_PER_LEVEL', 2, 0, 100)),
    startLevel: Math.round(envNum(env, 'START_LEVEL', 1, 1, 999)),
    classLevel: Math.round(envNum(env, 'CLASS_LEVEL', 5, 1, 999)),
    deathExpPenalty: envNum(env, 'DEATH_EXP_PENALTY', 0, 0, 1),
    autosaveSeconds: Math.round(envNum(env, 'AUTOSAVE_SECONDS', 30, 5, 3600)),
    maxPlayers: Math.round(envNum(env, 'MAX_PLAYERS', 200, 1, 10000)),
    maxConnectionsPerIp: Math.round(envNum(env, 'MAX_CONNECTIONS_PER_IP', 8, 1, 1000)),
    trustProxy: envBool(env, 'TRUST_PROXY', false),
    firstCharacterAdmin: envBool(env, 'FIRST_CHARACTER_ADMIN', true),
  };
  cfg.startLevel = Math.min(cfg.startLevel, cfg.maxLevel);
  return cfg;
}

const RUNTIME_KEYS: (keyof RuntimeSettings)[] = [
  'serverName',
  'motd',
  'expRate',
  'goldRate',
  'dropRate',
  'registration',
  'inviteCode',
  'deathExpPenalty',
  'startLevel',
  'classLevel',
];

export function runtimeSettingsOf(cfg: ServerConfig): RuntimeSettings {
  const out = {} as Record<string, unknown>;
  for (const k of RUNTIME_KEYS) out[k] = cfg[k];
  return out as unknown as RuntimeSettings;
}

/**
 * 부분 설정을 검증해서 적용합니다. 잘못된 값은 오류 메시지를 반환합니다.
 */
export function applyRuntimeSettings(cfg: ServerConfig, patch: Record<string, unknown>): string | null {
  const next = { ...cfg };
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'serverName':
      case 'motd':
      case 'inviteCode': {
        if (typeof v !== 'string' || v.length > (k === 'motd' ? 500 : 100)) return `${k} 값이 올바르지 않습니다.`;
        next[k] = v.trim();
        break;
      }
      case 'expRate':
      case 'goldRate':
      case 'dropRate': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > (k === 'dropRate' ? 1000 : 100000)) return `${k} 배율이 올바르지 않습니다.`;
        next[k] = n;
        break;
      }
      case 'deathExpPenalty': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1) return '사망 경험치 손실은 0~1 사이여야 합니다.';
        next.deathExpPenalty = n;
        break;
      }
      case 'startLevel':
      case 'classLevel': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > cfg.maxLevel) return `${k} 값은 1~${cfg.maxLevel} 사이의 정수여야 합니다.`;
        next[k] = n;
        break;
      }
      case 'registration': {
        if (v !== 'open' && v !== 'invite' && v !== 'closed') return 'registration 은 open/invite/closed 중 하나여야 합니다.';
        next.registration = v;
        break;
      }
      default:
        return `알 수 없는 설정: ${k}`;
    }
  }
  Object.assign(cfg, next);
  return null;
}

export function settingsFile(cfg: ServerConfig): string {
  return path.join(cfg.dataDir, 'settings.json');
}

/** data/settings.json 에 저장된 실행 중 변경 설정을 불러옵니다 */
export function loadSavedSettings(cfg: ServerConfig): void {
  const file = settingsFile(cfg);
  if (!fs.existsSync(file)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const k of RUNTIME_KEYS) if (k in raw) filtered[k] = raw[k];
    const err = applyRuntimeSettings(cfg, filtered);
    if (err) log.warn(`settings.json 일부를 무시했습니다: ${err}`);
  } catch (e) {
    log.warn('settings.json 을 읽지 못했습니다:', (e as Error).message);
  }
}

export function saveSettings(cfg: ServerConfig): void {
  const file = settingsFile(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(runtimeSettingsOf(cfg), null, 2));
  fs.renameSync(tmp, file);
}
