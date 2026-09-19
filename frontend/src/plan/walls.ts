/**
 * 2D 도면 이미지에서 벽만 골라내고, 벽 마스크를 편집하는 순수 함수 모음. DOM 에 의존하지 않아 node 에서 시험한다.
 *
 * 원리
 *   1. 어두운 픽셀을 선으로 본다.
 *   2. 모폴로지 열림(침식 → 팽창)으로 얇은 선을 지운다. 글자·가구·문 호·치수선은 사라지고
 *      두꺼운 벽만 남는다. 벽이 끊긴 자리(문·창)는 그대로 빈 채로 남아 출입구가 된다.
 *   3. 남은 픽셀 덩어리의 테두리를 따라 다각형을 만든다. 바깥 테두리와 구멍을 구분해
 *      Three.js Shape 로 바로 압출할 수 있게 넘긴다.
 *
 * 편집은 마스크(0/1 픽셀)에 직접 한다. 벽 추가는 칠하기, 지우기는 비우기다. 편집 뒤 3 을 다시 돌린다.
 */

export type Pt = readonly [number, number];

export interface WallPolygon {
  /** 바깥 테두리. 픽셀 좌표 */
  readonly outer: Pt[];
  /** 안쪽 구멍들 */
  readonly holes: Pt[][];
}

/** 이보다 어두우면 선. 회색(126) 벽도 잡고 흰 바탕·연한 격자는 버리는 값 */
export const DEFAULT_DARK = 160;

/** 두께 투표에서 세는 최대 런 길이 */
const MAX_RUN = 64;
/** 열림 커널 = 두께 × 이 값. 이보다 얇은 것은 사라진다 */
const OPEN_RATIO = 0.6;
/** 얇은 벽 표현으로 인정하려면 굵은 벽 두께의 1/이 값 이하여야 한다 */
const THIN_GAP = 1.6;
/** 얇은 벽 표현으로 인정하려면 굵은 벽 득표의 이 비율 이상이어야 한다 */
const THIN_SHARE = 0.15;
/**
 * 이보다 얇으면 벽 표현으로 보지 않는다.
 * 1~3px 짜리 런은 어느 도면에나 널려 있다 — 글자 획, 가구 윤곽, 치수선, 안티에일리어싱.
 * 이것들이 "얇은 벽"으로 뽑히면 열림 커널이 3 으로 내려가 걸러 내는 일을 아예 안 하게 된다.
 */
const MIN_THIN = 4;

export interface WallOptions {
  /** 이 값보다 어두운 픽셀을 선으로 본다 (0~255) */
  readonly dark?: number;
  /** 벽 두께(px). 생략하면 이미지에서 추정 */
  readonly wallPx?: number;
}

export interface ThicknessModes {
  /** 가장 많은 면적을 차지하는 벽 두께. 대개 외벽 */
  readonly thick: number;
  /** 그보다 뚜렷이 얇은 두 번째 벽 표현(빗금 내벽 등). 없으면 null */
  readonly thin: number | null;
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  /** 배타 */
  readonly x1: number;
  readonly y1: number;
}

/** RGBA 픽셀을 0/1 마스크로 바꾼다. 어두우면 1 */
export function binarize(rgba: Uint8ClampedArray, w: number, h: number, dark: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = rgba[p + 3] ?? 255;
    if (a < 128) continue; // 투명은 흰 바탕으로 본다
    const lum = ((rgba[p] ?? 0) * 299 + (rgba[p + 1] ?? 0) * 587 + (rgba[p + 2] ?? 0) * 114) / 1000;
    if (lum < dark) out[i] = 1;
  }
  return out;
}

/**
 * 벽 두께 추정. 가로·세로 방향 연속 픽셀 길이의 분포에서, 픽셀 면적 기여가 가장 큰 길이를 고른다.
 * 세로 벽은 가로 방향으로 두께만큼, 가로 벽은 세로 방향으로 두께만큼 짧은 런을 아주 많이 만든다.
 */
