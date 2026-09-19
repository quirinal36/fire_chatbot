/**
 * 벽이 끊긴 자리(개구부 후보)를 찾는다. 두 가지 방법을 합친다.
 *
 *   1. 행·열 스캔: 같은 행(또는 열)에서 벽 → 빈칸 → 벽 순서가 문·창 폭 안이면 후보다. 벽 사이에 낀
 *      문·창을 잡는다.
 *   2. 벽 끝점: 벽이 그냥 끝나는 자리(자유 끝)에서 앞쪽으로 가장 가까운 다른 벽까지를 후보로 잡는다.
 *      모서리 문(벽 끝이 직각 벽과 만나는 자리의 문)과 벽 끝 문은 1번으로는 잡히지 않는다 — 어느 행·열에도
 *      벽 → 빈칸 → 벽 순서가 없기 때문이다. 한국 아파트 침실 문이 대체로 이렇다.
 *
 * 후보는 "개구부일 수 있는 자리"다. 문인지 창인지 트인 곳인지, 아니면 개구부가 아닌지는 AI 나 사용자가
 * 판정한다. 방 나누기(rooms.ts)는 판정된 후보를 임시로 막아 방을 가른다.
 */
import { labelComponents, type Pt, type Rect } from './walls';

export interface Opening {
  readonly id: number;
  /** 개구부 선분의 양 끝(픽셀). 벽 한쪽 끝에서 맞은편 벽까지 */
  readonly a: Pt;
  readonly b: Pt;
  /** 경계 상자 */
  readonly rect: Rect;
  /** 'h': 가로로 이어지는 벽에 난 개구부(폭이 가로), 'v': 세로 벽, 'd': 사선(모서리 문) */
  readonly axis: 'h' | 'v' | 'd';
  readonly widthM: number;
  /** 어떻게 찾았는지. 'gap' 행·열 스캔, 'end' 벽 끝점 */
  readonly source: 'gap' | 'end';
}

export interface OpeningOptions {
  /** 이보다 넓은 틈은 개구부로 보지 않는다(m) */
  readonly maxWidthM?: number;
  /** 이보다 좁은 틈은 무시한다(m) */
  readonly minWidthM?: number;
}

const rectOf = (a: Pt, b: Pt, pad: number): Rect => ({
  x0: Math.floor(Math.min(a[0], b[0]) - pad),
  y0: Math.floor(Math.min(a[1], b[1]) - pad),
  x1: Math.ceil(Math.max(a[0], b[0]) + pad),
  y1: Math.ceil(Math.max(a[1], b[1]) + pad),
});

/* ------------------------------ 1. 행·열 스캔 ------------------------------ */

function gapOpenings(mask: Uint8Array, w: number, h: number, wallPx: number, pxPerMeter: number, minPx: number, maxPx: number): Omit<Opening, 'id'>[] {
  const gaps = new Uint8Array(w * h);
  // 행 방향: 벽 런 사이의 짧은 빈 런
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) { x++; continue; }
      while (x < w && mask[y * w + x]) x++; // 벽 런 끝
      const gapStart = x;
      while (x < w && !mask[y * w + x]) x++;
      if (x < w && x - gapStart >= 2 && x - gapStart <= maxPx) for (let g = gapStart; g < x; g++) gaps[y * w + g] = 1;
    }
  }
  // 열 방향
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      while (y < h && mask[y * w + x]) y++;
      const gapStart = y;
      while (y < h && !mask[y * w + x]) y++;
      if (y < h && y - gapStart >= 2 && y - gapStart <= maxPx) for (let g = gapStart; g < y; g++) gaps[g * w + x] = 1;
    }
  }
  const { labels, areas } = labelComponents(gaps, w, h);
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let i = 0; i < w * h; i++) {
    const id = labels[i] ?? 0;
    if (!id) continue;
    const x = i % w;
    const y = (i - x) / w;
    const b = boxes.get(id);
    if (b) {
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x + 1 > b.x1) b.x1 = x + 1;
      if (y + 1 > b.y1) b.y1 = y + 1;
    } else boxes.set(id, { x0: x, y0: y, x1: x + 1, y1: y + 1 });
  }
  const out: Omit<Opening, 'id'>[] = [];
  for (const [id, b] of boxes) {
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const thin = Math.min(bw, bh);
    const long = Math.max(bw, bh);
    // 벽 두께만큼 얇고, 사람 폭 이상 길며, 상자를 거의 채워야 개구부
    if (thin > wallPx * 2.2 || long < minPx || long > maxPx * 1.2) continue;
    if ((areas[id] ?? 0) < bw * bh * 0.6) continue;
    const horizontal = bw >= bh;
    const yc = (b.y0 + b.y1) / 2;
    const xc = (b.x0 + b.x1) / 2;
    const a: Pt = horizontal ? [b.x0, yc] : [xc, b.y0];
    const e: Pt = horizontal ? [b.x1, yc] : [xc, b.y1];
    out.push({ a, b: e, rect: { ...b }, axis: horizontal ? 'h' : 'v', widthM: long / pxPerMeter, source: 'gap' });
  }
  return out;
}

