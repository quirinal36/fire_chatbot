import { describe, expect, it } from 'vitest';
import { fillRect } from './walls';
import { barrierOfRect, findRooms, roomLabel } from './rooms';

describe('findRooms', () => {
  it('문으로 이어진 두 방을 따로 재고 바깥은 세지 않는다', () => {
    const w = 200;
    const h = 120;
    const ppm = 10; // 1m = 10px
    const mask = new Uint8Array(w * h);
    const T = 4;
    // 바깥 벽 20..180 x 20..100 (16m x 8m 외곽)
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 180, y1: 20 + T }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 100 - T, x1: 180, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 20 + T, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 180 - T, y0: 20, x1: 180, y1: 100 }, 1);
    // 가운데 벽, 문(9px = 0.9m) 하나
    fillRect(mask, w, h, { x0: 100, y0: 20, x1: 100 + T, y1: 50 }, 1);
    fillRect(mask, w, h, { x0: 100, y0: 59, x1: 100 + T, y1: 100 }, 1);
    // 현관 (바깥 벽 끊김 1m)
    fillRect(mask, w, h, { x0: 140, y0: 100 - T, x1: 150, y1: 100 }, 0);
    // 창 (바깥 벽 끊김 2m)
    fillRect(mask, w, h, { x0: 40, y0: 20, x1: 60, y1: 20 + T }, 0);

    const r = findRooms(mask, w, h, ppm);
    expect(r.rooms).toHaveLength(2);
    // 각 방 안쪽 ≈ (76px x 76px)/100 ≈ 57㎡ 에서 벽 띠만큼 조금 작다
    for (const room of r.rooms) {
      expect(room.area).toBeGreaterThan(50);
      expect(room.area).toBeLessThan(60);
    }
    expect(r.footprintArea).toBeCloseTo(160 * 80 / 100, 0);
    expect(r.floorArea).toBeLessThan(r.footprintArea);
    expect(r.rooms[0]?.polygons.length).toBeGreaterThan(0);
  });
});

describe('barrierOfRect', () => {
  it('긴 축 중심선을 돌려준다', () => {
    expect(barrierOfRect({ x0: 10, y0: 20, x1: 40, y1: 26 })).toEqual({ a: [10, 23], b: [40, 23] });
    expect(barrierOfRect({ x0: 10, y0: 20, x1: 16, y1: 50 })).toEqual({ a: [13, 20], b: [13, 50] });
  });

  it('사용자가 놓은 넓은 창을 막으면 트여 있던 두 방이 갈린다', () => {
    const w = 200;
    const h = 120;
    const ppm = 10;
    const T = 4;
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 180, y1: 20 + T }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 100 - T, x1: 180, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 20, y0: 20, x1: 20 + T, y1: 100 }, 1);
    fillRect(mask, w, h, { x0: 180 - T, y0: 20, x1: 180, y1: 100 }, 1);
    // 가운데 벽이 2.4m(24px) 트여 있다. 문 폭(1.3m)보다 넓어 전역 닫힘으로는 안 막힌다
    fillRect(mask, w, h, { x0: 100, y0: 20, x1: 100 + T, y1: 40 }, 1);
    fillRect(mask, w, h, { x0: 100, y0: 64, x1: 100 + T, y1: 100 }, 1);
    expect(findRooms(mask, w, h, ppm).rooms).toHaveLength(1);
    const window = { x0: 100, y0: 40, x1: 100 + T, y1: 64 };
    expect(findRooms(mask, w, h, ppm, { barriers: [barrierOfRect(window)] }).rooms).toHaveLength(2);
  });
});

describe('roomLabel', () => {
  it('이름이 없으면 번호로 부른다', () => {
    expect(roomLabel(3)).toBe('구역 3');
    expect(roomLabel(3, {})).toBe('구역 3');
  });

  it('이름을 붙여도 번호를 버리지 않는다 — 목록과 도면이 같은 곳을 가리켜야 한다', () => {
    expect(roomLabel(2, { 2: '강의실' })).toBe('강의실 (구역 2)');
  });

  it('빈 이름은 번호로 되돌린다', () => {
    expect(roomLabel(1, { 1: '  ' })).toBe('구역 1');
  });
});
