import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';

vi.mock('./env', () => ({
  env: () => ({ DAILY_BUDGET_USD: 5, LIMIT_ANON_PER_DAY: 2, LIMIT_USER_PER_DAY: 10, LIMIT_IP_PER_DAY: 100 }),
}));
const { enforceLimits } = await import('./limits');

function fakeDb(spent: number, counters: Map<string, number>) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'spent_today_usd') return { data: spent, error: null };
      const scope = String(args['p_scope']);
      const n = counters.get(scope) ?? 0;
      if (n >= Number(args['p_limit'])) return { data: false, error: null };
      counters.set(scope, n + 1);
      return { data: true, error: null };
    }),
  } as unknown as SupabaseClient;
}

const anon = { id: 'u1', is_anonymous: true } as User;

describe('요청·비용 한도 (ISS-026)', () => {
  it('일일 비용 상한에 도달하면 새 질문을 받지 않는다', async () => {
    await expect(enforceLimits(fakeDb(5, new Map()), anon, 'ip')).rejects.toMatchObject({ status: 503, code: 'budget_exhausted' });
  });
  it('비회원 한도를 넘으면 로그인을 안내한다', async () => {
    const db = fakeDb(0, new Map());
    await enforceLimits(db, anon, 'ip');
    await enforceLimits(db, anon, 'ip');
    await expect(enforceLimits(db, anon, 'ip')).rejects.toMatchObject({ status: 429, message: expect.stringContaining('로그인') });
  });
});
