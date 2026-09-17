/** GET /api/admin/reviews — 승인 대기 목록 (문서 버전·규칙 세트·내부 자료) */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const db = adminClient();
  const [versions, ruleSets, events] = await Promise.all([
    db
      .from('legal_versions')
      .select('id, source_version_id, effective_date, version_status, review_status, fetched_at, document_id, legal_documents!inner(title, code, source_type)')
      .order('fetched_at', { ascending: false })
      .limit(200),
    db
      .from('rule_sets')
      .select('id, code, version, status, approved_at, published_at, review_notes, invalidated_rules, invalidation_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    db
      .from('review_events')
      .select('id, subject_type, subject_id, action, reviewer_label, reason, target_version, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  for (const r of [versions, ruleSets, events]) if (r.error) throw new Error(r.error.message);

  // 각 버전의 파싱 확인 필요 단위 수
  const ids = (versions.data ?? []).map((v) => v.id);
  const needs = new Map<string, number>();
  if (ids.length) {
    const { data } = await db.from('legal_units').select('version_id').in('version_id', ids).eq('parse_status', 'needs_review');
    for (const row of data ?? []) needs.set(row.version_id, (needs.get(row.version_id) ?? 0) + 1);
  }

  return NextResponse.json({
    versions: (versions.data ?? []).map((v) => {
      const d = v.legal_documents as unknown as { title: string; code: string | null; source_type: string };
      return {
        id: v.id,
        documentId: v.document_id,
        title: d.title,
        code: d.code,
        sourceType: d.source_type,
        sourceVersionId: v.source_version_id,
        effectiveDate: v.effective_date,
        versionStatus: v.version_status,
        reviewStatus: v.review_status,
        fetchedAt: v.fetched_at,
        needsReviewUnits: needs.get(v.id) ?? 0,
      };
    }),
    ruleSets: ruleSets.data,
    events: events.data,
  });
});
