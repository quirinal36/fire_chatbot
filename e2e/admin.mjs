/**
 * 관리자 흐름 (ISS-021): 로그인 → 전 탭 → 규칙 근거 → 답변 추적 → 비식별 내부 자료 등록
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node e2e/admin.mjs [스크린샷 폴더] [WEB_BASE]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [out = 'e2e/out/admin', base = 'http://localhost:5173'] = process.argv.slice(2);
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD 가 필요하다');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', async (d) => {
  if (d.type() === 'prompt') await d.accept('브라우저 시험 (비식별)');
  else await d.accept();
});
await page.goto(`${base}/admin.html`);
await page.fill('input[name=email]', email);
await page.fill('input[name=password]', password);
await page.click('button[type=submit]');
await page.waitForSelector('.stat', { timeout: 20000 });
await page.screenshot({ path: `${out}/1-overview.png` });
for (const tab of ['versions', 'rules', 'files', 'runs', 'feedback', 'jobs', 'metrics']) {
  await page.goto(`${base}/admin.html#${tab}`);
  await page.waitForFunction(() => !document.querySelector('.main')?.textContent?.includes('불러오는 중'), null, { timeout: 30000 });
  await page.screenshot({ path: `${out}/2-${tab}.png` });
  const warn = await page.locator('.main > .warn').count();
  if (warn) errors.push(`${tab}: 불러오지 못함`);
}
await page.goto(`${base}/admin.html#rules`);
await page.waitForSelector('[data-act="rules-detail"]');
await page.click('[data-act="rules-detail"] >> nth=0');
await page.waitForSelector('#rule-detail details');
await page.screenshot({ path: `${out}/3-rule-detail.png` });
await page.goto(`${base}/admin.html#runs`);
await page.waitForSelector('[data-act="run"]');
await page.click('[data-act="run"] >> nth=0');
await page.waitForSelector('#run-detail .kv');
await page.screenshot({ path: `${out}/4-run-detail.png` });
await page.goto(`${base}/admin.html#documents`);
await page.fill('input[name=title]', '[시험] 학원 소화기 비치 안내 (비식별)');
await page.fill('input[name=classification]', '업무 안내');
await page.fill('input[name=origin]', '시험용 가상 부서');
await page.fill('textarea[name=text]', '소화기 비치 안내\n학원은 각 층마다 소화기를 비치하고 보행거리 20m 이내에 둔다.\n\n점검 안내\n매월 1회 소화기 압력 게이지를 확인한다. 이 문서는 개발 시험용 비식별 자료다.');
await page.click('#doc-form button[type=submit]');
await page.waitForSelector('.flash', { timeout: 20000 });
console.log('flash:', await page.locator('.flash').first().innerText());
console.log('errors:', JSON.stringify(errors));
await browser.close();
