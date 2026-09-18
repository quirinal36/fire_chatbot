/**
 * 2D 도면 이미지에서 벽만 골라내는 순수 함수 모음. DOM 에 의존하지 않아 node 에서 시험한다.
 *
 * 원리
 *   1. 어두운 픽셀을 선으로 본다.
 *   2. 모폴로지 열림(침식 → 팽창)으로 얇은 선을 지운다. 글자·가구·문 호·치수선은 사라지고
 *      두꺼운 벽만 남는다. 벽이 끊긴 자리(문·창)는 그대로 빈 채로 남아 출입구가 된다.
 *   3. 남은 픽셀 덩어리의 테두리를 따라 다각형을 만든다. 바깥 테두리와 구멍을 구분해
 *      Three.js Shape 로 바로 압출할 수 있게 넘긴다.
 */

export type Pt = readonly [number, number];

export interface WallPolygon {
  /** 바깥 테두리. 픽셀 좌표 */
  readonly outer: Pt[];
  /** 안쪽 구멍들 */
  readonly holes: Pt[][];
}

export interface WallModel {
  readonly width: number;
  readonly height: number;
  /** 추정하거나 지정한 벽 두께(px) */
  readonly wallPx: number;
  readonly polygons: WallPolygon[];
  /** 벽 마스크. 1 이면 벽. 튜닝 확인용 */
  readonly mask: Uint8Array;
}

export interface WallOptions {
  /** 이 값보다 어두운 픽셀을 선으로 본다 (0~255) */
  readonly dark?: number;
  /** 벽 두께(px). 생략하면 이미지에서 추정 */
  readonly wallPx?: number;
  /** 다각형 단순화 허용 오차(px) */
  readonly simplify?: number;
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
export function estimateThickness(mask: Uint8Array, w: number, h: number): number {
  const MAX = 64;
  const score = new Float64Array(MAX + 1);
  const bump = (len: number): void => {
    if (len >= 2 && len <= MAX) score[len] = (score[len] ?? 0) + len;
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
  let best = 4;
  let bestScore = 0;
  for (let len = 2; len <= MAX; len++) {
    const s = score[len] ?? 0;
    if (s > bestScore) { bestScore = s; best = len; }
  }
  return best;
}

function erodeOrDilate(mask: Uint8Array, w: number, h: number, k: number, erode: boolean): Uint8Array {
  const r = k >> 1;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const fill = erode ? 1 : 0;
  // 가로 방향
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = fill;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        const px = xx < 0 || xx >= w ? 0 : (mask[row + xx] ?? 0);
        if (erode ? px === 0 : px === 1) { v = erode ? 0 : 1; break; }
      }
      tmp[row + x] = v;
    }
  }
  // 세로 방향
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = fill;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        const px = yy < 0 || yy >= h ? 0 : (tmp[yy * w + x] ?? 0);
        if (erode ? px === 0 : px === 1) { v = erode ? 0 : 1; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** 모폴로지 열림. k 보다 얇은 것은 어느 방향으로든 사라진다 */
export function morphOpen(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  return erodeOrDilate(erodeOrDilate(mask, w, h, k, true), w, h, k, false);
}

/** minArea 보다 작은 덩어리를 지운다 (4-연결) */
export function removeSmall(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const out = mask.slice();
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!out[start] || seen[start]) continue;
    const members: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      members.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const n of next) {
        if (n >= 0 && out[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (members.length < minArea) for (const i of members) out[i] = 0;
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
      // 시작 변은 이미 꺼냈으므로 첫 점을 찍고 걷는다
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

export function extractWalls(rgba: Uint8ClampedArray, w: number, h: number, opts: WallOptions = {}): WallModel {
  const dark = opts.dark ?? 110;
  const binary = binarize(rgba, w, h, dark);
  const wallPx = Math.max(2, opts.wallPx ?? estimateThickness(binary, w, h));
  const k = Math.max(3, Math.round(wallPx * 0.6)) | 1;
  let mask = morphOpen(binary, w, h, k);
  mask = removeSmall(mask, w, h, wallPx * wallPx * 4);
  const polygons = buildPolygons(traceLoops(mask, w, h), opts.simplify ?? 1.5);
  return { width: w, height: h, wallPx, polygons, mask };
}
