/**
 * 치수선으로 축척을 확정한다.
 *
 * 벽 두께를 0.2m 로 가정하는 방식은 도면마다 30~50% 틀린다. 면적은 그 제곱으로 틀리므로
 * 소방 계산(보행거리·감지기 수)에 그대로 쓸 수 없다. 대부분의 도면에는 치수선과 숫자가 적혀 있으니
 * 그것을 읽으면 축척이 곧바로 나온다.
 *
 * 역할은 검토(plan-review)와 같게 나눈다. 모델은 "숫자를 읽고 그 숫자가 가리키는 구간의 양 끝"만
 * 말하고, 축척 계산과 검증은 여기서 한다. 모델 좌표는 몇 픽셀씩 어긋나지만, 한 도면에 치수가 여럿이라
 * 구간마다 1m 당 픽셀을 따로 구해 중앙값을 쓰면 잘못 읽은 하나가 결과를 흔들지 못한다.
 */
import { z } from 'zod';
import { callChatModel, ModelError } from './chat/openrouter';
import { env } from './env';
import { HttpError } from './http-error';
import { log } from './log';

export const SCALE_PROMPT_VERSION = 'plan-scale-v1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * 답 자체는 짧지만 모델이 치수를 세느라 추론 토큰을 많이 쓴다. 한도가 모자라면 응답이 잘려
 * 빈 본문이 오고, 원인이 보이지 않는다. 실제로 2000 으로는 추론에만 1357 을 쓰고 잘렸다.
 */
const MAX_TOKENS = 6000;

/** 이보다 짧은 치수는 오차가 커서 버린다 (mm) */
const MIN_MM = 200;
/** 이보다 짧게 그려진 구간은 버린다 (px) */
const MIN_LEN_PX = 24;
/** 중앙값에서 이 비율 넘게 벗어난 구간은 잘못 읽은 것으로 본다 */
const OUTLIER = 0.12;
/** 이만큼 서로 맞아야 축척을 확정한다 */
const MIN_AGREE = 3;
/** 구간이 둘뿐이면 중앙값에서 이 안에 들 때만 받아들인다 (둘이 4% 안으로 맞는다는 뜻) */
const TIGHT = 0.02;

const clamp = (lo: number, hi: number) => z.coerce.number().transform((v) => Math.min(hi, Math.max(lo, v)));
const pt = z.object({ x: clamp(0, 1), y: clamp(0, 1) });

export const dimensionSchema = z.object({
  /** 도면에 적힌 숫자를 mm 로 고친 값 */
  mm: z.coerce.number(),
  /** 그 숫자가 재고 있는 구간의 양 끝. 이미지 폭·높이를 1 로 본 좌표 */
  from: pt,
  to: pt,
  /** 도면에 적힌 글자 그대로 */
  label: z.string().transform((v) => v.trim().slice(0, 24)),
});
export type Dimension = z.infer<typeof dimensionSchema>;

export const scaleReadSchema = z.object({
  /** 치수 단위. 도면 대부분은 mm 다 */
  unit: z.enum(['mm', 'cm', 'm']).catch('mm'),
  dimensions: z
    .array(dimensionSchema)
    .transform((a) => a.slice(0, 40))
    .catch([] as Dimension[]),
  note: z.string().transform((v) => v.trim().slice(0, 200)),
});
export type ScaleRead = z.infer<typeof scaleReadSchema>;

const point = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
export const SCALE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unit', 'dimensions', 'note'],
  properties: {
    unit: { type: 'string', enum: ['mm', 'cm', 'm'], description: '치수 숫자의 단위' },
    dimensions: {
      type: 'array',
      description: '도면 가장자리 치수선에 적힌 숫자들',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mm', 'from', 'to', 'label'],
        properties: {
          mm: { type: 'number', description: '숫자를 mm 로 고친 값' },
          from: point,
          to: point,
          label: { type: 'string', description: '도면에 적힌 글자 그대로' },
        },
      },
    },
    note: { type: 'string', description: '한국어 한 문장. 치수를 못 찾았으면 그렇게' },
  },
} as const;

