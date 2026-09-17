import { describe, expect, it } from 'vitest';
import { redactSecrets, stripOcParam } from './redact';

describe('stripOcParam', () => {
  it('법령 API 상세링크에서 OC 를 제거하고 나머지 순서를 유지한다', () => {
    const link = '/DRF/lawService.do?OC=abc123&target=eflaw&MST=236977&type=HTML&mobileYn=&efYd=20241201';
    expect(stripOcParam(link)).toBe('/DRF/lawService.do?target=eflaw&MST=236977&type=HTML&mobileYn=&efYd=20241201');
  });

  it('절대 URL·소문자 키·유일한 파라미터·해시를 처리한다', () => {
    expect(stripOcParam('http://www.law.go.kr/x.do?target=a&oc=zz#p')).toBe('http://www.law.go.kr/x.do?target=a#p');
    expect(stripOcParam('/x.do?OC=zz')).toBe('/x.do');
    expect(stripOcParam('/x.do')).toBe('/x.do');
  });

  it('OCR 처럼 이름이 OC 로 시작하는 다른 파라미터는 남긴다', () => {
    expect(stripOcParam('/x.do?OCR=1&OC=zz')).toBe('/x.do?OCR=1');
  });
});

describe('redactSecrets', () => {
  it('알려진 비밀값과 OC 파라미터, Authorization 을 가린다', () => {
    const out = redactSecrets(
      '{"url":"https://law.go.kr/DRF/lawSearch.do?OC=myoc&target=eflaw","authorization":"Bearer eyJhbGciOi.x.y","k":"secretvalue"}',
      ['secretvalue'],
    );
    expect(out).not.toContain('myoc');
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain('secretvalue');
    expect(out).toContain('target=eflaw');
  });

  it('형식으로 알 수 있는 키를 가린다', () => {
    const out = redactSecrets('sb_secret_AbC-123 sk-proj-abcdefghijkl');
    expect(out).toBe('sb_secret_<redacted> sk-<redacted>');
  });
});
