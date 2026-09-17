/**
 * 하이브리드 검색 (ISS-010 · 기획서 §6.1).
 *
 * 정확 일치 · 키워드 · 벡터 결과를 RRF 로 합치고, 상위 근거에 상위 제목·비고·예외 문맥을 붙인다.
 * 게시 상태·기준일·공개 범위 필터는 DB 함수가 강제한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcRead } from '../supabase';
import { embed, embeddingSpec, toPgVector, type EmbeddingSpec } from './embeddings';
import { analyzeQuery, type QueryAnalysis } from './query';

export interface SearchOptions {
  readonly asOf?: string;
  readonly visibility?: readonly ('public' | 'internal')[];
  readonly candidates?: number;
  readonly finalCount?: number;
  /** 평가용: 한 가지 방식만 쓴다 */
  readonly modes?: readonly ('exact' | 'keyword' | 'vector')[];
  readonly spec?: EmbeddingSpec;
  readonly embedFn?: typeof embed;
}

export interface EvidenceContext {
  readonly unitId: string;
  readonly locator: string;
  readonly heading: string | null;
  readonly text: string;
  readonly relation: 'ancestor' | 'note' | 'child';
}

export interface Evidence {
  readonly unitId: string;
  readonly versionId: string;
  readonly documentId: string;
  /** 법령ID·행정규칙ID·해석일련번호 */
  readonly sourceDocumentId: string;
  readonly documentTitle: string;
  readonly sourceType: string;
  readonly code: string | null;
  readonly locator: string;
  readonly heading: string | null;
  readonly text: string;
  readonly effectiveDate: string | null;
  readonly versionStatus: string;
  readonly parseStatus: 'ok' | 'needs_review';
  readonly sourceUrl: string | null;
  readonly transferAllowed: boolean;
  readonly score: number;
  readonly signals: { exact?: number; keyword?: number; vector?: number; scopedKeyword?: number; scopedVector?: number };
  /** 질문 키워드 중 이 근거에 들어 있는 수 */
  readonly matchedTerms: number;
  readonly context: EvidenceContext[];
}

export type SearchStatus = 'ok' | 'insufficient_evidence' | 'date_unclear';

export interface SearchResult {
  readonly status: SearchStatus;
  readonly asOf: string;
  readonly analysis: QueryAnalysis;
  readonly evidence: Evidence[];
  /** 근거 문서에 시행예정 버전이 있다 */
  readonly pendingChanges: { documentTitle: string; effectiveDate: string }[];
  readonly embeddingTokens: number;
}

const RRF_K = 60;
/** 설치 대상(어떤 건물에 설치해야 하는가)은 시행령 별표에서 정한다 */
const APPLICABILITY_TITLES = ['소방시설 설치 및 관리에 관한 법률 시행령', '다중이용업소의 안전관리에 관한 특별법 시행령'];
/** 벡터 유사도가 이 값보다 낮고 다른 신호가 없으면 근거로 보지 않는다 */
const MIN_VECTOR_SCORE = 0.35;

export const todayInSeoul = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

type Ranked = { unitId: string; score: number };

/** 질문이 조항을 직접 지정했다면 그 조항이 가장 앞에 와야 한다 */
const LIST_WEIGHT: Record<string, number> = { exact: 5 };

function rrf(lists: Record<string, Ranked[]>) {
  const fused = new Map<string, { score: number; signals: Evidence['signals'] }>();
  for (const [name, list] of Object.entries(lists)) {
    const seen = new Set<string>();
    let rank = 0;
    for (const item of list) {
      if (seen.has(item.unitId)) continue; // 한 단위의 여러 조각은 가장 높은 것만
      seen.add(item.unitId);
      rank += 1;
      const entry = fused.get(item.unitId) ?? { score: 0, signals: {} };
      entry.score += (LIST_WEIGHT[name] ?? 1) / (RRF_K + rank);
      (entry.signals as Record<string, number>)[name] = item.score;
      fused.set(item.unitId, entry);
    }
  }
  return [...fused.entries()].sort((a, b) => b[1].score - a[1].score);
}

interface BundleRow {
  unit_id: string;
  version_id: string;
  document_id: string;
  source_document_id: string;
  title: string;
  code: string | null;
  source_type: string;
  locator: string;
  heading: string | null;
  text: string;
  parse_status: 'ok' | 'needs_review';
  effective_date: string | null;
  version_status: string;
  source_url: string | null;
  transfer_allowed: boolean;
  context: EvidenceContext[];
}

/** 근거 단위와 상위·비고·하위 문맥을 한 번에 가져온다 */
export async function loadEvidence(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, BundleRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await rpcRead(db, 'evidence_bundle', { p_unit_ids: ids });
  if (error) throw new Error(`근거 조회 실패: ${error.message}`);
  return new Map((data as BundleRow[]).map((r) => [r.unit_id, r]));
}