/* ------------------------------ 2. 벽 끝점 ------------------------------ */

interface End {
  /** 끝의 가운데. 벽 밖으로 반 픽셀 나간 자리 */
  readonly c: Pt;
  /** 벽이 끝난 뒤 이어지는 방향 (단위 벡터, 축 방향) */
  readonly d: Pt;
  /** 끝의 직각 방향 범위 (벽 두께) */
  readonly p0: number;
  readonly p1: number;
}

/**
 * 벽의 자유 끝을 찾는다. 행마다 벽 런의 양 끝을 보고, 그 자리에서 직각 방향 런이 벽 두께 안이면
 * (직각 벽과 만나는 교차점이 아니면) 끝으로 친다. 두께만큼의 행에서 같은 끝이 나오므로 묶는다.
 */
function freeEnds(mask: Uint8Array, w: number, h: number, t: number): End[] {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (mask[y * w + x] as number));
  const runLen = (x: number, y: number, dx: number, dy: number): number => {
    let n = 0;
    let xx = x;
    let yy = y;
    while (at(xx, yy)) { n++; xx += dx; yy += dy; }
    return n;
  };
  const minRun = Math.max(4, Math.round(t * 2));
  const maxPerp = Math.max(3, Math.round(t * 2));
  // key: 방향 + 끝 위치(진행 축) → 직각 위치 목록
  const raw = new Map<string, { axisPos: number; dir: 1 | -1; horizontal: boolean; perps: number[] }>();
  const push = (horizontal: boolean, axisPos: number, dir: 1 | -1, perp: number): void => {
    // 들쭉날쭉한 벽 끝은 축 위치가 몇 픽셀 흔들린다. t/2 안이면 같은 끝으로 본다
    const key = `${horizontal ? 'h' : 'v'}${dir}:${Math.round(axisPos / Math.max(1, t / 2))}`;
    const hit = raw.get(key);
    if (hit) hit.perps.push(perp);
    else raw.set(key, { axisPos, dir, horizontal, perps: [perp] });
  };
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!at(x, y)) { x++; continue; }
      const a = x;
      while (x < w && at(x, y)) x++;
      const b = x; // [a, b)
      if (b - a < minRun) continue;
      // 오른쪽 끝: 직각(세로) 런이 벽 두께 안이어야 자유 끝
      if (runLen(b - 1, y, 0, 1) + runLen(b - 1, y, 0, -1) - 1 <= maxPerp) push(true, b, 1, y);
      if (runLen(a, y, 0, 1) + runLen(a, y, 0, -1) - 1 <= maxPerp) push(true, a, -1, y);
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!at(x, y)) { y++; continue; }
      const a = y;
      while (y < h && at(x, y)) y++;
      const b = y;
      if (b - a < minRun) continue;
      if (runLen(x, b - 1, 1, 0) + runLen(x, b - 1, -1, 0) - 1 <= maxPerp) push(false, b, 1, x);
      if (runLen(x, a, 1, 0) + runLen(x, a, -1, 0) - 1 <= maxPerp) push(false, a, -1, x);
    }
  }
  const ends: End[] = [];
  for (const e of raw.values()) {
    e.perps.sort((p, q) => p - q);
    // 직각 방향으로 이어진 묶음마다 끝 하나. 벽 두께의 절반은 돼야 끝으로 친다
    let start = 0;
    for (let i = 1; i <= e.perps.length; i++) {
      if (i < e.perps.length && (e.perps[i] as number) - (e.perps[i - 1] as number) <= 2) continue;
      const p0 = e.perps[start] as number;
      const p1 = (e.perps[i - 1] as number) + 1;
      start = i;
      if (p1 - p0 < Math.max(2, t / 2) || p1 - p0 > t * 2.5) continue;
      const mid = (p0 + p1) / 2;
      const axis = e.dir === 1 ? e.axisPos : e.axisPos; // 벽 밖 첫 픽셀 경계
      ends.push(
        e.horizontal
          ? { c: [axis, mid], d: [e.dir, 0], p0, p1 }
          : { c: [mid, axis], d: [0, e.dir], p0, p1 },
      );
    }
  }
  return ends;
}

/**
 * 끝에서 앞쪽으로 가장 가까운 벽 픽셀. 곧장 앞에 벽이 있고 그 거리가 최단 거리의 1.3배 안이면 곧장
 * 앞을 고른다 — 축에 맞는 개구부가 사선보다 흔하다.
 */
