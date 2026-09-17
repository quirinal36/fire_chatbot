/**
 * 하이브리드 검색 (ISS-010 · 기획서 §6.1).
 *
 * 정확 일치 · 키워드 · 벡터 결과를 RRF 로 합치고, 상위 근거에 상위 제목·비고·예외 문맥을 붙인다.
 * 게시 상태·기준일·공개 범위 필터는 DB 함수가 강제한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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
  readonly signals: { exact?: number; keyword?: number; vector?: number };
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
/** 벡터 유사도가 이 값보다 낮고 다른 신호가 없으면 근거로 보지 않는다 */
const MIN_VECTOR_SCORE = 0.35;

export const todayInSeoul = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

type Ranked = { unitId: string; score: number };

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
      entry.score += 1 / (RRF_K + rank);
      (entry.signals as Record<string, number>)[name] = item.score;
      fused.set(item.unitId, entry);
    }
  }
  return [...fused.entries()].sort((a, b) => b[1].score - a[1].score);
}

interface UnitRecord {
  id: string;
  parent_unit_id: string | null;
  unit_type: string;
  locator: string;
  heading: string | null;
  text: string;
  parse_status: 'ok' | 'needs_review';
  version_id: string;
}

const UNIT_COLUMNS = 'id, parent_unit_id, unit_type, locator, heading, text, parse_status, version_id';

async function loadContext(db: SupabaseClient, unit: UnitRecord): Promise<EvidenceContext[]> {
  const context: EvidenceContext[] = [];
  // 상위 단위 (최대 4단계)
  let parentId = unit.parent_unit_id;
  for (let depth = 0; parentId && depth < 4; depth++) {
    const { data } = await db.from('legal_units').select(UNIT_COLUMNS).eq('id', parentId).maybeSingle<UnitRecord>();
    if (!data) break;
    context.unshift({
      unitId: data.id,
      locator: data.locator,
      heading: data.heading,
      // 별표 전체 본문은 너무 길다. 제목만 둔다
      text: data.unit_type === 'appendix' ? '' : data.text.slice(0, 600),
      relation: 'ancestor',
    });
    parentId = data.parent_unit_id;
  }
  // 같은 부모 아래의 비고·단서
  if (unit.parent_unit_id) {
    const { data } = await db
      .from('legal_units')
      .select(UNIT_COLUMNS)
      .eq('parent_unit_id', unit.parent_unit_id)
      .neq('id', unit.id)
      .or('text.like.비고*,text.like.※*,text.like.*다만*')
      .limit(3)
      .returns<UnitRecord[]>();
    for (const n of data ?? []) {
      context.push({ unitId: n.id, locator: n.locator, heading: n.heading, text: n.text.slice(0, 800), relation: 'note' });
    }
  }
  // 제목뿐인 단위면 하위 내용을 붙인다
  if (unit.text.trim().length < 40) {
    const { data } = await db
      .from('legal_units')
      .select(UNIT_COLUMNS)
      .eq('parent_unit_id', unit.id)
      .order('ordinal')
      .limit(5)
      .returns<UnitRecord[]>();
    for (const c of data ?? []) {
      context.push({ unitId: c.id, locator: c.locator, heading: c.heading, text: c.text.slice(0, 800), relation: 'child' });
    }
  }
  return context;
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
  let embeddingTokens = 0;

  const tasks: Promise<void>[] = [];
  if (modes.has('exact') && (analysis.codes.length || analysis.titleTerms.length)) {
    tasks.push(
      (async () => {
        const { data, error } = await db.rpc('search_exact', {
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
    tasks.push(
      (async () => {
        const { data, error } = await db.rpc('search_keyword', {
          p_terms: analysis.terms,
          p_as_of: asOf,
          p_visibility: visibility,
          p_limit: candidates,
        });
        if (error) throw new Error(`키워드 검색 실패: ${error.message}`);
        lists.keyword = (data as { unit_id: string; score: number }[]).map((r) => ({ unitId: r.unit_id, score: r.score }));
      })(),
    );
  }
  if (modes.has('vector')) {
    tasks.push(
      (async () => {
        const spec = opts.spec ?? embeddingSpec();
        const { vectors, tokens } = await (opts.embedFn ?? embed)([question], spec);
        embeddingTokens = tokens;
        const { data, error } = await db.rpc('search_vector', {
          p_embedding: toPgVector(vectors[0]!),
          p_model: spec.model,
          p_revision: spec.revision,
          p_as_of: asOf,
          p_visibility: visibility,
          p_limit: candidates,
        });
        if (error) throw new Error(`벡터 검색 실패: ${error.message}`);
        lists.vector = (data as { unit_id: string; score: number }[])
          .filter((r) => r.score >= MIN_VECTOR_SCORE)
          .map((r) => ({ unitId: r.unit_id, score: r.score }));
      })(),
    );
  }
  await Promise.all(tasks);

  const fused = rrf(lists).slice(0, finalCount);
  const ids = fused.map(([id]) => id);

  const evidence: Evidence[] = [];
  const pending = new Map<string, { documentTitle: string; effectiveDate: string }>();
  if (ids.length) {
    const { data: units, error } = await db
      .from('legal_units')
      .select(
        `${UNIT_COLUMNS}, legal_versions!inner(id, effective_date, version_status, source_url, document_id, legal_documents!inner(id, title, code, source_type))`,
      )
      .in('id', ids);
    if (error) throw new Error(`근거 조회 실패: ${error.message}`);
    const chunkTransfer = await db.from('search_chunks').select('unit_id, transfer_allowed').in('unit_id', ids);
    const blocked = new Set((chunkTransfer.data ?? []).filter((c) => !c.transfer_allowed).map((c) => c.unit_id));

    const byId = new Map((units ?? []).map((u) => [u.id as string, u]));
    for (const [id, f] of fused) {
      const u = byId.get(id) as unknown as UnitRecord & {
        legal_versions: {
          id: string;
          effective_date: string | null;
          version_status: string;
          source_url: string | null;
          document_id: string;
          legal_documents: { id: string; title: string; code: string | null; source_type: string };
        };
      };
      if (!u) continue;
      const v = u.legal_versions;
      evidence.push({
        unitId: u.id,
        versionId: v.id,
        documentId: v.document_id,
        documentTitle: v.legal_documents.title,
        sourceType: v.legal_documents.source_type,
        code: v.legal_documents.code,
        locator: u.locator,
        heading: u.heading,
        text: u.text,
        effectiveDate: v.effective_date,
        versionStatus: v.version_status,
        parseStatus: u.parse_status,
        sourceUrl: v.source_url,
        transferAllowed: !blocked.has(u.id),
        score: f.score,
        signals: f.signals,
        context: await loadContext(db, u),
      });
    }

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

  const hasStrongSignal = evidence.some((e) => e.signals.exact !== undefined || (e.signals.keyword ?? 0) >= 4 || (e.signals.vector ?? 0) >= 0.45);
  const status: SearchStatus =
    evidence.length === 0 || !hasStrongSignal ? 'insufficient_evidence' : analysis.eventWithoutDate ? 'date_unclear' : 'ok';

  return { status, asOf, analysis, evidence, pendingChanges: [...pending.values()], embeddingTokens };
}
