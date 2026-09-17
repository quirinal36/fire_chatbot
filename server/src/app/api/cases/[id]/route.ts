/**
 * GET   /api/cases/:id — 조건과 규칙 판단 결과
 * PATCH /api/cases/:id — 조건 수정 (ISS-018)
 *   본문: { expectedRevision: number, fields: { [key]: { value, state: 'user_confirmed' | 'unknown' } } }
 *   revision 이 다르면 409 revision_conflict
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireUser, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { assessCase, getCase, patchCase, validatePatch } from '@/lib/rules/cases';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '영업장 정보를 찾을 수 없습니다.');
  const db = adminClient();
  const row = await getCase(db, user.id, id);
  const assessment = await assessCase(db, row);
  return NextResponse.json({ id: row.id, revision: row.revision, fields: row.fields, assessment });
});

const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  fields: z
    .record(
      z.string().max(60),
      z.object({ value: z.union([z.number(), z.string().max(40), z.boolean(), z.null()]), state: z.enum(['user_confirmed', 'unknown']) }),
    )
    .refine((f) => Object.keys(f).length > 0 && Object.keys(f).length <= 30, '수정할 항목이 필요합니다'),
});

export const PATCH = withErrors(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '영업장 정보를 찾을 수 없습니다.');
  const body = await parseBody(req, patchSchema);
  const db = adminClient();
  const updated = await patchCase(db, user.id, id, body.expectedRevision, validatePatch(body.fields));
  const row = await getCase(db, user.id, id);
  const assessment = await assessCase(db, row);
  return NextResponse.json({ id, revision: updated.revision, fields: row.fields, assessment });
});
