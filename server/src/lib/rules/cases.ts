/**
 * 영업장 사례: 조건 저장, 후보 추출, 규칙 판단 (ISS-018 · ISS-019).
 *
 * - 판단에는 사용자가 확인한 값만 쓴다
 * - 조건이 바뀌면 revision 이 올라가고 판단 캐시가 비워진다
 * - 판단 결과는 (사례 revision, 규칙 세트 id) 가 같을 때만 캐시를 쓴다
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../http-error';
import type { Assessment } from '../chat/schema';
import type { CaseContext } from '../chat/service';
import { runRuleSet, type RuleResult } from './engine';
import { extractCandidates } from './extract';
import { FIELDS, fieldValueSchema, questionsFor, toFacts, type CaseFields, type FieldKey, type FieldValue } from './fields';
import { loadActiveRuleSet, type ActiveRuleSet } from './store';

export const RULE_SET_CODE = 'academy';

export interface CaseRow {
  readonly id: string;
  readonly owner_id: string;
  readonly fields: CaseFields;
  readonly revision: number;
  readonly assessment_cache: CaseAssessment | null;
  readonly assessment_revision: number | null;
  readonly assessment_rule_set: string | null;
}

export interface CaseAssessment {
  readonly ruleSet: { id: string; version: string; status: string; preview: boolean } | null;
  readonly results: readonly (RuleResult & { sourceUnitIds: readonly string[] })[];
  readonly questions: readonly { field: string; question: string }[];
  /** 추출만 되고 확인되지 않은 항목 */
  readonly unconfirmed: readonly { field: string; value: unknown; note: string | null }[];
}

export async function getCase(db: SupabaseClient, ownerId: string, caseId: string): Promise<CaseRow> {
  const { data, error } = await db
    .from('building_cases')
    .select('id, owner_id, fields, revision, assessment_cache, assessment_revision, assessment_rule_set')
    .eq('id', caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.owner_id !== ownerId) throw new HttpError(404, 'not_found', '영업장 정보를 찾을 수 없습니다.');
  return data as CaseRow;
}

export async function createCase(db: SupabaseClient, ownerId: string, sessionId: string | null): Promise<CaseRow> {
  if (sessionId) {
    const { data: s } = await db.from('chat_sessions').select('owner_id, case_id').eq('id', sessionId).maybeSingle();
    if (s && s.owner_id !== ownerId) throw new HttpError(404, 'not_found', '대화를 찾을 수 없습니다.');
    if (s?.case_id) return getCase(db, ownerId, s.case_id);
  }
  const fields: CaseFields = { business_use: { value: 'academy', state: 'user_confirmed', note: '현재 지원 업종' } };
  const { data, error } = await db
    .from('building_cases')
    .insert({ owner_id: ownerId, fields })
    .select('id, owner_id, fields, revision, assessment_cache, assessment_revision, assessment_rule_set')
    .single();
  if (error) throw new Error(error.message);
  if (sessionId) {
    // 대화가 아직 없으면 만들어 연결한다 (질문 전에 조건부터 입력하는 경우)
    await db.from('chat_sessions').upsert({ id: sessionId, owner_id: ownerId, title: '영업장 확인' }, { onConflict: 'id', ignoreDuplicates: true });
    await db.from('chat_sessions').update({ case_id: data.id }).eq('id', sessionId).eq('owner_id', ownerId);
  }
  return data as CaseRow;
}

export type FieldPatch = Readonly<Record<string, { value: unknown; state: 'user_confirmed' | 'unknown' }>>;

export function validatePatch(patch: FieldPatch): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const bad: string[] = [];
  for (const [key, p] of Object.entries(patch)) {
    if (!(key in FIELDS)) {
      bad.push(key);
      continue;
    }
    if (p.state === 'unknown' || p.value === null || p.value === undefined) {
      out[key] = { value: null, state: 'unknown' };
      continue;
    }
    const parsed = fieldValueSchema(key as FieldKey).safeParse(p.value);
    if (!parsed.success) bad.push(key);
    else out[key] = { value: parsed.data, state: 'user_confirmed' };
  }
  if (bad.length) throw new HttpError(400, 'invalid_request', `입력값을 확인해 주세요: ${bad.map((k) => (k in FIELDS ? FIELDS[k as FieldKey].label : k)).join(', ')}`);
  return out;
}

