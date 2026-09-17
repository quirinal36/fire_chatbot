/**
 * ISS-003 · 법령 API 연결 시험 (기획서 §4.3)
 *
 * 실행: node scripts/law-api-poc.mjs
 * 필요: .env 의 API_AUTHKEY (law.go.kr OC 값)
 *
 * 이 스크립트는 읽기 전용이다. 응답을 저장하지 않고 계약 위반만 보고한다.
 * fixture 는 tests/fixtures/law-api/ 에 이미 저장되어 있다.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = 'https://www.law.go.kr/DRF';

function readEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) throw new Error('.env 가 없습니다. .env.example 을 복사해 API_AUTHKEY 를 채우세요.');
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  if (!env.API_AUTHKEY) throw new Error('.env 에 API_AUTHKEY 가 비어 있습니다.');
  return env;
}

const env = readEnv();
const OC = env.API_AUTHKEY;

/** 로그·저장 전에 인증값을 지운다. 목록 응답의 *상세링크 필드에 OC 가 그대로 담겨 온다. */
export const stripOC = (s) =>
  String(s).split(OC).join('<OC>').replace(/([?&]OC=)[^&"'\s]+/gi, '$1<OC>');

async function call(target, kind, params) {
  const p = kind === 'search' ? '/lawSearch.do' : '/lawService.do';
  const u = new URL(BASE + p);
  u.searchParams.set('OC', OC);
  u.searchParams.set('target', target);
  u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const t0 = Date.now();
  const res = await fetch(u, { headers: { 'User-Agent': 'fire-chatbot-poc/0.1' } });
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();
  const ms = Date.now() - t0;

  // 계약 검증: HTTP 200 만으로 성공이라고 판단하지 않는다.
  const fail = (why) => ({ ok: false, why, status: res.status, ct, ms });
  if (!res.ok) return fail('HTTP ' + res.status);
  if (/^\s*<(!doctype|html)/i.test(body)) return fail('HTML 응답 (오류 페이지 가능성)');
  if (!ct.includes('json')) return fail('Content-Type 이 JSON 이 아님: ' + ct);

  let json;
  try { json = JSON.parse(body); } catch (e) { return fail('JSON parse 실패: ' + e.message); }

  // 인증 실패도 HTTP 200 + JSON 으로 온다.
  if (json.result && json.msg) return fail('API 오류: ' + json.result);

  const root = Object.values(json)[0];
  if (kind === 'search') {
    if (root?.resultCode !== '00') return fail('resultCode ' + root?.resultCode);
    const list = Object.values(root).find(Array.isArray) || [];
    return { ok: true, ms, totalCnt: Number(root.totalCnt), got: list.length, root, list };
  }
  return { ok: true, ms, bytes: body.length, root };
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// 1. 현행법령 목록 → 본문 (ID, 그리고 MST+efYd)
const lawList = await call('eflaw', 'search',
  { nw: 3, search: 1, query: '소방시설 설치 및 관리에 관한 법률', display: 5, page: 1 });
check('현행법령 목록', lawList.ok, lawList.ok ? `totalCnt ${lawList.totalCnt}` : lawList.why);

if (lawList.ok) {
  const setup = lawList.list.find((l) => l.법령명한글.includes('시행령')) || lawList.list[0];
  const byId = await call('eflaw', 'service', { ID: setup.법령ID });
  check('법령 본문 (ID)', byId.ok, byId.ok ? `${byId.bytes} bytes` : byId.why);

  // 목록이 돌려준 시행일을 쓴다. 오늘 날짜를 넣지 않는다.
  const byMst = await call('eflaw', 'service', { MST: setup.법령일련번호, efYd: setup.시행일자 });
  check('법령 본문 (MST + efYd)', byMst.ok, byMst.ok ? `efYd ${setup.시행일자}` : byMst.why);

  if (byId.ok) {
    const law = byId.root;
    const jo = law.조문?.조문단위 ?? [];
    const byl = law.별표?.별표단위 ?? [];
    check('조문 단위 존재', jo.length > 0, `${jo.length} 개`);
    check('부칙 단위 존재', (law.부칙?.부칙단위 ?? []).length > 0);
    // 별표번호는 "0004" 처럼 4자리 제로패딩 문자열이다. 숫자 비교를 하지 않는다.
    const b4 = byl.find((b) => b.별표번호 === '0004');
    check('시행령 별표 4 본문', Boolean(b4), b4 ? b4.별표제목.slice(0, 40) : '없음');

    const echoed = JSON.stringify(lawList.root).includes(OC);
    check('목록 응답에 OC 미포함', !echoed,
      echoed ? '⚠ *상세링크 필드에 OC 가 echo 됨 — 저장 전 stripOC 필수' : '');
  }
}

// 2. 행정규칙 (NFPC/NFTC). 현행 구분값이 법령의 nw=3 과 다르다.
const adm = await call('admrul', 'search',
  { nw: 1, query: '스프링클러설비의 화재안전성능기준', display: 5, page: 1 });
check('행정규칙 목록 (nw=1)', adm.ok, adm.ok ? `totalCnt ${adm.totalCnt}` : adm.why);
if (adm.ok && adm.list.length) {
  const body = await call('admrul', 'service', { ID: adm.list[0].행정규칙일련번호 });
  check('행정규칙 본문', body.ok, body.ok ? `${body.bytes} bytes` : body.why);
  if (body.ok) {
    const s = body.root;
    check('행정규칙 조문내용', (s.조문내용 ?? []).length > 0, `${(s.조문내용 ?? []).length} 개`);
    // 법령은 별표단위가 배열, 행정규칙은 단일 객체다. 같은 파서를 쓰지 않는다.
    const shape = Array.isArray(s.별표?.별표단위) ? 'array' : typeof s.별표?.별표단위;
    check('행정규칙 별표 형태 확인', true, `별표단위 = ${shape} (법령은 array)`);
  }
}

// 3. 별표 검색. 기본 section 은 별표명(bylNm) 이므로 법령명으로 찾으려면 search=2.
const byl = await call('licbyl', 'search',
  { search: 2, query: '소방시설 설치 및 관리에 관한 법률 시행령', display: 10 });
check('법령 별표 검색 (search=2, 법령명)', byl.ok && byl.totalCnt > 0,
  byl.ok ? `totalCnt ${byl.totalCnt}` : byl.why);

// 4. 소방청 해석
const expc = await call('nfaCgmExpc', 'search', { query: '소방시설', display: 5 });
check('소방청 해석 목록', expc.ok, expc.ok ? `totalCnt ${expc.totalCnt}` : expc.why);
if (expc.ok && expc.list.length) {
  const body = await call('nfaCgmExpc', 'service', { ID: expc.list[0].법령해석일련번호 });
  check('해석 본문', body.ok, body.ok ? `${body.bytes} bytes` : body.why);
  if (body.ok) {
    const s = body.root;
    check('해석 질의요지', Boolean(s.질의요지?.trim()));
    check('해석 회답', Boolean(s.회답?.trim()));
    check('해석 이유', Boolean(s.이유?.trim()), s.이유?.trim() ? '' : '⚠ 비어 있음 (기획서 §4.3-5 미충족)');
  }
}

// 5. 인증 실패의 형태. HTTP 200 + JSON {result, msg} 로 온다.
const badUrl = new URL(BASE + '/lawSearch.do');
badUrl.search = new URLSearchParams(
  { OC: 'zzzz_invalid_zzzz', target: 'eflaw', type: 'JSON', nw: 3, search: 1, query: '소방', display: 1 });
const badRes = await fetch(badUrl);
const badBody = await badRes.text();
let badJson = null;
try { badJson = JSON.parse(badBody); } catch { /* ignore */ }
check('인증 실패가 HTTP 200 + JSON 오류로 옴', badRes.status === 200 && Boolean(badJson?.result),
  `status ${badRes.status}, result="${badJson?.result ?? '?'}"`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (failed.length) {
  console.log('실패:', failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
