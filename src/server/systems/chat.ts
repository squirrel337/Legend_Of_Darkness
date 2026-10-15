// 채팅: 말하기, 외치기, 귓속말, 그룹 대화, 명령어
import { CHAT_MAX, SAY_RANGE } from '../../shared/constants';
import { TokenBucket } from '../auth';
import { runCommand, shout, whisper } from '../admin/commands';
import type { Player } from '../world/Player';
import type { World } from '../world/World';

const buckets = new WeakMap<Player, TokenBucket>();

/** 제어 문자와 줄바꿈 문자를 없애고 길이를 제한합니다 */
export function sanitize(text: unknown): string {
  if (typeof text !== 'string') return '';
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) continue;
    out += ch;
  }
  return out.trim().slice(0, CHAT_MAX);
}

export async function handleChat(world: World, p: Player, raw: unknown): Promise<void> {
  const text = sanitize(raw);
  if (!text) return;
  if (text.startsWith('/')) return runCommand(world, world.admin, p, text);
  let bucket = buckets.get(p);
  if (!bucket) {
    bucket = new TokenBucket(5, 1);
    buckets.set(p, bucket);
  }
  if (!p.isGm && !bucket.take()) {
    p.err('채팅을 너무 빠르게 보내고 있습니다.');
    return;
  }
  if (text.startsWith('!')) return shout(p, text.slice(1));
  if (text.startsWith('@')) {
    const body = text.slice(1);
    const sp = body.indexOf(' ');
    if (sp < 0) return p.err('사용법: @이름 내용');
    return whisper(world, p, body.slice(0, sp), body.slice(sp + 1));
  }
  if (text.startsWith('#')) return world.groups.chat(p, text.slice(1).trim());
  p.map?.broadcastNear({ t: 'chat', ch: 'say', from: p.name, text, id: p.id }, p.x, p.y, SAY_RANGE);
}
