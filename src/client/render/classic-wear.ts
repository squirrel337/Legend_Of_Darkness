// 고전 도트 캐릭터의 몸과 직업별 의상 (DOM 없음).
// 맨몸(살) 위에 바지·신발·윗옷·치마·허리띠·소매를 차례로 덧칠합니다.
import { mixColor, parseColor, ramp, toHsl } from './classic-palette';
import { pack, type Mat, type Shade } from './classic-raster';
import { P, armAt, armPts, armSeg, legAt, legPts, legSeg, lerp, part, torsoEdge, torsoPoly, torsoY, type Ctx } from './classic-kit';

/** 몸통 명암 (세로 원기둥, 왼쪽이 밝음) */
export function torsoShade(x: Ctx, hw = 7.8): Shade {
  return { k: 'cyl', cx: x.r.cx + 0.6, hw };
}

/** 앞모습의 몸 가운데 선 (단추·여밈 자리) */
export function frontX(x: Ctx): number {
  return x.r.cx + (x.r.view === 'F' ? 1.2 : -0.6);
}

const furOf = (x: Ctx): Mat => ramp(mixColor(x.pal.mainHex, '#f2e4cc', 0.6), 0.9);

// ───────────────────────── 다리 ─────────────────────────

/** 발 (신발 모양): 발목에서 앞(+x)으로 */
function footShape(x: Ctx, near: boolean, m: Mat, id: number, kind: 'shoe' | 'bare' | 'boot' | 'sandal'): void {
  const { an, tip } = legPts(x, near);
  const back = x.r.view === 'B';
  const ax = an.x;
  const ay = an.y;
  const b = x.b;
  if (tip) {
    // 뒤꿈치를 든 발: 발끝이 아래로
    b.poly([ax - 1.7, ay - 0.6, ax + 1.7, ay - 0.6, ax + 2.3, ay + 3.1, ax - 0.6, ay + 3.3], m, id, { k: 'flat', l: near ? 0.5 : 0.1 });
    return;
  }
  const sole = Math.round(ay + 3.4);
  const toe = kind === 'boot' ? 4.0 : 3.4;
  const w = kind === 'boot' ? 0.6 : 0;
  const pts = back
    ? [ax - 2.1 - w, ay - 0.6, ax + 1.9 + w, ay - 0.6, ax + 2.5 + w, sole - 1.4, ax + 1.9 + w, sole, ax - 2.0 - w, sole, ax - 2.5 - w, sole - 1.3]
    : [ax - 1.9 - w, ay - 0.6, ax + 1.7 + w, ay - 0.6, ax + 1.9 + toe * 0.4 + w, sole - 2.4, ax + 1.6 + toe, sole - 1.4, ax + 1.4 + toe, sole, ax - 2.0 - w, sole, ax - 2.3 - w, sole - 1.0];
  b.poly(pts, m, id, { k: 'fn', f: (px, py) => (py < sole - 1.5 ? (px < ax ? 0.9 : 0.5) : px < ax - 0.5 ? 0.5 : 0.05) });
  if (kind === 'sandal') b.line(ax - 1.6, ay + 0.8, ax + 2.2, ay + 0.8, m.t[3], id);
  if (kind === 'bare') b.dot(ax + 1.4 + toe - 1, sole - 1, m.t[1], id);
}

export function drawLeg(x: Ctx, near: boolean): void {
  const { pal, c } = x;
  const id = near ? P.legN : P.legF;
  const pid = near ? P.pantsN : P.pantsF;
  const fid = near ? P.footN : P.footF;
  part(x, id, pal.skin.line, () => {
    legSeg(x, near, 0, 2, pal.skin, id);
    if (c.feet === 'wraps' || c.feet === 'greaves' || c.feet === 'shoes') footShape(x, near, pal.skin, id, 'bare');
  });
  const under = pal.under;
  part(x, pid, under.line, () => {
    switch (c.legs) {
      case 'pants':
        legSeg(x, near, 0, 1.82, under, pid, 0.35);
        break;
      case 'tights':
        legSeg(x, near, 0, 1.85, under, pid, 0.05);
        break;
      case 'baggy':
        legSeg(x, near, 0, 1.0, under, pid, 1.0);
        legSeg(x, near, 1.0, 1.62, under, pid, 0.85);
        break;
      case 'shorts':
        legSeg(x, near, 0, 0.5, under, pid, 0.55);
        break;
      default:
        break;
    }
  }, [id]);
  const boot = pal.boot;
  part(
    x,
    fid,
    boot.line,
    () => {
      switch (c.feet) {
        case 'tallboots': {
          legSeg(x, near, 1.2, 2, boot, fid, 0.85);
          footShape(x, near, boot, fid, 'boot');
          // 장화 윗단 (접은 가죽, 밝게)
          const a = legAt(x, near, 1.16);
          const bb = legAt(x, near, 1.3);
          x.b.capsule(a[0], a[1], bb[0], bb[1], a[2] + 1.15, bb[2] + 1.15, boot, fid, 0.45);
          break;
        }
        case 'boots':
          legSeg(x, near, 1.48, 2, boot, fid, 0.8);
          footShape(x, near, boot, fid, 'boot');
          {
            const a = legAt(x, near, 1.46);
            x.b.capsule(a[0] - 0.5, a[1], a[0] + 0.5, a[1], a[2] + 1.0, a[2] + 1.0, boot, fid, 0.45);
          }
          break;
        case 'greaves': {
          legSeg(x, near, 1.1, 1.92, pal.metal, fid, 0.45);
          footShape(x, near, pal.leather, fid, 'sandal');
          const k = legAt(x, near, 1.12);
          x.b.ellipse(k[0], k[1], k[2] + 0.7, 1.6, pal.metal, fid);
          break;
        }
        case 'wraps':
          legSeg(x, near, 1.45, 1.94, pal.white, fid, 0.2);
          for (const t of [1.55, 1.7, 1.85]) {
            const p = legAt(x, near, t);
            x.b.line(p[0] - p[2], p[1] - 0.5, p[0] + p[2], p[1] + 0.5, pal.white.t[1], fid);
          }
          break;
        case 'furboots': {
          const fur = furOf(x);
          legSeg(x, near, 1.35, 2, boot, fid, 0.55);
          footShape(x, near, boot, fid, 'boot');
          const a = legAt(x, near, 1.33);
          x.b.ellipse(a[0], a[1] + 0.5, a[2] + 1.3, 1.8, fur, fid);
          break;
        }
        default:
          // 낮은 가죽신
          legSeg(x, near, 1.8, 2, boot, fid, 0.35);
          footShape(x, near, boot, fid, 'shoe');
      }
    },
    [pid],
  );
}

