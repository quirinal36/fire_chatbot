/**
 * 화면과 API 가 서로 다른 Vercel 프로젝트(다른 오리진)에 있으므로 CORS 가 필요하다.
 * 허용 목록은 CORS_ALLOWED_ORIGINS 로만 정한다. 와일드카드는 쓰지 않는다
 * — 공유 도메인 쿠키로 전환하면 credentials 와 함께 쓸 수 없기 때문이다.
 */

export const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS';
export const ALLOWED_HEADERS = 'Authorization,Content-Type,X-Request-Id';

export function isAllowedOrigin(origin: string | null, allowed: readonly string[]): origin is string {
  return origin !== null && allowed.includes(origin);
}

export function corsHeaders(origin: string | null, allowed: readonly string[]): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (!isAllowedOrigin(origin, allowed)) return headers;
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  headers.set('Access-Control-Max-Age', '600');
  return headers;
}
