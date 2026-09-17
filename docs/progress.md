# 진행 현황과 다음 작업

기준: 2026-09-17 · 커밋 `7147fa7` 이후 · 기획서 [v0.4](../소방시설_법령_API_챗봇_프로그램_기획서.md)

대상 독자: 이 프로젝트를 이어받거나 진행 상황을 확인하는 개발자와 소방 업무 검토 담당자.

## 한 줄 요약

**화면, 외부 연동 검증(PoC), 서버 뼈대가 있고 셋 다 배포되어 있다.** 서버에는 아직 기능 경로가 없어서 질문에 실제 법령 근거로 답하는 기능은 동작하지 않는다. 다음은 M2 수집이다.

| 마일스톤 | 범위 | 상태 |
|---|---|---|
| M1 | 착수 결정 및 외부 연동 PoC | ISS-003 · ISS-004 완료, ISS-002 거의 완료(키 분리 남음) |
| M2 | 법령 수집 및 버전 저장 | 미착수 |
| M3~M8 | 검색 · 챗봇 · 규칙 · 관리자 · 검증 · 배포 | 미착수 |

---

## 1. 구현된 것

### 1.1 프런트엔드 — 동작하는 화면

`frontend/` · Vite + TypeScript · 프레임워크 없음 · TypeScript 19개 파일 약 1,800줄 · 빌드 산출물 JS 27KB + CSS 15KB

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

**되는 것**

- 3단 레이아웃(대화 목록 · 채팅 · 검토 패널). 칸 폭 드래그·방향키 조절, `localStorage` 저장, 1080px 미만에서 사이드바 숨김 + 패널 오버레이
- 채팅: 메시지 목록, 입력창, 응답 대기 상태, 답변 하단 면책 문구
- 검토 패널: `법령` · `체크리스트` 탭. 답변의 법령 칩 클릭으로 열림
- 로그인 모달(Google · 카카오 진입점). 비로그인 사용자도 질문 가능
- 다크 테마(시스템 설정 연동, `<html data-theme>`로 고정 가능)

**구조**

상태는 `src/lib/store.ts`의 구독형 저장소 하나에 모인다. 컴포넌트는 상태를 직접 고치지 않고 `src/actions.ts`의 `AppActions`만 호출한다. 도메인 타입은 `src/types.ts`. 프레임워크를 도입하더라도 `types.ts`와 `actions.ts`는 그대로 쓴다.

디자인 토큰은 `src/styles/tokens.css`의 CSS 변수로 관리한다. 값을 바꿀 때는 디자인 시스템을 먼저 고친다.

**목(mock) 구현 — 백엔드 연결 지점**

| 파일 | 지금 | 연결 대상 |
|---|---|---|
| `src/api/chat.ts` | 0.9초 후 고정 문구 반환 | ISS-015 `POST /api/chat` |
| `src/auth/index.ts` | `MockAuthService` | ISS-013 세션·OAuth |
| `src/data/review.ts` | 예시 법령 문구 | ISS-011 `GET /api/sources/:id` |
| `src/data/conversations.ts` | 예시 대화 5건 | 대화 목록 API |

**동작하지 않는 UI**

- 검토 결과 내려받기(`⤓`) 버튼 — 미구현
- 오류 신고 UI — 아직 없음 (ISS-016)

### 1.2 API 서버 (ISS-002)

`server/` · Next.js 16 App Router Route Handler 전용 · [README](../server/README.md)

```bash
cd server && npm install && npm run dev     # http://localhost:3001 · 루트 .env 를 읽는다
```

| 배포 | 주소 | 루트 |
|---|---|---|
| `fire-chatbot-web` | https://fire-chatbot-web.vercel.app | `frontend/` |
| `fire-chatbot-server` | https://fire-chatbot-server.vercel.app | `server/` · 리전 `icn1` |

main에 푸시하면 두 프로젝트가 함께 Production으로 배포된다. CI는 프런트엔드 `typecheck`·`build`, 서버 `test`·`build`·`typecheck`, `.env.example` 값 유입 검사를 돌린다.

