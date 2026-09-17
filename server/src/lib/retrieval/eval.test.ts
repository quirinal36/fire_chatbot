import { describe, expect, it } from 'vitest';
import { locatorWithin, matchesExpected } from './eval';

describe('평가 locator 비교', () => {
  it('같거나 하위 항목이면 맞다', () => {
    expect(locatorWithin('별표4/3.가', '별표4/3.가')).toBe(true);
    expect(locatorWithin('별표4/3.가', '별표4/3.가.1)')).toBe(true);
    expect(locatorWithin('제2조제3호', '제2조제3호가목')).toBe(true);
    expect(locatorWithin('제7조', '제7조제1항제1호')).toBe(true);
    expect(locatorWithin('별표4', '별표4/1.가')).toBe(true);
  });
  it('다른 조문·다른 번호는 틀리다', () => {
    expect(locatorWithin('제7조', '제7조의2')).toBe(false);
    expect(locatorWithin('제1조', '제13조')).toBe(false);
    expect(locatorWithin('별표4/1.가.1)', '별표4/1.가.10)')).toBe(false);
    expect(locatorWithin('별표2', '별표20')).toBe(false);
  });
  it('문서 키와 해석 locator', () => {
    expect(matchesExpected('영:별표7/비고.1', { doc: '영', locator: '별표7/비고.1' })).toBe(true);
    expect(matchesExpected('영:별표7/비고.1', { doc: '법', locator: '별표7/비고.1' })).toBe(false);
    expect(matchesExpected('해석:2658183/회답', { doc: '해석:2658183', locator: '회답' })).toBe(true);
    expect(matchesExpected('NFPC 203:제9조제1항', { doc: 'NFPC 203', locator: '제9조제1항' })).toBe(true);
  });
});