function runScores(mask: Uint8Array, w: number, h: number): Float64Array {
  const score = new Float64Array(MAX_RUN + 1);
  const bump = (len: number): void => {
    if (len >= 2 && len <= MAX_RUN) score[len] = (score[len] ?? 0) + len;
  };
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) run++;
      else { bump(run); run = 0; }
    }
    bump(run);
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) run++;
      else { bump(run); run = 0; }
    }
    bump(run);
  }
  return score;
}

/** 구간 [from, limit] 에서 득표가 가장 큰 길이와 그 득표 */
function topRun(score: Float64Array, limit: number, from = 2): { len: number; votes: number } {
  let len = 0;
  let votes = 0;
  for (let i = from; i <= Math.min(limit, MAX_RUN); i++) {
    const s = score[i] ?? 0;
    if (s > votes) { votes = s; len = i; }
  }
  return { len, votes };
}

export function estimateThickness(mask: Uint8Array, w: number, h: number): number {
  const top = topRun(runScores(mask, w, h), MAX_RUN);
  return top.len || 4;
}

/**
 * 한 도면 안에 벽이 두 가지 두께로 그려진 경우를 찾는다.
 * 외벽은 짙게 채우고 내벽은 빗금으로 채우는 도면이 흔한데, 두께를 하나만 잡으면
 * 열림 커널이 굵은 쪽에 맞춰져 얇은 쪽이 통째로 지워진다.
 * 굵은 두께의 1/THIN_GAP 이하 구간에서 다시 최다 득표를 뽑고, 득표가 충분할 때만 인정한다.
 */
export function estimateThicknessModes(mask: Uint8Array, w: number, h: number): ThicknessModes {
  const score = runScores(mask, w, h);
  const top = topRun(score, MAX_RUN);
  const thick = top.len || 4;
  const limit = Math.floor(thick / THIN_GAP);
  const second = limit >= MIN_THIN ? topRun(score, limit, MIN_THIN) : { len: 0, votes: 0 };
  const thin = second.len >= MIN_THIN && second.votes >= top.votes * THIN_SHARE ? second.len : null;
  return { thick, thin };
}

/**
 * 빗금(해치)으로 채운 벽을 속이 찬 띠로 만드는 닫힘 커널.
 * 빗금 간격은 벽 두께에 따라 커지므로 두께에 비례해 잡되, 너무 키우면 가구 선까지 메운다.
 */
export function hatchKernel(thick: number): number {
  return Math.min(9, Math.max(3, Math.round(thick * 0.25))) | 1;
}

/** 한 방향 침식/팽창. 누적합으로 창 안의 1 개수를 세서 커널 크기와 무관하게 O(N) */
function pass1d(mask: Uint8Array, w: number, h: number, k: number, erode: boolean, horizontal: boolean): Uint8Array {
  const r = k >> 1;
  const out = new Uint8Array(w * h);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const prefix = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    const idx = (i: number): number => (horizontal ? l * w + i : i * w + l);
    for (let i = 0; i < len; i++) prefix[i + 1] = (prefix[i] ?? 0) + (mask[idx(i)] ?? 0);
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - r);
      const b = Math.min(len - 1, i + r);
      const ones = (prefix[b + 1] ?? 0) - (prefix[a] ?? 0);
      // 침식은 경계 밖을 0 으로 본다: 창이 잘리면 항상 0
      out[idx(i)] = erode ? (ones === k && b - a + 1 === k ? 1 : 0) : ones > 0 ? 1 : 0;
    }
  }
  return out;
}

export function erode(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return pass1d(pass1d(mask, w, h, k, true, true), w, h, k, true, false);
}

export function dilate(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return pass1d(pass1d(mask, w, h, k, false, true), w, h, k, false, false);
}

/** 모폴로지 열림. k 보다 얇은 것은 어느 방향으로든 사라진다 */
export function morphOpen(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return dilate(erode(mask, w, h, k), w, h, k);
}

/**
 * 모폴로지 닫힘. k 보다 좁은 틈이 메워진다.
 *
 * 침식이 이미지 경계 밖을 0 으로 보기 때문에, 그냥 팽창 → 침식을 하면 가장자리에 닿은 벽이
 * 반지름만큼 깎인다. 팽창분이 들어갈 자리를 먼저 만들어 두고(빈 테두리) 끝나면 잘라낸다.
 */