export async function patchCase(
  db: SupabaseClient,
  ownerId: string,
  caseId: string,
  expectedRevision: number,
  patch: Record<string, FieldValue>,
): Promise<{ revision: number; fields: CaseFields }> {
  const { data, error } = await db.rpc('update_case_fields', {
    p_case_id: caseId,
    p_owner: ownerId,
    p_expected_revision: expectedRevision,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  const r = data as { status: string; revision?: number; fields?: CaseFields };
  if (r.status === 'not_found') throw new HttpError(404, 'not_found', '영업장 정보를 찾을 수 없습니다.');
  if (r.status === 'conflict') {
    throw new HttpError(409, 'revision_conflict', '다른 곳에서 조건이 먼저 바뀌었습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.');
  }
  return { revision: r.revision!, fields: r.fields! };
}

/** 추출 후보를 합친다. 사용자가 확인한 값은 덮어쓰지 않는다 */
export async function mergeExtracted(
  db: SupabaseClient,
  ownerId: string,
  caseId: string,
  text: string,
  sourceMessageId: string | null,
): Promise<{ revision: number; added: string[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await getCase(db, ownerId, caseId);
    const patch: Record<string, FieldValue> = {};
    for (const c of extractCandidates(text)) {
      const current = row.fields[c.field];
      if (current?.state === 'user_confirmed') continue;
      if (current?.state === 'extracted' && current.value === c.value) continue;
      patch[c.field] = { value: c.value, state: 'extracted', sourceMessageId, note: c.note };
    }
    if (Object.keys(patch).length === 0) return { revision: row.revision, added: [] };
    try {
      const r = await patchCase(db, ownerId, caseId, row.revision, patch);
      return { revision: r.revision, added: Object.keys(patch) };
    } catch (err) {
      // 동시에 다른 수정이 들어오면 최신 revision 으로 다시 합친다
      if (!(err instanceof HttpError && err.code === 'revision_conflict')) throw err;
    }
  }
  throw new HttpError(409, 'revision_conflict', '조건을 저장하지 못했습니다. 다시 시도해 주세요.');
}

function computeAssessment(row: CaseRow, active: ActiveRuleSet | null): CaseAssessment {
  const unconfirmed = Object.entries(row.fields)
    .filter(([, f]) => f.state === 'extracted')
    .map(([field, f]) => ({ field, value: f.value ?? null, note: f.note ?? null }));
  if (!active) return { ruleSet: null, results: [], questions: [], unconfirmed };

  const results = runRuleSet(active.definition, toFacts(row.fields)).map((r) => ({
    ...r,
    sourceUnitIds: active.sourceUnits.get(r.ruleKey) ?? [],
  }));
  // 추출 후보가 있는 항목은 "확인해 주세요" 로 먼저 묻는다
  const missing = results.flatMap((r) => r.missingInputs);
  const pending = new Set(unconfirmed.map((u) => u.field));
  // 추출만 된 값은 "맞는지" 확인을 요청한다
  const confirmQs = unconfirmed
    .filter((u) => missing.includes(u.field) || missing.includes('use_class') || missing.includes('building_area_lower_bound_m2'))
    .filter((u) => u.field in FIELDS)
    .map((u) => {
      const spec = FIELDS[u.field as FieldKey] as { label: string; unit?: string };
      return { field: u.field, question: `${spec.label}: ${String(u.value)}${spec.unit ?? ''}(질문에서 읽은 값)이 맞나요?` };
    });
  const questions = [
    ...confirmQs,
    ...questionsFor(missing).filter((q) => !pending.has(q.field)),
  ];
  return {
    ruleSet: { id: active.id, version: active.version, status: active.status, preview: active.preview },
    results,
    questions,
    unconfirmed,
  };
}

export async function assessCase(db: SupabaseClient, row: CaseRow): Promise<CaseAssessment> {
  const active = await loadActiveRuleSet(db, RULE_SET_CODE);
  if (active && row.assessment_cache && row.assessment_revision === row.revision && row.assessment_rule_set === active.id) {
    return row.assessment_cache;
  }
  const assessment = computeAssessment(row, active);
  // 같은 revision 일 때만 캐시를 쓴다. 그 사이 조건이 바뀌었으면 쓰지 않는다
  await db
    .from('building_cases')
    .update({ assessment_cache: assessment, assessment_revision: row.revision, assessment_rule_set: active?.id ?? null })
    .eq('id', row.id)
    .eq('revision', row.revision);
  return assessment;
}

export function toEnvelopeAssessment(a: CaseAssessment): Assessment[] {
  if (!a.ruleSet) return [];
  const version = `${RULE_SET_CODE}@${a.ruleSet.version}${a.ruleSet.preview ? ' (검토 전 규칙)' : ''}`;
  return a.results
    .filter((r) => r.ruleKey !== 'use_class')
    .map((r) => ({
      facility: r.facility,
      status: r.status,
      ruleId: `${a.ruleSet!.id}:${r.ruleKey}`,
      ruleSetVersion: version,
      explanation: r.explanation,
      missingInputs: questionsFor(r.missingInputs).map((q) => FIELDS[q.field as FieldKey]?.label ?? q.field),
      sourceIds: r.sourceUnitIds,
    }));
}

function describe(fields: CaseFields): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const [key, f] of Object.entries(fields)) {
    if (f.state !== 'user_confirmed' || f.value === null || f.value === undefined || !(key in FIELDS)) continue;
    const spec = FIELDS[key as FieldKey] as { label: string; unit?: string; options?: readonly { value: string; label: string }[] };
    const option = spec.options?.find((o) => o.value === f.value)?.label;
    const value = typeof f.value === 'boolean' ? (f.value ? '예' : '아니오') : (option ?? `${f.value}${spec.unit ?? ''}`);
    facts[spec.label] = value;
  }
  return facts;
}

export async function loadCaseContextFor(db: SupabaseClient, ownerId: string, caseId: string, question?: string, messageId?: string): Promise<CaseContext & { questions: readonly { field: string; question: string }[] }> {
  if (question) await mergeExtracted(db, ownerId, caseId, question, messageId ?? null);
  const row = await getCase(db, ownerId, caseId);
  const assessment = await assessCase(db, row);
  return {
    caseId: row.id,
    revision: row.revision,
    facts: describe(row.fields),
    assessment: toEnvelopeAssessment(assessment),
    ruleSetVersion: assessment.ruleSet ? `${RULE_SET_CODE}@${assessment.ruleSet.version}` : null,
    questions: assessment.questions,
  };
}
