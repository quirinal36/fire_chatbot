/**
 * POST /api/cases — 영업장 사례 만들기 (ISS-018)
 * 본문: { sessionId?: uuid } — 대화에 연결한다. 이미 연결된 사례가 있으면 그것을 돌려준다
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireUser } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { assessCase, createCase } from '@/lib/rules/cases';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ sessionId: z.uuid().optional() });

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, bodySchema);
  const db = adminClient();
  const row = await createCase(db, user.id, body.sessionId ?? null);
  const assessment = await assessCase(db, row);
  return NextResponse.json({ id: row.id, revision: row.revision, fields: row.fields, assessment }, { status: 201 });
});
