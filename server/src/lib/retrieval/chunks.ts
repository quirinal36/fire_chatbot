/**
 * 검색 조각 만들기 (ISS-009).
 *
 * 조각 본문 앞에 문서 제목과 상위 단위 경로를 붙여, 하위 항목만 봐도 어느 조문의 어떤 조건인지 알 수 있게 한다.
 * 긴 단위는 겹치는 창으로 나누되 모든 창에 같은 머리말을 붙인다.
 */
import { createHash } from 'node:crypto';

export interface UnitRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly unitType: string;
  readonly locator: string;
  readonly heading: string | null;
  readonly text: string;
}

export interface ChunkDraft {
  readonly unitId: string;
  readonly contextText: string;
  readonly chunkHash: string;
}

export const MAX_CHUNK_CHARS = 1800;
const OVERLAP = 200;

const label = (u: UnitRow) => {
  if (u.unitType === 'chapter' && !/^\d/.test(u.locator)) return u.heading ?? u.locator;
  return u.heading ? `${u.locator}(${u.heading})` : u.locator;
};

export function windows(text: string, size = MAX_CHUNK_CHARS, overlap = OVERLAP): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    out.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return out;
}

export function buildChunks(documentTitle: string, units: readonly UnitRow[]): ChunkDraft[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const parentIds = new Set(units.map((u) => u.parentId).filter(Boolean));
  const chunks: ChunkDraft[] = [];

  for (const u of units) {
    const body = u.text.trim();
    if (!body) continue;
    // 별표 전체 본문은 하위 절로 나뉘어 있으면 조각으로 만들지 않는다 (중복·과대 조각 방지)
    if (u.unitType === 'appendix' && parentIds.has(u.id)) continue;
    // 제목만 있는 장·절은 단독 조각으로 쓸모가 없다
    if (u.unitType === 'chapter' && body === (u.heading ?? '').trim()) continue;

    const path: string[] = [];
    for (let p = u.parentId ? byId.get(u.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      path.unshift(label(p));
    }
    const header = `[${documentTitle}] ${[...path, label(u)].join(' > ')}`;
    for (const part of windows(body)) {
      const contextText = `${header}\n${part}`;
      chunks.push({ unitId: u.id, contextText, chunkHash: createHash('sha256').update(contextText).digest('hex') });
    }
  }
  return chunks;
}
