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
