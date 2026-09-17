/**
 * 행정규칙(admrul) 어댑터. 현행 구분값 nw=1, 루트 키 AdmRulSearch / AdmRulService.
 * 조문이 문자열 배열이고, 별표단위가 단일 객체로 오며, 첨부는 절대 http URL 이다.
 */
import { z } from 'zod';
import { asArray, flattenText, optStr, parseYmd, resolveOfficialUrl, safeLink, str, textLike } from '../shape';
import type { AdmrulListItem, ListPage, RawArticle, RawDocument, RawParagraph } from '../types';

const listItem = z.object({
  행정규칙ID: z.string(),
  행정규칙일련번호: z.string(),
  행정규칙명: z.string(),
  행정규칙종류: str,
  발령일자: optStr,
  시행일자: optStr,
  현행연혁구분: str,
  행정규칙상세링크: optStr,
});

const listSchema = z.object({
  AdmRulSearch: z.object({
    totalCnt: z.coerce.number().int().nonnegative(),
    page: z.coerce.number().int().positive(),
    admrul: z.union([listItem, z.array(listItem)]).optional(),
  }),
});

export function parseAdmrulList(json: unknown): ListPage<AdmrulListItem> {
  const root = listSchema.parse(json).AdmRulSearch;
  return {
    totalCount: root.totalCnt,
    page: root.page,
    items: asArray(root.admrul).map((r) => ({
      target: 'admrul',
      ruleId: r.행정규칙ID,
      serial: r.행정규칙일련번호,
      title: r.행정규칙명,
      kind: r.행정규칙종류,
      issuedAt: parseYmd(r.발령일자),
      effectiveDate: parseYmd(r.시행일자),
      isCurrent: r.현행연혁구분 === '현행',
      detailPath: safeLink(r.행정규칙상세링크),
    })),
  };
}

const appendix = z.object({
  별표키: z.string(),
  별표번호: z.string(),
  별표가지번호: str,
  별표구분: str,
  별표제목: str,
  별표내용: textLike.optional(),
  별표서식파일링크: optStr,
  별표서식PDF파일링크: optStr,
});
const parallel = z.union([z.string(), z.array(z.string())]);

const bodySchema = z.object({
  AdmRulService: z.object({
    행정규칙기본정보: z.object({
      행정규칙ID: z.string(),
      행정규칙일련번호: z.string(),
      행정규칙명: z.string(),
      행정규칙종류: str,
      소관부처명: str,
      발령일자: optStr,
      시행일자: optStr,
      현행여부: optStr,
    }),
    조문내용: z.union([z.string(), z.array(textLike)]).optional(),
    별표: z.object({ 별표단위: z.union([appendix, z.array(appendix)]).optional() }).optional(),
    부칙: z
      .object({ 부칙공포일자: parallel.optional(), 부칙공포번호: parallel.optional(), 부칙내용: z.array(textLike).or(z.string()).optional() })
      .optional(),
    첨부파일: z.object({ 첨부파일링크: parallel.optional(), 첨부파일명: parallel.optional() }).optional(),
  }),
});

const ARTICLE_HEAD = /^제(\d+)조(?:의(\d+))?(?:\(([^)]*)\))?\s*/u;
const CHAPTER_HEAD = /^제\d+(?:장|절|관)\s/u;
const PARAGRAPH_MARK = /(?=[①-⑳])/u;

/** "제5조(설치기준) ① ... ② ..." 형태의 문자열을 조·항으로 나눈다. 호 이하는 ISS-008 정규화가 맡는다. */
export function splitAdmrulArticle(raw: string, index: number): RawArticle {
  const text = raw.trim();
  const head = ARTICLE_HEAD.exec(text);
  if (!head) {
    return {
      key: `h${index}`,
      number: '',
      title: '',
      isHeading: CHAPTER_HEAD.test(text) || text.length < 40,
      text,
      effectiveDate: null,
      paragraphs: [],
    };
  }
  const [whole, num, branch, title] = head;
  const bodyText = text.slice(whole.length);
  const parts = bodyText.split(PARAGRAPH_MARK).map((s) => s.trim()).filter(Boolean);
  const numbered = parts.filter((p) => /^[①-⑳]/u.test(p));
  const paragraphs: RawParagraph[] =
    numbered.length > 1
      ? numbered.map((p) => ({ number: p[0]!, text: p, items: [] }))
      : [];
  return {
    key: `a${index}`,
    number: branch ? `${num}의${branch}` : num!,
    title: title ?? '',
    isHeading: false,
    // 항으로 나눈 경우 조 본문에는 첫 항 앞의 문장만 남긴다
    text: paragraphs.length ? (parts[0] && !/^[①-⑳]/u.test(parts[0]) ? `${whole}${parts[0]}`.trim() : whole.trim()) : text,
    effectiveDate: null,
    paragraphs,
  };
}

/** "간이스프링클러설비의 화재안전성능기준(NFPC 103A)" → "NFPC 103A" */
export function extractCode(title: string): string | null {
  const m = /\((NF[PT]C\s*[0-9A-Z.\-]+)\)/u.exec(title);
  return m ? m[1]!.replace(/\s+/g, ' ') : null;
}

export function parseAdmrulBody(json: unknown): RawDocument {
  const svc = bodySchema.parse(json).AdmRulService;
  const info = svc.행정규칙기본정보;
  const lines = asArray(svc.조문내용).map((l) => flattenText(l));

  const dates = asArray(svc.부칙?.부칙공포일자);
  const numbers = asArray(svc.부칙?.부칙공포번호);
  const bodies = asArray(svc.부칙?.부칙내용);
  const names = asArray(svc.첨부파일?.첨부파일명);
  const links = asArray(svc.첨부파일?.첨부파일링크);

  return {
    sourceType: 'admrul',
    documentId: info.행정규칙ID,
    versionId: info.행정규칙일련번호,
    title: info.행정규칙명,
    kind: info.행정규칙종류,
    issuer: info.소관부처명,
    code: extractCode(info.행정규칙명),
    effectiveDate: parseYmd(info.시행일자),
    promulgatedAt: parseYmd(info.발령일자),
    isCurrent: info.현행여부 === undefined ? null : info.현행여부 === 'Y',
    articles: lines.map(splitAdmrulArticle),
    appendices: asArray(svc.별표?.별표단위).map((b) => ({
      key: b.별표키,
      number: b.별표번호,
      branch: b.별표가지번호,
      kind: b.별표구분 || '별표',
      title: b.별표제목,
      text: flattenText(b.별표내용),
      effectiveDate: null,
      fileUrl: resolveOfficialUrl(b.별표서식파일링크),
      pdfUrl: resolveOfficialUrl(b.별표서식PDF파일링크),
    })),
    addenda: bodies.map((body, i) => ({
      key: `addendum-${i}`,
      promulgatedAt: parseYmd(dates[i]),
      number: numbers[i] ?? '',
      text: flattenText(body),
    })),
    attachments: names.map((name, i) => ({ name, url: resolveOfficialUrl(links[i]) })),
    interpretation: null,
  };
}
