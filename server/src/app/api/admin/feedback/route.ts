/** GET /api/admin/feedback?status= — 오류 신고 목록 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseQuery, requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const query = z.object({ status: z.enum(['open', 'triaged', 'resolved', 'dismissed']).optional() });

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const q = parseQuery(req, query);
  let sel = adminClient()
    .from('feedback')
    .select('id, category, comment, status, answer_run_id, message_id, handled_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (q.status) sel = sel.eq('status', q.status);
  const { data, error } = await sel;
  if (error) throw new Error(error.message);
  return NextResponse.json({ feedback: data });
});
