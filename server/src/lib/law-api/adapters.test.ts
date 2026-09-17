import { describe, expect, it, vi } from 'vitest';
import { fixture, fixtureText } from '@/test/fixtures';
import { parseEflawBody, parseEflawList } from './adapters/eflaw';
import { extractCode, parseAdmrulBody, parseAdmrulList, splitAdmrulArticle, splitDecimalSections } from './adapters/admrul';
import {
  parseAdmbylList,
  parseInterpretationBody,
  parseInterpretationList,
  parseLicbylList,
} from './adapters/appendix-and-interpretation';
import { fetchAllPages, fetchJson, LawApiError } from './index';
import { asArray, flattenText, parseYmd, resolveOfficialUrl } from './shape';
import type { LawCallResult } from './client';

const noOc = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/[?&]OC=/i);

describe('shape', () => {
  it('단일 객체와 배열을 같은 배열로 만든다', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
  it('문자열·줄 배열·배열의 배열을 한 본문으로 합친다', () => {
    expect(flattenText('a  \nb')).toBe('a\nb');
    expect(flattenText([['가. x   ', '  1) y']])).toBe('가. x\n  1) y');
  });
  it('YYYYMMDD 만 날짜로 받는다', () => {
    expect(parseYmd('20260701')).toBe('2026-07-01');
    expect(parseYmd('')).toBeNull();
    expect(parseYmd('20260231')).toBeNull();
  });
  it('공식 호스트 밖 링크를 막고 http 를 https 로 올린다', () => {
    expect(resolveOfficialUrl('/LSW/flDownload.do?flSeq=1')).toBe('https://www.law.go.kr/LSW/flDownload.do?flSeq=1');
    expect(resolveOfficialUrl('http://www.law.go.kr/x.do?OC=k&a=1')).toBe('https://www.law.go.kr/x.do?a=1');
    expect(resolveOfficialUrl('https://evil.example/x')).toBeNull();
  });
});

describe('eflaw', () => {
  it('목록에서 법령ID·MST·시행일을 구분하고 OC 를 제거한다', () => {
    const page = parseEflawList(fixture('search-eflaw-list.json'));
    expect(page.totalCount).toBe(page.items.length);
    const decree = page.items.find((i) => i.title.endsWith('시행령'))!;
    expect(decree.lawId).toBe('009694');
    expect(decree.mst).not.toBe(decree.lawId);
    expect(decree.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    noOc(page);
  });

  it('본문의 조·항·호·목 형태 차이를 정규화한다', () => {
    const doc = parseEflawBody(fixture('service-eflaw-body.json'), '287375');
    expect(doc.documentId).toBe('009694');
    expect(doc.versionId).toBe('287375');
    expect(doc.effectiveDate).toBe('2026-07-01');

    const headings = doc.articles.filter((a) => a.isHeading);
    expect(headings[0]!.text).toContain('제1장');

    // 항이 단일 객체(번호 없음)로 온 제2조
    const art2 = doc.articles.find((a) => !a.isHeading && a.number === '2')!;
    expect(art2.paragraphs).toHaveLength(1);
    expect(art2.paragraphs[0]!.number).toBe('');
    expect(art2.paragraphs[0]!.items[0]!.subitems).toHaveLength(5);

    // 항이 배열로 온 제7조, 목내용이 줄 배열로 온 경우
    const art7 = doc.articles.find((a) => !a.isHeading && a.number === '7')!;
    expect(art7.paragraphs.length).toBeGreaterThan(1);
    const nested = art7.paragraphs[0]!.items.find((i) => i.number === '7.')!.subitems[0]!;
    expect(nested.text).toContain('1) 「노인복지법」');
  });

  it('별표번호를 문자열로 보존하고 별표 4 전문을 가져온다', () => {
    const doc = parseEflawBody(fixture('service-eflaw-body.json'), '287375');
    const b4 = doc.appendices.find((b) => b.number === '0004')!;
    expect(b4.title).toContain('소방시설의 종류');
    expect(b4.text.split('\n').length).toBeGreaterThan(400);
    expect(b4.fileUrl).toMatch(/^https:\/\/www\.law\.go\.kr\/LSW\/flDownload\.do/);
    expect(doc.addenda.length).toBeGreaterThan(0);
    expect(doc.addenda[0]!.text).toContain('부칙');
  });
});

describe('admrul', () => {
  it('목록의 현행 구분과 ID/일련번호를 구분한다', () => {
    const page = parseAdmrulList(fixture('search-admrul-list.json'));
    expect(page.items.length).toBe(page.totalCount);
    for (const i of page.items) expect(i.ruleId).not.toBe(i.serial);
    noOc(page);
  });

  it('문자열 조문·단일 별표·병렬 배열 부칙·http 첨부를 처리한다', () => {
    const doc = parseAdmrulBody(fixture('service-admrul-body.json'));
    expect(doc.code).toBe('NFPC 103A');
    expect(doc.isCurrent).toBe(true);
    expect(doc.articles.length).toBe(16);
    expect(doc.articles.some((a) => a.number === '1' && a.title === '목적')).toBe(true);
    expect(doc.appendices).toHaveLength(1);
    expect(doc.addenda).toHaveLength(5);
    expect(doc.attachments).toHaveLength(2);
    for (const a of doc.attachments) expect(a.url).toMatch(/^https:\/\//);
    noOc(doc);
  });

  it('조문 문자열을 항으로 나눈다', () => {
    const a = splitAdmrulArticle('제5조(설치기준) ① 첫째 항이다. ② 둘째 항이다.', 0);
    expect(a.number).toBe('5');
    expect(a.title).toBe('설치기준');
    expect(a.paragraphs.map((p) => p.number)).toEqual(['①', '②']);
    expect(splitAdmrulArticle('제2장 설치기준', 1).isHeading).toBe(true);
    expect(splitAdmrulArticle('제3조의2(특례) 본문', 2).number).toBe('3의2');
  });

  it('제목에서 NFPC/NFTC 코드를 꺼낸다', () => {
    expect(extractCode('스프링클러설비의 화재안전기술기준(NFTC 103)')).toBe('NFTC 103');
    expect(extractCode('일반 고시')).toBeNull();
  });
});

describe('별표 목록과 해석', () => {
  it('법령 별표 목록', () => {
    const page = parseLicbylList(fixture('search-licbyl-by-lawname.json'));
    // 목록은 "000400" 6자리로 온다. 본문의 "0004" 와 같은 키로 맞춘다
    expect(page.items.find((b) => b.number === '0004')?.branch).toBe('00');
    noOc(page);
  });
  it('행정규칙 별표 목록은 resultCode 없이도 읽는다', () => {
    const page = parseAdmbylList(fixture('search-admbyl.json'));
    expect(page.items.length).toBeGreaterThan(0);
    noOc(page);
  });
  it('해석 목록과 본문. 빈 이유와 빈 해석일자를 보완 없이 드러낸다', () => {
    expect(parseInterpretationList(fixture('search-nfaCgmExpc-list.json')).items.length).toBe(5);
    const doc = parseInterpretationBody(fixture('service-nfaCgmExpc-body.json'));
    expect(doc.interpretation!.answer.length).toBeGreaterThan(0);
    expect(doc.interpretation!.reason).toBe('');
    expect(doc.effectiveDate).toBe('2026-06-15');
  });
  it('인증 오류 응답은 어떤 파서도 통과하지 못한다', () => {
    const err = fixture('error-invalid-oc.json');
    for (const parse of [parseEflawList, parseAdmrulList, parseLicbylList, parseInterpretationList]) {
      expect(() => parse(err)).toThrow();
    }
  });
});

describe('fetch 계층', () => {
  const ok = (json: unknown): LawCallResult => ({ ok: true, status: 200, ms: 1, json: json as Record<string, unknown> });

  it('인증 오류는 재시도하지 않는다', async () => {
    const call = vi.fn(async (): Promise<LawCallResult> => ({ ok: false, reason: 'api_error', status: 200, ms: 1, detail: 'x' }));
    await expect(fetchJson('eflaw', 'search', {}, { call, baseDelayMs: 0 })).rejects.toMatchObject({ retryable: false });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('일시 오류는 제한된 횟수만 재시도한다', async () => {
    const call = vi.fn(async (): Promise<LawCallResult> => ({ ok: false, reason: 'http_error', status: 503, ms: 1 }));
    await expect(fetchJson('eflaw', 'search', {}, { call, retries: 2, baseDelayMs: 0 })).rejects.toBeInstanceOf(LawApiError);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('전체 페이지를 순회하고 totalCnt 와 대조한다', async () => {
    const make = (page: number, n: number, total: number) => ({
      LawSearch: {
        resultCode: '00', totalCnt: String(total), page: String(page),
        law: Array.from({ length: n }, (_, i) => ({ 법령ID: `${page}-${i}`, 법령일련번호: `m${page}-${i}`, 법령명한글: 'x' })),
      },
    });
    const pages = [make(1, 100, 150), make(2, 50, 150)];
    const call = vi.fn(async (_t: string, _k: string, p: Record<string, string | number>) => ok(pages[Number(p.page) - 1]));
    const items = await fetchAllPages('eflaw', {}, parseEflawList, { call: call as never });
    expect(items).toHaveLength(150);

    const short = vi.fn(async (_t: string, _k: string, p: Record<string, string | number>) =>
      ok(Number(p.page) === 1 ? make(1, 100, 150) : make(2, 0, 150)),
    );
    await expect(fetchAllPages('eflaw', {}, parseEflawList, { call: short as never })).rejects.toThrow(/불일치/);
  });

  it('원본 fixture 에는 OC 자리표시만 있고 실제 키가 없다', () => {
    expect(fixtureText('search-eflaw-list.json')).toContain('OC=<OC>');
  });
});

describe('기술기준(NFTC)', () => {
  it('빈 문자열 부칙과 붙어 있는 절 번호를 처리한다', () => {
    const doc = parseAdmrulBody(fixture('service-admrul-nftc-body.json'));
    expect(doc.code).toBe('NFTC 101');
    expect(doc.addenda).toEqual([]);
    const numbers = doc.articles.map((a) => a.number);
    expect(numbers.slice(0, 4)).toEqual(['1', '1.1', '1.1.1', '1.2']);
    expect(doc.articles.every((a) => a.numbering === 'decimal')).toBe(true);
    // 본문 속 "표 2.1.1.3 제7호" 는 절 경계가 아니다
    const s131 = doc.articles.find((a) => a.number === '1.3.1')!;
    expect(s131.text).toContain('표 2.1.1.3 제7호');
    // 절 제목과 본문을 구분한다
    expect(doc.articles.find((a) => a.number === '1.1')!.title).toBe('적용범위');
    expect(doc.articles.find((a) => a.number === '1.1.1')!.text).toMatch(/^이 기준은/);
    // 번호는 앞 절보다 항상 뒤다
    for (let i = 1; i < numbers.length; i++) {
      const a = numbers[i - 1]!.split('.').map(Number);
      const b = numbers[i]!.split('.').map(Number);
      const cmp = (() => { for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return b[k]! - a[k]!; return b.length - a.length; })();
      expect(cmp).toBeGreaterThan(0);
    }
    expect(numbers).toContain('2.1.1.3');
  });

  it('번호 건너뜀·참조 번호·숫자 단위를 구별한다', () => {
    const text = '1. 일반사항1.1 적용1.1.1 가.1.1.2 표 1.3.1 참조 높이 1.5 m 이다.1.1.4 삭제 뒤 번호다.2. 기술기준2.1 설치2.1.1 본문';
    expect(splitDecimalSections(text).map((a) => a.number)).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.1.4', '2', '2.1', '2.1.1']);
  });
});
