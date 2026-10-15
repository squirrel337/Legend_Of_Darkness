// 그룹(파티): 초대/수락/탈퇴, 경험치 분배, 상태 표시
import type { GroupMember } from '../../shared/protocol';
import { nameKey } from '../storage';
import type { MapInstance } from '../world/MapInstance';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

export const MAX_GROUP = 6;
const SHARE_RANGE = 15;

export class Group {
  leader: string;
  readonly members: string[] = [];

  constructor(leader: string) {
    this.leader = leader;
    this.members.push(leader);
  }

  has(name: string): boolean {
    return this.members.some((m) => nameKey(m) === nameKey(name));
  }
}

export class GroupManager {
  private readonly groups = new Set<Group>();
  private readonly byName = new Map<string, Group>();
  private dirty = new Set<Group>();

  constructor(private readonly world: World) {}

  groupOf(name: string): Group | undefined {
    return this.byName.get(nameKey(name));
  }

  sameGroup(a: string, b: string): boolean {
    const g = this.groupOf(a);
    return !!g && g === this.groupOf(b);
  }

  invite(from: Player, toName: string): void {
    const to = this.world.findPlayer(toName);
    if (!to) return from.err(`${toName}님은 접속 중이 아닙니다.`);
    if (to === from) return from.err('자기 자신은 초대할 수 없습니다.');
    const g = this.groupOf(from.name);
    if (g && g.leader !== from.name) return from.err('그룹장만 초대할 수 있습니다.');
    if (g && g.members.length >= MAX_GROUP) return from.err(`그룹은 최대 ${MAX_GROUP}명입니다.`);
    if (this.groupOf(to.name)) return from.err(`${to.name}님은 이미 다른 그룹에 있습니다.`);
    to.pendingInviteFrom = from.name;
    to.send({ t: 'groupInvite', from: from.name });
    to.sys(`${from.name}님이 그룹에 초대했습니다. (/파티 수락 또는 /파티 거절)`);
    from.sys(`${to.name}님을 그룹에 초대했습니다.`);
  }

  reply(p: Player, accept: boolean): void {
    const fromName = p.pendingInviteFrom;
    p.pendingInviteFrom = null;
    if (!fromName) return p.err('받은 그룹 초대가 없습니다.');
    const from = this.world.findPlayer(fromName);
    if (!accept) {
      from?.sys(`${p.name}님이 그룹 초대를 거절했습니다.`);
      return;
    }
    if (!from) return p.err('초대한 사람이 접속을 종료했습니다.');
    if (this.groupOf(p.name)) return p.err('이미 그룹에 속해 있습니다.');
    let g = this.groupOf(from.name);
    if (!g) {
      g = new Group(from.name);
      this.groups.add(g);
      this.byName.set(nameKey(from.name), g);
      from.group = g;
    }
    if (g.members.length >= MAX_GROUP) return p.err('그룹이 가득 찼습니다.');
    g.members.push(p.name);
    this.byName.set(nameKey(p.name), g);
    p.group = g;
    this.say(g, `${p.name}님이 그룹에 들어왔습니다.`);
    this.dirty.add(g);
  }

  leave(p: Player, quiet = false): void {
    const g = this.groupOf(p.name);
    if (!g) {
      if (!quiet) p.err('그룹에 속해 있지 않습니다.');
      return;
    }
    this.removeMember(g, p.name);
    p.group = null;
    p.send({ t: 'group', members: null });
    if (!quiet) p.sys('그룹에서 나왔습니다.');
    this.say(g, `${p.name}님이 그룹을 떠났습니다.`);
  }

