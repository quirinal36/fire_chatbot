/**
 * 한 턴의 처리 (기획서 §6.2 · ISS-015).
 *
 * 요청 중복 확인 → 한도 → (사례 조건·규칙) → 근거 검색 → 답변 생성·검증 → 기록
 * 진행 상태는 이벤트로 알리고, 최종 답변은 검증이 끝난 뒤에만 보낸다.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { env } from '../env';
import { HttpError } from '../http-error';
import { enforceLimits } from '../limits';
import { log } from '../log';
import { search, type SearchResult } from '../retrieval/search';
import { EMBEDDING_USD_PER_MTOK, embeddingSpec } from '../retrieval/embeddings';
import { generateAnswer, type GenerateResult } from './answer';
import type { AnswerEnvelope, Assessment } from './schema';

export type ChatEvent =
  | { type: 'status'; phase: 'searching' | 'writing' }
  | { type: 'answer'; messageId: string | null; envelope: AnswerEnvelope; replayed: boolean }
  | { type: 'error'; code: string; message: string };

export interface CaseContext {
  readonly caseId: string;
  readonly revision: number;
  readonly facts: Readonly<Record<string, string>>;
  readonly assessment: readonly Assessment[];
  readonly ruleSetVersion: string | null;
}

export interface ChatRequest {
  readonly sessionId: string;
  readonly clientRequestId: string;
  readonly question: string;
  readonly caseId?: string | undefined;
}

export interface ChatDeps {
  readonly db: SupabaseClient;
  readonly user: User;
  readonly ip: string;
  readonly emit: (event: ChatEvent) => void;
  /** ISS-019 규칙 실행. 사례가 없으면 null */
  readonly loadCase?: (db: SupabaseClient, ownerId: string, caseId: string) => Promise<CaseContext>;
  readonly searchFn?: typeof search;
  readonly generateFn?: typeof generateAnswer;
}

export async function runChat(req: ChatRequest, deps: ChatDeps): Promise<void> {
  const { db, user, emit } = deps;
  const started = Date.now();

  const { data: begun, error } = await db.rpc('begin_chat_request', {
    p_session_id: req.sessionId,
    p_owner: user.id,
    p_client_request_id: req.clientRequestId,
    p_question: req.question,
  });
  if (error) throw new Error(`요청 시작 실패: ${error.message}`);
  const state = begun as { state: string; message_id?: string; reply_id?: string | null };

  switch (state.state) {
    case 'forbidden':
      throw new HttpError(404, 'not_found', '대화를 찾을 수 없습니다.');
    case 'conflict':
      throw new HttpError(409, 'request_conflict', '같은 요청 번호로 다른 질문을 보냈습니다.');
    case 'in_progress':
      throw new HttpError(409, 'in_progress', '같은 질문을 처리하고 있습니다. 잠시 후 대화를 새로고침해 주세요.');
    case 'completed': {
      // 재전송: 저장된 답변을 다시 보낸다. 모델을 다시 부르지 않는다
      const { data: reply } = await db.from('chat_messages').select('id, content').eq('id', state.reply_id ?? '').maybeSingle();
      if (!reply) throw new HttpError(409, 'in_progress', '답변을 불러오지 못했습니다. 대화를 새로고침해 주세요.');
      emit({ type: 'answer', messageId: reply.id, envelope: reply.content as AnswerEnvelope, replayed: true });
      return;
    }
  }
  const messageId = state.message_id!;

  let result: GenerateResult | null = null;
  let searchResult: SearchResult | null = null;
  let caseContext: CaseContext | null = null;
  let failure: { code: string; message: string } | null = null;

  try {
    // 재시도(retry)도 한도를 소비한다. 실패 반복으로 한도를 우회하지 못하게 한다
    await enforceLimits(db, user, deps.ip);

    if (req.caseId) {
      if (!deps.loadCase) throw new HttpError(400, 'invalid_request', '영업장 조건 기능을 사용할 수 없습니다.');
      caseContext = await deps.loadCase(db, user.id, req.caseId);
    }

    emit({ type: 'status', phase: 'searching' });
    searchResult = await (deps.searchFn ?? search)(db, req.question);

    emit({ type: 'status', phase: 'writing' });
    const { data: corpusVersion } = await db.rpc('corpus_version');
    const e = env();
    result = await (deps.generateFn ?? generateAnswer)({
      question: req.question,
      search: searchResult,
      corpusVersion: (corpusVersion as string) ?? 'unknown',
      model: e.OPENROUTER_CHAT_MODEL,
      fallbackModel: e.OPENROUTER_FALLBACK_MODEL,
      ...(caseContext
        ? { caseFacts: caseContext.facts, caseRevision: caseContext.revision, assessment: caseContext.assessment }
        : {}),
    });
  } catch (err) {
    failure =
      err instanceof HttpError
        ? { code: err.code, message: err.message }
        : { code: 'internal_error', message: '답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    if (!(err instanceof HttpError)) log('error', 'chat failed', { requestId: req.clientRequestId, err });
  }

  const spec = embeddingSpec();
  const embeddingCost = searchResult ? (searchResult.embeddingTokens / 1e6) * (EMBEDDING_USD_PER_MTOK[spec.model] ?? 0) : 0;
  const run = {
    status: failure ? 'failed' : result!.run.status,
    model: result?.run.model ?? null,
    prompt_version: result?.run.promptVersion ?? 'none',
    rule_set_version: caseContext?.ruleSetVersion ?? null,
    corpus_version: result?.envelope.corpusVersion ?? 'unknown',
    source_unit_ids: searchResult?.evidence.map((x) => x.unitId) ?? [],
    input_snapshot: {
      question: req.question,
      asOf: searchResult?.asOf ?? null,
      searchStatus: searchResult?.status ?? null,
      analysis: searchResult?.analysis ?? null,
      caseFacts: caseContext?.facts ?? null,
      assessment: caseContext?.assessment ?? null,
      validationErrors: result?.run.validationErrors ?? [],
    },
    case_id: caseContext?.caseId ?? null,
    case_revision: caseContext?.revision ?? null,
    input_tokens: result?.run.inputTokens ?? 0,
    output_tokens: result?.run.outputTokens ?? 0,
    embedding_tokens: searchResult?.embeddingTokens ?? 0,
    cost_usd: result?.run.costUsd === null || result === null ? null : Number((result.run.costUsd + embeddingCost).toFixed(6)),
    latency_ms: Date.now() - started,
    attempts: result?.run.attempts ?? 0,
    error_code: failure?.code ?? result?.run.errorCode ?? null,
  };

  const { data: replyId, error: finishError } = await db.rpc('finish_chat_request', {
    p_message_id: messageId,
    p_status: failure ? 'failed' : 'succeeded',
    p_envelope: failure ? null : result!.envelope,
    p_run: run,
  });
  if (finishError) log('error', 'chat finish failed', { messageId, err: finishError.message });

  if (failure) {
    emit({ type: 'error', ...failure });
    return;
  }
  emit({ type: 'answer', messageId: (replyId as string) ?? null, envelope: result!.envelope, replayed: false });
}