// ───────────────────────── 팔 ─────────────────────────

export function drawArm(x: Ctx, near: boolean): void {
  const { pal, c } = x;
  const id = near ? P.armN : P.armF;
  const sid = near ? P.sleeveN : P.sleeveF;
  part(x, id, pal.skin.line, () => armSeg(x, near, 0, 2, pal.skin, id));
  const main = pal.main;
  part(
    x,
    sid,
    main.line,
    () => {
      switch (c.sleeve) {
        case 'short':
          armSeg(x, near, 0, 0.62, c.top === 'armor' ? pal.under : main, sid, 0.5);
          break;
        case 'long':
          armSeg(x, near, 0, 1.9, main, sid, 0.3);
          break;
        case 'puff':
          armSeg(x, near, 0, 0.75, pal.white, sid, 0.9);
          armSeg(x, near, 0.75, 1.88, pal.white, sid, 0.3);
          {
            const p = armAt(x, near, 1.88);
            x.b.ellipse(p[0], p[1], p[2] + 1.0, 1.4, pal.white, sid);
          }
          break;
        case 'wide': {
          armSeg(x, near, 0, 1.0, main, sid, 0.45);
          // 아래로 넓어지는 소매 + 장식 단
          const a = armAt(x, near, 1.0);
          const bb = armAt(x, near, 1.9);
          x.b.capsule(a[0], a[1], bb[0], bb[1], a[2] + 0.6, bb[2] + 1.6, main, sid, near ? 0.05 : -0.15);
          x.b.capsule(lerp(a[0], bb[0], 0.85), lerp(a[1], bb[1], 0.85), bb[0], bb[1], bb[2] + 1.4, bb[2] + 1.7, x.pal.trim, sid, near ? 0.05 : -0.15);
          break;
        }
        default:
          break;
      }
      if (c.bracers) armSeg(x, near, 1.42, 1.92, c.top === 'armor' ? main : x.outfit === 'gladiator' ? pal.leather : pal.leather, sid, 0.45);
      if (c.wraps) {
        armSeg(x, near, 1.3, 1.95, pal.white, sid, 0.25);
        for (const t of [1.45, 1.65, 1.85]) {
          const p = armAt(x, near, t);
          x.b.dot(p[0] - 0.5, p[1], pal.white.t[1], sid);
        }
      }
    },
    [id],
  );
}

export function drawHand(x: Ctx, near: boolean, fist = false): void {
  const { pal } = x;
  const { ha } = armPts(x, near);
  const id = near ? P.handN : P.handF;
  const R = x.r.d.handR;
  part(x, id, pal.skin.line, () => {
    x.b.ellipse(ha.x, ha.y + 0.3, R, fist ? R : R * 1.05, pal.skin, id);
  });
}