export function morphClose(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const pad = k;
  const pw = w + pad * 2;
  const ph = h + pad * 2;
  const big = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) big.set(mask.subarray(y * w, y * w + w), (y + pad) * pw + pad);
  const closed = erode(dilate(big, pw, ph, k), pw, ph, k);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const from = (y + pad) * pw + pad;
    out.set(closed.subarray(from, from + w), y * w);
  }
  return out;
}

/**
 * 끊긴 벽 잇기. 가로·세로 한 방향씩만 닫아서, 같은 줄에서 k 보다 좁게 끊긴 자리만 메운다.
 *
 * 빗금 내벽은 속이 성기게 차서 열림을 거치면 점선처럼 토막 나기 쉽다. 그러면 방 나누기가 그 틈으로
 * 새어 두 방이 하나가 된다. 2차원 닫힘은 모서리를 뭉개고 가까운 가구까지 붙이지만, 한 방향 닫힘은
 * 벽이 이어지던 줄 위의 틈만 메운다. 원래 픽셀은 그대로 두고 더하기만 하므로 가장자리가 깎이지 않는다.
 * 문·창은 벽 두께의 몇 배라 k 보다 넓어 메워지지 않는다.
 */
export function bridgeGaps(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const hClosed = pass1d(pass1d(mask, w, h, k, false, true), w, h, k, true, true);
  const vClosed = pass1d(pass1d(mask, w, h, k, false, false), w, h, k, true, false);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || hClosed[i] || vClosed[i] ? 1 : 0;
  return out;
}

/**
 * 빗금 내벽 보조 추출. 빗금과 그 테두리는 대개 연한 회색(밝기 160~220)이라 기본 이진화(160)에서
 * 대부분 버려지고, 남은 진한 선 한두 줄만 열림을 거치며 점선처럼 토막 난다. 실제 아파트 도면에서
 * 침실 사이 벽이 이렇게 사라져 침실 둘과 거실이 한 방이 됐다.
 *
 * 밝은 기준으로 다시 이진화해 빗금을 닫힘으로 메운 뒤, **얇고 긴 것만** 벽으로 받는다. 밝은 회색은
 * 타일 격자·바닥 음영 같은 넓은 무늬에도 쓰이는데, 그것들은 닫힘 뒤 두꺼운 덩어리가 되므로
 * 굵은 커널 열림으로 골라내 뺀다. 얇은 벽 표현이 따로 있는 도면(thin 이 있는 경우)에만 쓴다.
 */
export const LIGHT_DARK = 220;
export function hatchedWalls(rgba: Uint8ClampedArray, w: number, h: number, coarse: number, thin: number, minArea: number): Uint8Array {
  const light = binarize(rgba, w, h, LIGHT_DARK);
  const solid = morphClose(light, w, h, hatchKernel(coarse));
  const opened = openAt(solid, w, h, thin, minArea);
  // 벽 두께의 2.5배보다 두꺼운 덩어리는 벽이 아니다 (타일·음영). 테두리까지 함께 뺀다
  const blobs = dilate(morphOpen(opened, w, h, Math.max(3, Math.round(thin * 2.5)) | 1), w, h, 5);
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) raw[i] = opened[i] && !blobs[i] ? 1 : 0;
  // 빗금 속이 고르게 차지 않아 토막 나 있다. 먼저 이어 붙인 뒤 길이를 본다
  const out = bridgeGaps(raw, w, h, bridgeKernel(thin));
  // 벽은 길다. 짧은 조각(치수선 눈금·기호)과 이미지 가장자리에 닿은 것(테두리 띠)은 벽이 아니다
  const { labels, areas } = labelComponents(out, w, h);
  const box = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let i = 0; i < w * h; i++) {
    const id = labels[i] ?? 0;
    if (!id) continue;
    const x = i % w;
    const y = (i - x) / w;
    const b = box.get(id);
    if (b) { if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y; if (x >= b.x1) b.x1 = x + 1; if (y >= b.y1) b.y1 = y + 1; }
    else box.set(id, { x0: x, y0: y, x1: x + 1, y1: y + 1 });
  }
  const minLen = thin * 6;
  const drop = new Uint8Array(areas.length);
  for (const [id, b] of box) {
    const touches = b.x0 === 0 || b.y0 === 0 || b.x1 === w || b.y1 === h;
    if (touches || Math.max(b.x1 - b.x0, b.y1 - b.y0) < minLen) drop[id] = 1;
  }
  for (let i = 0; i < w * h; i++) if (drop[labels[i] ?? 0]) out[i] = 0;
  return out;
}

