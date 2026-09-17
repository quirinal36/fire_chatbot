/**
 * GET /api/diagnostics/law-api  (Authorization: Bearer <DIAGNOSTICS_TOKEN>)
 *
 * ISS-003 의 남은 항목: 배포 환경에서 법령 API 가 동작하는지, 송신 IP 제약이 있는지 확인한다.
 * 인증 실패 메시지가 "서버장비의 IP주소 및 도메인주소를 등록" 을 언급하므로 송신 IP 를 함께 보고한다.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { bearerToken } from '@/lib/auth';
import { jsonError, withErrors } from '@/lib/http';
import { callLawApi } from '@/lib/law-api/client';
import { log } from '@/lib/log';
import { redactSecrets } from '@/lib/redact';

export const dynamic = 'force-dynamic';

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function egressIp(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    return ((await res.json()) as { ip?: string }).ip ?? null;
  } catch {
    return null;
  }
}

export const GET = withErrors(async (req: Request) => {
  const expected = env().DIAGNOSTICS_TOKEN;
  const given = bearerToken(req);
  if (expected === undefined) return jsonError(req, 404, 'not_found', '진단 경로가 비활성화되어 있습니다.');
  if (given === null || !sameToken(given, expected)) return jsonError(req, 401, 'unauthorized', '인증이 필요합니다.');

  const [ip, eflaw, admrul] = await Promise.all([
    egressIp(),
    callLawApi('eflaw', 'search', { nw: 3, search: 1, query: '소방시설 설치 및 관리에 관한 법률', display: 1, page: 1 }),
    callLawApi('admrul', 'search', { nw: 1, query: '스프링클러설비의 화재안전성능기준', display: 1, page: 1 }),
  ]);

  const summarize = (r: typeof eflaw) =>
    r.ok ? { ok: true, ms: r.ms } : { ok: false, ms: r.ms, reason: r.reason, status: r.status, detail: r.detail };

  const result = {
    appEnv: env().appEnv,
    region: process.env.VERCEL_REGION ?? null,
    egressIp: ip,
    eflaw: summarize(eflaw),
    admrul: summarize(admrul),
  };
  log('info', 'law-api diagnostics', result);
  // detail 은 외부 응답 문자열이므로 한 번 더 가린다.
  return NextResponse.json(JSON.parse(redactSecrets(JSON.stringify(result), [env().API_AUTHKEY ?? ''])));
});
