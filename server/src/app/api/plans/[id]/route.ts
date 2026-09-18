/**
 * GET    /api/plans/:id — 도면 메타와 파일 주소(서명, 1시간)
 * PUT    /api/plans/:id — 같은 도면에 덮어쓰기. 본문은 POST /api/plans 와 같다
 * DELETE /api/plans/:id
 */
import { NextResponse } from 'next/server';
import { requireUser, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { deletePlan, detailOf, getPlan, parsePlanUpload, updatePlan } from '@/lib/plans';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function idOf(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return uuidSchema.safeParse(id).success ? id : null;
}

export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = await idOf(ctx);
  if (!id) return jsonError(req, 404, 'not_found', '도면을 찾을 수 없습니다.');
  const db = adminClient();
  return NextResponse.json(await detailOf(db, await getPlan(db, user.id, id)));
});

export const PUT = withErrors(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = await idOf(ctx);
  if (!id) return jsonError(req, 404, 'not_found', '도면을 찾을 수 없습니다.');
  const upload = await parsePlanUpload(req);
  const db = adminClient();
  return NextResponse.json(await detailOf(db, await updatePlan(db, user.id, id, upload)));
});

export const DELETE = withErrors(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = await idOf(ctx);
  if (!id) return jsonError(req, 404, 'not_found', '도면을 찾을 수 없습니다.');
  await deletePlan(adminClient(), user.id, id);
  return new Response(null, { status: 204 });
});
