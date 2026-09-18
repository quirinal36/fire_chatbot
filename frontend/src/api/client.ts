/**
 * API 서버 호출 공통. 인증 토큰을 붙이고 오류 본문을 사람이 읽을 메시지로 바꾼다.
 * 화면과 API 는 다른 오리진이다 (ISS-002). 도메인이 정해지기 전에는 Bearer 토큰을 쓴다.
 */
import { API_BASE_URL } from '../config';
import { auth } from '../auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? '요청을 처리하지 못했습니다.');
  } catch {
    return new ApiError(res.status, 'error', '요청을 처리하지 못했습니다.');
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeaders())) headers.set(k, v);
  // FormData 는 브라우저가 경계 문자열과 함께 Content-Type 을 붙인다
  if (init.body !== undefined && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  }
  if (!res.ok) throw await readError(res);
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await (await apiFetch(path, init)).json()) as T;
}
