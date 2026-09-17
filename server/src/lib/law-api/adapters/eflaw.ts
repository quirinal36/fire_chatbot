/**
 * 법령(eflaw) 어댑터. 현행 구분값 nw=3, 루트 키 LawSearch / 법령.
 */
import { z } from 'zod';
import { asArray, flattenText, optStr, parseYmd, safeLink, resolveOfficialUrl, str, textLike } from '../shape';
import type { LawListItem, ListPage, RawAppendix, RawArticle, RawDocument, RawItem, RawParagraph } from '../types';

const listItem = z.object({
  법령ID: z.string(),
  법령일련번호: z.string(),
  법령명한글: z.string(),
  법령구분명: str,
  시행일자: optStr,
  공포일자: optStr,
  현행연혁코드: str,
  법령상세링크: optStr,
});

const listSchema = z.object({
  LawSearch: z.object({
    totalCnt: z.coerce.number().int().nonnegative(),
    page: z.coerce.number().int().positive(),
    law: z.union([listItem, z.array(listItem)]).optional(),
  }),
});

export function parseEflawList(json: unknown): ListPage<LawListItem> {
  const root = listSchema.parse(json).LawSearch;
  return {
    totalCount: root.totalCnt,
    page: root.page,
    items: asArray(root.law).map((l) => ({
      target: 'eflaw',
      lawId: l.법령ID,
      mst: l.법령일련번호,
      title: l.법령명한글,
      kind: l.법령구분명,
      effectiveDate: parseYmd(l.시행일자),
      promulgatedAt: parseYmd(l.공포일자),
      statusLabel: l.현행연혁코드,
      detailPath: safeLink(l.법령상세링크),
    })),
  };
}

const subitem = z.object({ 목번호: str, 목내용: textLike.optional() });
const item = z.object({ 호번호: str, 호내용: textLike.optional(), 목: z.union([subitem, z.array(subitem)]).optional() });
const paragraph = z.object({
  항번호: optStr,
  항내용: textLike.optional(),
  호: z.union([item, z.array(item)]).optional(),
});
const article = z.object({
  조문키: z.string(),
  조문번호: z.string(),
  조문가지번호: optStr,
  조문여부: str,
  조문제목: str,
  조문내용: textLike.optional(),
  조문시행일자: optStr,
  항: z.union([paragraph, z.array(paragraph)]).optional(),
});
const appendix = z.object({
  별표키: z.string(),
  별표번호: z.string(),
  별표가지번호: str,
  별표구분: str,
  별표제목: str,
  별표내용: textLike.optional(),
  별표시행일자: optStr,
  별표서식파일링크: optStr,
  별표서식PDF파일링크: optStr,
});
const addendum = z.object({
  부칙키: z.string(),
  부칙공포일자: optStr,
  부칙공포번호: optStr,
  부칙내용: textLike.optional(),
});
const labeled = z.union([z.string(), z.object({ content: z.string() })]);

const bodySchema = z.object({
  법령: z.object({
    기본정보: z.object({
      법령ID: z.string(),
      법령명_한글: z.string(),
      시행일자: optStr,
      공포일자: optStr,
      공포번호: optStr,
      법종구분: labeled.optional(),
      소관부처: labeled.optional(),
    }),
    조문: z.object({ 조문단위: z.union([article, z.array(article)]).optional() }).optional(),
    별표: z.object({ 별표단위: z.union([appendix, z.array(appendix)]).optional() }).optional(),
    부칙: z.object({ 부칙단위: z.union([addendum, z.array(addendum)]).optional() }).optional(),
  }),
});

const labelText = (v: z.infer<typeof labeled> | undefined) => (v === undefined ? '' : typeof v === 'string' ? v : v.content);

function toParagraphs(raw: z.infer<typeof article>['항']): RawParagraph[] {
  return asArray(raw).map((p) => ({
    number: p.항번호?.trim() ?? '',
    text: flattenText(p.항내용),
    items: asArray(p.호).map(
      (h): RawItem => ({
        number: h.호번호.trim(),
        text: flattenText(h.호내용),
        subitems: asArray(h.목).map((m) => ({ number: m.목번호.trim(), text: flattenText(m.목내용) })),
      }),
    ),
  }));
}

/**
 * @param mst 본문 응답에는 법령일련번호가 없다. 호출에 쓴 MST 를 넘겨 버전을 식별한다.
 *            ID 로 조회한 경우 목록의 법령일련번호를 넘긴다.
 */
export function parseEflawBody(json: unknown, mst: string): RawDocument {
  const law = bodySchema.parse(json).법령;
  const info = law.기본정보;

  const articles: RawArticle[] = asArray(law.조문?.조문단위).map((a) => ({
    key: a.조문키,
    numbering: 'article',
    number: a.조문가지번호 && a.조문가지번호 !== '0' ? `${a.조문번호}의${a.조문가지번호}` : a.조문번호,
    title: a.조문제목,
    isHeading: a.조문여부 !== '조문',
    text: flattenText(a.조문내용),
    effectiveDate: parseYmd(a.조문시행일자),
    paragraphs: toParagraphs(a.항),
  }));

  const appendices: RawAppendix[] = asArray(law.별표?.별표단위).map((b) => ({
    key: b.별표키,
    number: b.별표번호,
    branch: b.별표가지번호,
    kind: b.별표구분 || '별표',
    title: b.별표제목,
    text: flattenText(b.별표내용),
    effectiveDate: parseYmd(b.별표시행일자),
    fileUrl: resolveOfficialUrl(b.별표서식파일링크),
    pdfUrl: resolveOfficialUrl(b.별표서식PDF파일링크),
  }));

  return {
    sourceType: 'law',
    documentId: info.법령ID,
    versionId: mst,
    title: info.법령명_한글,
    kind: labelText(info.법종구분),
    issuer: labelText(info.소관부처),
    code: null,
    effectiveDate: parseYmd(info.시행일자),
    promulgatedAt: parseYmd(info.공포일자),
    isCurrent: null,
    articles,
    appendices,
    addenda: asArray(law.부칙?.부칙단위).map((b) => ({
      key: b.부칙키,
      promulgatedAt: parseYmd(b.부칙공포일자),
      number: b.부칙공포번호 ?? '',
      text: flattenText(b.부칙내용),
    })),
    attachments: [],
    interpretation: null,
  };
}
