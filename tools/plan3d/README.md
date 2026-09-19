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
