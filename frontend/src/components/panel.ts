import { FEATURES } from '../config';
import { esc, must, onAction } from '../lib/dom';
import { icons } from '../lib/icons';
import { planSvg } from '../data/plan';
import type { AppActions } from '../actions';
import type { AnswerEnvelope, AppState, AssistantMessage, PanelTab, SourceRef, SourceView } from '../types';
import type { Component } from './sidebar';
import { collectPatch, renderCaseCard } from './caseCard';

const ALL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'plan', label: '도면' },
  { id: 'law', label: '근거 법령' },
  { id: 'check', label: '내 영업장' },
];

// 기획서 §2.2 에 따라 도면 탭은 1차 출시에서 제외한다. src/config.ts 참고.
const TABS = ALL_TABS.filter((tab) => tab.id !== 'plan' || FEATURES.planPanel);

const VERSION_LABEL: Record<string, string> = { current: '현행', scheduled: '시행예정', historical: '연혁' };

function selectedAnswer(state: AppState): AssistantMessage | null {
  const conv = state.conversations.find((c) => c.id === state.activeConversationId);
  const messages = conv?.messages ?? [];
  const pick = state.selectedAnswerId
    ? messages.find((m) => m.id === state.selectedAnswerId)
    : [...messages].reverse().find((m) => m.role === 'assistant');
  return pick?.role === 'assistant' ? pick : null;
}

function badges(s: { versionStatus: string; effectiveDate: string | null; needsReview?: boolean }): string {
  return `<span class="tag">${esc(VERSION_LABEL[s.versionStatus] ?? s.versionStatus)}</span>
    ${s.effectiveDate ? `<span class="tag tag--quiet">시행 ${esc(s.effectiveDate)}</span>` : ''}
    ${s.needsReview ? '<span class="tag tag--flag">원문 확인 필요</span>' : ''}`;
}

function renderSourceCard(s: SourceRef): string {
  return `<li class="law-entry">
    <button type="button" class="law-entry__open" data-action="open-source" data-source="${esc(s.id)}">
      <span class="law-entry__source">${esc(s.ref)} · ${esc(s.code ?? s.title)} ${esc(s.locator)}</span>
      <span class="law-entry__meta">${badges(s)}</span>
      <span class="law-entry__text">${esc(s.excerpt)}</span>
    </button>
  </li>`;
}

function renderLawList(envelope: AnswerEnvelope | null): string {
  if (!envelope || envelope.sources.length === 0) {
    return `<p class="panel__note">답변에 사용한 근거 법령이 여기에 표시됩니다.</p>`;
  }
  const pending = envelope.pendingChanges.length
    ? `<p class="panel__note tone-flag">시행예정 개정: ${envelope.pendingChanges
        .map((p) => `${esc(p.documentTitle)} (${esc(p.effectiveDate)})`)
        .join(', ')}</p>`
    : '';
  return `${pending}<ul class="law-list">${envelope.sources.map(renderSourceCard).join('')}</ul>
    <p class="panel__note">기준일 ${esc(envelope.asOf)} · 법령 데이터 ${esc(envelope.corpusVersion)}</p>`;
}

function renderSourceView(view: SourceView): string {
  const back = `<button type="button" class="btn btn--quiet btn--compact" data-action="close-source">${icons.back()} 근거 목록</button>`;
  if (view.state === 'loading') return `${back}<p class="panel__note">원문을 불러오는 중…</p>`;
  if (view.state === 'error') return `${back}<p class="panel__note tone-flag">${esc(view.message)}</p>`;

  const d = view.detail;
  const path = d.ancestors.map((a) => esc(a.heading ? `${a.locator} ${a.heading}` : a.locator)).join(' › ');
  const children = d.children.length
    ? `<ul class="source__children">${d.children
        .map((c) => `<li><button type="button" class="link" data-action="open-source" data-source="${esc(c.id)}">${esc(c.locator)}</button> ${esc(c.text)}</li>`)
        .join('')}</ul>`
    : '';
  const links = [
    d.sourceUrl ? `<a class="btn btn--compact" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icons.external()} 국가법령정보센터</a>` : '',
    d.attachmentUrl ? `<a class="btn btn--compact" href="${esc(d.attachmentUrl)}" target="_blank" rel="noopener noreferrer">${icons.download()} 별표 원본</a>` : '',
  ].join('');

  return `${back}
    <article class="source">
      <p class="source__doc">${esc(d.documentTitle)}${d.code ? ` (${esc(d.code)})` : ''}</p>
      <h2 class="source__title">${esc(d.locator)}${d.heading ? ` ${esc(d.heading)}` : ''}</h2>
      ${path ? `<p class="source__path">${path}</p>` : ''}
      <p class="law-entry__meta">${badges({ versionStatus: d.versionStatus, effectiveDate: d.effectiveDate, needsReview: d.parseStatus === 'needs_review' })}</p>
      ${d.currentUnitId ? `<p class="panel__note tone-flag">이 원문은 현행이 아닙니다. <button type="button" class="link" data-action="open-source" data-source="${esc(d.currentUnitId)}">현행 조문 보기</button></p>` : ''}
      ${d.parseStatus === 'needs_review' ? `<p class="panel__note tone-flag">표·그림이 있어 자동 추출이 불완전할 수 있습니다. 원본을 함께 확인하세요.${d.parseNotes ? ` (${esc(d.parseNotes)})` : ''}</p>` : ''}
      <pre class="source__text">${esc(d.text)}</pre>
      ${children}
      <div class="source__links">${links}</div>
      <p class="panel__note">법령 버전 ${esc(d.sourceVersionId)}${d.promulgatedAt ? ` · 공포 ${esc(d.promulgatedAt)}` : ''}</p>
    </article>`;
}

