# plan3d — 2D 도면에서 벽·출입구만 3D 로

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python extract_walls.py 도면.png --wall-height 2.7
open 도면.html   # 브라우저에서 회전·확대
```

- 두꺼운 검은 선만 벽으로 잡고(모폴로지 열림), 얇은 선·글자·가구·문 호는 버린다.
- 벽이 끊긴 자리가 그대로 출입구가 된다. 문 호는 바닥에 깔린 원본 도면으로 확인.
- 벽이 덜 잡히거나 가구가 벽으로 잡히면 `--min-thick`(벽 두께 px)과 `--dark`(0~255, 어두움 기준)를 조정.
- 축척은 `--px-per-m` 로 지정. 생략하면 벽 두께를 0.2m 로 가정한다.
- 산출물: `.html`(뷰어, 단독 실행), `.walls.json`(벽 폴리곤, 픽셀 좌표), `.mask.png`(벽 마스크, 튜닝 확인용).
- `make_test_plan.py` 는 검증용 합성 도면을 만든다.

## diag-rooms.ts — 실제 도면으로 방 나누기 진단 (TypeScript, 브라우저와 같은 코드)

`extract_walls.py` 와 달리 앱이 실제로 쓰는 `frontend/src/plan/` 을 Node 에서 그대로 부른다. 그래서 브라우저 결과와 같다.

```bash
npm install                      # pngjs·jpeg-js·tsx (앱 의존성과 분리)
npx tsx diag-rooms.ts ../../example_imgs/ex02/before.png 59 out/ex02
open out/ex02-base.png           # 바깥=하늘색, 벽=검정, 어느 방에도 안 들어간 곳=주황, 방=색상별
```

두 번째 인자는 브라우저가 축소한 그림 기준 1m 당 픽셀이다(축척 모드나 치수선 읽기 결과 값을 넣는다).
기본 경로 외에 전역 닫힘 커널을 키운 경우, 검출된 개구부만 막은 경우를 함께 찍어 실패 원인을 가른다.
2026-09-19 조사 결과와 해석은 `docs/plan-ai-roadmap.md` 2절에 있다.

## build-eval.ts · eval-plans.ts — AI Hub 도면으로 정확도 재기

AI Hub "건축 도면 데이터"(내국인 신청)를 `example_imgs/01.원천데이터`·`02.라벨링데이터` 에 풀어 두고 쓴다.
1.3GB 이고 재배포할 수 없어 저장소에는 넣지 않는다(`.gitignore`).

```bash
npx tsx build-eval.ts ../../example_imgs   # 시트를 평면도 단위로 잘라 example_imgs/eval 에 낸다 (69장)
npx tsx eval-plans.ts                      # 전부 평가
npx tsx eval-plans.ts SPA_009340288_1 --draw   # 한 장만, 겹쳐 그린 그림도 낸다
npx tsx eval-plans.ts --thick=0.2          # 벽 두께를 축척 × 0.2m 로 고정해서 비교
```

`--draw` 그림은 회색 바탕이 원본, 검정이 우리 벽, 색 면이 우리 방, **빨간 테두리가 정답**, 파란 선분이 개구부 후보다.

알아 둘 것

- 한 시트(A3 300dpi)에 평면도가 2~3개 들어 있어 주석 위치로 잘라 낸다. 시트의 8할이 여백이라 자르지 않으면 벽이 3px 가 된다.
- 정답에 축척 숫자가 없다. STR 은 벽 두께 중앙값을 0.25m 로 보고, SPA 는 공간 면적(화장실 4㎡ 등) 여러 개의 중앙값으로 역산한다. STR 쪽은 치수선 실측과 2% 안에서 맞는 것을 확인했다.
- **정답은 용도 기준 공간이고 우리는 물리적으로 닫힌 영역이다.** 트인 거실·주방을 정답은 나누고 우리는 하나로 본다. "맞힌 방" 비율이 낮다고 전부 결함은 아니다. 그림으로 확인할 것.
