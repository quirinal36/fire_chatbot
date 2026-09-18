import { describe, expect, it } from 'vitest';

describe('되묻기에 답한 글의 검색어 (ISS-037)', () => {
  it('처음 물었던 질문을 앞에 붙인다', async () => {
    const { searchQuery } = await import('./service');
    const answers = '어떤 소방시설이 궁금하신가요? → 소화기\n영업장이 몇 층인가요? → 3층';
    expect(searchQuery(answers, ['소방 기준 알려줘'])).toBe(`소방 기준 알려줘\n${answers}`);
  });

  it('보통 질문은 그대로 쓴다', async () => {
    const { searchQuery } = await import('./service');
    expect(searchQuery('학원에 소화기를 설치해야 하나요?', ['앞 질문은 무엇인가요?'])).toBe('학원에 소화기를 설치해야 하나요?');
    expect(searchQuery('질문 → 답', [])).toBe('질문 → 답');
  });

  it('조건만 적은 글은 앞 질문과 합친다 (ISS-040)', async () => {
    const { searchQuery, isQuestion } = await import('./service');
    const topic = '학원의 수용인원은 어떻게 계산하나요?';
    const fact = '우리 학원은 강의실이 3개야. 총 면적은 112제곱미터야';
    expect(isQuestion(fact)).toBe(false);
    expect(isQuestion(topic)).toBe(true);
    expect(searchQuery(fact, [topic])).toBe(`${topic}\n${fact}`);
    // 가장 최근에 실제로 물었던 질문을 쓴다
    expect(searchQuery(fact, [topic, '학원에 소화기가 필요한가요?'])).toBe(`학원에 소화기가 필요한가요?\n${fact}`);
  });
});
