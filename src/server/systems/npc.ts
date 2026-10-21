// NPC 대화와 서비스: 상점, 전직, 기술 배우기, 부활, 창고, 이동, 승급, 능력치 초기화
import {
  CLASS_FALLBACK_NAMES,
  NPC_TALK_RANGE,
  dirTowards,
  formatNumber,
  type Dir,
} from '../../shared/constants';
import { isFirstClass } from '../../shared/progression';
import type { NpcService } from '../../shared/types';
import type { DialogOption } from '../../shared/protocol';
import type { Npc } from '../world/Npc';
import type { Player } from '../world/Player';
import type { World } from '../world/World';
import {
  abilityAllowedFor,
  addItem,
  addToStorage,
  canFit,
  equipError,
  learnOnData,
  resetStatsOnData,
  setClassOnData,
  stackSize,
  takeFromSlot,
  unequipToBag,
} from './character';
import { cleanseDebuffs, revivePlayer } from './combat';
import { learnEntries } from './progression';

/** 유령은 대화와 부활만, 잠들거나 마비된 상태에서는 아무 서비스도 쓸 수 없습니다 */
const GHOST_KEYS = new Set(['close', 'back', 'talk', 'about', 'revive']);

function blockedReason(p: Player, key?: string): string | null {
  if (p.isDead) return key === undefined || GHOST_KEYS.has(key) ? null : '유령 상태에서는 할 수 없습니다. 먼저 신전의 사제에게 부활하세요.';
  if (!p.canAct) return '지금은 움직일 수 없습니다.';
  return null;
}

function npcFor(p: Player, npcId: unknown, key?: string): Npc | null {
  if (typeof npcId !== 'number' || !p.map) return null;
  const blocked = blockedReason(p, key);
  if (blocked) {
    p.err(blocked);
    return null;
  }
  const e = p.map.entities.get(npcId);
  if (!e || e.kind !== 'npc') return null;
  if (Math.abs(e.x - p.x) > NPC_TALK_RANGE || Math.abs(e.y - p.y) > NPC_TALK_RANGE) {
    p.err('너무 멀리 있습니다. 가까이 가서 말을 거세요.');
    return null;
  }
  return e as Npc;
}

function className(world: World, id: string): string {
  return world.data.classes.get(id as never)?.name ?? CLASS_FALLBACK_NAMES[id as keyof typeof CLASS_FALLBACK_NAMES] ?? id;
}

function mainOptions(world: World, p: Player, npc: Npc): DialogOption[] {
  const opts: DialogOption[] = [];
  npc.def.services.forEach((s, i) => {
    if (p.isDead && s.type !== 'revive' && s.type !== 'talk') return;
    switch (s.type) {
      case 'shop':
        opts.push({ key: `shop:${i}`, label: s.label ?? '물건 사기' });
        break;
      case 'buy':
        opts.push({ key: 'sell', label: s.label ?? '물건 팔기' });
        break;
      case 'class':
        // 5레벨 직업 선택은 1차 직업 길드장만 (2차 직업 스승은 그 직업이 된 사람에게 기술만 가르침)
        if (s.classId === 'peasant') opts.push({ key: 'learn:peasant', label: '기본 기술 배우기' });
        else if (p.data.classId === 'peasant' && isFirstClass(s.classId))
          opts.push({ key: `class:${s.classId}`, label: `${className(world, s.classId)}의 길 걷기 (직업 선택)` });
        else if (p.data.classId === s.classId) opts.push({ key: `learn:${s.classId}`, label: '기술/마법 배우기' });
        opts.push({ key: `about:${s.classId}`, label: `${className(world, s.classId)}에 대해 듣기` });
        break;
      case 'revive':
        if (p.isDead) opts.push({ key: 'revive', label: '부활하기' });
        break;
      case 'heal':
        opts.push({ key: 'heal', label: s.price ? `치료받기 (${formatNumber(s.price)} 골드)` : '치료받기 (무료)' });
        break;
      case 'ascend':
        opts.push({ key: 'ascend', label: '승급 (경험치 → 체력/마나)' });
        break;
      case 'teleport':
        opts.push({ key: `tp:${i}`, label: s.label ?? '이동하기' });
        break;
      case 'resetStats':
        opts.push({ key: `reset:${i}`, label: `능력치 초기화 (${formatNumber(s.price)} 골드)` });
        break;
      case 'storage':
        opts.push({ key: 'storage', label: '창고 열기' });
        break;
      case 'talk':
        opts.push({ key: `talk:${i}`, label: s.label });
        break;
    }
  });
  opts.push({ key: 'close', label: '대화 끝내기' });
  return opts;
}

