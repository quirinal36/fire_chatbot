/**
 * 법령 API 응답의 형태 불안정을 흡수하는 공통 도구 (docs/law-api-poc.md).
 *
 * - 같은 필드가 단일 객체이거나 배열이다 (`항`, `호`, `별표단위`)
 * - 본문이 문자열, 줄 배열, 줄 배열의 배열 중 하나로 온다 (`목내용`, `별표내용`, `부칙내용`)
 * - 날짜는 `YYYYMMDD` 문자열이고 빈 문자열일 수 있다
 */
import { z } from 'zod';
import { stripOcParam } from '../redact';

/** 없음 → [], 단일 값 → [값], 배열 → 그대로 */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export const textLike = z.union([z.string(), z.array(z.union([z.string(), z.array(z.string())]))]);
export type TextLike = z.infer<typeof textLike>;

/** 줄 배열을 한 문자열로 합치고 줄 끝 공백을 지운다. 줄 안의 들여쓰기는 표 구조에 필요하므로 남긴다. */
export function flattenText(value: TextLike | null | undefined): string {
  if (value === undefined || value === null) return '';
  const lines = typeof value === 'string' ? value.split('\n') : value.flat();
  return lines
    .map((l) => l.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** `20260701` → `2026-07-01`. 빈 값·형식 오류는 null */
export function parseYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d) ? null : `${y}-${mo}-${d}`;
}

/** 목록의 상세링크는 OC 를 담고 온다. 저장·전달 전에 반드시 이 함수를 거친다. */
export function safeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  return stripOcParam(link.trim());
}

/** 상대 경로를 공식 호스트 기준으로 해석하고 HTTPS 로 올린다. 허용 호스트 밖이면 null */
const ALLOWED_HOSTS = new Set(['www.law.go.kr', 'law.go.kr']);
export function resolveOfficialUrl(link: string | null | undefined): string | null {
  const safe = safeLink(link);
  if (!safe) return null;
  let url: URL;
  try {
    url = new URL(safe, 'https://www.law.go.kr');
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  url.protocol = 'https:';
  url.searchParams.delete('OC');
  return url.toString();
}

export const str = z.string().catch('');
export const optStr = z.string().optional();
