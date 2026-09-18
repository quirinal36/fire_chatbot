/**
 * GET  /api/plans — 내 도면 목록
 * POST /api/plans — 도면 저장. multipart/form-data:
 *   name, width, height, wallPx, pxPerMeter, scaleFixed, wallHeightM, image(파일), mask(파일, 1비트 PNG)
 * 비회원(익명 세션)도 저장한다. 소셜 로그인 시 익명 계정에 연결되므로 그대로 계정에 남는다.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseQuery, requireUser } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { createPlan, detailOf, listPlans, parsePlanUpload, summaryOf } from '@/lib/plans';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(30) });

export const GET = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const { limit } = parseQuery(req, query);
  const rows = await listPlans(adminClient(), user.id, limit);
  return NextResponse.json({ plans: rows.map(summaryOf) });
});

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const upload = await parsePlanUpload(req);
  const db = adminClient();
  const row = await createPlan(db, user.id, upload);
  return NextResponse.json(await detailOf(db, row), { status: 201 });
});
