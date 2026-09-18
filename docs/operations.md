# 운영 인수인계 문서 (ISS-031)

대상 독자: 이 서비스를 넘겨받아 운영·유지보수하는 개발자와, 문서·규칙을 승인하는 검토자.

이 문서에는 비밀값을 적지 않는다. 비밀값의 위치와 교체 방법만 적는다.

## 1. 구성

```
사용자 브라우저 ─▶ fire-chatbot-web (Vercel, frontend/)      https://fire-chatbot-web.vercel.app
      │                관리자 화면 /admin.html
      ▼ Bearer 토큰
fire-chatbot-server (Vercel icn1, server/)                    https://fire-chatbot-server.vercel.app
      ├─ Supabase FireChatbot (Postgres·pgvector·Auth·Storage, ap-south-1)
      ├─ OpenRouter  anthropic/claude-haiku-4.5 (답변)
      ├─ OpenAI      text-embedding-3-small (검색 임베딩)
      └─ 국가법령정보 공동활용 API (수집, 매일 03:00 KST Cron)
```

| 저장소 경로 | 내용 |
|---|---|
| `frontend/` | 사용자 화면(Vite·TypeScript), 관리자 화면(`admin.html`) |
| `server/` | API(Next.js Route Handler), 수집·검색·답변·규칙 로직, CLI(`server/scripts`) |
| `supabase/migrations/` | 스키마·권한·DB 함수. 순서대로 적용한다 |
| `supabase/tests/` | DB 검증 SQL |
| `scripts/` | 마이그레이션, 보안 검증, 부하 측정, 백업 |
| `evals/` | 검색 평가셋, 부하 측정 결과 |
| `e2e/` | 브라우저 흐름 시험 |
| `docs/rules/` | 판단표(규칙 문서) |

## 2. 계정과 비밀값

