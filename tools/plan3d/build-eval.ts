/**
 * AI Hub 건축 도면 데이터를 평가셋으로 가공한다.
 *
 *   npx tsx build-eval.ts ../../example_imgs
 *
 * 받는 것: <root>/01.원천데이터/{OBJ,OCR,SPA,STR}/*.PNG 와 <root>/02.라벨링데이터/.../*.json (COCO 형식)
 * 내는 것: <root>/eval/<id>.png (평면도 한 장, 긴 변 1600px) + <root>/eval/<id>.json (정답)
 *
 * 왜 가공이 필요한가
 *   1. 한 시트(A3)에 평면도가 2~3개 들어 있다. 우리 파이프라인은 한 건물을 가정하므로 잘라야 한다.
 *   2. 시트의 8할이 여백이다. 그대로 1600px 로 줄이면 벽이 3px 가 된다.
 *   3. 정답에 축척 숫자가 없다. 벽 두께로 역산한다 (아래 SCALE_WALL_M).
 *
 * 축척 역산의 근거: APT_FP_STR_000477071 왼쪽 평면도는 치수선에 전체 폭 10,330mm 가 적혀 있고
 * 정답 벽체 bbox 폭이 1497px 이라 144.9px/m 이다. 그 도면의 벽 두께 중앙값이 29px 이므로 0.20m 다
 * (29 ÷ 0.20 = 145px/m, 치수선 실측과 0.1% 안에서 맞는다). A3 300dpi 에 축척 1/80 이면 147.6px/m 이니
 * 이론값과도 2% 안이다.
 *
 * 두께는 **폴리곤 넓이 ÷ 긴 변**으로 잰다. bbox 짧은 변을 쓰면 안 된다 — 벽체 주석 하나가 ㄱ자·ㄷ자로
 * 여러 벽을 아우르는 경우가 많아 bbox 가 실제 두께의 2~3배가 된다. 처음에 이것을 놓쳐 축척이
 * 2~3배 크게 잡혔고, 그 탓에 우리 두께 추정이 실제보다 훨씬 나쁘게 보였다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PNG } from 'pngjs';

/** 벽 두께 중앙값을 이 값으로 보고 축척을 역산한다 (m) */
const SCALE_WALL_M = 0.2;
/**
 * 벽 주석이 없는 종류(SPA)는 공간 면적으로 축척을 역산한다. 한국 아파트의 표준적인 면적(㎡)이고,
 * 한 도면에서 여러 종류를 각각 계산해 중앙값을 쓴다 — 하나가 유별나도 결과가 끌려가지 않는다.
 * 이미지에서 벽 두께를 재는 방법은 쓰지 못한다. 이 도면들은 치수선·가구·해치가 가득한 상세도라
 * 두께 추정이 2px(가는 선)를 벽으로 잡는다.
 */
const SPACE_AREA_M2: Readonly<Record<string, number>> = {
  공간_화장실: 4.0,
  공간_침실: 12.0,
  공간_거실: 20.0,
  공간_현관: 3.0,
  공간_주방: 10.0,
  공간_드레스룸: 4.0,
  공간_발코니: 6.0,
  공간_실외기실: 1.5,
};
/** 잘라낸 평면도를 이 크기로 줄인다 (브라우저 전처리와 같다) */
const MAX_SIDE = 1600;
/** 평면도를 가를 때 쓰는 x 방향 간격. 시트 폭의 이 비율보다 벌어지면 다른 평면도로 본다 */
const SPLIT_GAP = 0.06;
/** 이만큼보다 주석이 적은 덩어리는 평면도가 아니라 표제란·범례로 본다 */
const MIN_ANNOTATIONS = 5;
/** 자를 때 주석 범위 밖으로 더 두는 여백 (벽 두께의 배수). 치수선과 외벽 바깥이 들어가야 한다 */
const MARGIN_WALLS = 4;

type Pt = readonly [number, number];
interface CocoAnn {
  readonly category_id: number;
  readonly bbox: readonly number[];
  readonly segmentation: readonly (readonly number[])[];
  readonly attributes?: Record<string, unknown>;
}
interface Coco {
  readonly categories: readonly { id: number; name: string }[];
  readonly images: readonly { width: number; height: number; file_name: string }[];
  readonly annotations: readonly CocoAnn[];
}

