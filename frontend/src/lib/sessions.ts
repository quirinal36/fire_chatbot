/**
 * 서버 대화 목록과 화면에 있는 대화를 합친다 (ISS-035).
 *
 * 질문을 막 보낸 대화는 서버 목록을 받아 온 시점에 아직 그 목록에 없을 수 있다.
 * 이때 목록으로 상태를 덮어쓰면 그 대화가 사라지고, 뒤이어 도착한 답변이 화면에 붙지 못한다.
 * 그래서 목록에 없는 로컬 대화를 먼저 두고 합친다.
 */
import type { Conversation } from '../types';

export function mergeConversations(
  local: readonly Conversation[],
  server: readonly Conversation[],
  activeId: string,
): Conversation[] {
  const serverIds = new Set(server.map((s) => s.id));
  const localOnly = local.filter((c) => !serverIds.has(c.id) && (c.messages.length > 0 || c.id === activeId));

  const merged = server.map((s) => {
    const mine = local.find((c) => c.id === s.id);
    if (!mine) return s;
    // 서버에서 받은 제목·시각을 쓰되, 이미 불러온 메시지와 연결된 사례는 유지한다
    return {
      ...s,
      messages: mine.loaded ? mine.messages : s.messages,
      loaded: mine.loaded,
      caseId: mine.caseId ?? s.caseId,
      title: mine.loaded && mine.title !== '새 대화' ? mine.title : s.title,
    };
  });

  return [...localOnly, ...merged];
}
