/**
 * 규칙 세트 저장·조회 (ISS-019).
 *
 * 저장소의 정의(sets/*.ts)를 DB 로 옮길 때 근거 locator 를 게시된 현행 단위 id 로 고정한다.
 * 실행은 DB 에 저장된 정의로 한다. 승인된 그 버전이 그대로 재현되게 하기 위해서다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';
import { referencedFields, type RuleDefinition, type RuleSetDefinition } from './engine';

/** 평가셋·규칙에서 쓰는 문서 키 → 원천 문서 ID */
export const DOC_KEYS: Record<string, { sourceType: string; id: string }> = {
  법: { sourceType: 'law', id: '009503' },
  영: { sourceType: 'law', id: '009694' },
  규칙: { sourceType: 'law', id: '009730' },
  다중법: { sourceType: 'law', id: '010235' },
  다중령: { sourceType: 'law', id: '010409' },
  다중규칙: { sourceType: 'law', id: '010407' },
};

export interface ResolvedSource {
  readonly unitId: string;
  readonly doc: string;
  readonly locator: string;
  readonly role: string;
}

export async function resolveSources(db: SupabaseClient, set: RuleSetDefinition): Promise<Map<string, ResolvedSource[]>> {
  const out = new Map<string, ResolvedSource[]>();
  const problems: string[] = [];
  for (const rule of set.rules) {
    const resolved: ResolvedSource[] = [];
    for (const s of rule.sources) {
      const doc = DOC_KEYS[s.doc];
      if (!doc) {
        problems.push(`${rule.key}: 알 수 없는 문서 키 ${s.doc}`);
        continue;
      }
      const { data, error } = await db
        .from('legal_units')
        .select('id, parse_status, legal_versions!inner(version_status, review_status, legal_documents!inner(source_type, source_document_id))')
        .eq('locator', s.locator)
        .eq('legal_versions.version_status', 'current')
        .eq('legal_versions.review_status', 'published')
        .eq('legal_versions.legal_documents.source_type', doc.sourceType)
        .eq('legal_versions.legal_documents.source_document_id', doc.id);
      if (error) throw new Error(error.message);
      if (!data || data.length !== 1) {
        problems.push(`${rule.key}: ${s.doc} ${s.locator} 을(를) 현행 게시본에서 찾지 못함 (${data?.length ?? 0}건)`);
        continue;
      }
      if (data[0]!.parse_status !== 'ok') {
        problems.push(`${rule.key}: ${s.doc} ${s.locator} 은(는) 파싱 확인이 필요한 단위라 근거로 쓸 수 없음`);
        continue;
      }
      resolved.push({ unitId: data[0]!.id, doc: s.doc, locator: s.locator, role: s.role });
    }
    out.set(rule.key, resolved);
  }
  if (problems.length) throw new Error(`규칙 근거 확인 실패\n- ${problems.join('\n- ')}`);
  return out;
}

export async function syncRuleSet(db: SupabaseClient, set: RuleSetDefinition): Promise<{ status: string; ruleSetId: string }> {
  const sources = await resolveSources(db, set);
  const payload = {
    code: set.code,
    version: set.version,
    scope: { title: set.title, note: set.scopeNote },
    rules: set.rules.map((r) => {
      const { explain, sources: _s, ...definition } = r;
      const fields = referencedFields({ ...set, rules: [r] });
      return {
        key: r.key,
        facility: r.facility,
        required_inputs: [...fields],
        definition,
        explain,
        sources: (sources.get(r.key) ?? []).map((s) => ({ unit_id: s.unitId, role: s.role })),
      };
    }),
  };
  const { data, error } = await db.rpc('upsert_rule_set', { p: payload });
  if (error) throw new Error(`규칙 저장 실패: ${error.message}`);
  const r = data as { status: string; rule_set_id: string };
  return { status: r.status, ruleSetId: r.rule_set_id };
}

export interface ActiveRuleSet {
  readonly id: string;
  readonly code: string;
  readonly version: string;
  readonly status: string;
  /** 승인 전 규칙을 개발 환경에서 미리 보는 중 */
  readonly preview: boolean;
  readonly definition: RuleSetDefinition;
  /** rule key → 근거 unit id */
  readonly sourceUnits: ReadonlyMap<string, readonly string[]>;
}

/**
 * 실행할 규칙 세트. 게시본이 있으면 그것을 쓴다.
 * 게시본이 없으면 운영에서는 판단하지 않고(null), 개발·Preview 에서 RULES_PREVIEW=true 일 때만 최신 검토본을 쓴다.
 */
export async function loadActiveRuleSet(db: SupabaseClient, code: string): Promise<ActiveRuleSet | null> {
  const e = env();
  const allowPreview = e.RULES_PREVIEW && e.appEnv !== 'production';
  const { data: sets, error } = await db
    .from('rule_sets')
    .select('id, code, version, status, scope, created_at')
    .eq('code', code)
    .in('status', allowPreview ? ['published', 'approved', 'pending_review'] : ['published'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const chosen = sets?.find((s) => s.status === 'published') ?? (allowPreview ? sets?.[0] : undefined);
  if (!chosen) return null;

  const { data: rules, error: rulesError } = await db
    .from('rules')
    .select('rule_key, facility, definition, explanation_template, sort_order, rule_sources(legal_unit_id, role)')
    .eq('rule_set_id', chosen.id)
    .order('sort_order');
  if (rulesError) throw new Error(rulesError.message);

  const scope = chosen.scope as { title?: string; note?: string };
  const definition: RuleSetDefinition = {
    code: chosen.code,
    version: chosen.version,
    title: scope.title ?? chosen.code,
    scopeNote: scope.note ?? '',
    rules: (rules ?? []).map(
      (r) =>
        ({
          ...(r.definition as Omit<RuleDefinition, 'explain' | 'sources'>),
          key: r.rule_key,
          facility: r.facility,
          explain: JSON.parse(r.explanation_template) as RuleDefinition['explain'],
          sources: [],
        }) satisfies RuleDefinition,
    ),
  };
  const sourceUnits = new Map(
    (rules ?? []).map((r) => [r.rule_key, ((r.rule_sources as { legal_unit_id: string }[]) ?? []).map((s) => s.legal_unit_id)]),
  );
  return {
    id: chosen.id,
    code: chosen.code,
    version: chosen.version,
    status: chosen.status,
    preview: chosen.status !== 'published',
    definition,
    sourceUnits,
  };
}
