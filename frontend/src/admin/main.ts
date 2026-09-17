/**
 * 관리자 화면 (ISS-021 · ISS-023 · ISS-024 · ISS-027)
 *
 * 승인 대기 · 문서 비교 · 규칙 근거 · 답변 추적 · 신고 처리 · 수집 작업 · 내부 자료 · 운영 지표.
 * 범용 규칙 편집기는 두지 않는다. 승인·반려만 한다 (기획서 §7).
 */
import '../styles/tokens.css';
import '../styles/base.css';
import './admin.css';

import { esc } from '../lib/dom';
import { adminAuth, AdminApiError, api, patch, post } from './api';

type Tab = 'overview' | 'versions' | 'rules' | 'files' | 'runs' | 'feedback' | 'jobs' | 'documents' | 'metrics';

const TABS: ReadonlyArray<[Tab, string]> = [
  ['overview', '개요'],
  ['versions', '문서 버전'],
  ['rules', '판단 규칙'],
  ['files', '해석·내부 자료'],
  ['runs', '답변 추적'],
  ['feedback', '오류 신고'],
  ['jobs', '수집 작업'],
  ['documents', '내부 자료 등록'],
  ['metrics', '운영 지표'],
];

const root = document.getElementById('admin')!;
let tab: Tab = (location.hash.slice(1) as Tab) || 'overview';
let who = '';

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : esc(String(v)));
const date = (v: unknown) => (v ? esc(new Date(String(v)).toLocaleString('ko-KR')) : '—');
const json = (v: unknown) => `<pre class="mono">${esc(JSON.stringify(v, null, 2))}</pre>`;

function flash(message: string, tone: 'ok' | 'error' = 'ok') {
  const el = document.createElement('p');
  el.className = `flash flash--${tone}`;
  el.textContent = message;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    flash(err instanceof Error ? err.message : '요청 실패', 'error');
    if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) await showLogin();
    return undefined;
  }
}

/** 검토 사유를 받는다. 모든 승인·반려에 사유가 남는다 */
function askReason(title: string): string | null {
  const reason = window.prompt(`${title}\n검토 사유(근거 문서·회의 등)를 입력하세요.`);
  return reason && reason.trim().length >= 2 ? reason.trim() : null;
}

// ------------------------------------------------------------------ 로그인

async function showLogin(message = '') {
  root.innerHTML = `<form class="login card">
    <h1>관리자 로그인</h1>
    <p class="muted">등록된 검토자·관리자만 사용할 수 있습니다.</p>
    <label>이메일 <input name="email" type="email" autocomplete="username" required /></label>
    <label>비밀번호 <input name="password" type="password" autocomplete="current-password" required /></label>
    ${message ? `<p class="flash--error">${esc(message)}</p>` : ''}
    <button class="btn btn--primary" type="submit">로그인</button>
  </form>`;
  root.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    const { error } = await adminAuth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
    if (error) return showLogin('이메일 또는 비밀번호가 맞지 않습니다.');
    await boot();
  });
}

// ------------------------------------------------------------------ 화면

async function renderOverview(): Promise<string> {
  const o = await api<Record<string, number>>('/api/admin/overview');
  const cards: [string, string, Tab][] = [
    ['검토 대기 문서 버전', String(o['pendingVersions']), 'versions'],
    ['검토 중 규칙 세트', String(o['pendingRules']), 'rules'],
    ['개정으로 재검토 필요한 규칙', String(o['invalidatedRules']), 'rules'],
    ['미처리 오류 신고', String(o['openFeedback']), 'feedback'],
    ['실패한 수집 작업', String(o['failedJobs']), 'jobs'],
    ['공개 승인 전 자료', String(o['pendingFiles']), 'files'],
    ['오늘 모델·임베딩 비용', `$${Number(o['spentTodayUsd']).toFixed(4)}`, 'metrics'],
  ];
  return `<div class="grid">${cards
    .map(([label, value, target]) => `<a class="card stat" href="#${target}"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong></a>`)
    .join('')}</div>`;
}

