/**
 * 채팅에 넘길 영업장 조건과 규칙 결과 (ISS-018 · ISS-019 에서 채운다).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../http-error';
import type { CaseContext } from '../chat/service';

export async function loadCaseContext(_db: SupabaseClient, _ownerId: string, _caseId: string): Promise<CaseContext> {
  throw new HttpError(400, 'invalid_request', '영업장 조건 기능은 아직 준비 중입니다.');
}
