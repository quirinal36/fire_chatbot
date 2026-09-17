/**
 * 질의 해석 (ISS-010 · 기획서 §6.1 1단계).
 * 정확한 법령명·NFPC/NFTC 코드·조항 번호를 먼저 뽑고, 나머지는 키워드로 쓴다.
 */

export interface QueryAnalysis {
  readonly codes: string[];
  readonly titleTerms: string[];
  readonly locators: string[];
  readonly terms: string[];
  /** 신축·용도변경 같은 사건을 말했는데 날짜가 없다 */
  readonly eventWithoutDate: boolean;
  readonly explicitDate: string | null;
}

const LAW_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/소방시설\s*법\s*시행령|소방시설법\s*시행령/u, '소방시설 설치 및 관리에 관한 법률 시행령'],
  [/소방시설\s*법\s*시행규칙|소방시설법\s*시행규칙/u, '소방시설 설치 및 관리에 관한 법률 시행규칙'],
  [/소방시설\s*법(?!\s*시행)|소방시설\s*설치\s*및\s*관리에\s*관한\s*법률(?!\s*시행)/u, '소방시설 설치 및 관리에 관한 법률'],
  [/다중이용업소\s*법\s*시행령|다중이용업소법\s*시행령/u, '다중이용업소의 안전관리에 관한 특별법 시행령'],
  [/다중이용업소\s*법\s*시행규칙|다중이용업소법\s*시행규칙/u, '다중이용업소의 안전관리에 관한 특별법 시행규칙'],
  [/다중이용업소\s*법(?!\s*시행)|다중이용업소의\s*안전관리에\s*관한\s*특별법(?!\s*시행)/u, '다중이용업소의 안전관리에 관한 특별법'],
];

// 뒤에 붙는 조사·어미. 긴 것부터 지운다
const SUFFIXES = [
  '에서는', '에서도', '으로는', '이라도', '해야하나요', '해야하나', '해야', '인가요', '인지요', '입니까', '나요', '까요',
  '에서', '으로', '에는', '에도', '부터', '까지', '이란', '이면', '라면', '인데', '하고', '하는', '되는', '에게', '한테',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만', '요',
];
const STOPWORDS = new Set([
  '무엇', '어떤', '어떻게', '어디', '언제', '얼마', '경우', '관련', '대한', '대해', '있나', '있는', '없는', '알려', '주세요',
  '설치해야', '하나', '해당', '되나', '그리고', '또는', '저희', '우리', '제가', '궁금', '질문', '문의', '기준', '법령',
]);

const EVENT = /(신축|증축|개축|재축|이전|용도\s*변경|대수선|건축\s*허가|사용\s*승인|착공|완공|개업|영업\s*신고)/u;
const DATE = /(\d{4})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})\s*일?/u;

export function stripSuffix(token: string): string {
  for (const s of SUFFIXES) {
    if (token.length > s.length + 1 && token.endsWith(s)) return token.slice(0, -s.length);
  }
  return token;
}

export function analyzeQuery(question: string): QueryAnalysis {
  const q = question.normalize('NFC');

  const codes = [...q.matchAll(/NF\s*([PT])\s*C\s*(\d{3}[A-Z]?)/giu)].map((m) => `NF${m[1]!.toUpperCase()}C ${m[2]!.toUpperCase()}`);

  const titleTerms = LAW_ALIASES.filter(([re]) => re.test(q)).map(([, title]) => title);

  const locators: string[] = [];
  for (const m of q.matchAll(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/gu)) {
    let loc = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`;
    if (m[3]) loc += `제${m[3]}항`;
    if (m[4]) loc += `제${m[4]}호`;
    locators.push(loc);
  }
  for (const m of q.matchAll(/별표\s*(\d+)(?:\s*의\s*(\d+))?/gu)) locators.push(`별표${m[1]}${m[2] ? `의${m[2]}` : ''}`);

  const cleaned = q
    .replace(/NF\s*[PT]\s*C\s*\d{3}[A-Z]?/giu, ' ')
    .replace(/제\s*\d+\s*조(의\s*\d+)?(\s*제\s*\d+\s*[항호])*/gu, ' ')
    .replace(/별표\s*\d+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const terms = [
    ...new Set(
      cleaned
        .split(/\s+/u)
        .map(stripSuffix)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/u.test(t)),
    ),
  ].slice(0, 12);

  const date = DATE.exec(q);
  const explicitDate = date
    ? `${date[1]}-${date[2]!.padStart(2, '0')}-${date[3]!.padStart(2, '0')}`
    : null;

  return { codes: [...new Set(codes)], titleTerms, locators: [...new Set(locators)], terms, eventWithoutDate: EVENT.test(q) && !date, explicitDate };
}
