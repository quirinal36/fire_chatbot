/**
 * 평가셋 locator 비교 (ISS-012). evals/search/README.md 의 문서 키 규칙을 따른다.
 */

const LAW_KEYS: Record<string, string> = {
  '소방시설 설치 및 관리에 관한 법률': '법',
  '소방시설 설치 및 관리에 관한 법률 시행령': '영',
  '소방시설 설치 및 관리에 관한 법률 시행규칙': '규칙',
  '다중이용업소의 안전관리에 관한 특별법': '다중법',
  '다중이용업소의 안전관리에 관한 특별법 시행령': '다중령',
  '다중이용업소의 안전관리에 관한 특별법 시행규칙': '다중규칙',
};

export function docKeyOf(e: { sourceType: string; documentTitle: string; code: string | null; documentId?: string; sourceDocumentId?: string }): string {
  if (e.code) return e.code;
  if (e.sourceType === 'interpretation') return `해석:${e.sourceDocumentId ?? ''}`;
  return LAW_KEYS[e.documentTitle] ?? e.documentTitle;
}

/** 기대 locator 와 같거나 그 하위 항목이면 맞은 것으로 본다 */
export function locatorWithin(expected: string, actual: string): boolean {
  if (actual === expected) return true;
  if (!actual.startsWith(expected)) return false;
  const next = actual.slice(expected.length);
  // 제7조 ↔ 제7조의2 처럼 다른 조문을 하위로 오인하지 않는다
  return /^(\.|\/|제\d|[가-힣]목|$)/u.test(next) && !/^의\d/u.test(next);
}

export function matchesExpected(expected: string, got: { doc: string; locator: string }): boolean {
  // 해석:2658183/회답
  if (expected.startsWith('해석:')) {
    const [doc, locator] = expected.split('/');
    return got.doc === doc && got.locator === locator;
  }
  const i = expected.indexOf(':');
  const doc = expected.slice(0, i);
  const locator = expected.slice(i + 1);
  return got.doc === doc && locatorWithin(locator, got.locator);
}
