/**
 * POST /api/chat — SSE 로 진행 상태와 검증된 최종 답변을 받는다 (ISS-015).
 */
import type { AnswerEnvelope } from '../types';
import { apiFetch, ApiError } from './client';

export interface ChatRequest {
  readonly sessionId: string;
  readonly clientRequestId: string;
  readonly question: string;
  readonly caseId?: string;
}

export interface ChatReply {
  readonly messageId: string | null;
  readonly envelope: AnswerEnvelope;
  readonly replayed: boolean;
}

export type ChatPhase = 'searching' | 'writing';

/** SSE 본문을 이벤트 단위로 나눈다 */
export function parseSse(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

export async function requestAnswer(req: ChatRequest, onPhase: (phase: ChatPhase) => void): Promise<ChatReply> {
  const res = await apiFetch('/api/chat', { method: 'POST', body: JSON.stringify(req) });
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(0, 'network', '응답을 읽지 못했습니다.');

  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(done ? `${buffer}\n\n` : buffer);
    buffer = rest;
    for (const e of events) {
      const data = JSON.parse(e.data) as Record<string, unknown>;
      if (e.event === 'status') onPhase(data['phase'] as ChatPhase);
      else if (e.event === 'answer') return data as unknown as ChatReply;
      else if (e.event === 'error') throw new ApiError(200, String(data['code']), String(data['message']));
    }
    if (done) break;
  }
  throw new ApiError(0, 'network', '답변을 받기 전에 연결이 끊겼습니다.');
}
