/**
 * 작업 큐 실행기 (ISS-023 · 기획서 §3, §9).
 *
 * - claim_job 으로 한 번에 하나를 원자적으로 가져오고, lease 가 끝나면 다른 실행이 이어받는다
 * - 실행시간 예산이 끝나기 전에 cursor 를 저장하고 멈춘다. 다음 Cron 호출에서 이어서 한다
 * - Cron 은 실패를 자동으로 다시 부르지 않으므로, 재시도는 작업 자체의 next_run_at 으로 관리한다
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG, entryLabel } from '../ingestion/catalog';
import { ingestCatalog } from '../ingestion/ingest';
import { supabaseIngestStore } from '../ingestion/store';
import { secretValues } from '../env';
import { log } from '../log';
import { embedPending, syncChunks } from '../retrieval/indexer';

export type JobKind = 'check_updates' | 'index_corpus';

export interface Job {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly cursor: Record<string, unknown> | null;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly result: Record<string, unknown> | null;
}

export interface StepResult {
  /** done: 끝남, continue: 예산이 끝나 다음에 이어서, retry: 일시 오류로 나중에 다시 */
  readonly state: 'done' | 'continue' | 'retry' | 'failed';
  readonly stage: string;
  readonly cursor: Record<string, unknown> | null;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

type Handler = (db: SupabaseClient, job: Job, deadline: number) => Promise<StepResult>;

/**
 * 선정 목록을 한 항목씩 확인한다. 새 버전이 있으면 저장하고(검토 대기),
 * 이전 게시본 대비 바뀐 근거를 쓰는 규칙을 무효로 표시한다 (ISS-022).
 */
const checkUpdates: Handler = async (db, job, deadline) => {
  let index = Number(job.cursor?.['index'] ?? 0);
  const found = (job.result?.['newVersions'] as unknown[] | undefined) ?? [];
  const failures = (job.result?.['failures'] as unknown[] | undefined) ?? [];
  const store = supabaseIngestStore(db);

  while (index < CATALOG.length) {
    if (Date.now() > deadline) {
      return { state: 'continue', stage: `check ${index}/${CATALOG.length}`, cursor: { index }, result: { newVersions: found, failures } };
    }
    const entry = CATALOG[index]!;
    const outcomes = await ingestCatalog([entry], { store, secrets: secretValues(), downloadAttachments: true });
    for (const o of outcomes) {
      if (o.status === 'new') {
        const { data: impact, error } = await db.rpc('apply_revision_impact', { p_new_version: o.versionId });
        if (error) throw new Error(`개정 영향 분석 실패: ${error.message}`);
        found.push({ label: o.label, versionId: o.versionId, impact });
        log('info', 'new legal version', { label: o.label, impact });
      } else if (o.status === 'failed' || o.status === 'conflict') {
        failures.push({ label: o.label, detail: o.status === 'failed' ? o.error : o.detail });
        // 인증 오류는 다른 항목도 실패하므로 바로 멈춘다
        if (o.status === 'failed' && !o.retryable) {
          return { state: 'failed', stage: `check ${entryLabel(entry)}`, cursor: { index }, result: { newVersions: found, failures }, error: o.error };
        }
      }
    }
    index += 1;
  }

  if (found.length) {
    // 새 버전의 검색 조각을 만든다. 게시 전이라 검색에는 아직 나오지 않는다
    await db.rpc('enqueue_job', { p_kind: 'index_corpus', p_payload: { reason: 'new versions' }, p_dedupe_key: 'index_corpus' });
  }
  return {
    state: failures.length && found.length === 0 && failures.length === CATALOG.length ? 'retry' : 'done',
    stage: 'done',
    cursor: null,
    result: { newVersions: found, failures, checked: CATALOG.length },
    ...(failures.length ? { error: `${failures.length}건 실패` } : {}),
  };
};

const indexCorpus: Handler = async (db, job, deadline) => {
  const stage = String(job.cursor?.['stage'] ?? 'chunks');
  if (stage === 'chunks') {
    const report = await syncChunks(db);
    if (Date.now() > deadline) return { state: 'continue', stage: 'embed', cursor: { stage: 'embed' }, result: { chunks: report } };
  }
  const maxUsd = Number(job.payload['maxUsd'] ?? 0.5);
  const report = await embedPending(db, { maxUsd, batchSize: 48 });
  if (report.stoppedByBudget) {
    return { state: 'failed', stage: 'embed', cursor: { stage: 'embed' }, result: { embed: report }, error: `임베딩 비용 상한 $${maxUsd} 도달` };
  }
  return { state: 'done', stage: 'done', cursor: null, result: { embed: report } };
};

const HANDLERS: Record<string, Handler> = { check_updates: checkUpdates, index_corpus: indexCorpus };

export interface RunReport {
  readonly processed: { id: string; kind: string; state: string; error?: string }[];
}

/** 예산 안에서 대기 작업을 처리한다 */
export async function runJobs(db: SupabaseClient, worker: string, budgetMs: number): Promise<RunReport> {
  const deadline = Date.now() + budgetMs;
  const processed: RunReport['processed'] = [];
  while (Date.now() < deadline - 5_000) {
    const { data, error } = await db.rpc('claim_job', { p_worker: worker, p_lease_seconds: Math.ceil(budgetMs / 1000) + 60 });
    if (error) throw new Error(`작업 가져오기 실패: ${error.message}`);
    const job = (data as Job[])[0];
    if (!job) break;

    const handler = HANDLERS[job.kind];
    let step: StepResult;
    try {
      step = handler
        ? await handler(db, job, deadline - 5_000)
        : { state: 'failed', stage: 'unknown', cursor: job.cursor, error: `알 수 없는 작업 종류: ${job.kind}` };
    } catch (err) {
      step = { state: 'retry', stage: 'error', cursor: job.cursor, error: err instanceof Error ? err.message : String(err) };
    }

    const status = step.state === 'done' ? 'succeeded' : step.state === 'continue' ? 'queued' : 'failed';
    const { error: updateError } = await db.rpc('update_job', {
      p_job_id: job.id,
      p_worker: worker,
      p_status: status,
      p_stage: step.stage,
      p_cursor: step.cursor,
      p_result: step.result ?? null,
      p_error: step.error ?? null,
      p_retry_after_seconds: step.state === 'retry' ? 300 : null,
    });
    if (updateError) throw new Error(`작업 기록 실패: ${updateError.message}`);
    processed.push({ id: job.id, kind: job.kind, state: step.state, ...(step.error ? { error: step.error } : {}) });
    if (step.state === 'continue') break;
  }
  return { processed };
}
