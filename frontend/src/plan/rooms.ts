/**
 * 벽 마스크에서 방을 찾아 면적을 잰다.
 *
 *   1. 건물 윤곽: 이미지 밖의 빈 공간에서 벽을 뚫지 않고 다가갈 수 있는 곳이 바깥이다. 벽에서 1.5m
 *      이내로는 "먼 바깥"에서 1.5m 걸음 안에서만 들어올 수 있어, 3m 보다 좁은 창·문 틈은 못 지난다.
 *   2. 방: 윤곽 안에서 방 사이 출입구를 막은 뒤, 남은 빈 곳의 덩어리 하나가 방 하나다.
 *      막는 방법이 둘이다.
 *        - 개구부 후보(openings.ts)를 `barriers` 로 주면 그 선분만 임시로 막고, 전역 닫힘은 벽의 잔 끊김을
 *          메우는 정도(0.4m)로만 건다. 좁은 복도·욕실이 살아남고 모서리 문·넓은 개구부도 막힌다.
 *        - 후보가 없으면 벽을 문 폭만큼(1.3m) 전역으로 닫는다. 1.3m 보다 좁은 공간이 통째로 사라지고
 *          모서리 문은 못 막는 한계가 있다 (docs/plan-ai-roadmap.md 2절).
 *      막는 선분은 방 계산에만 쓰고 벽 마스크에는 칠하지 않는다. 면적은 원래 마스크 기준으로 잰다.
 *   3. 면적 = 픽셀 수 ÷ (1m 당 픽셀 수)². 너무 작은 조각(1㎡ 미만)은 버린다.
 *
 * 벽이 하나도 없으면 인식 실패로 보고 빈 결과를 돌려준다. 그러지 않으면 바깥이 생기지 않아 이미지 전체가
 * 방 하나가 되어, 추출 실패가 그럴듯한 면적으로 둔갑한다.
 */
import { dilate, labelComponents, morphClose, polygonsFromMask, type Pt, type WallPolygon } from './walls';

/**
 * 구역을 부르는 이름. 목록과 도면이 똑같은 말을 써야 색을 못 봐도 둘을 잇는다.
 * 이름을 붙인 구역도 번호를 버리지 않는다 — 목록은 번호로, 도면은 이름으로 부르면 같은 곳인 줄 모른다.
 */
export function roomLabel(id: number, names?: Readonly<Record<number, string>>): string {
  const name = names?.[id]?.trim();
  return name ? `${name} (구역 ${id})` : `구역 ${id}`;
}

export interface Room {
  readonly id: number;
  /** ㎡ */
  readonly area: number;
  /** 픽셀 좌표 중심 */
  readonly center: readonly [number, number];
  readonly polygons: WallPolygon[];
}

export interface RoomReport {
  /** 건물 윤곽 안 바닥 면적(벽 제외), ㎡ */
  readonly floorArea: number;
  /** 벽을 포함한 건물 윤곽 면적, ㎡ */
  readonly footprintArea: number;
  readonly rooms: Room[];
}

/** 방 계산에서만 임시로 막는 선분. 개구부 후보의 양 끝이다 */
export interface Barrier {
  readonly a: Pt;
  readonly b: Pt;
}

export interface RoomOptions {
  /**
   * 이 폭(m)보다 좁은 틈은 전역 닫힘으로 막는다. barriers 가 있으면 0.4(벽의 잔 끊김만),
   * 없으면 1.3(문 폭)이 기본이다
   */
  readonly doorWidthM?: number;
  /** 방 사이를 막을 선분(문·창으로 판정된 개구부 후보). 벽 마스크는 바꾸지 않는다 */
  readonly barriers?: readonly Barrier[];
  /** 막는 선분의 두께(px). 기본 3 */
  readonly barrierPx?: number;
  /** 건물 윤곽을 찾을 때 메우는 최대 틈(m) */
  readonly outlineGapM?: number;
  /** 이보다 작은 방은 버린다(㎡) */
  readonly minRoomM2?: number;
}

/** 각 픽셀에서 가장 가까운 벽까지의 체비쇼프 거리(8-연결 BFS). 벽은 0 */
function wallDistance(mask: Uint8Array, w: number, h: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  let queue: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) { dist[i] = 0; queue.push(i); }
  let d = 0;
  while (queue.length) {
    const next: number[] = [];
    d++;
    for (const i of queue) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (dist[j] === -1) { dist[j] = d; next.push(j); }
        }
      }
    }
    queue = next;
  }
  return dist;
}

/**
 * 건물 바깥을 찾는다. 이미지 밖은 끝없는 빈 공간이라고 본다.
 * 벽에서 r 이상 떨어진 채로 가장자리에서 닿을 수 있는 곳이 "먼 바깥"이고, 거기서 벽을 뚫지 않고
 * r 걸음까지 다가간 곳까지가 바깥이다. 폭이 2r 보다 좁은 창·문 틈으로는 거의 들어오지 못한다.
 * 가장자리 픽셀은 이미지 밖의 먼 바깥에서 (r - 벽까지 거리)만큼 걸어온 것으로 쳐서 남은 걸음을 준다.
 */
