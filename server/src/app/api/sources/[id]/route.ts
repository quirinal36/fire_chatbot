/**
 * GET /api/sources/:id — 근거 카드 (ISS-011).
 *
 * id 는 legal_units.id 다. 과거 답변의 id 로도 그 버전의 원문을 그대로 돌려준다.
 * 게시되지 않았거나 비공개인 자료는 존재 여부를 드러내지 않도록 404 로 응답한다.
 * 원문 링크는 DB 에 저장된 공식 주소만 쓴다.
 */
import { NextResponse } from 'next/server';
import { requireUser, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { RAW_BUCKET } from '@/lib/ingestion/store';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Detail {
  reviewStatus: string;
  disclosed: boolean;
  attachmentPath: string | null;
  [key: string]: unknown;
}

export const GET = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '근거를 찾을 수 없습니다.');

  const db = adminClient();
  const { data, error } = await db.rpc('source_detail', { p_unit_id: id });
  if (error) throw new Error(`근거 조회 실패: ${error.message}`);
  const detail = data as Detail | null;
  if (!detail || detail.reviewStatus !== 'published' || !detail.disclosed) {
    return jsonError(req, 404, 'not_found', '근거를 찾을 수 없습니다.');
  }

  let attachmentUrl: string | null = null;
  if (detail.attachmentPath) {
    const { data: signed } = await db.storage.from(RAW_BUCKET).createSignedUrl(detail.attachmentPath, 600);
    attachmentUrl = signed?.signedUrl ?? null;
  }

  const { reviewStatus: _r, disclosed: _d, attachmentPath: _a, ...rest } = detail;
  return NextResponse.json({ ...rest, attachmentUrl }, { headers: { 'Cache-Control': 'private, max-age=60' } });
});