function sendDialog(p: Player, npc: Npc, text: string, options: DialogOption[]): void {
  p.send({ t: 'dialog', npc: npc.id, name: npc.def.name, ...(npc.def.title ? { title: npc.def.title } : {}), text, options });
}

export function talkToNpc(world: World, p: Player, npcId: unknown): void {
  const npc = npcFor(p, npcId);
  if (!npc) return;
  p.talkingTo = npc;
  const d = dirTowards(npc.x, npc.y, p.x, p.y);
  if (d !== null && d !== npc.dir) {
    npc.dir = d as Dir;
    npc.map?.broadcast({ t: 'turn', id: npc.id, dir: npc.dir });
  }
  sendDialog(p, npc, npc.def.greeting, mainOptions(world, p, npc));
}

function service<T extends NpcService['type']>(npc: Npc, type: T, index?: number): Extract<NpcService, { type: T }> | undefined {
  if (index !== undefined) {
    const s = npc.def.services[index];
    return s && s.type === type ? (s as Extract<NpcService, { type: T }>) : undefined;
  }
  return npc.def.services.find((s) => s.type === type) as Extract<NpcService, { type: T }> | undefined;
}

export function pickOption(world: World, p: Player, npcId: unknown, keyRaw: unknown): void {
  if (typeof keyRaw !== 'string' || keyRaw.length > 64) return;
  const npc = npcFor(p, npcId, keyRaw.split(':')[0]);
  if (!npc) return;
  p.talkingTo = npc;
  const [key, arg, arg2] = keyRaw.split(':') as [string, string | undefined, string | undefined];
  const back = { key: 'back', label: '돌아가기' };
  switch (key) {
    case 'close':
      p.talkingTo = null;
      p.send({ t: 'closeDialog' });
      return;
    case 'back':
      sendDialog(p, npc, npc.def.greeting, mainOptions(world, p, npc));
      return;
    case 'talk': {
      const s = service(npc, 'talk', Number(arg));
      if (s) sendDialog(p, npc, s.text, [back, { key: 'close', label: '대화 끝내기' }]);
      return;
    }
    case 'shop': {
      const s = service(npc, 'shop', Number(arg));
      if (!s) return;
      const items = s.items
        .map((id) => world.data.items.get(id))
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((d) => ({ item: d.id, price: d.price }));
      p.send({ t: 'shop', npc: npc.id, name: npc.def.name, items, sell: !!service(npc, 'buy') });
      return;
    }
    case 'sell':
      if (!service(npc, 'buy')) return;
      p.send({ t: 'shop', npc: npc.id, name: npc.def.name, items: [], sell: true });
      return;
    case 'about': {
      const cls = world.data.classes.get(arg as never);
      if (cls) sendDialog(p, npc, cls.desc, [back]);
      return;
    }
    case 'class': {
      const s = npc.def.services.find((x) => x.type === 'class' && x.classId === arg);
      // 2차 직업은 승급 뒤 2차 전직으로만 (5레벨에 고를 수 있는 것은 1차 직업뿐)
      if (!s || s.type !== 'class' || !isFirstClass(s.classId)) return;
      const cls = world.data.classes.get(s.classId)!;
      if (p.data.classId !== 'peasant') return sendDialog(p, npc, '이미 다른 길을 걷고 있군. 다른 길은 99레벨에 전직해서 걸을 수 있다네.', [back]);
      const need = world.config.classLevel;
      if (p.level < need && !p.isGm) return sendDialog(p, npc, `아직 이르네. ${need}레벨이 되면 다시 찾아오게.`, [back]);
      if (arg2 !== 'yes') {
        return sendDialog(p, npc, `${cls.desc}\n\n정말 ${cls.name}의 길을 걷겠는가? 한 번 정하면 99레벨에 전직하기 전까지는 바꿀 수 없다.`, [
          { key: `class:${cls.id}:yes`, label: `예, ${cls.name}이(가) 되겠습니다` },
          back,
        ]);
      }
      setClassOnData(p.data, world.data, cls.id);
      // 시작 장비는 바로 착용시키고, 원래 장비는 소지품으로
      for (const id of cls.starterItems ?? []) {
        const def = world.data.items.get(id);
        if (!def) continue;
        if (def.type === 'equip' && def.slot && equipError(p.data, def) === null) {
          unequipToBag(p.data, world.data, def.slot);
          p.data.equipment[def.slot] = def.id;
        } else addItem(p.data, def, 1);
      }
      p.recompute();
      p.hp = p.maxHp;
      p.mp = p.maxMp;
      p.markInv();
      p.markAbilities();
      p.broadcastLook();
      p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
      p.notice(`${cls.name}의 길을 걷기 시작했습니다!`, 'good');
      world.announce(`${p.name}님이 ${cls.name}(으)로 전직했습니다.`);
      sendDialog(p, npc, `좋다! 이제 그대는 ${cls.name}이다. 시작 장비를 입혀 주었다. 기술은 나에게 배울 수 있다.`, [
        { key: `learn:${cls.id}`, label: '기술/마법 배우기' },
        { key: 'close', label: '대화 끝내기' },
      ]);
      return;
    }
    case 'learn': {
      const classId = arg ?? '';
      const s = npc.def.services.find((x) => x.type === 'class' && x.classId === classId);
      if (!s || s.type !== 'class') return;
      if (classId !== 'peasant' && p.data.classId !== classId && !p.isGm) return sendDialog(p, npc, '그대는 우리 길드의 사람이 아니군.', [back]);
      // 이 직업 스킬트리의 기술과 배우는 조건의 상태 (gamedata/skilltrees.json)
      p.send({ t: 'learn', npc: npc.id, name: npc.def.name, classId: s.classId, list: learnEntries(p.data, world.data, s.classId) });
      return;
    }
    case 'revive': {
      if (!service(npc, 'revive')) return;
      if (!p.isDead) return sendDialog(p, npc, '그대는 살아 있습니다. 빛이 함께하기를.', [back]);
      revivePlayer(p, 1);
      p.mp = p.maxMp;
      p.markVitals();
      sendDialog(p, npc, '빛의 은총으로 다시 일어섰습니다. 조심해서 다니세요.', [{ key: 'close', label: '감사합니다' }]);
      return;
    }
    case 'heal': {
      const s = service(npc, 'heal');
      if (!s) return;
      if (p.isDead) return sendDialog(p, npc, '먼저 부활해야 합니다.', [back]);
      const price = s.price ?? 0;
      if (p.data.gold < price) return sendDialog(p, npc, '골드가 부족합니다.', [back]);
      p.data.gold -= price;
      p.hp = p.maxHp;
      p.mp = p.maxMp;
      cleanseDebuffs(p);
      p.markVitals();
      p.markInv();
      p.map?.broadcast({ t: 'fx', fx: 'heal', id: p.id });
      sendDialog(p, npc, '상처가 모두 아물었습니다.', [back, { key: 'close', label: '대화 끝내기' }]);
      return;
    }
    case 'ascend': {
      if (!service(npc, 'ascend')) return;
      // 교환 비율은 gamedata/progression.json 의 ascend (승급·체력→능력치 교환은 엔진 트랙이 붙임)
      const asc = world.data.progression.ascend;
      const trade = asc.expTrade;
      const max = Math.min(asc.level, world.config.maxLevel);
      if (p.level < max) return sendDialog(p, npc, `승급은 ${max}레벨이 된 자만 할 수 있다. 더 수련하고 오게.`, [back]);
      const cost = trade.exp;
      const text = `쌓인 경험치: ${formatNumber(p.data.exp)}\n경험치 ${formatNumber(cost)}을(를) 바쳐 최대 체력 +${trade.hp} 또는 최대 마나 +${trade.mp}를 얻을 수 있다.\n(현재 승급 보너스: 체력 +${formatNumber(p.data.bonusHp)}, 마나 +${formatNumber(p.data.bonusMp)})`;
      if (arg === 'hp' || arg === 'mp') {
        if (p.data.exp < cost) return sendDialog(p, npc, `경험치가 부족하다.\n\n${text}`, [back]);
        p.data.exp -= cost;
        if (arg === 'hp') p.data.bonusHp += trade.hp;
        else p.data.bonusMp += trade.mp;
        p.recompute();
        p.map?.broadcast({ t: 'fx', fx: 'levelup', id: p.id });
        p.notice(arg === 'hp' ? `최대 체력 +${trade.hp}!` : `최대 마나 +${trade.mp}!`, 'good');
      }
      return sendDialog(p, npc, text, [
        { key: 'ascend:hp', label: `체력 +${trade.hp}` },
        { key: 'ascend:mp', label: `마나 +${trade.mp}` },
        back,
      ]);
    }
    case 'tp': {
      const idx = Number(arg);
      const s = service(npc, 'teleport', idx);
      if (!s) return;
      if (arg2 === undefined) {
        const opts = s.dests.map((d, i) => ({
          key: `tp:${idx}:${i}`,
          label: `${d.label}${d.price ? ` — ${formatNumber(d.price)} 골드` : ''}${d.minLevel ? ` (${d.minLevel}레벨 이상)` : ''}`,
        }));
        return sendDialog(p, npc, '어디로 가시겠어요?', [...opts, back]);
      }
      const d = s.dests[Number(arg2)];
      if (!d) return;
      const map = world.maps.get(d.map);
      if (!map) return;
      if (d.minLevel && p.level < d.minLevel && !p.isGm) return sendDialog(p, npc, `그곳은 ${d.minLevel}레벨 이상만 갈 수 있어요.`, [back]);
      const price = d.price ?? 0;
      if (p.data.gold < price && !p.isGm) return sendDialog(p, npc, '골드가 부족해요.', [back]);
      if (!p.isGm) p.data.gold -= price;
      p.markInv();
      p.send({ t: 'closeDialog' });
      p.talkingTo = null;
      world.transfer(p, map, d.x ?? map.def.spawn.x, d.y ?? map.def.spawn.y);
      p.map?.broadcast({ t: 'fx', fx: 'teleport', id: p.id });
      return;
    }
    case 'reset': {
      const idx = Number(arg);
      const s = service(npc, 'resetStats', idx);
      if (!s) return;
      if (arg2 !== 'yes') {
        return sendDialog(p, npc, `분배한 능력치를 모두 되돌려 다시 분배할 수 있게 해 주겠다. 비용은 ${formatNumber(s.price)} 골드다.`, [
          { key: `reset:${idx}:yes`, label: '초기화하기' },
          back,
        ]);
      }
      if (p.data.gold < s.price) return sendDialog(p, npc, '골드가 부족하다.', [back]);
      p.data.gold -= s.price;
      const refund = resetStatsOnData(p.data);
      p.recompute();
      p.markInv();
      return sendDialog(p, npc, `능력치를 초기화했다. 돌려받은 포인트: ${refund}. G 키로 다시 분배하게.`, [back]);
    }
    case 'storage':
      if (!service(npc, 'storage')) return;
      p.send({ t: 'storage', npc: npc.id, slots: p.data.storage, gold: p.data.storageGold });
      return;
  }
}

