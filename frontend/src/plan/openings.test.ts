import { describe, expect, it } from 'vitest';
import { fillRect } from './walls';
import { findOpenings } from './openings';

describe('findOpenings', () => {
  it('문·창 틈은 찾고 모서리는 무시한다', () => {
    const w = 200;
    const h = 120;
    const ppm = 20; // 1m = 20px
    const T = 4;
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 180, y1: 20 + T }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 100 - T, x1: 180, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 20 + T, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 180 - T, y0: 20, x1: 180, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 100, y0: 20, x1: 100 + T, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 100, y0: 50, x1: 100 + T, y1: 68 }, 0); // 세로 벽의 문 0.9m
    fillRect(mask, w, h, { x0: 40, y0: 20, x1: 70, y1: 20 + T }, 0); // 위 벽의 창 1.5m
    const found = findOpenings(mask, w, h, T, ppm);
    expect(found).toHaveLength(2);
    const [win, door] = found;
    expect(win?.axis).toBe('h');
    expect(win?.widthM).toBeCloseTo(1.5, 1);
    expect(door?.axis).toBe('v');
    expect(door?.widthM).toBeCloseTo(0.9, 1);
    expect(door?.rect).toEqual({ x0: 100, y0: 50, x1: 104, y1: 68 });
  });
});
