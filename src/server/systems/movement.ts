// 플레이어 이동과 워프
import { DIR_DX, DIR_DY, isDir } from '../../shared/constants';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import { stopAuto } from './autohunt';

/** 직접 조작하면 자동사냥을 멈춥니다 */
const MANUAL_STOP = '직접 움직여서 자동사냥을 멈췄습니다.';

function correct(p: Player): void {
  p.send({ t: 'pos', x: p.x, y: p.y, dir: p.dir });
}

export function handleWalk(world: World, p: Player, dir: unknown, fromX: unknown, fromY: unknown, now = Date.now()): void {
  const map = p.map;
  if (!map || !isDir(dir)) return;
  if (p.auto) stopAuto(p, MANUAL_STOP);
  if (fromX !== p.x || fromY !== p.y) return correct(p);
  if (p.hasStatus('sleep') || p.hasStatus('paralyze')) return correct(p);
  if (!p.moveBucket.take(1, now)) return correct(p);
  if (p.dir !== dir) p.dir = dir;
  const nx = p.x + DIR_DX[dir]!;
  const ny = p.y + DIR_DY[dir]!;
  if (!map.isWalkable(nx, ny)) {
    map.broadcast({ t: 'turn', id: p.id, dir }, p);
    return correct(p);
  }
  const blocker = map.blockerAt(nx, ny);
  // 유령은 다른 생물을 통과할 수 있지만 NPC는 통과할 수 없습니다
  if (blocker && (!p.isDead || blocker.kind === 'npc')) {
    map.broadcast({ t: 'turn', id: p.id, dir }, p);
    return correct(p);
  }
  map.move(p, nx, ny);
  map.broadcast({ t: 'walk', id: p.id, x: nx, y: ny, dir }, p);
  const warp = map.warpAt(nx, ny);
  if (warp) {
    if (warp.minLevel && p.level < warp.minLevel && !p.isGm) {
      p.err(`${warp.label ?? '이곳'}: ${warp.minLevel}레벨 이상만 들어갈 수 있습니다.`);
      return;
    }
    const target = world.maps.get(warp.to);
    if (target) world.transfer(p, target, warp.tx, warp.ty);
  }
}

export function handleTurn(p: Player, dir: unknown): void {
  if (!p.map || !isDir(dir)) return;
  if (p.auto) stopAuto(p, MANUAL_STOP);
  if (p.dir === dir) return;
  p.dir = dir;
  p.map.broadcast({ t: 'turn', id: p.id, dir }, p);
}

/** 유령 상태에서 마을 신전 앞으로 돌아갑니다 */
export function ghostRecall(world: World, p: Player): void {
  if (!p.isDead) return p.err('유령 상태에서만 사용할 수 있습니다.');
  const town = world.maps.get('town')!;
  // 신전 사제 근처로
  const priest = [...town.npcs].find((n) => n.def.services.some((s) => s.type === 'revive'));
  const tx = priest ? priest.x : town.def.spawn.x;
  const ty = priest ? priest.y + 2 : town.def.spawn.y;
  world.transfer(p, town, tx, ty);
  p.sys('마을로 돌아왔습니다. 신전의 사제에게 말을 걸어 부활하세요.');
}
