/**
 * POST /api/plans/review — 도면 AI 검토 (Gemini, OpenRouter)
 * multipart: meta(JSON: { context, width, height }), image(벽·격자·번호를 겹친 그림, ≤2MB)
 * 질문과 같은 하루 한도·예산을 쓴다.
 */
import { NextResponse } from 'next/server';
import { clientIp, requireUser } from '@/lib/api';
import { ModelError } from '@/lib/chat/openrouter';
import { env } from '@/lib/env';
import { jsonError, withErrors } from '@/lib/http';
import { enforceLimits } from '@/lib/limits';
import { log } from '@/lib/log';
import { parseReviewUpload, recordReview, reviewPlan } from '@/lib/plan-review';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const db = adminClient();
  await enforceLimits(db, user, clientIp(req));
  const input = await parseReviewUpload(req);
  const model = env().OPENROUTER_VISION_MODEL;
  try {
    const outcome = await reviewPlan(input);
    await recordReview(db, user.id, input.ctx, outcome, null, model);
    return NextResponse.json({
      review: outcome.review,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      usage: outcome.usage,
      latencyMs: outcome.latencyMs,
    });
  } catch (err) {
    if (err instanceof ModelError) {
      await recordReview(db, user.id, input.ctx, null, err.kind, model);
      log('warn', 'plan review model error', { kind: err.kind, status: err.status });
      const message =
        err.kind === 'invalid_output'
          ? 'AI 가 형식에 맞는 검토를 내지 못했습니다. 다시 시도해 주세요.'
          : 'AI 검토 서비스에 잠시 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      return jsonError(req, 502, 'model_error', message);
    }
    throw err;
  }
});