| 항목 | 보관 위치 | 비고 |
|---|---|---|
| 법령 API 인증값(OC) | Vercel server 환경변수 `API_AUTHKEY`, 로컬 `.env` | 국가법령정보센터 공동활용 신청 계정 |
| OpenRouter 키 | `OPENROUTER_API_KEY` | 선불 잔액을 확인한다 |
| OpenAI 키 | `OPENAI_API_KEY` | 임베딩 전용 |
| Supabase secret·publishable 키 | `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (server), `VITE_SUPABASE_PUBLISHABLE_KEY` (web) | secret 키는 브라우저에 절대 넣지 않는다 |
| Cron 인증 | `CRON_SECRET` | Vercel Cron이 Bearer 토큰으로 보낸다. Preview와 운영은 다른 값이다 |
| 진단 경로 | `DIAGNOSTICS_TOKEN` | `GET /api/diagnostics/law-api` |
| Supabase 관리 토큰 | 운영자 PC의 `~/.supabase/access-token` (`supabase login`) | 마이그레이션·백업 스크립트가 쓴다 |
| Vercel | 팀 `letscodings-projects` | CLI `vercel login` |
| GitHub | `quirinal36/fire_chatbot` | main에 푸시하면 두 프로젝트가 운영으로 배포된다 |

**인계 방법**: 비밀값은 문서나 메신저로 보내지 않는다.

1. 새 운영자를 Vercel 팀·Supabase 조직·GitHub 저장소에 초대한다.
2. 키를 새로 발급해 Vercel 환경변수에 넣는다.
3. 이전 키를 폐기한다.

환경변수 목록과 뜻은 루트 [`.env.example`](../.env.example)에 있다.

**키 교체 순서**: 새 키 발급 → `vercel env add <이름> production --force` → 재배포(`vercel --prod` 또는 main 푸시) → `/api/health?deep=1` 확인 → 이전 키 폐기.

**관리자 계정**

```bash
cd server
npm run admin -- add --email 검토자@기관.kr --role reviewer --name 홍길동   # 임시 비밀번호가 한 번만 출력된다
npm run admin -- list
npm run admin -- remove --email 검토자@기관.kr
```

`admin`은 작업 등록과 내부 자료 등록까지 할 수 있고, `reviewer`는 승인·반려·신고 처리만 한다. 임시 비밀번호는 전화 등 별도 경로로 전달하고, 첫 로그인 뒤 바꾸게 한다(Supabase 비밀번호 재설정 메일).

## 3. 일상 운영

### 매일 (자동)

Vercel Cron이 03:00 KST에 `GET /api/cron/ingestion`을 부른다.

1. 선정 법령의 새 버전을 확인한다.
2. 새 버전이 있으면 검토 대기 상태로 저장한다. 근거가 바뀐 규칙은 무효로 표시한다.
3. 검색 조각을 만든다.

Cron은 실패해도 자동으로 다시 부르지 않는다. 작업 자체가 재시도 시각을 갖고 있고, 다음 날 Cron이나 관리자 실행이 이어서 처리한다.

### 매주 (사람)

관리자 화면 **개요**에서 다음을 확인한다.

| 항목 | 할 일 |
|---|---|
| 검토 대기 문서 버전 | **문서 버전** → 변경 비교 → 게시 또는 반려 (4.1) |
| 개정으로 재검토가 필요한 규칙 | **판단 규칙** → 근거 보기 → 4.2 |
| 미처리 오류 신고 | **오류 신고** → 답변 추적 → 처리 상태 변경 |
| 실패한 수집 작업 | **수집 작업** → 오류 확인 → 재처리 (5절) |
| 운영 지표 경보 | **운영 지표** → 6절 |

## 4. 검토 절차

### 4.1 법령 새 버전 게시

1. **문서 버전**에서 `pending` 버전의 **변경 비교**를 열어 이전 게시본과 달라진 조항과 영향받는 규칙을 본다.
2. **파싱 확인 필요** 수가 있으면 해당 조항을 국가법령정보센터 원문과 대조한다. 표·그림 단위는 검색에만 나오고 규칙 근거로는 쓰지 못한다.
3. **게시**를 누르고 사유를 적는다. 게시한 버전만 검색에 나온다. 시행일이 미래면 시행예정으로 표시된다.
4. 잘못 수집된 버전은 **반려**한다. 게시된 버전은 반려할 수 없고, 새 버전으로 대체한다.

CLI: `cd server && npm run publish-corpus -- --reviewer "이름" --evidence "근거" --only "NFPC 103" [--acknowledge-parse-issues]`

### 4.2 판단 규칙 변경·재검토

규칙은 화면에서 편집하지 않는다. 저장소의 판단표 코드를 고치고 승인받는다.

1. `server/src/lib/rules/sets/academy.ts`를 고치고 `version`을 올린다.
2. `server/src/lib/rules/sets/academy.cases.ts`에 사례를 더하고 `npm test`를 통과시킨다.
3. `npm run rules -- sync`로 새 버전을 검토 대기로 저장한다. 근거 조항이 현행 게시본에 없거나 파싱이 불완전하면 거부된다.
4. `npm run rules -- table`로 판단표 문서를 다시 만들어 담당자에게 보낸다.
5. 담당자가 **판단 규칙**에서 **승인** → **게시**한다. 이전 게시본은 자동으로 은퇴한다.

개정 영향으로 무효 표시만 된 경우: 근거 조항의 내용이 규칙에 영향을 주지 않으면, 새 버전을 게시한 뒤 **재검토 완료**를 누른다. 근거가 아직 구버전 단위이면 거부되므로, 위 1~5단계로 규칙을 새 버전 근거에 다시 연결한다.

재검토가 끝나기 전까지 영향받은 시설은 사용자 화면에 "추가 확인"으로 나온다.

### 4.3 해석·내부 자료

1. **내부 자료 등록**에 텍스트를 넣는다. 등록 직후에는 비공개이고 외부 전송도 불가다.
2. **문서 버전**에서 게시한다.
3. **해석·내부 자료**에서 **공개 승인**(검색·근거 카드 노출)과 **전송 승인**(모델 API로 본문 전송)을 **따로** 받는다.
4. 철회하면 바로 검색·모델에서 빠진다.

실제 소방본부 내부 자료는 외부 전송 운영 승인(ISS-029) 전까지 등록하지 않는다.

## 5. 수집·색인 작업

```bash
cd server
npm run ingest                         # 선정 목록 전체 수집 (새 버전만 저장)
npm run ingest -- --only "NFTC 103" --dry-run
npm run index-corpus -- --max-usd 0.5  # 검색 조각·임베딩 (바뀐 것만)
npm run jobs -- enqueue check_updates  # 작업 큐 등록
npm run jobs -- run --budget 120       # 로컬에서 큐 처리
```

**수집 대상 추가**: `server/src/lib/ingestion/catalog.ts`에 법령ID·행정규칙ID를 추가한다. 영구 ID는 `searchLaws` / `searchAdminRules`로 찾는다. 그다음 `npm run ingest` → 게시 → `npm run index-corpus`를 실행한다.

**파서 수정**: `normalize.ts`의 `PARSER_VERSION`을 올리면 다음 수집 때 같은 원문을 다시 정규화한다. 규칙이 근거로 쓰는 버전은 다시 정규화하지 않는다(DB가 거부). 임베딩은 본문 hash 캐시를 재사용한다.

**실패 대응**

| 오류 | 원인 | 조치 |
|---|---|---|
| `api_error` + "IP주소 및 도메인주소를 등록" | 법령 API 인증 실패 | OC 값·신청 상태 확인. 운영기관이 IP 제한을 켰다면 송신 IP(`/api/diagnostics/law-api`)를 등록 |
| `network`, HTTP 5xx | 일시 장애 | 작업이 백오프 후 재시도. 계속되면 관리자 화면에서 재처리 |
| `conflict` | 같은 버전 번호에 다른 원문 | 원문 변경 여부를 확인하고, 기존 버전을 유지한 채 담당자에게 보고 |
| 임베딩 비용 상한 도달 | 대량 재임베딩 | `--max-usd`를 올려 다시 실행 |

## 6. 모델·임베딩·비용

| 설정 | 환경변수 | 바꾸는 방법 |
|---|---|---|
| 답변 모델 | `OPENROUTER_CHAT_MODEL` | 후보를 `npm run eval-chat`(인젝션·날조·판정 유도)와 검색 E2E로 시험 → 통과하면 교체 |
| 대체 모델 | `OPENROUTER_FALLBACK_MODEL` | 위 시험을 통과한 모델만. 비워 두면 대체 없이 근거 목록을 보여 준다 |
| 임베딩 모델 | `EMBEDDING_MODEL`, `EMBEDDING_REVISION` | 7절 |
| 일일 비용 상한 | `DAILY_BUDGET_USD` (기본 5) | 넘으면 새 질문이 거부된다 |
| 요청 한도 | `LIMIT_ANON_PER_DAY` 30, `LIMIT_USER_PER_DAY` 100, `LIMIT_IP_PER_DAY` 200 | |

비용 산정과 경보 기준은 [비용 보고서](cost-report.md)를 따른다. 경보가 뜨면 다음처럼 대응한다.

| 경보 | 대응 |
|---|---|
| 비용 80% | 비정상 호출(같은 IP 반복)이 있는지 **답변 추적**에서 확인 |
| 실패 5% | OpenRouter 상태·잔액 확인 |
| 근거 부족 40% | 질문 유형을 보고 수집 대상 추가를 검토 |
| p95 20초 | 모델·DB 지연 확인 |

## 7. 검색 인덱스·임베딩 모델 교체

같은 차원(1536)의 다른 모델로 바꾸는 경우:

1. `EMBEDDING_MODEL`과 `EMBEDDING_REVISION`을 새 값으로 바꾼 **로컬** 환경에서 `npm run index-corpus`를 실행한다. 조각은 모델·revision별로 다시 임베딩되고, 질의도 새 모델로만 검색된다.
2. `npm run eval-search`로 기존 결과(docs/search-eval.md)와 비교한다.
3. 좋으면 Vercel 환경변수를 바꾸고 재배포한다.
4. **복귀**: 환경변수를 되돌리고 `index-corpus`를 실행한다. 이전 모델 벡터는 `embedding_cache`에 남아 있어 호출 없이 채워진다.

차원이 다른 모델은 `search_chunks.embedding` 컬럼과 HNSW 인덱스를 새로 만드는 마이그레이션이 필요하다. 새 컬럼을 추가해 채운 뒤 검색 함수를 바꾸고, 이전 컬럼은 복귀 기간이 지난 다음 지운다.

## 8. 배포·마이그레이션

- **배포**: main에 푸시하면 CI(typecheck·test·build)와 두 Vercel 프로젝트 배포가 함께 돈다. 배포 확인은 `curl https://fire-chatbot-server.vercel.app/api/health`로 한다. 응답의 `commit` 값이 방금 푸시한 커밋과 같은지 본다.
- **DB 변경**: `supabase/migrations/`에 새 파일(시각 접두사)을 추가하고 `node scripts/db-migrate.mjs --dry-run` → `node scripts/db-migrate.mjs`를 실행한다. 이미 적용된 파일은 고치지 않고 새 파일로 수정한다. 검증은 `node scripts/db-migrate.mjs --file supabase/tests/<파일>.sql`로 한다.
- **앱 롤백**:

  ```bash
  cd server   # 또는 frontend
  vercel ls                                   # 이전 Ready 배포 주소 확인
  vercel rollback <이전 배포 주소> --scope letscodings-projects --yes
  vercel promote <고친 배포 주소> --scope letscodings-projects --yes   # 복귀
  ```

  롤백 뒤에는 새 푸시가 자동으로 운영에 올라가지 않는다. 고친 뒤 `promote`로 되돌린다. 2026-09-18에 운영에서 롤백하고 복귀하는 것까지 확인했다(각 2초).