/** 어깨 보호대 (전사: 양쪽 / 검투사: 가까운 쪽 하나) */
export function drawPauldron(x: Ctx, near: boolean): void {
  const { pal, r, c } = x;
  if (!c.pauldrons) return;
  if (c.pauldrons === 'one' && !near) return;
  const { sh } = armPts(x, near);
  const ox = (near ? r.sN : -r.sN) * 0.9;
  if (x.outfit === 'gladiator') {
    // 검투사: 팔 위쪽을 덮는 청동 어깨 갑옷 (겹친 판 세 장)
    const m = ramp(mixColor('#b08840', pal.trimHex, 0.15), 1.25, 0.1);
    part(x, P.pauldron, m.line, () => {
      x.b.ellipse(sh.x + ox, sh.y - 0.4, 3.6, 2.6, m, P.pauldron);
      x.b.ellipse(sh.x + ox * 1.3, sh.y + 1.8, 3.3, 2.0, m, P.pauldron);
      x.b.ellipse(sh.x + ox * 1.5, sh.y + 3.6, 2.9, 1.6, m, P.pauldron);
      x.b.setClip([P.pauldron]);
      x.b.line(sh.x + ox * 1.3 - 3, sh.y + 0.8, sh.x + ox * 1.3 + 3, sh.y + 0.8, m.t[0], P.pauldron);
      x.b.line(sh.x + ox * 1.5 - 2.6, sh.y + 2.7, sh.x + ox * 1.5 + 2.6, sh.y + 2.7, m.t[0], P.pauldron);
      x.b.setClip(null);
    });
    return;
  }
  const m = pal.main;
  part(x, P.pauldron, m.line, () => {
    x.b.ellipse(sh.x + ox, sh.y - 0.2, 3.5, 2.9, m, P.pauldron);
    x.b.ellipse(sh.x + ox * 1.2, sh.y + 1.6, 3.0, 1.6, m, P.pauldron);
    // 가장자리 장식
    x.b.line(sh.x + ox - 2.8, sh.y + 2.6, sh.x + ox + 2.8, sh.y + 2.6, pal.trim.t[2], P.pauldron);
  });
}

// ───────────────────────── 몸통 ─────────────────────────

