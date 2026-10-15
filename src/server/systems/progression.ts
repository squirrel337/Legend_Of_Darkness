// 경험치/레벨업/능력치 분배 (접속 중인 플레이어용)
import { isStatKey, type StatKey } from '../../shared/constants';
import type { Player } from '../world/Player';
import { addExpToData } from './character';

/** 경험치를 주고, 레벨이 오르면 축하 효과와 함께 알립니다 */
export function gainExp(p: Player, amount: number, opts: { showGain?: boolean } = {}): number {
  if (!(amount > 0)) return 0;
  const world = p.world;
  const amt = Math.floor(amount);
  const gained = addExpToData(p.data, world.config, amt);
  if (opts.showGain !== false) p.send({ t: 'gain', exp: amt, gold: 0 });
  if (gained > 0) onLevelUp(p, gained);
  p.markSelf();
  return gained;
}

/** 레벨이 오른 직후 처리: 다시 계산, 체력/마나 회복, 알림 */
export function onLevelUp(p: Player, levels: number): void {
  p.recompute();
  if (!p.isDead) {
    p.hp = p.maxHp;
    p.mp = p.maxMp;
  }
  const lv = p.data.level;
  p.send({ t: 'levelUp', level: lv });
  p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
  p.broadcastLook();
  const pts = p.data.statPoints;
  p.notice(levels > 1 ? `레벨 ${levels} 상승! ${lv}레벨이 되었습니다.` : `레벨 업! ${lv}레벨이 되었습니다.`, 'good');
  if (pts > 0) p.sys(`분배할 수 있는 능력치 포인트가 ${pts} 있습니다. (G 키: 능력치 창)`);
  if (p.data.classId === 'peasant' && lv >= p.world.config.classLevel) {
    p.sys(`${p.world.config.classLevel}레벨이 되었습니다. 마을의 길드장을 찾아가 직업을 선택할 수 있습니다.`);
  }
  p.world.groups.touch(p);
}

/** 능력치 포인트 분배 */
export function allocateStat(p: Player, stat: unknown, n: unknown): void {
  if (!isStatKey(stat)) return;
  const count = typeof n === 'number' && Number.isInteger(n) ? n : 1;
  if (count < 1 || count > 1000) return;
  if (p.data.statPoints < count) {
    p.err('남은 능력치 포인트가 부족합니다.');
    return;
  }
  const cap = p.world.config.statCap;
  const key = stat as StatKey;
  const room = cap - p.data.stats[key];
  const add = Math.min(room, count);
  if (add <= 0) {
    p.err(`이 능력치는 최대치(${cap})입니다.`);
    return;
  }
  p.data.stats[key] += add;
  p.data.statPoints -= add;
  p.recompute();
  p.markVitals();
}
