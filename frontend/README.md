# 소방본부 AI 상담 챗봇

도면, 소방법, 신규 건축물 문의를 받는 상담 챗봇의 웹 프런트엔드입니다.
Vite + TypeScript 로 구성했고, 프레임워크는 쓰지 않습니다.

## 실행

```bash
npm install
npm run dev
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 (기본 5173) |
| `npm run build` | 타입 검사 후 `dist/` 로 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | 타입 검사만 |

## 화면 구조

좌우 3단 세로 레이아웃입니다. 칸 사이의 핸들을 드래그하면 폭이 바뀌고, 방향키로도 조절됩니다. 폭은 `localStorage` 에 남습니다.

| 칸 | 내용 | 폭 |
| --- | --- | --- |
| 좌 | 대화 목록, 계정 | 200~420px |
| 중 | 채팅, 입력창 | 남는 공간 |
| 우 | 도면 검토 결과 | 360~760px |

우측 패널은 검토 결과가 생길 때 열립니다. 답변의 "도면에서 보기", 헤더의 "도면 패널", 법령 칩 클릭이 모두 이 패널을 엽니다. 화면 폭이 1080px 아래로 내려가면 사이드바가 숨고 패널이 화면을 덮습니다.

## 폴더

```
index.html              앱 껍데기. 내용은 main.ts 가 채웁니다.
src/
  main.ts               상태 생성, 컴포넌트 연결, 액션 정의
  actions.ts            화면 → 앱 방향의 통로 (AppActions)
  types.ts              도메인 타입
  api/chat.ts           챗봇 응답 연동 지점 (지금은 고정 답변)
  auth/index.ts         Google · 카카오 로그인 연동 지점 (지금은 목 구현)
  components/           사이드바, 헤더, 메시지, 입력창, 패널, 로그인, 리사이저
  data/                 화면 확인용 예시 대화와 도면
  lib/                  DOM 유틸, 상태 저장소, 아이콘
  styles/               tokens · base · layout · components
```

상태는 `src/lib/store.ts` 의 작은 구독형 저장소 하나에 모여 있습니다. 컴포넌트는 상태를 직접 고치지 않고 `AppActions` 만 부릅니다. 나중에 React 나 다른 프레임워크로 옮기더라도 `types.ts` 와 `actions.ts` 는 그대로 쓸 수 있습니다.

## 아직 연결되지 않은 것

| 자리 | 지금 | 해야 할 일 |
| --- | --- | --- |
| `src/api/chat.ts` | 고정 답변 | 실제 챗봇 API 호출. 스트리밍을 쓰면 반환 타입을 `AsyncIterable<string>` 로 |
| `src/auth/index.ts` | `MockAuthService` | Google Identity Services, Kakao SDK 연동. 토큰 검증은 반드시 서버에서 |
| `src/data/plan.ts` | 고정 평면도 | 업로드 도면을 서버에서 해석해 좌표를 내려받아 기호만 표시 |
| `src/data/review.ts` | 예시 법령 문구 | 국가법령정보센터 연동 |
| 도면 첨부 버튼 | 동작 없음 | 파일 선택과 업로드 |

로그인하지 않은 사용자도 질문할 수 있습니다. 비회원 대화는 저장하지 않습니다.

## 디자인

색·글자·간격·모서리 값은 디자인 시스템에 등록되어 있고, `src/styles/tokens.css` 가 같은 값을 CSS 변수로 가집니다. 값을 바꿀 때는 디자인 시스템을 먼저 고치세요.

다크 테마는 시스템 설정을 따릅니다. `<html data-theme="dark">` 또는 `data-theme="light"` 로 고정할 수 있습니다.