/** 맨몸 + 윗옷 + 치마 + 허리띠 */
export function drawTorso(x: Ctx): void {
  const { pal, c, r, b } = x;
  const d = r.d;
  const sh = torsoShade(x);
  const bottom = d.crotch;
  const waist = d.waist;
  const front = r.view === 'F';
  const fx = frontX(x);
  // 맨몸
  part(x, P.torso, pal.skin.line, () => b.poly(torsoPoly(x, 0, bottom), pal.skin, P.torso, sh));
  // 바지·속옷 윗부분 (엉덩이)
  if (c.legs !== 'bare') {
    const m = pal.under;
    part(x, P.cloth, m.line, () => b.poly(torsoPoly(x, waist + 1, bottom + 0.6, c.legs === 'baggy' ? 0.8 : 0.4), m, P.cloth, sh), [P.torso]);
  } else if (c.skirt !== 'loin') {
    // 맨다리: 짧은 속바지
    const m = pal.under;
    part(x, P.cloth, m.line, () => b.poly(torsoPoly(x, bottom - 4, bottom + 0.6, 0.3), m, P.cloth, sh), [P.torso]);
  }
  const main = pal.main;
  const trim = pal.trim;
  // 윗옷
  part(
    x,
    P.cloth,
    main.line,
    () => {
      switch (c.top) {
        case 'tank':
        case 'dress': {
          // 민소매: 좁은 어깨끈 + 둥근 목둘레
          const y0 = torsoY(x, 1);
          const len = c.top === 'dress' ? waist + 1.5 : waist + 4;
          const body = torsoPoly(x, 3, len, 0.35);
          b.poly(body, main, P.cloth, sh);
          b.poly(
            [torsoEdge(x, 1, -1, -1.7), y0, fx - 1.6, y0 + 0.6, fx + 1.4, y0 + 0.6, torsoEdge(x, 1, 1, -1.9), y0, torsoEdge(x, 3.5, 1, 0.35), torsoY(x, 3.5), torsoEdge(x, 3.5, -1, 0.35), torsoY(x, 3.5)],
            main,
            P.cloth,
            sh,
          );
          b.setClip([P.cloth]);
          b.ellipse(fx - 0.2, y0 + 0.4, 2.4, 1.9, pal.skin, P.cloth, 'flat', 0.6);
          b.setClip(null);
          break;
        }
        case 'armor': {
          // 사슬 받침 + 가슴판 + 목 보호대
          const plate = ramp(pal.mainHex, 1.4, 0.05);
          b.poly(torsoPoly(x, 0.5, waist + 3, 0.4), pal.under, P.cloth, sh);
          b.poly(torsoPoly(x, 1.2, waist + 1, 0.75), plate, P.cloth, torsoShade(x, 6.6));
          if (front) {
            // 가운데 능선과 배 판
            b.setClip([P.cloth]);
            b.line(fx, torsoY(x, 2.5), fx, torsoY(x, waist - 1), plate.t[3], P.cloth);
            b.line(fx + 1, torsoY(x, 2.5), fx + 1, torsoY(x, waist - 1), plate.t[1], P.cloth);
            const y1 = Math.round(torsoY(x, waist - 2.5));
            b.line(torsoEdge(x, waist - 2.5, -1), y1, torsoEdge(x, waist - 2.5, 1), y1, plate.t[0], P.cloth);
            b.setClip(null);
          }
          b.poly([torsoEdge(x, 0, -1, -1.4), torsoY(x, -0.4), torsoEdge(x, 0, 1, -1.6), torsoY(x, -0.4), torsoEdge(x, 1.6, 1, -0.6), torsoY(x, 1.6), torsoEdge(x, 1.6, -1, -0.6), torsoY(x, 1.6)], trim, P.cloth, { k: 'flat', l: 0.5 });
          break;
        }
        case 'jerkin': {
          // 가죽 조끼 (민소매), 가운데 여밈 끈
          b.poly(torsoPoly(x, 0.8, waist + 4, 0.45), main, P.cloth, sh);
          if (front) {
            b.setClip([P.cloth]);
            for (let k = 0; k < 4; k++) {
              const yy = torsoY(x, 3 + k * 2);
              b.dot(fx - 1, yy, main.t[3], P.cloth);
              b.dot(fx + 1, yy + 1, main.t[3], P.cloth);
            }
            b.line(fx, torsoY(x, 2), fx, torsoY(x, waist + 3), main.t[0], P.cloth);
            b.setClip(null);
          }
          break;
        }
        case 'robe':
        case 'layered': {
          b.poly(torsoPoly(x, 0.3, bottom, 0.5), main, P.cloth, sh);
          if (c.top === 'layered' && front) {
            // 앞이 트인 겉옷 사이로 속옷
            b.setClip([P.cloth]);
            b.poly([fx - 1.6, torsoY(x, 1), fx + 1.6, torsoY(x, 1), fx + 2.4, torsoY(x, bottom), fx - 2.0, torsoY(x, bottom)], pal.under, P.cloth, { k: 'flat', l: 0.5 });
            b.line(fx - 2, torsoY(x, 1), fx - 2.6, torsoY(x, bottom), trim.t[2], P.cloth);
            b.line(fx + 2, torsoY(x, 1), fx + 2.8, torsoY(x, bottom), trim.t[1], P.cloth);
            b.setClip(null);
          } else if (front) {
            // 깃 (V자) + 가운데 장식 선
            b.setClip([P.cloth]);
            b.line(fx - 2.4, torsoY(x, 0.5), fx, torsoY(x, 3.5), trim.t[2], P.cloth);
            b.line(fx + 2.2, torsoY(x, 0.5), fx, torsoY(x, 3.5), trim.t[1], P.cloth);
            b.line(fx, torsoY(x, 3.5), fx, torsoY(x, bottom), trim.t[2], P.cloth);
            b.setClip(null);
          }
          break;
        }
        case 'gi': {
          // 도복: 겹쳐 여민 깃
          const f = r.female;
          if (f) {
            b.poly(torsoPoly(x, 1.5, waist + 3, 0.4), main, P.cloth, sh);
            b.poly([torsoEdge(x, 1.5, -1, -1.6), torsoY(x, 1.2), torsoEdge(x, 1.5, 1, -1.8), torsoY(x, 1.2), torsoEdge(x, 3, 1, 0.4), torsoY(x, 3), torsoEdge(x, 3, -1, 0.4), torsoY(x, 3)], main, P.cloth, sh);
          } else b.poly(torsoPoly(x, 0.3, waist + 3, 0.5), main, P.cloth, sh);
          if (front) {
            b.setClip([P.cloth]);
            const lap = mixColor(x.pal.mainHex, '#fff8ec', 0.55);
            const lm = ramp(lap, 0.8);
            b.line(fx - 3, torsoY(x, 0.6), fx + 1.5, torsoY(x, waist), lm.t[2], P.cloth);
            b.line(fx - 2, torsoY(x, 0.6), fx + 2.5, torsoY(x, waist), lm.t[1], P.cloth);
            b.line(fx + 2.6, torsoY(x, 0.6), fx, torsoY(x, 4), main.t[0], P.cloth);
            if (!f) b.poly([fx - 1.6, torsoY(x, 0.4), fx + 2.0, torsoY(x, 0.4), fx + 0.2, torsoY(x, 3.4)], pal.skin, P.cloth, { k: 'flat', l: 0.4 });
            b.setClip(null);
          }
          break;
        }
        case 'vest': {
          // 흰 셔츠 + 조끼
          b.poly(torsoPoly(x, 0.3, waist + 3, 0.4), pal.white, P.cloth, sh);
          b.poly(torsoPoly(x, 1, waist + 2, 0.7), main, P.cloth, sh);
          if (front) {
            b.setClip([P.cloth]);
            b.poly([fx - 1.4, torsoY(x, 0.8), fx + 1.8, torsoY(x, 0.8), fx + 0.4, torsoY(x, waist + 1)], pal.white, P.cloth, { k: 'flat', l: 0.55 });
            for (let k = 0; k < 3; k++) b.dot(fx + 2, torsoY(x, 4 + k * 2.2), pal.gold.t[3], P.cloth);
            b.setClip(null);
          }
          break;
        }
        case 'fur': {
          // 털가죽 웃옷 (가슴만 가림) + 밝은 털 가장자리
          const fur = furOf(x);
          const len = r.female ? 7 : 8;
          if (r.female) b.poly(torsoPoly(x, 2.5, len, 0.45), main, P.cloth, sh);
          else {
            // 남자: 한쪽 어깨에 걸친 털가죽
            b.poly([torsoEdge(x, 1, -1, 0.5), torsoY(x, 1), fx + 1, torsoY(x, 1), torsoEdge(x, len, 1, 0.5), torsoY(x, len), torsoEdge(x, len + 1, 1, 0.5), torsoY(x, len + 2.5), torsoEdge(x, len, -1, 0.5), torsoY(x, len + 1)], main, P.cloth, sh);
          }
          b.setClip([P.cloth]);
          for (let xx = Math.floor(torsoEdge(x, len, -1, 1)); xx <= Math.ceil(torsoEdge(x, len, 1, 1)); xx++) {
            const yy = torsoY(x, r.female ? len : len + 1) + ((xx & 1) === 0 ? 0 : -1);
            b.dot(xx, yy, fur.t[2], P.cloth);
            b.dot(xx, yy - 1, fur.t[3], P.cloth);
          }
          b.setClip(null);
          break;
        }
        case 'tunic': {
          b.poly(torsoPoly(x, 0.3, waist + 3, 0.5), main, P.cloth, sh);
          if (front) {
            b.setClip([P.cloth]);
            b.poly([fx - 1.4, torsoY(x, 0.2), fx + 1.6, torsoY(x, 0.2), fx + 0.2, torsoY(x, 3.5)], pal.skin, P.cloth, { k: 'flat', l: 0.45 });
            b.dot(fx - 0.6, torsoY(x, 2), pal.leather.t[2], P.cloth);
            b.dot(fx + 1, torsoY(x, 2), pal.leather.t[2], P.cloth);
            b.setClip(null);
          }
          break;
        }
        case 'harness': {
          if (r.female) b.poly(torsoPoly(x, 2.6, 6.5, 0.45), main, P.cloth, sh);
          break;
        }
        default:
          break;
      }
    },
    [P.torso],
  );
  drawSkirt(x);
  drawBelt(x);
  // 몸통 위의 끈·장식
  if (c.top === 'harness') {
    const m = pal.leather;
    part(x, P.cloth, null, () => {
      const y0 = torsoY(x, 1);
      const y1 = torsoY(x, waist);
      const L = torsoEdge(x, 1, -1, -1.5);
      const R = torsoEdge(x, 1, 1, -1.5);
      const Lw = torsoEdge(x, waist, -1, 0);
      const Rw = torsoEdge(x, waist, 1, 0);
      for (const [ax, bx] of [[L, Rw], [R, Lw]] as const) {
        b.line(ax, y0, bx, y1, m.t[2], P.cloth);
        b.line(ax + 1, y0, bx + 1, y1, m.t[1], P.cloth);
      }
      if (front) {
        const mx = (L + Rw) / 2 + 0.2;
        b.ellipse(mx, (y0 + y1) / 2 + 0.3, 1.8, 1.8, pal.gold, P.cloth);
      }
    });
  }
  if (c.quiver && front) {
    // 화살통 멜빵 (가까운 어깨 → 먼 허리)
    part(x, P.cloth, null, () => {
      const y0 = torsoY(x, 0.8);
      const y1 = torsoY(x, waist + 1);
      const ax = torsoEdge(x, 1, -1, -2.2);
      const bx = torsoEdge(x, waist, 1, 0);
      b.line(ax, y0, bx, y1, pal.leather.t[2], P.cloth);
      b.line(ax + 1, y0, bx + 1, y1, pal.leather.t[1], P.cloth);
    });
  }
  if (c.stole && front) {
    // 사제의 영대: 양 어깨에서 무릎까지 내려오는 띠
    part(x, P.cloth, trim.line, () => {
      for (const s of [-1, 1]) {
        const xx = fx + s * 2.2;
        b.poly([xx - 1.1, torsoY(x, 0), xx + 1.1, torsoY(x, 0), xx + 1.2, -15, xx - 1.2, -15], trim, P.cloth, { k: 'flat', l: s < 0 ? 0.7 : 0.25 });
        b.dot(xx, torsoY(x, 5), pal.gold.t[3], P.cloth);
      }
    });
  }
  if (c.talisman && front) {
    // 부적
    part(x, P.cloth, pal.white.line, () => {
      const tx = torsoEdge(x, waist, -1, -1.2);
      const ty = torsoY(x, waist + 2);
      b.rect(Math.round(tx - 1), Math.round(ty), 3, 6, pal.white.t[2], P.cloth);
      b.rect(Math.round(tx), Math.round(ty + 1), 1, 3, pack(200, 40, 40), P.cloth);
    });
  }
}

