/**
 * 벽 마스크에서 방을 찾아 면적을 잰다.
 *
 *   1. 건물 윤곽: 이미지 밖의 빈 공간에서 벽을 뚫지 않고 다가갈 수 있는 곳이 바깥이다. 벽에서 1.5m
 *      이내로는 "먼 바깥"에서 1.5m 걸음 안에서만 들어올 수 있어, 3m 보다 좁은 창·문 틈은 못 지난다.
 *   2. 방: 윤곽 안에서 벽을 문 폭만큼(1.3m) 닫아 방 사이 출입구를 막은 뒤, 남은 빈 곳의 덩어리 하나가 방 하나다.
 *   3. 면적 = 픽셀 수 ÷ (1m 당 픽셀 수)². 너무 작은 조각(1㎡ 미만)은 버린다.
 */
import { dilate, labelComponents, morphClose, polygonsFromMask, type WallPolygon } from './walls';

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

export interface RoomOptions {
  /** 이 폭(m)보다 좁은 틈은 문·창으로 보고 방 사이를 막는다 */
  readonly doorWidthM?: number;
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
function outsideRegion(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
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

export function findRooms(mask: Uint8Array, w: number, h: number, pxPerMeter: number, opts: RoomOptions = {}): RoomReport {
  const m2 = 1 / (pxPerMeter * pxPerMeter);
  const kOutline = Math.max(3, Math.round((opts.outlineGapM ?? 3) * pxPerMeter)) | 1;
  const kDoor = Math.max(3, Math.round((opts.doorWidthM ?? 1.3) * pxPerMeter)) | 1;
  const minPx = (opts.minRoomM2 ?? 1) / m2;

  // 1. 건물 윤곽
  const outside = outsideRegion(mask, w, h, kOutline >> 1);
  let footprintPx = 0;
  let floorPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (outside[i]) continue;
    footprintPx++;
    if (!mask[i]) floorPx++;
  }

  // 2. 방: 윤곽 안 & 벽 아님 & 문 폭으로 닫은 벽 아님
  const doorClosed = morphClose(mask, w, h, kDoor);
  // 벽 표면에 붙은 얇은 띠는 방에서 빼서 인접 방이 벽 한 겹으로 이어지는 걸 막는다
  const wallBand = dilate(mask, w, h, 3);
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
