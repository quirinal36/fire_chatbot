/**
 * POST /api/admin/reviews/:id — 승인·반려 (ISS-021 · 기획서 §8)
 * 본문: { subjectType: 'legal_version' | 'rule_set' | 'source_file', action, reason, acknowledgeParseIssues? }
 * 모든 결정은 review_events 에 검토자·시각·사유와 함께 남는다.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireAdmin, uuidSchema } from '@/lib/api';
import { reviewerLabel } from '@/lib/admin';
import { jsonError, withErrors } from '@/lib/http';
import { HttpError } from '@/lib/http-error';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('subjectType', [
  z.object({
    subjectType: z.literal('legal_version'),
    action: z.enum(['publish', 'reject']),
    reason: z.string().trim().min(2).max(1000),
    acknowledgeParseIssues: z.boolean().optional(),
  }),
  z.object({
    subjectType: z.literal('rule_set'),
    action: z.enum(['approve', 'publish', 'reject', 'request_changes', 'revalidate']),
    reason: z.string().trim().min(2).max(1000),
  }),
  z.object({
    subjectType: z.literal('source_file'),
    action: z.enum(['approve_disclosure', 'revoke_disclosure', 'approve_transfer', 'revoke_transfer', 'select', 'unselect']),
    reason: z.string().trim().min(2).max(1000),
  }),
]);

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdmin(req, ['admin', 'reviewer']);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '대상을 찾을 수 없습니다.');
  const body = await parseBody(req, bodySchema);
  const db = adminClient();
  const label = reviewerLabel(user);

  let result;
  if (body.subjectType === 'legal_version') {
    result =
      body.action === 'publish'
        ? await db.rpc('publish_version', {
            p_version_id: id,
            p_reviewer_label: label,
            p_reason: body.reason,
            p_reviewer_id: user.id,
            p_acknowledge_parse_issues: body.acknowledgeParseIssues ?? false,
          })
        : await db.rpc('reject_version', { p_version_id: id, p_reviewer_label: label, p_reason: body.reason, p_reviewer_id: user.id });
  } else if (body.subjectType === 'rule_set') {
    result =
      body.action === 'revalidate'
        ? await db.rpc('revalidate_rule_set', { p_rule_set_id: id, p_reviewer_id: user.id, p_reviewer_label: label, p_reason: body.reason })
        : await db.rpc('review_rule_set', { p_rule_set_id: id, p_action: body.action, p_reviewer_id: user.id, p_reviewer_label: label, p_reason: body.reason });
  } else {
    result = await db.rpc('review_source_file', { p_file_id: id, p_action: body.action, p_reviewer_id: user.id, p_reviewer_label: label, p_reason: body.reason });
  }
  // DB 함수의 거부 사유(게시 조건 미충족 등)는 관리자에게 그대로 보여 준다
  if (result.error) throw new HttpError(409, 'review_rejected', result.error.message);
  return NextResponse.json({ result: result.data });
});
