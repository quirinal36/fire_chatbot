/*
 * 영업장 조건 흐름 (ISS-020·ISS-028): 조건 입력 시작 → 질문에서 후보 추출 → 확인·입력 → 저장 후 재판단
 * 실행: e2e/run-aside.sh case [WEB_BASE]
 * 개발·Preview(검토 전 규칙 미리 보기)에서 실행한다. 운영은 승인 규칙이 없으면 판정 표가 비어 있다.
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
const errors = [];

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : null));
await fs.mkdir(out, { recursive: true });

await page.locator('[data-action="toggle-panel"]').click();
await page.locator('.tab[data-tab="check"]').click();
await page.locator('[data-action="start-case"]').click();
await page.waitForSelector('.case__form', { timeout: 15000 });
await page.screenshot({ path: out + '/1-case-empty.png' });

await page.locator('#composer-input').fill('3층, 연면적 112m^2, 수용인원 : 25명, 상가 집합건물에 있는 코딩 학원입니다. 어떤 소방시설이 필요한가요?');
await page.locator('#composer-input').press('Enter');
await page.waitForSelector('.law-card, .msg--error', { timeout: 80000 });
await page.locator('.tab[data-tab="check"]').click();
await page.waitForSelector('.case__hint', { timeout: 15000 });
await page.screenshot({ path: out + '/2-after-chat.png' });

// 질문에서 뽑아낸 값 확인 + 나머지 입력
const keys = ['capacity', 'business_floor', 'business_area_m2'];
for (const key of keys) {
  const btn = page.locator('[data-action="confirm-field"][data-key="' + key + '"]');
  if (await btn.count()) {
    await btn.click();
    await page.waitForSelector('.case__form button[type=submit]:not([disabled])');
    await sleep(300);
  }
}
await page.locator('#case-business_kind').selectOption('general');
await page.locator('#case-same_use_area_m2').fill('112');
await page.locator('#case-is_evacuation_floor').selectOption('false');
await page.locator('#case-building_total_area_m2').fill('450');
await page.locator('#case-building_floors_above').fill('4');
await page.locator('#case-building_floors_below').fill('0');
await page.locator('#case-basement_windowless_max_area_m2').fill('0');
await page.locator('#case-upper_floor_max_area_m2').fill('110');
await page.locator('#case-nlf_area_total_m2').fill('450');
await page.locator('.case__form button[type=submit]').click();
// Aside 의 waitForSelector 는 CSS 만 받는다. 문구는 직접 기다린다
await waitUntil(
  () => Array.from(document.querySelectorAll('.panel__note')).some((e) => (e.textContent || '').includes('저장했습니다')),
  15000,
  '저장 안내',
);
await page.screenshot({ path: out + '/3-saved.png' });

const checks = await page.evaluate(() => Array.from(document.querySelectorAll('.case .check')).map((e) => e.textContent.trim()));
console.log(JSON.stringify({
  checks: checks.map((t) => t.replace(/\s+/g, ' ').slice(0, 60)),
  errors,
  session: pwd,
}));