export function buildScalePrompt(width: number, height: number): string {
  return [
    '당신은 건축 평면도를 읽는 사람입니다. 첨부 그림은 2D 평면도 원본입니다.',
    `그림 크기 ${width}×${height}px. 좌표는 왼쪽 위가 (0,0), 오른쪽 아래가 (1,1) 입니다.`,
    '',
    '도면 가장자리의 치수선에 적힌 숫자를 모두 찾아 읽으세요. 치수선은 도면 바깥에 가로 또는 세로로 늘어선',
    '가는 선이고, 양 끝에 짧은 사선이나 화살표가 있으며, 그 위에 숫자가 적혀 있습니다. 예: 3,670 / 1250 / 4.310.',
    '',
    '숫자 하나마다 다음을 답하세요.',
    '1. mm: 숫자를 mm 로 고친 값. 쉼표와 마침표는 자릿점일 수 있으니 도면의 다른 숫자들과 자릿수를 맞춰 판단하세요.',
    '2. from, to: 그 숫자가 재고 있는 구간의 양 끝. 숫자 자체의 위치가 아니라, 치수선에서 그 구간을 끊는',
    '   두 표시(사선·화살표·치수보조선)의 위치입니다. 가로 치수면 y 는 같고 x 만 다릅니다.',
    '3. label: 도면에 적힌 글자 그대로.',
    '',
    '치수선이 아닌 숫자(실번호, 면적 표기, 축척 표기, 주석)는 넣지 마세요.',
    '구간을 정확히 집을 수 없는 숫자는 아예 빼는 편이 낫습니다. 지어내지 마세요.',
    '치수를 하나도 못 찾았으면 dimensions 를 빈 배열로 두고 note 에 이유를 적으세요.',
  ].join('\n');
}

export interface ScaleEstimate {
  /** 보낸 그림 기준 1m 당 픽셀 */
  readonly pxPerMeter: number;
  /** 축척 계산에 쓴 구간 수 */
  readonly used: number;
  /** 모델이 읽어 온 구간 수 */
  readonly total: number;
  /** 쓴 구간들이 서로 벌어진 정도 (0 이면 완전히 일치) */
  readonly spread: number;
  /** 쓴 구간의 글자들 */
  readonly labels: readonly string[];
}

const TO_MM = { mm: 1, cm: 10, m: 1000 } as const;
/** 같은 치수선 위인지, 앞 구간 끝에 이어지는지 볼 때 쓰는 허용 오차 (정규화 좌표) */
const CHAIN_TOL = 0.012;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

interface Seg {
  /** 치수선을 따르는 방향의 시작·끝 (px) */
  readonly a: number;
  readonly b: number;
  /** 치수선과 직각 방향의 위치 (px). 같은 치수선 위면 이 값이 같다 */
  readonly perp: number;
  readonly horizontal: boolean;
  readonly mm: number;
  readonly pxPerMeter: number;
  readonly label: string;
}

/**
 * 한 치수선 위에서 앞 구간 끝에 이어지는 구간들을 사슬로 묶어, 사슬마다 길이와 실제 치수를 돌려준다.
 *
 * 모델이 집어 주는 구간 끝은 몇 픽셀씩 어긋난다. 사슬로 묶으면 중간 끝점의 오차는 서로 지워지고
 * 바깥 두 끝의 오차만 남는데, 그것도 사슬 전체 길이에 나뉘어 들어간다. 구간 하나로 재는 것보다 정확하다.
 * 이어지지 않는 구간은 혼자 사슬이 된다.
 */
function chains(segs: readonly Seg[], tolPx: number): { spanPx: number; mm: number }[] {
  const out: { spanPx: number; mm: number }[] = [];
  const lines: Seg[][] = [];
  for (const s of segs) {
    const line = lines.find((l) => (l[0] as Seg).horizontal === s.horizontal && Math.abs((l[0] as Seg).perp - s.perp) <= tolPx);
    if (line) line.push(s);
    else lines.push([s]);
  }
  for (const line of lines) {
    line.sort((x, y) => x.a - y.a);
    let cur: Seg[] = [];
    const flush = (): void => {
      if (!cur.length) return;
      const first = cur[0] as Seg;
      const last = cur[cur.length - 1] as Seg;
      out.push({ spanPx: last.b - first.a, mm: cur.reduce((t, s) => t + s.mm, 0) });
      cur = [];
    };
    for (const s of line) {
      const prev = cur[cur.length - 1];
      if (prev && Math.abs(s.a - prev.b) > tolPx) flush();
      cur.push(s);
    }
    flush();
  }
  return out;
}

/**
 * 읽어 온 치수들에서 1m 당 픽셀을 구한다.
 *
 * 두 단계다. 먼저 구간마다 따로 재서 중앙값에서 크게 벗어난 것을 버린다 — 숫자를 잘못 읽은 구간을
 * 걸러내는 단계다. 그다음 남은 구간을 치수 사슬로 묶어 사슬 전체 길이로 다시 잰다 — 끝점 좌표의
 * 오차를 줄이는 단계다. 긴 사슬일수록 결과에 더 반영된다.
 *
 * 하나도 못 믿겠으면 null 이다. 틀린 축척은 축척이 없는 것보다 나쁘다.
 */
