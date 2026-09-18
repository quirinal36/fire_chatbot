/** 모델에 실제로 무엇이 가는지 본다: npm run dump-prompt -- "질문" */
import './_env';

const { adminClient } = await import('@/lib/supabase');
const { search } = await import('@/lib/retrieval/search');
const { buildMessages } = await import('@/lib/chat/prompt');

const question = process.argv.slice(2).join(' ');
const result = await search(adminClient(), question);
const evidence = result.evidence.filter((e) => e.transferAllowed);
const refs = new Map(result.evidence.map((e, i) => [e.unitId, `S${i + 1}`]));
const messages = buildMessages({ question, asOf: result.asOf, evidence, refs, pendingChanges: result.pendingChanges });
console.log(messages[1]!.content);
