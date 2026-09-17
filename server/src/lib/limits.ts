/**
 * 요청·비용 한도 (ISS-026 · 기획서 §6.4).
 * 한도 검사는 DB 에서 원자적으로 하므로 동시 요청에서도 넘지 않는다.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { HttpError } from './http-error';
import { env } from './env';

export const MAX_QUESTION_CHARS = 1000;

/** 운영 경보 기준 (ISS-027). 운영 전 담당자와 조정한다 (docs/cost-report.md) */
export const ALERTS = { budgetShare: 0.8, failureRate: 0.05, insufficientRate: 0.4, p95LatencyMs: 20_000 } as const;

export async function enforceLimits(db: SupabaseClient, user: User, ip: string): Promise<void> {
  const e = env();
  const { data: spent, error } = await db.rpc('spent_today_usd');
  if (error) throw new Error(`비용 조회 실패: ${error.message}`);
  if (Number(spent) >= e.DAILY_BUDGET_USD) {
    throw new HttpError(503, 'budget_exhausted', '오늘 이용 가능한 답변량이 모두 소진되었습니다. 내일 다시 이용해 주세요.');
  }

  const checks: [string, number][] = [
    [`user:${user.id}`, user.is_anonymous ? e.LIMIT_ANON_PER_DAY : e.LIMIT_USER_PER_DAY],
    [`ip:${ip}`, e.LIMIT_IP_PER_DAY],
  ];
  for (const [scope, limit] of checks) {
    const { data: ok, error: quotaError } = await db.rpc('consume_request_quota', { p_scope: scope, p_limit: limit });
    if (quotaError) throw new Error(`한도 확인 실패: ${quotaError.message}`);
    if (ok !== true) {
      throw new HttpError(
        429,
        'rate_limited',
        user.is_anonymous && scope.startsWith('user:')
          ? '오늘 질문 한도에 도달했습니다. 로그인하면 더 질문할 수 있습니다.'
          : '오늘 질문 한도에 도달했습니다.',
      );
    }
  }
}
