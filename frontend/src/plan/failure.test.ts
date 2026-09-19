import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { describeFailure, failureInput, noScaleFound } from './failure';

const of = (code: string, message = '서버 문구') => failureInput(new ApiError(500, code, message));

describe('describeFailure', () => {
  it('한도 오류에 실패한 작업 이름을 붙인다 — 질문 한도로 보이지 않게', () => {
    const f = describeFailure('scale', of('rate_limited'), true);
    expect(f.message).toContain('자동 치수 읽기');
    expect(f.message).not.toContain('질문');
    expect(f.actions).toEqual(['scale-mode']);
  });

  it('로그인이 한도를 올려 주는 경우에만 로그인을 권한다', () => {
    expect(describeFailure('scale', of('rate_limited_anon'), false).actions).toEqual(['login', 'scale-mode']);
    // 이미 로그인했는데 같은 코드가 오면 로그인을 다시 권하지 않는다
    expect(describeFailure('scale', of('rate_limited_anon'), true).actions).toEqual(['scale-mode']);
    // IP 한도 등 로그인이 소용없는 한도에는 로그인을 권하지 않는다
    expect(describeFailure('scale', of('rate_limited'), false).actions).not.toContain('login');
  });

  it('예산 소진은 한도와 구분해 알리고 다시 시도를 권하지 않는다', () => {
    const f = describeFailure('review', of('budget_exhausted'), true);
    expect(f.message).toContain('소진');
    expect(f.actions).not.toContain('review-retry');
  });

  it('연결 실패에는 다시 시도를 준다', () => {
    expect(describeFailure('review', of('network'), true).actions).toEqual(['review-retry', 'scale-mode']);
    expect(describeFailure('save', of('network'), true).actions).toEqual(['save-retry']);
  });

  it('로그인 세션이 없으면 로그인만 준다', () => {
    expect(describeFailure('save', of('unauthorized'), false).actions).toEqual(['login']);
  });

  it('모르는 오류를 한도나 로그인 문제로 단정하지 않는다', () => {
    const f = describeFailure('save', of('weird_thing', '알 수 없는 오류'), false);
    expect(f.message).toContain('도면 저장');
    expect(f.message).toContain('알 수 없는 오류');
    expect(f.actions).toEqual(['save-retry']);
    expect(f.actions).not.toContain('login');
  });

  it('ApiError 가 아닌 오류도 코드 없이 다룬다', () => {
    const f = describeFailure('scale', failureInput(new Error('터짐')), true);
    expect(f.message).toContain('터짐');
    expect(f.actions).toEqual(['scale-retry', 'scale-mode']);
  });

  it('저장에는 직접 길이 입력을 권하지 않는다', () => {
    for (const code of ['rate_limited', 'budget_exhausted', 'model_error']) {
      expect(describeFailure('save', of(code), true).actions).not.toContain('scale-mode');
    }
  });
});

describe('noScaleFound', () => {
  it('읽을 치수가 없으면 직접 입력을 먼저 권한다', () => {
    const f = noScaleFound('치수 글자 없음');
    expect(f.actions[0]).toBe('scale-mode');
    expect(f.message).toContain('치수 글자 없음');
  });
});
