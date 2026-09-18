/**
 * 벽이 끊긴 자리(개구부)를 찾는다. 같은 행(또는 열)에서 벽 → 빈칸 → 벽 순서로 이어지고 빈칸이 문·창 폭
 * 안이면 그 빈칸이 개구부 후보다. 가로 벽의 창은 행마다, 세로 벽의 문은 열마다 같은 자리에 잡혀 띠가 된다.
 * 방 안쪽 넓은 빈칸은 폭 조건에서, 복도처럼 좁은 방은 두께 조건에서 걸러진다.
 */
import { labelComponents, type Rect } from './walls';

export interface Opening {
  readonly id: number;
  readonly rect: Rect;
  /** 벽이 가로로 이어지는 자리면 'h' (개구부 폭이 가로) */
  readonly axis: 'h' | 'v';
  readonly widthM: number;
}

export interface OpeningOptions {
  /** 이보다 넓은 틈은 개구부로 보지 않는다(m) */
  readonly maxWidthM?: number;
  /** 이보다 좁은 틈은 무시한다(m) */
  readonly minWidthM?: number;
}

export function findOpenings(mask: Uint8Array, w: number, h: number, wallPx: number, pxPerMeter: number, opts: OpeningOptions = {}): Opening[] {
  const maxPx = Math.round((opts.maxWidthM ?? 2.6) * pxPerMeter);
  const minPx = Math.round((opts.minWidthM ?? 0.5) * pxPerMeter);
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
  const out: Opening[] = [];
  for (const [id, b] of boxes) {
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const thin = Math.min(bw, bh);
    const long = Math.max(bw, bh);
    // 벽 두께만큼 얇고, 사람 폭 이상 길며, 상자를 거의 채워야 개구부
    if (thin > wallPx * 2.2 || long < minPx || long > maxPx * 1.2) continue;
    if ((areas[id] ?? 0) < bw * bh * 0.6) continue;
    out.push({ id: 0, rect: { ...b }, axis: bw >= bh ? 'h' : 'v', widthM: long / pxPerMeter });
  }
  out.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
  return out.map((o, i) => ({ ...o, id: i + 1 }));
}
