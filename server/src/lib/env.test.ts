import { describe, expect, it } from 'vitest';
import { EnvError, allowedOrigins, parseEnv } from './env';

const base = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

describe('parseEnv', () => {
  it('필수 값만 있으면 개발 환경 기본값으로 통과한다', () => {
    const e = parseEnv(base);
    expect(e.appEnv).toBe('development');
    expect(e.EMBEDDING_DIMENSIONS).toBe(1536);
    expect(e.CORS_ALLOWED_ORIGINS).toContain('http://localhost:5173');
    expect(e.API_AUTHKEY).toBeUndefined();
  });

  it('빈 문자열 키는 미설정으로 본다', () => {
    expect(parseEnv({ ...base, OPENAI_API_KEY: '  ' }).OPENAI_API_KEY).toBeUndefined();
  });

  it('필수 값이 없으면 변수 이름을 알리되 값은 싣지 않는다', () => {
    const run = () => parseEnv({ ...base, SUPABASE_SECRET_KEY: 'sb_publishable_wrong' });
    expect(run).toThrow(EnvError);
    expect(run).toThrow(/SUPABASE_SECRET_KEY/);
    expect(run).not.toThrow(/sb_publishable_wrong/);
  });

  it('NEXT_PUBLIC_ 변수에 비밀 키가 들어가면 거부한다', () => {
    expect(() => parseEnv({ ...base, NEXT_PUBLIC_OPENAI: 'sk-abcdef' })).toThrow(/NEXT_PUBLIC_OPENAI/);
  });

  it('Preview·운영에서는 허용 오리진 기본값을 두지 않는다', () => {
    expect(parseEnv({ ...base, VERCEL_ENV: 'preview' }).CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(allowedOrigins({ VERCEL_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://a.kr, https://b.kr' })).toEqual([
      'https://a.kr',
      'https://b.kr',
    ]);
  });
});
