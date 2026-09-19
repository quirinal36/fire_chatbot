/*
 * 도면 문·창 배치 회귀 시험
 * 실행: e2e/run-aside.sh plan-openings [WEB_BASE]
 *
 *  1. 창문 모드로 캔버스 여러 점을 클릭해 "벽을 뚫어 창"(벽 위)과 "창을 놓았습니다"(벽 사이 빈 틈)가 둘 다 나오는가
 *  2. 문 모드로 벽이 없는 자리를 끌면 문이 놓이는가
 *  3. 지우기 모드로 빈 자리의 문·창을 클릭하면 지워지는가
 *  4. 되돌리기가 문·창까지 되돌리는가
 * 달러 기호와 백틱은 쓰지 않는다 (셸이 그대로 넘긴다).
 */
const out = './artifacts/__NAME__';
const base = '__BASE__';
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

async function waitUntil(fn, ms, what) {
  const until = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() > until) { check(what, false, '기다리다 시간 초과'); return false; }
    await sleep(400);
  }
}
const statusText = () => page.evaluate(() => {
  const el = document.querySelector('.plan3d__status');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
});
const clearStatus = () => page.evaluate(() => { document.querySelector('.plan3d__status').textContent = ''; });
const undoDisabled = () => page.evaluate(() => document.querySelector('[data-action="undo"]').disabled);
const goStep = async (n) => { await page.locator('.plan3d__step[data-step="' + n + '"]').click(); await sleep(200); };
const setMode = async (m) => { await goStep(m === 'scale' ? 2 : 3); await page.locator('[data-action="mode"][data-mode="' + m + '"]').click(); await sleep(250); };
const clickAt = async (x, y) => { await clearStatus(); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await sleep(250); return statusText(); };
const dragAt = async (x0, y0, x1, y1) => { await clearStatus(); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 5 }); await page.mouse.up(); await sleep(250); return statusText(); };

await fs.mkdir(out, { recursive: true });
await openTab(base);
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
await page.evaluate(() => localStorage.setItem('fire-chatbot.widths', JSON.stringify({ sidebar: 200, panel: 760 })));
await page.reload();
await page.waitForSelector('.app[data-ready="true"]', { timeout: 20000 });
await page.locator('[data-action="toggle-panel"]').click();
await page.locator('.tab[data-tab="plan"]').click();
await page.waitForSelector('.plan3d', { timeout: 15000 });
const ready = await waitUntil(() => document.querySelector('.plan3d__areas') && !document.querySelector('.plan3d__areas').hidden, 40000, '예시 도면 분석');

if (ready) {
  const box = await page.locator('.plan3d__canvas canvas').boundingBox();
  const winBox = await page.evaluate(() => { const b = document.querySelector('.plan3d__window'); return b ? !b.hidden : null; });
  await setMode('window');
  const winBoxShown = await page.evaluate(() => !document.querySelector('.plan3d__window').hidden);
  check('창문 모드를 고르면 창 폭 입력이 보인다', winBox === false && winBoxShown, String(winBox) + ' -> ' + String(winBoxShown));

  // 1. 가로 한 줄을 촘촘히 눌러 벽 위(세로 벽을 지날 때)와 빈 틈 둘 다 찾는다. 격자로는 얇은 벽을 못 맞힌다
  let onWall = null;
  let inGap = null;
  let missed = 0;
  const probes = [];
  for (let i = 4; i < 60; i++) probes.push([box.x + (box.width * i) / 64, box.y + box.height * 0.5]);
  for (let i = 6; i < 42; i++) probes.push([box.x + box.width * 0.5, box.y + (box.height * i) / 48]);
  for (const [x, y] of probes) {
    const s = await clickAt(x, y);
    if (s.indexOf('벽을 뚫어 창') >= 0) { if (!onWall) onWall = { x, y, s }; }
    else if (s.indexOf('창') >= 0 && s.indexOf('놓았습니다') >= 0) { if (!inGap) inGap = { x, y, s }; }
    else missed++;
    if (onWall && inGap) break;
  }
  check('벽 위를 누르면 벽이 창으로 바뀐다', !!onWall, onWall ? onWall.s : '못 찾음 (빗나감 ' + missed + ')');
  check('벽 사이 빈 틈을 누르면 그 틈이 창이 된다', !!inGap, inGap ? inGap.s : '못 찾음 (빗나감 ' + missed + ')');
  await page.screenshot({ path: out + '/after-windows.png' });

  // 2. 문 모드로 벽 없는 자리를 끈다 — 도면 밖 여백(왼쪽 위 구석 근처)은 벽이 없다
  await setMode('door');
  const dx = box.x + box.width * 0.5;
  const dy = box.y + box.height * 0.5;
  let doorMsg = await dragAt(dx - 25, dy, dx + 25, dy);
  check('문 모드로 끌면 벽이 없어도 문이 놓인다', doorMsg.indexOf('문') >= 0 && (doorMsg.indexOf('놓았습니다') >= 0 || doorMsg.indexOf('냈습니다') >= 0), doorMsg);
  const doorFree = doorMsg.indexOf('놓았습니다') >= 0;

  // 3. 그 문을 지우기 모드로 클릭해 지운다 (빈 자리에 놓은 경우에만 문·창 지우기 경로다)
  await setMode('erase');
  const eraseMsg = await clickAt(dx, dy);
  check('지우기 모드로 문·창을 클릭하면 지워진다', doorFree ? eraseMsg.indexOf('문·창 하나를 지웠습니다') >= 0 : eraseMsg.indexOf('지웠습니다') >= 0, eraseMsg + (doorFree ? '' : ' (문이 벽 위였음)'));

  // 4. 되돌리기
  const before = await undoDisabled();
  await page.locator('[data-action="undo"]').click();
  await sleep(600);
  const undoMsg = await statusText();
  check('되돌리기가 문·창 편집도 되돌린다', before === false && undoMsg.indexOf('되돌렸습니다') >= 0, undoMsg);
  await page.screenshot({ path: out + '/after-undo.png' });
  await setMode('view');
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
console.log('결과: ' + (results.length - failed.length) + '/' + results.length + ' 통과');
console.log(JSON.stringify({ failed: failed.length, session: pwd }));
