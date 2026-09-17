/*
 * 사용자 확인에서 나온 문제의 회귀 시험 (ISS-033·034·035)
 * 실행: e2e/run-aside.sh regression [WEB_BASE]
 *
 * 1. 추천 질문을 눌러도 답변이 화면에 남는다 (ISS-035)
 * 2. 근거가 부족하면 되묻는 질문이 나오고, 그 자리에서 답을 입력할 수 있다 (ISS-034·036)
 * 3. 근거 원문이 번호 계층·표 서식으로 표시된다 (ISS-033)
 *
 * 대화 목록 응답을 일부러 늦추는 경합 시험은 Aside 가 네트워크 가로채기를 지원하지 않아
 * frontend/src/lib/sessions.test.ts 의 단위 시험이 대신한다.
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const errors = [];
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });

// 시험을 돌릴 때마다 같은 익명 계정에 질문이 쌓여 하루 한도(기본 30건)에 걸린다.
// 저장된 로그인 토큰을 지워 새 익명 세션으로 시작한다
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
});
await page.reload();
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : null));
await fs.mkdir(out, { recursive: true });

// ISS-035: 첫 화면의 추천 질문을 누른다. 뒤늦게 오는 대화 목록이 답변을 지우면 안 된다
await page.waitForSelector('.followups .chip', { timeout: 15000 });
await page.locator('.followups .chip').nth(0).click();
await page.waitForSelector('.law-card, .msg--error', { timeout: 80000 });
await page.screenshot({ path: out + '/1-answer.png' });
check('추천 질문 답변이 화면에 남는다', (await page.locator('.msg--assistant .law-card').count()) > 0);

await sleep(8000);
const after = await page.locator('.msg--assistant .law-card').count();
const asked = await page.locator('.msg--user').count();
check('잠시 뒤에도 답변이 남아 있다 (ISS-035)', after > 0 && asked > 0, '답변 ' + after + ' · 질문 ' + asked);
check('대화 목록에 현재 대화가 있다', (await page.locator('.conv').count()) > 0);

// ISS-033: 근거 원문 서식
await page.locator('.law-card .chip').nth(0).click();
await page.waitForSelector('.source__text', { timeout: 20000 });
const rich = await page.locator('.source__text').first().evaluate((el) => ({
  lists: el.querySelectorAll('.doc__list').length,
  pre: el.querySelectorAll('.doc__pre').length,
  raw: (el.textContent || '').includes('**'),
}));
check('원문에 날 markdown 이 남지 않는다 (ISS-033)', !rich.raw, JSON.stringify(rich));
await page.screenshot({ path: out + '/2-source.png' });

// ISS-034: 근거 부족 → 되묻기
await page.locator('#composer-input').fill('소방 기준 알려줘');
await page.locator('#composer-input').press('Enter');
await page.waitForSelector('.status-note', { timeout: 80000 });
const note = await page.locator('.status-note').last().innerText();
// 화면에는 앞선 답변의 양식도 남아 있다. 마지막 답변의 양식만 본다
const rows = await page.evaluate(() => {
  const forms = document.querySelectorAll('.askback');
  const last = forms[forms.length - 1];
  return Array.from(last ? last.querySelectorAll('.askback__q') : []).map((r) => ({
    q: (r.querySelector('.askback__text').textContent || '').trim(),
    kind: r.dataset.kind,
    // 답을 받을 수단이 있어야 한다: 고르는 버튼 또는 입력 칸
    answerable: r.querySelectorAll('[data-opt]').length > 0 || r.querySelector('.askback__text-input') !== null,
  }));
});
check('근거 부족일 때 되묻는 질문이 있다 (ISS-034)', rows.length >= 2, rows.map((r) => r.q).join(' | ').slice(0, 120));
check('되묻는 질문마다 답을 입력할 칸이 있다 (ISS-036)', rows.length > 0 && rows.every((r) => r.answerable), rows.map((r) => r.kind).join(', '));
check('실패처럼 보이는 문구를 쓰지 않는다', !note.includes('찾지 못했습니다'), note);

// 답을 채워 보내면 내 질문이 아니라 "질문 → 답" 으로 나간다 (ISS-036)
// 입력 칸이 있는 질문에는 글을 적고, 고르는 질문이면 첫 보기를 누른다
const typed = rows.findIndex((r) => r.kind === 'text' || r.kind === 'choice');
const forms = await page.locator('.askback').all();
const form = forms[forms.length - 1];
const qRows = await form.locator('.askback__q').all();
let answered = '';
if (typed >= 0) {
  answered = '소화기';
  await qRows[typed].locator('.askback__text-input').fill(answered);
} else {
  const opt = await qRows[0].locator('[data-opt]').all();
  answered = await opt[0].innerText();
  await opt[0].click();
}
await form.locator('button[type=submit]').click();
await sleep(1500);
const sent = await page.evaluate(() => {
  const u = document.querySelectorAll('.msg--user .bubble');
  return u.length ? (u[u.length - 1].textContent || '').trim() : '';
});
check('답한 내용이 질문과 함께 전송된다 (ISS-036)', sent.includes('\u2192 ' + answered.trim()), sent.slice(0, 90));
await page.screenshot({ path: out + '/3-clarify.png' });

for (const r of results) console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? ' — ' + r.detail : ''));
console.log(JSON.stringify({ failed: results.filter((r) => !r.ok).length, errors, session: pwd }));
