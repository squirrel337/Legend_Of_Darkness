// 서버와 클라이언트(게임, 관리자 페이지)를 esbuild로 번들링합니다.
//   node scripts/build.mjs        → 프로덕션 빌드
//   node scripts/build.mjs --dev  → 변경 감시 + 서버 자동 재시작
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

const clientOptions = {
  entryPoints: {
    game: path.join(root, 'src/client/main.ts'),
    admin: path.join(root, 'src/admin/main.ts'),
  },
  outdir: path.join(root, 'public/build'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  minify: !dev,
  logLevel: 'info',
};

const serverOptions = {
  entryPoints: [path.join(root, 'src/server/index.ts')],
  outfile: path.join(root, 'dist/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  banner: { js: '// 빌드 결과물입니다. 수정은 src/ 에서 하세요.' },
};

if (!dev) {
  await Promise.all([esbuild.build(clientOptions), esbuild.build(serverOptions)]);
} else {
  let child = null;
  const restart = () => {
    if (child) child.kill('SIGTERM');
    child = spawn(process.execPath, ['--enable-source-maps', path.join(root, 'dist/server.js')], {
      stdio: 'inherit',
      cwd: root,
    });
  };
  const restartPlugin = {
    name: 'restart-server',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) restart();
      });
    },
  };
  const clientCtx = await esbuild.context(clientOptions);
  const serverCtx = await esbuild.context({ ...serverOptions, plugins: [restartPlugin] });
  await Promise.all([clientCtx.watch(), serverCtx.watch()]);
  const stop = async () => {
    await Promise.all([clientCtx.dispose(), serverCtx.dispose()]);
    if (child) child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
