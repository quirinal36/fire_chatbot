/*
 * 관리자 흐름 (ISS-021): 로그인 → 전 탭 → 규칙 근거 → 답변 추적 → 비식별 내부 자료 등록
 * 실행: ADMIN_EMAIL=… ADMIN_PASSWORD=… e2e/run-aside.sh admin [WEB_BASE]
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
// Aside 에는 page.waitForFunction 이 없다. 화면 상태가 될 때까지 짧게 되묻는다
async function waitUntil(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() > until) throw new Error('기다리다 시간 초과: ' + what);
    await sleep(300);
  }
}

const out = './artifacts/__NAME__';
const base = '__BASE__';
const email = '__EMAIL__';
const password = '__PASSWORD__';
const errors = [];
if (!email || !password) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD 가 필요하다');

await openTab(base + '/admin.html');
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', async (d) => {
  if (d.type() === 'prompt') await d.accept('브라우저 시험 (비식별)');
  else await d.accept();
});
await fs.mkdir(out, { recursive: true });

await page.locator('input[name=email]').fill(email);
await page.locator('input[name=password]').fill(password);
await page.locator('button[type=submit]').click();
await page.waitForSelector('.stat', { timeout: 20000 });
await page.screenshot({ path: out + '/1-overview.png' });

const tabs = ['versions', 'rules', 'files', 'runs', 'feedback', 'jobs', 'metrics'];
for (const tab of tabs) {
  await page.goto(base + '/admin.html#' + tab);
  await waitUntil(
    () => !document.querySelector('.main') || !(document.querySelector('.main').textContent || '').includes('불러오는 중'),
    30000,
    tab + ' 탭',
  );
  await page.screenshot({ path: out + '/2-' + tab + '.png' });
  if (await page.locator('.main > .warn').count()) errors.push(tab + ': 불러오지 못함');
}

await page.goto(base + '/admin.html#rules');
await page.waitForSelector('[data-act="rules-detail"]');
await page.locator('[data-act="rules-detail"]').nth(0).click();
await page.waitForSelector('#rule-detail details');
await page.screenshot({ path: out + '/3-rule-detail.png' });

await page.goto(base + '/admin.html#runs');
await page.waitForSelector('[data-act="run"]');
await page.locator('[data-act="run"]').nth(0).click();
await page.waitForSelector('#run-detail .kv');
await page.screenshot({ path: out + '/4-run-detail.png' });

await page.goto(base + '/admin.html#documents');
await page.locator('input[name=title]').fill('[시험] 학원 소화기 비치 안내 (비식별)');
await page.locator('input[name=classification]').fill('업무 안내');
await page.locator('input[name=origin]').fill('시험용 가상 부서');
await page.locator('textarea[name=text]').fill(
  '소화기 비치 안내\n학원은 각 층마다 소화기를 비치하고 보행거리 20m 이내에 둔다.\n\n점검 안내\n매월 1회 소화기 압력 게이지를 확인한다. 이 문서는 개발 시험용 비식별 자료다.',
);
await page.locator('#doc-form button[type=submit]').click();
await page.waitForSelector('.flash', { timeout: 20000 });

console.log(JSON.stringify({
  flash: await page.locator('.flash').first().innerText(),
  errors,
  session: pwd,
}));
