import { describe, expect, it } from 'vitest';
import { AREA_UNITS, answerInput, composeAnswers, formatQuantity, questionLabel } from './followup';

describe('answerInput', () => {
  it('예·아니오로 답할 질문은 boolean 이다', () => {
    expect(answerInput('학원의 연면적이 33㎡ 이상인가요?')).toEqual({ kind: 'boolean' });
    expect(answerInput('학원이 지하구, 터널, 가스시설 등 특수 시설에 해당하나요?')).toEqual({ kind: 'boolean' });
  });

  it('괄호 안에 보기가 나열되면 고르게 한다', () => {
    const out = answerInput('어떤 소방시설이 궁금하신가요? (소화기, 자동화재탐지설비, 스프링클러, 유도등, 피난기구 등)');
    expect(out.kind).toBe('choice');
    expect(out.kind === 'choice' && out.options).toEqual(['소화기', '자동화재탐지설비', '스프링클러', '유도등', '피난기구']);
  });

  it('둘 중 하나를 묻는 문장도 고르게 한다', () => {
    const out = answerInput('설치 대상인지 여부가 궁금하신가요, 설치 방법·기준이 궁금하신가요?');
    expect(out).toEqual({ kind: 'choice', options: ['설치 대상인지 여부', '설치 방법·기준'] });
  });

  it('한 가지 단위를 물으면 숫자와 단위로 받는다', () => {
    // ㎡ 는 손으로 적기 어려워 평도 고를 수 있다 (ISS-037)
    expect(answerInput('영업장 바닥면적은 몇 ㎡인가요?')).toEqual({ kind: 'number', unit: '㎡', units: AREA_UNITS });
    expect(answerInput('수용인원은 몇 명인가요?')).toEqual({ kind: 'number', unit: '명' });
  });

  it('여러 가지를 한 번에 물으면 한 줄 입력으로 받는다', () => {
    const out = answerInput('영업장이 몇 층이고 바닥면적은 몇 ㎡인가요? 건물 전체 연면적도 알면 알려 주세요.');
    expect(out).toEqual({ kind: 'text', placeholder: '예: 3층, 112㎡' });
  });

  it('날짜를 물으면 날짜 칸으로 받는다', () => {
    expect(answerInput('건축허가(또는 용도변경 신고) 날짜를 알려 주세요.')).toEqual({ kind: 'date' });
  });

  it('괄호 안 예시는 보기가 아니라 입력 예시로 쓴다', () => {
    expect(answerInput('어떤 업종이고 건물은 어떤 용도인가요? (예: 상가 건물에 있는 학원)')).toEqual({
      kind: 'text',
      placeholder: '상가 건물에 있는 학원',
    });
  });

  it('묻는 말이 있으면 예·아니오로 보지 않는다', () => {
    expect(answerInput('어떤 용도의 건물인가요?').kind).toBe('text');
  });
});

describe('composeAnswers', () => {
  it('답한 것만 질문과 함께 모은다', () => {
    const text = composeAnswers([
      { question: '어떤 소방시설이 궁금하신가요?', answer: '소화기' },
      { question: '연면적이 33㎡ 이상인가요?', answer: '' },
      { question: '영업장 바닥면적은 몇 ㎡인가요?', answer: '112㎡' },
    ]);
    expect(text).toBe('어떤 소방시설이 궁금하신가요? → 소화기\n영업장 바닥면적은 몇 ㎡인가요? → 112㎡');
  });

  it('아무것도 답하지 않으면 빈 글이다', () => {
    expect(composeAnswers([{ question: '연면적이 33㎡ 이상인가요?', answer: '  ' }])).toBe('');
  });
});

describe('questionLabel', () => {
  it('보기 목록 괄호는 입력 칸이 대신하므로 문장에서 뺀다', () => {
    expect(questionLabel('어떤 소방시설이 궁금하신가요? (소화기, 자동화재탐지설비, 스프링클러, 유도등, 피난기구 등)')).toBe(
      '어떤 소방시설이 궁금하신가요?',
    );
  });

  it('입력 예시 괄호도 뺀다', () => {
    expect(questionLabel('어떤 업종이고 건물은 어떤 용도인가요? (예: 상가 건물에 있는 학원)')).toBe('어떤 업종이고 건물은 어떤 용도인가요?');
  });

  it('뜻이 담긴 괄호는 남긴다', () => {
    expect(questionLabel('건축허가(또는 용도변경 신고) 날짜를 알려 주세요.')).toBe('건축허가(또는 용도변경 신고) 날짜를 알려 주세요.');
  });
});

describe('formatQuantity', () => {
  it('㎡ 는 그대로 적는다', () => {
    expect(formatQuantity('112', '㎡ (제곱미터)')).toBe('112㎡');
  });

  it('평은 ㎡ 로 환산해 함께 적는다', () => {
    expect(formatQuantity('30', '평')).toBe('30평 (약 99.2㎡)');
  });

  it('숫자가 아니면 빈 글이다', () => {
    expect(formatQuantity('', '평')).toBe('');
    expect(formatQuantity('abc', '㎡ (제곱미터)')).toBe('');
  });
});
