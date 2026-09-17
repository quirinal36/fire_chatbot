/**
 * GET  /api/admin/ingestion/:id — 작업 진행·실패 항목
 * POST /api/admin/ingestion/:id — 실패 작업 재처리 { action: 'retry' }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireAdmin, uuidSchema } from '@/lib/api';
import { jsonError, withErrors } from '@/lib/http';
import { HttpError } from '@/lib/http-error';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '작업을 찾을 수 없습니다.');
  const { data } = await adminClient().from('ingestion_jobs').select('*').eq('id', id).maybeSingle();
  if (!data) return jsonError(req, 404, 'not_found', '작업을 찾을 수 없습니다.');
  return NextResponse.json({ job: data });
});

export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req, ['admin']);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError(req, 404, 'not_found', '작업을 찾을 수 없습니다.');
  await parseBody(req, z.object({ action: z.literal('retry') }));
  const { data, error } = await adminClient().rpc('retry_job', { p_job_id: id });
  if (error) throw new Error(error.message);
  if (data !== true) throw new HttpError(409, 'not_retryable', '실패하거나 취소된 작업만 다시 실행할 수 있습니다.');
  return NextResponse.json({ retried: true });
});
