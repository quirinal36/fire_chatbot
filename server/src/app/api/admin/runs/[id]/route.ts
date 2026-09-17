/** GET /api/admin/runs/:id — 답변 실행 추적: 입력·근거·규칙·모델·답변·신고 (ISS-021) */
import { NextResponse } from 'next/server';
import { requireAdmin, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '실행을 찾을 수 없습니다.');
  const db = adminClient();
  const { data: run } = await db.from('answer_runs').select('*').eq('id', id).maybeSingle();
  if (!run) return jsonError(req, 404, 'not_found', '실행을 찾을 수 없습니다.');
  const [messages, feedback, sources] = await Promise.all([
    db.from('chat_messages').select('id, role, content, status, created_at').eq('answer_run_id', id),
    db.from('feedback').select('id, category, comment, status, handled_at, created_at').eq('answer_run_id', id),
    run.source_unit_ids?.length
      ? db
          .from('legal_units')
          .select('id, locator, legal_versions(source_version_id, effective_date, legal_documents(title, code))')
          .in('id', run.source_unit_ids)
      : Promise.resolve({ data: [] }),
  ]);
  return NextResponse.json({ run, messages: messages.data, feedback: feedback.data, sources: sources.data });
});