interface VersionRow {
  id: string;
  title: string;
  code: string | null;
  sourceType: string;
  sourceVersionId: string;
  effectiveDate: string | null;
  versionStatus: string;
  reviewStatus: string;
  fetchedAt: string;
  needsReviewUnits: number;
}

async function renderVersions(): Promise<string> {
  const { versions, events } = await api<{ versions: VersionRow[]; events: Record<string, unknown>[] }>('/api/admin/reviews');
  const rows = versions
    .map(
      (v) => `<tr>
      <td>${esc(v.code ?? v.title)}<div class="muted">${esc(v.sourceType)} · ${esc(v.sourceVersionId)}</div></td>
      <td>${fmt(v.effectiveDate)}</td>
      <td><span class="pill pill--${esc(v.versionStatus)}">${esc(v.versionStatus)}</span></td>
      <td><span class="pill pill--${esc(v.reviewStatus)}">${esc(v.reviewStatus)}</span></td>
      <td>${v.needsReviewUnits ? `<span class="warn">${v.needsReviewUnits}</span>` : '0'}</td>
      <td class="actions">
        <button class="btn" data-act="diff" data-id="${v.id}">변경 비교</button>
        ${v.reviewStatus !== 'published' ? `<button class="btn btn--primary" data-act="publish-version" data-id="${v.id}" data-review="${v.needsReviewUnits}">게시</button>
        <button class="btn" data-act="reject-version" data-id="${v.id}">반려</button>` : ''}
      </td>
    </tr>`,
    )
    .join('');
  const log = events
    .map((e) => `<li>${date(e['created_at'])} · ${fmt(e['subject_type'])} ${fmt(e['action'])} · ${fmt(e['reviewer_label'])} — ${fmt(e['reason'])}</li>`)
    .join('');
  return `<p class="muted">게시한 버전만 검색에 나옵니다. 파싱 확인이 필요한 단위가 있으면 게시할 때 확인을 받으며, 그 단위는 판단 규칙의 근거로 쓸 수 없습니다.</p>
    <div class="scroll"><table><thead><tr><th>문서</th><th>시행일</th><th>시행 구분</th><th>검토</th><th>파싱 확인 필요</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div id="diff"></div>
    <h2>최근 검토 기록</h2><ul class="log">${log}</ul>`;
}

