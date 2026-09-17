/** GET /api/admin/overview — 승인 대기·신고·작업 현황 (ISS-021) */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const db = adminClient();
  const count = async (table: string, filter: (q: any) => any) => {
    const { count: c, error } = await filter(db.from(table).select('id', { count: 'exact', head: true }));
    if (error) throw new Error(error.message);
    return c ?? 0;
  };
  const [pendingVersions, pendingRules, invalidatedRules, openFeedback, failedJobs, pendingFiles] = await Promise.all([
    count('legal_versions', (q) => q.in('review_status', ['pending', 'needs_review'])),
    count('rule_sets', (q) => q.in('status', ['pending_review', 'needs_review', 'approved'])),
    count('rule_sets', (q) => q.neq('invalidated_rules', '{}')),
    count('feedback', (q) => q.in('status', ['open', 'triaged'])),
    count('ingestion_jobs', (q) => q.eq('status', 'failed')),
    count('source_files', (q) => q.eq('disclosure', 'private')),
  ]);
  const { data: spent } = await db.rpc('spent_today_usd');
  return NextResponse.json({ pendingVersions, pendingRules, invalidatedRules, openFeedback, failedJobs, pendingFiles, spentTodayUsd: Number(spent ?? 0) });
});
