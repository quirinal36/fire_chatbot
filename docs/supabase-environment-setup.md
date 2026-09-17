# FireChatbot Supabase 환경변수 설정

대상 프로젝트: `FireChatbot` (`voiiciyuotuyejcoysbh`) · URL: `https://voiiciyuotuyejcoysbh.supabase.co`

## 주의 · `.env`와 `.env.example`을 혼동하지 않는다

| 파일 | 내용 | Git |
|---|---|---|
| `.env` | 실제 키 값 | 제외됨 (`.gitignore`) |
| `.env.example` | **값이 비어 있는 틀** | 커밋됨 |

`.env.example`에는 `=` 뒤에 아무 값도 넣지 않는다. URL만 예외로 미리 채워져 있다.

`cp .env .env.example` 처럼 실제 값이 `.env.example`로 넘어가는 작업을 하지 않는다. 2026-09-17에 이 사고가 실제로 발생했고, GitHub secret scanning push protection이 푸시를 거부해 유출은 막혔다 (ISS-002 · [#2](https://github.com/quirinal36/fire_chatbot/issues/2)).

같은 일이 생기면 push 거부 메시지의 unblock URL로 secret을 허용하지 말고, `.env.example`에서 값을 지운 뒤 해당 커밋을 고쳐 다시 푸시한다. unblock을 쓰면 실제 키가 저장소 히스토리에 영구히 남는다.

커밋 전 확인:

```bash
grep -nE '^[A-Z_]+=.+' .env.example
```

URL 두 줄 외에 결과가 나오면 값이 섞여 들어간 것이다.

## `.env`에 저장할 값

프로젝트 루트의 [`.env.example`](../.env.example)을 참고해 아래 네 값을 `.env`에 둔다. URL은 미리 채워져 있다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://voiiciyuotuyejcoysbh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_여기에_값_붙여넣기
SUPABASE_URL=https://voiiciyuotuyejcoysbh.supabase.co
SUPABASE_SECRET_KEY=sb_secret_여기에_값_붙여넣기
```

Supabase Dashboard에서 FireChatbot 프로젝트를 열고 **Connect** 대화 상자 또는 **Settings → API Keys**로 이동해 Publishable key와 Secret key를 각각 복사한다. 기존 `anon`·`service_role` 키 대신 새 키(`sb_publishable_`, `sb_secret_`)를 사용한다.

## 키 사용 위치

| 변수 | 사용 위치 | 브라우저 노출 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저·서버 | 가능 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 브라우저·서버 | 가능. RLS가 접근 범위를 제한함 |
| `SUPABASE_URL` | 서버 Route Handler·Cron·관리 작업 | 불필요 |
| `SUPABASE_SECRET_KEY` | 서버 Route Handler·Cron·관리 작업 | 금지. RLS를 우회함 |

`.env`는 이미 Git에서 제외되어 있다. Publishable key는 Vercel의 Preview·Production 환경변수에도 넣고, Secret key는 서버 전용 환경변수로 넣는다. Secret key는 GitHub 이슈·문서·채팅·브라우저 코드에 저장하지 않는다.

공식 키 체계와 보관 방법은 [Supabase API keys 문서](https://supabase.com/docs/guides/getting-started/api-keys)를 따른다.