function nearestAhead(mask: Uint8Array, w: number, h: number, e: End, maxPx: number): Pt | null {
  const [cx, cy] = e.c;
  const [dx, dy] = e.d;
  let best: Pt | null = null;
  let bestD = Infinity;
  let ahead: Pt | null = null;
  let aheadD = Infinity;
  const x0 = Math.max(0, Math.floor(cx - maxPx));
  const x1 = Math.min(w - 1, Math.ceil(cx + maxPx));
  const y0 = Math.max(0, Math.floor(cy - maxPx));
  const y1 = Math.min(h - 1, Math.ceil(cy + maxPx));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask[y * w + x]) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const forward = (px - cx) * dx + (py - cy) * dy;
      if (forward < 1) continue; // 뒤나 옆(자기 벽)은 뺀다
      const dist = Math.hypot(px - cx, py - cy);
      if (dist > maxPx) continue;
      if (dist < bestD) { bestD = dist; best = [px, py]; }
      const perp = dx !== 0 ? py : px;
      if (perp >= e.p0 && perp < e.p1 && dist < aheadD) { aheadD = dist; ahead = [px, py]; }
    }
  }
  if (ahead && aheadD <= bestD * 1.3) return dx !== 0 ? [ahead[0], cy] : [cx, ahead[1]];
  return best;
}

function endOpenings(mask: Uint8Array, w: number, h: number, t: number, pxPerMeter: number, minPx: number, maxPx: number): Omit<Opening, 'id'>[] {
  const out: Omit<Opening, 'id'>[] = [];
  for (const e of freeEnds(mask, w, h, t)) {
    const q = nearestAhead(mask, w, h, e, maxPx);
    if (!q) continue;
    const len = Math.hypot(q[0] - e.c[0], q[1] - e.c[1]);
    if (len < minPx || len > maxPx) continue;
    const straight = e.d[0] !== 0 ? Math.abs(q[1] - e.c[1]) < 1 : Math.abs(q[0] - e.c[0]) < 1;
    const axis: Opening['axis'] = !straight ? 'd' : e.d[0] !== 0 ? 'h' : 'v';
    const rect =
      axis === 'h'
        ? { x0: Math.min(e.c[0], q[0]), y0: e.p0, x1: Math.max(e.c[0], q[0]), y1: e.p1 }
        : axis === 'v'
          ? { x0: e.p0, y0: Math.min(e.c[1], q[1]), x1: e.p1, y1: Math.max(e.c[1], q[1]) }
          : rectOf(e.c, q, t / 2);
    out.push({ a: e.c, b: q, rect, axis, widthM: len / pxPerMeter, source: 'end' });
  }
  return out;
}

/* ------------------------------ 합치기 ------------------------------ */

const close = (p: Pt, q: Pt, tol: number): boolean => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
const sameSegment = (o: Omit<Opening, 'id'>, p: Omit<Opening, 'id'>, tol: number): boolean =>
  (close(o.a, p.a, tol) && close(o.b, p.b, tol)) || (close(o.a, p.b, tol) && close(o.b, p.a, tol));

function overlap(a: Rect, b: Rect): number {
  const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return small > 0 ? inter / small : 0;
}

/**
 * 개구부 후보. 행·열 스캔 후보를 먼저 두고, 벽 끝점 후보 중 같은 자리가 아닌 것만 보탠다.
 * 마주 보는 두 끝은 같은 선분을 두 번 만드므로 하나만 남긴다.
 */
export function findOpenings(mask: Uint8Array, w: number, h: number, wallPx: number, pxPerMeter: number, opts: OpeningOptions = {}): Opening[] {
  const maxPx = Math.round((opts.maxWidthM ?? 2.6) * pxPerMeter);
  const minPx = Math.round((opts.minWidthM ?? 0.5) * pxPerMeter);
  const tol = Math.max(3, wallPx);
  // 작은 조각(치수선 눈금, 기호, 가구 잔해)은 개구부의 양 끝이 될 수 없다. 큰 덩어리만 본다
  const { labels, areas } = labelComponents(mask, w, h);
  const minComponent = wallPx * wallPx * 2;
  const walls = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) walls[i] = mask[i] && (areas[labels[i] ?? 0] ?? 0) >= minComponent ? 1 : 0;
  const merged: Omit<Opening, 'id'>[] = gapOpenings(walls, w, h, wallPx, pxPerMeter, minPx, maxPx);
  for (const o of endOpenings(walls, w, h, wallPx, pxPerMeter, minPx, maxPx)) {
    if (merged.some((m) => sameSegment(m, o, tol) || overlap(m.rect, o.rect) > 0.5)) continue;
    merged.push(o);
  }
  merged.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
  return merged.map((o, i) => ({ ...o, id: i + 1 }));
}
