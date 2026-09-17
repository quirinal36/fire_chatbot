/**
 * 검증된 답변 만들기 (ISS-014 · 기획서 §6.3~6.4).
 *
 * 1. 근거가 부족하면 모델을 부르지 않고 추가 확인 안내를 돌려준다
 * 2. 모델 응답을 스키마·인용 ID·조항 번호·URL·판정 문구로 검증한다
 * 3. 실패하면 문제를 알려 한 번 더 요청하고, 그래도 실패하면 근거 목록만 돌려준다
 * 4. 모델 장애가 일시적이면 평가를 통과한 대체 모델을 한 번 시도한다
 */
import type { SearchResult, Evidence } from '../retrieval/search';
import { callChatModel, ModelError, type ModelResult } from './openrouter';
import { buildMessages, PROMPT_VERSION } from './prompt';
import {
  chatAnswerSchema,
  DISCLAIMER,
  type AnswerEnvelope,
  type AnswerStatus,
  type Assessment,
  type ChatAnswer,
  type EnvelopeSource,
} from './schema';

export interface GenerateOptions {
  readonly question: string;
  readonly search: SearchResult;
  readonly corpusVersion: string;
  readonly model: string;
  readonly fallbackModel?: string | undefined;
  readonly caseFacts?: Readonly<Record<string, string>>;
  readonly caseRevision?: number | null;
  readonly assessment?: readonly Assessment[];
  readonly call?: typeof callChatModel;
}

export interface RunRecord {
  readonly status: 'succeeded' | 'fallback' | 'failed';
  readonly model: string | null;
  readonly promptVersion: string;
  readonly attempts: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
  readonly modelLatencyMs: number;
  readonly errorCode: string | null;
  readonly validationErrors: readonly string[];
}

export interface GenerateResult {
  readonly envelope: AnswerEnvelope;
  readonly run: RunRecord;
}

const URL_PATTERN = /(https?:\/\/|www\.)/iu;
const LOCATOR_PATTERN = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|별표\s*(\d+)(?:\s*의\s*(\d+))?/gu;
/** 질문자의 건물·영업장을 가리키는 표현. 법령 일반 설명과 특정 건물 판정을 가른다 */
const CASE_REFERENCE = /(귀하|질문하신|말씀하신|문의하신|해당\s*(?:학원|건물|영업장|시설)|이\s*(?:학원|건물|영업장)|우리|저희|고객님|운영하시는|영업장은|학원은|건물은)/u;
/** 규칙 결과 없이 모델이 설치 대상 여부를 단정하는 표현 */
const VERDICT_PATTERN = /(설치\s*대상이\s*아닙니다|설치하지\s*않아도\s*됩니다|설치\s*의무가\s*없습니다|해당하지\s*않습니다|설치\s*대상입니다|반드시\s*설치해야\s*합니다)/u;

function mentionedLocators(text: string): string[] {
  return [...text.matchAll(LOCATOR_PATTERN)].map((m) =>
    m[1] ? `제${m[1]}조${m[2] ? `의${m[2]}` : ''}` : `별표${m[3]}${m[4] ? `의${m[4]}` : ''}`,
  );
}

function evidenceMentions(evidence: readonly Evidence[]): Set<string> {
  const known = new Set<string>();
  for (const e of evidence) {
    const blob = [e.locator, e.text, e.heading ?? '', ...e.context.map((c) => `${c.locator} ${c.text}`)].join('\n');
    for (const l of mentionedLocators(blob)) known.add(l);
    // 별표4/1.가 → 별표4, 제7조제1항 → 제7조
    const head = /^(별표\d+(?:의\d+)?|제\d+조(?:의\d+)?)/u.exec(e.locator);
    if (head) known.add(head[1]!);
  }
  return known;
}

