import { esc, must } from '../lib/dom';
import { inline, renderRich } from '../lib/markdown';
import { icons } from '../lib/icons';
import { FEEDBACK_LABEL, type FeedbackCategory } from '../api/feedback';
import type { AppActions } from '../actions';
import type { AnswerEnvelope, AssistantMessage, ErrorMessage, Message, Phase, UserMessage } from '../types';
import type { Component } from './sidebar';

function renderUser(msg: UserMessage): string {
  return `<article class="msg msg--user"><p class="bubble">${esc(msg.text)}</p></article>`;
}

const CASE_FIELD = /^[a-z][a-z0-9_]*$/;

const STATUS_NOTE: Partial<Record<AnswerEnvelope['status'], { tone: string; text: string }>> = {
  insufficient_evidence: { tone: 'flag', text: '조금 더 알려 주시면 근거를 찾을 수 있어요' },
  date_unclear: { tone: 'flag', text: '적용 시점 확인 필요' },
  fallback: { tone: 'flag', text: '자동 답변 실패 · 근거만 표시' },
};

const ASSESSMENT_LABEL = { applicable: '해당', not_applicable: '비해당', needs_review: '추가 확인 필요' } as const;

function sourceLabel(e: AnswerEnvelope, ref: string): string {
  const s = e.sources.find((x) => x.ref === ref);
  if (!s) return ref;
  return `${s.code ?? s.title.replace(/소방시설 설치 및 관리에 관한 법률/u, '소방시설법').replace(/다중이용업소의 안전관리에 관한 특별법/u, '다중이용업소법')} ${s.locator}`;
}

function renderFeedback(msg: AssistantMessage): string {
  if (!msg.serverId) return '';
  if (msg.feedback === 'sent') return `<p class="feedback__done">신고가 접수되었습니다. 담당자가 확인합니다.</p>`;
  const toggle = `<button type="button" class="btn btn--quiet btn--compact" data-action="toggle-feedback" data-id="${esc(msg.id)}"
    aria-expanded="${msg.feedback === 'open' || msg.feedback === 'failed'}">${icons.flag()} 오류 신고</button>`;
  if (msg.feedback === 'idle') return toggle;
  const options = (Object.keys(FEEDBACK_LABEL) as FeedbackCategory[])
    .map((k) => `<option value="${k}">${esc(FEEDBACK_LABEL[k])}</option>`)
    .join('');
  return `${toggle}
    <form class="feedback" data-id="${esc(msg.id)}">
      <label class="feedback__row"><span>문제 유형</span><select name="category">${options}</select></label>
      <label class="feedback__row"><span>설명 (선택)</span><textarea name="comment" rows="2" maxlength="2000"
        placeholder="어느 부분이 틀렸는지 알려 주세요"></textarea></label>
      ${msg.feedback === 'failed' ? '<p class="feedback__error">신고를 보내지 못했습니다. 다시 시도해 주세요.</p>' : ''}
      <button type="submit" class="btn btn--compact btn--primary" ${msg.feedback === 'sending' ? 'disabled' : ''}>
        ${msg.feedback === 'sending' ? '보내는 중…' : '신고 보내기'}</button>
    </form>`;
}

function renderAssistant(msg: AssistantMessage, selected: boolean, hasCase: boolean): string {
  const e = msg.envelope;
  const a = e.answer;
  const note = STATUS_NOTE[e.status];

  const statements = a.statements.length
    ? `<ul class="statements">${a.statements
        .map(
          (s) => `<li>${inline(s.text)} ${s.sourceIds
            .map((ref) => {
              const src = e.sources.find((x) => x.ref === ref);
              return src
                ? `<button type="button" class="cite" data-action="open-source" data-source="${esc(src.id)}"
                    data-id="${esc(msg.id)}" title="${esc(sourceLabel(e, ref))}">${esc(ref)}</button>`
                : '';
            })
            .join('')}</li>`,
        )
        .join('')}</ul>`
    : '';

  // 규칙 결과는 AI 설명과 분리해 표로 보여 준다 (ISS-016)
  const assessment = e.assessment.length
    ? `<div class="assess">
        <p class="assess__label">${
          e.assessment.some((x) => x.ruleSetVersion.includes('검토 전'))
            ? '검토 전 규칙(개발용)으로 계산한 설치 대상 판단 · 실제 판단에 쓰지 마세요'
            : '담당자가 승인한 규칙에 따른 설치 대상 판단'
        }</p>
        <ul>${e.assessment
          .map(
            (x) => `<li class="assess__row">
              <span>${esc(x.facility)}</span>
              <span class="assess__status assess__status--${x.status}">${ASSESSMENT_LABEL[x.status]}</span>
            </li>`,
          )
          .join('')}</ul>
      </div>`
    : a.mode === 'case_guidance' || a.statements.length
      ? `<p class="search-note">검색된 법령 안내입니다. 이 영업장의 설치 대상 여부를 판정한 결과가 아닙니다.</p>`
      : '';

  const followUps = a.followUpQuestions.length
    ? `<div class="followups"><p class="followups__label">${
        e.status === 'insufficient_evidence' ? '아래를 알려 주세요' : '더 정확히 안내하려면'
      }</p>${a.followUpQuestions
        .map((q) =>
          // 영업장 조건 항목이면 질문으로 보내지 않고 조건 입력 칸을 연다
          hasCase && CASE_FIELD.test(q.field)
            ? `<button type="button" class="chip" data-action="open-case">${esc(q.question)} ›</button>`
            : `<button type="button" class="chip" data-action="follow-up" data-text="${esc(q.question)}">${esc(q.question)}</button>`,
        )
        .join('')}</div>`
    : '';

  const limitations = a.limitations.length
    ? `<ul class="limits">${a.limitations.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`
    : '';

  const sources = e.sources.length
    ? `<div class="law-card">
        <p class="law-card__label">근거 ${e.sources.length}건 · 기준일 ${esc(e.asOf)}</p>
        <div class="law-card__refs">
          ${e.sources
            .slice(0, 4)
            .map(
              (s) => `<button type="button" class="chip" data-action="open-source" data-source="${esc(s.id)}" data-id="${esc(msg.id)}">
                ${esc(s.ref)} ${esc(sourceLabel(e, s.ref))}</button>`,
            )
            .join('')}
          <button type="button" class="chip chip--quiet" data-action="show-sources" data-id="${esc(msg.id)}"
            aria-pressed="${selected}">전체 근거 보기</button>
        </div>
      </div>`
    : '';

  return `<article class="msg msg--assistant">
    <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
    <div class="msg__body">
      ${note ? `<p class="status-note tone-${note.tone}">${esc(note.text)}</p>` : ''}
      <div class="doc">${renderRich(a.summary)}</div>
      ${assessment}
      ${statements}
      ${followUps}
      ${limitations}
      ${sources}
      <p class="disclaimer">${esc(e.disclaimer)}</p>
      <div class="msg__actions">${renderFeedback(msg)}</div>
    </div>
  </article>`;
}

