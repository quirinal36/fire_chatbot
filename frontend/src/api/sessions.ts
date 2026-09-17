import type { AnswerEnvelope, Conversation, Message } from '../types';
import { apiJson } from './client';

interface SessionRow {
  id: string;
  title: string;
  updatedAt: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: { text?: string } | AnswerEnvelope;
  status: 'pending' | 'completed' | 'failed';
}

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export async function listSessions(): Promise<Conversation[]> {
  const { sessions } = await apiJson<{ sessions: SessionRow[] }>('/api/sessions');
  return sessions.map((s) => ({ id: s.id, title: s.title, meta: relativeDay(s.updatedAt), messages: [], loaded: false }));
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  const { messages } = await apiJson<{ messages: MessageRow[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  return messages.flatMap((m): Message[] => {
    if (m.role === 'user') return [{ id: m.id, role: 'user', text: (m.content as { text?: string }).text ?? '' }];
    return [{ id: m.id, role: 'assistant', serverId: m.id, envelope: m.content as AnswerEnvelope, feedback: 'idle' }];
  });
}
