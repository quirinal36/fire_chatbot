/**
 * 별표·첨부 파일 내려받기 (ISS-007 · 기획서 §4.4).
 * 공식 호스트만, 정해진 크기 이하, PDF·HWP 만 받는다.
 */
import { resolveOfficialUrl } from '../law-api/shape';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type AttachmentResult =
  | { ok: true; bytes: Uint8Array; contentType: string; extension: 'pdf' | 'hwp' }
  | { ok: false; reason: string };

export function sniffType(bytes: Uint8Array): 'pdf' | 'hwp' | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // HWP 5.0 은 OLE 복합 문서 (D0 CF 11 E0)
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'hwp';
  return null;
}

export async function downloadAttachment(link: string, fetchImpl: typeof fetch = fetch): Promise<AttachmentResult> {
  const url = resolveOfficialUrl(link);
  if (url === null) return { ok: false, reason: '허용되지 않은 호스트' };

  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return { ok: false, reason: `네트워크 오류: ${err instanceof Error ? err.name : 'unknown'}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  // 리다이렉트로 다른 호스트에 가면 받지 않는다
  if (resolveOfficialUrl(res.url || url) === null) return { ok: false, reason: '리다이렉트 호스트 불허' };

  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_ATTACHMENT_BYTES) return { ok: false, reason: `크기 초과 (${declared})` };

  const reader = res.body?.getReader();
  if (!reader) return { ok: false, reason: '본문 없음' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      return { ok: false, reason: '크기 초과' };
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const kind = sniffType(bytes);
  if (kind === null) return { ok: false, reason: `허용되지 않은 형식 (${res.headers.get('content-type') ?? '알 수 없음'})` };
  return { ok: true, bytes, contentType: kind === 'pdf' ? 'application/pdf' : 'application/x-hwp', extension: kind };
}
