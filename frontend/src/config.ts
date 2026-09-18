/**
 * 출시 범위 플래그.
 *
 * 기획서 §2.2 는 도면 분석과 실별 기구 수량 산출을 후속 범위로 둔다. 도면 탭은
 * 1차 출시에서 가렸다가, 업로드한 2D 도면의 벽을 브라우저에서 3D 로 세우는
 * 기능(src/plan)을 넣으며 다시 켰다. 기구 수량 산출은 여전히 후속 범위다.
 *
 * 결정 기록: ISS-002 진행 기록 · 기획서 §3.1
 */
export const FEATURES = {
  /** 도면 탭, 도면 첨부. 2026-09-18 도면을 3D 벽으로 세우는 기능으로 다시 켬 */
  planPanel: true,
} as const;

/**
 * API 서버 주소. 화면과 API 는 별도 Vercel 프로젝트로 배포한다 (ISS-002).
 * Vercel 의 frontend 프로젝트 환경변수 `VITE_API_BASE_URL` 로 지정한다.
 * 빌드 시점에 번들에 들어가므로 비밀값을 넣지 않는다.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://voiiciyuotuyejcoysbh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
