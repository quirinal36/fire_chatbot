import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLawResponse } from './client';

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, '../../../../tests/fixtures/law-api', name), 'utf8');
const JSON_CT = 'application/json;charset=UTF-8';

describe('classifyLawResponse', () => {
  it('HTTP 200 인증 실패 JSON 을 성공으로 처리하지 않는다', () => {
    const r = classifyLawResponse(200, JSON_CT, fixture('error-invalid-oc.json'), 'search');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('api_error');
      expect(r.detail).toContain('IP주소');
    }
  });

  it('HTML 오류 페이지와 비 JSON 을 거부한다', () => {
    expect(classifyLawResponse(200, 'text/html', '<!DOCTYPE html><html>', 'search')).toMatchObject({ ok: false, reason: 'html_body' });
    expect(classifyLawResponse(200, 'text/plain', 'hello', 'service')).toMatchObject({ ok: false, reason: 'not_json' });
    expect(classifyLawResponse(200, JSON_CT, '', 'service')).toMatchObject({ ok: false, reason: 'invalid_json' });
    expect(classifyLawResponse(502, JSON_CT, '{}', 'service')).toMatchObject({ ok: false, reason: 'http_error' });
  });

  it.each(['search-eflaw-list.json', 'search-admrul-list.json', 'search-nfaCgmExpc-list.json'])('정상 목록 %s 를 통과시킨다', (name) => {
    expect(classifyLawResponse(200, JSON_CT, fixture(name), 'search').ok).toBe(true);
  });

  it('목록의 resultCode 가 00 이 아니면 실패다', () => {
    const body = JSON.stringify({ LawSearch: { resultCode: '01', totalCnt: '0' } });
    expect(classifyLawResponse(200, JSON_CT, body, 'search')).toMatchObject({ ok: false, reason: 'result_code' });
  });

  it('정상 본문을 통과시킨다', () => {
    expect(classifyLawResponse(200, JSON_CT, fixture('service-eflaw-body.json'), 'service').ok).toBe(true);
  });
});
