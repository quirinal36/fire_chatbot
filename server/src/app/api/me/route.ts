/**
 * GET /api/me — 요청자 확인. 화면의 로그인 연동(ISS-013)과 CORS·쿠키 설정 점검에 쓴다.
 */
import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth';
import { jsonError, withErrors } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  const found = await getRequestUser(req);
  if (found === null) return jsonError(req, 401, 'unauthorized', '로그인 세션이 없습니다.');

  const { user, via } = found;
  return NextResponse.json({
    id: user.id,
    anonymous: user.is_anonymous ?? false,
    provider: user.app_metadata.provider ?? null,
    via,
  });
});
