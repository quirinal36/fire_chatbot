/** GET /api/admin/versions/:id/diff?against=<versionId> — 조항 단위 차이 (ISS-021 · ISS-022) */
import { NextResponse } from 'next/server';
import { requireAdmin, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const db = adminClient();
  let against = new URL(req.url).searchParams.get('against');
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '버전을 찾을 수 없습니다.');

  const { data: version } = await db.from('legal_versions').select('id, document_id, effective_date').eq('id', id).maybeSingle();
  if (!version) return jsonError(req, 404, 'not_found', '버전을 찾을 수 없습니다.');
  if (!against) {
    // 기본 비교 대상: 같은 문서의 직전 게시본
    const { data: prev } = await db
      .from('legal_versions')
      .select('id')
      .eq('document_id', version.document_id)
      .eq('review_status', 'published')
      .neq('id', id)
      .order('effective_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    against = prev?.id ?? null;
  }
  if (!against || !uuidSchema.safeParse(against).success) return NextResponse.json({ against: null, changes: [] });

  const { data, error } = await db.rpc('version_diff', { p_old: against, p_new: id });
  if (error) throw new Error(error.message);
  const changes = data as { locator: string; change: string; old_text: string | null; new_text: string | null }[];

  // 바뀐 조항을 근거로 쓰는 규칙
  const { data: affected } = await db
    .from('rule_sources')
    .select('role, rules!inner(rule_key, facility, rule_sets!inner(code, version, status)), legal_units!inner(locator, version_id)')
    .eq('legal_units.version_id', against)
    .in('legal_units.locator', changes.filter((c) => c.change !== 'added').map((c) => c.locator).slice(0, 300));

  return NextResponse.json({ against, changes: changes.slice(0, 500), total: changes.length, affectedRules: affected ?? [] });
});
