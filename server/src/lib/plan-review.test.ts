import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, contextSchema, reviewPlan, REVIEW_JSON_SCHEMA } from './plan-review';

vi.mock('./env', () => ({
  requireKey: () => 'test-key',
  env: () => ({ OPENROUTER_VISION_MODEL: 'google/test-vision' }),
  secretValues: () => [],
}));

const ctx = contextSchema.parse({
  grid: { cols: 12, rows: 8 },
  params: { dark: 160, wallPx: 23, pxPerMeter: 115 },
  openings: [{ id: 1, widthM: 0.9, cell: 'C4' }, { id: 2, widthM: 1.7, cell: 'F1' }],
  rooms: [{ id: 1, areaM2: 55.7, cell: 'E5' }],
});
const image = { bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg', width: 1024, height: 700 };

const reply = (content: unknown) =>
  new Response(JSON.stringify({ model: 'google/test-vision', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.002 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const good = {
  quality: 0.8,
  summary: '대체로 맞다.',
  falseWalls: [{ cell: 'D6', what: '책상' }],
  missingWalls: [{ from: { x: 0.1, y: 0.2 }, to: { x: 0.4, y: 0.2 }, why: '얇은 벽' }],
  openings: [{ id: 1, kind: 'door' }, { id: 2, kind: 'window' }, { id: 9, kind: 'open' }],
  rooms: [{ id: 1, name: '사무실' }, { id: 7, name: '없는 방' }],
  scale: { pxPerMeter: 120, basis: '문 폭 0.9m' },
  params: { dark: null, wallPx: null },
};

describe('도면 AI 검토', () => {
  it('프롬프트에 격자·개구부·구역 번호를 넣는다', () => {
    const p = buildPrompt(ctx, 1024, 700);
    expect(p).toContain('12×8');
    expect(p).toContain('ABCDEFGHIJKL');
    expect(p).toContain('1: C4 칸, 폭 0.9m');
    expect(p).toContain('1: E5 칸, 55.7㎡');
  });

  it('strict 스키마는 모든 속성을 required 로 둔다', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; items?: unknown; additionalProperties?: unknown };
      if (n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect(new Set(n.required)).toEqual(new Set(Object.keys(n.properties)));
        for (const v of Object.values(n.properties)) walk(v);
      }
      if (n.items) walk(n.items);
    };
    walk(REVIEW_JSON_SCHEMA);
  });

  it('이미지를 data URL 로 보내고, 보낸 번호만 받아들인다', async () => {
    const f = vi.fn().mockResolvedValue(reply(good));
    const out = await reviewPlan({ ctx, image }, f as never);
    const body = JSON.parse((f.mock.calls[0] as [string, { body: string }])[1].body) as { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[]; response_format: { json_schema: { name: string } } };
    expect(body.model).toBe('google/test-vision');
    expect(body.response_format.json_schema.name).toBe('PlanReview');
    expect(body.messages[0]?.content[1]?.image_url?.url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(out.review.openings.map((o) => o.id)).toEqual([1, 2]);
    expect(out.review.rooms).toEqual([{ id: 1, name: '사무실' }]);
    expect(out.usage.costUsd).toBe(0.002);
  });

  it('총평과 점수가 없으면 invalid_output', async () => {
    for (const bad of ['문자열 응답', [], { summary: '점수가 없다' }, { quality: 0.5 }]) {
      const f = vi.fn().mockResolvedValue(reply(bad));
      await expect(reviewPlan({ ctx, image }, f as never)).rejects.toMatchObject({ kind: 'invalid_output' });
    }
  });

  it('길이·범위를 넘긴 값은 버리지 않고 다듬는다', async () => {
    const f = vi.fn().mockResolvedValue(
      reply({
        ...good,
        quality: 1.4,
        summary: '가'.repeat(500),
        falseWalls: [{ cell: 'D6', what: '책'.repeat(100) }],
        // 항목 하나가 깨진 목록은 그 목록만 비운다
        missingWalls: [{ from: { x: 0.1 }, to: { x: 0.4, y: 0.2 }, why: '얇은 벽' }],
        scale: { pxPerMeter: 0, basis: '근거 없음' },
        params: { dark: 999, wallPx: 0 },
      }),
    );
    const { review } = await reviewPlan({ ctx, image }, f as never);
    expect(review.quality).toBe(1);
    expect(review.summary).toHaveLength(400);
    expect(review.falseWalls[0]?.what).toHaveLength(80);
    expect(review.missingWalls).toEqual([]);
    expect(review.scale.pxPerMeter).toBeNull();
    expect(review.params).toEqual({ dark: 255, wallPx: 1 });
  });
});