/** 치마·로브 아랫단·허리 장식 */
function drawSkirt(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (c.skirt === 'none') return;
  const d = r.d;
  const waist = d.waist;
  const wy = torsoY(x, waist);
  const front = r.view === 'F';
  const fx = frontX(x);
  const main = pal.main;
  const sh = torsoShade(x, 8.5);
  const legL = Math.min(r.knN.x, r.knF.x, r.anN.x, r.anF.x);
  const legR = Math.max(r.knN.x, r.knF.x, r.anN.x, r.anF.x);
  part(
    x,
    P.skirt,
    main.line,
    () => {
      switch (c.skirt) {
        case 'robe': {
          const hemY = Math.max(r.anN.y, r.anF.y) - 0.5;
          const L = Math.min(torsoEdge(x, d.crotch, -1, 0.6), legL - 3.2);
          const R = Math.max(torsoEdge(x, d.crotch, 1, 0.6), legR + 3.4);
          b.poly([torsoEdge(x, waist, -1, 0.6), wy, torsoEdge(x, d.crotch, -1, 1.0), torsoY(x, d.crotch), L - 0.6, hemY, R + 0.6, hemY, torsoEdge(x, d.crotch, 1, 1.0), torsoY(x, d.crotch), torsoEdge(x, waist, 1, 0.6), wy], main, P.skirt, sh);
          b.setClip([P.skirt]);
          // 아랫단 장식
          b.rect(Math.floor(L - 1), Math.round(hemY) - 2, Math.ceil(R - L + 3), 1, pal.trim.t[2], P.skirt);
          if (front) {
            if (c.top === 'layered') {
              b.poly([fx - 2.0, wy, fx + 2.4, wy, fx + 3.6, hemY, fx - 2.6, hemY], pal.under, P.skirt, { k: 'flat', l: 0.5 });
              b.line(fx - 2.4, wy, fx - 3.0, hemY, pal.trim.t[2], P.skirt);
              b.line(fx + 2.6, wy, fx + 3.8, hemY, pal.trim.t[1], P.skirt);
            } else b.line(fx + 0.2, wy, fx + 0.8, hemY, pal.trim.t[2], P.skirt);
            // 다리 사이 주름
            const mid = (r.anN.x + r.anF.x) / 2 + 0.5;
            b.line(mid, -12, mid + 0.5, hemY - 2, main.t[0], P.skirt);
          }
          b.setClip(null);
          break;
        }
        case 'dress': {
          const hemY = -15;
          b.poly([torsoEdge(x, waist, -1, 0.4), wy, torsoEdge(x, d.crotch, -1, 1.4), torsoY(x, d.crotch), Math.min(legL - 2.2, torsoEdge(x, d.crotch, -1, 2.4)), hemY, Math.max(legR + 2.4, torsoEdge(x, d.crotch, 1, 2.4)), hemY, torsoEdge(x, d.crotch, 1, 1.4), torsoY(x, d.crotch), torsoEdge(x, waist, 1, 0.4), wy], main, P.skirt, sh);
          b.setClip([P.skirt]);
          const L = Math.min(legL - 2.2, torsoEdge(x, d.crotch, -1, 2.4));
          for (let k = 1; k < 4; k++) b.line(L + k * 3.2, torsoY(x, d.crotch) - 1, L + k * 3.4 - 0.5, hemY - 1, main.t[1], P.skirt);
          b.setClip(null);
          break;
        }
        case 'tunic': {
          const hemY = -16;
          b.poly([torsoEdge(x, waist, -1, 0.5), wy, torsoEdge(x, d.crotch, -1, 1.0), torsoY(x, d.crotch), Math.min(legL - 1.6, torsoEdge(x, d.crotch, -1, 1.6)), hemY, Math.max(legR + 1.8, torsoEdge(x, d.crotch, 1, 1.6)), hemY, torsoEdge(x, d.crotch, 1, 1.0), torsoY(x, d.crotch), torsoEdge(x, waist, 1, 0.5), wy], main, P.skirt, sh);
          if (front) {
            b.setClip([P.skirt]);
            b.line(fx + 0.5, torsoY(x, d.crotch) - 1, fx + 0.8, hemY, main.t[0], P.skirt);
            b.setClip(null);
          }
          break;
        }
        case 'tassets': {
          // 허리 아래 금속 판 두 장
          const t = torsoY(x, waist + 1.5);
          const m = ramp(pal.mainHex, 1.35, 0.05);
          for (const s of [1, -1]) {
            const near = s === r.sN;
            const k = legAt(x, near, 0.28);
            b.poly([k[0] - 3.3, t, k[0] + 3.1, t, k[0] + 3.3, k[1] + 1, k[0] - 3.5, k[1] + 1], m, P.skirt, { k: 'cyl', cx: k[0] - 0.5, hw: 4 });
            b.line(k[0] - 3.3, Math.round(k[1] + 0.5), k[0] + 3.1, Math.round(k[1] + 0.5), pal.trim.t[2], P.skirt);
          }
          break;
        }
        case 'straps': {
          // 가죽 띠 치마 (프테루게스)
          const t = torsoY(x, waist + 1.5);
          const L = Math.min(torsoEdge(x, d.crotch, -1, 1.2), legL - 1.4);
          const R = Math.max(torsoEdge(x, d.crotch, 1, 1.2), legR + 1.4);
          const n = 5;
          const w = (R - L) / n;
          for (let k = 0; k < n; k++) {
            const x0 = L + k * w;
            const len = k === 0 || k === n - 1 ? 7 : 8.5;
            b.poly([x0 + 0.3, t, x0 + w - 0.3, t, x0 + w - 0.2, t + len, x0 + 0.2, t + len], main, P.skirt, { k: 'flat', l: (k + 0.5) / n < 0.4 ? 0.7 : (k + 0.5) / n > 0.75 ? 0.15 : 0.5 });
            b.dot(x0 + w / 2, t + 1, pal.gold.t[3], P.skirt);
          }
          break;
        }
        case 'loin': {
          // 털가죽 허리두르개 (아랫단 들쭉날쭉)
          const fur = furOf(x);
          const t = torsoY(x, waist + 1);
          const L = Math.min(torsoEdge(x, d.crotch, -1, 0.8), legL - 1);
          const R = Math.max(torsoEdge(x, d.crotch, 1, 0.8), legR + 1);
          const pts = [torsoEdge(x, waist + 1, -1, 0.6), t];
          const n = 6;
          for (let k = 0; k <= n; k++) {
            const xx = L + ((R - L) * k) / n;
            const yy = torsoY(x, d.crotch) + 3.5 + (k % 2 === 0 ? 2.2 : 0) + (k > 1 && k < n - 1 ? 2 : 0);
            pts.push(xx, yy);
          }
          pts.push(torsoEdge(x, waist + 1, 1, 0.6), t);
          b.poly(pts, main, P.skirt, sh);
          b.setClip([P.skirt]);
          b.line(L, t + 1, R, t + 1, fur.t[3], P.skirt);
          b.setClip(null);
          break;
        }
        default:
          break;
      }
    },
    [P.torso, P.cloth],
  );
}

