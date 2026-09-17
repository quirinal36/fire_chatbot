/**
 * GET  /api/admin/ingestion — 수집 작업 목록
 * POST /api/admin/ingestion — 작업 등록 { kind: 'check_updates' | 'index_corpus', runNow? }
 *   전체 작업을 요청 안에서 끝내지 않는다. 등록 후 예산 안에서만 실행하고 나머지는 Cron 이 이어간다.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { runJobs } from '@/lib/jobs/worker';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const { data, error } = await adminClient()
    .from('ingestion_jobs')
    .select('id, kind, stage, status, attempts, max_attempts, next_run_at, lease_owner, lease_expires_at, last_error, result, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return NextResponse.json({ jobs: data });
});

const bodySchema = z.object({
  kind: z.enum(['check_updates', 'index_corpus']),
  runNow: z.boolean().optional(),
  maxUsd: z.number().positive().max(5).optional(),
});

export const POST = withErrors(async (req: Request) => {
  const user = await requireAdmin(req, ['admin']);
  const body = await parseBody(req, bodySchema);
  const db = adminClient();
  const { data: id, error } = await db.rpc('enqueue_job', {
    p_kind: body.kind,
    p_payload: body.maxUsd ? { maxUsd: body.maxUsd } : {},
    p_dedupe_key: body.kind,
    p_created_by: user.id,
  });
  if (error) throw new Error(error.message);
  const report = body.runNow ? await runJobs(db, `admin-${user.id.slice(0, 8)}`, 40_000) : null;
  return NextResponse.json({ id, report }, { status: 202 });
});
