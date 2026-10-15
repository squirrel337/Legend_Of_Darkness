// 접속 IP 판별과 시도 횟수 제한
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIp, hashPassword, RateLimiter, verifyPassword } from '../src/server/auth';

const req = (xff?: string | string[]) => ({
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  socket: { remoteAddress: '10.0.0.1' },
});

test('IP: 프록시를 믿을 때만 X-Forwarded-For 를 쓰고, 클라이언트가 꾸밀 수 있는 앞쪽 값은 무시한다', () => {
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), false), '10.0.0.1');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(req(['6.6.6.6', '1.2.3.4']), true), '1.2.3.4');
  assert.equal(clientIp(req('1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(req(' , '), true), '10.0.0.1');
  assert.equal(clientIp(req(), true), '10.0.0.1');
});

test('RateLimiter: hit 은 허용량까지, peek 은 기록하지 않고, add 는 기록만 한다', () => {
  const rl = new RateLimiter(3, 1000);
  for (let i = 0; i < 3; i++) assert.ok(rl.hit('ip', i));
  assert.equal(rl.hit('ip', 3), false);
  assert.ok(rl.hit('ip', 1000), '시간이 지나면 다시 허용');

  for (let i = 0; i < 10; i++) assert.ok(rl.peek('acct', 0), 'peek 은 횟수를 쓰지 않음');
  rl.add('acct', 0);
  rl.add('acct', 10);
  rl.add('acct', 20);
  assert.equal(rl.peek('acct', 30), false);
  assert.ok(rl.peek('other', 30), '다른 키는 영향 없음');
  assert.ok(rl.peek('acct', 1015), '오래된 기록은 지워짐');
  rl.add('acct', 1016);
  rl.reset('acct');
  assert.ok(rl.peek('acct', 1017));
});

test('비밀번호 해시: 맞는 비밀번호만 통과하고, 망가진 해시는 거부한다', async () => {
  const h = await hashPassword('비밀번호123');
  assert.ok(await verifyPassword('비밀번호123', h));
  assert.equal(await verifyPassword('비밀번호124', h), false);
  assert.equal(await verifyPassword('x', 'scrypt$1$1$1$AAAA$AAAA'), false);
  assert.equal(await verifyPassword('x', 'plain'), false);
});
