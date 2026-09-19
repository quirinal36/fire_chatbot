/*
 * 도면 흐름: 도면 올리기 → 벽·방 구획 → (자동) 치수 읽기·AI 검토 → 제안 적용 → 되돌리기
 * 실행: cp example_imgs/ex01/before.jpg frontend/public/plans/_tmp-ex01.jpg && e2e/run-aside.sh plan [WEB_BASE]
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다). 120초 안에 끝나야 한다.
 */
async function waitUntil(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() > until) throw new Error('기다리다 시간 초과: ' + what);
    await sleep(500);
  }
}
const out = './artifacts/__NAME__';
const base = '__BASE__';
const errors = [];
const t0 = Date.now();
const mark = (s) => console.log('[' + Math.round((Date.now() - t0) / 1000) + 's] ' + s);

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
page.on('pageerror', (e) => errors.push(String(e)));
await fs.mkdir(out, { recursive: true });
// 화면 안 fetch 와 경고를 모아 둔다 (Aside 의 page.on 은 콜백을 부르지 않는다)
await page.evaluate(() => {
  window.__log = [];
  const f = window.fetch;
  window.fetch = async (...a) => { const r = await f(...a); window.__log.push('fetch ' + (typeof a[0] === 'string' ? a[0] : a[0].url) + ' -> ' + r.status); return r; };
  const w = console.warn; console.warn = (...a) => { window.__log.push('warn ' + a.map(String).join(' ')); w(...a); };
  const e = console.error; console.error = (...a) => { window.__log.push('error ' + a.map(String).join(' ')); e(...a); };
});

await page.locator('[data-action="toggle-panel"]').click();
await page.locator('.tab[data-tab="plan"]').click();
await page.waitForSelector('.plan3d', { timeout: 15000 });
mark('도면 탭 열림');

// 올릴 파일을 세션 폴더에 떨군다 (setInputFiles 는 세션 안 파일만 받는다)
const r = await fetch(base + '/plans/_tmp-ex01.jpg');
await fs.writeFile('ex01.jpg', Buffer.from(await r.arrayBuffer()));
await page.locator('.plan3d input[type="file"]').setInputFiles('ex01.jpg');
await waitUntil(() => { const a = document.querySelector('.plan3d__areas'); return a && !a.hidden && a.textContent.includes('바닥 면적'); }, 30000, '방 면적');
mark('벽 세움: ' + (await page.locator('.plan3d__status').innerText()));
const areas1 = await page.locator('.plan3d__areas').innerText();
console.log('--- 판정 전 면적 ---\n' + areas1);
await page.screenshot({ path: out + '/1-uploaded.png' });

// 자동 치수 읽기 → 자동 검토. 검토 상자가 뜰 때까지 기다리며 상태 변화를 찍는다
let last = '';
const until = Date.now() + 105000;
let arrived = false;
while (Date.now() < until) {
  const st = await page.locator('.plan3d__status').innerText();
  if (st !== last) { mark('상태: ' + st); last = st; }
  arrived = await page.evaluate(() => { const b = document.querySelector('.plan3d__review'); return !!(b && !b.hidden); });
  if (arrived) break;
  await sleep(2000);
}
if (!arrived) {
  console.log('--- 화면 로그 ---\n' + (await page.evaluate(() => window.__log.join('\n'))));
  throw new Error('AI 검토 상자가 뜨지 않음');
}
mark('검토 도착: ' + (await page.locator('.plan3d__status').innerText()));
const review = await page.locator('.plan3d__review').innerText();
console.log('--- AI 검토 ---\n' + review);
const areas2 = await page.locator('.plan3d__areas').innerText();
console.log('--- 축척 읽기 후 면적 ---\n' + areas2);
await page.screenshot({ path: out + '/2-review.png' });

// 체크된 제안을 적용하고 면적을 다시 읽는다
const applyBtn = page.locator('[data-action="review-apply"]');
if ((await applyBtn.count()) && Date.now() - t0 < 100000) {
  await applyBtn.click();
  await sleep(1500);
  mark('적용: ' + (await page.locator('.plan3d__status').innerText()));
  console.log('--- 적용 후 면적 ---\n' + (await page.locator('.plan3d__areas').innerText()));
  await page.screenshot({ path: out + '/3-applied.png' });
  await page.locator('[data-action="undo"]').click();
  await sleep(800);
  console.log('--- 되돌리기 후 면적 ---\n' + (await page.locator('.plan3d__areas').innerText()));
  console.log('되돌리기 버튼 disabled: ' + (await page.locator('[data-action="undo"]').evaluate((b) => b.disabled)));
} else {
  console.log('적용할 제안 없음');
}
console.log('--- 화면 로그 ---\n' + (await page.evaluate(() => window.__log.join('\n'))));
console.log('--- 페이지 오류 ---\n' + errors.join('\n'));
console.log(JSON.stringify({ session: pwd }));