**있는 것**

- `GET /api/health` (`?deep=1`이면 Supabase까지), `GET /api/me`, `GET /api/diagnostics/law-api`
- 환경변수 검증은 요청 시점에 한다. 빌드에는 비밀값이 필요 없다. `NEXT_PUBLIC_*`에 비밀 키가 들어가면 거부한다
- 모든 로그가 `redactSecrets`를 거친다(OC·Authorization·알려진 키). 저장 전 OC 제거는 `stripOcParam`
- CORS는 `CORS_ALLOWED_ORIGINS` 허용 목록만. 요청자 확인은 Bearer 토큰과 공유 도메인 쿠키를 모두 읽는다
- 법령 API 공통 계약 검증 `classifyLawResponse` — fixture로 "HTTP 200 인증 실패"를 거부하는지 테스트한다

화면의 API 주소는 `frontend/src/config.ts`의 `API_BASE_URL`(`VITE_API_BASE_URL`)이다. 아직 호출하는 곳은 없다.

### 1.3 법령 API 연동 검증 (ISS-003 완료)

`scripts/law-api-poc.mjs` · `tests/fixtures/law-api/` 9종 · [상세](law-api-poc.md)

```bash
node scripts/law-api-poc.mjs        # 무료 · 읽기 전용 · 16 PASS / 2 FAIL 이 정상
```

신청·권한 유효. 5개 target(`eflaw` `admrul` `licbyl` `admbyl` `nfaCgmExpc`) 모두 HTTPS·JSON 응답, 지연 115~780ms. 기획서 §4.3의 1~6단계 통과.

