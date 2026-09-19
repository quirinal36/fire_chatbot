/**
 * POST /api/plans/scale — 치수선을 읽어 축척을 정한다 (Gemini, OpenRouter)
 * multipart: meta(JSON: { width, height }), image(원본 도면, ≤2MB)
 * 질문과 같은 하루 한도·예산을 쓴다.
 */
import { NextResponse } from 'next/server';
import { clientIp, requireUser } from '@/lib/api';
import { ModelError } from '@/lib/chat/openrouter';
import { env } from '@/lib/env';
import { jsonError, withErrors } from '@/lib/http';
import { enforceLimits } from '@/lib/limits';
import { log } from '@/lib/log';
import { parseScaleUpload, readScale, recordScale } from '@/lib/plan-scale';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const db = adminClient();
  await enforceLimits(db, user, clientIp(req));
  const input = await parseScaleUpload(req);
  const model = env().OPENROUTER_VISION_MODEL;
  try {
    const outcome = await readScale(input);
    await recordScale(db, user.id, outcome, null, model);
    return NextResponse.json({
      estimate: outcome.estimate,
      guess: outcome.guess,
      note: outcome.read.note,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      usage: outcome.usage,
      latencyMs: outcome.latencyMs,
    });
  } catch (err) {
    if (err instanceof ModelError) {
      await recordScale(db, user.id, null, err.kind, model);
      log('warn', 'plan scale model error', { kind: err.kind, status: err.status });
      return jsonError(req, 502, 'model_error', 'AI 가 치수를 읽지 못했습니다. 축척은 직접 맞춰 주세요.');
    }
    throw err;
  }
});
