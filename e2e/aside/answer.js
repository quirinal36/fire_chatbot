/*
 * 답변 품질 회귀 (ISS-039): 근거가 있으면 "확인할 수 없다"로 끝내지 않는다.
 * 실행: e2e/run-aside.sh answer [WEB_BASE]
 *
 * 소방시설법 시행령 별표7(수용인원의 산정 방법)은 corpus 에 있고 검색 1순위로 잡힌다.
 * 표의 숫자가 무엇을 뜻하는지 알려면 상위 항목의 제목이 모델 입력에 있어야 한다.
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const errors = [];
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : null));
// 시험마다 같은 익명 계정에 질문이 쌓여 하루 한도에 걸린다. 새 익명 세션으로 시작한다
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
});
await page.reload();
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
await fs.mkdir(out, { recursive: true });

await page.locator('#composer-input').fill('학원의 수용인원은 어떻게 계산하나요?');
await page.locator('#composer-input').press('Enter');
await page.waitForSelector('.law-card, .msg--error', { timeout: 80000 });
await sleep(1500);

const answer = await page.evaluate(() => {
  const msgs = document.querySelectorAll('.msg--assistant');
  const last = msgs[msgs.length - 1];
  return {
    statements: Array.from(last.querySelectorAll('.statements li')).map((e) => (e.textContent || '').replace(/\s+/gu, ' ').trim()),
    questions: last.querySelectorAll('.askback__q').length,
    summary: ((last.querySelector('.doc') || {}).textContent || '').replace(/\s+/gu, ' ').trim(),
  };
});
await page.screenshot({ path: out + '/1-capacity.png' });

check('근거와 함께 답한다 (ISS-039)', answer.statements.length > 0, answer.summary.slice(0, 90));
check('산정 기준(1.9㎡)을 안내한다 (ISS-039)', answer.statements.some((s) => s.includes('1.9')), answer.statements.join(' | ').slice(0, 110));
check('답을 못 만들어도 되묻고 끝낸다 (ISS-039)', answer.statements.length > 0 || answer.questions > 0, '인용 ' + answer.statements.length + ' · 되묻기 ' + answer.questions);

for (const r of results) console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? ' — ' + r.detail : ''));
console.log(JSON.stringify({ failed: results.filter((r) => !r.ok).length, errors, session: pwd }));