/** 끊긴 벽을 이을 때 쓰는 커널. 벽 두께의 3배까지, 31px 까지 */
export function bridgeKernel(thin: number): number {
  return Math.min(31, Math.max(5, Math.round(thin * 3))) | 1;
}

/** 4-연결 덩어리에 번호를 매긴다. 0 은 배경. 반환 areas[label] = 픽셀 수 */
export function labelComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; areas: number[] } {
  const labels = new Int32Array(w * h);
  const areas: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = areas.length;
    let area = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      area++;
      const x = i % w;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack.push(i + 1); }
      if (i >= w && mask[i - w] && !labels[i - w]) { labels[i - w] = id; stack.push(i - w); }
      if (i + w < w * h && mask[i + w] && !labels[i + w]) { labels[i + w] = id; stack.push(i + w); }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/** minArea 보다 작은 덩어리를 지운다 (4-연결) */
export function removeSmall(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const { labels, areas } = labelComponents(mask, w, h);
  const out = mask.slice();
  for (let i = 0; i < w * h; i++) {
    const id = labels[i] ?? 0;
    if (id && (areas[id] ?? 0) < minArea) out[i] = 0;
  }
  return out;
}

/**
 * 마스크의 테두리를 방향 있는 닫힌 고리로 뽑는다.
 * 진행 방향의 오른쪽에 벽이 오도록 걷는다. 그러면 바깥 테두리는 화면 기준 시계 방향,
 * 구멍은 반시계 방향이 되어 부호 있는 면적으로 구분할 수 있다.
 */
export function traceLoops(mask: Uint8Array, w: number, h: number): Pt[][] {
  const W = w + 1; // 꼭짓점 격자 폭
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (mask[y * w + x] ?? 0));
  // 꼭짓점별 나가는 변. 방향 0:→ 1:↓ 2:← 3:↑
  const edges = new Map<number, number[]>();
  const add = (x: number, y: number, dir: number): void => {
    const key = y * W + x;
    const list = edges.get(key);
    if (list) list.push(dir);
    else edges.set(key, [dir]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, 0);          // 위쪽 변: (x,y)→(x+1,y)
      if (!at(x + 1, y)) add(x + 1, y, 1);      // 오른쪽 변: (x+1,y)→(x+1,y+1)
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);  // 아래쪽 변: (x+1,y+1)→(x,y+1)
      if (!at(x - 1, y)) add(x, y + 1, 3);      // 왼쪽 변: (x,y+1)→(x,y)
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const loops: Pt[][] = [];
  for (const [startKey, startDirs] of edges) {
    while (startDirs.length) {
      const loop: Pt[] = [];
      let key = startKey;
      let dir = startDirs.pop() as number;
      for (;;) {
        const x = key % W;
        const y = (key - x) / W;
        loop.push([x, y]);
        const nx = x + (DX[dir] ?? 0);
        const ny = y + (DY[dir] ?? 0);
        key = ny * W + nx;
        if (key === startKey) break;
        const outs = edges.get(key);
        if (!outs || outs.length === 0) break; // 일어나지 않아야 함
        // 갈림길이면 오른쪽 꺾기를 우선한다. 모서리로만 닿은 덩어리를 분리해 준다
        const prefer = [(dir + 1) % 4, dir, (dir + 3) % 4];
        let pick = -1;
        for (const p of prefer) {
          const idx = outs.indexOf(p);
          if (idx >= 0) { pick = idx; break; }
        }
        if (pick < 0) pick = 0;
        dir = outs.splice(pick, 1)[0] as number;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** 부호 있는 면적. 화면 좌표(y 아래) 기준 시계 방향이면 양수 */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker. 닫힌 고리용 */
export function simplifyLoop(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 4 || eps <= 0) return [...pts];
  const keep = new Uint8Array(pts.length);
  const dist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const rdp = (i0: number, i1: number): void => {
    let worst = -1;
    let worstD = eps;
    const a = pts[i0] as Pt;
    const b = pts[i1] as Pt;
    for (let i = i0 + 1; i < i1; i++) {
      const d = dist(pts[i] as Pt, a, b);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; rdp(i0, worst); rdp(worst, i1); }
  };
  // 닫힌 고리는 가장 먼 두 점으로 갈라 두 번 돌린다
  const first = pts[0] as Pt;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot((pts[i] as Pt)[0] - first[0], (pts[i] as Pt)[1] - first[1]);
    if (d > farD) { farD = d; far = i; }
  }
  keep[0] = keep[far] = 1;
  rdp(0, far);
  keep[pts.length - 1] = 1;
  rdp(far, pts.length - 1);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i] as Pt);
  // 닫힌 고리라서 이음매 근처에 남은 공선점을 정리한다
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length] as Pt;
      const p = out[i] as Pt;
      const b = out[(i + 1) % out.length] as Pt;
      if (dist(p, a, b) <= eps) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/** 고리들을 바깥/구멍으로 나눠 다각형으로 묶는다 */
