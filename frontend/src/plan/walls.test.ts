import { describe, expect, it } from 'vitest';
import { binarize, buildPolygons, cutOpening, estimateThickness, fillRect, morphClose, morphOpen, paintWall, signedArea, simplifyLoop, snapToAxis, traceLoops, wallMask, wallSegmentAt } from './walls';

/** 흰 바탕 RGBA 캔버스와 검은 사각형 그리기 */
function canvas(w: number, h: number): { rgba: Uint8ClampedArray; rect: (x: number, y: number, rw: number, rh: number, v?: number) => void } {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  const rect = (x: number, y: number, rw: number, rh: number, v = 0): void => {
    for (let yy = y; yy < y + rh; yy++)
      for (let xx = x; xx < x + rw; xx++) {
        const p = (yy * w + xx) * 4;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
      }
  };
  return { rgba, rect };
}

describe('binarize', () => {
  it('어두운 픽셀만 1 로 만든다', () => {
    const { rgba, rect } = canvas(4, 1);
    rect(1, 0, 1, 1, 0);
    rect(2, 0, 1, 1, 200);
    expect(Array.from(binarize(rgba, 4, 1, 110))).toEqual([0, 1, 0, 0]);
  });
});

describe('estimateThickness', () => {
  it('벽 두께를 런 길이 분포에서 찾는다', () => {
    const { rgba, rect } = canvas(200, 200);
    rect(10, 10, 180, 6); // 가로 벽 두께 6
    rect(10, 10, 6, 180); // 세로 벽 두께 6
    rect(50, 50, 100, 1); // 얇은 가구선
    const mask = binarize(rgba, 200, 200, 110);
    expect(estimateThickness(mask, 200, 200)).toBe(6);
  });
});

describe('morphOpen', () => {
  it('커널보다 얇은 선을 지우고 두꺼운 벽은 남긴다', () => {
    const { rgba, rect } = canvas(60, 60);
    rect(5, 5, 50, 8); // 벽
    rect(5, 30, 50, 1); // 얇은 선
    const mask = morphOpen(binarize(rgba, 60, 60, 110), 60, 60, 5);
    expect(mask[7 * 60 + 20]).toBe(1);
    expect(mask[30 * 60 + 20]).toBe(0);
    // 열림은 벽 두께를 바꾸지 않는다
    expect(mask[5 * 60 + 20]).toBe(1);
    expect(mask[12 * 60 + 20]).toBe(1);
    expect(mask[4 * 60 + 20]).toBe(0);
    expect(mask[13 * 60 + 20]).toBe(0);
  });
});

describe('traceLoops / buildPolygons', () => {
  it('속이 빈 사각형은 바깥 1개, 구멍 1개가 된다', () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < 18; y++)
      for (let x = 2; x < 18; x++) {
        const border = x < 5 || x >= 15 || y < 5 || y >= 15;
        if (border) mask[y * w + x] = 1;
      }
    const loops = traceLoops(mask, w, h);
    expect(loops).toHaveLength(2);
    const areas = loops.map(signedArea).sort((a, b) => a - b);
    expect(areas[0]).toBe(-100); // 구멍 10x10, 반시계
    expect(areas[1]).toBe(256); // 바깥 16x16, 시계
    const polys = buildPolygons(loops, 1);
    expect(polys).toHaveLength(1);
    expect(polys[0]?.outer).toHaveLength(4);
    expect(polys[0]?.holes[0]).toHaveLength(4);
  });

  it('문으로 끊긴 벽은 구멍 없이 바깥 테두리 하나로 남는다', () => {
    const w = 30;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < 18; y++)
      for (let x = 2; x < 28; x++) {
        if (x < 4 || x >= 26 || y < 4 || y >= 16) mask[y * w + x] = 1;
      }
    for (let y = 16; y < 18; y++) for (let x = 12; x < 18; x++) mask[y * w + x] = 0; // 출입구
    const polys = buildPolygons(traceLoops(mask, w, h), 1);
    expect(polys).toHaveLength(1);
    expect(polys[0]?.holes).toHaveLength(0);
  });

  it('모서리로만 닿은 두 덩어리는 따로 뽑는다', () => {
    const mask = new Uint8Array(16);
    mask[0] = 1; // (0,0)
    mask[5] = 1; // (1,1)
    const loops = traceLoops(mask, 4, 4);
    expect(loops).toHaveLength(2);
  });
});

