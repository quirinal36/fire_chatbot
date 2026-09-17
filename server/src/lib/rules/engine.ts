/**
 * 선언형 규칙 실행기 (ISS-019 · 기획서 §7).
 *
 * - 조건은 JSON 트리다. 문자열 eval 을 쓰지 않는다
 * - 참·거짓·모름 세 값으로 계산한다. 입력이 없으면 "모름" 이고, 모름은 비해당이 되지 않는다
 * - 비해당은 조건이 모두 확인되어 거짓일 때만 나온다
 */

export type FactValue = number | string | boolean;
export type Facts = Readonly<Record<string, FactValue | undefined>>;

export type Condition =
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition }
  | { readonly field: string; readonly op: 'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'ne'; readonly value: FactValue }
  | { readonly field: string; readonly op: 'in'; readonly value: readonly FactValue[] }
  | { readonly rule: string; readonly is: 'applicable' | 'not_applicable' };

export type Tri = true | false | null;

export interface RuleSource {
  /** 문서 키: 영(소방시설법 시행령), 다중령 … */
  readonly doc: string;
  readonly locator: string;
  readonly role: 'basis' | 'exception' | 'definition' | 'transition';
}

export interface RuleException {
  readonly when: Condition;
  readonly note: string;
}

export interface RuleDefinition {
  readonly key: string;
  readonly facility: string;
  /** 이 규칙을 이 사례에 적용하는가. 거짓이면 결과에서 뺀다 */
  readonly scope?: Condition;
  readonly applicableWhen: Condition;
  /** 해당하더라도 이 조건이면 제외 */
  readonly exceptions?: readonly RuleException[];
  /** 결과 설명. {facility} 외의 치환은 쓰지 않는다 */
  readonly explain: { readonly applicable: string; readonly not_applicable: string; readonly needs_review: string };
  readonly sources: readonly RuleSource[];
}

export interface RuleSetDefinition {
  readonly code: string;
  readonly version: string;
  readonly title: string;
  readonly scopeNote: string;
  readonly rules: readonly RuleDefinition[];
}

export type Status = 'applicable' | 'not_applicable' | 'needs_review';

export interface RuleResult {
  readonly ruleKey: string;
  readonly facility: string;
  readonly status: Status;
  readonly explanation: string;
  readonly checkedInputs: Readonly<Record<string, FactValue>>;
  readonly missingInputs: readonly string[];
  readonly exceptions: readonly { note: string; result: Tri }[];
  readonly sources: readonly RuleSource[];
}

interface EvalContext {
  readonly facts: Facts;
  readonly results: Map<string, Status>;
  readonly used: Map<string, FactValue>;
  readonly missing: Set<string>;
}

function compare(a: FactValue, op: string, b: FactValue): boolean {
  switch (op) {
    case 'gte':
      return typeof a === 'number' && typeof b === 'number' && a >= b;
    case 'gt':
      return typeof a === 'number' && typeof b === 'number' && a > b;
    case 'lte':
      return typeof a === 'number' && typeof b === 'number' && a <= b;
    case 'lt':
      return typeof a === 'number' && typeof b === 'number' && a < b;
    case 'eq':
      return a === b;
    case 'ne':
      return a !== b;
    default:
      throw new Error(`알 수 없는 연산자: ${op}`);
  }
}

export function evaluate(cond: Condition, ctx: EvalContext): Tri {
  if ('all' in cond) {
    let unknown = false;
    for (const c of cond.all) {
      const r = evaluate(c, ctx);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if ('any' in cond) {
    let unknown = false;
    for (const c of cond.any) {
      const r = evaluate(c, ctx);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  }
  if ('not' in cond) {
    const r = evaluate(cond.not, ctx);
    return r === null ? null : !r;
  }
  if ('rule' in cond) {
    const status = ctx.results.get(cond.rule);
    if (status === undefined) throw new Error(`규칙 ${cond.rule} 이 먼저 계산되어야 한다`);
    if (status === 'needs_review') return null;
    return status === cond.is;
  }
  const value = ctx.facts[cond.field];
  if (value === undefined) {
    ctx.missing.add(cond.field);
    return null;
  }
  ctx.used.set(cond.field, value);
  if (cond.op === 'in') return cond.value.includes(value);
  return compare(value, cond.op, cond.value);
}

/**
 * 모든 규칙을 정의 순서대로 계산한다. 다른 규칙을 참조하는 규칙은 뒤에 둔다.
 * 범위 밖(scope 거짓) 규칙은 결과에 넣지 않는다.
 */
export function runRuleSet(set: RuleSetDefinition, facts: Facts): RuleResult[] {
  const results = new Map<string, Status>();
  const out: RuleResult[] = [];

  for (const rule of set.rules) {
    const ctx: EvalContext = { facts, results, used: new Map(), missing: new Set() };

    const inScope = rule.scope ? evaluate(rule.scope, ctx) : true;
    if (inScope === false) {
      results.set(rule.key, 'not_applicable');
      continue;
    }

    const main = evaluate(rule.applicableWhen, ctx);
    const exceptions = (rule.exceptions ?? []).map((e) => ({ note: e.note, result: evaluate(e.when, ctx) }));

    let status: Status;
    if (inScope === null) status = 'needs_review';
    else if (main === false) status = 'not_applicable';
    else if (exceptions.some((e) => e.result === true)) status = 'not_applicable';
    else if (main === true && exceptions.every((e) => e.result === false)) status = 'applicable';
    else status = 'needs_review';

    results.set(rule.key, status);
    out.push({
      ruleKey: rule.key,
      facility: rule.facility,
      status,
      explanation: rule.explain[status],
      checkedInputs: Object.fromEntries(ctx.used),
      // 결론이 났으면 더 묻지 않는다. 모름이 결과를 막은 경우에만 필요한 입력으로 돌려준다
      missingInputs: status === 'needs_review' ? [...ctx.missing] : [],
      exceptions,
      sources: rule.sources,
    });
  }
  return out;
}

/** 규칙이 참조하는 입력 이름 (추가 질문 범위를 정하는 데 쓴다) */
export function referencedFields(set: RuleSetDefinition): Set<string> {
  const fields = new Set<string>();
  const walk = (c: Condition) => {
    if ('all' in c) c.all.forEach(walk);
    else if ('any' in c) c.any.forEach(walk);
    else if ('not' in c) walk(c.not);
    else if ('field' in c) fields.add(c.field);
  };
  for (const r of set.rules) {
    if (r.scope) walk(r.scope);
    walk(r.applicableWhen);
    r.exceptions?.forEach((e) => walk(e.when));
  }
  return fields;
}
