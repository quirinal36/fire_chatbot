/**
 * 평가셋으로 도면 인식 정확도를 잰다. 브라우저와 같은 코드(frontend/src/plan)를 Node 에서 돌린다.
 *
 *   npx tsx build-eval.ts ../../example_imgs     # 먼저 평가셋을 만든다
 *   npx tsx eval-plans.ts                        # 전부
 *   npx tsx eval-plans.ts STR                    # 벽·문·창만
 *   npx tsx eval-plans.ts SPA_000310275_1 --draw # 한 장만, 그림도 낸다
 *
 * 지표
 *   STR (벽·문·창 정답)
 *     벽 F1      정답 벽을 3px 늘린 띠 안에 우리 벽 픽셀이 들어오면 맞은 것으로 본다. 벽은 얇아서
 *                1~2px 어긋남을 틀렸다고 하면 아무 변화도 읽을 수 없다.
 *     개구부 F1  정답 문·창의 중심이 우리 후보 선분에서 벽 두께 안에 있으면 맞은 것
 *   SPA (공간 정답)
 *     방 IoU     정답 공간마다 가장 많이 겹치는 우리 방과의 IoU. 0.5 이상이면 맞힌 것
 *     누락       어떤 우리 방과도 0.2 넘게 겹치지 않는 정답 공간
 *     병합       우리 방 하나가 정답 공간 2개 이상과 0.2 넘게 겹침
 *     과분할     정답 공간 하나에 우리 방 2개 이상이 0.2 넘게 겹침
 *     미배정     건물 안 빈 바닥 중 어느 방에도 안 들어간 비율
 *
 * 축척은 평가셋이 정답에서 역산한 값을 쓴다 (build-eval.ts 참고). 치수 읽기 AI 는 부르지 않는다 —
 * 여기서 재려는 것은 방 나누기이지 축척이 아니다.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { wallMask, labelComponents, dilate, type Pt } from '../../frontend/src/plan/walls';
import { findOpenings, type Opening } from '../../frontend/src/plan/openings';
import { findRooms, outsideRegion, paintSegment } from '../../frontend/src/plan/rooms';

const DIR = '../../example_imgs/eval';
const OUT = 'out/eval';
/** 벽을 맞았다고 볼 여유 (m). 픽셀이 아니라 실제 길이로 두어야 도면 해상도가 달라도 같은 잣대가 된다 */
const WALL_TOL_M = 0.06;
/** 개구부를 맞았다고 볼 여유 (m) */
const GATE_TOL_M = 0.35;
/** 이 이상 겹치면 "관련 있다"고 본다 */
const OVERLAP = 0.2;
/** 이 이상이면 맞힌 방 */
const HIT_IOU = 0.5;
/** 판정 전 기본값: 이 폭(m) 이하 후보만 막는다 (planView 와 같아야 한다) */
const DEFAULT_SEAL_M = 1.3;

interface Truth {
  readonly name: string;
  readonly polygon: readonly Pt[];
  readonly text?: string;
}
interface EvalPlan {
  readonly id: string;
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  readonly pxPerMeter: number;
  readonly wallPx: number;
  readonly truth: readonly Truth[];
}

/** 정답 벽 두께(px). 평가셋이 폴리곤 넓이 ÷ 긴 변으로 재 둔 값이다 */
const truthWallPx = (plan: EvalPlan): number => plan.wallPx;

/** 다각형 안을 채운다 (짝수-홀수 규칙) */
function fillPolygon(mask: Uint8Array, w: number, h: number, poly: readonly Pt[], value = 1): void {
  if (poly.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as Pt;
      const b = poly[(i + 1) % poly.length] as Pt;
      if (a[1] === b[1]) continue;
      if (cy < Math.min(a[1], b[1]) || cy >= Math.max(a[1], b[1])) continue;
      xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.ceil((xs[i] as number) - 0.5));
      const ex = Math.min(w - 1, Math.floor((xs[i + 1] as number) - 0.5));
      for (let x = sx; x <= ex; x++) mask[y * w + x] = value;
    }
  }
}

