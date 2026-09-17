/**
 * OpenRouter 호출 (ISS-014 · ISS-026 · 기획서 §6.3~6.4).
 *
 * - 구조화 출력(json_schema, strict)과 provider.require_parameters=true 를 쓴다
 * - 429·5xx·네트워크 오류만 제한된 지수 백오프로 재시도한다
 * - 인증 실패·잔액 부족은 재시도하지 않고 운영 오류로 올린다
 */
import { requireKey } from '../env';
import { CHAT_ANSWER_JSON_SCHEMA } from './schema';

export type ModelErrorKind = 'auth' | 'credit' | 'rate_limit' | 'server' | 'network' | 'bad_request' | 'invalid_output';

export class ModelError extends Error {
  override name = 'ModelError';
  constructor(
    readonly kind: ModelErrorKind,
    readonly retryable: boolean,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

export interface ModelResult {
  readonly model: string;
  readonly content: string;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
}

export interface CallOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly retries?: number;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function classifyStatus(status: number): { kind: ModelErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 402) return { kind: 'credit', retryable: false };
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'bad_request', retryable: false };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function callChatModel(
  messages: readonly { role: string; content: string }[],
  opts: CallOptions,
): Promise<ModelResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  const body = {
    model: opts.model,
    messages,
    temperature: 0,
    max_tokens: opts.maxTokens ?? 1500,
    response_format: { type: 'json_schema', json_schema: { name: 'ChatAnswer', strict: true, schema: CHAT_ANSWER_JSON_SCHEMA } },
    provider: { require_parameters: true },
    usage: { include: true },
  };

  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireKey('OPENROUTER_API_KEY')}`,
          'Content-Type': 'application/json',
          'X-Title': 'fire-chatbot',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      if (attempt >= retries) throw new ModelError('network', true, `모델 호출 네트워크 오류: ${err instanceof Error ? err.name : 'unknown'}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      const { kind, retryable } = classifyStatus(res.status);
      if (!retryable || attempt >= retries) {
        throw new ModelError(kind, retryable, `모델 호출 실패: HTTP ${res.status}`, res.status);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt);
      continue;
    }

    const json = (await res.json()) as {
      model?: string;
      error?: { code?: number; message?: string };
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    // OpenRouter 는 200 안에 오류를 담아 보내기도 한다
    if (json.error) {
      const { kind, retryable } = classifyStatus(json.error.code ?? 500);
      if (!retryable || attempt >= retries) throw new ModelError(kind, retryable, `모델 오류: ${json.error.code ?? ''}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new ModelError('invalid_output', false, '모델 응답에 본문이 없다');
    }
    return {
      model: json.model ?? opts.model,
      content,
      latencyMs: Date.now() - t0,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : null,
      },
    };
  }
}
