import { describe, expect, it } from 'vitest';
import { DEFAULT_DARK, binarize, buildPolygons, cutOpening, gapAt, placeOpening, estimateThickness, estimateThicknessModes, fillRect, hatchKernel, morphClose, morphOpen, paintWall, signedArea, simplifyLoop, snapToAxis, traceLoops, wallMask, wallSegmentAt, bridgeGaps, bridgeKernel, estimateThicknessStable } from './walls';

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

/**
 * 외벽은 짙게 채우고 내벽은 빗금으로 채운 도면. 두께를 하나만 잡으면 내벽이 통째로 사라진다.
 */
describe('두 가지 두께로 그린 도면', () => {
  const w = 400;
  const h = 300;
  const OUTER = 20;
  /** 내벽: 두 가는 선 사이를 빗금으로 채운 띠 */
  const INNER = 10;

  /** 여백 안에 외벽 사각형을 두고, 안을 빗금 내벽으로 가른다 */
  function draw(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const dot = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = (y * w + x) * 4;
      px[p] = px[p + 1] = px[p + 2] = 0;
    };
    const box = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) dot(x, y);
    };
    const M = 30; // 도면 여백
    const [L, T, R, B] = [M, M, w - M, h - M];
    // 외벽: 짙게 채운 테두리
    box(L, T, R, T + OUTER);
    box(L, B - OUTER, R, B);
    box(L, T, L + OUTER, B);
    box(R - OUTER, T, R, B);
    // 내벽: 가는 선 두 줄 사이를 빗금으로 채운 띠. 세로 하나, 가로 하나
    const band = (x0: number, y0: number, x1: number, y1: number): void => {
      const vertical = x1 - x0 < y1 - y0;
      if (vertical) {
        for (let y = y0; y < y1; y++) { dot(x0, y); dot(x0 + 1, y); dot(x1 - 2, y); dot(x1 - 1, y); }
        for (let y = y0; y < y1; y += 5) for (let i = 0; i < x1 - x0; i++) dot(x0 + i, y + i);
      } else {
        for (let x = x0; x < x1; x++) { dot(x, y0); dot(x, y0 + 1); dot(x, y1 - 2); dot(x, y1 - 1); }
        for (let x = x0; x < x1; x += 5) for (let i = 0; i < y1 - y0; i++) dot(x + i, y0 + i);
      }
    };
    band(195, T + OUTER, 195 + INNER, B - OUTER);
    band(L + OUTER, 160, 195, 160 + INNER);
    // 가구: 가는 선. 남으면 안 된다
    for (let x = 70; x < 170; x++) { dot(x, 70); dot(x, 130); }
    for (let y = 70; y < 130; y++) { dot(70, y); dot(170, y); }
    return px;
  }

  it('굵은 벽과 얇은 벽을 따로 찾는다', () => {
    const bin = binarize(draw(), w, h, DEFAULT_DARK);
    // 빗금 띠는 가로로 자르면 얇은 런만 남아 두께 투표에 제 두께로 끼지 못한다
    const solid = morphClose(bin, w, h, hatchKernel(estimateThickness(bin, w, h)));
    const modes = estimateThicknessModes(solid, w, h);
    expect(modes.thick).toBe(OUTER);
    expect(modes.thin).not.toBeNull();
    expect(modes.thin).toBeGreaterThanOrEqual(INNER - 2);
    expect(modes.thin).toBeLessThanOrEqual(INNER + 2);
  });

  it('빗금 내벽을 남기고 가구는 버린다', () => {
    const { mask, wallPx, thinPx } = wallMask(draw(), w, h);
    // 축척 가정은 외벽 기준이라야 맞다
    expect(wallPx).toBe(OUTER);
    expect(thinPx).not.toBeNull();
    // 세로 내벽이 위아래로 이어져 있다
    for (const y of [80, 150, 240]) expect(mask[y * w + 200]).toBe(1);
    // 가로 내벽도 남았다
    expect(mask[165 * w + 120]).toBe(1);
    // 가구는 사라졌다
    expect(mask[70 * w + 120]).toBe(0);
    expect(mask[100 * w + 70]).toBe(0);
  });

  it('두께를 지정하면 그 두께 하나로만 본다 — 굵게 잡으면 내벽이 사라진다', () => {
    const { mask, thinPx } = wallMask(draw(), w, h, { wallPx: OUTER });
    expect(thinPx).toBeNull();
    expect(mask[150 * w + 200]).toBe(0);
    expect(mask[150 * w + 35]).toBe(1);
  });
});

/**
 * 선으로만 그린 도면(가구·글자가 1~2px). 얇은 런이 아무리 많아도 벽 표현으로 보면 안 된다.
 * 이걸 놓치면 열림 커널이 3 으로 내려가 걸러 내는 일을 아예 안 하게 된다.
 */
