/**
 * 비밀값 마스킹과 제거 (ISS-002 · ISS-003 발견 1).
 *
 * 법령 API 목록 응답의 `*상세링크` 필드에는 인증값 OC 가 그대로 담겨 온다.
 * - 로그로 나갈 때: redactSecrets() 로 가린다.
 * - 저장할 때: stripOcParam() 으로 파라미터 자체를 없앤다. 가린 값도 DB 에 남기지 않는다.
 */

const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/([?&]OC=)[^&"'\s]+/gi, '$1<redacted>'],
  [/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^"'\s,}]+/gi, '$1$2<redacted>'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer <redacted>'],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, 'sb_secret_<redacted>'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>'],
];

export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  // 짧은 값이 긴 값의 일부를 먼저 지우지 않도록 긴 것부터 치환한다.
  for (const secret of [...knownSecrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) out = out.split(secret).join('<redacted>');
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** URL 에서 OC 파라미터를 제거한다. 절대·상대 경로 모두 처리하고 나머지 파라미터 순서는 유지한다. */
export function stripOcParam(link: string): string {
  const hashAt = link.indexOf('#');
  const hash = hashAt >= 0 ? link.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? link.slice(0, hashAt) : link;
  const qAt = beforeHash.indexOf('?');
  if (qAt < 0) return link;

  const base = beforeHash.slice(0, qAt);
  const kept = beforeHash
    .slice(qAt + 1)
    .split('&')
    .filter((pair) => pair !== '' && pair.split('=')[0]!.toUpperCase() !== 'OC');
  return base + (kept.length ? `?${kept.join('&')}` : '') + hash;
}
