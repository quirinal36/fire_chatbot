/**
 * 실제 도면 한 장으로 방 나누기 진단. 브라우저와 같은 파이프라인(wallMask → findRooms → findOpenings)을
 * Node 에서 돌려, 방 구획이 어디서 무너지는지 숫자와 그림으로 남긴다.
 *
 *   cd tools/plan3d && npm install
 *   npx tsx diag-rooms.ts ../../example_imgs/ex02/before.png 59 out/ex02
 *
 * 인자: <이미지(png|jpg)> <1m 당 픽셀(브라우저 축소 후 기준)> <출력 접두어>
 * 출력:
 *   <접두어>-mask.png  벽 마스크
 *   <접두어>-base.png  기본 경로. 바깥=하늘색, 벽=검정, 닫힘·벽 띠에 먹혀 어느 방에도 안 들어간 곳=주황, 방=색상별
 *   <접두어>-cand.png  전역 닫힘 없이 검출된 개구부만 막았을 때
 *
 * 2026-09-19 조사(docs/plan-ai-roadmap.md)에서 ex01·ex02 의 실패 원인을 이걸로 찾았다.
 * 평가셋이 생기면 이 파일을 회귀 평가의 출발점으로 쓴다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { wallMask, dilate, labelComponents, morphClose } from '../../frontend/src/plan/walls';
import { findOpenings, type Opening } from '../../frontend/src/plan/openings';
import { findRooms, outsideRegion, paintSegment } from '../../frontend/src/plan/rooms';

const MAX_SIDE = 1600;
const [, , file, ppmArg, outPrefix] = process.argv;
if (!file || !ppmArg || !outPrefix) throw new Error('사용: tsx diag-rooms.ts <이미지> <pxPerMeter> <출력 접두어>');

function decode(path: string): { data: Uint8ClampedArray; width: number; height: number } {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { data: new Uint8ClampedArray(j.data), width: j.width, height: j.height };
}

/** planView.load 와 같은 전처리: 긴 변 1600 축소(박스 필터), 흰 바탕 합성 */
function prep(src: { data: Uint8ClampedArray; width: number; height: number }): { data: Uint8ClampedArray; width: number; height: number } {
  const s = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / s);
    const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / s);
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.floor((x + 1) / s)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const p = (yy * src.width + xx) * 4;
          const a = (src.data[p + 3] ?? 255) / 255;
          r += (src.data[p] ?? 0) * a + 255 * (1 - a);
          g += (src.data[p + 1] ?? 0) * a + 255 * (1 - a);
          b += (src.data[p + 2] ?? 0) * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function savePng(path: string, w: number, h: number, rgba: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba);
  writeFileSync(path, PNG.sync.write(png));
}

const PALETTE = [
  [230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240],
  [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255], [170, 110, 40], [255, 250, 200],
  [128, 0, 0], [170, 255, 195], [128, 128, 0], [255, 215, 180], [0, 0, 128], [128, 128, 128],
];

function render(w: number, h: number, mask: Uint8Array, outside: Uint8Array, blocked: Uint8Array, labels: ArrayLike<number>, areas: ArrayLike<number>, minPx: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let c: readonly number[] = [255, 255, 255];
    if (mask[i]) c = [0, 0, 0];
    else if (outside[i]) c = [200, 230, 255];
    else if (blocked[i]) c = [255, 170, 60];
    else {
      const id = labels[i] ?? 0;
      if (id && (areas[id] ?? 0) >= minPx) c = PALETTE[(id - 1) % PALETTE.length] ?? [0, 0, 0];
      else if (id) c = [235, 235, 235];
    }
    rgba.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], i * 4);
  }
  return rgba;
}

const fmt = (xs: readonly number[]): string => xs.map((x) => x.toFixed(1)).join(', ');

const img = prep(decode(file));
const { width: w, height: h } = img;
const ppm = Number(ppmArg);
console.log(`이미지 ${w}×${h}, 1m 당 ${ppm}px`);

const t0 = Date.now();
const r = wallMask(img.data, w, h);
const mask = r.mask;
console.log(`wallMask: 굵은 벽 ${r.wallPx}px, 얇은 벽 ${r.thinPx ?? '없음'} (${Date.now() - t0}ms)`);
savePng(`${outPrefix}-mask.png`, w, h, render(w, h, mask, new Uint8Array(w * h), new Uint8Array(w * h), new Int32Array(w * h), [], 0));

// 기본 경로 (findRooms 그대로)
const base = findRooms(mask, w, h, ppm);
console.log(`\n[기본] 바닥 ${base.floorArea.toFixed(1)}㎡, 윤곽 ${base.footprintArea.toFixed(1)}㎡, 방 ${base.rooms.length}개: ${fmt(base.rooms.map((x) => x.area))}`);

