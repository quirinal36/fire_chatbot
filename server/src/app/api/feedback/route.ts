/**
 * POST /api/feedback — 답변 오류 신고 (ISS-016).
 * 본문: { messageId: uuid(답변 메시지), category, comment? }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireUser } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  messageId: z.uuid(),
  category: z.enum(['wrong_law', 'wrong_conclusion', 'missing_source', 'outdated', 'other']),
  comment: z.string().trim().max(2000).optional(),
});

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, bodySchema);
  const db = adminClient();

  const { data: msg } = await db
    .from('chat_messages')
    .select('id, role, answer_run_id, chat_sessions!inner(owner_id)')
    .eq('id', body.messageId)
    .maybeSingle();
  const owner = (msg?.chat_sessions as unknown as { owner_id: string } | undefined)?.owner_id;
  if (!msg || msg.role !== 'assistant' || owner !== user.id) {
    return jsonError(req, 404, 'not_found', '답변을 찾을 수 없습니다.');
  }

  const { data, error } = await db
    .from('feedback')
    .insert({
      owner_id: user.id,
      message_id: msg.id,
      answer_run_id: msg.answer_run_id,
      category: body.category,
      comment: body.comment ?? null,
    })
    .select('id, status, created_at')
    .single();
  if (error) throw new Error(error.message);
  return NextResponse.json({ id: data.id, status: data.status, createdAt: data.created_at }, { status: 201 });
});
