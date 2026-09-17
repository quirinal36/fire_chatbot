# API 서버

Next.js App Router의 Route Handler만 쓰는 API 서버입니다. 화면은 `frontend/`를 별도 Vercel 프로젝트로 배포합니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3001
```

비밀값은 저장소 루트의 `.env` 하나에서 읽습니다 (`next.config.ts`). 목록은 루트 `.env.example`에 있습니다.

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 (3001) |
| `npm test` | 단위·계약 테스트 (vitest) |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | 타입 검사. `build` 또는 `dev`를 한 번 실행한 뒤에 돌립니다 |

## 경로

| 경로 | 설명 |
| --- | --- |
| `GET /api/health` | 환경변수 설정 여부. `?deep=1`이면 Supabase 연결까지 확인 |
| `GET /api/me` | 요청자 확인. Bearer 토큰 또는 공유 도메인 쿠키 |
| `GET /api/diagnostics/law-api` | 배포 환경의 법령 API 동작과 송신 IP. `Authorization: Bearer <DIAGNOSTICS_TOKEN>` |

## 구조

```
src/proxy.ts            /api/* 앞단. CORS 허용 목록, X-Request-Id
src/lib/env.ts          환경변수 검증. 요청 시점에 검증하므로 빌드에는 비밀값이 필요 없음
src/lib/redact.ts       로그 마스킹(redactSecrets), 저장 전 OC 제거(stripOcParam)
src/lib/log.ts          모든 출력이 마스킹을 거치는 구조화 로그
src/lib/auth.ts         요청자 확인
src/lib/supabase.ts     secret 키 클라이언트. RLS를 우회하므로 호출 측에서 권한을 검사
src/lib/law-api/        법령 API 호출과 공통 계약 검증 (HTTP 200 오류 거부)
```

## 인증 전달

화면과 API의 오리진이 다릅니다. 공유 상위 도메인이 정해질 때까지는 화면이 Supabase access token을 `Authorization: Bearer`로 보냅니다. 도메인이 정해지면 `AUTH_COOKIE_DOMAIN`을 설정해 쿠키로 전환합니다. 서버는 두 방식을 모두 읽습니다.

CORS는 `CORS_ALLOWED_ORIGINS`에 적힌 오리진만 허용합니다. 쿠키 전환 시 credentials를 쓰므로 와일드카드는 쓰지 않습니다.
