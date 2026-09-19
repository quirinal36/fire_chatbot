/**
 * 도면 AI 검토. 알고리즘이 벽을 잡은 결과(원본 위에 벽·격자·개구부 번호·구역 번호를 겹친 그림)를
 * 시각 모델에 보여 주고, 무엇을 고칠지 구조화 JSON 으로 받는다. 수정 자체는 화면 쪽 알고리즘이 한다.
 *
 * 모델은 픽셀 좌표에 약하므로 잘못 잡힌 벽은 격자 칸으로, 빠진 벽은 0~1 정규화 좌표로 받고,
 * 개구부·구역은 우리가 번호를 매겨 보낸 것을 번호로 되돌려 받는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callChatModel, ModelError } from './chat/openrouter';
import { env } from './env';
import { HttpError } from './http-error';
import { log } from './log';

export const REVIEW_PROMPT_VERSION = 'plan-review-v1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** 검토 본문은 길지 않지만 모델이 추론 토큰을 먼저 쓴다. 한도가 모자라면 본문이 잘려 빈 응답이 온다 */
const MAX_TOKENS = 6000;

/** 화면이 함께 보내는 상황 정보 */
export const contextSchema = z.object({
  planId: z.uuid().nullable().default(null),
  round: z.number().int().min(1).max(3).default(1),
  grid: z.object({ cols: z.number().int().min(2).max(26), rows: z.number().int().min(2).max(40) }),
  /** 지금 쓴 매개변수 */
  params: z.object({ dark: z.number().int().min(0).max(255), wallPx: z.number().int().min(1).max(256), pxPerMeter: z.number().positive() }),
  openings: z
    .array(
      z.object({
        id: z.number().int().min(1),
        widthM: z.number().nonnegative(),
        cell: z.string().max(4),
        /** 후보 양쪽의 구역 번호 (0~2개). 같은 번호면 지금은 나뉘지 않은 것이다 */
        between: z.array(z.number().int().min(1)).max(2).default([]),
      }),
    )
    .max(120),
  rooms: z.array(z.object({ id: z.number().int().min(1), areaM2: z.number().nonnegative(), cell: z.string().max(4) })).max(60),
});
export type ReviewContext = z.infer<typeof contextSchema>;

/**
 * 응답 검증은 너그럽게 한다. 검토는 참고용 제안이므로, 총평이 400자를 넘었다는 이유로 호출 전체를
 * 버리면 안 된다. 글은 자르고 수는 범위 안으로 당기고, 목록 한 항목이 깨지면 그 목록만 비운다.
 * 형식이 아예 다를 때만 실패로 본다.
 */
const text = (max: number) => z.string().transform((v) => v.trim().slice(0, max));
const clamp = (lo: number, hi: number) => z.coerce.number().transform((v) => Math.min(hi, Math.max(lo, v)));
const pt = z.object({ x: clamp(0, 1), y: clamp(0, 1) });
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .transform((a) => a.slice(0, max))
    .catch([] as z.infer<T>[]);

export const reviewSchema = z.object({
  // 이 둘은 필수다. 없으면 모델이 그림을 보지 않은 것이므로 실패로 본다
  quality: clamp(0, 1),
  summary: text(400),
  falseWalls: list(z.object({ cell: text(8), what: text(80) }), 60),
  missingWalls: list(z.object({ from: pt, to: pt, why: text(80) }), 40),
  openings: list(z.object({ id: z.coerce.number().int(), kind: z.enum(['door', 'window', 'open', 'not_opening']) }), 120),
  rooms: list(z.object({ id: z.coerce.number().int(), name: text(40) }), 60),
  scale: z
    .object({ pxPerMeter: z.coerce.number().nullable(), basis: text(120) })
    // 0 이나 음수는 근거가 없다는 뜻으로 본다
    .transform((v) => ({ pxPerMeter: v.pxPerMeter !== null && v.pxPerMeter > 0 ? v.pxPerMeter : null, basis: v.basis }))
    .catch({ pxPerMeter: null, basis: '' }),
  params: z
    .object({ dark: z.coerce.number().nullable(), wallPx: z.coerce.number().nullable() })
    .transform((v) => ({
      dark: v.dark === null ? null : Math.round(Math.min(255, Math.max(0, v.dark))),
      wallPx: v.wallPx === null ? null : Math.round(Math.min(256, Math.max(1, v.wallPx))),
    }))
    .catch({ dark: null, wallPx: null }),
});
export type PlanReview = z.infer<typeof reviewSchema>;

