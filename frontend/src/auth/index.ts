/**
 * 로그인 연동 지점.
 *
 * 지금은 화면 흐름을 확인하기 위한 목(mock) 구현입니다.
 * 실제 연동은 아래 두 곳을 각각 채우면 됩니다.
 *
 *  - Google: Google Identity Services 의 `google.accounts.id` 로 ID 토큰을 받고
 *    백엔드에 보내 검증한 뒤 세션을 받습니다.
 *  - Kakao: Kakao JavaScript SDK 의 `Kakao.Auth.authorize` 로 인가 코드를 받고
 *    백엔드에서 토큰 교환과 사용자 조회를 합니다.
 *
 * 두 경우 모두 토큰 검증은 반드시 서버에서 하세요. 브라우저에서 끝내면 안 됩니다.
 */

import type { AuthProviderId, User } from '../types';

export interface AuthService {
  /** 새로고침 후 기존 세션을 복구합니다. */
  restore(): Promise<User | null>;
  signIn(provider: AuthProviderId): Promise<User>;
  signOut(): Promise<void>;
}

const STORAGE_KEY = 'fire-chatbot.session';

function readStored(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as User;
  } catch {
    // 시크릿 모드나 저장소 차단 환경에서는 조용히 비로그인으로 둡니다.
    return null;
  }
}

function writeStored(user: User | null): void {
  try {
    if (user === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // 저장 실패는 로그인 자체를 막지 않습니다.
  }
}

const MOCK_USERS: Record<AuthProviderId, User> = {
  google: { id: 'g-1001', name: '김소방', department: '예방과', provider: 'google' },
  kakao: { id: 'k-2002', name: '이안전', department: '검사과', provider: 'kakao' },
};

/** 개발용 구현. 네트워크 없이 로그인 상태만 흉내 냅니다. */
export class MockAuthService implements AuthService {
  async restore(): Promise<User | null> {
    return readStored();
  }

  async signIn(provider: AuthProviderId): Promise<User> {
    const user = MOCK_USERS[provider];
    writeStored(user);
    return user;
  }

  async signOut(): Promise<void> {
    writeStored(null);
  }
}

export const PROVIDER_LABEL: Record<AuthProviderId, string> = {
  google: 'Google 계정',
  kakao: '카카오 계정',
};

export const auth: AuthService = new MockAuthService();