const count = (m: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n++;
  return n;
};
const both = (a: Uint8Array, b: Uint8Array): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) n++;
  return n;
};
const centerOf = (poly: readonly Pt[]): Pt => {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / poly.length, sy / poly.length];
};
/** 점에서 선분까지의 거리 */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const f1 = (tp: number, fp: number, fn: number): number => (tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn));

interface Score {
  readonly id: string;
  readonly kind: string;
  readonly wallF1?: number;
  readonly openF1?: number;
  readonly roomHit?: number;
  readonly roomTotal?: number;
  readonly iou?: number;
  readonly missed?: number;
  readonly merged?: number;
  readonly split?: number;
  readonly unassigned?: number;
  /** 우리가 잰 굵은 벽 두께 ÷ 정답 축척으로 본 벽 두께. 1 에서 멀수록 두께 추정이 빗나간 것 */
  readonly thickRatio?: number;
}

function evaluate(plan: EvalPlan, draw: boolean, thickM: number): Score | null {
  const png = PNG.sync.read(readFileSync(join(DIR, `${plan.id}.png`)));
  const w = png.width;
  const h = png.height;
  const ppm = plan.pxPerMeter;
  if (!ppm) return null;

  // --thick=<m>: 축척으로 벽 두께를 정해서 추출한다 (두께 추정을 건너뛴다)
  const forced = thickM ? Math.max(2, Math.round(thickM * ppm)) : undefined;
  const res = wallMask(new Uint8ClampedArray(png.data), w, h, forced ? { wallPx: forced } : {});
  const mask = res.mask;
  const openings = findOpenings(mask, w, h, res.wallPx, ppm);
  const barriers = openings.filter((o) => o.widthM <= DEFAULT_SEAL_M).map((o) => ({ a: o.a, b: o.b }));
  const report = findRooms(mask, w, h, ppm, { barriers });

  const score: Record<string, number> = { thickRatio: res.wallPx / Math.max(1, truthWallPx(plan)) };

  if (plan.kind === 'STR') {
    // 벽 F1
    const truthWall = new Uint8Array(w * h);
    for (const t of plan.truth) if (t.name === '구조_벽체') fillPolygon(truthWall, w, h, t.polygon);
    const band = (Math.max(2, Math.round(WALL_TOL_M * ppm)) << 1) | 1;
    const truthBand = dilate(truthWall, w, h, band);
    const oursBand = dilate(mask, w, h, band);
    const tp = both(mask, truthBand);
    const fp = count(mask) - tp;
    const fn = count(truthWall) - both(truthWall, oursBand);
    score['wallF1'] = f1(tp, fp, Math.max(0, fn));

    // 개구부 F1: 정답 문·창 중심이 우리 후보 선분 근처에 있으면 맞은 것
    const gates = plan.truth.filter((t) => t.name === '구조_출입문' || t.name === '구조_창호');
    // 우리가 잰 벽 두께로 잣대를 삼으면 추정이 빗나간 도면에서 평가까지 흔들린다. 정답 축척으로 고정한다
    const tol = GATE_TOL_M * ppm;
    const used = new Set<number>();
    let hit = 0;
    for (const g of gates) {
      const c = centerOf(g.polygon);
      let best = -1;
      let bestD = tol;
      openings.forEach((o, i) => {
        if (used.has(i)) return;
        const d = distToSegment(c, o.a, o.b);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        used.add(best);
        hit++;
      }
    }
    score['openF1'] = f1(hit, openings.length - hit, gates.length - hit);
    score['roomTotal'] = gates.length;
  }

  if (plan.kind === 'SPA') {
    const spaces = plan.truth.filter((t) => t.name.startsWith('공간_') && t.name !== '공간_기타');
    const truthMasks = spaces.map((t) => {
      const m = new Uint8Array(w * h);
      fillPolygon(m, w, h, t.polygon);
      return m;
    });
    const ourMasks = report.rooms.map((r) => {
      const m = new Uint8Array(w * h);
      for (const poly of r.polygons) {
        fillPolygon(m, w, h, poly.outer);
        for (const hole of poly.holes) fillPolygon(m, w, h, hole, 0);
      }
      return m;
    });
    let hit = 0;
    let iouSum = 0;
    let missed = 0;
    let split = 0;
    const touchedBy = ourMasks.map(() => 0);
    truthMasks.forEach((tm) => {
      const ta = count(tm);
      let best = 0;
      let related = 0;
      ourMasks.forEach((om, j) => {
        const inter = both(tm, om);
        if (inter / Math.max(1, ta) > OVERLAP) {
          related++;
          touchedBy[j] = (touchedBy[j] ?? 0) + 1;
        }
        const iou = inter / Math.max(1, ta + count(om) - inter);
        if (iou > best) best = iou;
      });
      iouSum += best;
      if (best >= HIT_IOU) hit++;
      if (related === 0) missed++;
      if (related >= 2) split++;
    });
    score['roomHit'] = hit;
    score['roomTotal'] = spaces.length;
    score['iou'] = spaces.length ? iouSum / spaces.length : 0;
    score['missed'] = missed;
    score['merged'] = touchedBy.filter((n) => n >= 2).length;
    score['split'] = split;

    // 미배정: 건물 안 빈 바닥 중 어느 방에도 안 들어간 비율
    const sealed = mask.slice();
    for (const b of barriers) paintSegment(sealed, w, h, b.a, b.b, 3);
    const outside = outsideRegion(sealed, w, h, Math.max(3, Math.round(3 * ppm)) >> 1);
    const inRoom = new Uint8Array(w * h);
    for (const om of ourMasks) for (let i = 0; i < w * h; i++) if (om[i]) inRoom[i] = 1;
    let inside = 0;
    let assigned = 0;
    for (let i = 0; i < w * h; i++) {
      if (outside[i] || mask[i]) continue;
      inside++;
      if (inRoom[i]) assigned++;
    }
    score['unassigned'] = inside ? 1 - assigned / inside : 0;
  }

  if (draw) {
    mkdirSync(OUT, { recursive: true });
    const out = new PNG({ width: w, height: h });
    const PALETTE = [[230, 25, 75], [60, 180, 75], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128]];
    // 바탕: 원본을 흐리게
    for (let i = 0; i < w * h; i++) {
      const p = i << 2;
      const v = 255 - (255 - (png.data[p] ?? 255)) * 0.25;
      out.data[p] = v;
      out.data[p + 1] = v;
      out.data[p + 2] = v;
      out.data[p + 3] = 255;
    }
    // 우리 방: 색 채우기
    report.rooms.forEach((r, i) => {
      const c = PALETTE[i % PALETTE.length] as number[];
      const m = new Uint8Array(w * h);
      for (const poly of r.polygons) {
        fillPolygon(m, w, h, poly.outer);
        for (const hole of poly.holes) fillPolygon(m, w, h, hole, 0);
      }
      for (let k = 0; k < w * h; k++) {
        if (!m[k]) continue;
        const p = k << 2;
        out.data[p] = ((out.data[p] ?? 0) + (c[0] ?? 0)) / 2;
        out.data[p + 1] = ((out.data[p + 1] ?? 0) + (c[1] ?? 0)) / 2;
        out.data[p + 2] = ((out.data[p + 2] ?? 0) + (c[2] ?? 0)) / 2;
      }
    });
    // 우리 벽: 검정
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const p = i << 2;
      out.data[p] = 0;
      out.data[p + 1] = 0;
      out.data[p + 2] = 0;
    }
    // 정답 테두리: 빨강
    const edge = new Uint8Array(w * h);
    for (const t of plan.truth) {
      const m = new Uint8Array(w * h);
      fillPolygon(m, w, h, t.polygon);
      const d = dilate(m, w, h, 3);
      for (let i = 0; i < w * h; i++) if (d[i] && !m[i]) edge[i] = 1;
    }
    for (let i = 0; i < w * h; i++) {
      if (!edge[i]) continue;
      const p = i << 2;
      out.data[p] = 230;
      out.data[p + 1] = 20;
      out.data[p + 2] = 20;
    }
    // 개구부 후보: 파랑 선분
    for (const o of openings) {
      const line = new Uint8Array(w * h);
      paintSegment(line, w, h, o.a, o.b, 3);
      for (let i = 0; i < w * h; i++) {
        if (!line[i]) continue;
        const p = i << 2;
        out.data[p] = 30;
        out.data[p + 1] = 90;
        out.data[p + 2] = 220;
      }
    }
    writeFileSync(join(OUT, `${plan.id}.png`), PNG.sync.write(out));
  }

  return { id: plan.id, kind: plan.kind, ...score } as Score;
}

