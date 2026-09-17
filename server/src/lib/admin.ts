/** 관리자 라우트 공통 */
import type { User } from '@supabase/supabase-js';

export function reviewerLabel(user: User): string {
  const meta = user.user_metadata as Record<string, unknown>;
  const name = String(meta['full_name'] ?? meta['name'] ?? '');
  return name ? `${name} <${user.email ?? user.id}>` : (user.email ?? user.id);
}