export async function search(db: SupabaseClient, question: string, opts: SearchOptions = {}): Promise<SearchResult> {
  if (!question.trim()) throw new Error('빈 질문은 검색하지 않는다');
  const analysis = analyzeQuery(question);
  const asOf = opts.asOf ?? analysis.explicitDate ?? todayInSeoul();
  const visibility = opts.visibility ?? ['public'];
  const candidates = opts.candidates ?? 30;
  const finalCount = opts.finalCount ?? 8;
  const modes = new Set(opts.modes ?? ['exact', 'keyword', 'vector']);

  const lists: Record<string, Ranked[]> = {};
  const coverage = new Map<string, number>();
  let embeddingTokens = 0;

  // 코드·법령명을 말하면 그 문서 안에서, 설치 대상을 물으면 시행령 안에서 한 번 더 찾는다
  const named = analysis.codes.length > 0 || analysis.titleTerms.length > 0;
  const scope = named
    ? { p_scope_codes: analysis.codes, p_scope_titles: analysis.titleTerms }
    : analysis.asksApplicability
      ? { p_scope_codes: [], p_scope_titles: APPLICABILITY_TITLES }
      : null;

  const keyword = async (name: string, extra: object | null) => {
    const { data, error } = await rpcRead(db, 'search_keyword', {
      p_terms: analysis.terms,
      p_as_of: asOf,
      p_visibility: visibility,
      p_limit: candidates,
      ...(extra ?? {}),
    });
    if (error) throw new Error(`키워드 검색 실패: ${error.message}`);
    const rows = data as { unit_id: string; score: number; matched: number }[];
    for (const r of rows) coverage.set(r.unit_id, Math.max(coverage.get(r.unit_id) ?? 0, r.matched));
    lists[name] = rows.map((r) => ({ unitId: r.unit_id, score: r.score }));
  };

  const tasks: Promise<void>[] = [];
  if (modes.has('exact') && named && analysis.locators.length) {
    tasks.push(
      (async () => {
        const { data, error } = await rpcRead(db, 'search_exact', {
          p_codes: analysis.codes,
          p_title_terms: analysis.titleTerms,
          p_locators: analysis.locators,
          p_as_of: asOf,
          p_visibility: visibility,
          p_limit: candidates,
        });
        if (error) throw new Error(`정확 일치 검색 실패: ${error.message}`);
        lists.exact = (data as { unit_id: string; score: number }[]).map((r) => ({ unitId: r.unit_id, score: r.score }));
      })(),
    );
  }
  if (modes.has('keyword') && analysis.terms.length) {
    tasks.push(keyword('keyword', null));
    if (scope) tasks.push(keyword('scopedKeyword', scope));
  }
  if (modes.has('vector')) {
    tasks.push(
      (async () => {
        const spec = opts.spec ?? embeddingSpec();
        const { vectors, tokens } = await (opts.embedFn ?? embed)([question], spec);
        embeddingTokens = tokens;
        const vector = async (name: string, extra: object | null) => {
          const { data, error } = await rpcRead(db, 'search_vector', {
            p_embedding: toPgVector(vectors[0]!),
            p_model: spec.model,
            p_revision: spec.revision,
            p_as_of: asOf,
            p_visibility: visibility,
            p_limit: candidates,
            ...(extra ?? {}),
          });
          if (error) throw new Error(`벡터 검색 실패: ${error.message}`);
          lists[name] = (data as { unit_id: string; score: number }[])
            .filter((r) => r.score >= MIN_VECTOR_SCORE)
            .map((r) => ({ unitId: r.unit_id, score: r.score }));
        };
        await Promise.all([vector('vector', null), scope ? vector('scopedVector', scope) : Promise.resolve()]);
      })(),
    );
  }
  await Promise.all(tasks);

  const fused = rrf(lists).slice(0, finalCount);
  const ids = fused.map(([id]) => id);

  const evidence: Evidence[] = [];
  const pending = new Map<string, { documentTitle: string; effectiveDate: string }>();
  const rows = await loadEvidence(db, ids);
  for (const [id, f] of fused) {
    const r = rows.get(id);
    if (!r) continue;
    evidence.push({
      unitId: r.unit_id,
      versionId: r.version_id,
      documentId: r.document_id,
      sourceDocumentId: r.source_document_id,
      documentTitle: r.title,
      sourceType: r.source_type,
      code: r.code,
      locator: r.locator,
      heading: r.heading,
      text: r.text,
      effectiveDate: r.effective_date,
      versionStatus: r.version_status,
      parseStatus: r.parse_status,
      sourceUrl: r.source_url,
      transferAllowed: r.transfer_allowed,
      score: f.score,
      signals: f.signals,
      matchedTerms: coverage.get(id) ?? 0,
      context: r.context,
    });
  }

  if (evidence.length) {
    const docIds = [...new Set(evidence.map((e) => e.documentId))];
    const { data: scheduled } = await db
      .from('legal_versions')
      .select('effective_date, legal_documents!inner(title)')
      .in('document_id', docIds)
      .gt('effective_date', asOf)
      .eq('review_status', 'published');
    for (const s of scheduled ?? []) {
      const title = (s.legal_documents as unknown as { title: string }).title;
      pending.set(`${title}:${s.effective_date}`, { documentTitle: title, effectiveDate: s.effective_date as string });
    }
  }

  // 키워드 절반 이상(최소 2개)이 한 근거에 모이거나, 의미가 충분히 가까워야 근거로 본다
  const needTerms = Math.max(2, Math.ceil(analysis.baseTermCount / 2));
  const hasStrongSignal = evidence.some(
    (e) =>
      e.signals.exact !== undefined ||
      (e.matchedTerms >= needTerms && (e.signals.vector ?? e.signals.scopedVector ?? 0) >= MIN_VECTOR_SCORE) ||
      e.matchedTerms >= Math.max(3, needTerms) ||
      Math.max(e.signals.vector ?? 0, e.signals.scopedVector ?? 0) >= 0.5,
  );
  const status: SearchStatus =
    evidence.length === 0 || !hasStrongSignal ? 'insufficient_evidence' : analysis.eventWithoutDate ? 'date_unclear' : 'ok';

  return { status, asOf, analysis, evidence, pendingChanges: [...pending.values()], embeddingTokens };
}
