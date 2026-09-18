/**
 * 되묻는 질문에 "답을 입력하는" 칸을 고른다 (ISS-036).
 *
 * followUpQuestions 는 사용자가 다음에 물어볼 질문이 아니라, 답변을 만들기 위해
 * 시스템이 사용자에게 되묻는 질문이다. 그래서 눌러서 그대로 보내면 안 되고
 * 답을 받아야 한다. 질문 문장만 보고 어떤 입력 칸이 맞는지 정한다.
 *
 *   "…에 해당하나요?"            → 예 / 아니오
 *   "어떤 소방시설…? (소화기, …)" → 보기 중 고르기 + 직접 입력
 *   "바닥면적은 몇 ㎡인가요?"      → 숫자 + 단위
 *   "건축허가 날짜를 알려 주세요"   → 날짜
 *   그 밖                        → 한 줄 입력 (예시를 placeholder 로)
 */

export type AnswerInput =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'choice'; readonly options: readonly string[] }
  | { readonly kind: 'number'; readonly unit: string; readonly units?: readonly string[] }
  | { readonly kind: 'date' }
  | { readonly kind: 'text'; readonly placeholder: string };

/** 묻는 말. 있으면 예·아니오로 답할 질문이 아니다 */
const WH = /어떤|어느|무엇|무슨|몇|언제|어디|누구|얼마/u;
const YES_NO = /(인가요|이신가요|입니까|있나요|없나요|하나요|되나요|맞나요|합니까|있습니까|해당하나요|이상인가요|미만인가요)\s*[?？]?\s*$/u;
const UNIT = /몇\s*(㎡|m2|제곱미터|평|층|명|개|곳|년)/gu;
const DATE = /날짜|허가일|신고일|착공일|준공일|며칠|연월일/u;

const UNIT_LABEL: Record<string, string> = { m2: '㎡', 제곱미터: '㎡' };

/** 면적 단위. 1평 = 3.3058㎡ (한 평은 400/121 제곱미터) */
export const AREA_UNITS = ['㎡ (제곱미터)', '평'] as const;
const PYEONG_TO_M2 = 400 / 121;

/**
 * 고른 단위로 답을 적는다 (ISS-037).
 * 법령 기준은 ㎡ 이므로 평으로 답하면 환산값을 함께 적는다.
 */
export function formatQuantity(value: string, unit: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || value.trim() === '') return '';
  if (unit === '평') {
    const m2 = Math.round(n * PYEONG_TO_M2 * 10) / 10;
    return `${n}평 (약 ${m2}㎡)`;
  }
  return `${n}${unit.replace(/\s*\(.*\)$/u, '')}`;
}

/** "(소화기, 자동화재탐지설비, 스프링클러 등)" 처럼 괄호 안에 나열된 보기 */
function parenOptions(question: string): string[] {
  const groups = [...question.matchAll(/[(（]([^)）]+)[)）]/gu)].map((m) => m[1]!);
  for (const g of groups) {
    if (/^예\s*[:：]/u.test(g)) continue; // 보기가 아니라 예시다
    const items = g
      .split(/[,、·]/u)
      // "피난기구 등" 의 등만 떼고 "유도등" 은 그대로 둔다
      .map((s) => s.trim().replace(/\s+등$/u, '').trim())
      .filter((s) => s.length > 0 && s.length <= 20);
    if (items.length >= 2) return items.slice(0, 6);
  }
  return [];
}

/** "A가 궁금하신가요, B가 궁금하신가요?" 처럼 문장 자체가 둘 중 하나를 묻는 경우 */
function clauseOptions(question: string): string[] {
  if (!question.includes(',') || !/궁금하신가요/u.test(question)) return [];
  const items = question
    .split(',')
    .map((s) =>
      s
        .replace(/[?？.]\s*$/u, '')
        .replace(/\s*(?:이|가|은|는)?\s*궁금하신가요\s*$/u, '')
        .trim(),
    )
    .filter((s) => s.length > 0 && s.length <= 30);
  return items.length >= 2 ? items.slice(0, 4) : [];
}

function placeholderFor(question: string): string {
  const example = /[(（]예\s*[:：]\s*([^)）]+)[)）]/u.exec(question);
  if (example) return example[1]!.trim();
  const has = (re: RegExp) => re.test(question);
  if (has(/층/u) && has(/㎡|면적/u)) return '예: 3층, 112㎡';
  if (has(/연면적|면적/u)) return '예: 112㎡';
  if (has(/수용\s*인원|인원/u)) return '예: 25명';
  if (has(/층수|층/u)) return '예: 지상 4층, 지하 1층';
  return '';
}

export function answerInput(question: string): AnswerInput {
  const q = question.trim();

  const options = parenOptions(q);
  if (options.length) return { kind: 'choice', options };
  const clauses = clauseOptions(q);
  if (clauses.length) return { kind: 'choice', options: clauses };

  if (DATE.test(q)) return { kind: 'date' };

  const units = [...q.matchAll(UNIT)].map((m) => m[1]!);
  const unique = [...new Set(units)];
  // 한 가지 단위만 물으면 숫자 칸으로 받는다. 둘 이상이면 한 줄로 받는다
  if (unique.length === 1) {
    const unit = UNIT_LABEL[unique[0]!] ?? unique[0]!;
    // ㎡ 는 손으로 입력하기 어렵다. 평으로도 답할 수 있게 고르는 칸을 준다 (ISS-037)
    return unit === '㎡' ? { kind: 'number', unit, units: AREA_UNITS } : { kind: 'number', unit };
  }

  if (unique.length === 0 && YES_NO.test(q) && !WH.test(q)) return { kind: 'boolean' };

  return { kind: 'text', placeholder: placeholderFor(q) };
}

/**
 * 화면에 보일 질문 문장.
 * 괄호 안의 보기·예시는 입력 칸이 대신 보여 주므로 문장에서 뺀다.
 */
export function questionLabel(question: string): string {
  const q = question.trim();
  const dropped = q.replace(/\s*[(（]([^)）]+)[)）]/gu, (whole, inner: string) => {
    if (/^예\s*[:：]/u.test(inner.trim())) return '';
    const items = inner.split(/[,、·]/u).filter((x) => x.trim() !== '');
    return items.length >= 2 ? '' : whole;
  });
  const cleaned = dropped.replace(/\s{2,}/gu, ' ').trim();
  return cleaned === '' ? q : cleaned;
}

/** 답한 것만 모아 한 번에 보낸다. 질문을 함께 적어야 무엇에 대한 답인지 남는다 */
export function composeAnswers(pairs: readonly { question: string; answer: string }[]): string {
  return pairs
    .filter((p) => p.answer.trim() !== '')
    .map((p) => `${p.question.replace(/\s+/gu, ' ').trim()} → ${p.answer.trim()}`)
    .join('\n');
}