/** 시설 이름의 짧은 표기. 규칙 결과의 facility 와 문장을 대조할 때 쓴다 */
const FACILITY_KEYWORDS: ReadonlyArray<[RegExp, RegExp]> = [
  [/간이\s*스프링클러/u, /간이\s*스프링클러/u],
  [/^스프링클러/u, /(?<!간이\s*)스프링클러/u],
  [/소화기구/u, /소화기/u],
  [/옥내소화전/u, /옥내\s*소화전/u],
  [/비상경보/u, /비상경보/u],
  [/자동화재탐지/u, /자동화재\s*탐지|자탐/u],
  [/시각경보/u, /시각경보/u],
  [/피난기구/u, /피난기구/u],
  [/유도등/u, /유도등|유도표지/u],
  [/휴대용/u, /휴대용\s*비상조명/u],
  [/비상조명등/u, /(?<!휴대용\s*)비상조명/u],
  [/다중이용업/u, /다중이용업/u],
];
const SAYS_APPLICABLE = /(설치해야\s*합니다|설치가\s*필요합니다|설치\s*대상입니다|해당합니다|적용됩니다|갖춰야\s*합니다|의무가\s*있습니다)/u;
const SAYS_NOT = /(설치하지\s*않아도|대상이\s*아닙니다|해당하지\s*않습니다|적용되지\s*않습니다|의무가\s*없습니다|필요하지\s*않습니다|미치지\s*(?:않|못)|비해당)/u;

/** 규칙 결과와 다른 결론을 말한 문장 */
export function conflictsWithAssessment(texts: readonly string[], assessment: readonly Assessment[]): string[] {
  const conflicts: string[] = [];
  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?다])\s+/u));
  for (const a of assessment) {
    const pair = FACILITY_KEYWORDS.find(([f]) => f.test(a.facility));
    if (!pair) continue;
    for (const sentence of sentences) {
      if (!pair[1].test(sentence)) continue;
      const said = SAYS_NOT.test(sentence) ? 'not_applicable' : SAYS_APPLICABLE.test(sentence) ? 'applicable' : null;
      // 조건을 달아 말한 문장(…이면, …인 경우)은 결론이 아니다
      if (said === null || /(이면|라면|경우|이상이면|미만이면|인지|확인)/u.test(sentence)) continue;
      if (said !== a.status) conflicts.push(`${a.facility}(규칙: ${a.status}, 답변: ${said})`);
    }
  }
  return [...new Set(conflicts)];
}

export function validateAnswer(
  raw: string,
  ctx: { refs: ReadonlySet<string>; evidence: readonly Evidence[]; question: string; hasAssessment: boolean; assessment?: readonly Assessment[] },
): { ok: true; answer: ChatAnswer } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['JSON 이 아니다'] };
  }
  const result = chatAnswerSchema.safeParse(parsed);
  if (!result.success) {
    const where = [...new Set(result.error.issues.map((i) => `${i.path.join('.')}(${i.code})`))].slice(0, 4);
    return { ok: false, errors: [`스키마 불일치: ${where.join(', ')}`] };
  }
  const answer = result.data;
  const errors: string[] = [];

  for (const s of answer.statements) {
    if (s.sourceIds.length === 0) errors.push('근거 없는 문장이 있다');
    const unknown = s.sourceIds.filter((id) => !ctx.refs.has(id));
    if (unknown.length) errors.push(`제공되지 않은 근거 id: ${unknown.join(', ')}`);
  }

  const texts = [answer.summary, ...answer.statements.map((s) => s.text), ...answer.limitations, ...answer.followUpQuestions.map((q) => q.question)];
  if (texts.some((t) => URL_PATTERN.test(t))) errors.push('URL 을 쓰면 안 된다');

  // 근거에 없는 조항 번호. 질문에 나온 번호를 "확인할 수 없다"고 말하는 것은 허용한다
  const known = evidenceMentions(ctx.evidence);
  const asked = new Set(mentionedLocators(ctx.question));
  const claimed = [answer.summary, ...answer.statements.map((s) => s.text)].flatMap(mentionedLocators);
  const invented = claimed.filter((l) => !known.has(l) && !(asked.has(l) && answer.statements.length === 0));
  if (invented.length) errors.push(`근거에 없는 조항 번호: ${[...new Set(invented)].join(', ')}`);

  // 근거가 있는데 요약만 쓰고 근거 문장을 비우면 인용을 확인할 수 없다
  if (answer.statements.length === 0 && ctx.refs.size > 0 && /\d/u.test(answer.summary) && !/확인할 수 없/u.test(answer.summary)) {
    errors.push('요약의 기준·수치를 statements 에 근거와 함께 적어야 한다');
  }

  // 법령 일반 설명("피난층은 설치하지 않아도 됩니다")은 허용하고, 질문자 건물에 대한 단정만 막는다
  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?다])\s+/u));
  if (!ctx.hasAssessment && sentences.some((t) => VERDICT_PATTERN.test(t) && CASE_REFERENCE.test(t) && !/(이면|라면|경우|인지|확인)/u.test(t))) {
    errors.push('규칙 결과 없이 설치 대상 여부를 단정했다');
  }

  if (ctx.assessment?.length) {
    const conflicts = conflictsWithAssessment([answer.summary, ...answer.statements.map((s) => s.text)], ctx.assessment);
    if (conflicts.length) errors.push(`assessment 와 다른 결론: ${conflicts.join(', ')}. assessment 결과만 옮겨 적으세요`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, answer };
}