function renderChecks(envelope: AnswerEnvelope | null): string {
  if (!envelope || envelope.assessment.length === 0) {
    return `<p class="panel__note">검토된 규칙으로 판단한 결과가 있으면 여기에 표시됩니다.
      지금 답변은 법령 검색 안내이며, 영업장의 설치 대상 여부를 판정하지 않았습니다.</p>`;
  }
  const label = { applicable: '해당', not_applicable: '비해당', needs_review: '추가 확인 필요' } as const;
  const tone = { applicable: 'flag', not_applicable: 'pass', needs_review: 'flag' } as const;
  const items = envelope.assessment
    .map(
      (a) => `<li class="check">
        <span class="check__dot" style="background: var(--${tone[a.status] === 'pass' ? 'success' : 'accent'})"></span>
        <span class="check__label">${esc(a.facility)}
          <span class="check__why">${esc(a.explanation)}</span>
          ${a.missingInputs.length ? `<span class="check__why">필요한 정보: ${esc(a.missingInputs.join(', '))}</span>` : ''}
        </span>
        <span class="check__status tone-${tone[a.status]}">${label[a.status]}</span>
      </li>`,
    )
    .join('');
  const version = envelope.assessment[0]?.ruleSetVersion ?? '';
  return `<ul class="check-list">${items}</ul>
    <p class="panel__note">규칙 버전 ${esc(version)} · 사례 revision ${envelope.caseRevision ?? '-'}. 최종 판단은 관할 소방서 확인이 필요합니다.</p>`;
}

function renderPlan(): string {
  return `<figure class="plan__figure">${planSvg()}</figure>`;
}

export function mountPanel(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `
    <div class="panel__header">
      <div class="tabs" role="tablist" aria-label="검토 결과 보기">
        ${TABS.map(
          (tab) => `<button type="button" class="tab" role="tab" data-action="tab"
            data-tab="${tab.id}" aria-selected="false">${esc(tab.label)}</button>`,
        ).join('')}
      </div>
      <div class="panel__tools">
        <button type="button" class="btn btn--quiet btn--icon btn--compact"
          data-action="close" aria-label="패널 닫기">${icons.close()}</button>
      </div>
    </div>
    <div class="panel__body" role="tabpanel"></div>
  `;

  const body = must<HTMLDivElement>('.panel__body', root);
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab'));

  onAction(root, {
    close: () => actions.closePanel(),
    tab: (el) => {
      const tab = el.dataset['tab'];
      if (tab === 'plan' || tab === 'law' || tab === 'check') actions.selectPanelTab(tab);
    },
    'open-source': (el) => {
      actions.openSource(el.dataset['source'] ?? '');
    },
    'close-source': () => actions.closeSource(),
    'start-case': () => actions.startCase(),
    'reload-case': () => actions.reloadCase(),
    'confirm-field': (el) => {
      const key = el.dataset['key'] ?? '';
      const current = latest?.data?.fields[key];
      if (current?.value !== undefined && current.value !== null) {
        actions.saveCaseFields({ [key]: { value: current.value, state: 'user_confirmed' } });
      }
    },
  });

  body.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('case__form')) return;
    event.preventDefault();
    const patch = collectPatch(form);
    if (Object.keys(patch).length) actions.saveCaseFields(patch);
  });

  let latest: import('../types').CaseView | undefined;

  let lastHtml = '';
  let lastTab: PanelTab | null = null;

  return {
    update(state) {
      root.hidden = !state.panelOpen;
      root.style.setProperty('--panel-width', `${state.panelWidth}px`);
      if (!state.panelOpen) return;

      // 꺼진 탭이 요청되면 법령으로 떨어뜨린다. 빈 패널이 열리지 않게 한다.
      const tab: PanelTab = state.panelTab === 'plan' && !FEATURES.planPanel ? 'law' : state.panelTab;
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset['tab'] === tab));

      const envelope = selectedAnswer(state)?.envelope ?? null;
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      latest = conv?.caseId ? state.cases[conv.caseId] ?? { data: null, state: 'loading', message: null } : undefined;
      const html =
        tab === 'plan'
          ? renderPlan()
          : tab === 'check'
            ? renderCaseCard(latest, state.fieldDefs, conv !== undefined) + (latest ? '' : renderChecks(envelope))
            : state.sourceView
              ? renderSourceView(state.sourceView)
              : renderLawList(envelope);
      if (html !== lastHtml) {
        // 입력 중인 양식의 스크롤 위치는 유지한다
        const keepScroll = tab === 'check' && lastTab === 'check';
        const top = body.scrollTop;
        body.innerHTML = html;
        body.scrollTop = keepScroll ? top : 0;
        lastHtml = html;
      }
      lastTab = tab;
    },
  };
}
