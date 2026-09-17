/**
 * 법령 API 조회 계층 (ISS-006).
 *
 * - 계약 위반은 LawApiError 로 올린다. 인증·계약 오류는 retryable=false.
 * - 일시 오류(네트워크·429·5xx)는 제한된 지수 백오프로 재시도한다.
 * - 목록은 전체 페이지를 순회하고 totalCnt 와 수집 건수를 대조한다.
 */
import { callLawApi, type LawCallKind, type LawTarget } from './client';
import { LawApiError, isRetryable } from './errors';
import type { ListPage } from './types';
import { parseEflawBody, parseEflawList } from './adapters/eflaw';
import { parseAdmrulBody, parseAdmrulList } from './adapters/admrul';
import {
  parseAdmbylList,
  parseInterpretationBody,
  parseInterpretationList,
  parseLicbylList,
} from './adapters/appendix-and-interpretation';

export * from './types';
export { LawApiError } from './errors';

type Params = Record<string, string | number>;

export interface FetchOptions {
  readonly retries?: number;
  readonly baseDelayMs?: number;
  readonly call?: typeof callLawApi;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(target: LawTarget, kind: LawCallKind, params: Params, opts: FetchOptions = {}) {
  const retries = opts.retries ?? 3;
  const call = opts.call ?? callLawApi;
  for (let attempt = 0; ; attempt++) {
    const r = await call(target, kind, params);
    if (r.ok) return r.json;
    const retryable = isRetryable(r.reason, r.status);
    if (!retryable || attempt >= retries) {
      throw new LawApiError(r.reason, retryable, `${target} ${kind} 실패: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`);
    }
    await sleep((opts.baseDelayMs ?? 500) * 2 ** attempt);
  }
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export async function fetchAllPages<T>(
  target: LawTarget,
  params: Params,
  parse: (json: unknown) => ListPage<T>,
  opts: FetchOptions = {},
): Promise<T[]> {
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = parse(await fetchJson(target, 'search', { ...params, display: PAGE_SIZE, page }, opts));
    total = result.totalCount;
    items.push(...result.items);
    if (items.length >= total || result.items.length === 0) break;
  }
  if (items.length !== total) {
    throw new LawApiError('invalid_json', false, `${target} 목록 수집 불일치: totalCnt ${total}, 수집 ${items.length}`);
  }
  return items;
}

export const lawApi = {
  searchLaws: (query: string, opts?: FetchOptions) =>
    fetchAllPages('eflaw', { nw: 3, search: 1, query }, parseEflawList, opts),
  lawBodyById: async (lawId: string, mst: string, opts?: FetchOptions) =>
    parseEflawBody(await fetchJson('eflaw', 'service', { ID: lawId }, opts), mst),
  lawBodyByVersion: async (mst: string, effectiveDate: string, opts?: FetchOptions) =>
    parseEflawBody(await fetchJson('eflaw', 'service', { MST: mst, efYd: effectiveDate.replaceAll('-', '') }, opts), mst),

  searchAdminRules: (query: string, opts?: FetchOptions) =>
    fetchAllPages('admrul', { nw: 1, query }, parseAdmrulList, opts),
  adminRuleBody: async (serial: string, opts?: FetchOptions) =>
    parseAdmrulBody(await fetchJson('admrul', 'service', { ID: serial }, opts)),

  searchLawAppendices: (lawName: string, opts?: FetchOptions) =>
    fetchAllPages('licbyl', { search: 2, query: lawName }, parseLicbylList, opts),
  searchAdminRuleAppendices: (query: string, opts?: FetchOptions) =>
    fetchAllPages('admbyl', { query }, parseAdmbylList, opts),

  searchInterpretations: (query: string, opts?: FetchOptions) =>
    fetchAllPages('nfaCgmExpc', { query }, parseInterpretationList, opts),
  interpretationBody: async (serial: string, opts?: FetchOptions) =>
    parseInterpretationBody(await fetchJson('nfaCgmExpc', 'service', { ID: serial }, opts)),
};