function drawBelt(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (c.belt === 'none') return;
  const waist = r.d.waist;
  const front = r.view === 'F';
  const fx = frontX(x);
  const m = c.belt === 'sash' ? pal.trim : c.belt === 'gold' ? pal.gold : pal.leather;
  const h = c.belt === 'sash' ? 2.6 : c.belt === 'gold' ? 2.4 : 1.8;
  part(x, P.belt, m.line, () => {
    const y0 = torsoY(x, waist + 0.2);
    b.poly([torsoEdge(x, waist, -1, 0.7), y0, torsoEdge(x, waist, 1, 0.7), y0, torsoEdge(x, waist + h, 1, 0.7), y0 + h, torsoEdge(x, waist + h, -1, 0.7), y0 + h], m, P.belt, torsoShade(x));
    if (front && c.belt !== 'sash') {
      const bx = Math.round(fx - 0.5);
      b.rect(bx, Math.round(y0), 2, Math.round(h), c.belt === 'gold' ? pal.gold.t[3] : pal.white.t[2], P.belt);
    }
    if (c.belt === 'sash') {
      // 매듭과 늘어진 끝 (먼 쪽 허리)
      const kx = torsoEdge(x, waist, 1, -1.5) + (front ? 0 : 0);
      const ky = y0 + 1;
      b.ellipse(kx, ky, 1.5, 1.4, m, P.belt);
      b.poly([kx - 0.8, ky, kx + 1.2, ky, kx + 1.8 + r.sway * 0.4, ky + 6, kx + 0.2 + r.sway * 0.4, ky + 6.5], m, P.belt, { k: 'flat', l: 0.2 });
    }
    if (c.belt === 'leather' && (x.outfit === 'rogue' || x.outfit === 'archer' || x.outfit === 'peasant')) {
      // 허리 주머니 (가까운 쪽)
      const px = torsoEdge(x, waist + 1, -1, -1.0);
      b.rect(Math.round(px - 1), Math.round(y0 + h), 3, 3, pal.leather.t[2], P.belt);
      b.dot(Math.round(px - 1), Math.round(y0 + h), pal.leather.t[3], P.belt);
    }
  }, [P.cloth, P.skirt, P.torso]);
}

