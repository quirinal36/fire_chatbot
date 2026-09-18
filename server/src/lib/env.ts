/**
 * 서버 환경변수 검증 (기획서 §9 · ISS-002).
 *
 * 빌드 단계에서는 비밀값이 없을 수 있으므로 모듈을 불러올 때가 아니라 처음 쓸 때 검증한다.
 * 기능별 키(법령 API · OpenRouter · OpenAI)는 필요한 경로에서 requireKey()로 꺼낸다.
 */
import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalKey = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const schema = z.object({
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),

  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().startsWith('sb_secret_'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith('sb_publishable_'),

  API_AUTHKEY: optionalKey,
  OPENROUTER_API_KEY: optionalKey,
  OPENAI_API_KEY: optionalKey,
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  /** OpenAI 는 모델 버전을 주지 않는다. 모델 동작이 바뀌었다고 판단하면 이 값을 올리고 전체 재임베딩한다 */
  EMBEDDING_REVISION: z.string().default('2026-09-17'),
  OPENROUTER_CHAT_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  /** 비워 두면 대체 모델을 쓰지 않는다. 인젝션·날조 시험을 통과한 모델만 넣는다 (기획서 §6.4) */
  OPENROUTER_FALLBACK_MODEL: optionalKey,
  /** 도면 AI 검토(시각) 모델. Gemini 계열로 정했다 (docs/decisions.md) */
  OPENROUTER_VISION_MODEL: z.string().default('google/gemini-3.8-flash'),
  CRON_SECRET: optionalKey,
  /** 하루 요청 한도. 익명 세션·로그인 사용자·IP 별 */
  LIMIT_ANON_PER_DAY: z.coerce.number().int().positive().default(30),
  LIMIT_USER_PER_DAY: z.coerce.number().int().positive().default(100),
  LIMIT_IP_PER_DAY: z.coerce.number().int().positive().default(200),
  /** 하루 모델·임베딩 비용 상한(USD). 넘으면 새 질문을 받지 않는다 */
  DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  /** 승인 전 규칙을 개발·Preview 에서 미리 보여 줄지. 운영(production)에서는 무시한다 */
  RULES_PREVIEW: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  /** 화면(frontend 프로젝트)의 오리진. 쉼표로 여러 개. */
  CORS_ALLOWED_ORIGINS: csv,
  /** 공유 상위 도메인이 정해지면 `.example.kr` 형태로 넣는다. 비어 있으면 Bearer 토큰만 쓴다. */
  AUTH_COOKIE_DOMAIN: optionalKey,
  /** 진단 경로 보호용. 비어 있으면 진단 경로를 닫는다. */
  DIAGNOSTICS_TOKEN: optionalKey,
});

export type ServerEnv = z.infer<typeof schema> & {
  appEnv: 'development' | 'preview' | 'production';
};

type KeyName = 'API_AUTHKEY' | 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY';

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

let cached: ServerEnv | undefined;

export class EnvError extends Error {
  override name = 'EnvError';
}

/** 브라우저로 나가는 NEXT_PUBLIC_ 변수에 비밀 키가 섞였는지 검사한다. */
export function findLeakedPublicVars(source: Record<string, string | undefined>): string[] {
  return Object.entries(source)
    .filter(([k, v]) => k.startsWith('NEXT_PUBLIC_') && v !== undefined)
    .filter(([, v]) => /^(sb_secret_|sk-)/.test(v!.trim()))
    .map(([k]) => k);
}

export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const leaked = findLeakedPublicVars(source);
  if (leaked.length > 0) {
    throw new EnvError(`브라우저 공개 변수에 비밀 키가 들어 있습니다: ${leaked.join(', ')}`);
  }

  const result = schema.safeParse(source);
  if (!result.success) {
    // 값은 출력하지 않고 변수 이름과 규칙만 알린다.
    const names = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new EnvError(`환경변수 검증 실패\n- ${names.join('\n- ')}`);
  }

  const data = result.data;
  const appEnv = data.VERCEL_ENV ?? 'development';
  return { ...data, CORS_ALLOWED_ORIGINS: resolveOrigins(data.CORS_ALLOWED_ORIGINS, appEnv), appEnv };
}

function resolveOrigins(listed: string[], appEnv: string): string[] {
  if (listed.length > 0) return listed;
  return appEnv === 'development' ? DEV_ORIGINS : [];
}

/**
 * proxy 는 모든 요청 앞에서 돈다. 다른 변수가 잘못되어도 /api/health 가 원인을 보고할 수 있도록
 * CORS 허용 목록만 따로 읽는다.
 */
export function allowedOrigins(source: Record<string, string | undefined> = process.env): string[] {
  const listed = csv.parse(source.CORS_ALLOWED_ORIGINS);
  return resolveOrigins(listed, source.VERCEL_ENV ?? 'development');
}

export function env(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

export function requireKey(name: KeyName): string {
  const value = env()[name];
  if (value === undefined) throw new EnvError(`${name} 가 설정되지 않았습니다.`);
  return value;
}

/** 로그 마스킹에 쓰는 비밀값 목록. 검증 전이라도 process.env 에서 직접 읽는다. */
export function secretValues(): string[] {
  const names = ['API_AUTHKEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'DIAGNOSTICS_TOKEN', 'CRON_SECRET'];
  return names.map((n) => process.env[n]?.trim()).filter((v): v is string => Boolean(v));
}
