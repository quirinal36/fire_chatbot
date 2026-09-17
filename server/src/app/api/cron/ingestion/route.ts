/**
 * GET /api/cron/ingestion — Vercel Cron 이 하루 한 번 부른다 (ISS-023).
 * Authorization: Bearer <CRON_SECRET> 가 맞아야 실행한다.
 * 오늘 날짜의 개정 확인 작업을 등록하고, 실행시간 예산 안에서 대기 작업을 처리한다.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { bearerToken } from '@/lib/auth';
import { env } from '@/lib/env';
import { jsonError, withErrors } from '@/lib/http';
import { runJobs } from '@/lib/jobs/worker';
import { log } from '@/lib/log';
import { todayInSeoul } from '@/lib/retrieval/search';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const GET = withErrors(async (req: Request) => {
  const secret = env().CRON_SECRET;
  const given = bearerToken(req);
  if (!secret) return jsonError(req, 404, 'not_found', '예약 작업이 설정되지 않았습니다.');
  if (!given || !same(given, secret)) return jsonError(req, 401, 'unauthorized', '인증이 필요합니다.');

  const db = adminClient();
  const day = todayInSeoul();
  const { data: jobId, error } = await db.rpc('enqueue_job', {
    p_kind: 'check_updates',
    p_payload: { day },
    p_dedupe_key: `check_updates:${day}`,
  });
  if (error) throw new Error(`작업 등록 실패: ${error.message}`);

  const report = await runJobs(db, `cron-${crypto.randomUUID().slice(0, 8)}`, 45_000);
  log('info', 'cron ingestion', { jobId, report });
  return NextResponse.json({ enqueued: jobId, ...report });
});
