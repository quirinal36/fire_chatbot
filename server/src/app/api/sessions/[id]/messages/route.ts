/** GET /api/sessions/:id/messages — 대화 내용. 소유자만 볼 수 있다 */
import { NextResponse } from 'next/server';
import { requireUser, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '대화를 찾을 수 없습니다.');

  const db = adminClient();
  const { data: session } = await db.from('chat_sessions').select('id, owner_id').eq('id', id).maybeSingle();
  if (!session || session.owner_id !== user.id) return jsonError(req, 404, 'not_found', '대화를 찾을 수 없습니다.');

  const { data, error } = await db
    .from('chat_messages')
    .select('id, role, content, status, reply_to, created_at')
    .eq('session_id', id)
    .order('created_at')
    .limit(200);
  if (error) throw new Error(error.message);
  return NextResponse.json({
    messages: (data ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status,
      replyTo: m.reply_to,
      createdAt: m.created_at,
    })),
  });
});
