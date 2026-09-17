/**
 * 관리자 화면 API. 관리자 세션은 사용자 화면의 비회원 세션과 따로 저장한다.
 */
import { GoTrueClient } from '@supabase/auth-js';
import { API_BASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

export const adminAuth = new GoTrueClient({
  url: `${SUPABASE_URL}/auth/v1`,
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
  storageKey: 'fire-chatbot-admin-auth',
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
});

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await adminAuth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // 본문이 JSON 이 아니면 상태 코드만 보여 준다
    }
    throw new AdminApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
