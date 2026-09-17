/** GET /api/admin/metrics?days=14 — 호출량·토큰·비용·지연·실패·신고와 경보 (ISS-027) */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseQuery, requireAdmin } from '@/lib/api';
import { env } from '@/lib/env';
import { withErrors } from '@/lib/http';
import { adminClient } from '@/lib/supabase';
import { ALERTS } from '@/lib/limits';

export const dynamic = 'force-dynamic';

const query = z.object({ days: z.coerce.number().int().min(1).max(180).default(14) });


export const GET = withErrors(async (req: Request) => {
  await requireAdmin(req);
  const { days } = parseQuery(req, query);
  const db = adminClient();
  const [{ data: m, error }, { data: spent }] = await Promise.all([db.rpc('usage_metrics', { p_days: days }), db.rpc('spent_today_usd')]);
  if (error) throw new Error(error.message);
  const metrics = m as { totals: Record<string, number>; failedJobs: number } & Record<string, unknown>;
  const budget = env().DAILY_BUDGET_USD;
  const todayUsage = Number(spent ?? 0) / budget;
  const t = metrics.totals;
  const alerts: string[] = [];
  if (todayUsage >= ALERTS.budgetShare) alerts.push(`오늘 비용이 일일 상한의 ${(todayUsage * 100).toFixed(0)}% 입니다.`);
  if (t['requests']! > 0 && (t['failed']! + t['fallback']!) / t['requests']! > ALERTS.failureRate) alerts.push('실패·대체 응답 비율이 5%를 넘었습니다.');
  if (t['requests']! >= 20 && t['insufficientRate']! > ALERTS.insufficientRate) alerts.push('근거 부족 응답 비율이 40%를 넘었습니다. 수집 범위를 확인하세요.');
  if (t['p95LatencyMs']! > ALERTS.p95LatencyMs) alerts.push('답변 지연 p95 가 20초를 넘었습니다.');
  if (metrics.failedJobs > 0) alerts.push(`실패한 수집 작업이 ${metrics.failedJobs}건 있습니다.`);
  return NextResponse.json({ ...metrics, limits: { dailyBudgetUsd: budget, todayUsage }, alerts });
});