// 단계별 재현 (rooms.ts findRooms 와 같은 계산)
const m2 = 1 / (ppm * ppm);
const kOutline = Math.max(3, Math.round(3 * ppm)) | 1;
const kDoor = Math.max(3, Math.round(1.3 * ppm)) | 1;
const minPx = 1 / m2;
const outside = outsideRegion(mask, w, h, kOutline >> 1);
{
  const doorClosed = morphClose(mask, w, h, kDoor);
  const wallBand = dilate(mask, w, h, 3);
  const free = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    free[i] = !outside[i] && !doorClosed[i] && !wallBand[i] ? 1 : 0;
    blocked[i] = !outside[i] && !mask[i] && (doorClosed[i] || wallBand[i]) ? 1 : 0;
  }
  const { labels, areas } = labelComponents(free, w, h);
  let insidePx = 0;
  let outsidePx = 0;
  let blockedPx = 0;
  let roomPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (outside[i]) outsidePx++;
    else if (!mask[i]) insidePx++;
    if (blocked[i]) blockedPx++;
    const id = labels[i] ?? 0;
    if (id && (areas[id] ?? 0) >= minPx) roomPx++;
  }
  console.log(`  바깥 ${((outsidePx / (w * h)) * 100).toFixed(1)}%, 안쪽 빈 곳 ${((insidePx / (w * h)) * 100).toFixed(1)}%, 문 폭 닫힘 커널 ${kDoor}px`);
  console.log(`  안쪽 빈 곳 중 어느 방에도 안 들어간 면적 ${((blockedPx / insidePx) * 100).toFixed(1)}% (${(blockedPx * m2).toFixed(1)}㎡), 방으로 잡힌 면적 ${((roomPx / insidePx) * 100).toFixed(1)}%`);
  savePng(`${outPrefix}-base.png`, w, h, render(w, h, mask, outside, blocked, labels, areas, minPx));
}

// 실험 1: 전역 닫힘 커널을 키우면 트인 공간이 갈라지는가
for (const doorM of [2.0, 2.6]) {
  const rr = findRooms(mask, w, h, ppm, { doorWidthM: doorM });
  console.log(`[전역 닫힘 ${doorM}m] 방 ${rr.rooms.length}개: ${fmt(rr.rooms.map((x) => x.area))}`);
}

// 실험 2: 개구부 후보 (행·열 스캔 + 벽 끝점)
const openings = findOpenings(mask, w, h, r.wallPx, ppm);
const bySource = { gap: openings.filter((o) => o.source === 'gap').length, end: openings.filter((o) => o.source === 'end').length };
console.log(`\nfindOpenings: ${openings.length}개 (행·열 스캔 ${bySource.gap}, 벽 끝점 ${bySource.end})`);
for (const o of openings) console.log(`  #${o.id} ${o.source} ${o.axis} (${o.a[0].toFixed(0)},${o.a[1].toFixed(0)})→(${o.b[0].toFixed(0)},${o.b[1].toFixed(0)}) ${o.widthM.toFixed(2)}m`);
// 후보 위치 그림: 벽=검정, 행·열 스캔 후보=파랑, 벽 끝점 후보=초록 (선분을 두께 3 으로)
{
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set(mask[i] ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  for (const o of openings) {
    const line = new Uint8Array(w * h);
    paintSegment(line, w, h, o.a, o.b, 3);
    const c = o.source === 'gap' ? [30, 90, 220, 255] : [20, 160, 60, 255];
    for (let i = 0; i < w * h; i++) if (line[i]) rgba.set(c, i * 4);
  }
  savePng(`${outPrefix}-openings.png`, w, h, rgba);
}

// 실험 3: 후보를 선분으로 막고 방을 나눈다 (전역 닫힘은 0.4m)
function sealedRooms(label: string, picked: readonly Opening[], file: string): void {
  const rr = findRooms(mask, w, h, ppm, { barriers: picked.map((o) => ({ a: o.a, b: o.b })) });
  console.log(`[${label}] 방 ${rr.rooms.length}개: ${fmt(rr.rooms.map((x) => x.area))} (바닥 ${rr.floorArea.toFixed(1)}㎡)`);
  // 그림: findRooms 와 같은 계산을 다시 해서 라벨을 얻는다
  const sealed = mask.slice();
  for (const o of picked) paintSegment(sealed, w, h, o.a, o.b, 3);
  const kSmall = Math.max(3, Math.round(0.4 * ppm)) | 1;
  const out2 = outsideRegion(sealed, w, h, kOutline >> 1);
  const closed = morphClose(sealed, w, h, kSmall);
  const band = dilate(sealed, w, h, 3);
  const free = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    free[i] = !out2[i] && !closed[i] && !band[i] ? 1 : 0;
    blocked[i] = !out2[i] && !mask[i] && (closed[i] || band[i]) ? 1 : 0;
  }
  const { labels, areas } = labelComponents(free, w, h);
  let insidePx = 0;
  let blockedPx = 0;
  for (let i = 0; i < w * h; i++) { if (!out2[i] && !mask[i]) insidePx++; if (blocked[i]) blockedPx++; }
  console.log(`  미배정 ${((blockedPx / insidePx) * 100).toFixed(1)}% (${(blockedPx * m2).toFixed(1)}㎡)`);
  savePng(file, w, h, render(w, h, mask, out2, blocked, labels, areas, minPx));
}
sealedRooms('후보 전부 막기 (상한)', openings, `${outPrefix}-sealed-all.png`);
sealedRooms('1.3m 이하 후보만 막기 (판정 전 기본값)', openings.filter((o) => o.widthM <= 1.3), `${outPrefix}-sealed-default.png`);
sealedRooms('행·열 스캔 후보만 막기 (예전 후보)', openings.filter((o) => o.source === 'gap'), `${outPrefix}-sealed-gap.png`);
