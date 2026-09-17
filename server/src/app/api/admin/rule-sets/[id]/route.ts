/** GET /api/admin/rule-sets/:id — 규칙과 근거 원문 (ISS-021) */
import { NextResponse } from 'next/server';
import { requireAdmin, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '규칙 세트를 찾을 수 없습니다.');
  const db = adminClient();
  const { data: set } = await db.from('rule_sets').select('*').eq('id', id).maybeSingle();
  if (!set) return jsonError(req, 404, 'not_found', '규칙 세트를 찾을 수 없습니다.');
  const { data: rules, error } = await db
    .from('rules')
    .select(
      'id, rule_key, facility, required_inputs, definition, explanation_template, sort_order, rule_sources(role, legal_units(id, locator, text, parse_status, legal_versions(source_version_id, effective_date, version_status, review_status, legal_documents(title, code))))',
    )
    .eq('rule_set_id', id)
    .order('sort_order');
  if (error) throw new Error(error.message);
  const { data: events } = await db
    .from('review_events')
    .select('action, reviewer_label, reason, created_at')
    .eq('subject_type', 'rule_set')
    .eq('subject_id', id)
    .order('created_at', { ascending: false });
  return NextResponse.json({ ruleSet: set, rules, events });
});