// ───────────────────────── 목·스카프 ─────────────────────────

export function drawNeck(x: Ctx): void {
  const { pal, r, b } = x;
  const nx = r.head.x + (r.view === 'F' ? -0.2 : 0.4);
  part(x, P.neck, pal.skin.line, () => b.capsule(nx, r.head.y + 4.5, nx, torsoY(x, 1.5), 1.8, 2.0, pal.skin, P.neck, -0.3));
}

export function drawScarf(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (!c.scarf) return;
  const m = pal.trim;
  const nx = r.head.x + (r.view === 'F' ? 0 : 0.3);
  const ny = torsoY(x, 0.4);
  part(x, P.scarf, m.line, () => {
    b.ellipse(nx, ny, 4.4, 2.3, m, P.scarf);
    if (r.view === 'F') {
      // 앞으로 늘어진 끝
      b.poly([nx - 2.5, ny + 1, nx + 0.5, ny + 1, nx + 0.2 + r.sway * 0.3, ny + 8, nx - 2.6 + r.sway * 0.3, ny + 7.2], m, P.scarf, { k: 'flat', l: 0.55 });
    } else {
      // 등 뒤로 날리는 끝
      b.poly([nx - 1.6, ny + 1, nx + 1.2, ny + 1, nx - 1.0 + r.sway * 0.5, ny + 9, nx - 3.6 + r.sway * 0.5, ny + 8], m, P.scarf, { k: 'flat', l: 0.4 });
    }
  });
}

