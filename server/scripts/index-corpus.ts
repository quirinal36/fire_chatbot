/**
 * 검색 인덱스 구축 CLI (ISS-009)
 *
 *   npm run index-corpus                  # 조각 동기화 + 변경분 임베딩 (기본 상한 $1)
 *   npm run index-corpus -- --max-usd 0.2
 *   npm run index-corpus -- --chunks-only
 */
import './_env';

const { adminClient } = await import('@/lib/supabase');
const { syncChunks, embedPending } = await import('@/lib/retrieval/indexer');
const { embeddingSpec } = await import('@/lib/retrieval/embeddings');

const args = process.argv.slice(2);
const at = args.indexOf('--max-usd');
const maxUsd = at >= 0 ? Number(args[at + 1]) : 1;
if (!(maxUsd >= 0)) throw new Error('--max-usd 값이 올바르지 않다');

const db = adminClient();
const chunks = await syncChunks(db);
console.log('조각', JSON.stringify(chunks));

if (!args.includes('--chunks-only')) {
  const spec = embeddingSpec();
  console.log('임베딩 모델', JSON.stringify(spec));
  const report = await embedPending(db, { maxUsd, log: (s) => console.log(s) });
  console.log('임베딩', JSON.stringify({ ...report, usd: Number(report.usd.toFixed(6)) }));
  if (report.stoppedByBudget) {
    console.error(`비용 상한 $${maxUsd} 에서 멈췄다. 남은 조각은 다음 실행에서 처리한다.`);
    process.exit(1);
  }
}