function toSources(evidence: readonly Evidence[], refs: ReadonlyMap<string, string>): EnvelopeSource[] {
  return evidence.map((e) => ({
    id: e.unitId,
    ref: refs.get(e.unitId)!,
    title: e.documentTitle,
    code: e.code,
    locator: e.locator,
    heading: e.heading,
    excerpt: e.text.replace(/\s+/gu, ' ').slice(0, 300),
    effectiveDate: e.effectiveDate,
    versionStatus: e.versionStatus,
    needsReview: e.parseStatus === 'needs_review',
    url: e.sourceUrl,
  }));
}

function templateAnswer(kind: 'insufficient' | 'fallback', search: SearchResult): ChatAnswer {
  if (kind === 'insufficient') {
    return {
      mode: 'legal_search',
      summary: '질문과 관련된 소방 법령 근거를 찾지 못했습니다. 건물 용도, 층, 면적처럼 구체적인 조건이나 궁금한 소방시설을 알려 주시면 다시 찾아보겠습니다.',
      statements: [],
      followUpQuestions: [
        { field: 'facility', question: '어떤 소방시설(소화기, 스프링클러, 자동화재탐지설비 등)이 궁금하신가요?' },
        { field: 'building_use', question: '영업장의 업종과 건물 용도를 알려 주세요.' },
      ],
      limitations: ['관련 근거가 확인되지 않아 답변을 생성하지 않았습니다.'],
    };
  }
  return {
    mode: 'legal_search',
    summary: search.evidence.length
      ? '답변을 작성하지 못했습니다. 아래에 찾은 근거 조문을 원문 그대로 보여 드리니 직접 확인해 주세요.'
      : '지금은 답변을 작성할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    statements: [],
    followUpQuestions: [],
    limitations: ['자동 답변 생성에 실패해 근거 목록만 제공합니다. 해석이 필요하면 관할 소방서에 문의하세요.'],
  };
}

function dateLimitations(answer: ChatAnswer, search: SearchResult): ChatAnswer {
  const limitations = [...answer.limitations];
  const followUps = [...answer.followUpQuestions];
  if (search.status === 'date_unclear') {
    limitations.push('건축허가·용도변경 등의 날짜에 따라 적용 기준이 달라질 수 있습니다.');
    if (!followUps.some((q) => q.field === 'event_date') && followUps.length < 4) {
      followUps.push({ field: 'event_date', question: '건축허가(또는 용도변경 신고) 날짜를 알려 주세요.' });
    }
  }
  for (const p of search.pendingChanges) {
    const [y, m, d] = p.effectiveDate.split('-').map(Number);
    // 모델이 이미 같은 날짜를 적었으면 다시 적지 않는다
    const mentioned = limitations.some((l) => l.includes(p.effectiveDate) || l.includes(`${y}년 ${m}월 ${d}일`));
    if (!mentioned) limitations.unshift(`${p.documentTitle}은(는) ${p.effectiveDate}부터 개정 내용이 시행될 예정입니다.`);
  }
  return { ...answer, limitations: limitations.slice(0, 4), followUpQuestions: followUps.slice(0, 4) };
}

