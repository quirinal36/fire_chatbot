/**
 * 검색 인덱스 구축 (ISS-009).
 *
 * 1. 수집된 버전의 단위로 조각을 만든다. 같은 (unit, hash) 는 다시 넣지 않는다.
 * 2. 임베딩이 없거나 모델·revision 이 다른 조각만 임베딩한다.
 * 비용 상한을 넘기 전에 멈춘다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildChunks, type UnitRow } from './chunks';
import { EMBEDDING_USD_PER_MTOK, embed, embeddingSpec, toPgVector, type EmbeddingSpec } from './embeddings';

const PAGE = 1000;

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export interface ChunkReport {
  readonly versions: number;
  readonly drafted: number;
  readonly inserted: number;
}

export async function syncChunks(db: SupabaseClient, log: (s: string) => void = () => {}): Promise<ChunkReport> {
  const { data: versions, error } = await db
    .from('legal_versions')
    .select('id, document_id, review_status, legal_documents!inner(title, source_type)')
    .neq('review_status', 'rejected');
  if (error) throw new Error(error.message);

  let drafted = 0;
  let inserted = 0;
  for (const v of versions ?? []) {
    const doc = v.legal_documents as unknown as { title: string; source_type: string };
    const units = await pageAll<{ id: string; parent_unit_id: string | null; unit_type: string; locator: string; heading: string | null; text: string }>(
      (from, to) =>
        db
          .from('legal_units')
          .select('id, parent_unit_id, unit_type, locator, heading, text')
          .eq('version_id', v.id)
          .order('ordinal')
          .order('id')
          .range(from, to),
    );
    const rows: UnitRow[] = units.map((u) => ({
      id: u.id,
      parentId: u.parent_unit_id,
      unitType: u.unit_type,
      locator: u.locator,
      heading: u.heading,
      text: u.text,
    }));
    // 내부 자료의 공개·전송 범위는 ISS-024 에서 source_files 기준으로 채운다
    const internal = doc.source_type === 'internal';
    const chunks = buildChunks(doc.title, rows).map((c) => ({
      unit_id: c.unitId,
      context_text: c.contextText,
      chunk_hash: c.chunkHash,
      visibility: internal ? 'internal' : 'public',
      transfer_allowed: !internal,
    }));
    drafted += chunks.length;
    for (let i = 0; i < chunks.length; i += 500) {
      const { data, error: rpcError } = await db.rpc('upsert_chunks', { p: chunks.slice(i, i + 500) });
      if (rpcError) throw new Error(`조각 저장 실패: ${rpcError.message}`);
      inserted += data as number;
    }
    // 내부 자료는 승인 상태(공개·전송)를 조각에 다시 반영한다
    if (internal) {
      const { error: policyError } = await db.rpc('apply_source_policy', { p_document_id: v.document_id });
      if (policyError) throw new Error(`자료 정책 반영 실패: ${policyError.message}`);
    }
    log(`chunks ${doc.title}: ${chunks.length}`);
  }
  return { versions: versions?.length ?? 0, drafted, inserted };
}

export interface EmbedReport {
  readonly reused: number;
  readonly embedded: number;
  readonly tokens: number;
  readonly usd: number;
  readonly stoppedByBudget: boolean;
}

export async function embedPending(
  db: SupabaseClient,
  opts: { maxUsd: number; batchSize?: number; spec?: EmbeddingSpec; embedFn?: typeof embed; log?: (s: string) => void },
): Promise<EmbedReport> {
  const spec = opts.spec ?? embeddingSpec();
  const price = EMBEDDING_USD_PER_MTOK[spec.model];
  if (price === undefined) throw new Error(`${spec.model} 의 단가가 등록되지 않아 비용 상한을 집행할 수 없다`);
  // API 역할의 문장 제한(8초) 안에서 HNSW 갱신이 끝나도록 작게 나눈다
  const batchSize = opts.batchSize ?? 48;
  const embedFn = opts.embedFn ?? embed;

  let embedded = 0;
  let tokens = 0;
  // 같은 본문의 벡터가 캐시에 있으면 호출 없이 채운다
  let reused = 0;
  for (;;) {
    const { data, error: cacheError } = await db.rpc('fill_embeddings_from_cache', {
      p_model: spec.model,
      p_revision: spec.revision,
      p_limit: 200,
    });
    if (cacheError) throw new Error(`임베딩 캐시 적용 실패: ${cacheError.message}`);
    if ((data as number) === 0) break;
    reused += data as number;
  }
  opts.log?.(`cache ${reused}`);
  for (;;) {
    // 임베딩이 없거나, 다른 모델·revision 으로 만든 조각
    const { data, error } = await db
      .from('search_chunks')
      .select('id, context_text')
      .or(`embedding_model.is.null,embedding_model.neq.${spec.model},embedding_revision.neq.${spec.revision}`)
      .order('id')
      .limit(batchSize);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    // 한국어는 대략 글자당 1토큰 이하. 보수적으로 글자 수로 상한을 미리 검사한다
    const estimate = data.reduce((n, c) => n + c.context_text.length, 0);
    if (((tokens + estimate) / 1e6) * price > opts.maxUsd) {
      return { reused, embedded, tokens, usd: (tokens / 1e6) * price, stoppedByBudget: true };
    }

    const result = await embedFn(
      data.map((c) => c.context_text),
      spec,
    );
    tokens += result.tokens;
    const payload = data.map((c, i) => ({ id: c.id, embedding: toPgVector(result.vectors[i]!) }));
    const { error: setError } = await db.rpc('set_chunk_embeddings', { p_model: spec.model, p_revision: spec.revision, p: payload });
    if (setError) throw new Error(`임베딩 저장 실패: ${setError.message}`);
    embedded += data.length;
    opts.log?.(`embedded ${embedded} (${tokens} tokens)`);
  }
  return { reused, embedded, tokens, usd: (tokens / 1e6) * price, stoppedByBudget: false };
}
