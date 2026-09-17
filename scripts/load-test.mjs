/**
 * 100개 질문 부하·비용 측정 (ISS-027) + 인용 접근성 검사 (ISS-028)
 *
 *   node scripts/load-test.mjs [API_BASE] [--count 100] [--concurrency 3]
 *
 * 실제 모델을 부른다. 질문 1건당 약 $0.007. 결과는 evals/load/<일시>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { readEnv } from './lib/env.mjs';
import { runSql } from './db-migrate.mjs';

const env = readEnv();
const args = process.argv.slice(2);
const API = args.find((a) => a.startsWith('http')) ?? 'https://fire-chatbot-server.vercel.app';
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const COUNT = opt('--count', 100);
const CONCURRENCY = opt('--concurrency', 3);
const ROOT = path.resolve(import.meta.dirname, '..');

const evalQs = fs
  .readFileSync(path.join(ROOT, 'evals/search/questions.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l).question);
const extra = [
  '우리 학원은 2층에 있는데 피난기구가 필요한가요?',
  '학원 강의실 바닥면적이 95제곱미터면 수용인원은 몇 명인가요?',
  '지하 1층에 학원을 열려고 합니다. 어떤 소방시설을 확인해야 하나요?',
  '학원에 비상조명등이 꼭 있어야 하나요?',
  '학원 인테리어할 때 방염 처리가 필요한가요?',
  '소화기는 몇 개나 두어야 하나요?',
  '유도등은 어디에 설치하나요?',
  '감지기 종류는 어떤 것이 있나요?',
  '다중이용업소가 되면 무엇을 갖춰야 하나요?',
  '소방시설 자체점검은 누가 해야 하나요?',
  '간이스프링클러와 스프링클러의 차이는 무엇인가요?',
  '학원 창문이 거의 없으면 무창층인가요?',
  '피난층이 무슨 뜻인가요?',
  '근린생활시설 바닥면적 합계는 어떻게 계산하나요?',
  '시각경보기는 청각장애인을 위한 설비인가요?',
  '소방시설법 시행령 제7조 건축허가 동의 대상',
  'NFTC 303 피난구유도등 설치 위치',
  'NFPC 304 휴대용비상조명등 설치 기준',
  '비상벨설비 발신기 설치 높이',
  '옥내소화전 방수구 설치 기준',
  '학원에 스프링클러 헤드가 이미 있는데 점검은 어떻게 하나요?',
  '건축물대장에서 연면적은 어디서 보나요?',
  '4층 건물 3층 학원 자동화재탐지설비',
  '학원 수용인원이 120명이고 같은 건물에 노래방이 있어요',
  '용도변경 신고 전에 소방 검토가 필요한가요?',
  '소방안전교육은 누가 받아야 하나요?',
  '화재배상책임보험은 학원도 가입해야 하나요?',
  '학원 비상구 기준이 있나요?',
  '누전경보기 설치 대상',
  '가스누설경보기는 학원에도 필요한가요?',
  '자동화재속보설비 설치 대상인가요?',
  '소화기 압력 점검 주기',
  '스프링클러 설치 제외 장소',
  '피난기구 종류 완강기',
  '학원 계단에 유도표지를 붙여야 하나요?',
];
const questions = [...evalQs, ...extra].slice(0, COUNT);

async function anon() {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return (await r.json()).access_token;
}

// 비회원 하루 한도(30)를 넘지 않게 사용자 여러 명으로 나눈다
const tokens = await Promise.all(Array.from({ length: Math.ceil(COUNT / 25) }, anon));
const runTag = `load-${Date.now()}`;
const results = [];

async function ask(i) {
  const token = tokens[Math.floor(i / 25)];
  const body = { sessionId: crypto.randomUUID(), clientRequestId: `${runTag}-${i}`, question: questions[i] };
  const t0 = Date.now();
  let firstStatus = null;
  const res = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  const answer = text.split('\n\n').find((b) => b.startsWith('event: answer'));
  const error = text.split('\n\n').find((b) => b.startsWith('event: error'));
  if (text.includes('event: status')) firstStatus = 'ok';
  const envelope = answer ? JSON.parse(answer.split('\ndata: ')[1]).envelope : null;

  // 인용한 근거가 모두 조회되는지
  let inaccessible = 0;
  const cited = new Set((envelope?.answer.statements ?? []).flatMap((s) => s.sourceIds));
  for (const s of envelope?.sources ?? []) {
    if (!cited.has(s.ref)) continue;
    const r = await fetch(`${API}/api/sources/${s.id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 200) inaccessible += 1;
  }
  const unknownRefs = [...cited].filter((ref) => !(envelope?.sources ?? []).some((s) => s.ref === ref)).length;
  results.push({
    i,
    question: questions[i],
    http: res.status,
    ms,
    streamed: firstStatus,
    status: envelope?.status ?? null,
    error: error ? JSON.parse(error.split('\ndata: ')[1]) : res.ok ? null : text.slice(0, 200),
    statements: envelope?.answer.statements.length ?? 0,
    sources: envelope?.sources.length ?? 0,
    cited: cited.size,
    inaccessible,
    unknownRefs,
  });
  process.stdout.write(`${i + 1}/${questions.length} ${envelope?.status ?? 'error'} ${ms}ms\n`);
}

let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < questions.length) await ask(next++);
  }),
);

const runs = await runSql(`
  select r.status, r.model, r.input_tokens, r.output_tokens, r.embedding_tokens, r.cost_usd, r.latency_ms, r.attempts, r.error_code,
         r.input_snapshot->>'searchStatus' as search_status, jsonb_array_length(coalesce(r.input_snapshot->'validationErrors', '[]')) as validation_errors
  from answer_runs r join chat_messages m on m.answer_run_id = r.id and m.role = 'user'
  where m.client_request_id like '${runTag}-%'`);

const nums = (k) => runs.map((r) => Number(r[k] ?? 0)).sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const modelRuns = runs.filter((r) => Number(r.input_tokens) > 0);
const summary = {
  api: API,
  runTag,
  questions: questions.length,
  concurrency: CONCURRENCY,
  recorded: runs.length,
  statuses: Object.fromEntries(Object.entries(results.reduce((m, r) => ({ ...m, [r.status ?? 'error']: (m[r.status ?? 'error'] ?? 0) + 1 }), {}))),
  httpErrors: results.filter((r) => r.http !== 200 || r.error).length,
  modelCalls: modelRuns.length,
  tokens: {
    inputAvg: Math.round(avg(modelRuns.map((r) => Number(r.input_tokens)))),
    inputP95: pct(modelRuns.map((r) => Number(r.input_tokens)).sort((a, b) => a - b), 0.95),
    outputAvg: Math.round(avg(modelRuns.map((r) => Number(r.output_tokens)))),
    outputP95: pct(modelRuns.map((r) => Number(r.output_tokens)).sort((a, b) => a - b), 0.95),
    embeddingAvg: Math.round(avg(nums('embedding_tokens'))),
  },
  costUsd: {
    total: Number(nums('cost_usd').reduce((a, b) => a + b, 0).toFixed(5)),
    avgPerQuestion: Number(avg(nums('cost_usd')).toFixed(6)),
    p95PerQuestion: Number(pct(nums('cost_usd'), 0.95).toFixed(6)),
  },
  latencyMs: {
    clientP50: pct(results.map((r) => r.ms).sort((a, b) => a - b), 0.5),
    clientP95: pct(results.map((r) => r.ms).sort((a, b) => a - b), 0.95),
    serverP95: pct(nums('latency_ms'), 0.95),
  },
  retries: runs.filter((r) => Number(r.attempts) > 1).length,
  validationFailures: runs.filter((r) => Number(r.validation_errors) > 0).length,
  errorCodes: runs.reduce((m, r) => (r.error_code ? { ...m, [r.error_code]: (m[r.error_code] ?? 0) + 1 } : m), {}),
  citations: {
    cited: results.reduce((a, r) => a + r.cited, 0),
    inaccessible: results.reduce((a, r) => a + r.inaccessible, 0),
    unknownRefs: results.reduce((a, r) => a + r.unknownRefs, 0),
  },
};
const dir = path.join(ROOT, 'evals/load');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${runTag}.json`);
fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`결과: ${path.relative(ROOT, file)}`);
