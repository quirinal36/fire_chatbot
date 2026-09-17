/**
 * OpenAI 임베딩 (기획서 §6.1). OpenRouter 는 임베딩을 제공하지 않으므로 OpenAI 를 직접 호출한다.
 * 질의와 문서는 반드시 같은 모델·차원·revision 을 쓴다.
 */
import { env, requireKey } from '../env';

export interface EmbeddingSpec {
  readonly model: string;
  readonly dimensions: number;
  /** OpenAI 는 모델 버전을 따로 주지 않는다. 설정값으로 관리하고, 바꾸면 전체 재임베딩한다 */
  readonly revision: string;
}

export function embeddingSpec(): EmbeddingSpec {
  const e = env();
  return {
    model: e.EMBEDDING_MODEL,
    dimensions: e.EMBEDDING_DIMENSIONS,
    revision: e.EMBEDDING_REVISION,
  };
}

/** 1K 토큰당이 아니라 1M 토큰당 단가. 2026-09-17 확인 */
export const EMBEDDING_USD_PER_MTOK: Record<string, number> = {
  'text-embedding-3-small': 0.02,
};

export interface EmbeddingResult {
  readonly vectors: number[][];
  readonly tokens: number;
}

export class EmbeddingError extends Error {
  override name = 'EmbeddingError';
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embed(
  inputs: readonly string[],
  spec: EmbeddingSpec = embeddingSpec(),
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddingResult> {
  if (inputs.length === 0) return { vectors: [], tokens: 0 };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requireKey('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: spec.model, input: inputs, dimensions: spec.dimensions, encoding_format: 'float' }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt >= 3) throw new EmbeddingError(`OpenAI 임베딩 네트워크 오류: ${err instanceof Error ? err.name : 'unknown'}`, true);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage: { total_tokens: number } };
      const vectors = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== inputs.length || vectors.some((v) => v.length !== spec.dimensions)) {
        throw new EmbeddingError('임베딩 응답의 개수 또는 차원이 요청과 다르다', false);
      }
      return { vectors, tokens: json.usage.total_tokens };
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 3) throw new EmbeddingError(`OpenAI 임베딩 실패: HTTP ${res.status}`, retryable);
    await sleep(1000 * 2 ** attempt);
  }
}

export const toPgVector = (v: readonly number[]) => `[${v.join(',')}]`;