export function buildPolygons(loops: readonly Pt[][], eps: number): WallPolygon[] {
  const outers: { pts: Pt[]; area: number; holes: Pt[][] }[] = [];
  const holes: Pt[][] = [];
  for (const raw of loops) {
    const area = signedArea(raw);
    const pts = simplifyLoop(raw, eps);
    if (pts.length < 3) continue;
    if (area > 0) outers.push({ pts, area, holes: [] });
    else holes.push(pts);
  }
  for (const hole of holes) {
    const p = hole[0] as Pt;
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if ((best === null || o.area < best.area) && pointInPolygon(p, o.pts)) best = o;
    }
    best?.holes.push(hole);
  }
  return outers.map((o) => ({ outer: o.pts, holes: o.holes }));
}

/** 마스크 → 압출용 다각형 */
export function polygonsFromMask(mask: Uint8Array, w: number, h: number, eps = 1.5): WallPolygon[] {
  return buildPolygons(traceLoops(mask, w, h), eps);
}

/** 두께 t 에 맞춰 얇은 것을 지운다. minArea 보다 작은 덩어리도 버린다 */
function openAt(mask: Uint8Array, w: number, h: number, t: number, minArea: number): Uint8Array {
  const k = Math.max(3, Math.round(t * OPEN_RATIO)) | 1;
  return removeSmall(morphOpen(mask, w, h, k), w, h, minArea);
}

/**
 * 이미지 → 벽 마스크.
 *
 * 두께를 지정하지 않으면 두 단계로 추정한다.
 *   1. 먼저 대충 재고, 그 두께에 맞춘 작은 닫힘으로 빗금 벽의 속을 채운다.
 *   2. 채운 마스크에서 굵은 벽과 얇은 벽 두께를 따로 찾는다.
 * 열림은 얇은 쪽에 맞춰야 내벽이 살아남는다. 돌려주는 wallPx 는 굵은 쪽이다 —
 * 축척 가정(벽 두께 0.2m)은 외벽 기준이라야 맞는다.
 */
export function wallMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opts: WallOptions = {},
): { mask: Uint8Array; wallPx: number; thinPx: number | null } {
  const binary = binarize(rgba, w, h, opts.dark ?? DEFAULT_DARK);
  if (opts.wallPx !== undefined) {
    // 사용자나 AI 가 두께를 지정하면 그 두께 하나로만 본다
    const t = Math.max(2, opts.wallPx);
    const single = openAt(binary, w, h, t, t * t * 4);
    return { mask: bridgeGaps(single, w, h, bridgeKernel(t)), wallPx: t, thinPx: null };
  }
  const coarse = estimateThickness(binary, w, h);
  const solid = morphClose(binary, w, h, hatchKernel(coarse));
  const { thick, thin } = estimateThicknessModes(solid, w, h);
  // 얇은 벽도 길이는 굵은 벽만큼 나온다. 그 정도 넓이가 안 되면 가구·글자로 본다
  const minArea = thin === null ? thick * thick * 4 : thin * thick * 2;
  const opened = openAt(solid, w, h, thin ?? thick, minArea);
  // 벽이 두 가지로 그려진 도면이면 연한 빗금 벽을 보조로 더한다
  if (thin !== null) {
    const hatched = hatchedWalls(rgba, w, h, coarse, thin, minArea);
    for (let i = 0; i < w * h; i++) if (hatched[i]) opened[i] = 1;
  }
  // 열림을 거치며 토막 난 벽(성긴 빗금 내벽)을 같은 줄 위에서만 잇는다
  const mask = bridgeGaps(opened, w, h, bridgeKernel(thin ?? thick));
  return { mask, wallPx: thick, thinPx: thin };
}