function hasShopItem(npc: Npc, itemId: string): boolean {
  return npc.def.services.some((s) => s.type === 'shop' && s.items.includes(itemId));
}

export function buy(world: World, p: Player, npcId: unknown, itemId: unknown, qtyRaw: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || typeof itemId !== 'string') return;
  if (!hasShopItem(npc, itemId)) return;
  const def = world.data.items.get(itemId);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, stackSize(def) > 1 ? 1000 : 10)) : 1;
  const cost = def.price * qty;
  if (p.data.gold < cost) return p.err('골드가 부족합니다.');
  if (!canFit(p.data, def, qty)) return p.err('소지품에 자리가 부족합니다.');
  p.data.gold -= cost;
  addItem(p.data, def, qty);
  p.markInv();
  p.markSelf();
  p.sys(`${def.name}${qty > 1 ? ` ${qty}개` : ''}을(를) ${formatNumber(cost)} 골드에 샀습니다.`);
}

export function sell(world: World, p: Player, npcId: unknown, slot: unknown, qtyRaw: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || !npc.def.services.some((s) => s.type === 'buy')) return;
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return;
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const unit = Math.floor(def.price / 2);
  if (unit <= 0) return p.err('이 물건은 팔 수 없습니다.');
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : 1;
  const taken = takeFromSlot(p.data, slot, qty);
  if (!taken) return;
  const gain = unit * taken.qty;
  p.data.gold += gain;
  p.markInv();
  p.markSelf();
  p.sys(`${def.name}${taken.qty > 1 ? ` ${taken.qty}개` : ''}을(를) ${formatNumber(gain)} 골드에 팔았습니다.`);
}

