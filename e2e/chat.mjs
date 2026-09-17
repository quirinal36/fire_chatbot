/**
 * 핵심 사용자 흐름 (ISS-028): 비회원 질문 → 답변·근거 칩 → 원문 카드 → 오류 신고 → 새로고침 복원 → 좁은 화면
 *   node e2e/chat.mjs <스크린샷 폴더> [WEB_BASE]
 * 설치된 Chrome 을 쓴다 (playwright-core, channel chrome)
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/out/chat';
const base = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForSelector('.app[data-ready="true"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-empty.png` });
await page.fill('#composer-input', '3층 학원에 소화기를 설치해야 하나요?');
await page.press('#composer-input', 'Enter');
await page.waitForSelector('.phase', { timeout: 5000 }).catch(() => {});
await page.screenshot({ path: `${out}/2-pending.png` });
await page.waitForSelector('.law-card', { timeout: 60000 });
await page.screenshot({ path: `${out}/3-answer.png` });
await page.click('.law-card .chip >> nth=0');
await page.waitForSelector('.source__text', { timeout: 15000 });
await page.screenshot({ path: `${out}/4-source.png` });
await page.click('[data-action="toggle-feedback"]');
await page.selectOption('.feedback select', 'missing_source');
await page.fill('.feedback textarea', '브라우저 시험 신고');
await page.click('.feedback button[type="submit"]');
await page.waitForSelector('.feedback__done', { timeout: 15000 });
await page.screenshot({ path: `${out}/5-feedback.png` });
await page.reload();
await page.waitForSelector('.conv', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.click('.conv >> nth=0');
await page.waitForSelector('.law-card', { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: `${out}/6-reload.png` });
await page.setViewportSize({ width: 400, height: 800 });
await page.screenshot({ path: `${out}/7-mobile.png` });
console.log('console errors:', JSON.stringify(errors));
if (errors.length) process.exitCode = 1;
await browser.close();
