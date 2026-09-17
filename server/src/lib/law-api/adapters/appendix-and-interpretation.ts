/**
 * 별표 목록(licbyl · admbyl)과 소방청 해석(nfaCgmExpc) 어댑터.
 * 별표 검색은 search=2 가 없으면 법령명으로 찾지 못하고 조용히 totalCnt 0 을 돌려준다.
 */
import { z } from 'zod';
import { asArray, optStr, parseYmd, resolveOfficialUrl, safeLink, str } from '../shape';
import type { AppendixListItem, InterpretationListItem, ListPage, RawDocument } from '../types';

const licItem = z.object({
  별표일련번호: z.string(),
  별표번호: z.string(),
  별표명: str,
  별표종류: str,
  관련법령명: str,
  관련법령ID: str,
  관련법령일련번호: str,
  별표서식파일링크: optStr,
  별표서식PDF파일링크: optStr,
  별표법령상세링크: optStr,
});

const admItem = z.object({
  별표일련번호: z.string(),
  별표번호: z.string(),
  별표명: str,
  별표종류: str,
  관련행정규칙명: str,
  관련법령ID: str,
  관련행정규칙일련번호: str,
  별표서식파일링크: optStr,
  별표행정규칙상세링크: optStr,
});

/**
 * 별표 목록의 별표번호는 6자리(번호 4 + 가지번호 2, 예: "000400")로 온다.
 * 본문 응답은 4자리 번호와 가지번호를 따로 준다. 본문 쪽 형태로 맞춘다.
 */
export function splitAppendixNumber(raw: string): { number: string; branch: string } {
  const v = raw.trim();
  return /^\d{6}$/.test(v) ? { number: v.slice(0, 4), branch: v.slice(4) } : { number: v, branch: '00' };
}

const page = z.coerce.number().int().positive();
const total = z.coerce.number().int().nonnegative();

export function parseLicbylList(json: unknown): ListPage<AppendixListItem> {
  const root = z
    .object({ licBylSearch: z.object({ totalCnt: total, page, licbyl: z.union([licItem, z.array(licItem)]).optional() }) })
    .parse(json).licBylSearch;
  return {
    totalCount: root.totalCnt,
    page: root.page,
    items: asArray(root.licbyl).map((b) => ({
      target: 'licbyl',
      serial: b.별표일련번호,
      ...splitAppendixNumber(b.별표번호),
      title: b.별표명,
      kind: b.별표종류,
      relatedTitle: b.관련법령명,
      relatedId: b.관련법령ID,
      relatedSerial: b.관련법령일련번호,
      fileUrl: resolveOfficialUrl(b.별표서식파일링크),
      pdfUrl: resolveOfficialUrl(b.별표서식PDF파일링크),
      detailPath: safeLink(b.별표법령상세링크),
    })),
  };
}

export function parseAdmbylList(json: unknown): ListPage<AppendixListItem> {
  // 행정규칙 별표 목록은 resultCode 를 주지 않는다. 봉투 검사는 client 가 맡는다.
  const root = z
    .object({ admRulBylSearch: z.object({ totalCnt: total, page, admrulbyl: z.union([admItem, z.array(admItem)]).optional() }) })
    .parse(json).admRulBylSearch;
  return {
    totalCount: root.totalCnt,
    page: root.page,
    items: asArray(root.admrulbyl).map((b) => ({
      target: 'admbyl',
      serial: b.별표일련번호,
      ...splitAppendixNumber(b.별표번호),
      title: b.별표명,
      kind: b.별표종류,
      relatedTitle: b.관련행정규칙명,
      relatedId: b.관련법령ID,
      relatedSerial: b.관련행정규칙일련번호,
      fileUrl: resolveOfficialUrl(b.별표서식파일링크),
      pdfUrl: null,
      detailPath: safeLink(b.별표행정규칙상세링크),
    })),
  };
}

const expcItem = z.object({
  법령해석일련번호: z.string(),
  안건명: str,
  안건번호: str,
  해석기관명: str,
  해석일자: optStr,
  법령해석상세링크: optStr,
});

export function parseInterpretationList(json: unknown): ListPage<InterpretationListItem> {
  const root = z
    .object({ CgmExpc: z.object({ totalCnt: total, page, cgmExpc: z.union([expcItem, z.array(expcItem)]).optional() }) })
    .parse(json).CgmExpc;
  return {
    totalCount: root.totalCnt,
    page: root.page,
    items: asArray(root.cgmExpc).map((e) => ({
      target: 'nfaCgmExpc',
      serial: e.법령해석일련번호,
      title: e.안건명,
      caseNumber: e.안건번호,
      agency: e.해석기관명,
      interpretedAt: parseYmd(e.해석일자),
      detailPath: safeLink(e.법령해석상세링크),
    })),
  };
}

const expcBody = z.object({
  CgmExpcService: z.object({
    법령해석일련번호: z.string(),
    안건명: str,
    질의요지: str,
    회답: str,
    이유: str,
    관련법령: str,
    해석기관명: str,
    해석일자: optStr,
    등록일시: optStr,
  }),
});

export function parseInterpretationBody(json: unknown): RawDocument {
  const e = expcBody.parse(json).CgmExpcService;
  // 해석일자가 비어 오는 경우가 있어 등록일시로 보완한다 (fixture 확인)
  const date = parseYmd(e.해석일자) ?? parseYmd(e.등록일시?.slice(0, 8));
  return {
    sourceType: 'interpretation',
    documentId: e.법령해석일련번호,
    // 해석은 개정되지 않는다. 본문 hash 로 revision 을 구분하므로 일련번호를 그대로 쓴다.
    versionId: e.법령해석일련번호,
    title: e.안건명,
    kind: '법령해석',
    issuer: e.해석기관명,
    code: null,
    effectiveDate: date,
    promulgatedAt: date,
    isCurrent: true,
    articles: [],
    appendices: [],
    addenda: [],
    attachments: [],
    interpretation: { question: e.질의요지, answer: e.회답, reason: e.이유, relatedLaw: e.관련법령 },
  };
}
