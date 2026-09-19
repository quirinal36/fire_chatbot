/*
 * 도면 화면 레이아웃 회귀 시험 (UX-001 / ISS-047)
 * 실행: e2e/run-aside.sh plan-layout [WEB_BASE]
 *
 * 검토 패널 폭 360·440·760px 에서
 *  - 편집 모드를 모두 돌아도 캔버스 위치·크기가 그대로인가
 *  - 버튼 글자가 갈라지거나 잘리지 않는가
 *  - 가로로 넘치지 않는가
 *  - 긴 오류 문구가 들어와도 복구 버튼이 패널 안에 남는가
 *
 * 창 크기(1440x900, 1280x800, 390x844)는 Aside 가 뷰포트를 바꾸는 API 를 주지 않아
 * 이 시험으로 확인하지 못한다. 패널 폭으로 좁은 폭의 배치만 확인한다.
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });
const MODES = ['view', 'add', 'erase', 'door', 'scale'];

async function waitUntil(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) { check(what, false, '기다리다 시간 초과'); return false; }
    await sleep(400);
  }
}

const measure = () => page.evaluate(() => {
  const st = document.querySelector('.plan3d__stage').getBoundingClientRect();
  const root = document.querySelector('.plan3d');
  // 패널 머리글의 탭·버튼도 함께 본다. 도면 도구만 보면 머리글이 갈라지는 것을 놓친다
  const btns = Array.from(document.querySelectorAll('.plan3d .btn, .panel__header .btn, .panel__header .tab')).filter((b) => b.offsetParent !== null);
  return {
    stage: [Math.round(st.x), Math.round(st.y), Math.round(st.width), Math.round(st.height)].join(','),
    overflowX: Math.max(root.scrollWidth - root.clientWidth, (() => { const h = document.querySelector('.panel__header'); return h.scrollWidth - h.clientWidth; })()),
    tall: btns.filter((b) => b.getBoundingClientRect().height > 48).map((b) => b.textContent.trim()),
    clipped: btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
  };
});

await fs.mkdir(out, { recursive: true });

for (const width of [360, 440, 760]) {
  await openTab(base);
  await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
  await page.evaluate((w) => localStorage.setItem('fire-chatbot.widths', JSON.stringify({ sidebar: 200, panel: w })), width);
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
  await page.locator('[data-action="toggle-panel"]').click();
  await page.locator('.tab[data-tab="plan"]').click();
  await page.waitForSelector('.plan3d', { timeout: 15000 });
  const ready = await waitUntil(() => document.querySelector('.plan3d__areas') && !document.querySelector('.plan3d__areas').hidden, 40000, width + 'px 예시 도면 분석');
  if (!ready) continue;

  const seen = [];
  for (const mode of MODES) {
    await page.locator('[data-action="mode"][data-mode="' + mode + '"]').click();
    await sleep(350);
    seen.push(await measure());
  }
  await page.locator('[data-action="mode"][data-mode="view"]').click();
  await sleep(350);
  seen.push(await measure());

  const boxes = seen.map((m) => m.stage);
  const same = boxes.every((b) => b === boxes[0]);
  check(width + 'px · 모드를 바꿔도 캔버스가 제자리', same, boxes[0] + (same ? '' : ' / ' + boxes.join(' | ')));
  const tall = seen.flatMap((m) => m.tall);
  const clipped = seen.flatMap((m) => m.clipped);
  check(width + 'px · 버튼 글자가 갈라지거나 잘리지 않음', tall.length === 0 && clipped.length === 0, tall.concat(clipped).join(','));
  check(width + 'px · 가로로 넘치지 않음', seen.every((m) => m.overflowX === 0), String(Math.max.apply(null, seen.map((m) => m.overflowX))));

  // 긴 오류 문구가 들어와도 복구 버튼이 패널 안에 남는가
  const long = await page.evaluate(() => {
    const s = document.querySelector('.plan3d__status');
    s.textContent = '자동 치수 읽기를 완료하지 못했습니다: ' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(4);
    const rec = document.querySelector('.plan3d__recovery');
    rec.hidden = false;
    rec.innerHTML = '<button type="button" class="btn btn--quiet btn--compact">직접 길이 입력</button><button type="button" class="btn btn--quiet btn--compact">다시 읽기</button><button type="button" class="btn btn--quiet btn--compact">로그인</button>';
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const outside = Array.from(rec.querySelectorAll('.btn')).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.right > panel.right + 1 || r.left < panel.left - 1;
    }).length;
    const root = document.querySelector('.plan3d');
    return { outside, overflowX: root.scrollWidth - root.clientWidth };
  });
  check(width + 'px · 긴 오류에도 복구 버튼이 패널 안에 남음', long.outside === 0 && long.overflowX === 0, '밖으로 나간 버튼 ' + long.outside + ' · 넘침 ' + long.overflowX);
  await page.screenshot({ path: out + '/panel-' + width + '.png' });
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
console.log('결과: ' + (results.length - failed.length) + '/' + results.length + ' 통과');
console.log('미검증: 창 크기(1440x900 · 1280x800 · 390x844) — 뷰포트를 바꾸는 API 가 없어 이 시험으로는 확인하지 못함');
console.log(JSON.stringify({ failed: results.filter((r) => !r.ok).length, session: pwd }));