/** OpenRouter strict 모드용 JSON 스키마. 모든 속성이 required 이고 additionalProperties 가 false 여야 한다 */
const point = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['quality', 'summary', 'falseWalls', 'missingWalls', 'openings', 'rooms', 'scale', 'params'],
  properties: {
    quality: { type: 'number', description: '벽 검출이 도면과 얼마나 맞는지 0~1' },
    summary: { type: 'string', description: '한국어 한두 문장 총평' },
    falseWalls: {
      type: 'array',
      description: '벽이 아닌데 벽(빨강)으로 잡힌 격자 칸',
      items: { type: 'object', additionalProperties: false, required: ['cell', 'what'], properties: { cell: { type: 'string' }, what: { type: 'string', description: '무엇이 잡혔는지 (가구, 계단, 글자 등)' } } },
    },
    missingWalls: {
      type: 'array',
      description: '도면에는 있는데 빨강으로 잡히지 않은 벽. 이미지 폭·높이를 1 로 본 좌표',
      items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'why'], properties: { from: point, to: point, why: { type: 'string' } } },
    },
    openings: {
      type: 'array',
      description: '파란 번호로 표시한 개구부 후보의 종류',
      items: { type: 'object', additionalProperties: false, required: ['id', 'kind'], properties: { id: { type: 'integer' }, kind: { type: 'string', enum: ['door', 'window', 'open', 'not_opening'] } } },
    },
    rooms: {
      type: 'array',
      description: '초록 번호로 표시한 구역의 이름. 도면 글자를 읽어 한국어로. 모르면 용도 추정',
      items: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    },
    scale: {
      type: 'object',
      additionalProperties: false,
      required: ['pxPerMeter', 'basis'],
      properties: {
        pxPerMeter: { type: ['number', 'null'], description: '보낸 이미지 기준 1m 당 픽셀. 근거가 없으면 null' },
        basis: { type: 'string', description: '무엇을 근거로 했는지 (치수 글자, 문 폭 0.9m 등)' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      required: ['dark', 'wallPx'],
      properties: {
        dark: { type: ['integer', 'null'], description: '다시 돌릴 때 권할 어두움 기준(0~255). 지금 값이 좋으면 null' },
        wallPx: { type: ['integer', 'null'], description: '다시 돌릴 때 권할 벽 두께(px). 지금 값이 좋으면 null' },
      },
    },
  },
} as const;

export function buildPrompt(ctx: ReviewContext, imageWidth: number, imageHeight: number): string {
  const cols = Array.from({ length: ctx.grid.cols }, (_, i) => String.fromCharCode(65 + i)).join('');
  const openings = ctx.openings.length
    ? ctx.openings.map((o) => `${o.id}: ${o.cell} 칸, 폭 ${o.widthM.toFixed(1)}m${o.between.length ? `, 구역 ${o.between.join('↔')} 사이` : ''}`).join('; ')
    : '없음';
  const rooms = ctx.rooms.length ? ctx.rooms.map((r) => `${r.id}: ${r.cell} 칸, ${r.areaM2.toFixed(1)}㎡`).join('; ') : '없음';
  return [
    '당신은 건축 평면도 검토자입니다. 첨부 그림은 2D 평면도 원본 위에 프로그램이 자동으로 찾은 벽을 빨간색 반투명으로 겹친 것입니다.',
    `그림 위에 ${ctx.grid.cols}×${ctx.grid.rows} 격자를 그렸고 칸 이름은 열 글자(${cols}) + 행 숫자(1~${ctx.grid.rows})입니다. 예: C4.`,
    '파란 선분과 숫자는 벽이 끊긴 자리(개구부 후보), 초록 원과 숫자는 프로그램이 나눈 구역입니다.',
    '후보는 벽 끝에서 가까운 벽까지 그은 것이라, 실제 문·창 외에 트인 곳이나 개구부가 아닌 자리도 섞여 있습니다.',
    `그림 크기 ${imageWidth}×${imageHeight}px. 지금 매개변수: 어두움 기준 ${ctx.params.dark}, 벽 두께 ${ctx.params.wallPx}px, 1m 당 ${ctx.params.pxPerMeter.toFixed(1)}px (검토 ${ctx.round}회째).`,
    `개구부 후보 목록 (양쪽 구역 번호를 함께 적었습니다. 같은 번호면 지금은 나뉘지 않은 것입니다): ${openings}`,
    `구역 목록: ${rooms}`,
    '',
    '다음을 JSON 으로 답하세요.',
    '1. quality: 빨간 벽이 실제 벽과 맞는 정도 0~1. 가구·계단·글자가 벽으로 잡혔거나 벽이 빠졌으면 낮춥니다.',
    '2. falseWalls: 벽이 아닌데 빨갛게 칠해진 칸. 책상·의자·계단·엘리베이터·글자·해치 무늬가 흔합니다. 칸 하나씩.',
    '3. missingWalls: 도면에 벽이 있는데 빨강이 없는 곳. 벽의 양 끝을 이미지 폭·높이를 1 로 본 좌표로. 창·문 자리는 벽이 아니므로 넣지 않습니다.',
    '4. openings: 파란 번호마다 door(문. 호나 여닫이 표시), window(창. 벽 사이 가는 선·이중선), open(벽 없이 트인 곳. 거실·주방처럼 한 공간이 이어짐), not_opening(개구부가 아님. 벽 끝과 먼 벽 사이의 허공, 가구·기호 사이 틈). 문·창이면 그 자리에서 방이 나뉘고, open·not_opening 이면 나뉘지 않습니다.',
    '5. rooms: 초록 번호마다 도면 글자를 읽어 이름을 붙입니다 (예: 주방, 회의실, 복도, 화장실, 계단실). 글자가 없으면 모양과 설비로 추정합니다.',
    '6. scale: 치수 글자가 있으면 그것으로, 없으면 일반 문 폭 0.9m 또는 화장실 변기·계단 폭 같은 표준 치수로 1m 당 픽셀을 추정합니다. 근거가 없으면 null.',
    '7. params: 벽이 많이 빠졌으면 어두움 기준을 올리거나 벽 두께를 낮추고, 가구가 많이 잡혔으면 벽 두께를 올리라고 권합니다. 지금이 좋으면 null.',
    '모르는 것은 비워 두고 지어내지 마세요. summary 는 한국어 한두 문장.',
  ].join('\n');
}

