/** 검색 확인용 CLI: npm run search -- "질문" [--as-of 2026-09-18] [--json] */
import './_env';

const { adminClient } = await import('@/lib/supabase');
const { search } = await import('@/lib/retrieval/search');

const args = process.argv.slice(2);
const at = args.indexOf('--as-of');
const question = args.filter((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1)).join(' ');
const result = await search(adminClient(), question, at >= 0 ? { asOf: args[at + 1]! } : {});
if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`상태 ${result.status} · 기준일 ${result.asOf} · 키워드 ${result.analysis.terms.join(',')}`);
  for (const e of result.evidence) {
    const sig = Object.entries(e.signals).map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(' ');
    console.log(`- ${e.code ?? e.documentTitle} ${e.locator} [${e.parseStatus}] ${sig}\n    ${e.text.slice(0, 110).replace(/\n/g, ' ')}`);
  }
  if (result.pendingChanges.length) console.log('시행예정', JSON.stringify(result.pendingChanges));
}