  kick(leader: Player, name: string): void {
    const g = this.groupOf(leader.name);
    if (!g || g.leader !== leader.name) return leader.err('그룹장만 추방할 수 있습니다.');
    const target = g.members.find((m) => nameKey(m) === nameKey(name));
    if (!target || target === leader.name) return leader.err('그룹에 그런 사람이 없습니다.');
    this.removeMember(g, target);
    const tp = this.world.findPlayer(target);
    if (tp) {
      tp.group = null;
      tp.send({ t: 'group', members: null });
      tp.sys('그룹에서 추방되었습니다.');
    }
    this.say(g, `${target}님이 그룹에서 추방되었습니다.`);
  }

  /** 접속 종료 시 그룹에서 뺍니다 */
  onLogout(p: Player): void {
    const g = this.groupOf(p.name);
    if (!g) return;
    this.removeMember(g, p.name);
    p.group = null;
    this.say(g, `${p.name}님이 접속을 종료하여 그룹에서 나갔습니다.`);
  }

  private removeMember(g: Group, name: string): void {
    const i = g.members.findIndex((m) => nameKey(m) === nameKey(name));
    if (i >= 0) g.members.splice(i, 1);
    this.byName.delete(nameKey(name));
    if (g.members.length <= 1) {
      for (const m of g.members) {
        this.byName.delete(nameKey(m));
        const mp = this.world.findPlayer(m);
        if (mp) {
          mp.group = null;
          mp.send({ t: 'group', members: null });
          mp.sys('그룹이 해산되었습니다.');
        }
      }
      g.members.length = 0;
      this.groups.delete(g);
      this.dirty.delete(g);
      return;
    }
    if (nameKey(g.leader) === nameKey(name)) {
      g.leader = g.members[0]!;
      this.say(g, `${g.leader}님이 새 그룹장이 되었습니다.`);
    }
    this.dirty.add(g);
  }

  say(g: Group, text: string): void {
    for (const m of g.members) this.world.findPlayer(m)?.send({ t: 'chat', ch: 'group', text });
  }

  chat(p: Player, text: string): void {
    const g = this.groupOf(p.name);
    if (!g) return p.err('그룹에 속해 있지 않습니다.');
    for (const m of g.members) this.world.findPlayer(m)?.send({ t: 'chat', ch: 'group', from: p.name, text });
  }

  /** 체력/레벨 등이 바뀌었을 때 표시 갱신을 예약 */
  touch(p: Player): void {
    const g = this.groupOf(p.name);
    if (g) this.dirty.add(g);
  }

  /** 1초마다: 그룹원 상태를 보냅니다 */
  sync(): void {
    for (const g of this.groups) this.dirty.add(g); // 체력 변화가 잦으므로 매초 갱신
    for (const g of this.dirty) {
      for (const m of g.members) {
        const p = this.world.findPlayer(m);
        if (!p) continue;
        p.send({ t: 'group', members: this.membersFor(g, p) });
      }
    }
    this.dirty.clear();
  }

  private membersFor(g: Group, viewer: Player): GroupMember[] {
    return g.members.map((name) => {
      const p = this.world.findPlayer(name);
      return {
        name,
        level: p?.level ?? 0,
        classId: p?.data.classId ?? 'peasant',
        hpPct: p ? p.hpPct : 0,
        mpPct: p && p.maxMp > 0 ? Math.round((p.mp / p.maxMp) * 100) : 0,
        online: !!p,
        sameMap: !!p && p.map === viewer.map,
        leader: name === g.leader,
      };
    });
  }

  /** 경험치를 나눠 받을 사람들 (같은 맵, 가까이 있고 살아 있는 그룹원) */
  expSharers(killer: Player, map: MapInstance, x: number, y: number): Player[] {
    const g = this.groupOf(killer.name);
    if (!g) return [killer];
    const out: Player[] = [];
    for (const m of g.members) {
      const p = this.world.findPlayer(m);
      if (!p || p.map !== map || p.isDead) continue;
      if (Math.abs(p.x - x) + Math.abs(p.y - y) > SHARE_RANGE && p !== killer) continue;
      out.push(p);
    }
    if (!out.includes(killer)) out.push(killer);
    return out;
  }
}
