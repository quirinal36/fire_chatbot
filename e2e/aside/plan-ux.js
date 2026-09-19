/*
 * 도면 UX 회귀 시험 (UX-001~UX-006 / ISS-047)
 * 실행: e2e/run-aside.sh plan-ux [WEB_BASE]
 *
 * 1. 출처 표시와 단계 안내. 예시 도면을 여는 것만으로 AI 를 부르지 않는다
 * 2. 축척 상태 네 가지가 면적 옆 문구와 맞는다 (가정·표준 어림·자동 인식·사용자 확인)
 * 3. 도면을 바꾸면 앞 도면의 늦은 응답이 새 도면의 수치·상태를 덮지 않는다
 * 4. 한도·연결 실패에 작업 이름과 복구 행동이 함께 나오고, 도면·편집은 그대로 남는다
 * 5. 그리다 취소하면 미완료 변경이 남지 않고, 완료한 편집은 되돌릴 수 있다
 *
 * 유료 호출을 반복하지 않으려고 치수 읽기 응답은 화면 안에서 대신 돌려준다.
 * 실제 AI 성공 경로는 e2e/aside/plan.js 로 한도가 허용될 때 따로 확인한다.
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const results = [];
const errors = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });
const t0 = Date.now();
const mark = (s) => console.log('[' + Math.round((Date.now() - t0) / 1000) + 's] ' + s);

async function waitUntil(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) { errors.push('기다리다 시간 초과: ' + what); return false; }
    await sleep(400);
  }
}

const areaText = () => page.evaluate(() => {
  const el = document.querySelector('.plan3d__scale-state');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const totalText = () => page.evaluate(() => {
  const el = document.querySelector('.plan3d__total');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const statusText = () => page.evaluate(() => {
  const el = document.querySelector('.plan3d__status');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const recovery = () => page.evaluate(() => Array.from(document.querySelectorAll('.plan3d__recovery button')).map((b) => b.textContent.trim()));
const setStub = (s) => page.evaluate((v) => { window.__stub = v; }, s);
const aiCalls = () => page.evaluate(() => window.__calls);

await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
await fs.mkdir(out, { recursive: true });

// 치수 읽기 응답을 화면 안에서 대신 돌려준다. 다른 요청은 그대로 서버로 간다
await page.evaluate(() => {
  const real = window.fetch;
  window.__stub = null;
  window.__calls = 0;
  window.fetch = async (...a) => {
    const url = typeof a[0] === 'string' ? a[0] : a[0].url;
    if (url.indexOf('/api/plans/scale') >= 0) {
      window.__calls++;
      const s = window.__stub;
      if (s) {
        if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
        if (s.network) throw new TypeError('Failed to fetch');
        if (s.status) {
          return new Response(JSON.stringify({ error: { code: s.code, message: s.message } }), {
            status: s.status,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(s.body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return real(...a);
  };
});

await page.locator('[data-action="toggle-panel"]').click();
await page.locator('.tab[data-tab="plan"]').click();
await page.waitForSelector('.plan3d', { timeout: 15000 });
await waitUntil(() => document.querySelector('.plan3d__areas') && !document.querySelector('.plan3d__areas').hidden, 40000, '예시 도면 분석');
mark('도면 탭 열림');

// 1. 출처·단계 안내와 AI 호출 없음
const origin = await page.evaluate(() => {
  const el = document.querySelector('.plan3d__origin');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const steps = await page.evaluate(() => Array.from(document.querySelectorAll('.plan3d__steps li')).length);
const todo = await page.evaluate(() => {
  const el = document.querySelector('.plan3d__todo');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('출처를 예시 도면으로 표시', origin.indexOf('예시 도면') === 0 && origin.indexOf('default.png') > 0, origin);
check('진행 단계 4개와 지금 할 일 표시', steps === 4 && todo.indexOf('지금 할 일') === 0, steps + ' / ' + todo.slice(0, 40));
check('예시 도면 진입만으로 AI 를 부르지 않음', (await aiCalls()) === 0, '호출 ' + (await aiCalls()) + '회');

// 2. 축척 상태 네 가지
check('가정 상태 문구', (await areaText()).indexOf('임시 추정') === 0, await areaText());

await setStub({ body: { estimate: null, guess: { pxPerMeter: 80, used: 3, spread: 0.1, basis: '문 폭 0.9m' }, note: '치수선 없음', model: 'stub', usage: {}, latencyMs: 1 } });
await page.locator('[data-action="scale-read"]').click();
await waitUntil(() => document.querySelector('.plan3d__scale-state').textContent.indexOf('추정 · 표준 치수 기준') >= 0, 15000, '표준 치수 어림');
check('표준 치수 어림 상태 문구', (await areaText()).indexOf('추정 · 표준 치수 기준') >= 0, await areaText());

await setStub({ body: { estimate: { pxPerMeter: 100, used: 4, total: 6, spread: 0.02, labels: ['3600', '2400'] }, guess: null, note: '', model: 'stub', usage: {}, latencyMs: 1 } });
await page.locator('[data-action="scale-read"]').click();
await waitUntil(() => document.querySelector('.plan3d__scale-state').textContent.indexOf('자동 인식 · 확인 필요') >= 0, 15000, '자동 인식');
check('자동 인식 상태 문구와 확인 버튼', (await areaText()).indexOf('자동 인식 · 확인 필요') >= 0, await areaText());
const approxBefore = (await totalText()).indexOf('약') >= 0;
await page.locator('[data-action="scale-confirm"]').click();
await sleep(600);
check('확인 전에는 약, 확인 뒤에는 약이 사라짐', approxBefore && (await totalText()).indexOf('약') < 0, await totalText());
check('사용자 확인 상태 문구', (await areaText()).indexOf('사용자 확인') >= 0, await areaText());
mark('축척 상태 4종 확인');

// 3. 도면을 바꾸는 사이에 도착한 앞 도면의 응답은 버린다
await setStub({ delay: 4000, body: { estimate: { pxPerMeter: 999, used: 9, total: 9, spread: 0, labels: ['덮어쓰기'] }, guess: null, note: '', model: 'stub', usage: {}, latencyMs: 1 } });
await page.locator('[data-action="scale-read"]').click();
await sleep(500);
await page.locator('[data-action="default"]').click();
await waitUntil(() => document.querySelector('.plan3d__scale-state').textContent.indexOf('임시 추정') >= 0, 30000, '새 도면 적재');
await sleep(5000);
check('교체 뒤 늦게 온 응답이 새 도면을 덮지 않음', (await areaText()).indexOf('임시 추정') === 0, await areaText());
mark('늦은 응답 확인');

// 4. 실패 안내와 데이터 보존
const beforeFail = await totalText();
await setStub({ status: 429, code: 'rate_limited_anon', message: '오늘 이용 한도에 도달했습니다. 로그인하면 더 이용할 수 있습니다.' });
await page.locator('[data-action="scale-read"]').click();
await waitUntil(() => document.querySelector('.plan3d__status').textContent.indexOf('한도') >= 0, 15000, '한도 안내');
const limitButtons = await recovery();
check('한도 안내에 작업 이름이 붙는다', (await statusText()).indexOf('자동 치수 읽기 이용 한도') >= 0, await statusText());
check('한도에 로그인과 직접 입력을 함께 준다', limitButtons.join(',') === '로그인,직접 길이 입력', limitButtons.join(','));

await setStub({ network: true });
await page.locator('[data-action="scale-read"]').click();
await waitUntil(() => document.querySelector('.plan3d__status').textContent.indexOf('연결하지 못했습니다') >= 0, 15000, '연결 실패 안내');
const netButtons = await recovery();
check('연결 실패에 다시 읽기를 준다', netButtons.indexOf('다시 읽기') >= 0, netButtons.join(','));
check('실패해도 면적과 도면이 그대로 남는다', (await totalText()) === beforeFail, await totalText());
mark('실패 안내 확인');

// 5. 그리다 취소 / 되돌리기
await setStub(null);
const box = await page.locator('.plan3d__canvas canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.locator('[data-action="mode"][data-mode="add"]').click();
await sleep(300);
await page.mouse.move(cx - 60, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy, { steps: 6 });
await sleep(300);
await page.keyboard.press('Escape');
await sleep(300);
await page.mouse.up();
await sleep(1200);
const afterCancel = await totalText();
const undoDisabled = await page.evaluate(() => document.querySelector('[data-action="undo"]').disabled);
check('그리다 취소하면 미완료 변경이 남지 않는다', afterCancel === beforeFail && undoDisabled, afterCancel + ' / 되돌리기 ' + (undoDisabled ? '비활성' : '활성'));

await page.locator('[data-action="mode"][data-mode="add"]').click();
await sleep(300);
await page.mouse.move(cx - 60, cy + 20);
await page.mouse.down();
await page.mouse.move(cx + 60, cy + 20, { steps: 6 });
await page.mouse.up();
await waitUntil(() => document.querySelector('[data-action="undo"]').disabled === false, 15000, '벽 추가');
// 방 면적은 편집 뒤 잠깐 있다가 다시 잰다. 되돌리기가 살아난 것만 보고 읽으면 옛 값이 잡힌다
await sleep(1500);
const afterAdd = await totalText();
await page.locator('[data-action="undo"]').click();
await sleep(1800);
const backDisabled = await page.evaluate(() => document.querySelector('[data-action="undo"]').disabled);
check('완료한 편집은 되돌릴 수 있다', (await totalText()) === afterCancel && backDisabled, afterAdd + ' -> ' + (await totalText()) + ' / 되돌리기 ' + (backDisabled ? '비활성' : '활성'));

// 편집하면 인식 결과 확인이 풀린다
const stepThree = await page.evaluate(() => {
  const li = document.querySelectorAll('.plan3d__steps li')[2];
  return li ? li.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('편집 뒤 인식 결과를 다시 확인하게 한다', stepThree.indexOf('확인 필요') >= 0 || stepThree.indexOf('다시 확인') >= 0, stepThree);
mark('편집 취소·되돌리기 확인');

await page.screenshot({ path: out + '/plan-ux.png' });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
if (errors.length) console.log('오류: ' + errors.join(' | '));
console.log('결과: ' + (results.length - failed.length) + '/' + results.length + ' 통과');
console.log(JSON.stringify({ failed: results.filter((r) => !r.ok).length, session: pwd }));
