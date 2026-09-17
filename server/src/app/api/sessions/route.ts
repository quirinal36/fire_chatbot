/** GET /api/sessions — 내 대화 목록 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseQuery, requireUser } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(30) });

export const GET = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const { limit } = parseQuery(req, query);
  const { data, error } = await adminClient()
    .from('chat_sessions')
    .select('id, title, case_id, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return NextResponse.json({
    sessions: (data ?? []).map((s) => ({ id: s.id, title: s.title, caseId: s.case_id, createdAt: s.created_at, updatedAt: s.updated_at })),
  });
});
