/**
 * 영업장 조건 흐름 (ISS-020·ISS-028): 조건 입력 시작 → 질문에서 후보 추출 → 확인·입력 → 저장 후 재판단
 *   node e2e/case.mjs <스크린샷 폴더> [WEB_BASE]
 * 개발·Preview(검토 전 규칙 미리 보기)에서 실행한다. 운영은 승인 규칙이 없으면 판정 표가 비어 있다.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/out/case';
const base = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.waitForSelector('.app[data-ready="true"]');
await page.waitForTimeout(1500);
await page.click('[data-action="toggle-panel"]');
await page.click('.tab[data-tab="check"]');
await page.click('[data-action="start-case"]');
await page.waitForSelector('.case__form', { timeout: 15000 });
await page.screenshot({ path: `${out}/1-case-empty.png` });
await page.fill('#composer-input', '3층, 연면적 112m^2, 수용인원 : 25명, 상가 집합건물에 있는 코딩 학원입니다. 어떤 소방시설이 필요한가요?');
await page.press('#composer-input', 'Enter');
await page.waitForSelector('.law-card, .msg--error', { timeout: 90000 });
await page.click('.tab[data-tab="check"]');
await page.waitForSelector('.case__hint', { timeout: 15000 });
await page.screenshot({ path: `${out}/2-after-chat.png`, fullPage: false });
// 추출값 확인 + 나머지 입력
for (const key of ['capacity', 'business_floor', 'business_area_m2']) {
  const btn = page.locator(`[data-action="confirm-field"][data-key="${key}"]`);
  if (await btn.count()) { await btn.click(); await page.waitForSelector('.case__form button[type=submit]:not([disabled])'); await page.waitForTimeout(300); }
}
await page.selectOption('#case-business_kind', 'general');
await page.fill('#case-same_use_area_m2', '112');
await page.selectOption('#case-is_evacuation_floor', 'false');
await page.fill('#case-building_total_area_m2', '450');
await page.fill('#case-building_floors_above', '4');
await page.fill('#case-building_floors_below', '0');
await page.fill('#case-basement_windowless_max_area_m2', '0');
await page.fill('#case-upper_floor_max_area_m2', '110');
await page.fill('#case-nlf_area_total_m2', '450');
await page.click('.case__form button[type=submit]');
await page.waitForSelector('text=저장했습니다', { timeout: 15000 });
await page.screenshot({ path: `${out}/3-saved.png` });
await page.locator('.panel__body').screenshot({ path: `${out}/4-panel.png` });
console.log('results:', await page.locator('.case .check').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').slice(0, 60))));
console.log('errors:', JSON.stringify(errors));
await browser.close();
