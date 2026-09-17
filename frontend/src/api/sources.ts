import type { SourceDetail } from '../types';
import { apiJson } from './client';

export function fetchSource(id: string): Promise<SourceDetail> {
  return apiJson<SourceDetail>(`/api/sources/${encodeURIComponent(id)}`);
}
