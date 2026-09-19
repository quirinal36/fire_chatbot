import { describe, expect, it, vi } from 'vitest';
import { buildScalePrompt, estimateScale, plausibleGuess, readScale, scaleReadSchema, SCALE_JSON_SCHEMA } from './plan-scale';

vi.mock('./env', () => ({
  requireKey: () => 'test-key',
  env: () => ({ OPENROUTER_VISION_MODEL: 'google/test-vision' }),
  secretValues: () => [],
}));

const W = 1326;
const H = 1600;

/** y 줄의 치수선 위에 x0 부터 이어 붙인 치수 사슬. 1m = pxPerMeter 인 도면을 흉내낸다 */
function chain(y: number, x0: number, mms: readonly number[], pxPerMeter = 100): { mm: number; from: { x: number; y: number }; to: { x: number; y: number }; label: string }[] {
  let x = x0;
  return mms.map((mm) => {
    const len = (mm / 1000) * pxPerMeter;
    const seg = { mm, from: { x: x / W, y: y / H }, to: { x: (x + len) / W, y: y / H }, label: String(mm) };
    x += len;
    return seg;
  });
}
const read = (dimensions: unknown[], unit = 'mm', fallbacks: unknown[] = []) =>
  scaleReadSchema.parse({ unit, dimensions, fallbacks, note: '' });
/** 1m = pxPerMeter 인 도면에서 meters 짜리 물건이 차지하는 픽셀 */
const obj = (what: string, meters: number, pxPerMeter: number) => ({ what, meters, px: meters * pxPerMeter });

