// 관리자 페이지 "직업·스킬트리" 탭의 API (/api/admin/design...). 경로와 주고받는 형식은 확정이고,
// 몸통(파일 쓰기·판 기록·바로 반영)은 관리자 트랙이 채웁니다. 형식은 src/shared/progression.ts 의 "관리자 편집기 API 형식".
//
//   GET  /api/admin/design                     → DesignBundle (지금 설계 + 편집기가 고를 기술·아이템·직업 + rev)
//   PUT  /api/admin/design/skilltree/:classId   SkillTreeSaveBody   → DesignSaveResult
//   PUT  /api/admin/design/progression          ProgressionSaveBody → DesignSaveResult
//   GET  /api/admin/design/history              → DesignHistoryList (data/design-history/, 새것부터)
//   POST /api/admin/design/restore              DesignRestoreBody   → DesignSaveResult
//
// 저장 순서 (관리자 트랙): rev 비교(다르면 409) → GameData 의 checkDesign/checkAbilityPatches 로 검사(오류면 400, dryRun 이면 여기까지)
//   → 지금 파일들을 data/design-history/<시각>-<종류>[-직업].json 에 남김 → gamedata/ 에 임시 파일로 쓰고 이름 바꾸기
//     (스킬트리 저장은 노드의 level/abilityLevel·gold 를 abilities.json 의 level·price 에도 맞춰 씀)
//   → world.data.applyDesign(...) 로 바로 반영 → 접속자 모두에게 { t: 'design' } 보내고 p.recompute() + p.markSelf()
//   → 감사 기록(world.audit). 인증은 api.ts 가 이 처리기를 부르기 전에 끝냅니다.
import { isClassId } from '../../shared/constants';
import type { World } from '../world/World';

/** 처리한 요청의 응답: HTTP 상태와 JSON 본문 */
export interface DesignReply {
  status: number;
  body: unknown;
}

const NOT_YET: DesignReply = { status: 501, body: { ok: false, msg: '직업·스킬트리 편집기는 아직 준비 중입니다.' } };

export class DesignApi {
  constructor(private readonly world: World) {}

  /**
   * /design 으로 시작하는 요청이면 처리해 응답을 돌려주고, 아니면 null.
   * path 는 '/api/admin' 을 뗀 경로, readBody 는 본문 JSON 을 읽는 함수, actor 는 감사 기록에 남길 이름입니다.
   */
  async handle(method: string, path: string, readBody: () => Promise<Record<string, unknown>>, actor: string): Promise<DesignReply | null> {
    if (path !== '/design' && !path.startsWith('/design/')) return null;
    void this.world;
    void readBody;
    void actor;
    if (path === '/design' && method === 'GET') return NOT_YET;
    const tree = /^\/design\/skilltree\/([^/]+)$/.exec(path);
    if (tree && method === 'PUT') {
      if (!isClassId(decodeURIComponent(tree[1]!))) return { status: 404, body: { ok: false, msg: '알 수 없는 직업입니다.' } };
      return NOT_YET;
    }
    if (path === '/design/progression' && method === 'PUT') return NOT_YET;
    if (path === '/design/history' && method === 'GET') return NOT_YET;
    if (path === '/design/restore' && method === 'POST') return NOT_YET;
    return { status: 404, body: { ok: false, msg: '알 수 없는 요청입니다.' } };
  }
}
