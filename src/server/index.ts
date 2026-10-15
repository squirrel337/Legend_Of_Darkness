// 서버 실행 진입점
//   npm start                              → 서버 시작
//   node dist/server.js --set-role 이름 admin → 서버를 끈 상태에서 캐릭터 권한 변경
import path from 'node:path';
import { isRole } from '../shared/constants';
import { startServer } from './app';
import { loadConfig, loadDotEnv, loadSavedSettings } from './config';
import { GameDataError } from './gamedata';
import { log } from './log';
import { CharacterStore } from './storage';

async function main(): Promise<void> {
  loadDotEnv(path.resolve(process.cwd(), '.env'));
  const cfg = loadConfig();
  loadSavedSettings(cfg);
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    console.log('사용법: node dist/server.js [--set-role 이름 player|gm|admin]');
    return;
  }
  if (args[0] === '--set-role') {
    const [, name, role] = args;
    if (!name || !isRole(role)) {
      console.error('사용법: node dist/server.js --set-role 이름 player|gm|admin');
      process.exit(1);
    }
    const store = new CharacterStore(cfg.dataDir);
    store.load();
    const data = store.get(name);
    if (!data) {
      console.error(`'${name}' 캐릭터가 없습니다.`);
      process.exit(1);
    }
    data.role = role;
    store.saveSync(data);
    console.log(`${data.name} 의 권한을 ${role} 로 바꿨습니다. (서버가 켜져 있었다면 다시 접속해야 적용됩니다)`);
    return;
  }

  let server;
  try {
    server = await startServer(cfg);
  } catch (e) {
    if (e instanceof GameDataError) {
      log.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const shown = cfg.host === '0.0.0.0' || cfg.host === '::' ? 'localhost' : cfg.host;
  log.info('──────────────────────────────────────────────');
  log.info(`${cfg.serverName} 시작!`);
  log.info(`  게임:        http://${shown}:${server.port}/`);
  log.info(`  관리자 페이지: http://${shown}:${server.port}/admin`);
  if (cfg.adminPasswordGenerated) {
    log.info(`  관리자 비밀번호(자동 생성): ${cfg.adminPassword}`);
    log.info(`  (data/admin-password.txt 에 저장됨. .env 의 ADMIN_PASSWORD 로 바꿀 수 있습니다)`);
  }
  log.info(`  배율: 경험치 x${cfg.expRate}, 골드 x${cfg.goldRate}, 드롭 x${cfg.dropRate} / 가입: ${cfg.registration}`);
  log.info('──────────────────────────────────────────────');

  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${sig} 신호를 받아 저장 후 종료합니다...`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('uncaughtException', (e) => log.error('처리되지 않은 오류:', e));
  process.on('unhandledRejection', (e) => log.error('처리되지 않은 Promise 오류:', e));
}

void main();