describe('가는 선이 많은 도면', () => {
  const w = 400;
  const h = 300;
  const WALL = 6;

  function draw(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const dot = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = (y * w + x) * 4;
      px[p] = px[p + 1] = px[p + 2] = 0;
    };
    const box = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) dot(x, y);
    };
    const [L, T, R, B] = [30, 30, w - 30, h - 30];
    box(L, T, R, T + WALL);
    box(L, B - WALL, R, B);
    box(L, T, L + WALL, B);
    box(R - WALL, T, R, B);
    box(200, T, 200 + WALL, B);
    // 가구·글자: 1~2px 선을 잔뜩 (실제 도면에서는 이쪽이 벽보다 픽셀이 많다)
    for (let k = 0; k < 24; k++) {
      const y = 45 + k * 9;
      for (let x = 45; x < 190; x++) { dot(x, y); dot(x, y + 1); }
    }
    for (let k = 0; k < 14; k++) {
      const x = 215 + k * 11;
      for (let y = 45; y < 250; y++) dot(x, y);
    }
    return px;
  }

  it('가는 선은 얇은 벽으로 뽑지 않는다', () => {
    const bin = binarize(draw(), w, h, DEFAULT_DARK);
    const solid = morphClose(bin, w, h, hatchKernel(estimateThickness(bin, w, h)));
    const modes = estimateThicknessModes(solid, w, h);
    expect(modes.thick).toBe(WALL);
    expect(modes.thin).toBeNull();
  });

  it('가구가 마스크에 남지 않는다', () => {
    const { mask, thinPx } = wallMask(draw(), w, h);
    expect(thinPx).toBeNull();
    expect(mask[150 * w + 120]).toBe(0);
    expect(mask[150 * w + 260]).toBe(0);
    // 벽은 남는다
    expect(mask[150 * w + 32]).toBe(1);
    expect(mask[150 * w + 202]).toBe(1);
  });
});

describe('bridgeGaps — 끊긴 벽 잇기', () => {
  it('같은 줄에서 좁게 끊긴 벽은 잇고, 문 폭으로 끊긴 자리와 나란한 다른 벽은 건드리지 않는다', () => {
    const w = 200;
    const h = 100;
    const T = 6;
    const mask = new Uint8Array(w * h);
    // 점선처럼 토막 난 세로 벽: 20px 벽, 8px 틈 반복
    for (let y = 10; y < 90; y += 28) fillRect(mask, w, h, { x0: 50, y0: y, x1: 50 + T, y1: Math.min(90, y + 20) }, 1);
    // 문(40px)으로 끊긴 가로 벽
    fillRect(mask, w, h, { x0: 80, y0: 50, x1: 120, y1: 50 + T }, 1);
    fillRect(mask, w, h, { x0: 160, y0: 50, x1: 190, y1: 50 + T }, 1);
    // 세로 벽과 나란히 커널보다 멀리(30px) 떨어진 다른 벽 조각
    fillRect(mask, w, h, { x0: 86, y0: 10, x1: 92, y1: 40 }, 1);
    const out = bridgeGaps(mask, w, h, bridgeKernel(T));
    // 토막 난 세로 벽이 이어졌다
    for (let y = 10; y < 86; y++) expect(out[y * w + 52]).toBe(1);
    // 문은 그대로 열려 있다
    expect(out[52 * w + 140]).toBe(0);
    // 커널보다 먼 나란한 벽 사이(가로 30px)는 메워지지 않는다
    expect(out[20 * w + 70]).toBe(0);
    // 원래 픽셀은 그대로다
    for (let i = 0; i < w * h; i++) if (mask[i]) expect(out[i]).toBe(1);
  });
});

describe('estimateThicknessStable — 윤곽선으로만 그린 벽', () => {
  it('속이 빈 이중선 벽에서도 두께를 찾는다 (런 길이 투표는 못 찾는다)', () => {
    const w = 300;
    const h = 200;
    const T = 16; // 벽 두께
    const mask = new Uint8Array(w * h);
    // 윤곽선 두 줄(2px)만 그린 벽. 속은 비어 있다
    const hollow = (x0: number, y0: number, x1: number, y1: number): void => {
      if (x1 - x0 > y1 - y0) {
        fillRect(mask, w, h, { x0, y0, x1, y1: y0 + 2 }, 1);
        fillRect(mask, w, h, { x0, y0: y1 - 2, x1, y1 }, 1);
      } else {
        fillRect(mask, w, h, { x0, y0, x1: x0 + 2, y1 }, 1);
        fillRect(mask, w, h, { x0: x1 - 2, y0, x1, y1 }, 1);
      }
    };
    hollow(20, 20, 280, 20 + T);
    hollow(20, 180 - T, 280, 180);
    hollow(20, 20, 20 + T, 180);
    hollow(280 - T, 20, 280, 180);
    hollow(150, 20, 150 + T, 180);
    // 가구·치수선: 2px 가는 선을 잔뜩
    for (let y = 40; y < 170; y += 7) fillRect(mask, w, h, { x0: 40, y0: y, x1: 130, y1: y + 2 }, 1);
    const { thick, closeK } = estimateThicknessStable(mask, w, h);
    // 런 길이 투표는 2px(가는 선)를 고른다
    expect(estimateThickness(mask, w, h)).toBeLessThan(6);
    // 안정 구간 방식은 벽 두께를 찾는다
    expect(thick).toBeGreaterThanOrEqual(T - 4);
    expect(thick).toBeLessThanOrEqual(T + 6);
    // 벽 속을 채우려면 두께만 한 커널이 필요하다
    expect(closeK).toBeGreaterThanOrEqual(T - 6);
  });
});

