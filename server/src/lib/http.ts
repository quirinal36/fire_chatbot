import { NextResponse } from 'next/server';
import { EnvError } from './env';
import { log } from './log';

export interface ApiError {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

export function requestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function jsonError(req: Request, status: number, code: string, message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message, requestId: requestId(req) } }, { status });
}

/** 처리되지 않은 예외를 비밀값이 가려진 로그로 남기고 내부 정보 없이 500 을 돌려준다. */
export function withErrors<C>(handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof EnvError) {
        log('error', 'server misconfigured', { path: new URL(req.url).pathname, err });
        return jsonError(req, 503, 'misconfigured', '서버 설정이 완료되지 않았습니다.');
      }
      log('error', 'unhandled route error', { path: new URL(req.url).pathname, requestId: requestId(req), err });
      return jsonError(req, 500, 'internal_error', '서버 오류가 발생했습니다.');
    }
  };
}