- **DB 롤백**: 마이그레이션은 되돌리는 파일을 새로 작성해 적용한다. 데이터 손상 시 9절의 백업에서 복원한다.
- **규칙 롤백**: 이전 규칙 버전을 다시 게시할 수 없으므로(은퇴 상태), 이전 정의를 새 버전 번호로 동기화해 승인·게시한다.
- **검색 인덱스 롤백**: 7절의 복귀 절차를 따른다.

## 9. 백업과 복원

```bash
node scripts/backup.mjs backup                       # backups/<일시>/ (저장소에 올리지 않는다)
node scripts/backup.mjs verify backups/<일시>        # 임시 스키마에 복원해 건수·체크섬 대조 후 삭제
node scripts/backup.mjs restore backups/<일시> --confirm   # 마이그레이션만 적용한 빈 DB 에 복원
```

- 백업 대상: 법령·규칙·사례·대화·답변 기록·작업·검토 이력·신고(17개 테이블)와 원문 Storage(133개 파일, 12MB)
- 제외: 검색 조각·임베딩. 복원 뒤 `npm run index-corpus`로 다시 만든다(약 $0.03)
- 사용자 계정(`auth.users`)은 이 스크립트로 옮기지 않는다. 같은 프로젝트에서 복원하거나, Supabase의 프로젝트 백업·복원 기능을 쓴다. 계정이 없는 대화 행은 외래키 때문에 복원되지 않는다
- 검증 기록: 2026-09-18 백업 → 임시 스키마 복원, 17개 테이블 건수·체크섬 일치, 원문 133개 해시 일치
- 권장: Supabase Pro 전환 시 일일 자동 백업(7일 보관)을 켜고, 이 스크립트는 주 1회 외부 사본으로 보관한다. 백업 파일에는 대화 내용이 들어 있으니 암호화된 저장소에 둔다

