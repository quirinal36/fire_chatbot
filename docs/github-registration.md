# GitHub 등록 결과

저장소: https://github.com/quirinal36/fire_chatbot

마일스톤 8개와 이슈 32개 등록 및 본문·라벨·마일스톤 연결 검증 완료. 담당자와 마감일은 미지정. 선행 작업은 실제 이슈 번호로 연결했다.

## 마일스톤

| 문서 ID | GitHub |
|---|---|
| M1 | [M1 · 착수 결정 및 외부 연동 PoC](https://github.com/quirinal36/fire_chatbot/milestone/1) |
| M2 | [M2 · 법령 수집 및 버전 저장](https://github.com/quirinal36/fire_chatbot/milestone/2) |
| M3 | [M3 · 근거 검색 및 검색 평가](https://github.com/quirinal36/fire_chatbot/milestone/3) |
| M4 | [M4 · 근거 검색 챗봇 MVP](https://github.com/quirinal36/fire_chatbot/milestone/4) |
| M5 | [M5 · 영업장 조건 및 검토된 판단 규칙](https://github.com/quirinal36/fire_chatbot/milestone/5) |
| M6 | [M6 · 관리자 검토 및 개정 갱신](https://github.com/quirinal36/fire_chatbot/milestone/6) |
| M7 | [M7 · 통합 검증 및 운영 안정화](https://github.com/quirinal36/fire_chatbot/milestone/7) |
| M8 | [M8 · 운영 배포 및 인수인계](https://github.com/quirinal36/fire_chatbot/milestone/8) |

## 이슈

| 문서 ID | GitHub 이슈 | 마일스톤 |
|---|---|---|
| ISS-001 | [#1 착수 범위와 운영 전제 확정](https://github.com/quirinal36/fire_chatbot/issues/1) | M1 |
| ISS-002 | [#2 Next.js 개발 기반과 환경별 설정 구성](https://github.com/quirinal36/fire_chatbot/issues/2) | M1 |
| ISS-003 | [#3 법령 API 실제 응답 및 권한 PoC](https://github.com/quirinal36/fire_chatbot/issues/3) | M1 |
| ISS-004 | [#4 OpenRouter 모델과 임베딩 후보 PoC](https://github.com/quirinal36/fire_chatbot/issues/4) | M1 |
| ISS-005 | [#5 Supabase 스키마와 접근 정책 마이그레이션](https://github.com/quirinal36/fire_chatbot/issues/5) | M2 |
| ISS-006 | [#6 target별 법령 API 어댑터 구현](https://github.com/quirinal36/fire_chatbot/issues/6) | M2 |
| ISS-007 | [#7 원문 수집 CLI와 멱등 저장 구현](https://github.com/quirinal36/fire_chatbot/issues/7) | M2 |
| ISS-008 | [#8 조항·별표 정규화 및 버전 보존 구현](https://github.com/quirinal36/fire_chatbot/issues/8) | M2 |
| ISS-009 | [#9 임베딩 및 검색 인덱스 파이프라인 구현](https://github.com/quirinal36/fire_chatbot/issues/9) | M3 |
| ISS-010 | [#10 버전·권한 필터를 포함한 하이브리드 검색 구현](https://github.com/quirinal36/fire_chatbot/issues/10) | M3 |
| ISS-011 | [#11 버전 고정 근거 조회 API 및 근거 카드 구현](https://github.com/quirinal36/fire_chatbot/issues/11) | M3 |
| ISS-012 | [#12 담당자 검색 평가셋과 기준 성능 작성](https://github.com/quirinal36/fire_chatbot/issues/12) | M3 |
| ISS-013 | [#13 서명 세션·요청 검증·중복 요청 방지 구현](https://github.com/quirinal36/fire_chatbot/issues/13) | M4 |
| ISS-014 | [#14 OpenRouter 구조화 생성 및 응답 검증 구현](https://github.com/quirinal36/fire_chatbot/issues/14) | M4 |
| ISS-015 | [#15 채팅 API와 답변 실행 추적 구현](https://github.com/quirinal36/fire_chatbot/issues/15) | M4 |
| ISS-016 | [#16 법령 질문 화면과 사용자 오류 신고 구현](https://github.com/quirinal36/fire_chatbot/issues/16) | M4 |
| ISS-017 | [#17 최초 업종 판단표와 정답 사례 승인](https://github.com/quirinal36/fire_chatbot/issues/17) | M5 |
| ISS-018 | [#18 영업장 조건 상태와 revision API 구현](https://github.com/quirinal36/fire_chatbot/issues/18) | M5 |
| ISS-019 | [#19 승인된 선언형 규칙 실행기 구현](https://github.com/quirinal36/fire_chatbot/issues/19) | M5 |
| ISS-020 | [#20 영업장 조건 카드와 시설 적용 결과 연결](https://github.com/quirinal36/fire_chatbot/issues/20) | M5 |
| ISS-021 | [#21 관리자 문서·규칙 승인과 답변 추적 화면 구현](https://github.com/quirinal36/fire_chatbot/issues/21) | M6 |
| ISS-022 | [#22 개정 감지와 영향 규칙 무효화 구현](https://github.com/quirinal36/fire_chatbot/issues/22) | M6 |
| ISS-023 | [#23 lease 기반 작업 큐와 예약 수집 운영 구현](https://github.com/quirinal36/fire_chatbot/issues/23) | M6 |
| ISS-024 | [#24 소방청 해석 및 내부 자료 공개·전송 승인 구현](https://github.com/quirinal36/fire_chatbot/issues/24) | M6 |
| ISS-025 | [#25 세션·관리자·내부 자료 권한 통합 검증](https://github.com/quirinal36/fire_chatbot/issues/25) | M7 |
| ISS-026 | [#26 모델 장애 복구와 요청·비용 제한 구현](https://github.com/quirinal36/fire_chatbot/issues/26) | M7 |
| ISS-027 | [#27 호출량·비용·실패 지표와 성능 측정](https://github.com/quirinal36/fire_chatbot/issues/27) | M7 |
| ISS-028 | [#28 검색·규칙·인용 품질 및 핵심 E2E 최종 검증](https://github.com/quirinal36/fire_chatbot/issues/28) | M7 |
| ISS-029 | [#29 운영 정책·계정·지원 범위 확정](https://github.com/quirinal36/fire_chatbot/issues/29) | M8 |
| ISS-030 | [#30 운영 배포·백업 복원·롤백 검증](https://github.com/quirinal36/fire_chatbot/issues/30) | M8 |
| ISS-031 | [#31 사용자·관리자 안내 및 운영 인수인계 문서 작성](https://github.com/quirinal36/fire_chatbot/issues/31) | M8 |
| ISS-032 | [#32 담당자 최종 검수 및 출시 결과 기록](https://github.com/quirinal36/fire_chatbot/issues/32) | M8 |
