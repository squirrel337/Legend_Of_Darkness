// 자동사냥 (서버에서 플레이어를 대신 움직이고 싸우게 합니다)
// TODO(자동사냥): 아직 구현되지 않았습니다. 아래 함수들의 이름과 역할은 유지하세요.
import type { AutoSettings } from '../../shared/autohunt';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

/** 플레이어 한 명의 자동사냥 진행 상태 (Player.auto). 필요한 필드를 자유롭게 늘리세요 */
export interface AutoRun {
  settings: AutoSettings;
}

/** 클라이언트의 { t: 'auto', on, settings } 메시지 처리 */
export function handleAuto(world: World, p: Player, msg: Record<string, unknown>): void {
  void world;
  void msg;
  p.send({ t: 'auto', on: false, reason: '자동사냥은 아직 준비 중입니다.' });
}

/** 100ms 틱마다 각 플레이어에 대해 호출됩니다 */
export function autoHuntTick(world: World, p: Player, now: number): void {
  void world;
  void p;
  void now;
}

/** 자동사냥을 끕니다 (수동 이동, 사망, 맵 이동, 접속 종료 등) */
export function stopAuto(p: Player, reason?: string): void {
  void p;
  void reason;
}
