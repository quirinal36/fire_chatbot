/**
 * 법령 API 호출과 공통 계약 검증 (기획서 §4.3 · docs/law-api-poc.md).
 *
 * HTTP 200 만으로 성공이라고 보지 않는다. 인증 실패도 200 + `{result, msg}` 로 온다.
 * target 별 응답 형태 차이는 ISS-006 어댑터가 맡는다. 여기서는 공통 봉투만 검사한다.
 */
import { requireKey } from '../env';

const BASE = 'https://www.law.go.kr/DRF';

export type LawTarget = 'eflaw' | 'admrul' | 'licbyl' | 'admbyl' | 'nfaCgmExpc';
export type LawCallKind = 'search' | 'service';

export type LawFailure =
  | 'http_error'
  | 'html_body'
  | 'not_json'
  | 'invalid_json'
  | 'api_error'
  | 'result_code'
  | 'network';

export type LawCallResult =
  | { ok: true; status: number; ms: number; json: Record<string, unknown> }
  | { ok: false; reason: LawFailure; status?: number; ms: number; detail?: string };

export function classifyLawResponse(
  status: number,
  contentType: string,
  body: string,
  kind: LawCallKind,
): { ok: true; json: Record<string, unknown> } | { ok: false; reason: LawFailure; detail?: string } {
  if (status < 200 || status >= 300) return { ok: false, reason: 'http_error' };
  if (/^\s*<(!doctype|html)/i.test(body)) return { ok: false, reason: 'html_body' };
  if (!contentType.includes('json')) return { ok: false, reason: 'not_json', detail: contentType };

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (json === null || typeof json !== 'object') return { ok: false, reason: 'invalid_json' };

  const obj = json as Record<string, unknown>;
  // msg 에는 서버 IP·도메인 등록 안내가 들어 있어 원인 판단에 필요하다. 인증값은 담기지 않는다.
  if ('result' in obj && 'msg' in obj) return { ok: false, reason: 'api_error', detail: String(obj.msg) };

  if (kind === 'search') {
    const root = Object.values(obj)[0] as Record<string, unknown> | undefined;
    if (root === undefined || typeof root !== 'object') return { ok: false, reason: 'invalid_json' };
    // 행정규칙 별표 목록(admbyl)은 resultCode 를 주지 않는다. 있을 때만 검사한다.
    if ('resultCode' in root && root.resultCode !== '00') {
      return { ok: false, reason: 'result_code', detail: String(root.resultCode) };
    }
    if (!('totalCnt' in root)) return { ok: false, reason: 'invalid_json', detail: 'totalCnt 없음' };
  }
  if (kind === 'service' && Object.keys(obj).length === 0) return { ok: false, reason: 'invalid_json', detail: '빈 본문' };
  return { ok: true, json: obj };
}

export async function callLawApi(
  target: LawTarget,
  kind: LawCallKind,
  params: Record<string, string | number>,
  timeoutMs = 10_000,
): Promise<LawCallResult> {
  const url = new URL(`${BASE}/${kind === 'search' ? 'lawSearch' : 'lawService'}.do`);
  url.searchParams.set('OC', requireKey('API_AUTHKEY'));
  url.searchParams.set('target', target);
  url.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'fire-chatbot-server/0.1' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const body = await res.text();
    const verdict = classifyLawResponse(res.status, res.headers.get('content-type') ?? '', body, kind);
    const ms = Date.now() - t0;
    return verdict.ok ? { ok: true, status: res.status, ms, json: verdict.json } : { ...verdict, status: res.status, ms };
  } catch (err) {
    // 오류 메시지에 URL(OC 포함)이 들어갈 수 있으므로 이름만 남긴다.
    return { ok: false, reason: 'network', ms: Date.now() - t0, detail: err instanceof Error ? err.name : 'unknown' };
  }
}
