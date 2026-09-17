import { apiJson } from './client';

export type FeedbackCategory = 'wrong_law' | 'wrong_conclusion' | 'missing_source' | 'outdated' | 'other';

export const FEEDBACK_LABEL: Record<FeedbackCategory, string> = {
  wrong_law: '법령·조항이 틀림',
  wrong_conclusion: '결론이 틀림',
  missing_source: '근거가 부족함',
  outdated: '개정 전 내용임',
  other: '기타',
};

export function sendFeedback(messageId: string, category: FeedbackCategory, comment: string): Promise<{ id: string }> {
  return apiJson('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ messageId, category, comment: comment.trim() || undefined }),
  });
}
