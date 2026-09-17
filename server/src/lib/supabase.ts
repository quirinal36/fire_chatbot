/**
 * Supabase 클라이언트.
 *
 * - adminClient: secret 키. RLS 를 우회하므로 호출하는 쪽에서 소유권·관리자 검사를 해야 한다 (ISS-005).
 * - 요청자 신원 확인은 auth.ts 의 getRequestUser 를 쓴다.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let admin: SupabaseClient | undefined;

export function adminClient(): SupabaseClient {
  const e = env();
  admin ??= createClient(e.SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Supabase Auth 서버가 응답하는지 확인한다. 키 값은 반환하지 않는다. */
export async function pingSupabase(): Promise<{ ok: boolean; ms: number; status?: number; error?: string }> {
  const e = env();
  const t0 = Date.now();
  try {
    const res = await fetch(new URL('/auth/v1/health', e.SUPABASE_URL), {
      headers: { apikey: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, ms: Date.now() - t0, status: res.status };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, error: err instanceof Error ? err.name : 'unknown' };
  }
}