export interface ReviewInput {
  ctx: ReviewContext;
  image: { bytes: Uint8Array; type: string; width: number; height: number };
}

/** multipart 본문: meta(JSON 문자열), image(파일) */
export async function parseReviewUpload(req: Request): Promise<ReviewInput> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('multipart/form-data')) throw new HttpError(415, 'unsupported_media_type', 'multipart 본문이 필요합니다.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'invalid_request', '본문을 읽지 못했습니다.');
  }
  const metaRaw = form.get('meta');
  if (typeof metaRaw !== 'string') throw new HttpError(400, 'invalid_request', 'meta 가 필요합니다.');
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaRaw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'meta 가 JSON 이 아닙니다.');
  }
  const parsedMeta = z
    .object({ context: contextSchema, width: z.number().int().min(64).max(2048), height: z.number().int().min(64).max(2048) })
    .safeParse(metaJson);
  if (!parsedMeta.success) throw new HttpError(400, 'invalid_request', '검토 정보를 확인해 주세요.');
  const file = form.get('image');
  if (!(file instanceof File)) throw new HttpError(400, 'invalid_request', 'image 파일이 필요합니다.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new HttpError(415, 'unsupported_media_type', '이미지 형식이 아닙니다.');
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'payload_too_large', '이미지가 너무 큽니다.');
  return {
    ctx: parsedMeta.data.context,
    image: { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, width: parsedMeta.data.width, height: parsedMeta.data.height },
  };
}

export interface ReviewOutcome {
  readonly review: PlanReview;
  readonly model: string;
  readonly promptVersion: string;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  readonly latencyMs: number;
}

export async function reviewPlan(input: ReviewInput, fetchImpl?: typeof fetch): Promise<ReviewOutcome> {
  const model = env().OPENROUTER_VISION_MODEL;
  const dataUrl = `data:${input.image.type};base64,${Buffer.from(input.image.bytes).toString('base64')}`;
  const result = await callChatModel(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(input.ctx, input.image.width, input.image.height) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { model, schema: { name: 'PlanReview', schema: REVIEW_JSON_SCHEMA }, maxTokens: MAX_TOKENS, retries: 0, timeoutMs: 60_000, ...(fetchImpl ? { fetchImpl } : {}) },
  );
  let json: unknown;
  try {
    json = JSON.parse(result.content);
  } catch {
    throw new ModelError('invalid_output', false, '모델 응답이 JSON 이 아니다');
  }
  const parsed = reviewSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(본문)'}: ${i.message}`).join('; ');
    log('warn', 'plan review schema mismatch', { model, where });
    throw new ModelError('invalid_output', false, `모델 응답이 스키마와 다르다: ${where}`);
  }
  // 우리가 보낸 번호만 받아들인다
  const openingIds = new Set(input.ctx.openings.map((o) => o.id));
  const roomIds = new Set(input.ctx.rooms.map((r) => r.id));
  const review: PlanReview = {
    ...parsed.data,
    openings: parsed.data.openings.filter((o) => openingIds.has(o.id)),
    rooms: parsed.data.rooms.filter((r) => roomIds.has(r.id)),
  };
  return { review, model: result.model, promptVersion: REVIEW_PROMPT_VERSION, usage: result.usage, latencyMs: result.latencyMs };
}

export async function recordReview(
  db: SupabaseClient,
  ownerId: string,
  ctx: ReviewContext,
  outcome: ReviewOutcome | null,
  errorCode: string | null,
  model: string,
): Promise<void> {
  const { error } = await db.from('plan_reviews').insert({
    owner_id: ownerId,
    plan_id: ctx.planId,
    model: outcome?.model ?? model,
    round: ctx.round,
    quality: outcome?.review.quality ?? null,
    input_tokens: outcome?.usage.inputTokens ?? 0,
    output_tokens: outcome?.usage.outputTokens ?? 0,
    cost_usd: outcome?.usage.costUsd ?? null,
    latency_ms: outcome?.latencyMs ?? null,
    error_code: errorCode,
  });
  if (error) log('error', 'plan review record failed', { err: error.message });
}