/**
 * 문·창은 실제 도면에서 벽이 없는 빈 자리다. 벽 위면 벽을 뚫고, 빈 자리면 벽 끝 사이를 잡는다.
 */
describe('placeOpening / gapAt', () => {
  const w = 120;
  const h = 80;
  const T = 6;
  /** 가로 벽이 x 40~60 에서 끊겨 있고, 아래쪽 x 30·70 에 세로 벽 두 개가 서 있다 */
  const make = (): Uint8Array => {
    const mask = new Uint8Array(w * h);
    fillRect(mask, w, h, { x0: 10, y0: 20, x1: 40, y1: 20 + T }, 1);
    fillRect(mask, w, h, { x0: 60, y0: 20, x1: 110, y1: 20 + T }, 1);
    fillRect(mask, w, h, { x0: 30, y0: 40, x1: 30 + T, y1: 70 }, 1);
    fillRect(mask, w, h, { x0: 70, y0: 40, x1: 70 + T, y1: 70 }, 1);
    return mask;
  };

  it('gapAt: 벽 사이 틈을 [lo, hi) 로 돌려주고, 한쪽이 트여 있으면 null', () => {
    expect(gapAt(make(), w, h, [50, 23], 'h', 60)).toEqual({ lo: 40, hi: 60 });
    expect(gapAt(make(), w, h, [50, 23], 'v', 60)).toBeNull(); // 위로는 벽이 없다
    expect(gapAt(make(), w, h, [50, 23], 'h', 5)).toBeNull(); // 너무 넓은 틈
    expect(gapAt(make(), w, h, [50, 22], 'h', 60)).toEqual({ lo: 40, hi: 60 });
  });

  it('벽 위면 cutOpening 과 같은 결과에 onWall 이 붙는다', () => {
    const placed = placeOpening(make(), w, h, [80, 23], null, T, 10, 60);
    expect(placed).toEqual({ ...cutOpening(make(), w, h, [80, 23], null, T, 10), onWall: true });
  });

  it('벽 끝 사이 빈 틈을 클릭하면 틈 전체가 개구부가 되고 두께는 벽 두께다', () => {
    const placed = placeOpening(make(), w, h, [50, 23], null, T, 10, 60);
    expect(placed).toEqual({ rect: { x0: 40, y0: 20, x1: 60, y1: 26 }, axis: 'h', widthPx: 20, onWall: false });
  });

  it('가로·세로 모두 막혀 있으면 좁은 쪽 틈을 고른다', () => {
    const mask = make();
    fillRect(mask, w, h, { x0: 10, y0: 60, x1: 110, y1: 66 }, 1); // 아래 벽: 세로 틈 26~60 (34px)
    const placed = placeOpening(mask, w, h, [50, 45], null, T, 10, 60); // 가로 틈 36~70 (34px), 같으면 가로
    expect(placed?.axis).toBe('h');
    expect(placed?.rect).toEqual({ x0: 36, y0: 42, x1: 70, y1: 48 });
  });

  it('빈 자리를 끌면 끈 방향 축으로 끈 만큼이 폭이고, 벽 가까운 끝은 벽에 붙는다', () => {
    const placed = placeOpening(make(), w, h, [37, 50], [65, 53], T, 10, 60);
    // 시작 37 은 세로 벽(30~36)에서 1px 떨어져 붙고, 끝 65 는 벽(70~)에서 5px 떨어져 붙는다
    expect(placed).toEqual({ rect: { x0: 36, y0: 47, x1: 70, y1: 53 }, axis: 'h', widthPx: 34, onWall: false });
  });

  it('벽에서 먼 빈 자리를 끌면 끈 구간 그대로다', () => {
    const placed = placeOpening(make(), w, h, [45, 10], [45, 4], T, 10, 60);
    expect(placed?.rect).toEqual({ x0: 42, y0: 4, x1: 48, y1: 10 });
    expect(placed?.axis).toBe('v');
  });

  it('막힌 틈이 없는 자리에서 클릭만 하면 null', () => {
    expect(placeOpening(make(), w, h, [50, 10], null, T, 10, 60)).toBeNull();
  });
});
