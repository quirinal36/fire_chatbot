/**
 * 원문 수집 CLI (ISS-007)
 *
 *   npm run ingest                    # 선정 목록 전체
 *   npm run ingest -- --only "NFPC 101" --no-attachments
 *   npm run ingest -- --dry-run       # 저장하지 않고 수집·정규화 결과만 출력
 *
 * 결과는 ingestion_jobs 에 기록한다. 실패 항목이 있으면 종료 코드 1.
 */
import './_env';

const { adminClient } = await import('@/lib/supabase');
const { CATALOG, entryLabel } = await import('@/lib/ingestion/catalog');
const { ingestCatalog } = await import('@/lib/ingestion/ingest');
const { supabaseIngestStore } = await import('@/lib/ingestion/store');
const { secretValues } = await import('@/lib/env');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const only = value('--only');
const entries = only ? CATALOG.filter((e) => entryLabel(e).includes(only)) : CATALOG;
if (entries.length === 0) {
  console.error(`--only "${only}" 에 해당하는 항목이 없습니다.`);
  process.exit(2);
}

const db = adminClient();
const dryRun = flag('--dry-run');
const store = dryRun
  ? {
      findVersion: async () => null,
      saveNewVersion: async (i: { units: readonly unknown[] }) => ({ versionId: 'dry-run', unitCount: i.units.length }),
      replaceUnits: async (_id: string, units: readonly unknown[]) => units.length,
    }
  : supabaseIngestStore(db);

let jobId: string | null = null;
if (!dryRun) {
  const { data, error } = await db
    .from('ingestion_jobs')
    .insert({ kind: 'cli_ingest', payload: { only: only ?? null }, status: 'running', stage: 'fetch', attempts: 1 })
    .select('id')
    .single();
  if (error) throw new Error(`작업 기록 실패: ${error.message}`);
  jobId = data.id;
}

const started = Date.now();
const outcomes = await ingestCatalog(entries, {
  store,
  secrets: secretValues(),
  downloadAttachments: !flag('--no-attachments'),
  log: (line) => console.log(line),
});

const summary = {
  total: outcomes.length,
  new: outcomes.filter((o) => o.status === 'new').length,
  unchanged: outcomes.filter((o) => o.status === 'unchanged').length,
  reparsed: outcomes.filter((o) => o.status === 'reparsed').length,
  conflict: outcomes.filter((o) => o.status === 'conflict').length,
  failed: outcomes.filter((o) => o.status === 'failed').length,
  seconds: Math.round((Date.now() - started) / 1000),
};
const issues = outcomes.flatMap((o) =>
  o.status === 'new'
    ? [...o.missing.map((m) => `${o.label}: ${m}`), ...o.attachmentFailures.map((m) => `${o.label}: 첨부 ${m}`)]
    : o.status === 'conflict'
      ? [`${o.label}: ${o.detail}`]
      : o.status === 'failed'
        ? [`${o.label}: ${o.error}`]
        : [],
);

console.log('\n요약', JSON.stringify(summary));
if (issues.length) console.log('누락·실패\n- ' + issues.join('\n- '));

if (jobId) {
  await db
    .from('ingestion_jobs')
    .update({
      status: summary.failed ? 'failed' : 'succeeded',
      stage: 'done',
      result: { summary, outcomes },
      last_error: summary.failed ? issues.join('\n').slice(0, 4000) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}
process.exit(summary.failed ? 1 : 0);
