/** GET /api/admin/runs?status=&limit= — 답변 실행 목록 (ISS-021) */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseQuery, requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const query = z.object({
  status: z.enum(['running', 'succeeded', 'fallback', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  withFeedback: z.enum(['true', 'false']).optional(),
});

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const q = parseQuery(req, query);
  const db = adminClient();
  let sel = db
    .from('answer_runs')
    .select('id, session_id, status, model, prompt_version, rule_set_version, corpus_version, input_tokens, output_tokens, cost_usd, latency_ms, attempts, error_code, created_at, input_snapshot->question, feedback(id, category, status)')
    .order('created_at', { ascending: false })
    .limit(q.limit);
  if (q.status) sel = sel.eq('status', q.status);
  const { data, error } = await sel;
  if (error) throw new Error(error.message);
  const runs = q.withFeedback === 'true' ? (data ?? []).filter((r) => (r.feedback as unknown[]).length > 0) : data;
  return NextResponse.json({ runs });
});