export function learn(world: World, p: Player, npcId: unknown, abilityId: unknown): void {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || typeof abilityId !== 'string') return;
  const def = world.data.abilities.get(abilityId);
  if (!def || def.classId === 'monster') return;
  const teaches = npc.def.services.some((s) => s.type === 'class' && s.classId === def.classId);
  if (!teaches) return;
  if (!abilityAllowedFor(def, p.data.classId) && !p.isGm) return p.err('다른 직업의 기술은 배울 수 없습니다.');
  if (p.level < def.level && !p.isGm) return p.err(`${def.level}레벨이 되어야 배울 수 있습니다.`);
  if (p.data.skills.includes(def.id) || p.data.spells.includes(def.id)) return p.err('이미 배운 기술입니다.');
  if (p.data.gold < def.price && !p.isGm) return p.err('골드가 부족합니다.');
  if (!learnOnData(p.data, def)) return p.err('더 이상 기술을 배울 수 없습니다.');
  if (!p.isGm) p.data.gold -= def.price;
  p.markAbilities();
  p.markInv();
  p.markSelf();
  p.notice(`${def.name}을(를) 배웠습니다! (${def.kind === 'skill' ? 'S' : 'D'} 키)`, 'good');
  pickOption(world, p, npcId, `learn:${def.classId}`);
}