export async function generateAnswer(opts: GenerateOptions): Promise<GenerateResult> {
  const call = opts.call ?? callChatModel;
  const { search } = opts;
  // 외부 전송이 허용되지 않은 근거는 모델에 보내지 않는다 (기획서 §9)
  const evidence = search.evidence.filter((e) => e.transferAllowed);
  const refs = new Map(search.evidence.map((e, i) => [e.unitId, `S${i + 1}`]));
  const allowed = new Set(evidence.map((e) => refs.get(e.unitId)!));
  const assessment = opts.assessment ?? [];

  const envelope = (status: AnswerStatus, answer: ChatAnswer): AnswerEnvelope => ({
    status,
    answer: dateLimitations(answer, search),
    assessment,
    sources: toSources(search.evidence, refs),
    asOf: search.asOf,
    pendingChanges: search.pendingChanges,
    caseRevision: opts.caseRevision ?? null,
    corpusVersion: opts.corpusVersion,
    disclaimer: DISCLAIMER,
  });

  const run = {
    model: null as string | null,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0 as number | null,
    modelLatencyMs: 0,
    errorCode: null as string | null,
    validationErrors: [] as string[],
  };
  const record = (status: RunRecord['status']): RunRecord => ({ status, promptVersion: PROMPT_VERSION, ...run });

  if (search.status === 'insufficient_evidence' && assessment.length === 0) {
    return { envelope: envelope('insufficient_evidence', templateAnswer('insufficient', search)), run: record('succeeded') };
  }

  const models = [opts.model, ...(opts.fallbackModel && opts.fallbackModel !== opts.model ? [opts.fallbackModel] : [])];
  let correction: string | undefined;

  for (const [mi, model] of models.entries()) {
    // 모델마다 최초 1회 + 검증 실패 시 1회
    for (let attempt = 0; attempt < 2; attempt++) {
      let result: ModelResult;
      try {
        run.attempts += 1;
        result = await call(
          buildMessages({
            question: opts.question,
            asOf: search.asOf,
            evidence,
            refs,
            ...(opts.caseFacts ? { caseFacts: opts.caseFacts } : {}),
            assessment,
            pendingChanges: search.pendingChanges,
            ...(correction ? { correction } : {}),
          }),
          { model },
        );
      } catch (err) {
        const kind = err instanceof ModelError ? err.kind : 'network';
        run.errorCode = `model_${kind}`;
        // 인증·잔액 오류는 다른 모델로 바꿔도 해결되지 않는다
        const tryNext = err instanceof ModelError && err.retryable && mi < models.length - 1;
        if (tryNext) break;
        return { envelope: envelope('fallback', templateAnswer('fallback', search)), run: record('failed') };
      }

      run.model = result.model;
      run.inputTokens += result.usage.inputTokens;
      run.outputTokens += result.usage.outputTokens;
      run.costUsd = run.costUsd === null || result.usage.costUsd === null ? null : run.costUsd + result.usage.costUsd;
      run.modelLatencyMs += result.latencyMs;

      const checked = validateAnswer(result.content, {
        refs: allowed,
        evidence,
        question: opts.question,
        hasAssessment: assessment.length > 0,
        assessment,
      });
      if (checked.ok) {
        run.errorCode = null;
        const status: AnswerStatus = search.status === 'date_unclear' ? 'date_unclear' : 'answered';
        return { envelope: envelope(status, checked.answer), run: record('succeeded') };
      }
      run.validationErrors.push(...checked.errors);
      run.errorCode = 'validation_failed';
      correction = checked.errors.join('; ');
    }
  }

  return { envelope: envelope('fallback', templateAnswer('fallback', search)), run: record('fallback') };
}
