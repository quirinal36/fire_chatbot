/**
 * GET /api/health          — 프로세스와 환경변수 상태 (공개)
 * GET /api/health?deep=1   — Supabase 연결까지 확인
 *
 * 값은 절대 돌려주지 않는다. 설정 여부만 알린다.
 */
import { NextResponse } from 'next/server';
import { EnvError, env } from '@/lib/env';
import { pingSupabase } from '@/lib/supabase';
import { withErrors } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  const deep = new URL(req.url).searchParams.get('deep') === '1';

  let e;
  try {
    e = env();
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    return NextResponse.json({ status: 'misconfigured', problem: err.message }, { status: 503 });
  }

  const body = {
    status: 'ok' as 'ok' | 'degraded',
    appEnv: e.appEnv,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    features: {
      lawApi: e.API_AUTHKEY !== undefined,
      chatModel: e.OPENROUTER_API_KEY !== undefined,
      embeddings: e.OPENAI_API_KEY !== undefined,
      cookieAuth: e.AUTH_COOKIE_DOMAIN !== undefined,
      corsOrigins: e.CORS_ALLOWED_ORIGINS.length,
    },
    supabase: deep ? await pingSupabase() : undefined,
  };
  if (body.supabase && !body.supabase.ok) body.status = 'degraded';

  return NextResponse.json(body, { status: body.status === 'ok' ? 200 : 503 });
});
