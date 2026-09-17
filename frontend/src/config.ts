/**
 * 출시 범위 플래그.
 *
 * 기획서 §2.2 는 도면 분석과 실별 기구 수량 산출을 후속 범위로 둔다. 화면은
 * 먼저 만들어져 있으므로 코드를 지우지 않고 이 플래그로 가린다. 후속 범위를
 * 열 때 `planPanel` 을 true 로 되돌리면 도면 탭·첨부 버튼·`도면에서 보기`
 * 액션이 함께 살아난다.
 *
 * 결정 기록: ISS-002 진행 기록 · 기획서 §3.1
 */
export const FEATURES = {
  /** 도면 탭, 도면 첨부, 도면에서 보기 액션. 1차 출시 제외 */
  planPanel: false,
} as const;

/**
 * API 서버 주소. 화면과 API 는 별도 Vercel 프로젝트로 배포한다 (ISS-002).
 * Vercel 의 frontend 프로젝트 환경변수 `VITE_API_BASE_URL` 로 지정한다.
 * 빌드 시점에 번들에 들어가므로 비밀값을 넣지 않는다.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://voiiciyuotuyejcoysbh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
