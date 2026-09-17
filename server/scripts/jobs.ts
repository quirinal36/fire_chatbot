/**
 * 작업 큐를 로컬에서 실행 (ISS-023). Cron 과 같은 실행기를 쓴다.
 *   npm run jobs -- enqueue check_updates
 *   npm run jobs -- run [--budget 120]
 */
import './_env';

const { adminClient } = await import('@/lib/supabase');
const { runJobs } = await import('@/lib/jobs/worker');

const [cmd, arg] = process.argv.slice(2);
const db = adminClient();
if (cmd === 'enqueue') {
  const { data, error } = await db.rpc('enqueue_job', { p_kind: arg, p_payload: {}, p_dedupe_key: arg });
  if (error) throw new Error(error.message);
  console.log(`등록: ${data}`);
} else if (cmd === 'run') {
  const i = process.argv.indexOf('--budget');
  const budget = (i >= 0 ? Number(process.argv[i + 1]) : 120) * 1000;
  console.log(JSON.stringify(await runJobs(db, `cli-${process.pid}`, budget), null, 2));
} else {
  console.error('사용법: npm run jobs -- enqueue <kind> | run [--budget 초]');
  process.exit(2);
}
