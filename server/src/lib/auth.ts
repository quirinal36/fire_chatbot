/**
 * 요청자 신원 확인 (기획서 §9 · ISS-013 의 서버 측 기반).
 *
 * 화면과 API 가 다른 오리진이라 두 경로를 모두 받는다.
 * 1. Authorization: Bearer <Supabase access token>  — 공유 도메인이 정해지기 전 기본 경로
 * 2. 공유 상위 도메인 쿠키 (AUTH_COOKIE_DOMAIN)       — 도메인 확정 후 전환할 경로
 *
 * 비로그인 질문은 Supabase 익명 로그인 세션으로 들어오므로 같은 경로를 탄다.
 */
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { adminClient } from './supabase';
import { env } from './env';

export interface RequestUser {
  readonly user: User;
  readonly via: 'bearer' | 'cookie';
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function parseCookies(header: string | null): { name: string; value: string }[] {
  if (!header) return [];
  return header.split(';').flatMap((part) => {
    const at = part.indexOf('=');
    if (at < 0) return [];
    return [{ name: part.slice(0, at).trim(), value: decodeURIComponent(part.slice(at + 1).trim()) }];
  });
}

export async function getRequestUser(req: Request): Promise<RequestUser | null> {
  const token = bearerToken(req);
  if (token !== null) {
    // getUser 는 Auth 서버에 토큰을 검증받는다. 서명만 보고 믿지 않는다.
    const { data, error } = await adminClient().auth.getUser(token);
    return error || !data.user ? null : { user: data.user, via: 'bearer' };
  }

  const e = env();
  if (e.AUTH_COOKIE_DOMAIN === undefined) return null;

  const cookies = parseCookies(req.headers.get('cookie'));
  if (cookies.length === 0) return null;

  const client = createServerClient(e.SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { domain: e.AUTH_COOKIE_DOMAIN, sameSite: 'lax', secure: true },
    cookies: {
      getAll: () => cookies,
      // 세션 갱신 쿠키는 화면 쪽 Supabase 클라이언트가 쓴다. 여기서는 읽기만 한다.
      setAll: () => {},
    },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : { user: data.user, via: 'cookie' };
}
