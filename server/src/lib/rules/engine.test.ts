import { describe, expect, it } from 'vitest';
import { evaluate, referencedFields, runRuleSet, type Condition, type RuleSetDefinition } from './engine';
import { questionsFor, toFacts, type CaseFields } from './fields';
import { ACADEMY_RULES } from './sets/academy';
import { ACADEMY_CASES } from './sets/academy.cases';

const confirmed = (input: Record<string, unknown>): CaseFields =>
  Object.fromEntries(
    Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, { value: v as never, state: 'user_confirmed' as const }]),
  );

describe('삼값 논리', () => {
  const ctx = (facts: Record<string, number>) => ({ facts, results: new Map(), used: new Map(), missing: new Set<string>() });
  const a: Condition = { field: 'a', op: 'gte', value: 1 };
  const b: Condition = { field: 'b', op: 'gte', value: 1 };
  it('모름은 all/any 에서 확정값에 밀린다', () => {
    expect(evaluate({ all: [a, b] }, ctx({ a: 0 }))).toBe(false);
    expect(evaluate({ all: [a, b] }, ctx({ a: 1 }))).toBe(null);
    expect(evaluate({ any: [a, b] }, ctx({ a: 1 }))).toBe(true);
    expect(evaluate({ any: [a, b] }, ctx({ a: 0 }))).toBe(null);
    expect(evaluate({ not: a }, ctx({}))).toBe(null);
  });
  it('입력이 없으면 비해당이 아니라 추가 확인이다', () => {
    const set: RuleSetDefinition = {
      code: 't', version: '1', title: 't', scopeNote: '',
      rules: [{ key: 'r', facility: 'f', applicableWhen: a, explain: { applicable: 'y', not_applicable: 'n', needs_review: 'q' }, sources: [] }],
    };
    const [r] = runRuleSet(set, {});
    expect(r).toMatchObject({ status: 'needs_review', missingInputs: ['a'] });
  });
});

describe('학원 판단표 사례 (ISS-017)', () => {
  it.each(ACADEMY_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const results = new Map(runRuleSet(ACADEMY_RULES, toFacts(confirmed(c.input))).map((r) => [r.ruleKey, r]));
    for (const [key, status] of Object.entries(c.expected)) {
      if (status === undefined) expect(results.has(key), `${key} 는 범위 밖이어야 한다`).toBe(false);
      else expect(results.get(key)?.status, `${c.title} · ${key}`).toBe(status);
    }
  });

  it('추출한 값(확인 전)은 판단에 쓰지 않는다', () => {
    const fields: CaseFields = {
      business_use: { value: 'academy', state: 'user_confirmed' },
      business_kind: { value: 'general', state: 'user_confirmed' },
      same_use_area_m2: { value: 112, state: 'user_confirmed' },
      capacity: { value: 25, state: 'extracted' },
    };
    const r = runRuleSet(ACADEMY_RULES, toFacts(fields)).find((x) => x.ruleKey === 'multi_use_business');
    expect(r?.status).toBe('needs_review');
  });

  it('결과에 검사한 입력·미확인 입력·예외·근거가 들어 있다', () => {
    const r = runRuleSet(ACADEMY_RULES, toFacts(confirmed(ACADEMY_CASES[0]!.input)));
    const hydrant = r.find((x) => x.ruleKey === 'indoor_hydrant')!;
    expect(hydrant.missingInputs).toContain('building_total_area_m2');
    expect(hydrant.sources.length).toBeGreaterThan(0);
    const multi = r.find((x) => x.ruleKey === 'multi_use_business')!;
    expect(multi.checkedInputs).toMatchObject({ capacity: 25 });
  });

  it('추가 질문은 규칙이 요구한 항목만 만든다', () => {
    const r = runRuleSet(ACADEMY_RULES, toFacts(confirmed(ACADEMY_CASES[0]!.input)));
    const qs = questionsFor(r.flatMap((x) => x.missingInputs));
    const fields = qs.map((q) => q.field);
    expect(fields).toContain('building_total_area_m2');
    expect(fields).not.toContain('event_date');
    const referenced = referencedFields(ACADEMY_RULES);
    for (const f of fields) expect(referenced.has(f) || ['building_floors_above', 'building_floors_below'].includes(f)).toBe(true);
  });

  it('모든 근거 locator 가 규칙에 달려 있다', () => {
    for (const rule of ACADEMY_RULES.rules) expect(rule.sources.some((s) => s.role === 'basis' || s.role === 'definition')).toBe(true);
  });
});
