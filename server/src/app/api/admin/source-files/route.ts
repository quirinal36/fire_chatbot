/** GET /api/admin/source-files — 해석·내부 자료의 공개/전송 승인 상태 (ISS-024) */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const { data, error } = await adminClient()
    .from('source_files')
    .select('id, classification, origin, disclosure, disclosure_approved_at, transfer_allowed, transfer_approved_at, selected_by_reviewer, created_at, legal_documents!inner(id, title, source_type)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return NextResponse.json({ files: data });
});
