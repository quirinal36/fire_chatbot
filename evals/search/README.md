# 검색 평가셋 (ISS-012)

`questions.jsonl` 한 줄이 질문 하나다.

| 필드 | 뜻 |
|---|---|
| `expected` | 필수 근거 묶음의 목록. 묶음 안의 locator 중 하나가 상위 10개에 있으면 그 묶음을 맞힌 것으로 본다 |
| `expectStatus` | 근거가 없어야 하는 질문의 기대 상태 (`insufficient_evidence`, `date_unclear`) |
| `mustNotLocator` | 결과에 나오면 안 되는 locator. 존재하지 않는 조항을 물어보는 날조 유도 질문에 쓴다 |
| `review` | `draft` 는 개발자 초안, `approved` 는 담당자 확인 |

locator 앞의 문서 키:

| 키 | 문서 |
|---|---|
| `법` `영` `규칙` | 소방시설 설치 및 관리에 관한 법률 · 시행령 · 시행규칙 |
| `다중법` `다중령` `다중규칙` | 다중이용업소의 안전관리에 관한 특별법 · 시행령 · 시행규칙 |
| `NFPC 101` 등 | 화재안전성능기준·기술기준 코드 |
| `해석:<일련번호>` | 소방청 해석 (`해석:2658183/회답`) |

기대 locator 자체나 그 **하위 항목**이 나오면 맞은 것으로 센다. 예: 기대 `별표4/3.가`, 결과 `별표4/3.가.1)`.

실행:

```bash
cd server && npm run eval-search            # 전체 방식 비교, 결과는 evals/search/results/
```

**모든 정답은 담당자 검토 전 초안이다.** 담당자가 확인한 항목은 `review` 를 `approved` 로 바꾸고 검토자·일자를 `docs/search-eval.md` 에 남긴다.
