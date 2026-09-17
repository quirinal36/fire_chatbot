import type { LawFailure } from './client';

/** 인증·권한·계약 오류는 재시도해도 같은 결과다. 네트워크·서버 오류만 재시도한다. */
export function isRetryable(reason: LawFailure, status?: number): boolean {
  if (reason === 'network') return true;
  if (reason === 'http_error') return status === undefined || status === 429 || status >= 500;
  return false;
}

export class LawApiError extends Error {
  override name = 'LawApiError';
  constructor(
    readonly reason: LawFailure,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}