export function outsideRegion(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dist = wallDistance(mask, w, h);
  const reached = new Uint8Array(w * h);
  const buckets: number[][] = Array.from({ length: r + 1 }, () => []);
  const seed = (i: number, budget: number): void => {
    if (mask[i] || reached[i] || budget <= 0) return;
    reached[i] = 1;
    buckets[Math.min(r, budget)]?.push(i);
  };
  // 가장자리: 벽까지 거리만큼(최대 r) 걸을 수 있다
  for (let x = 0; x < w; x++) { seed(x, dist[x] ?? 0); seed((h - 1) * w + x, dist[(h - 1) * w + x] ?? 0); }
  for (let y = 0; y < h; y++) { seed(y * w, dist[y * w] ?? 0); seed(y * w + w - 1, dist[y * w + w - 1] ?? 0); }
  // 먼 바깥끼리는 걸음을 쓰지 않고 이어진다. 가장자리에서 이어진 먼 바깥은 모두 예산 r
  const farQueue: number[] = [];
  for (const i of buckets[r] ?? []) if ((dist[i] ?? 0) >= r) farQueue.push(i);
  while (farQueue.length) {
    const i = farQueue.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!reached[j] && (dist[j] ?? 0) >= r) { reached[j] = 1; buckets[r]?.push(j); farQueue.push(j); }
    }
  }
  // 남은 걸음이 많은 곳부터 퍼져 나간다
  for (let b = r; b >= 1; b--) {
    for (const i of buckets[b] ?? []) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!mask[j] && !reached[j]) { reached[j] = 1; if (b - 1 >= 1) buckets[b - 1]?.push(j); }
      }
    }
  }
  return reached;
}

/** 선분 a~b 를 두께 thick 로 칠한다. 사선도 그대로 칠한다 (모서리 문은 사선이다) */
export function paintSegment(mask: Uint8Array, w: number, h: number, a: Pt, b: Pt, thick: number): void {
  const r = thick / 2;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a[0];
      const py = y + 0.5 - a[1];
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      if (ex * ex + ey * ey <= r * r) mask[y * w + x] = 1;
    }
  }
}

const EMPTY: RoomReport = { floorArea: 0, footprintArea: 0, rooms: [] };

export function findRooms(mask: Uint8Array, w: number, h: number, pxPerMeter: number, opts: RoomOptions = {}): RoomReport {
  if (!mask.some((v) => v === 1)) return EMPTY;
  const m2 = 1 / (pxPerMeter * pxPerMeter);
  const barriers = opts.barriers ?? [];
  const kOutline = Math.max(3, Math.round((opts.outlineGapM ?? 3) * pxPerMeter)) | 1;
  const kDoor = Math.max(3, Math.round((opts.doorWidthM ?? (barriers.length ? 0.4 : 1.3)) * pxPerMeter)) | 1;
  const minPx = (opts.minRoomM2 ?? 1) / m2;

  // 0. 판정된 개구부를 임시로 막는다. 원래 마스크는 면적을 잴 때 그대로 쓴다
  let sealed = mask;
  if (barriers.length) {
    sealed = mask.slice();
    for (const s of barriers) paintSegment(sealed, w, h, s.a, s.b, opts.barrierPx ?? 3);
  }

  // 1. 건물 윤곽
  const outside = outsideRegion(sealed, w, h, kOutline >> 1);
  let footprintPx = 0;
  let floorPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (outside[i]) continue;
    footprintPx++;
    if (!mask[i]) floorPx++;
  }

  // 2. 방: 윤곽 안 & 벽 아님 & 닫은 벽 아님
  const doorClosed = morphClose(sealed, w, h, kDoor);
  // 벽 표면에 붙은 얇은 띠는 방에서 빼서 인접 방이 벽 한 겹으로 이어지는 걸 막는다
  const wallBand = dilate(sealed, w, h, 3);
  const free = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) free[i] = !outside[i] && !doorClosed[i] && !wallBand[i] ? 1 : 0;
  const { labels, areas } = labelComponents(free, w, h);

  const rooms: Room[] = [];
  const sums = new Map<number, { sx: number; sy: number }>();
  for (let i = 0; i < w * h; i++) {
    const id = labels[i] ?? 0;
    if (!id || (areas[id] ?? 0) < minPx) continue;
    const x = i % w;
    const y = (i - x) / w;
    const s = sums.get(id) ?? { sx: 0, sy: 0 };
    s.sx += x;
    s.sy += y;
    sums.set(id, s);
  }
  let n = 0;
  for (const [id, s] of sums) {
    const area = areas[id] ?? 0;
    const roomMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (labels[i] === id) roomMask[i] = 1;
    // 벽 띠만큼 다시 넓혀 벽 면까지 닿게 한다 (표시용)
    const grown = dilate(roomMask, w, h, 3);
    let grownPx = 0;
    for (let i = 0; i < w * h; i++) {
      if (mask[i] || outside[i]) grown[i] = 0;
      else if (grown[i]) grownPx++;
    }
    rooms.push({
      id: ++n,
      area: grownPx * m2,
      center: [s.sx / area, s.sy / area],
      polygons: polygonsFromMask(grown, w, h, 2),
    });
  }
  rooms.sort((a, b) => b.area - a.area);
  return {
    floorArea: floorPx * m2,
    footprintArea: footprintPx * m2,
    rooms: rooms.map((r, i) => ({ ...r, id: i + 1 })),
  };
}