async function showDiff(id: string) {
  const d = await guard(() =>
    api<{ against: string | null; total: number; changes: { locator: string; change: string; old_text: string | null; new_text: string | null }[]; affectedRules: unknown[] }>(
      `/api/admin/versions/${id}/diff`,
    ),
  );
  const box = document.getElementById('diff');
  if (!d || !box) return;
  box.innerHTML = !d.against
    ? '<div class="card">비교할 이전 게시본이 없습니다.</div>'
    : `<div class="card"><h2>이전 게시본과 차이 ${d.total}건</h2>
      ${d.affectedRules.length ? `<p class="warn">영향받는 규칙: ${esc(JSON.stringify(d.affectedRules.map((r: any) => `${r.rules.rule_sets.code}@${r.rules.rule_sets.version} ${r.rules.facility}`)))}</p>` : '<p class="muted">영향받는 규칙 없음</p>'}
      ${d.changes
        .slice(0, 200)
        .map(
          (c) => `<details><summary><span class="pill pill--${esc(c.change)}">${esc(c.change)}</span> ${esc(c.locator)}</summary>
            <div class="diff"><pre class="old">${esc(c.old_text ?? '')}</pre><pre class="new">${esc(c.new_text ?? '')}</pre></div></details>`,
        )
        .join('')}</div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

async function renderRules(): Promise<string> {
  const { ruleSets } = await api<{ ruleSets: Record<string, any>[] }>('/api/admin/reviews');
  return `<p class="muted">규칙은 저장소의 판단표(docs/rules)로 작성해 동기화합니다. 여기서는 근거를 확인하고 승인·게시·재검토만 합니다.</p>
    <div class="scroll"><table><thead><tr><th>규칙 세트</th><th>상태</th><th>승인</th><th>게시</th><th>개정 영향</th><th></th></tr></thead><tbody>${ruleSets
      .map(
        (r) => `<tr>
        <td>${esc(r['code'])}@${esc(r['version'])}<div class="muted">${fmt(r['review_notes'])}</div></td>
        <td><span class="pill pill--${esc(r['status'])}">${esc(r['status'])}</span></td>
        <td>${date(r['approved_at'])}</td><td>${date(r['published_at'])}</td>
        <td>${r['invalidated_rules']?.length ? `<span class="warn">${esc(r['invalidated_rules'].join(', '))}</span><div class="muted">${fmt(r['invalidation_reason'])}</div>` : '—'}</td>
        <td class="actions">
          <button class="btn" data-act="rules-detail" data-id="${r['id']}">근거 보기</button>
          ${['pending_review', 'needs_review'].includes(r['status']) ? `<button class="btn btn--primary" data-act="rule" data-action="approve" data-id="${r['id']}">승인</button>
            <button class="btn" data-act="rule" data-action="request_changes" data-id="${r['id']}">보완 요청</button>` : ''}
          ${r['status'] === 'approved' ? `<button class="btn btn--primary" data-act="rule" data-action="publish" data-id="${r['id']}">게시</button>` : ''}
          ${r['invalidated_rules']?.length ? `<button class="btn" data-act="rule" data-action="revalidate" data-id="${r['id']}">재검토 완료</button>` : ''}
        </td></tr>`,
      )
      .join('')}</tbody></table></div><div id="rule-detail"></div>`;
}

async function showRules(id: string) {
  const d = await guard(() => api<{ ruleSet: any; rules: any[]; events: any[] }>(`/api/admin/rule-sets/${id}`));
  const box = document.getElementById('rule-detail');
  if (!d || !box) return;
  box.innerHTML = `<div class="card"><h2>${esc(d.ruleSet.code)}@${esc(d.ruleSet.version)}</h2>
    ${d.rules
      .map((r) => {
        const explain = JSON.parse(r.explanation_template) as Record<string, string>;
        return `<details><summary><strong>${esc(r.facility)}</strong> <span class="muted">${esc(r.rule_key)} · 입력 ${esc(r.required_inputs.join(', '))}</span></summary>
          <p>해당: ${esc(explain['applicable'] ?? '')}</p>
          ${json(r.definition)}
          ${r.rule_sources
            .map(
              (s: any) => `<div class="source"><span class="pill">${esc(s.role)}</span> ${esc(s.legal_units.legal_versions.legal_documents.code ?? s.legal_units.legal_versions.legal_documents.title)} ${esc(s.legal_units.locator)}
              <span class="muted">(${esc(s.legal_units.legal_versions.version_status)} · 시행 ${fmt(s.legal_units.legal_versions.effective_date)} · ${esc(s.legal_units.parse_status)})</span>
              <pre>${esc(s.legal_units.text)}</pre></div>`,
            )
            .join('')}
        </details>`;
      })
      .join('')}
    <h3>검토 이력</h3><ul class="log">${d.events.map((e) => `<li>${date(e.created_at)} ${esc(e.action)} · ${fmt(e.reviewer_label)} — ${fmt(e.reason)}</li>`).join('')}</ul></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

async function renderFiles(): Promise<string> {
  const { files } = await api<{ files: any[] }>('/api/admin/source-files');
  return `<p class="muted"><strong>공개 승인</strong>(검색·근거 카드 노출)과 <strong>외부 전송 승인</strong>(모델 API 로 본문 전송)은 따로 받습니다. 실제 내부 자료는 담당자 승인 전까지 등록하지 않습니다.</p>
    <div class="scroll"><table><thead><tr><th>자료</th><th>분류</th><th>공개</th><th>외부 전송</th><th>선정</th><th></th></tr></thead><tbody>${files
      .map(
        (f) => `<tr><td>${esc(f.legal_documents.title.slice(0, 60))}<div class="muted">${esc(f.legal_documents.source_type)} · ${esc(f.origin)}</div></td>
        <td>${esc(f.classification)}</td>
        <td>${f.disclosure === 'public' ? `공개 <span class="muted">${date(f.disclosure_approved_at)}</span>` : '<span class="warn">비공개</span>'}</td>
        <td>${f.transfer_allowed ? `허용 <span class="muted">${date(f.transfer_approved_at)}</span>` : '<span class="warn">불가</span>'}</td>
        <td>${f.selected_by_reviewer ? '선정' : '—'}</td>
        <td class="actions">
          ${f.disclosure === 'public' ? `<button class="btn" data-act="file" data-action="revoke_disclosure" data-id="${f.id}">공개 철회</button>` : `<button class="btn btn--primary" data-act="file" data-action="approve_disclosure" data-id="${f.id}">공개 승인</button>`}
          ${f.transfer_allowed ? `<button class="btn" data-act="file" data-action="revoke_transfer" data-id="${f.id}">전송 철회</button>` : `<button class="btn" data-act="file" data-action="approve_transfer" data-id="${f.id}">전송 승인</button>`}
          <button class="btn" data-act="file" data-action="${f.selected_by_reviewer ? 'unselect' : 'select'}" data-id="${f.id}">${f.selected_by_reviewer ? '선정 해제' : '담당자 선정'}</button>
        </td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

async function renderRuns(): Promise<string> {
  const { runs } = await api<{ runs: any[] }>('/api/admin/runs?limit=50');
  return `<div class="scroll"><table><thead><tr><th>시각</th><th>질문</th><th>상태</th><th>모델</th><th>토큰</th><th>비용</th><th>지연</th><th>신고</th></tr></thead><tbody>${runs
    .map(
      (r) => `<tr class="clickable" data-act="run" data-id="${r.id}">
      <td>${date(r.created_at)}</td><td>${fmt(String(r.question ?? '').slice(0, 50))}</td>
      <td><span class="pill pill--${esc(r.status)}">${esc(r.status)}</span>${r.error_code ? `<div class="muted">${esc(r.error_code)}</div>` : ''}</td>
      <td>${fmt(r.model)}<div class="muted">${fmt(r.prompt_version)}</div></td>
      <td>${r.input_tokens ?? 0}/${r.output_tokens ?? 0}</td><td>${r.cost_usd === null ? '—' : `$${Number(r.cost_usd).toFixed(4)}`}</td>
      <td>${r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : '—'}</td><td>${r.feedback.length || ''}</td></tr>`,
    )
    .join('')}</tbody></table></div><div id="run-detail"></div>`;
}

async function showRun(id: string) {
  const d = await guard(() => api<{ run: any; messages: any[]; feedback: any[]; sources: any[] }>(`/api/admin/runs/${id}`));
  const box = document.getElementById('run-detail');
  if (!d || !box) return;
  const answer = d.messages.find((m) => m.role === 'assistant')?.content;
  box.innerHTML = `<div class="card"><h2>답변 실행 ${esc(id.slice(0, 8))}</h2>
    <dl class="kv">
      <dt>질문</dt><dd>${fmt(d.run.input_snapshot?.question)}</dd>
      <dt>검색 상태 · 기준일</dt><dd>${fmt(d.run.input_snapshot?.searchStatus)} · ${fmt(d.run.input_snapshot?.asOf)}</dd>
      <dt>모델 · 프롬프트</dt><dd>${fmt(d.run.model)} · ${fmt(d.run.prompt_version)} · 시도 ${d.run.attempts}</dd>
      <dt>규칙 · corpus</dt><dd>${fmt(d.run.rule_set_version)} · ${fmt(d.run.corpus_version)} · 사례 revision ${fmt(d.run.case_revision)}</dd>
      <dt>검증 오류</dt><dd>${fmt((d.run.input_snapshot?.validationErrors ?? []).join(' / '))}</dd>
      <dt>근거</dt><dd>${d.sources.map((s) => `${esc(s.legal_versions.legal_documents.code ?? s.legal_versions.legal_documents.title)} ${esc(s.locator)} (${fmt(s.legal_versions.effective_date)})`).join('<br>')}</dd>
    </dl>
    ${answer ? `<h3>답변</h3><p>${esc(answer.answer?.summary ?? '')}</p><ul>${(answer.answer?.statements ?? []).map((s: any) => `<li>${esc(s.text)} <span class="muted">${esc(s.sourceIds.join(','))}</span></li>`).join('')}</ul>` : ''}
    ${d.run.input_snapshot?.assessment ? `<h3>규칙 판단</h3>${json(d.run.input_snapshot.assessment.map((a: any) => `${a.facility}: ${a.status}`))}` : ''}
    ${d.feedback.length ? `<h3>신고</h3><ul>${d.feedback.map((f) => `<li>${esc(f.category)} · ${esc(f.status)} — ${fmt(f.comment)}</li>`).join('')}</ul>` : ''}
    <details><summary>입력 스냅샷 전체</summary>${json(d.run.input_snapshot)}</details></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

async function renderFeedback(): Promise<string> {
  const { feedback } = await api<{ feedback: any[] }>('/api/admin/feedback');
  return `<div class="scroll"><table><thead><tr><th>시각</th><th>유형</th><th>내용</th><th>상태</th><th></th></tr></thead><tbody>${feedback
    .map(
      (f) => `<tr><td>${date(f.created_at)}</td><td>${esc(f.category)}</td><td>${fmt(f.comment)}</td>
      <td><span class="pill pill--${esc(f.status)}">${esc(f.status)}</span></td>
      <td class="actions">
        ${f.answer_run_id ? `<button class="btn" data-act="goto-run" data-id="${f.answer_run_id}">답변 추적</button>` : ''}
        <select data-act="feedback-status" data-id="${f.id}">
          ${['open', 'triaged', 'resolved', 'dismissed'].map((s) => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td></tr>`,
    )
    .join('')}</tbody></table></div><div id="run-detail"></div>`;
}

async function renderJobs(): Promise<string> {
  const { jobs } = await api<{ jobs: any[] }>('/api/admin/ingestion');
  return `<div class="toolbar">
      <button class="btn btn--primary" data-act="enqueue" data-kind="check_updates">개정 확인 실행</button>
      <button class="btn" data-act="enqueue" data-kind="index_corpus">검색 조각·임베딩 갱신</button>
      <span class="muted">요청 안에서는 40초까지만 처리하고, 남은 작업은 매일 Cron 이 이어서 합니다.</span>
    </div>
    <div class="scroll"><table><thead><tr><th>작업</th><th>상태</th><th>단계</th><th>시도</th><th>다음 실행</th><th>오류·결과</th><th></th></tr></thead><tbody>${jobs
      .map(
        (j) => `<tr><td>${esc(j.kind)}<div class="muted">${date(j.created_at)}</div></td>
        <td><span class="pill pill--${esc(j.status)}">${esc(j.status)}</span></td><td>${fmt(j.stage)}</td>
        <td>${j.attempts}/${j.max_attempts}</td><td>${date(j.next_run_at)}</td>
        <td>${j.last_error ? `<span class="warn">${esc(String(j.last_error).slice(0, 200))}</span>` : ''}${j.result ? `<details><summary>결과</summary>${json(j.result)}</details>` : ''}</td>
        <td>${['failed', 'cancelled'].includes(j.status) ? `<button class="btn" data-act="retry-job" data-id="${j.id}">재처리</button>` : ''}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function renderDocuments(): string {
  return `<form class="card form" id="doc-form">
    <p class="warn">실제 소방본부 내부 자료는 담당자 승인 전까지 등록하지 않습니다. 개발 중에는 비식별 시험 자료만 등록하세요.</p>
    <label>제목 <input name="title" required maxlength="200" /></label>
    <label>분류 <input name="classification" required maxlength="60" placeholder="질의회신, 업무 안내 …" /></label>
    <label>출처 <input name="origin" required maxlength="100" placeholder="○○소방서 예방과" /></label>
    <label>본문 (빈 줄로 절을 나눕니다) <textarea name="text" rows="12" required maxlength="20000"></textarea></label>
    <label class="check"><input type="checkbox" name="synthetic" checked /> 비식별 시험 자료입니다</label>
    <button class="btn btn--primary" type="submit">등록 (비공개·전송 불가 상태로)</button>
  </form>`;
}

async function renderMetrics(): Promise<string> {
  const m = await api<any>('/api/admin/metrics?days=14');
  const t = m.totals;
  return `<div class="grid">
      <div class="card stat"><span class="muted">질문 수 (${m.days}일)</span><strong>${t.requests}</strong></div>
      <div class="card stat"><span class="muted">모델·임베딩 비용</span><strong>$${Number(t.costUsd).toFixed(4)}</strong></div>
      <div class="card stat"><span class="muted">질문당 평균 비용</span><strong>$${Number(t.avgCostUsd).toFixed(5)}</strong></div>
      <div class="card stat"><span class="muted">지연 p50 / p95</span><strong>${(t.p50LatencyMs / 1000).toFixed(1)}s / ${(t.p95LatencyMs / 1000).toFixed(1)}s</strong></div>
      <div class="card stat"><span class="muted">근거 부족 비율</span><strong>${(t.insufficientRate * 100).toFixed(1)}%</strong></div>
      <div class="card stat"><span class="muted">실패·대체 응답</span><strong>${t.failed} / ${t.fallback}</strong></div>
      <div class="card stat"><span class="muted">미처리 신고</span><strong>${t.openFeedback}</strong></div>
      <div class="card stat"><span class="muted">일일 비용 상한</span><strong>$${Number(m.limits.dailyBudgetUsd).toFixed(2)} (${(m.limits.todayUsage * 100).toFixed(0)}%)</strong></div>
    </div>
    ${m.alerts.length ? `<div class="card"><h2>경보</h2><ul>${m.alerts.map((a: string) => `<li class="warn">${esc(a)}</li>`).join('')}</ul></div>` : ''}
    <h2>일별</h2>
    <div class="scroll"><table><thead><tr><th>날짜</th><th>질문</th><th>입력 토큰</th><th>출력 토큰</th><th>비용</th><th>p95</th><th>근거 부족</th><th>실패</th></tr></thead><tbody>${m.daily
      .map((d: any) => `<tr><td>${esc(d.day)}</td><td>${d.requests}</td><td>${d.inputTokens}</td><td>${d.outputTokens}</td><td>$${Number(d.costUsd).toFixed(4)}</td><td>${(d.p95LatencyMs / 1000).toFixed(1)}s</td><td>${d.insufficient}</td><td>${d.failed}</td></tr>`)
      .join('')}</tbody></table></div>
    <h2>오류 유형</h2>${json(m.errors)}`;
}

const RENDER: Record<Tab, () => Promise<string> | string> = {
  overview: renderOverview,
  versions: renderVersions,
  rules: renderRules,
  files: renderFiles,
  runs: renderRuns,
  feedback: renderFeedback,
  jobs: renderJobs,
  documents: renderDocuments,
  metrics: renderMetrics,
};

async function render() {
  const nav = TABS.map(([id, label]) => `<a href="#${id}" class="nav__item" aria-current="${id === tab}">${esc(label)}</a>`).join('');
  root.innerHTML = `<header class="bar"><strong>소방본부 AI 상담 · 관리자</strong><span class="muted">${esc(who)}</span>
      <button class="btn" data-act="logout">로그아웃</button></header>
    <nav class="nav">${nav}</nav><main class="main"><p class="muted">불러오는 중…</p></main>`;
  const html = await guard(async () => RENDER[tab]());
  root.querySelector('.main')!.innerHTML = html ?? '<p class="warn">불러오지 못했습니다.</p>';
}

root.addEventListener('click', async (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const id = el.dataset['id'] ?? '';
  switch (el.dataset['act']) {
    case 'logout':
      await adminAuth.signOut();
      return showLogin();
    case 'diff':
      return showDiff(id);
    case 'publish-version': {
      const needs = Number(el.dataset['review'] ?? 0);
      if (needs && !window.confirm(`파싱 확인이 필요한 단위가 ${needs}건 있습니다. 검색에는 노출하되 규칙 근거로는 쓰지 않는 조건으로 게시할까요?`)) return;
      const reason = askReason('문서 버전 게시');
      if (!reason) return;
      if (await guard(() => post(`/api/admin/reviews/${id}`, { subjectType: 'legal_version', action: 'publish', reason, acknowledgeParseIssues: needs > 0 }))) flash('게시했습니다');
      return render();
    }
    case 'reject-version': {
      const reason = askReason('문서 버전 반려');
      if (!reason) return;
      if (await guard(() => post(`/api/admin/reviews/${id}`, { subjectType: 'legal_version', action: 'reject', reason }))) flash('반려했습니다');
      return render();
    }
    case 'rules-detail':
      return showRules(id);
    case 'rule': {
      const action = el.dataset['action']!;
      const reason = askReason(`규칙 세트 ${action}`);
      if (!reason) return;
      if (await guard(() => post(`/api/admin/reviews/${id}`, { subjectType: 'rule_set', action, reason }))) flash('처리했습니다');
      return render();
    }
    case 'file': {
      const action = el.dataset['action']!;
      const reason = askReason(`자료 ${action}`);
      if (!reason) return;
      if (await guard(() => post(`/api/admin/reviews/${id}`, { subjectType: 'source_file', action, reason }))) flash('처리했습니다');
      return render();
    }
    case 'run':
      return showRun(id);
    case 'goto-run':
      return showRun(id);
    case 'enqueue': {
      flash('작업을 등록하고 실행합니다 (최대 40초)…');
      const r = await guard(() => post<{ id: string; report: unknown }>('/api/admin/ingestion', { kind: el.dataset['kind'], runNow: true }));
      if (r) flash('작업을 처리했습니다. 남은 부분은 예약 실행이 이어갑니다.');
      return render();
    }
    case 'retry-job':
      if (await guard(() => post(`/api/admin/ingestion/${id}`, { action: 'retry' }))) flash('다시 대기열에 넣었습니다');
      return render();
  }
});

root.addEventListener('change', async (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.dataset['act'] !== 'feedback-status') return;
  const note = window.prompt('처리 메모 (선택)') ?? '';
  if (await guard(() => patch(`/api/admin/feedback/${el.dataset['id']}`, { status: el.value, note }))) flash('신고 상태를 바꿨습니다');
  await render();
});

root.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== 'doc-form') return;
  e.preventDefault();
  const d = new FormData(form);
  const body = {
    title: String(d.get('title')),
    classification: String(d.get('classification')),
    origin: String(d.get('origin')),
    text: String(d.get('text')),
    synthetic: d.get('synthetic') === 'on',
  };
  const r = await guard(() => post<{ status: string; sections: number }>('/api/admin/documents', body));
  if (r) {
    flash(`등록했습니다 (${r.status}, ${r.sections}개 절). '문서 버전'에서 게시하고 '해석·내부 자료'에서 공개·전송을 승인해야 쓰입니다.`);
    form.reset();
  }
});

window.addEventListener('hashchange', () => {
  tab = (location.hash.slice(1) as Tab) || 'overview';
  void render();
});

async function boot() {
  const { data } = await adminAuth.getSession();
  if (!data.session) return showLogin();
  const me = await guard(() => api<{ label: string }>('/api/admin/me'));
  if (!me) {
    await adminAuth.signOut();
    return showLogin('관리자 권한이 없는 계정입니다.');
  }
  who = me.label;
  await render();
}

void boot();
