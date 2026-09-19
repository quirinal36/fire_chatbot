import { apiJson } from './client';

export type FieldState = 'unknown' | 'extracted' | 'user_confirmed';
export type FieldPrimitive = number | string | boolean;

export interface FieldValue {
  readonly value?: FieldPrimitive | null;
  readonly state: FieldState;
  readonly note?: string | null;
}

export interface FieldDef {
  readonly key: string;
  readonly label: string;
  readonly kind: 'number' | 'integer' | 'boolean' | 'enum' | 'date';
  readonly unit?: string;
  readonly options?: readonly { value: string; label: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly question: string;
}

export interface CaseResult {
  readonly ruleKey: string;
  readonly facility: string;
  readonly status: 'applicable' | 'not_applicable' | 'needs_review';
  readonly explanation: string;
  readonly missingInputs: readonly string[];
  readonly sourceUnitIds: readonly string[];
}

export interface CaseData {
  readonly id: string;
  readonly revision: number;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly assessment: {
    readonly ruleSet: { id: string; version: string; status: string; preview: boolean } | null;
    readonly results: readonly CaseResult[];
    readonly questions: readonly { field: string; question: string }[];
    readonly unconfirmed: readonly { field: string; value: unknown; note: string | null }[];
  };
}

/** note 는 값의 출처다. 직접 고친 값은 null 을 보내 옛 출처를 지운다 */
export type FieldPatch = Record<string, { value: FieldPrimitive | null; state: 'user_confirmed' | 'unknown'; note?: string | null }>;

let fieldDefs: Promise<FieldDef[]> | null = null;

export function loadFieldDefs(): Promise<FieldDef[]> {
  fieldDefs ??= apiJson<{ fields: FieldDef[] }>('/api/case-fields').then((r) => r.fields);
  return fieldDefs;
}

export const createCase = (sessionId: string) =>
  apiJson<CaseData>('/api/cases', { method: 'POST', body: JSON.stringify({ sessionId }) });

export const getCase = (id: string) => apiJson<CaseData>(`/api/cases/${encodeURIComponent(id)}`);

export const patchCase = (id: string, expectedRevision: number, fields: FieldPatch) =>
  apiJson<CaseData>(`/api/cases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedRevision, fields }),
  });