const args = process.argv.slice(2);
const draw = args.includes('--draw');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const thickM = Number(args.find((a) => a.startsWith('--thick='))?.slice(8) ?? 0);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f.includes(filter)).sort();

const scores: Score[] = [];
for (const f of files) {
  const plan = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as EvalPlan;
  if (plan.kind !== 'STR' && plan.kind !== 'SPA') continue;
  const s = evaluate(plan, draw, thickM);
  if (s) scores.push(s);
  else console.log(`${plan.id}: 축척을 몰라 건너뜀`);
}

const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number | undefined): string => (x === undefined ? '   -' : `${(x * 100).toFixed(0).padStart(3)}%`);

const str = scores.filter((s) => s.kind === 'STR');
const spa = scores.filter((s) => s.kind === 'SPA');

if (str.length) {
  console.log('\n=== STR (벽·문·창) ===');
  console.log('id                     벽F1  개구부F1  정답개구부  두께비');
  for (const s of str) console.log(`${s.id.padEnd(22)} ${pct(s.wallF1)}  ${pct(s.openF1)}      ${String(s.roomTotal ?? 0).padStart(3)}     ${(s.thickRatio ?? 0).toFixed(2)}`);
  console.log(`${'평균'.padEnd(21)} ${pct(avg(str.map((s) => s.wallF1 ?? 0)))}  ${pct(avg(str.map((s) => s.openF1 ?? 0)))}              ${avg(str.map((s) => s.thickRatio ?? 0)).toFixed(2)}`);
}
if (spa.length) {
  console.log('\n=== SPA (방 구획) ===');
  console.log('id                     맞힌방/정답  평균IoU  누락 병합 과분할  미배정  두께비');
  for (const s of spa) {
    console.log(
      `${s.id.padEnd(22)} ${String(s.roomHit ?? 0).padStart(4)}/${String(s.roomTotal ?? 0).padEnd(3)}  ${pct(s.iou)}   ${String(s.missed ?? 0).padStart(3)} ${String(s.merged ?? 0).padStart(4)} ${String(s.split ?? 0).padStart(5)}   ${pct(s.unassigned)}   ${(s.thickRatio ?? 0).toFixed(2)}`,
    );
  }
  const hit = spa.reduce((a, s) => a + (s.roomHit ?? 0), 0);
  const tot = spa.reduce((a, s) => a + (s.roomTotal ?? 0), 0);
  console.log(
    `${'합계·평균'.padEnd(19)} ${String(hit).padStart(4)}/${String(tot).padEnd(3)}  ${pct(avg(spa.map((s) => s.iou ?? 0)))}   ${String(spa.reduce((a, s) => a + (s.missed ?? 0), 0)).padStart(3)} ${String(spa.reduce((a, s) => a + (s.merged ?? 0), 0)).padStart(4)} ${String(spa.reduce((a, s) => a + (s.split ?? 0), 0)).padStart(5)}   ${pct(avg(spa.map((s) => s.unassigned ?? 0)))}`,
  );
}
if (thickM) console.log(`\n(벽 두께를 축척 × ${thickM}m 로 고정해서 돌렸다)`);
if (draw) console.log(`\n그림: ${OUT}/`);
