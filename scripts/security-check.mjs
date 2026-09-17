/**
 * 권한·비밀값 교차 검증 (ISS-025)
 *
 *   node scripts/security-check.mjs [API_BASE] [WEB_BASE]
 *   기본: https://fire-chatbot-server.vercel.app https://fire-chatbot-web.vercel.app
 *
 * 모델을 부르지 않는다(비용 없음). 사용자 A 가 대화·사례·신고를 만들고, 사용자 B·비회원·브라우저 권한으로
 * 접근이 막히는지 확인한다. 결과는 표준 출력과 종료 코드로 알린다.
 */
import { readEnv } from './lib/env.mjs';
import { runSql } from './db-migrate.mjs';

const env = readEnv();
const API = process.argv[2] ?? 'https://fire-chatbot-server.vercel.app';
const WEB = process.argv[3] ?? 'https://fire-chatbot-web.vercel.app';
const SB = env.SUPABASE_URL;
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function anonToken() {
  const r = await fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json();
  return { token: j.access_token, id: j.user.id };
}

const call = (path, token, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });

const a = await anonToken();
const b = await anonToken();

// 사용자 A 의 자원을 DB 에 직접 만든다 (모델 호출 없이)
const sessionId = crypto.randomUUID();
await runSql(`
  insert into chat_sessions (id, owner_id, title) values ('${sessionId}', '${a.id}', '보안 점검');
  with u as (
    insert into chat_messages (session_id, role, content, client_request_id, status)
    values ('${sessionId}', 'user', '{"text":"보안 점검"}', 'sec-${Date.now()}', 'completed') returning id
  )
  insert into chat_messages (session_id, role, content, status, reply_to)
  select '${sessionId}', 'assistant', '{"status":"answered"}', 'completed', id from u;
`);
const [{ id: answerId }] = await runSql(`select id from chat_messages where session_id = '${sessionId}' and role = 'assistant'`);
const caseRes = await call('/api/cases', a.token, { method: 'POST', body: JSON.stringify({ sessionId }) });
const caseId = (await caseRes.json()).id;
check('사용자 A 가 자기 사례를 만든다', caseRes.status === 201);