**배포 환경에서도 IP 등록 없이 동작한다.** Vercel 미국·서울 리전의 서로 다른 송신 IP에서 모두 정상 응답했다. 고정 송신 IP 환경은 필요 없다. 서울 리전 지연은 140~260ms. [상세](law-api-poc.md#배포-환경-시험-436--2026-09-17)

**FAIL 2건은 버그가 아니라 발견 사항이다.**

1. **(P0) 목록 응답의 `*상세링크` 필드에 인증값 `OC`가 그대로 담겨 온다.** 5개 target 전부. 그대로 저장하면 DB에 키가 남고, 근거 카드나 모델 프롬프트로 나가면 외부 유출이다. 수집 시점에 제거해야 한다 → ISS-005 · ISS-006
2. **(P1) 소방청 해석의 `이유`가 빈 문자열이다.** `질의요지`·`회답`은 오지만 §4.3-5를 충족하지 못한다. 표본 1건이라 추가 확인 필요 → ISS-024

**어댑터 설계에 반영할 계약 차이** (기획서 §4.1의 "동일 파서 가정 금지"가 실물로 확인됨)

| 항목 | 법령 `eflaw` | 행정규칙 `admrul` |
|---|---|---|
| 현행 구분값 | `nw=3` | `nw=1` |
| 루트 키 | `법령` / `LawSearch` | `AdmRulService` / `AdmRulSearch` |
| 조문 | `조문.조문단위[]` (63) | `조문내용[]` (16, 문자열 배열) |
| 별표 | `별표단위` = **배열** (10) | `별표단위` = **단일 객체** |
| 첨부 | `별표서식파일링크` (상대경로) | `첨부파일링크[]` (절대 URL, **http**) |

함정 네 가지:

- `별표번호`는 `"0004"` 형태의 **4자리 제로패딩 문자열**이다. 숫자로 비교하면 못 찾는다
- `조문단위[].항`의 형태가 일정하지 않다. 63개 중 **항 없음 25 / 단일 객체 13 / 배열 25**. `호`도 같다. 단일 객체를 1개짜리 배열로 정규화해야 한다
- 별표 검색은 `search=2`가 없으면 **조용히 `totalCnt: 0`** 을 반환한다
- **인증 실패가 HTTP 200 + JSON `{result, msg}`** 로 온다. 기획서가 경계한 HTML 오류와 다른 형태다

**수집 범위에 영향:** 별표 본문이 법령 본문 호출에 함께 온다. 시행령 별표 4가 **439줄·28,090자 전문**으로 들어 있어 HWP 다운로드 없이 구조화할 수 있다. 다만 고정폭 공백 정렬 + 괘선문자(`┌─┬─┐`) 표이고 단어 중간에서 줄이 끊긴다(`다음의 어` / `느 하나에`). **ISS-008의 난도를 낮게 잡으면 안 된다.**

### 1.4 모델 연동 검증 (ISS-004 완료)

`scripts/openrouter-poc.mjs` · [상세](openrouter-poc.md) · 시험 총비용 $0.064

```bash
node scripts/openrouter-poc.mjs     # 실제 모델 호출 · 1회 약 $0.03
```

**발견**

1. **(P0) OpenRouter에 임베딩 모델이 0개다.** 444개 전부 chat completions 전용. 기획서 §6.1·§9의 전제가 성립하지 않아 공급자를 분리했다
2. **(P0) `gemini-2.5-flash-lite`가 프롬프트 인젝션에 뚫렸다.** 근거 본문에 심은 지시문을 따라 `summary`를 `"OVERRIDE-OK"`로 덮었다. `claude-haiku-4.5`는 방어했다
3. **(P0) `gemini-2.5-flash-lite`가 존재하지 않는 조항을 날조했다.** 없는 "제99조의7"의 내용을 있는 것처럼 제시. `claude-haiku-4.5`는 거부. **두 모델 모두 `sourceIds`는 유효했으므로 인용 ID 검증으로는 못 잡는다**
4. `provider.require_parameters=true`가 OpenAI 계열을 전면 차단한다. `/api/v1/models`의 `supported_parameters` 표시를 믿으면 안 된다

**측정값**

| 모델 | 입력 | 출력 | 지연 | 질문당 | 월 10,000회 |
|---|---|---|---|---|---|
| `gemini-2.5-flash-lite` | 2,558 | 320 | 0.8~1.1s | $0.00038 | $3.84 |
| `claude-haiku-4.5` | 4,649 | 489 | 1.1~4.4s | $0.00709 | $70.94 |

같은 프롬프트인데 입력 토큰이 **2,558 대 4,649**다. 토크나이저 차이이며 한국어에서 더 벌어진다. 비용 산식에 단가만 쓰고 토큰 수를 모델별로 구분하지 않으면 틀린다.

### 1.5 지식 그래프

`frontend/public/graph.html` → dev 서버의 `/graph.html`. 기획서·이슈·코드를 313 노드 / 624 엣지 / 17 커뮤니티로 이었다.

드러난 사실 하나: **기획서·문서 쪽 123개 노드와 프런트엔드 코드 164개 노드를 잇는 엣지가 0개다.** 코드에 이슈 번호나 기획서 절 참조가 없어서다.

---

## 2. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 스택 | 프런트엔드 정적 SPA + Next.js API 서버 | ISS-002. 프로토타입이 이미 분리 구조라 이식 이득이 적음 |
| 배포 단위 | **Vercel 프로젝트 두 개** (web · server), 저장소 하나 | 2026-09-17 결정 |
| 인증 전달 | 목표는 공유 상위 도메인 쿠키. **도메인 확정 전까지 Bearer 토큰** | 서버는 두 방식을 모두 읽음. `AUTH_COOKIE_DOMAIN`으로 전환 |
| 서버 리전 | Vercel `icn1` (서울) | 법령 API 지연 절반 이하 |
| 첫 지원 시설 | **교육서비스 학원** (일반음식점 대신) | 2026-09-17 결정. 기획서 §14 미결 항목 해소 |
| 도면 패널 | **1차 출시 제외** | 8주·2천만원이 도면 분석을 포함하지 않는 전제. `FEATURES.planPanel` 플래그로 가림 |
| 인증 | Supabase Auth 소셜 로그인(Google·카카오) | 관리자 인증과 같은 체계. 비로그인 질문은 익명 세션으로 유지 |
| 기본 챗 모델 | `anthropic/claude-haiku-4.5` | 인젝션·날조 양쪽 통과한 유일한 후보 |
| 임베딩 | OpenAI `text-embedding-3-small` · 1536차원 · $0.02/M | OpenRouter 미제공. **착수용 기본값이며 ISS-012 평가셋으로 확정** |
| 외부 모델 전송 | **개발 단계에 한해 허용** | 공개 법령·비식별 사례만. 운영 전 담당자 재승인 필요 |

---

## 3. 지금부터 할 일

### 3.1 ISS-002 마무리

- [x] Next.js App Router + Route Handlers 스캐폴드 (`server/src/app/`)
- [x] 환경변수 검증과 서버/브라우저 구분
- [x] CI — 프런트엔드 `typecheck` · `build` 포함
- [x] Supabase 연결 확인
- [x] Vercel 배포 (두 프로젝트)
- [x] 배포 단위 분리 방식 확정 — 두 프로젝트
- [x] 다른 오리진의 CORS와 인증 전달 설계
- [x] 배포 환경 법령 API 재시험 — IP 제약 없음
- [ ] 개발·Preview·운영 키 분리. 지금은 세 환경이 같은 키를 쓴다. 운영 출시 전까지 운영용 Supabase 프로젝트와 API 키를 따로 받는다

### 3.2 다음 작업 — M2 수집 (ISS-005 → 006 → 007 → 008)

순서가 의존 관계로 정해져 있다.

**ISS-005 스키마** — PoC에서 확정된 값을 반영해 시작한다.
- `search_chunks.embedding`은 `vector(1536)`. pgvector는 차원을 컬럼 타입에 고정하므로 모델 변경은 전체 재임베딩을 뜻한다
- `*상세링크`의 `OC` 제거를 저장 경로에 넣는다. `legal_versions.source_url`에 원본 링크를 그대로 넣으면 안 된다. `server/src/lib/redact.ts`의 `stripOcParam`을 쓴다

**ISS-006 어댑터** — §1.3의 계약 차이 표를 그대로 구현한다. 공통 봉투 검사는 `server/src/lib/law-api/client.ts`에 있다. `tests/fixtures/law-api/`의 9종으로 계약 테스트를 먼저 쓴다. 특히 `error-invalid-oc.json`으로 "HTTP 200 오류"를 성공 처리하지 않는지 검증한다.

**ISS-007 수집 CLI** — 별표 본문이 법령 본문에 함께 오므로 기획서 §4.4가 상정한 별표 별도 다운로드 범위가 줄어든다.

**ISS-008 정규화** — 가장 어렵다. 괘선문자 표와 단어 중간에서 끊기는 줄을 다뤄야 하고, `항`·`호`의 형태 불안정을 정규화해야 한다. `needs_review` 게이트가 자주 발동할 것으로 본다.

### 3.3 병행 가능 — ISS-017 판단표, ISS-012 평가셋

둘 다 **담당자 검토가 필요해 리드타임이 길다.** 개발이 M2에 들어갈 때 함께 시작해야 M3·M5에서 대기하지 않는다.

ISS-017 판단표와 ISS-012 평가셋의 예시는 **교육서비스 학원** 기준으로 만든다.

ISS-012 평가셋에는 **날조 유도 질문과 인젝션 문자열이 심긴 근거를 반드시 포함한다.** §1.4의 발견 2·3이 모델 선택만으로 해결되지 않기 때문이다. 임베딩 모델 확정도 이 평가셋으로 한다.

### 3.4 첫 번째 수직 기능

기획서 §14가 말하는 "한 질문에 올바른 근거를 반환하는 수직 기능"의 최소 경로:

```
ISS-002 스캐폴드 → ISS-005 스키마 → ISS-006 어댑터 → ISS-007 수집
   → ISS-009 임베딩 → ISS-010 검색 → ISS-011 근거 API → ISS-015 채팅 API
```

**ISS-015가 완료되는 시점이 "질문했더니 진짜 답이 온다"를 처음 확인할 수 있는 지점이다.** 그때 `frontend/src/api/chat.ts`의 목 구현을 실제 호출로 바꾼다.

---

## 4. 남아 있는 미결 항목

기획서 §14 기준. 완료된 항목은 제외했다. 첫 지원 시설(학원)은 2026-09-17에 정해졌다.

| 항목 | 막는 것 | 필요한 사람 |
|---|---|---|
| 판단표·정답 사례 검토 담당자와 일정 | ISS-017 · ISS-012 | 담당자 |
| 제공 자료 형식·수량·공개 범위 | ISS-024 | 담당자 |
| **외부 모델 전송 운영 재승인** | ISS-029 → 운영 출시 범위 | 담당자 |
| 프로젝트 소유 계정·도메인·기관 배포 요구사항 | ISS-030 | 의뢰자 |
| 부가세·운영비·유지보수 범위 | ISS-029 | 의뢰자 |

**재승인이 없으면 내부 자료를 제외한 범위로 출시한다.** 운영 배포 직전에 이 항목이 튀어나와 일정을 밀지 않도록 미리 확인하는 편이 낫다.

---

## 5. 사용자 확인이 필요한 질문

작업을 멈추지 않고 기록해 둔 질문이다. 답이 오면 이 표에서 지운다.

| # | 질문 | 막는 것 | 기본으로 진행하는 방향 |
|---|---|---|---|
| Q1 | Supabase **익명 로그인**을 켜도 되는가? 지금 꺼져 있어 `Anonymous sign-ins are disabled`가 온다. Dashboard → Authentication → Sign In / Providers → Anonymous | 비로그인 질문의 세션(ISS-013) | 켜는 것을 전제로 설계. 켜기 전에는 비로그인 경로를 시험할 수 없다 |
| Q2 | Supabase 프로젝트 `FireChatbot`의 **리전**은 어디인가? 서울 함수에서 예열 후 약 170ms로, 서울이라면 느리다 | 검색·채팅 지연 | 그대로 진행. 서울이 아니면 운영 프로젝트는 `ap-northeast-2`로 만들기를 권장 |
| Q3 | 학원 판단표의 기준 시설: 렛츠코딩앤플레이의 **층·연면적·수용인원·건물 용도**를 알려줄 수 있는가? 실제 사례가 있어야 판단표(ISS-017)의 정답을 만들 수 있다 | ISS-017 · ISS-012 | 가상 수치로 초안을 만들고 담당자 검토 대상으로 표시 |
| Q4 | 운영 도메인은 언제쯤 정해지는가? | 쿠키 인증 전환 | Bearer 토큰 유지 |

## 6. 지금 직접 해볼 수 있는 것

| 무엇 | 명령 | 비용 |
|---|---|---|
| 화면 조작 | `cd frontend && npm run dev` | 무료 |
| 법령 API 실호출 | `node scripts/law-api-poc.mjs` | 무료 |
| 모델 인젝션·날조 재현 | `node scripts/openrouter-poc.mjs` | 약 $0.03 |
| 지식 그래프 | dev 서버의 `/graph.html` | 무료 |
| 빌드 검증 | `cd frontend && npm run typecheck && npm run build` | 무료 |
| 서버 로컬 실행 | `cd server && npm run dev` → `localhost:3001/api/health?deep=1` | 무료 |
| 서버 테스트 | `cd server && npm test` | 무료 |
| 배포 서버 상태 | https://fire-chatbot-server.vercel.app/api/health?deep=1 | 무료 |
| 수집한 별표 4 원문 | `tests/fixtures/law-api/service-eflaw-body.json` | 무료 |

**아직 못 하는 것:** 실제 법령 근거로 답하기, 실제 로그인, 법령 검색, 근거 카드 조회. 서버 뼈대 위에 M2~M4 기능이 올라가야 한다.
