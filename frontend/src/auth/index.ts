/**
 * 로그인 (기획서 §3 · ISS-013).
 *
 * Supabase Auth 하나로 처리한다.
 * - 처음 방문하면 익명 세션을 만든다. 로그인하지 않아도 질문하고 대화를 이어 볼 수 있다
 * - Google·카카오로 로그인하면 익명 계정에 소셜 계정을 연결한다. 사용자 id 가 그대로라 대화가 계정에 남는다
 * - 토큰 검증은 API 서버가 한다. 화면은 토큰을 전달만 한다
 */
import { GoTrueClient, type Session } from '@supabase/auth-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import type { AuthProviderId, User } from '../types';

export interface AuthService {
  /** 기존 세션을 복구하고, 없으면 익명 세션을 만든다 */
  restore(): Promise<User | null>;
  /** 소셜 로그인 페이지로 이동한다 */
  signIn(provider: AuthProviderId): Promise<void>;
  signOut(): Promise<User | null>;
  accessToken(): Promise<string | null>;
  onChange(listener: (user: User | null) => void): void;
}

export const PROVIDER_LABEL: Record<User['provider'], string> = {
  google: 'Google 계정',
  kakao: '카카오 계정',
  anonymous: '비회원',
};

export class AuthError extends Error {}

function toUser(session: Session | null): User | null {
  const u = session?.user;
  if (!u) return null;
  const anonymous = u.is_anonymous === true;
  const provider = (u.identities ?? []).map((i) => i.provider).find((p): p is AuthProviderId => p === 'google' || p === 'kakao');
  const meta = u.user_metadata as Record<string, unknown>;
  const name = String(meta['full_name'] ?? meta['name'] ?? meta['nickname'] ?? (anonymous ? '손님' : (u.email ?? '사용자')));
  return { id: u.id, name, provider: anonymous ? 'anonymous' : (provider ?? 'google'), anonymous };
}

export class SupabaseAuthService implements AuthService {
  private readonly client: { auth: GoTrueClient };
  private anonymousAttempt: Promise<Session | null> | null = null;

  constructor(url: string, key: string) {
    // 인증만 쓰므로 supabase-js 전체 대신 auth 클라이언트만 싣는다 (번들 크기)
    this.client = {
      auth: new GoTrueClient({
        url: `${url}/auth/v1`,
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      }),
    };
  }

  private async ensureSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    if (data.session) return data.session;
    // 동시에 여러 번 불려도 익명 계정은 하나만 만든다
    this.anonymousAttempt ??= this.client.auth.signInAnonymously().then(({ data: d, error }) => {
      this.anonymousAttempt = null;
      if (error) throw new AuthError('비회원 세션을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return d.session;
    });
    return this.anonymousAttempt;
  }

  async restore(): Promise<User | null> {
    return toUser(await this.ensureSession());
  }

  async signIn(provider: AuthProviderId): Promise<void> {
    const session = await this.ensureSession();
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = session?.user.is_anonymous
      ? await this.client.auth.linkIdentity({ provider, options: { redirectTo } })
      : await this.client.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      throw new AuthError(
        /provider is not enabled|Unsupported provider/i.test(error.message)
          ? `${PROVIDER_LABEL[provider]} 로그인은 아직 준비 중입니다. 비회원으로 계속 이용해 주세요.`
          : '로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
  }

  async signOut(): Promise<User | null> {
    await this.client.auth.signOut();
    return toUser(await this.ensureSession());
  }

  async accessToken(): Promise<string | null> {
    return (await this.ensureSession())?.access_token ?? null;
  }

  onChange(listener: (user: User | null) => void): void {
    this.client.auth.onAuthStateChange((_event, session) => listener(toUser(session)));
  }
}

export const auth: AuthService = new SupabaseAuthService(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