## 10. 장애 대응

| 증상 | 확인 | 조치 |
|---|---|---|
| 모든 질문이 "답변을 작성하지 못했습니다" | 관리자 **답변 추적**의 오류 코드 | `model_auth`·`model_credit`: OpenRouter 키·잔액. `validation_failed` 급증: 모델 응답 변화 → 모델 교체 검토 |
| "오늘 이용 가능한 답변량이 모두 소진" | 운영 지표의 오늘 비용 | 원인을 확인한 뒤 `DAILY_BUDGET_USD` 조정 |
| `/api/health` 503 `misconfigured` | 응답의 `problem` | 환경변수 누락·형식 오류 수정 후 재배포 |
| 검색 결과가 비어 있음 | 게시 버전 수, 조각·임베딩 수 | 게시 확인, `npm run index-corpus` |
| 로그인 안 됨 | Supabase Auth 설정 | 제공자 키, 되돌아갈 주소(`site_url`, 허용 URL) |
| 배포 후 오류 | Vercel 로그 (`vercel logs --environment production`) | 8절 롤백 |

로그에는 법령 API 인증값과 Authorization이 가려져 남는다. 로그에 비밀값이 보이면 즉시 키를 교체하고 `node scripts/security-check.mjs`를 실행한다.

## 11. 정기 점검

```bash
cd server && npm test                         # 단위·계약·규칙 테스트
cd server && npm run eval-search              # 검색 품질 (Recall@10)
cd server && npm run eval-chat                # 답변 안전성 (약 $0.01)
node scripts/security-check.mjs               # 권한·비밀값 (운영)
node scripts/load-test.mjs --count 30         # 비용·지연 (약 $0.2)
./e2e/run-aside.sh chat https://fire-chatbot-web.vercel.app   # Aside 브라우저
./e2e/run-aside.sh regression https://fire-chatbot-web.vercel.app
./e2e/run-aside.sh answer https://fire-chatbot-web.vercel.app     # 답변 품질 회귀
```

분기마다 한 번, 그리고 모델·임베딩·규칙을 바꿀 때마다 실행한다.
