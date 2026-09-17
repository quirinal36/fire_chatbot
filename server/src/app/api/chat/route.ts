/**
 * POST /api/chat — 질문 하나를 처리한다 (ISS-015).
 *
 * 본문: { sessionId: uuid, clientRequestId: string, question: string, caseId?: uuid }
 * 응답: text/event-stream
 *   event: status  data: { phase: 'searching' | 'writing' }
 *   event: answer  data: { messageId, envelope, replayed }
 *   event: error   data: { code, message }
 *
 * 입력·인증·한도 오류는 스트림을 열기 전에 JSON 오류로 돌려준다.
 */
import { z } from 'zod';
import { clientIp, parseBody, requireUser } from '@/lib/api';
import { withErrors } from '@/lib/http';
import { HttpError } from '@/lib/http-error';
import { MAX_QUESTION_CHARS } from '@/lib/limits';
import { runChat, type ChatEvent } from '@/lib/chat/service';
import { loadCaseContext } from '@/lib/rules/case-context';
import { sseResponse } from '@/lib/sse';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  sessionId: z.uuid(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  question: z.string().trim().min(2).max(MAX_QUESTION_CHARS),
  caseId: z.uuid().optional(),
});

export const POST = withErrors(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, bodySchema);
  const db = adminClient();

  // 남의 대화면 스트림을 열기 전에 막는다
  const { data: session } = await db.from('chat_sessions').select('owner_id').eq('id', body.sessionId).maybeSingle();
  if (session && session.owner_id !== user.id) throw new HttpError(404, 'not_found', '대화를 찾을 수 없습니다.');

  return sseResponse(async (send) => {
    const emit = (e: ChatEvent) => {
      const { type, ...data } = e;
      send(type, data);
    };
    try {
      await runChat(body, { db, user, ip: clientIp(req), emit, loadCase: loadCaseContext });
    } catch (err) {
      // 스트림이 열린 뒤의 오류도 사용자에게 알린다
      if (err instanceof HttpError) emit({ type: 'error', code: err.code, message: err.message });
      else emit({ type: 'error', code: 'internal_error', message: '답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  });
});
