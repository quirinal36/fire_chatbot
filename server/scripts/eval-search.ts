/**
 * 검색 평가 (ISS-012)
 *
 *   npm run eval-search                 # 정확·키워드·벡터·결합 비교
 *   npm run eval-search -- --modes hybrid
 *
 * 결과: evals/search/results/<일시>.json, 요약은 표준 출력
 */
import './_env';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { adminClient } = await import('@/lib/supabase');
const { search } = await import('@/lib/retrieval/search');
const { matchesExpected, docKeyOf } = await import('@/lib/retrieval/eval');

const ROOT = resolve(import.meta.dirname, '..', '..');
const TOP_K = 10;

interface Question {
  id: string;
  question: string;
  category: string;
  expected: string[][];
  expectStatus?: string;
  mustNotLocator?: string;
  review: string;
}

const questions: Question[] = readFileSync(resolve(ROOT, 'evals/search/questions.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const MODES = {
  exact: ['exact'],
  keyword: ['keyword'],
  vector: ['vector'],
  hybrid: ['exact', 'keyword', 'vector'],
} as const;

const args = process.argv.slice(2);
const at = args.indexOf('--modes');
const modeNames = (at >= 0 ? args[at + 1]!.split(',') : Object.keys(MODES)) as (keyof typeof MODES)[];

const db = adminClient();
const { data: versionRows } = await db
  .from('legal_versions')
  .select('id, source_version_id, parser_version, legal_documents!inner(title, code, source_type, source_document_id)')
  .eq('review_status', 'published');
const { count: chunkCount } = await db.from('search_chunks').select('id', { count: 'exact', head: true });

const report: Record<string, unknown> = {
  runAt: new Date().toISOString(),
  topK: TOP_K,
  corpus: {
    versions: versionRows?.length ?? 0,
    parserVersions: [...new Set((versionRows ?? []).map((v) => v.parser_version))],
    chunks: chunkCount,
  },
  modes: {},
};

for (const mode of modeNames) {
  const rows = [];
  let recallSum = 0;
  let recallN = 0;
  let hits = 0;
  let statusOk = 0;
  let statusN = 0;
  const latencies: number[] = [];

  for (const q of questions) {
    const t0 = Date.now();
    const result = await search(db, q.question, { finalCount: TOP_K, modes: MODES[mode] });
    latencies.push(Date.now() - t0);
    const got = result.evidence.map((e) => ({ doc: docKeyOf(e), locator: e.locator }));

    let matched = 0;
    for (const group of q.expected) if (group.some((exp) => got.some((g) => matchesExpected(exp, g)))) matched += 1;
    const recall = q.expected.length ? matched / q.expected.length : null;
    if (recall !== null) {
      recallSum += recall;
      recallN += 1;
      if (recall === 1) hits += 1;
    }

    let statusPass: boolean | null = null;
    if (q.expectStatus) {
      statusN += 1;
      statusPass = result.status === q.expectStatus;
      if (statusPass) statusOk += 1;
    }
    if (q.mustNotLocator) {
      statusN += 1;
      statusPass = !got.some((g) => g.locator === q.mustNotLocator);
      if (statusPass) statusOk += 1;
    }

    rows.push({
      id: q.id,
      category: q.category,
      recall,
      status: result.status,
      statusPass,
      top: got.slice(0, 5).map((g) => `${g.doc}:${g.locator}`),
      missing: q.expected.filter((group) => !group.some((exp) => got.some((g) => matchesExpected(exp, g)))),
    });
  }

  latencies.sort((a, b) => a - b);
  const summary = {
    recallAt10: Number((recallSum / recallN).toFixed(3)),
    fullHitRate: Number((hits / recallN).toFixed(3)),
    statusChecks: `${statusOk}/${statusN}`,
    p50ms: latencies[Math.floor(latencies.length * 0.5)],
    p95ms: latencies[Math.floor(latencies.length * 0.95)],
  };
  (report.modes as Record<string, unknown>)[mode] = { summary, rows };
  console.log(`${mode.padEnd(8)} ${JSON.stringify(summary)}`);
}

const dir = resolve(ROOT, 'evals/search/results');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`결과: ${file}`);

const hybrid = (report.modes as Record<string, { rows: { id: string; recall: number | null; statusPass: boolean | null; missing: string[][]; top: string[] }[] }>).hybrid;
if (hybrid) {
  for (const r of hybrid.rows.filter((x) => (x.recall !== null && x.recall < 1) || x.statusPass === false)) {
    console.log(`  미달 ${r.id}: 누락 ${JSON.stringify(r.missing)} 상위 ${r.top.slice(0, 3).join(', ')}${r.statusPass === false ? ' (상태 불일치)' : ''}`);
  }
}
