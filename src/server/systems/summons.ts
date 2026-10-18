// 소환수 관리: 주인을 따라다니기, 시간이 다 되면 사라지기, 주인이 떠나면 함께 사라지기
// TODO(소환수): 아직 구현되지 않았습니다. 아래 함수들의 이름과 역할은 유지하세요.
import type { MapInstance } from '../world/MapInstance';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

/** 100ms 틱마다 맵마다 호출: 만료되거나 주인을 잃은 소환수 정리 */
export function summonTick(world: World, map: MapInstance, now: number): void {
  void world;
  void map;
  void now;
}

/** 주인의 소환수를 모두 없앱니다 (접속 종료, 사망 등) */
export function dismissSummons(world: World, p: Player, reason?: string): void {
  void world;
  void p;
  void reason;
}

/** 주인이 다른 맵(또는 먼 곳)으로 옮겨진 뒤 호출: 소환수를 데려가거나 돌려보냄 */
export function onOwnerMoved(world: World, p: Player): void {
  void world;
  void p;
}
