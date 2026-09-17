/**
 * 수집 대상 목록 (ISS-001 · ISS-007 · 기획서 §4.1).
 *
 * 검색어는 최초 발견용이다. 결과는 정확한 제목으로만 고르고, 고른 문서의 영구 ID 를 여기 고정한다.
 * 영구 ID 가 있으면 제목이 바뀌어도 같은 문서로 추적한다.
 *
 * 최초 지원 시설은 교육서비스 학원(근린생활시설 규모)이다. 화재안전기준은 그 판단에 필요한 설비부터 넣는다.
 */

export interface LawEntry {
  readonly sourceType: 'law';
  readonly title: string;
  /** 법령ID. 2026-09-18 조회 */
  readonly lawId: string;
  readonly priority: 'P0' | 'P1';
  /** 반드시 있어야 하는 별표 번호 */
  readonly requiredAppendices?: readonly number[];
}

export interface AdminRuleEntry {
  readonly sourceType: 'admrul';
  readonly code: string;
  /** 행정규칙ID. 2026-09-18 조회 */
  readonly ruleId: string;
  readonly priority: 'P0' | 'P1';
}

export interface InterpretationEntry {
  readonly sourceType: 'interpretation';
  /** 법령해석일련번호 */
  readonly serial: string;
  readonly reason: string;
  readonly priority: 'P0' | 'P1';
}

export type CatalogEntry = LawEntry | AdminRuleEntry | InterpretationEntry;

export const CATALOG: readonly CatalogEntry[] = [
  { sourceType: 'law', title: '소방시설 설치 및 관리에 관한 법률', lawId: '009503', priority: 'P0' },
  {
    sourceType: 'law',
    title: '소방시설 설치 및 관리에 관한 법률 시행령',
    lawId: '009694',
    priority: 'P0',
    // 별표 2 특정소방대상물, 별표 4 소방시설의 종류, 별표 5 면제 기준, 별표 7 수용인원 산정
    requiredAppendices: [2, 4, 5, 7],
  },
  { sourceType: 'law', title: '소방시설 설치 및 관리에 관한 법률 시행규칙', lawId: '009730', priority: 'P0' },
  { sourceType: 'law', title: '다중이용업소의 안전관리에 관한 특별법', lawId: '010235', priority: 'P0' },
  { sourceType: 'law', title: '다중이용업소의 안전관리에 관한 특별법 시행령', lawId: '010409', priority: 'P0', requiredAppendices: [1] },
  { sourceType: 'law', title: '다중이용업소의 안전관리에 관한 특별법 시행규칙', lawId: '010407', priority: 'P0' },

  ...(
    [
      ['NFPC 101', '31168'], ['NFTC 101', '83614'],
      ['NFPC 102', '31179'], ['NFTC 102', '83615'],
      ['NFPC 103', '35312'], ['NFTC 103', '83616'],
      ['NFPC 103A', '31177'], ['NFTC 103A', '83617'],
      ['NFPC 201', '31198'], ['NFTC 201', '83628'],
      ['NFPC 203', '33628'], ['NFTC 203', '83630'],
      ['NFPC 204', '35318'], ['NFTC 204', '83631'],
      ['NFPC 301', '31193'], ['NFTC 301', '83634'],
      ['NFPC 303', '35319'], ['NFTC 303', '83636'],
      ['NFPC 304', '31190'], ['NFTC 304', '83637'],
    ] as const
  ).map(([code, ruleId]): AdminRuleEntry => ({ sourceType: 'admrul', code, ruleId, priority: 'P0' })),

  { sourceType: 'interpretation', serial: '2657063', reason: '근린생활시설 옥내소화전 설치 대상 판단', priority: 'P1' },
  { sourceType: 'interpretation', serial: '2658183', reason: '근린생활시설 시각경보기 설치 대상 판단', priority: 'P1' },
];

export function entryLabel(e: CatalogEntry): string {
  return e.sourceType === 'law' ? e.title : e.sourceType === 'admrul' ? e.code : `해석 ${e.serial}`;
}
