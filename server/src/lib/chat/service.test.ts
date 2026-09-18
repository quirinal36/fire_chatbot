import { describe, expect, it } from 'vitest';

describe('되묻기에 답한 글의 검색어 (ISS-037)', () => {
  it('처음 물었던 질문을 앞에 붙인다', async () => {
    const { searchQuery } = await import('./service');
    const answers = '어떤 소방시설이 궁금하신가요? → 소화기\n영업장이 몇 층인가요? → 3층';
    expect(searchQuery(answers, ['소방 기준 알려줘'])).toBe(`소방 기준 알려줘\n${answers}`);
  });

  it('보통 질문은 그대로 쓴다', async () => {
    const { searchQuery } = await import('./service');
    expect(searchQuery('학원에 소화기를 설치해야 하나요?', ['앞 질문'])).toBe('학원에 소화기를 설치해야 하나요?');
    expect(searchQuery('질문 → 답', [])).toBe('질문 → 답');
  });
});
