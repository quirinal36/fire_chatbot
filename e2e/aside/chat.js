/*
 * 핵심 사용자 흐름 (ISS-028): 비회원 질문 → 답변·근거 칩 → 원문 카드 → 오류 신고 → 새로고침 복원 → 좁은 화면
 * 실행: e2e/run-aside.sh chat [WEB_BASE]
 * Aside 브라우저에서 돈다. 이 파일은 aside repl 이 통째로 평가하므로 import 가 없고,
 * 셸이 넘길 때 값을 넣을 수 있도록 __NAME__ · __BASE__ 를 쓴다.
 * Aside 는 세션 폴더 밖에 파일을 못 쓰므로 ./artifacts 에 남기고 실행기가 e2e/out 으로 옮긴다. 달러 기호와 백틱은 쓰지 않는다.
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const errors = [];

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : null));
await fs.mkdir(out, { recursive: true });
await page.screenshot({ path: out + '/1-empty.png' });

await page.locator('#composer-input').fill('3층 학원에 소화기를 설치해야 하나요?');
await page.locator('#composer-input').press('Enter');
await page.waitForSelector('.law-card', { timeout: 60000 });
await page.screenshot({ path: out + '/2-answer.png' });

await page.locator('.law-card .chip').nth(0).click();
await page.waitForSelector('.source__text', { timeout: 15000 });
await page.screenshot({ path: out + '/3-source.png' });
// ISS-033: 조문 본문이 원문 markdown 이 아니라 목록·문단으로 그려졌는지 본다
const rich = await page.locator('.source__text').first().evaluate((el) => ({
  lists: el.querySelectorAll('.doc__list').length,
  items: el.querySelectorAll('li').length,
  pre: el.querySelectorAll('.doc__pre').length,
  raw: /\*\*|^\s*[-*] /m.test(el.textContent || ''),
}));

await page.locator('[data-action="toggle-feedback"]').click();
await page.locator('.feedback select').selectOption('missing_source');
await page.locator('.feedback textarea').fill('브라우저 시험 신고');
await page.locator('.feedback button[type="submit"]').click();
await page.waitForSelector('.feedback__done', { timeout: 15000 });
await page.screenshot({ path: out + '/4-feedback.png' });

await page.reload();
// 새로고침하면 빈 새 대화가 열린다. 목록에서 방금 물어본 대화를 찾아 눌러 복원되는지 본다
await page.waitForSelector('.conv', { timeout: 15000 });
await sleep(1500);
await page.locator('.conv', { hasText: '소화기' }).first().click();
await page.waitForSelector('.law-card', { timeout: 25000 });
await page.screenshot({ path: out + '/5-reload.png' });

// 좁은 화면: Aside 는 뷰포트 크기 변경을 지원하지 않을 수 있다. 되면 찍고 아니면 건너뛴다
let mobile = false;
if (typeof page.setViewportSize === 'function') {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.screenshot({ path: out + '/6-mobile.png' });
  mobile = true;
}

console.log(JSON.stringify({ rich, mobile, errors, session: pwd }));
