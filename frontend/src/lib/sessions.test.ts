import { describe, expect, it } from 'vitest';
import { mergeConversations } from './sessions';
import type { Conversation, Message } from '../types';

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  caseId: null,
  title: '새 대화',
  meta: '방금',
  messages: [],
  loaded: true,
  ...over,
});
const msg = (id: string): Message => ({ id, role: 'user', text: '질문' });

describe('mergeConversations (ISS-035)', () => {
  it('서버 목록에 아직 없는, 질문을 보낸 대화를 잃지 않는다', () => {
    const local = [conv('a', { messages: [msg('m1')], title: '질문' }), conv('b')];
    const merged = mergeConversations(local, [conv('b', { title: '이전 대화', loaded: false })], 'a');
    expect(merged.map((c) => c.id)).toEqual(['a', 'b']);
    expect(merged[0]!.messages).toHaveLength(1);
  });

  it('메시지가 없는 대화라도 현재 열려 있으면 남긴다', () => {
    const merged = mergeConversations([conv('new')], [], 'new');
    expect(merged.map((c) => c.id)).toEqual(['new']);
  });

  it('메시지도 없고 열려 있지도 않은 임시 대화는 정리한다', () => {
    const merged = mergeConversations([conv('stale'), conv('active')], [], 'active');
    expect(merged.map((c) => c.id)).toEqual(['active']);
  });

  it('불러온 메시지와 연결된 사례는 서버 목록으로 덮어쓰지 않는다', () => {
    const local = [conv('a', { messages: [msg('m1')], caseId: 'case-1', title: '내 질문' })];
    const server = [conv('a', { title: '서버 제목', caseId: null, loaded: false, meta: '오늘' })];
    const [a] = mergeConversations(local, server, 'a');
    expect(a).toMatchObject({ messages: [msg('m1')], caseId: 'case-1', title: '내 질문', meta: '오늘', loaded: true });
  });

  it('아직 불러오지 않은 대화는 서버 정보를 그대로 쓴다', () => {
    const local = [conv('a', { loaded: false, title: '새 대화' })];
    const server = [conv('a', { title: '서버 제목', loaded: false })];
    expect(mergeConversations(local, server, 'x')[0]).toMatchObject({ title: '서버 제목', loaded: false });
  });
});
