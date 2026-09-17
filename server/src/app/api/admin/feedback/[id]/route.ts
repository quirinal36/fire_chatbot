/** PATCH /api/admin/feedback/:id — 신고 처리 상태 변경 { status, note } */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireAdmin, uuidSchema } from '@/lib/api';
import { reviewerLabel } from '@/lib/admin';
import { jsonError, withErrors } from '@/lib/http';
import { HttpError } from '@/lib/http-error';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ status: z.enum(['open', 'triaged', 'resolved', 'dismissed']), note: z.string().max(1000).optional() });

export const PATCH = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '신고를 찾을 수 없습니다.');
  const body = await parseBody(req, bodySchema);
  const { data, error } = await adminClient().rpc('handle_feedback', {
    p_feedback_id: id,
    p_status: body.status,
    p_reviewer_id: user.id,
    p_reviewer_label: reviewerLabel(user),
    p_note: body.note ?? '',
  });
  if (error) throw new HttpError(409, 'review_rejected', error.message);
  return NextResponse.json({ status: data });
});
