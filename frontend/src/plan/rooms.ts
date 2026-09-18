/**
 * 벽 마스크에서 방을 찾아 면적을 잰다.
 *
 *   1. 건물 윤곽: 벽을 크게 닫아(3m) 창·문 틈을 메우고, 바깥에서 닿지 않는 곳을 모두 채운다.
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

/** 이미지 가장자리에서 닿는 빈 픽셀을 바깥으로 표시한다 */
function outsideOf(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number): void => {
    if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < w * h) push(i + w);
  }
  return outside;
}

export function findRooms(mask: Uint8Array, w: number, h: number, pxPerMeter: number, opts: RoomOptions = {}): RoomReport {
  const m2 = 1 / (pxPerMeter * pxPerMeter);
  const kOutline = Math.max(3, Math.round((opts.outlineGapM ?? 3) * pxPerMeter)) | 1;
  const kDoor = Math.max(3, Math.round((opts.doorWidthM ?? 1.3) * pxPerMeter)) | 1;
  const minPx = (opts.minRoomM2 ?? 1) / m2;

  // 1. 건물 윤곽
  const closed = morphClose(mask, w, h, kOutline);
  const outside = outsideOf(closed, w, h);
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
