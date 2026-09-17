/**
 * 라우트 공통: 인증 요구, 입력 검증, 요청자 식별 (ISS-013).
 * secret 키로 DB 를 쓰므로 소유권·관리자 검사는 반드시 여기를 거친다.
 */
import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { getRequestUser } from './auth';
import { adminClient } from './supabase';

import { HttpError } from './http-error';

export { HttpError };

export async function requireUser(req: Request): Promise<User> {
  const found = await getRequestUser(req);
  if (found === null) throw new HttpError(401, 'unauthorized', '로그인 세션이 없습니다.');
  return found.user;
}

export async function requireAdmin(req: Request, roles: readonly ('admin' | 'reviewer')[] = ['admin', 'reviewer']): Promise<User> {
  const user = await requireUser(req);
  // 익명 세션은 관리자가 될 수 없다
  if (user.is_anonymous) throw new HttpError(403, 'forbidden', '권한이 없습니다.');
  const { data, error } = await adminClient().rpc('is_admin', { p_user: user.id, p_roles: roles });
  if (error) throw new Error(`권한 확인 실패: ${error.message}`);
  if (data !== true) throw new HttpError(403, 'forbidden', '권한이 없습니다.');
  return user;
}

const MAX_BODY_BYTES = 32 * 1024;

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'JSON 본문이 필요합니다.');
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', '요청이 너무 큽니다.');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON 형식이 아닙니다.');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(본문)'))];
    throw new HttpError(400, 'invalid_request', `입력값을 확인해 주세요: ${fields.join(', ')}`);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) throw new HttpError(400, 'invalid_request', '조회 조건을 확인해 주세요.');
  return result.data;
}

export const uuidSchema = z.uuid();

export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

