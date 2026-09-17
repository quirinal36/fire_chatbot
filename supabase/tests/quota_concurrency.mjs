// ISS-026 동시 요청에서 한도를 넘지 않는지: 같은 범위로 30개를 동시에 요청하고 한도 5 에서 정확히 5개만 통과해야 한다
// 실행: node supabase/tests/quota_concurrency.mjs
import { readEnv } from '../../scripts/lib/env.mjs';
import { runSql } from '../../scripts/db-migrate.mjs';

const env = readEnv();
const scope = `concurrency-test-${Date.now()}`;
const call = () =>
  fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_request_quota`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_scope: scope, p_limit: 5 }),
  }).then((r) => r.json());
const results = await Promise.all(Array.from({ length: 30 }, call));
const passed = results.filter((r) => r === true).length;
await runSql(`delete from usage_counters where scope = '${scope}'`);
console.log(passed === 5 ? `PASS 30개 동시 요청 중 ${passed}개 통과` : `FAIL ${passed}개 통과 ${JSON.stringify(results.slice(0, 3))}`);
process.exit(passed === 5 ? 0 : 1);
