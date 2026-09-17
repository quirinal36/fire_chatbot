/**
 * target 별 어댑터가 돌려주는 공통 형태.
 * 원천마다 필드 이름과 모양이 달라도 여기서부터는 같은 구조로 다룬다 (ISS-006).
 * 링크는 모두 OC 가 제거된 값이다.
 */

export type SourceType = 'law' | 'admrul' | 'interpretation';

export interface ListPage<T> {
  readonly totalCount: number;
  readonly page: number;
  readonly items: T[];
}

export interface LawListItem {
  readonly target: 'eflaw';
  /** 법령ID — 버전과 무관한 영구 식별자 */
  readonly lawId: string;
  /** 법령일련번호(MST) — 버전 식별자 */
  readonly mst: string;
  readonly title: string;
  readonly kind: string;
  readonly effectiveDate: string | null;
  readonly promulgatedAt: string | null;
  /** 현행·시행예정·연혁 */
  readonly statusLabel: string;
  readonly detailPath: string | null;
}

export interface AdmrulListItem {
  readonly target: 'admrul';
  /** 행정규칙ID — 영구 식별자 */
  readonly ruleId: string;
  /** 행정규칙일련번호 — 버전 식별자이자 본문 조회 키 */
  readonly serial: string;
  readonly title: string;
  readonly kind: string;
  readonly issuedAt: string | null;
  readonly effectiveDate: string | null;
  readonly isCurrent: boolean;
  readonly detailPath: string | null;
}

export interface AppendixListItem {
  readonly target: 'licbyl' | 'admbyl';
  readonly serial: string;
  /** "0004" 형태의 4자리 문자열. 숫자로 바꾸지 않는다 */
  readonly number: string;
  /** 가지번호 "00" */
  readonly branch: string;
  readonly title: string;
  readonly kind: string;
  readonly relatedTitle: string;
  readonly relatedId: string;
  readonly relatedSerial: string;
  readonly fileUrl: string | null;
  readonly pdfUrl: string | null;
  readonly detailPath: string | null;
}

export interface InterpretationListItem {
  readonly target: 'nfaCgmExpc';
  readonly serial: string;
  readonly title: string;
  readonly caseNumber: string;
  readonly agency: string;
  readonly interpretedAt: string | null;
  readonly detailPath: string | null;
}

export interface RawSubitem {
  readonly number: string;
  readonly text: string;
}

export interface RawItem {
  readonly number: string;
  readonly text: string;
  readonly subitems: RawSubitem[];
}

export interface RawParagraph {
  /** 번호 없는 단일 항은 빈 문자열 */
  readonly number: string;
  readonly text: string;
  readonly items: RawItem[];
}

export interface RawArticle {
  readonly key: string;
  /** 11, 11의2 */
  readonly number: string;
  readonly title: string;
  /** 장·절 제목 줄이면 true */
  readonly isHeading: boolean;
  readonly text: string;
  readonly effectiveDate: string | null;
  readonly paragraphs: RawParagraph[];
}

export interface RawAppendix {
  readonly key: string;
  readonly number: string;
  readonly branch: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly effectiveDate: string | null;
  readonly fileUrl: string | null;
  readonly pdfUrl: string | null;
}

export interface RawAddendum {
  readonly key: string;
  readonly promulgatedAt: string | null;
  readonly number: string;
  readonly text: string;
}

export interface RawDocument {
  readonly sourceType: SourceType;
  readonly documentId: string;
  readonly versionId: string;
  readonly title: string;
  readonly kind: string;
  readonly issuer: string;
  /** NFPC 103 · NFTC 103 */
  readonly code: string | null;
  readonly effectiveDate: string | null;
  readonly promulgatedAt: string | null;
  readonly isCurrent: boolean | null;
  readonly articles: RawArticle[];
  readonly appendices: RawAppendix[];
  readonly addenda: RawAddendum[];
  readonly attachments: { readonly name: string; readonly url: string | null }[];
  readonly interpretation: {
    readonly question: string;
    readonly answer: string;
    readonly reason: string;
    readonly relatedLaw: string;
  } | null;
}