/* ------------------------------ 편집 ------------------------------ */

function clampRect(r: Rect, w: number, h: number): Rect {
  return {
    x0: Math.max(0, Math.min(w, Math.floor(Math.min(r.x0, r.x1)))),
    y0: Math.max(0, Math.min(h, Math.floor(Math.min(r.y0, r.y1)))),
    x1: Math.max(0, Math.min(w, Math.ceil(Math.max(r.x0, r.x1)))),
    y1: Math.max(0, Math.min(h, Math.ceil(Math.max(r.y0, r.y1)))),
  };
}

/** 사각형 안을 value 로 채운다. 제자리 수정 */
export function fillRect(mask: Uint8Array, w: number, h: number, r: Rect, value: 0 | 1): void {
  const c = clampRect(r, w, h);
  for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) mask[y * w + x] = value;
}

/** 두 점 사이에 두께 thick 인 벽을 칠한다. 축에 가까운 선은 축에 붙인다. 제자리 수정. 칠한 다각형을 돌려준다 */
export function paintWall(mask: Uint8Array, w: number, h: number, a: Pt, b: Pt, thick: number): Pt[] {
  const poly = wallOutline(a, b, thick);
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const c = clampRect({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, w, h);
  for (let y = c.y0; y < c.y1; y++) {
    for (let x = c.x0; x < c.x1; x++) {
      if (pointInPolygon([x + 0.5, y + 0.5], poly)) mask[y * w + x] = 1;
    }
  }
  return poly;
}

/** 축 스냅. 기울기가 axisSnapDeg 안이면 수평·수직으로 맞춘다 */
export function snapToAxis(a: Pt, b: Pt, axisSnapDeg = 8): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ang = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI;
  if (ang < axisSnapDeg || ang > 180 - axisSnapDeg) return [b[0], a[1]];
  if (Math.abs(ang - 90) < axisSnapDeg) return [a[0], b[1]];
  return b;
}

/** 선분 a→b 를 두께 thick 로 감싸는 사각형 4점. 양 끝을 두께 절반만큼 늘려 모서리가 맞물리게 한다 */
export function wallOutline(a: Pt, b: Pt, thick: number): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const half = thick / 2;
  const ax = a[0] - ux * half;
  const ay = a[1] - uy * half;
  const bx = b[0] + ux * half;
  const by = b[1] + uy * half;
  const nx = -uy * half;
  const ny = ux * half;
  return [
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [ax - nx, ay - ny],
  ];
}

/**
 * 클릭한 자리의 벽 한 구간을 찾는다. 벽의 진행 방향을 따라 걷다가 두께가 갑자기 두꺼워지는
 * 교차점이나 끝에서 멈춘다. 벽이 아니면 null
 */
