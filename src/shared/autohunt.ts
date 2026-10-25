// 자동사냥 설정 (서버와 클라이언트가 함께 씀)

/** 자동사냥이 지금 하고 있는 일 (화면 표시용) */
export type AutoState = 'idle' | 'searching' | 'moving' | 'fighting' | 'looting' | 'healing' | 'resting' | 'returning';

export const AUTO_STATE_NAMES: Record<AutoState, string> = {
  idle: '대기',
  searching: '사냥감 찾는 중',
  moving: '이동 중',
  fighting: '전투 중',
  looting: '줍는 중',
  healing: '회복 중',
  resting: '쉬는 중',
  returning: '돌아가는 중',
};

export interface AutoSettings {
  /** 체력이 이 비율(%) 아래로 떨어지면 회복 기술이나 물약을 씁니다 (0이면 쓰지 않음) */
  hpPct: number;
  /** 마나가 이 비율(%) 아래로 떨어지면 마나 물약이나 마나 회복 기술을 씁니다 (0이면 쓰지 않음) */
  mpPct: number;
  /** 쓸 기술/마법 id (앞쪽일수록 먼저). 비어 있으면 autoAbilities 에 따름 */
  abilities: string[];
  /** abilities 가 비어 있을 때 배운 공격 기술을 알아서 고릅니다 */
  autoAbilities: boolean;
  /** 자신(또는 그룹)에게 거는 강화 기술이 꺼져 있으면 다시 겁니다 */
  buffs: boolean;
  /** 내 전리품(과 주인 없는 아이템)을 줍습니다 */
  pickup: boolean;
  /** 자동사냥을 시작한 곳에서 벗어날 수 있는 거리 (칸) */
  radius: number;
  /** 물약이 떨어져 위험하면 귀환 주문서로 마을로 돌아갑니다 */
  recall: boolean;
  /** 내 레벨보다 이만큼 넘게 높은 몬스터는 노리지 않습니다 (0이면 제한 없음) */
  maxLevelGap: number;
}

export const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  hpPct: 50,
  mpPct: 30,
  abilities: [],
  autoAbilities: true,
  buffs: true,
  pickup: true,
  radius: 12,
  recall: true,
  maxLevelGap: 15,
};

export const AUTO_RADIUS_MIN = 3;
export const AUTO_RADIUS_MAX = 30;
export const AUTO_MAX_ABILITIES = 20;

const clampInt = (v: unknown, lo: number, hi: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/** 클라이언트가 보낸 설정을 검사해 안전한 값으로 만듭니다 */
export function sanitizeAutoSettings(raw: unknown): AutoSettings {
  const d = DEFAULT_AUTO_SETTINGS;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d, abilities: [] };
  const r = raw as Record<string, unknown>;
  const abilities = Array.isArray(r.abilities)
    ? [...new Set(r.abilities.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, AUTO_MAX_ABILITIES)
    : [];
  return {
    hpPct: clampInt(r.hpPct, 0, 95, d.hpPct),
    mpPct: clampInt(r.mpPct, 0, 95, d.mpPct),
    abilities,
    autoAbilities: bool(r.autoAbilities, d.autoAbilities),
    buffs: bool(r.buffs, d.buffs),
    pickup: bool(r.pickup, d.pickup),
    radius: clampInt(r.radius, AUTO_RADIUS_MIN, AUTO_RADIUS_MAX, d.radius),
    recall: bool(r.recall, d.recall),
    maxLevelGap: clampInt(r.maxLevelGap, 0, 99, d.maxLevelGap),
  };
}