describe('simplifyLoop', () => {
  it('계단 모양 대각선을 한 변으로 줄인다', () => {
    const stairs: [number, number][] = [];
    for (let i = 0; i < 10; i++) stairs.push([i, i], [i + 1, i]);
    stairs.push([10, 10], [0, 10]);
    const out = simplifyLoop(stairs, 1.5);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});

describe('wallMask', () => {
  it('합성 도면에서 벽만 남기고 가구·글자·문 호는 버린다', () => {
    const w = 300;
    const h = 200;
    const { rgba, rect } = canvas(w, h);
    const T = 6;
    rect(20, 20, 260, T); rect(20, 180 - T, 260, T); rect(20, 20, T, 160); rect(280 - T, 20, T, 160);
    rect(150, 20, T, 60); rect(150, 110, T, 70); // 가운데 벽, 80~110 출입구
    rect(60, 60, 40, 30, 80); // 가구: 회색 채움이 아니라 테두리만 얇게 그린다고 가정 → 여기선 채움을 지운다
    rect(61, 61, 38, 28, 255);
    for (let x = 200; x < 260; x++) rect(x, 100, 1, 1); // 얇은 선
    const model = wallMask(rgba, w, h);
    expect(model.wallPx).toBe(T);
    const m = model.mask;
    expect(m[22 * w + 100]).toBe(1); // 벽
    expect(m[100 * w + 230]).toBe(0); // 얇은 선
    expect(m[60 * w + 80]).toBe(0); // 가구 테두리
    expect(m[95 * w + 152]).toBe(0); // 출입구
  });
});

describe('편집', () => {
  it('paintWall 은 축에 붙인 두께 있는 벽을 칠한다', () => {
    const w = 60;
    const h = 40;
    const mask = new Uint8Array(w * h);
    const end = snapToAxis([10, 20], [50, 22]);
    expect(end).toEqual([50, 20]);
    paintWall(mask, w, h, [10, 20], end, 6);
    expect(mask[20 * w + 30]).toBe(1);
    expect(mask[17 * w + 30]).toBe(1); // 위쪽 가장자리 (20-3)
    expect(mask[16 * w + 30]).toBe(0);
    expect(mask[23 * w + 30]).toBe(0);
    expect(mask[20 * w + 8]).toBe(1); // 끝을 두께 절반만큼 늘림
    expect(mask[20 * w + 5]).toBe(0);
  });

  it('snapToAxis 는 기울어진 선은 그대로 둔다', () => {
    expect(snapToAxis([0, 0], [30, 30])).toEqual([30, 30]);
  });

  it('wallSegmentAt 은 교차점 사이 한 구간만 찾는다', () => {
    const w = 100;
    const h = 60;
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 10, y0: 20, x1: 90, y1: 26 }, 1); // 가로 벽
    fillRect(mask, w, h, { x0: 47, y0: 5, x1: 53, y1: 55 }, 1); // 세로 벽이 가운데서 교차
    const seg = wallSegmentAt(mask, w, h, [30, 23], 6);
    expect(seg).toEqual({ x0: 10, y0: 20, x1: 47, y1: 26 });
    const vert = wallSegmentAt(mask, w, h, [50, 40], 6);
    expect(vert).toEqual({ x0: 47, y0: 26, x1: 53, y1: 55 });
    expect(wallSegmentAt(mask, w, h, [50, 23], 6)).toBeNull(); // 교차점 한가운데
    expect(wallSegmentAt(mask, w, h, [5, 5], 6)).toBeNull();
    fillRect(mask, w, h, seg as NonNullable<typeof seg>, 0);
    expect(mask[23 * w + 30]).toBe(0);
    expect(mask[23 * w + 70]).toBe(1);
  });

  it('morphClose 는 좁은 틈을 메운다', () => {
    const w = 40;
    const h = 20;
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 2, y0: 8, x1: 18, y1: 12 }, 1);
    fillRect(mask, w, h, { x0: 22, y0: 8, x1: 38, y1: 12 }, 1);
    const closed = morphClose(mask, w, h, 7);
    expect(closed[10 * w + 20]).toBe(1);
    expect(closed[10 * w + 1]).toBe(0);
    expect(morphClose(mask, w, h, 3)[10 * w + 20]).toBe(0);
  });
});

describe('cutOpening', () => {
  const w = 120;
  const h = 80;
  const T = 6;
  const make = (): Uint8Array => {
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 10, y0: 20, x1: 110, y1: 20 + T }, 1); // 가로 벽
    fillRect(mask, w, h, { x0: 50, y0: 20, x1: 50 + T, y1: 70 }, 1); // 세로 벽
    return mask;
  };

  it('가로 벽에는 클릭한 자리를 가운데 두고 벽 두께를 관통해 뚫는다', () => {
    const cut = cutOpening(make(), w, h, [80, 23], null, T, 10);
    expect(cut).toEqual({ rect: { x0: 75, y0: 20, x1: 85, y1: 26 }, axis: 'h', widthPx: 10 });
  });

  it('세로 벽에는 세로로 뚫는다', () => {
    const cut = cutOpening(make(), w, h, [53, 50], null, T, 10);
    expect(cut?.axis).toBe('v');
    expect(cut?.rect).toEqual({ x0: 50, y0: 45, x1: 56, y1: 55 });
  });

  it('끌면 끈 구간이 폭이 된다', () => {
    const cut = cutOpening(make(), w, h, [70, 23], [94, 30], T, 10);
    expect(cut?.rect).toEqual({ x0: 70, y0: 20, x1: 94, y1: 26 });
    expect(cut?.widthPx).toBe(24);
  });

  it('벽 구간을 넘지 않게 당긴다', () => {
    const cut = cutOpening(make(), w, h, [12, 23], null, T, 30);
    expect(cut?.rect.x0).toBe(10);
    expect(cut?.rect.x1).toBe(40);
  });

  it('벽이 아니면 null, 뚫은 자리는 마스크에서 비워진다', () => {
    const mask = make();
    expect(cutOpening(mask, w, h, [80, 60], null, T, 10)).toBeNull();
    const cut = cutOpening(mask, w, h, [80, 23], null, T, 10);
    fillRect(mask, w, h, (cut as NonNullable<typeof cut>).rect, 0);
    expect(mask[23 * w + 80]).toBe(0);
    expect(mask[23 * w + 70]).toBe(1);
  });
});