// 1. 타 세션 접근 -----------------------------------------------------------
const own = await call(`/api/sessions/${sessionId}/messages`, a.token);
check('소유자는 자기 대화를 본다', own.status === 200);
for (const [name, path, init] of [
  ['타인 대화 조회', `/api/sessions/${sessionId}/messages`, {}],
  ['타인 사례 조회', `/api/cases/${caseId}`, {}],
  ['타인 사례 수정', `/api/cases/${caseId}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, fields: { capacity: { value: 1, state: 'user_confirmed' } } }) }],
  ['타인 사례에 후보 추출', `/api/cases/${caseId}/extract`, { method: 'POST', body: JSON.stringify({ text: '3층' }) }],
  ['타인 답변 신고', '/api/feedback', { method: 'POST', body: JSON.stringify({ messageId: answerId, category: 'other' }) }],
  ['타인 대화에 질문', '/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, clientRequestId: `sec-b-${Date.now()}`, question: '남의 대화에 질문' }) }],
]) {
  const r = await call(path, b.token, init);
  check(`${name} 차단`, r.status === 404, `HTTP ${r.status}`);
}
const listB = await (await call('/api/sessions', b.token)).json();
check('대화 목록에 타인 대화가 없다', !listB.sessions.some((s) => s.id === sessionId));

// 2. 인증 없음·위조 ---------------------------------------------------------
for (const [name, token] of [['토큰 없음', null], ['위조 토큰', `${a.token.slice(0, -4)}AAAA`], ['다른 서명 JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc']]) {
  const r = await call('/api/sessions', token);
  check(`${name} 거부`, r.status === 401, `HTTP ${r.status}`);
}

// 3. 관리자 API · Cron ------------------------------------------------------
for (const p of ['/api/admin/overview', '/api/admin/reviews', '/api/admin/runs', '/api/admin/feedback', '/api/admin/ingestion', '/api/admin/metrics', '/api/admin/source-files', '/api/admin/me']) {
  const r = await call(p, a.token);
  check(`비회원의 ${p} 차단`, r.status === 403, `HTTP ${r.status}`);
}
const post = await call('/api/admin/reviews/00000000-0000-0000-0000-000000000000', a.token, {
  method: 'POST',
  body: JSON.stringify({ subjectType: 'rule_set', action: 'approve', reason: '권한 없는 승인 시도' }),
});
check('비회원의 승인 요청 차단', post.status === 403, `HTTP ${post.status}`);
const cron = await call('/api/cron/ingestion', a.token);
check('사용자 토큰으로 Cron 실행 차단', cron.status === 401 || cron.status === 404, `HTTP ${cron.status}`);
const diag = await call('/api/diagnostics/law-api', a.token);
check('사용자 토큰으로 진단 경로 차단', diag.status === 401 || diag.status === 404, `HTTP ${diag.status}`);

// 4. 브라우저 권한(Publishable key)으로 DB 직접 접근 ---------------------------
const rest = (path, init = {}, token = PUB) =>
  fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: PUB, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
for (const t of ['chat_sessions', 'chat_messages', 'building_cases', 'feedback', 'answer_runs', 'ingestion_jobs', 'admin_users', 'search_chunks', 'source_files', 'rule_sets', 'usage_counters', 'embedding_cache', 'review_events']) {
  const r = await rest(`${t}?select=*&limit=1`, {}, a.token);
  check(`로그인 사용자가 ${t} 직접 조회 불가`, r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
const ins = await rest('legal_versions', { method: 'POST', body: JSON.stringify({ document_id: crypto.randomUUID(), source_version_id: 'x', content_hash: 'x' }) }, a.token);
check('브라우저 권한으로 법령 쓰기 불가', ins.status >= 400, `HTTP ${ins.status}`);
const docs = await (await rest('legal_documents?select=source_type')).json();
check('공개 corpus 조회에 내부 자료가 없다', Array.isArray(docs) && !docs.some((d) => d.source_type === 'internal'), `${docs.length}건`);
const units = await (await rest('legal_units?select=id,legal_versions!inner(review_status)&legal_versions.review_status=neq.published&limit=1')).json();
check('미게시 버전 단위가 공개 조회되지 않는다', Array.isArray(units) && units.length === 0);
for (const fn of ['search_keyword', 'search_vector', 'evidence_bundle', 'ingest_version', 'publish_version', 'claim_job', 'consume_request_quota', 'begin_chat_request', 'review_rule_set', 'usage_metrics']) {
  const r = await rest(`rpc/${fn}`, { method: 'POST', body: '{}' }, a.token);
  check(`브라우저 권한으로 ${fn} 실행 불가`, r.status === 401 || r.status === 403 || r.status === 404, `HTTP ${r.status}`);
}
const storage = await fetch(`${SB}/storage/v1/object/list/raw-sources`, {
  method: 'POST',
  headers: { apikey: PUB, Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: 'law', limit: 1 }),
});
const listed = storage.ok ? await storage.json() : [];
check('원문 버킷 목록 조회 불가', !storage.ok || (Array.isArray(listed) && listed.length === 0), `HTTP ${storage.status}`);
const pub = await fetch(`${SB}/storage/v1/object/public/raw-sources/law/009694`);
check('원문 버킷 공개 URL 불가', pub.status >= 400, `HTTP ${pub.status}`);

// 5. CORS -----------------------------------------------------------------
const cors = await fetch(`${API}/api/health`, { headers: { Origin: 'https://evil.example' } });
check('허용되지 않은 오리진에 CORS 헤더 없음', cors.headers.get('access-control-allow-origin') === null);

// 6. 비밀값이 브라우저 번들·응답에 없다 -------------------------------------------
const secrets = ['API_AUTHKEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'DIAGNOSTICS_TOKEN', 'CRON_SECRET']
  .map((k) => [k, env[k]])
  .filter(([, v]) => v && v.length >= 6);
const html = await (await fetch(WEB)).text();
const adminHtml = await (await fetch(`${WEB}/admin.html`)).text();
const assets = [...new Set([...html.matchAll(/\/assets\/[^"']+\.js/g), ...adminHtml.matchAll(/\/assets\/[^"']+\.js/g)].map((m) => m[0]))];
let bundle = html + adminHtml;
for (const a2 of assets) bundle += await (await fetch(`${WEB}${a2}`)).text();
for (const [k, v] of secrets) check(`브라우저 번들에 ${k} 없음`, !bundle.includes(v));
check('브라우저 번들에 secret 형식 키 없음', !/sb_secret_|sk-or-v1-|sk-proj-/.test(bundle));
const health = await (await fetch(`${API}/api/health?deep=1`)).text();
for (const [k, v] of secrets) check(`상태 응답에 ${k} 없음`, !health.includes(v));

// 7. 저장된 원문·링크에 OC 가 없다 ---------------------------------------------
const [oc] = await runSql(`select
  (select count(*) from legal_versions where source_url ~* '[?&]oc=') as urls,
  (select count(*) from legal_units where text ilike '%' || ${`'${(env.API_AUTHKEY ?? 'x').replaceAll("'", "''")}'`} || '%') as units`);
check('저장된 버전 링크에 OC 없음', Number(oc.urls) === 0);
check('저장된 조문에 인증값 없음', Number(oc.units) === 0);

// 정리
await runSql(`delete from chat_sessions where id = '${sessionId}'; delete from building_cases where id = '${caseId}';`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length}건 중 실패 ${failed}건 · 대상 ${API}`);
process.exit(failed ? 1 : 0);