/** 평가셋 한 장. 좌표는 모두 내보낸 PNG 기준 픽셀 */
export interface EvalPlan {
  readonly id: string;
  /** 원본 시트 파일 이름과 그 안에서 몇 번째 평면도인지 */
  readonly sheet: string;
  readonly index: number;
  readonly kind: 'STR' | 'SPA' | 'OCR' | 'OBJ';
  readonly width: number;
  readonly height: number;
  /** 1m 당 픽셀. 벽 두께에서 역산한 값이라 어림이다 */
  readonly pxPerMeter: number;
  /** 정답 벽 두께 중앙값 (내보낸 PNG 기준 px). 넓이 ÷ 긴 변으로 쟀다 */
  readonly wallPx: number;
  /** 정답. 종류마다 폴리곤 목록 */
  readonly truth: readonly { readonly name: string; readonly polygon: readonly Pt[]; readonly text?: string }[];
}

const KINDS = ['STR', 'SPA', 'OCR', 'OBJ'] as const;

/** 다각형 넓이 (신발끈 공식) */
function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** 값들을 한 줄에 늘어놓고 gap 보다 벌어진 곳에서 끊는다 */
function splitByGap<T>(items: readonly T[], at: (t: T) => number, gap: number): T[][] {
  const sorted = [...items].sort((a, b) => at(a) - at(b));
  const out: T[][] = [];
  let cur: T[] = [];
  let last = -Infinity;
  for (const it of sorted) {
    if (cur.length && at(it) - last > gap) {
      out.push(cur);
      cur = [];
    }
    cur.push(it);
    last = at(it);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** COCO segmentation([x1,y1,x2,y2,…]) 을 점 배열로 */
function toPolygon(seg: readonly number[]): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < seg.length; i += 2) pts.push([seg[i] as number, seg[i + 1] as number]);
  return pts;
}

/** 상자 안이면서 축소한 좌표로 옮긴다 */
const mapPt = (p: Pt, x0: number, y0: number, s: number): Pt => [(p[0] - x0) * s, (p[1] - y0) * s];

/**
 * 잘라내고 줄인다. 원본이 4963×3509 이고 평면도가 그 1/4 이므로, 먼저 자른 뒤에 줄여야
 * 벽이 살아남는다. 줄일 때는 박스 평균을 쓴다 (브라우저의 drawImage 와 같은 정도).
 */
