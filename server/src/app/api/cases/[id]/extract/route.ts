/**
 * POST /api/cases/:id/extract — 문장에서 조건 후보를 뽑아 확인 전 상태로 붙인다 (ISS-018)
 * 본문: { text: string, messageId?: uuid }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireUser, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { assessCase, getCase, mergeExtracted } from '@/lib/rules/cases';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ text: z.string().trim().min(1).max(1000), messageId: z.uuid().optional() });

export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '영업장 정보를 찾을 수 없습니다.');
  const body = await parseBody(req, bodySchema);
  const db = adminClient();
  const merged = await mergeExtracted(db, user.id, id, body.text, body.messageId ?? null);
  const row = await getCase(db, user.id, id);
  return NextResponse.json({ id, revision: row.revision, added: merged.added, fields: row.fields, assessment: await assessCase(db, row) });
});
