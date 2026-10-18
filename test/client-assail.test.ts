// 클라이언트 평타 연타 간격 점검: 서버가 알려 주는 실제 간격({t:'cooldown', id:'assail', ms})을 따르는지.
// 서버보다 일찍 보내면 서버가 조용히 버리고 화면에는 헛손질만 보이므로, 스페이스를 누르고 있을 때 버려지는 평타가 없어야 합니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSAIL_COOLDOWN_MS } from '../src/shared/constants';
import { ASSAIL_SLACK_MS, AssailPacer } from '../src/client/assail';

test('평타 간격: 서버의 답을 받기 전에는 신속 없는 기본 간격 (서버 간격보다 짧지 않음)', () => {
  const p = new AssailPacer();
  assert.ok(p.ready(0));
  p.sent(1000);
  assert.equal(p.ready(1000 + ASSAIL_COOLDOWN_MS + ASSAIL_SLACK_MS - 1), false);
  assert.ok(p.ready(1000 + ASSAIL_COOLDOWN_MS + ASSAIL_SLACK_MS));
});

test('평타 간격: 서버가 알려 준 간격으로 바로 고치고, 보낸 시각부터 센다', () => {
  const p = new AssailPacer();
  // 바람의 노래(신속 15%): 서버 간격 553ms. 답은 왕복 80ms 뒤에 옴
  p.sent(1000);
  p.confirmed(553, 1080);
  assert.equal(p.readyAt, 1000 + 553 + ASSAIL_SLACK_MS, '받은 시각이 아니라 보낸 시각부터 (지연만큼 느려지지 않음)');
  // 다음 평타는 답이 오기 전에도 마지막으로 알려 준 간격으로
  p.sent(1583);
  assert.equal(p.readyAt, 1583 + 553 + ASSAIL_SLACK_MS);
  // 신속이 끝나 서버가 긴 간격을 알려 주면 늘림
  p.confirmed(ASSAIL_COOLDOWN_MS, 1660);
  assert.equal(p.readyAt, 1583 + ASSAIL_COOLDOWN_MS + ASSAIL_SLACK_MS);
});

test('평타 간격: 보낸 적 없는 답(자동사냥처럼 서버가 대신 휘두름)은 받은 시각부터 센다', () => {
  const p = new AssailPacer();
  p.confirmed(520, 5000);
  assert.equal(p.readyAt, 5000 + 520 + ASSAIL_SLACK_MS);
  // 오래전에 보낸 평타가 버려져 답이 없었던 경우도 마찬가지
  p.sent(6000);
  p.confirmed(520, 9000);
  assert.equal(p.readyAt, 9000 + 520 + ASSAIL_SLACK_MS);
});

test('평타 간격: 스페이스를 누르고 있으면 신속의 세기가 무엇이든 서버가 버리는 평타 없이 서버 간격에 가깝게 친다', () => {
  // 신속 없음, 바람의 노래 15%, 투기장의 함성 20%, 25%, 최대 50%
  for (const serverMs of [650, 553, 520, 488, 325]) {
    for (const oneWay of [5, 40, 150]) {
      const p = new AssailPacer();
      let serverNext = 0;
      const inbox: { at: number; ms: number }[] = [];
      let sent = 0;
      let accepted = 0;
      for (let now = 0; now < 20_000; now += 16) {
        // 화면 갱신마다: 도착한 답을 처리하고, 칠 수 있으면 침
        while (inbox.length && inbox[0]!.at <= now) {
          const r = inbox.shift()!;
          p.confirmed(r.ms, r.at);
        }
        if (!p.ready(now)) continue;
        p.sent(now);
        sent++;
        // 서버에 닿는 시간은 매번 ±10ms 흔들림
        const arrive = now + oneWay + ((sent * 7) % 21) - 10;
        if (arrive < serverNext) continue; // 서버: 너무 일찍 온 평타는 조용히 버림
        accepted++;
        serverNext = arrive + serverMs;
        inbox.push({ at: arrive + oneWay, ms: serverMs });
      }
      assert.equal(accepted, sent, `서버 ${serverMs}ms, 지연 ${oneWay}ms: ${sent - accepted}번 버려짐`);
      // 화면 갱신(16ms) 단위로 기다리는 몫까지 쳐도 서버가 허락하는 횟수에 가깝게
      const ideal = 20_000 / serverMs;
      assert.ok(accepted >= ideal * (serverMs / (serverMs + ASSAIL_SLACK_MS + 16)) - 1, `서버 ${serverMs}ms, 지연 ${oneWay}ms: ${accepted}번 (이론상 ${ideal.toFixed(1)}번)`);
    }
  }
});
