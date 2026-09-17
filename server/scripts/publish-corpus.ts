/**
 * 제한된 corpus 게시 절차 (ISS-009)
 *
 * 관리자 화면(ISS-021) 전에 담당자 승인 증거를 남기고 버전을 게시한다.
 *
 *   npm run publish-corpus -- --reviewer "홍길동(예방과)" --evidence "2026-09-20 검토 회의록 #3" --all-current
 *   npm run publish-corpus -- --reviewer ... --evidence ... --only "NFPC 103"
 *
 * 게시는 검색 노출 여부만 정한다. needs_review 단위는 게시되어도 자동 판단 규칙의 근거가 될 수 없다.
 * 파싱 확인이 필요한 단위가 있는 버전은 --acknowledge-parse-issues 를 줘야 게시된다.
 */
import './_env';

const { adminClient } = await import('@/lib/supabase');

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const reviewer = value('--reviewer');
const evidence = value('--evidence');
const only = value('--only');
if (!reviewer || !evidence) {
  console.error('--reviewer 와 --evidence 가 필요하다');
  process.exit(2);
}
if (!only && !args.includes('--all-current')) {
  console.error('--only <코드|제목 일부> 또는 --all-current 를 지정한다');
  process.exit(2);
}

const db = adminClient();
const { data, error } = await db
  .from('legal_versions')
  .select('id, source_version_id, effective_date, version_status, review_status, legal_documents!inner(title, code)')
  .in('version_status', ['current', 'scheduled'])
  .neq('review_status', 'published');
if (error) throw new Error(error.message);

const targets = (data ?? []).filter((v) => {
  const d = v.legal_documents as unknown as { title: string; code: string | null };
  return !only || d.code === only || d.title.includes(only);
});

for (const v of targets) {
  const d = v.legal_documents as unknown as { title: string };
  const { data: status, error: pubError } = await db.rpc('publish_version', {
    p_version_id: v.id,
    p_reviewer_label: reviewer,
    p_reason: evidence,
    p_acknowledge_parse_issues: args.includes('--acknowledge-parse-issues'),
  });
  console.log(pubError ? `실패 ${d.title}: ${pubError.message}` : `${status} ${d.title} (${v.source_version_id}, ${v.version_status})`);
}
console.log(`대상 ${targets.length}건`);
