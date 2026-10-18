// 평타 연타 간격: 서버가 알려 주는 실제 평타 간격(신속 반영)으로 다음 평타를 보낼 때를 정합니다.
// 서버는 평타를 받아들일 때마다 {t:'cooldown', id:'assail', ms} 를 보냅니다. 클라이언트는 신속의 세기를 모르므로
// 짐작하지 않고 이 값을 씁니다. 서버보다 일찍 보내면 서버가 조용히 버리고, 화면에는 헛손질만 보이게 됩니다.
import { ASSAIL_COOLDOWN_MS } from '../shared/constants';

/** 서버에 닿는 시간이 매번 조금씩 달라도 너무 일찍 도착하지 않게 두는 여유 (밀리초) */
export const ASSAIL_SLACK_MS = 30;
/** 보낸 평타의 답이 이보다 늦게 오면 내 평타의 답이 아닌 것으로 봄 (자동사냥처럼 서버가 대신 휘두른 것) */
const REPLY_WINDOW_MS = 2000;

export class AssailPacer {
  /** 서버가 마지막으로 알려 준 평타 간격. 답을 받기 전에는 신속 없는 기본 간격 (서버의 간격보다 짧지 않음) */
  intervalMs = ASSAIL_COOLDOWN_MS;
  /** 다음 평타를 보낼 수 있는 시각 */
  readyAt = 0;
  private sentAt = -Infinity;
  private awaiting = false;

  ready(now: number): boolean {
    return now >= this.readyAt;
  }

  /** 평타를 보냈을 때: 답이 오기 전까지는 마지막으로 알려 준 간격만큼 기다림 */
  sent(now: number): void {
    this.sentAt = now;
    this.awaiting = true;
    this.readyAt = now + this.intervalMs + ASSAIL_SLACK_MS;
  }

  /**
   * 서버가 평타를 받아들이고 실제 간격을 알려 줬을 때.
   * 내가 보낸 평타의 답이면 보낸 시각부터 셉니다 (서버가 받은 때와 가장 가깝고, 지연만큼 느려지지 않음).
   * 보낸 적 없는 답(자동사냥처럼 서버가 대신 휘두름)이면 받은 시각부터 셉니다 (늦을 수는 있어도 이르지 않음).
   */
  confirmed(ms: number, now: number): void {
    this.intervalMs = ms;
    const mine = this.awaiting && now - this.sentAt <= REPLY_WINDOW_MS;
    this.awaiting = false;
    this.readyAt = (mine ? this.sentAt : now) + ms + ASSAIL_SLACK_MS;
  }
}
