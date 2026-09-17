/**
 * 규칙 세트 관리 CLI (ISS-017 · ISS-019)
 *
 *   npm run rules -- sync                               # sets/*.ts → DB (검토 대기 상태로)
 *   npm run rules -- status
 *   npm run rules -- review --action approve --reviewer "이름(소속)" --reason "검토 회의 2026-09-30"
 *   npm run rules -- review --action publish --reviewer ... --reason ...
 *   npm run rules -- table                              # 판단표 문서 생성 (docs/rules/academy-decision-table.md)
 */
import './_env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const { adminClient } = await import('@/lib/supabase');
const { syncRuleSet, resolveSources } = await import('@/lib/rules/store');
const { ACADEMY_RULES } = await import('@/lib/rules/sets/academy');
const { ACADEMY_CASES } = await import('@/lib/rules/sets/academy.cases');
const { runRuleSet } = await import('@/lib/rules/engine');
const { FIELDS, toFacts } = await import('@/lib/rules/fields');

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const db = adminClient();

async function current() {
  const { data } = await db
    .from('rule_sets')
    .select('id, code, version, status, approved_at, published_at, review_notes')
    .eq('code', ACADEMY_RULES.code)
    .eq('version', ACADEMY_RULES.version)
    .maybeSingle();
  return data;
}

switch (cmd) {
  case 'sync': {
    const r = await syncRuleSet(db, ACADEMY_RULES);
    console.log(r.status === 'locked' ? `이미 승인·게시된 버전이라 바꾸지 않았다. version 을 올린다. (${r.ruleSetId})` : `저장: ${r.ruleSetId} (검토 대기)`);
    break;
  }
  case 'status':
    console.log(JSON.stringify(await current(), null, 2));
    break;
  case 'review': {
    const set = await current();
    const action = opt('--action');
    const reviewer = opt('--reviewer');
    const reason = opt('--reason');
    if (!set || !action || !reviewer || !reason) {
      console.error('--action, --reviewer, --reason 이 필요하고 먼저 sync 해야 한다');
      process.exit(2);
    }
    const { data, error } = await db.rpc('review_rule_set', {
      p_rule_set_id: set.id,
      p_action: action,
      p_reviewer_id: null,
      p_reviewer_label: reviewer,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    console.log(`상태: ${data}`);
    break;
  }
  case 'table': {
    const sources = await resolveSources(db, ACADEMY_RULES);
    const label = (k: string) => (k in FIELDS ? FIELDS[k as keyof typeof FIELDS].label : k);
    const statusLabel = { applicable: '해당', not_applicable: '비해당', needs_review: '추가 확인' } as const;
    const lines: string[] = [];
    lines.push(`# ${ACADEMY_RULES.title}`, '');
    lines.push(`규칙 버전 \`${ACADEMY_RULES.code}@${ACADEMY_RULES.version}\` · 이 문서는 \`npm run rules -- table\` 로 생성한다. 직접 고치지 않는다.`, '');
    lines.push(`적용 범위: ${ACADEMY_RULES.scopeNote}`, '');
    lines.push('> **담당자 승인 전 초안이다.** 승인 전에는 운영 화면에 판정을 내보내지 않는다. 승인 절차는 아래 "승인 기록" 참고.', '');
    lines.push('## 판단 규칙', '');
    lines.push('| 시설 | 해당 조건 (요약) | 필요한 입력 | 근거 |', '|---|---|---|---|');
    for (const r of ACADEMY_RULES.rules) {
      const inputs = new Set<string>();
      const walk = (c: unknown): void => {
        if (c && typeof c === 'object') {
          const o = c as Record<string, unknown>;
          if (typeof o['field'] === 'string') inputs.add(o['field']);
          Object.values(o).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)));
        }
      };
      walk(r.applicableWhen);
      walk(r.scope);
      r.exceptions?.forEach((e) => walk(e.when));
      const src = (sources.get(r.key) ?? []).map((s) => `${s.doc} ${s.locator}${s.role === 'exception' ? '(예외)' : s.role === 'definition' ? '(정의)' : ''}`).join('<br>');
      lines.push(`| ${r.facility} | ${r.explain.applicable} | ${[...inputs].map(label).join(', ')} | ${src} |`);
    }
    lines.push('', '## 사례별 기대 결과', '');
    const keys = ACADEMY_RULES.rules.map((r) => r.key);
    lines.push(`| 사례 | 구분 | ${ACADEMY_RULES.rules.map((r) => r.facility).join(' | ')} |`);
    lines.push(`|---|---|${keys.map(() => '---').join('|')}|`);
    for (const c of ACADEMY_CASES) {
      const fields = Object.fromEntries(Object.entries(c.input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v, state: 'user_confirmed' as const }]));
      const got = new Map(runRuleSet(ACADEMY_RULES, toFacts(fields)).map((r) => [r.ruleKey, r.status]));
      const cells = keys.map((k) => {
        const s = got.get(k);
        const mark = s ? statusLabel[s] : '—';
        return k in c.expected ? `**${mark}**` : mark;
      });
      lines.push(`| ${c.id} ${c.title} | ${c.kind} | ${cells.join(' | ')} |`);
    }
    lines.push('', '굵은 글씨는 사례가 검증하는 기대값이다(테스트 `src/lib/rules/engine.test.ts`). 나머지는 같은 입력의 계산 결과다.', '');
    lines.push('## 담당자 검토 요청 사항', '');
    lines.push('1. **렛츠코딩앤플레이의 "연면적 112㎡"가 건물 전체 연면적인지 학원 영업장 면적인지** 확인. 현재는 영업장 면적으로만 쓴다.');
    lines.push('2. 피난기구: 3층 영업장이 피난층이 아니라는 확인이 필요하다 (A01 에서 추가 확인으로 둠).');
    lines.push('3. 옥내소화전·비상경보·자동화재탐지는 건물 전체 연면적 기준이다. 건축물대장 수치로 확정한다.');
    lines.push('4. 다중이용업: 수용인원 25명은 사용자가 말한 값이다. 별표 7(강의실 등 바닥면적 ÷ 1.9㎡) 산정값과 일치하는지 확인.');
    lines.push('5. 부칙 경과조치(건축허가일 기준 구 기준 적용)는 규칙에 넣지 않았다. 허가일이 오래된 건물은 담당자 판단으로 남긴다.');
    lines.push('6. 복합건축물(주택과 함께 쓰는 건물), 노유자 시설 예외 등 학원과 무관한 조항은 범위 밖이다.', '');
    lines.push('## 승인 기록', '');
    const set = await current();
    lines.push('| 규칙 버전 | 상태 | 승인 시각 | 게시 시각 | 검토 메모 |', '|---|---|---|---|---|');
    lines.push(`| ${ACADEMY_RULES.version} | ${set?.status ?? '미등록'} | ${set?.approved_at ?? '—'} | ${set?.published_at ?? '—'} | ${set?.review_notes ?? '—'} |`, '');
    lines.push('승인: `npm run rules -- review --action approve --reviewer "이름(소속)" --reason "검토 근거"` → 게시: `--action publish`. 관리자 화면(ISS-021)에서도 같은 절차를 쓴다.');
    const dir = resolve(import.meta.dirname, '../../docs/rules');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'academy-decision-table.md'), lines.join('\n') + '\n');
    console.log('docs/rules/academy-decision-table.md 생성');
    break;
  }
  default:
    console.error('사용법: npm run rules -- sync | status | review | table');
    process.exit(2);
}