export function estimateScale(read: ScaleRead, width: number, height: number): ScaleEstimate | null {
  const unit = TO_MM[read.unit];
  const cand: Seg[] = read.dimensions
    .map((d) => {
      const mm = d.mm * unit;
      const dx = (d.to.x - d.from.x) * width;
      const dy = (d.to.y - d.from.y) * height;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const [a, b] = horizontal ? [d.from.x * width, d.to.x * width] : [d.from.y * height, d.to.y * height];
      return {
        a: Math.min(a, b),
        b: Math.max(a, b),
        perp: horizontal ? ((d.from.y + d.to.y) / 2) * height : ((d.from.x + d.to.x) / 2) * width,
        horizontal,
        mm,
        pxPerMeter: Math.hypot(dx, dy) / (mm / 1000),
        label: d.label,
      };
    })
    .filter((c) => c.mm >= MIN_MM && c.b - c.a >= MIN_LEN_PX && Number.isFinite(c.pxPerMeter) && c.pxPerMeter > 0);
  if (cand.length < 2) return null;

  const m0 = median(cand.map((c) => c.pxPerMeter));
  const kept = cand.filter((c) => Math.abs(c.pxPerMeter - m0) / m0 <= OUTLIER);
  if (kept.length < 2) return null;
  const rough = median(kept.map((c) => c.pxPerMeter));
  const spread = Math.max(...kept.map((c) => Math.abs(c.pxPerMeter - rough) / rough));
  // 구간이 둘뿐이면 서로 맞는지가 유일한 검증이라 더 엄하게 본다
  if (kept.length < MIN_AGREE && spread > TIGHT) return null;

  const grouped = chains(kept, CHAIN_TOL * Math.max(width, height));
  const spanPx = grouped.reduce((t, c) => t + c.spanPx, 0);
  const meters = grouped.reduce((t, c) => t + c.mm, 0) / 1000;
  const pxPerMeter = meters > 0 ? spanPx / meters : rough;

  return { pxPerMeter, used: kept.length, total: read.dimensions.length, spread, labels: kept.map((c) => c.label) };
}

export interface ScaleInput {
  image: { bytes: Uint8Array; type: string; width: number; height: number };
}

/** multipart 본문: meta(JSON: { width, height }), image(원본 도면) */
export async function parseScaleUpload(req: Request): Promise<ScaleInput> {
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
  const meta = z.object({ width: z.number().int().min(64).max(4096), height: z.number().int().min(64).max(4096) }).safeParse(metaJson);
  if (!meta.success) throw new HttpError(400, 'invalid_request', '이미지 크기를 확인해 주세요.');
  const file = form.get('image');
  if (!(file instanceof File)) throw new HttpError(400, 'invalid_request', 'image 파일이 필요합니다.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new HttpError(415, 'unsupported_media_type', '이미지 형식이 아닙니다.');
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'payload_too_large', '이미지가 너무 큽니다.');
  return { image: { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, width: meta.data.width, height: meta.data.height } };
}

export interface ScaleOutcome {
  readonly estimate: ScaleEstimate | null;
  readonly read: ScaleRead;
  readonly model: string;
  readonly promptVersion: string;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  readonly latencyMs: number;
}

export async function readScale(input: ScaleInput, fetchImpl?: typeof fetch): Promise<ScaleOutcome> {
  const model = env().OPENROUTER_VISION_MODEL;
  const dataUrl = `data:${input.image.type};base64,${Buffer.from(input.image.bytes).toString('base64')}`;
  const result = await callChatModel(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildScalePrompt(input.image.width, input.image.height) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    { model, schema: { name: 'PlanScale', schema: SCALE_JSON_SCHEMA }, maxTokens: MAX_TOKENS, timeoutMs: 60_000, ...(fetchImpl ? { fetchImpl } : {}) },
  );
  let json: unknown;
  try {
    json = JSON.parse(result.content);
  } catch {
    throw new ModelError('invalid_output', false, '모델 응답이 JSON 이 아니다');
  }
  const parsed = scaleReadSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(본문)'}: ${i.message}`).join('; ');
    log('warn', 'plan scale schema mismatch', { model, where });
    throw new ModelError('invalid_output', false, `모델 응답이 스키마와 다르다: ${where}`);
  }
  const estimate = estimateScale(parsed.data, input.image.width, input.image.height);
  return { estimate, read: parsed.data, model: result.model, promptVersion: SCALE_PROMPT_VERSION, usage: result.usage, latencyMs: result.latencyMs };
}