const reply = (content: unknown) =>
  new Response(
    JSON.stringify({ model: 'google/test-vision', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.002 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('치수선으로 축척 읽기', () => {
  it('프롬프트가 좌표 기준과 치수선 모양을 알려 준다', () => {
    const p = buildScalePrompt(W, H);
    expect(p).toContain(`${W}×${H}px`);
    expect(p).toContain('(0,0)');
    expect(p).toContain('치수선');
    // 숫자 자리가 아니라 구간의 양 끝을 달라고 해야 한다
    expect(p).toContain('숫자 자체의 위치가 아니라');
    // 치수선이 없는 도면을 위한 대안도 일러 준다
    expect(p).toContain('실내문 폭 0.9m');
    expect(p).toContain('서로 다른 것으로 셋 이상');
  });

  it('strict 스키마는 모든 속성을 required 로 둔다', () => {
    const walk = (node: Record<string, unknown>): void => {
      if (node['type'] === 'object') {
        expect(node['additionalProperties']).toBe(false);
        const props = Object.keys((node['properties'] ?? {}) as object);
        expect(new Set(node['required'] as string[])).toEqual(new Set(props));
        for (const v of Object.values((node['properties'] ?? {}) as Record<string, Record<string, unknown>>)) walk(v);
      }
      if (node['type'] === 'array') walk(node['items'] as Record<string, unknown>);
    };
    walk(SCALE_JSON_SCHEMA as unknown as Record<string, unknown>);
  });

  it('여러 치수가 서로 맞으면 축척을 확정한다', () => {
    const est = estimateScale(read(chain(1500, 140, [3670, 4310, 2620])), W, H);
    expect(est).not.toBeNull();
    expect(est?.pxPerMeter).toBeCloseTo(100, 6);
    expect(est?.used).toBe(3);
    expect(est?.spread).toBeLessThan(0.001);
  });

  it('사슬 전체로 재므로 구간 끝이 어긋나도 축척은 맞는다', () => {
    // 모델이 구간 끝을 제각각 ±8px 씩 어긋나게 집어 준 경우.
    // 구간 하나씩 보면 3~7% 씩 틀리지만, 사슬 양 끝만 남으므로 결과는 1% 안에 든다
    const segs = chain(1500, 140, [3670, 4310, 2620]);
    const nudge = [6, -7, 8, -5];
    const wobbly = segs.map((d, i) => ({
      ...d,
      from: { ...d.from, x: d.from.x + (nudge[i] as number) / W },
      to: { ...d.to, x: d.to.x + (nudge[i + 1] as number) / W },
    }));
    const per = wobbly.map((d) => ((d.to.x - d.from.x) * W) / (d.mm / 1000));
    const worst = Math.max(...per.map((v) => Math.abs(v - 100)));
    expect(worst).toBeGreaterThan(3);
    const est = estimateScale(read(wobbly), W, H);
    // 사슬 바깥 두 끝의 어긋남만 전체 길이에 나뉘어 남는다
    expect(Math.abs((est as { pxPerMeter: number }).pxPerMeter - 100)).toBeLessThan(worst / 3);
  });

  it('잘못 읽은 하나는 중앙값이 눌러 버린다', () => {
    // 3,670 을 367 로 읽어 10배 어긋난 구간이 섞여도 나머지가 이긴다
    const segs = chain(1500, 140, [3670, 4310, 2620]);
    const bad = [{ ...(segs[0] as object), mm: 367 }, segs[1], segs[2]];
    const est = estimateScale(read(bad), W, H);
    expect(est?.pxPerMeter).toBeCloseTo(100, 6);
    expect(est?.used).toBe(2);
    expect(est?.total).toBe(3);
  });

  it('cm·m 로 적힌 도면도 같은 축척이 나온다', () => {
    const segs = chain(1500, 140, [3670, 4310, 2620]).map((d) => ({ ...d, mm: d.mm / 1000 }));
    expect(estimateScale(read(segs, 'm'), W, H)?.pxPerMeter).toBeCloseTo(100, 6);
  });

  it('가로·세로 치수선을 함께 쓴다', () => {
    const horiz = chain(1500, 140, [3670, 4310, 2620]);
    const vert = chain(1500, 140, [4200, 3300]).map((d) => ({
      ...d,
      from: { x: 0.06, y: d.from.x * (W / H) },
      to: { x: 0.06, y: d.to.x * (W / H) },
    }));
    const est = estimateScale(read([...horiz, ...vert]), W, H);
    expect(est?.pxPerMeter).toBeCloseTo(100, 4);
    expect(est?.used).toBe(5);
  });

  it('서로 안 맞으면 축척을 내지 않는다 — 틀린 축척은 없는 것보다 나쁘다', () => {
    const mixed = [...chain(1500, 140, [3670]), ...chain(1400, 140, [4310], 70), ...chain(1300, 140, [2620], 130)];
    expect(estimateScale(read(mixed), W, H)).toBeNull();
  });

  it('구간이 둘뿐이면 더 엄하게 본다', () => {
    // 서로 8% 차이나는 두 치수선: 버린다
    expect(estimateScale(read([...chain(1500, 140, [3670]), ...chain(1400, 140, [4310], 108)]), W, H)).toBeNull();
    // 1% 차이면 받아들인다
    expect(estimateScale(read([...chain(1500, 140, [3670]), ...chain(1400, 140, [4310], 101)]), W, H)).not.toBeNull();
  });

  it('치수가 없거나 너무 짧으면 null', () => {
    expect(estimateScale(read([]), W, H)).toBeNull();
    expect(estimateScale(read(chain(1500, 140, [3670])), W, H)).toBeNull();
    // 100mm 짜리 잔치수는 오차가 커서 세지 않는다
    expect(estimateScale(read(chain(1500, 140, [100, 120])), W, H)).toBeNull();
  });

  it('치수선이 없으면 표준 치수 여러 개의 중앙값을 쓴다', () => {
    const g = plausibleGuess(read([], 'mm', [obj('실내문 폭', 0.9, 57), obj('킹 침대 세로', 2.0, 57), obj('변기 길이', 0.7, 57)]), W, H);
    expect(g?.pxPerMeter).toBeCloseTo(57, 6);
    expect(g?.used).toBe(3);
    expect(g?.basis).toContain('실내문 폭');
  });

  it('하나를 잘못 봐도 중앙값이 버틴다', () => {
    // 침대를 가로(1.9m)로 재 놓고 세로(2.0m)라고 한 경우
    const g = plausibleGuess(read([], 'mm', [obj('실내문 폭', 0.9, 57), obj('킹 침대 세로', 2.0, 40), obj('변기 길이', 0.7, 57), obj('욕조 길이', 1.7, 58)]), W, H);
    expect(g?.pxPerMeter).toBeCloseTo(57, 0);
    expect(g?.spread).toBeGreaterThan(0.2);
  });

  it('말이 안 되는 근거는 버린다', () => {
    // 1m 가 2px: 건물이 화면을 한참 넘는다
    expect(plausibleGuess(read([], 'mm', [obj('문', 0.9, 2)]), W, H)).toBeNull();
    // 1m 가 긴 변의 절반보다 크다: 건물이 2m 도 안 된다
    expect(plausibleGuess(read([], 'mm', [obj('문', 0.9, H)]), W, H)).toBeNull();
    expect(plausibleGuess(read([], 'mm', []), W, H)).toBeNull();
    // 표준 치수가 0 이면 나눌 수 없다
    expect(plausibleGuess(read([], 'mm', [{ what: 'x', meters: 0, px: 50 }]), W, H)).toBeNull();
  });

  it('치수선을 읽었으면 어림값은 쓰지 않는다', async () => {
    const fetchImpl = vi.fn(async () =>
      reply({ unit: 'mm', dimensions: chain(1500, 140, [3670, 4310, 2620]), fallbacks: [obj('침대', 2, 57)], note: '' }),
    );
    const out = await readScale({ image: { bytes: new Uint8Array([1]), type: 'image/jpeg', width: W, height: H } }, fetchImpl as unknown as typeof fetch);
    expect(out.estimate?.pxPerMeter).toBeCloseTo(100, 6);
    expect(out.guess).toBeNull();
  });

  it('치수선이 없으면 어림값이 돌아온다', async () => {
    const fetchImpl = vi.fn(async () =>
      reply({ unit: 'mm', dimensions: [], fallbacks: [obj('킹 침대 세로', 2.0, 57), obj('실내문 폭', 0.9, 57)], note: '치수선 없음' }),
    );
    const out = await readScale({ image: { bytes: new Uint8Array([1]), type: 'image/jpeg', width: W, height: H } }, fetchImpl as unknown as typeof fetch);
    expect(out.estimate).toBeNull();
    expect(out.guess?.pxPerMeter).toBeCloseTo(57, 6);
    expect(out.guess?.used).toBe(2);
  });

  it('이미지를 data URL 로 보내고 축척을 계산해 돌려준다', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; image_url?: { url: string } }[] }[] };
      const img = body.messages[0]?.content.find((c) => c.type === 'image_url');
      expect(img?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
      return reply({ unit: 'mm', dimensions: chain(1500, 140, [3670, 4310, 2620]), fallbacks: [], note: '아래 치수선을 읽었다.' });
    });
    const out = await readScale({ image: { bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg', width: W, height: H } }, fetchImpl as unknown as typeof fetch);
    expect(out.estimate?.pxPerMeter).toBeCloseTo(100, 6);
    expect(out.read.note).toBe('아래 치수선을 읽었다.');
  });

  it('치수를 못 찾았다고 오면 estimate 가 null 이고 실패는 아니다', async () => {
    const fetchImpl = vi.fn(async () => reply({ unit: 'mm', dimensions: [], fallbacks: [], note: '치수선이 보이지 않는다.' }));
    const out = await readScale({ image: { bytes: new Uint8Array([1]), type: 'image/png', width: W, height: H } }, fetchImpl as unknown as typeof fetch);
    expect(out.estimate).toBeNull();
    expect(out.guess).toBeNull();
    expect(out.read.note).toContain('치수선');
  });
});