export function wallSegmentAt(mask: Uint8Array, w: number, h: number, p: Pt, wallPx: number): Rect | null {
  const x = Math.floor(p[0]);
  const y = Math.floor(p[1]);
  if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) return null;
  const at = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : (mask[yy * w + xx] ?? 0));
  // 가로·세로 런 길이. 짧은 쪽이 두께
  const runH = (xx: number, yy: number): [number, number] => {
    let a = xx;
    let b = xx;
    while (at(a - 1, yy)) a--;
    while (at(b + 1, yy)) b++;
    return [a, b];
  };
  const runV = (xx: number, yy: number): [number, number] => {
    let a = yy;
    let b = yy;
    while (at(xx, a - 1)) a--;
    while (at(xx, b + 1)) b++;
    return [a, b];
  };
  const [hx0, hx1] = runH(x, y);
  const [vy0, vy1] = runV(x, y);
  const horizontal = hx1 - hx0 >= vy1 - vy0; // 가로로 긴 벽
  const limit = wallPx * 1.6;
  if (horizontal) {
    const t = vy1 - vy0 + 1;
    if (t > limit) return null; // 교차점 한가운데
    const cy = (vy0 + vy1) >> 1;
    let a = x;
    let b = x;
    const ok = (xx: number): boolean => {
      if (!at(xx, cy)) return false;
      const [r0, r1] = runV(xx, cy);
      return r1 - r0 + 1 <= limit;
    };
    while (ok(a - 1)) a--;
    while (ok(b + 1)) b++;
    return { x0: a, y0: vy0, x1: b + 1, y1: vy1 + 1 };
  }
  const t = hx1 - hx0 + 1;
  if (t > limit) return null;
  const cx = (hx0 + hx1) >> 1;
  let a = y;
  let b = y;
  const ok = (yy: number): boolean => {
    if (!at(cx, yy)) return false;
    const [r0, r1] = runH(cx, yy);
    return r1 - r0 + 1 <= limit;
  };
  while (ok(a - 1)) a--;
  while (ok(b + 1)) b++;
  return { x0: hx0, y0: a, x1: hx1 + 1, y1: b + 1 };
}

/** p 에서 반지름 r 안의 가장 가까운 벽 픽셀. 없으면 p 그대로. 그은 벽 끝을 기존 벽에 붙일 때 쓴다 */
export function nearestWall(mask: Uint8Array, w: number, h: number, p: Pt, r: number): Pt {
  const cx = Math.round(p[0]);
  const cy = Math.round(p[1]);
  let best: Pt = p;
  let bestD = Infinity;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      if (!mask[y * w + x]) continue;
      const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
      if (d < bestD) { bestD = d; best = [x + 0.5, y + 0.5]; }
    }
  }
  return best;
}

export interface OpeningCut {
  readonly rect: Rect;
  /** 개구부 폭이 가로면 'h' (= 가로로 이어지는 벽에 난 문) */
  readonly axis: 'h' | 'v';
  readonly widthPx: number;
}

/**
 * 벽 위의 점 `a` 에 개구부(문·창) 자리를 잡는다. 벽이 이어지는 방향으로 폭을 주고
 * 벽 두께는 전부 관통한다. `b` 를 주면 `a`~`b` 구간이 폭이 되고, 없으면 `a` 를 가운데 두고
 * `widthPx` 만큼 벌린다. 어느 쪽이든 그 벽 한 구간을 넘지 않게 당긴다. 벽이 아니면 null.
 */
export function cutOpening(
  mask: Uint8Array,
  w: number,
  h: number,
  a: Pt,
  b: Pt | null,
  wallPx: number,
  widthPx: number,
): OpeningCut | null {
  const seg = wallSegmentAt(mask, w, h, a, wallPx);
  if (seg === null) return null;
  const horizontal = seg.x1 - seg.x0 >= seg.y1 - seg.y0;
  const lo = horizontal ? seg.x0 : seg.y0;
  const hi = horizontal ? seg.x1 : seg.y1;
  const at = horizontal ? a[0] : a[1];
  const dragged = b === null ? 0 : Math.abs((horizontal ? b[0] : b[1]) - at);
  // 끌지 않았거나 너무 짧으면 입력한 폭을 쓴다
  const want = dragged >= 2 ? dragged : widthPx;
  const span = Math.min(want, hi - lo);
  if (span < 2) return null;
  let s = b !== null && dragged >= 2 ? Math.min(at, horizontal ? b[0] : b[1]) : at - span / 2;
  s = Math.max(lo, Math.min(hi - span, s));
  const e = s + span;
  return {
    rect: horizontal ? { x0: s, y0: seg.y0, x1: e, y1: seg.y1 } : { x0: seg.x0, y0: s, x1: seg.x1, y1: e },
    axis: horizontal ? 'h' : 'v',
    widthPx: span,
  };
}
