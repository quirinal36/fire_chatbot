import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/fixtures';
import { parseEflawBody } from '../law-api/adapters/eflaw';
import { parseAdmrulBody } from '../law-api/adapters/admrul';
import { parseInterpretationBody } from '../law-api/adapters/appendix-and-interpretation';
import { contextPath, joinWrapped, normalizeDocument, paragraphNumber, splitAppendixSections } from './normalize';

const decree = () => normalizeDocument(parseEflawBody(fixture('service-eflaw-body.json'), '287375'));

describe('normalizeDocument · 법령', () => {
  it('locator 와 임시 키가 버전 안에서 고유하다', () => {
    const units = decree();
    expect(new Set(units.map((u) => u.locator)).size).toBe(units.length);
    expect(new Set(units.map((u) => u.key)).size).toBe(units.length);
  });

  it('조·항·호·목 locator 를 만든다', () => {
    const locs = new Set(decree().map((u) => u.locator));
    expect(locs).toContain('제7조');
    expect(locs).toContain('제7조제1항');
    expect(locs).toContain('제7조제1항제1호');
    expect(locs).toContain('제7조제1항제1호가목');
    expect(locs).toContain('제7조제1항제3의2호');
    // 번호 없는 단일 항의 호는 조에 바로 붙는다
    expect(locs).toContain('제2조제1호가목');
  });

  it('하위 단위에서 상위 제목을 되짚는다', () => {
    const units = decree();
    const sub = units.find((u) => u.locator === '제2조제1호가목')!;
    const path = contextPath(units, sub);
    expect(path[0]).toMatch(/^제1장/);
    expect(path).toContain('제2조(정의)');
    expect(path.at(-1)).toBe('제2조제1호');
  });

  it('별표 4 를 번호 계층으로 나누고 원문 줄 배치를 보존한다', () => {
    const units = decree();
    const b4 = units.find((u) => u.locator === '별표4')!;
    expect(b4.unitType).toBe('appendix');
    expect(b4.text).toContain('\n');
    expect(b4.attachmentUrl).toMatch(/^https:\/\/www\.law\.go\.kr/);

    const fire = units.find((u) => u.locator === '별표4/1.가')!;
    expect(fire.parentKey).toBe(units.find((u) => u.locator === '별표4/1')!.key);
    // "다음의 어" / "느 하나에" 줄바꿈을 붙인다
    expect(fire.text).toContain('다음의 어느 하나에');

    const area = units.find((u) => u.locator === '별표4/1.가.1)')!;
    expect(area.text).toContain('연면적 33㎡ 이상인 것');
    const deep = units.find((u) => u.locator === '별표4/1.다.1).가)')!;
    expect(deep.text).toContain('연면적 3천㎡ 이상');
  });

  it('괘선 표가 있는 별표는 needs_review 로 표시한다', () => {
    const tables = decree().filter((u) => u.unitType === 'appendix' && u.parseStatus === 'needs_review');
    for (const t of tables) expect(t.parseNotes).toMatch(/괘선|본문 없음|번호 계층/);
  });

  it('부칙을 공포일자로 식별한다', () => {
    const addenda = decree().filter((u) => u.unitType === 'addendum');
    expect(addenda.length).toBe(9);
    expect(addenda[0]!.locator).toMatch(/^부칙<\d{4}-\d{2}-\d{2}/);
  });
});

describe('normalizeDocument · 행정규칙·해석', () => {
  it('행정규칙 조문과 단일 별표', () => {
    const units = normalizeDocument(parseAdmrulBody(fixture('service-admrul-body.json')));
    expect(units.some((u) => u.locator === '제1조')).toBe(true);
    expect(units.filter((u) => u.unitType === 'appendix')).toHaveLength(1);
    expect(new Set(units.map((u) => u.locator)).size).toBe(units.length);
  });

  it('이유가 빈 해석은 needs_review 다', () => {
    const units = normalizeDocument(parseInterpretationBody(fixture('service-nfaCgmExpc-body.json')));
    expect(units.find((u) => u.locator === '회답')!.parseStatus).toBe('ok');
    expect(units.find((u) => u.locator === '이유')!.parseStatus).toBe('needs_review');
  });
});

describe('도구', () => {
  it('항 번호', () => {
    expect(paragraphNumber('①')).toBe('1');
    expect(paragraphNumber('⑫')).toBe('12');
    expect(paragraphNumber('⑳')).toBe('20');
  });
  it('줄바꿈 결합', () => {
    expect(joinWrapped(['가. 다음의 어  ', '  느 하나에', '  (제1호)', '  2.'])).toBe('가. 다음의 어느 하나에 (제1호) 2.');
  });
  it('상위 번호 없이 시작하는 별표도 나눈다', () => {
    const s = splitAppendixSections('머리말\n  가. 첫째\n    1) 하위\n  나. 둘째');
    expect(s.map((x) => x.path.join('/'))).toEqual(['_/가', '_/가/1)', '_/나']);
  });
});

describe('normalizeDocument · 기술기준', () => {
  it('절 번호로 계층을 만든다', () => {
    const units = normalizeDocument(parseAdmrulBody(fixture('service-admrul-nftc-body.json')));
    const byLoc = new Map(units.map((u) => [u.locator, u]));
    const leaf = byLoc.get('2.1.1.3')!;
    expect(byLoc.get('2.1.1')!.key).toBe(leaf.parentKey);
    expect(byLoc.get('1')!.unitType).toBe('chapter');
    expect(contextPath(units, byLoc.get('1.1.1')!)).toEqual(['1(일반사항)', '1.1(적용범위)']);
    expect(new Set(units.map((u) => u.locator)).size).toBe(units.length);
  });
});

describe('기술기준 이미지', () => {
  it('<img> 가 들어 있는 절은 needs_review 이고 태그를 지운다', () => {
    const units = normalizeDocument(parseAdmrulBody(fixture('service-admrul-nftc-body.json')));
    const img = units.filter((u) => u.parseNotes === '표·그림이 이미지로만 제공됨');
    expect(img.length).toBeGreaterThan(0);
    for (const u of units) expect(u.text).not.toMatch(/<img/i);
  });
});

describe('별표 가지번호와 비고', () => {
  it('"27의2." 를 독립 항목으로, "비고" 를 별도 절로 나눈다', () => {
    const units = decree();
    const locs = new Set(units.map((u) => u.locator));
    expect(locs).toContain('별표2/27의2');
    expect(units.find((u) => u.locator === '별표2/27')!.text).not.toContain('터널');
    expect(locs).toContain('별표4/비고');
    expect(units.find((u) => u.locator === '별표4/5.바')!.text).not.toMatch(/비고$/);
  });

  it('비고 아래 번호는 비고의 하위다', () => {
    const units = decree();
    const note = units.find((u) => u.locator === '별표7/비고.2')!;
    expect(note.text).toContain('반올림');
    expect(note.parentKey).toBe(units.find((u) => u.locator === '별표7/비고')!.key);
    expect(units.some((u) => u.locator.includes('#'))).toBe(false);
    expect(units.some((u) => u.locator === '제2장제1절')).toBe(true);
  });
});

describe('가지 조문', () => {
  it('제13조의2 형태로 만든다', async () => {
    const { articleLocator } = await import('./normalize');
    expect(articleLocator('13의2')).toBe('제13조의2');
    expect(articleLocator('7')).toBe('제7조');
  });
});