function storageNpc(p: Player, npcId: unknown): Npc | null {
  const npc = npcFor(p, npcId, 'service');
  if (!npc || !npc.def.services.some((s) => s.type === 'storage')) return null;
  return npc;
}

function sendStorage(p: Player, npc: Npc): void {
  p.send({ t: 'storage', npc: npc.id, slots: p.data.storage, gold: p.data.storageGold });
}

export function deposit(world: World, p: Player, npcId: unknown, slot: unknown, qtyRaw: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof slot !== 'number' || !Number.isInteger(slot)) return;
  const s = p.data.inventory[slot];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : s.qty;
  const taken = takeFromSlot(p.data, slot, qty);
  if (!taken) return;
  const left = addToStorage(p.data, def, taken.qty);
  if (left > 0) {
    addItem(p.data, def, left);
    p.err('창고가 가득 찼습니다.');
  }
  p.markInv();
  sendStorage(p, npc);
}

export function withdraw(world: World, p: Player, npcId: unknown, index: unknown, qtyRaw: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof index !== 'number' || !Number.isInteger(index)) return;
  const s = p.data.storage[index];
  if (!s) return;
  const def = world.data.items.get(s.item);
  if (!def) return;
  const qty = typeof qtyRaw === 'number' && Number.isInteger(qtyRaw) ? Math.max(1, Math.min(qtyRaw, s.qty)) : s.qty;
  if (!canFit(p.data, def, qty)) return p.err('소지품에 자리가 부족합니다.');
  addItem(p.data, def, qty);
  s.qty -= qty;
  if (s.qty <= 0) p.data.storage.splice(index, 1);
  p.markInv();
  sendStorage(p, npc);
}

export function depositGold(p: Player, npcId: unknown, amount: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return;
  if (amount > p.data.gold) return p.err('골드가 부족합니다.');
  p.data.gold -= amount;
  p.data.storageGold += amount;
  p.markInv();
  p.markSelf();
  sendStorage(p, npc);
}

export function withdrawGold(p: Player, npcId: unknown, amount: unknown): void {
  const npc = storageNpc(p, npcId);
  if (!npc || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return;
  if (amount > p.data.storageGold) return p.err('맡긴 골드가 부족합니다.');
  p.data.storageGold -= amount;
  p.data.gold += amount;
  p.markInv();
  p.markSelf();
  sendStorage(p, npc);
}