function cropResize(src: PNG, x0: number, y0: number, w: number, h: number, scale: number): PNG {
  const ow = Math.max(1, Math.round(w * scale));
  const oh = Math.max(1, Math.round(h * scale));
  const out = new PNG({ width: ow, height: oh });
  const step = 1 / scale;
  for (let y = 0; y < oh; y++) {
    const sy0 = Math.floor(y0 + y * step);
    const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.floor(y0 + (y + 1) * step)));
    for (let x = 0; x < ow; x++) {
      const sx0 = Math.floor(x0 + x * step);
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.floor(x0 + (x + 1) * step)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = Math.max(0, sy0); yy < sy1; yy++) {
        for (let xx = Math.max(0, sx0); xx < sx1; xx++) {
          const p = (yy * src.width + xx) << 2;
          const a = (src.data[p + 3] ?? 255) / 255;
          // 투명은 흰 바탕으로 본다. 검정으로 읽히면 도면 전체가 벽이 된다
          r += (src.data[p] ?? 255) * a + 255 * (1 - a);
          g += (src.data[p + 1] ?? 255) * a + 255 * (1 - a);
          b += (src.data[p + 2] ?? 255) * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * ow + x) << 2;
      out.data[o] = n ? r / n : 255;
      out.data[o + 1] = n ? g / n : 255;
      out.data[o + 2] = n ? b / n : 255;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function buildSheet(root: string, kind: (typeof KINDS)[number], jsonPath: string): EvalPlan[] {
  const coco = JSON.parse(readFileSync(jsonPath, 'utf8')) as Coco;
  const names = new Map(coco.categories.map((c) => [c.id, c.name]));
  const sheetW = coco.images[0]?.width ?? 0;
  const sheetH = coco.images[0]?.height ?? 0;
  const file = coco.images[0]?.file_name ?? '';
  // background 는 시트 전체를 덮으므로 가르기에 쓰면 안 된다
  const anns = coco.annotations.filter((a) => (names.get(a.category_id) ?? '') !== 'background' && a.segmentation.length > 0);
  if (!anns.length) return [];

  const groups = splitByGap(anns, (a) => (a.bbox[0] as number) + (a.bbox[2] as number) / 2, sheetW * SPLIT_GAP).filter((g) => g.length >= MIN_ANNOTATIONS);
  if (!groups.length) return [];

  const imgPath = join(root, '01.원천데이터', kind, file);
  if (!existsSync(imgPath)) {
    console.warn(`  원본 없음: ${file}`);
    return [];
  }
  const src = PNG.sync.read(readFileSync(imgPath));

  const out: EvalPlan[] = [];
  groups.forEach((group, i) => {
    // 축척: 이 평면도 안의 벽 두께(짧은 변) 중앙값. 벽이 없는 종류(SPA·OCR·OBJ)는 시트 전체에서 찾는다
    const wallsHere = group.filter((a) => names.get(a.category_id) === '구조_벽체');
    const thicks = wallsHere
      .map((a) => {
        const long = Math.max(a.bbox[2] as number, a.bbox[3] as number);
        return long >= 5 ? polygonArea(toPolygon(a.segmentation[0] ?? [])) / long : 0;
      })
      .filter((t) => t > 0);
    const thick = thicks.length >= 5 ? median(thicks) : 0;
    // 벽이 없으면 공간 면적으로 (종류마다 하나씩 구해 중앙값)
    const byArea: number[] = [];
    if (!thick) {
      for (const [name, m2] of Object.entries(SPACE_AREA_M2)) {
        const areas = group.filter((a) => names.get(a.category_id) === name).map((a) => polygonArea(toPolygon(a.segmentation[0] ?? [])));
        if (areas.length) byArea.push(Math.sqrt(median(areas) / m2));
      }
    }

    const xs = group.flatMap((a) => [a.bbox[0] as number, (a.bbox[0] as number) + (a.bbox[2] as number)]);
    const ys = group.flatMap((a) => [a.bbox[1] as number, (a.bbox[1] as number) + (a.bbox[3] as number)]);
    const margin = (thick || 30) * MARGIN_WALLS;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - margin));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - margin));
    const x1 = Math.min(sheetW, Math.ceil(Math.max(...xs) + margin));
    const y1 = Math.min(sheetH, Math.ceil(Math.max(...ys) + margin));
    const cw = x1 - x0;
    const ch = y1 - y0;
    const scale = Math.min(1, MAX_SIDE / Math.max(cw, ch));

    const png = cropResize(src, x0, y0, cw, ch, scale);
    const id = `${kind}_${basename(jsonPath, '.json').replace(/^APT_FP_[A-Z]+_/, '')}_${i + 1}`;
    const truth = group.map((a) => ({
      name: names.get(a.category_id) ?? '?',
      polygon: toPolygon(a.segmentation[0] ?? []).map((p) => mapPt(p, x0, y0, scale)),
      ...(typeof a.attributes?.['OCR'] === 'string' ? { text: a.attributes['OCR'] as string } : {}),
    }));

    const dir = join(root, 'eval');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.png`), PNG.sync.write(png));
    const plan: EvalPlan = {
      id,
      sheet: file,
      index: i + 1,
      kind,
      width: png.width,
      height: png.height,
      pxPerMeter: thick ? (thick * scale) / SCALE_WALL_M : byArea.length >= 2 ? median(byArea) * scale : 0,
      wallPx: Math.round(thick * scale),
      truth,
    };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(plan));
    out.push(plan);
  });
  return out;
}

const root = process.argv[2] ?? '../../example_imgs';
let total = 0;
for (const kind of KINDS) {
  const dir = join(root, '02.라벨링데이터', kind);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  console.log(`=== ${kind} (${files.length}장) ===`);
  for (const f of files) {
    const plans = buildSheet(root, kind, join(dir, f));
    total += plans.length;
    for (const p of plans) {
      console.log(`  ${p.id}: ${p.width}×${p.height}, 벽 ${p.wallPx || '-'}px, ${p.pxPerMeter ? p.pxPerMeter.toFixed(0) + 'px/m' : '축척 모름'}, 정답 ${p.truth.length}개`);
    }
  }
}
console.log(`\n평면도 ${total}장을 ${join(root, 'eval')} 에 냈다.`);
