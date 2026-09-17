import { describe, expect, it } from 'vitest';
import { computeAssessment, toEnvelopeAssessment, type CaseRow } from './cases';
import { ACADEMY_RULES } from './sets/academy';
import { ACADEMY_CASES } from './sets/academy.cases';
import type { ActiveRuleSet } from './store';

const row = (input: Record<string, unknown>): CaseRow => ({
  id: 'c1',
  owner_id: 'o',
  revision: 3,
  assessment_cache: null,
  assessment_revision: null,
  assessment_rule_set: null,
  fields: Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v as never, state: 'user_confirmed' as const }]),
  ),
});

const active = (over: Partial<ActiveRuleSet> = {}): ActiveRuleSet => ({
  id: 'rs1',
  code: 'academy',
  version: ACADEMY_RULES.version,
  status: 'published',
  preview: false,
  definition: ACADEMY_RULES,
  sourceUnits: new Map([['extinguisher', ['u-ext']]]),
  invalidatedRules: new Set(),
  ...over,
});

const a02 = ACADEMY_CASES.find((c) => c.id === 'A02')!;

describe('개정 영향과 판단 재개 (ISS-022)', () => {
  it('무효 표시된 규칙은 추가 확인으로 낮춘다', () => {
    const before = computeAssessment(row(a02.input), active());
    expect(before.results.find((r) => r.ruleKey === 'extinguisher')?.status).toBe('applicable');

    const invalidated = computeAssessment(row(a02.input), active({ invalidatedRules: new Set(['extinguisher']) }));
    const ext = invalidated.results.find((r) => r.ruleKey === 'extinguisher')!;
    expect(ext.status).toBe('needs_review');
    expect(ext.explanation).toContain('개정');
    // 다른 규칙은 그대로 판단한다
    expect(invalidated.results.find((r) => r.ruleKey === 'emergency_alarm')?.status).toBe('applicable');
  });

  it('새 규칙 버전이 게시되면(무효 표시 없음) 판단이 재개된다', () => {
    const resumed = computeAssessment(row(a02.input), active({ id: 'rs2', version: '2026-10-01.1' }));
    expect(resumed.results.find((r) => r.ruleKey === 'extinguisher')?.status).toBe('applicable');
    expect(toEnvelopeAssessment(resumed)[0]?.ruleSetVersion).toBe('academy@2026-10-01.1');
  });

  it('승인 규칙이 없으면 판단하지 않는다', () => {
    const none = computeAssessment(row(a02.input), null);
    expect(none.results).toEqual([]);
    expect(toEnvelopeAssessment(none)).toEqual([]);
  });

  it('검토 전 규칙은 버전 표시에 드러난다', () => {
    const preview = computeAssessment(row(a02.input), active({ status: 'pending_review', preview: true }));
    expect(toEnvelopeAssessment(preview)[0]?.ruleSetVersion).toContain('검토 전');
  });
});
