/**
 * POST /api/admin/documents — 내부 자료(텍스트) 등록 (ISS-024)
 * 본문: { title, classification, origin, text, synthetic }
 * 등록 후: 버전 게시(검토) → 조각 생성(index_corpus) → 공개·전송 승인을 각각 받아야 검색·모델에 쓰인다.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, requireAdmin } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { registerInternalDocument } from '@/lib/ingestion/internal';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  title: z.string().trim().min(2).max(200),
  classification: z.string().trim().min(2).max(60),
  origin: z.string().trim().min(2).max(100),
  text: z.string().trim().min(10).max(20_000),
  synthetic: z.boolean(),
});

export const POST = withErrors(async (req: Request) => {
  await requireAdmin(req, ['admin']);
  const body = await parseBody(req, bodySchema);
  const db = adminClient();
  const result = await registerInternalDocument(db, body);
  await db.rpc('enqueue_job', { p_kind: 'index_corpus', p_payload: { reason: 'internal document' }, p_dedupe_key: 'index_corpus' });
  return NextResponse.json(result, { status: 201 });
});
