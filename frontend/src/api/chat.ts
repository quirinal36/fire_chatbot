/**
 * 챗봇 응답 연동 지점.
 *
 * 아직 백엔드가 없으므로 고정 답변을 돌려줍니다. 실제 연동 시에는 이 함수 안을
 * 서버 호출로 바꾸세요. 스트리밍 응답을 쓸 계획이면 반환 타입을
 * AsyncIterable<string> 으로 바꾸고 messageList 에서 받아 이어 붙이면 됩니다.
 *
 *   const res = await fetch('/api/chat', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ conversationId, question }),
 *   });
 *
 * 도면 해석과 법령 검색은 서버에서 수행하고, 이 화면은 결과만 그립니다.
 */

import type { AssistantMessage } from '../types';

export interface ChatRequest {
  readonly conversationId: string;
  readonly question: string;
}

let counter = 0;

export async function requestAnswer(req: ChatRequest): Promise<AssistantMessage> {
  // 응답을 기다리는 화면을 확인하기 위한 지연입니다.
  await new Promise((resolve) => setTimeout(resolve, 900));
  counter += 1;

  return {
    id: `a-${counter}`,
    role: 'assistant',
    paragraphs: [
      `"${req.question}" 에 대한 답변입니다. 지금은 **응답 서버가 연결되지 않아** 고정 문구를 표시합니다.`,
      'src/api/chat.ts 의 requestAnswer 함수를 실제 API 호출로 바꾸면 이 자리에 검토 결과가 들어옵니다.',
    ],
    disclaimer: 'AI 검토 결과는 참고용이며, 최종 판단은 담당 공무원의 검토를 거쳐야 합니다.',
  };
}