function renderError(msg: ErrorMessage, busy: boolean): string {
  return `<article class="msg msg--assistant msg--error">
    <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
    <div class="msg__body">
      <p class="status-note tone-flag" role="alert">${esc(msg.text)}</p>
      ${msg.retry ? `<button type="button" class="btn btn--compact" data-action="retry" data-id="${esc(msg.id)}" ${busy ? 'disabled' : ''}>다시 시도</button>` : ''}
    </div>
  </article>`;
}

function renderMessage(msg: Message, selectedId: string | null, busy: boolean, hasCase: boolean): string {
  if (msg.role === 'user') return renderUser(msg);
  if (msg.role === 'error') return renderError(msg, busy);
  return renderAssistant(msg, msg.id === selectedId, hasCase);
}

const EMPTY_STATE = `<article class="msg msg--assistant">
  <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
  <div class="msg__body">
    <p>무엇을 도와드릴까요? 소방시설 설치 기준과 근거 법령을 찾아 드립니다.</p>
    <div class="followups">
      <button type="button" class="chip" data-action="follow-up" data-text="학원에 소화기를 설치해야 하나요?">학원에 소화기를 설치해야 하나요?</button>
      <button type="button" class="chip" data-action="follow-up" data-text="학원의 수용인원은 어떻게 계산하나요?">학원의 수용인원은 어떻게 계산하나요?</button>
      <button type="button" class="chip" data-action="follow-up" data-text="근린생활시설의 자동화재탐지설비 설치 기준은?">근린생활시설의 자동화재탐지설비 설치 기준은?</button>
    </div>
    <p class="disclaimer">로그인하지 않아도 질문할 수 있습니다.</p>
  </div>
</article>`;

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  sending: '질문을 보내는 중',
  searching: '관련 법령을 찾는 중',
  writing: '근거를 확인하며 답변을 작성하는 중',
};

function pending(phase: Exclude<Phase, 'idle'>): string {
  return `<article class="msg msg--assistant">
    <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
    <div class="msg__body">
      <p class="typing" role="status" aria-label="${PHASE_LABEL[phase]}"><span></span><span></span><span></span></p>
      <p class="phase" aria-hidden="true">${PHASE_LABEL[phase]}…</p>
    </div>
  </article>`;
}

export function mountMessageList(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `<div class="messages__inner"></div>`;
  const inner = must<HTMLDivElement>('.messages__inner', root);
  let busy = false;

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>('[data-action]');
    if (el === null) return;
    const id = el.dataset['id'] ?? '';

    switch (el.dataset['action']) {
      case 'open-source':
        actions.openSource(el.dataset['source'] ?? '', id);
        break;
      case 'show-sources':
        actions.showSources(id);
        break;
      case 'follow-up':
        if (!busy) actions.sendMessage(el.dataset['text'] ?? '');
        break;
      case 'open-case':
        actions.openPanel('check');
        break;
      case 'retry':
        actions.retry(id);
        break;
      case 'toggle-feedback':
        actions.toggleFeedback(id);
        break;
    }
  });

  root.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('feedback')) return;
    event.preventDefault();
    const data = new FormData(form);
    actions.submitFeedback(form.dataset['id'] ?? '', String(data.get('category')) as FeedbackCategory, String(data.get('comment') ?? ''));
  });

  let lastCount = -1;
  let lastHtml = '';

  return {
    update(state) {
      busy = state.phase !== 'idle';
      const active = state.conversations.find((c) => c.id === state.activeConversationId);
      const messages = active?.messages ?? [];
      const loading = active !== undefined && !active.loaded;

      const body = loading
        ? '<p class="phase">대화를 불러오는 중…</p>'
        : messages.length === 0 && !busy
          ? EMPTY_STATE
          : messages.map((m) => renderMessage(m, state.selectedAnswerId, busy, Boolean(active?.caseId))).join('');
      const html = body + (state.phase !== 'idle' ? pending(state.phase) : '');

      // 입력 중인 신고 양식이 지워지지 않도록 바뀐 경우에만 다시 그린다
      if (html !== lastHtml) {
        inner.innerHTML = html;
        lastHtml = html;
      }

      // 새 메시지가 붙었을 때만 아래로 스크롤합니다. 위를 읽는 중이면 건드리지 않습니다.
      const count = messages.length + (state.phase !== 'idle' ? 1 : 0);
      if (count !== lastCount) {
        lastCount = count;
        root.scrollTop = root.scrollHeight;
      }
    },
  };
}