// ───────────────────────── 등 뒤의 것 (망토·화살통·꼬리) ─────────────────────────

/** 망토: 앞모습에서는 몸 뒤(어깨 양옆으로 보임), 뒷모습에서는 등을 덮음 */
export function drawCape(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (!c.cape) return;
  // 금빛·회색 장식이면 망토는 짙은 붉은색 (원작의 흔한 망토)
  const [h, s, l] = toHsl(parseColor(pal.trimHex));
  const goldish = h > 0.07 && h < 0.18 && s > 0.3 && l > 0.42;
  const capeHex = x.outfit === 'bard' ? mixColor(pal.trimHex, '#7a1c34', 0.55) : goldish || s < 0.12 ? '#8a1c26' : mixColor(pal.trimHex, '#100c18', 0.3);
  const m = ramp(capeHex, 1.1, 0.15);
  const long = c.cape === 'long';
  const y0 = torsoY(x, 0.6);
  const bottom = long ? -13 : torsoY(x, r.d.waist + 1.5);
  const L = torsoEdge(x, 1.5, -1, -0.2);
  const R = torsoEdge(x, 1.5, 1, -0.2);
  const mid = (L + R) / 2;
  const sw = r.sway * 0.8;
  part(x, P.cape, m.line, () => {
    if (r.view === 'F') {
      // 몸 뒤: 어깨 양옆과 다리 뒤로 끝자락이 보임
      b.poly([L + 1, y0, R - 1, y0, R + 0.6, bottom - 5, R - 1 + sw, bottom, L - 0.6 + sw, bottom, L - 1.6 + sw * 0.5, bottom - 6], m, P.cape, { k: 'cyl', cx: mid - 1, hw: 8 });
    } else {
      b.poly([L + 0.2, y0, R - 0.2, y0, R + 1.4 + sw * 0.5, bottom, mid + sw, bottom + 0.8, L - 1.4 + sw * 0.5, bottom], m, P.cape, { k: 'cyl', cx: mid - 1.5, hw: 8 });
      b.setClip([P.cape]);
      for (const k of [-0.28, 0.22]) {
        const xx = mid + k * (R - L);
        b.line(xx, y0 + 5, xx + k * 4 + sw * 0.5, bottom - 1, m.t[1], P.cape);
      }
      b.line(L + 0.5, y0, R - 0.5, y0, m.t[3], P.cape);
      b.setClip(null);
    }
  });
}

export function drawQuiver(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (!c.quiver) return;
  const m = pal.leather;
  const back = r.view === 'B';
  // 등에 비스듬히: 먼 어깨 위로 깃이 보임 (앞), 등 가운데 (뒤)
  const top = back ? { x: r.cx + 3.5, y: torsoY(x, -3.5) } : { x: r.cx + 5.2, y: torsoY(x, -3.5) };
  const bot = back ? { x: r.cx - 2.5, y: torsoY(x, 12) } : { x: r.cx + 1.0, y: torsoY(x, 10) };
  part(x, P.quiver, m.line, () => {
    b.capsule(top.x, top.y + 2, bot.x, bot.y, 2.2, 2.0, m, P.quiver);
    // 화살 깃
    for (let k = -1; k <= 1; k++) {
      const fx = top.x + k * 1.4;
      b.line(fx, top.y + 1, fx + 0.5, top.y - 3, pal.white.t[2], P.quiver);
      b.dot(fx + 0.5, top.y - 3, pack(200, 60, 50), P.quiver);
    }
    b.line(top.x - 2, top.y + 2, top.x + 2, top.y + 2, pal.gold.t[2], P.quiver);
  });
}

export function drawTail(x: Ctx): void {
  const { pal, c, r, b } = x;
  if (!c.tail) return;
  const m = pal.hair;
  const base = { x: r.cx + (r.view === 'F' ? -3 : -1), y: torsoY(x, r.d.waist + 4) };
  const sw = r.sway * 1.2;
  part(x, P.tail, m.line, () => {
    if (r.view === 'F') {
      // 몸 뒤에서 뒤쪽(왼쪽)으로 휘어 나옴
      b.capsule(base.x, base.y, base.x - 6 + sw, base.y + 4, 2.0, 2.6, m, P.tail);
      b.capsule(base.x - 6 + sw, base.y + 4, base.x - 9 + sw, base.y - 2, 2.6, 1.6, m, P.tail);
      b.ellipse(base.x - 9 + sw, base.y - 3, 1.6, 1.8, ramp(mixColor(x.pal.hairHex, '#ffffff', 0.55)), P.tail);
    } else {
      b.capsule(base.x, base.y, base.x - 3 + sw, base.y + 7, 2.0, 2.6, m, P.tail);
      b.capsule(base.x - 3 + sw, base.y + 7, base.x - 6 + sw, base.y + 2, 2.6, 1.6, m, P.tail);
      b.ellipse(base.x - 6 + sw, base.y + 1, 1.6, 1.8, ramp(mixColor(x.pal.hairHex, '#ffffff', 0.55)), P.tail);
    }
  });
}
