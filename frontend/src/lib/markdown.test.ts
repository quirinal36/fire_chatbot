import { describe, expect, it } from 'vitest';
import { inline, isPreformatted, renderRich } from './markdown';

describe('inline (ISS-033)', () => {
  it('허용한 문법만 서식으로 바꾼다', () => {
    expect(inline('**연면적 33㎡** 이상')).toBe('<strong>연면적 33㎡</strong> 이상');
    expect(inline('값은 `nw=3` 이다')).toBe('값은 <code>nw=3</code> 이다');
    expect(inline('(제11조 *관련*)')).toBe('(제11조 <em>관련</em>)');
  });
  it('HTML 과 링크를 넣을 수 없다', () => {
    expect(inline('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(inline('[클릭](javascript:alert(1))')).not.toContain('<a');
    expect(inline('a & b < c')).toBe('a &amp; b &lt; c');
  });
  it('별표*4 처럼 짝이 없는 기호는 그대로 둔다', () => {
    expect(inline('별표*4 참고')).toBe('별표*4 참고');
  });
});

describe('renderRich', () => {
  it('문단과 줄바꿈', () => {
    expect(renderRich('첫 문단\n둘째 줄\n\n다음 문단')).toBe('<p>첫 문단<br>둘째 줄</p><p>다음 문단</p>');
  });

  it('번호 계층을 들여쓴 목록으로 만든다', () => {
    const html = renderRich('1. 소화설비\n  가. 소화기구\n    1) 연면적 33㎡ 이상인 것\n    2) 터널');
    expect(html).toContain('<li>1. 소화설비</li>');
    expect((html.match(/<ul class="doc__list">/g) ?? []).length).toBeGreaterThan(1);
    expect(html).toContain('<li>2) 터널</li>');
  });

  it('번호 없는 이어지는 줄은 앞 항목에 붙인다', () => {
    const html = renderRich('가. 다음의 어느 하나에\n해당하는 것으로 한다\n나. 그 밖의 것');
    expect(html).toContain('<li>가. 다음의 어느 하나에 해당하는 것으로 한다</li>');
  });

  it('괘선 표와 칸 맞춤은 배치를 지킨다', () => {
    const table = '구분      │ 기준\n──────┼──────\n학원      │ 33㎡';
    expect(renderRich(table)).toContain('<pre class="doc__pre">');
    const aligned = '소화기구        설치\n옥내소화전      제외';
    expect(isPreformatted(aligned)).toBe(true);
    expect(isPreformatted('평범한 한 줄 문장')).toBe(false);
  });

  it('표 안의 위험한 문자도 이스케이프한다', () => {
    expect(renderRich('구분   │ <script>\n가   │ 나')).not.toContain('<script>');
  });
});

describe('들여쓰기가 없는 조문', () => {
  it('번호 종류로 단계를 잡는다', () => {
    const html = renderRich('1. 첫째 호\n가. 첫째 목\n나. 둘째 목\n2. 둘째 호');
    expect(html.indexOf('<li>가. 첫째 목</li>')).toBeGreaterThan(html.indexOf('<ul class="doc__list"><li>1. 첫째 호</li>'));
    expect((html.match(/<ul class="doc__list">/g) ?? []).length).toBe(2);
  });
});
