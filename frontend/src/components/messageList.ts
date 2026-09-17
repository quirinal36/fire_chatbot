import { esc, inlineMarkup, must } from '../lib/dom';
import { icons } from '../lib/icons';
import type { AppActions } from '../actions';
import type { AssistantMessage, Message, UserMessage } from '../types';
import type { Component } from './sidebar';

function renderUser(msg: UserMessage): string {
  const attachments = (msg.attachments ?? [])
    .map(
      (file) => `<span class="attachment">
        ${icons.file()}
        <span class="attachment__name">${esc(file.name)}</span>
        <span class="attachment__size">${esc(file.size)}</span>
      </span>`,
    )
    .join('');

  return `<article class="msg msg--user">
    ${attachments}
    <p class="bubble">${esc(msg.text)}</p>
  </article>`;
}

function renderAssistant(msg: AssistantMessage): string {
  const paragraphs = msg.paragraphs.map((p) => `<p>${inlineMarkup(p)}</p>`).join('');

  const lawRefs =
    msg.lawRefs === undefined || msg.lawRefs.length === 0
      ? ''
      : `<div class="law-card">
          <p class="law-card__label">근거 법령</p>
          <div class="law-card__refs">
            ${msg.lawRefs
              .map(
                (ref) =>
                  `<a class="chip" href="${esc(ref.href ?? '#law')}"
                    data-action="show-law">${esc(ref.label)}</a>`,
              )
              .join('')}
          </div>
        </div>`;

  const bullets =
    msg.bullets === undefined || msg.bullets.length === 0
      ? ''
      : `<ul>${msg.bullets.map((b) => `<li>${inlineMarkup(b)}</li>`).join('')}</ul>`;

  const actions =
    msg.actions === undefined || msg.actions.length === 0
      ? ''
      : `<div class="msg__actions">${msg.actions
          .map((action) => {
            const icon = action.id === 'open-panel' ? `${icons.grid()} ` : '';
            return `<button type="button" class="btn btn--compact"
              data-action="${esc(action.id)}">${icon}${esc(action.label)}</button>`;
          })
          .join('')}</div>`;

  const disclaimer =
    msg.disclaimer === undefined ? '' : `<p class="disclaimer">${esc(msg.disclaimer)}</p>`;

  return `<article class="msg msg--assistant">
    <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
    <div class="msg__body">
      ${paragraphs}
      ${lawRefs}
      ${bullets}
      ${actions}
      ${disclaimer}
    </div>
  </article>`;
}

function renderMessage(msg: Message): string {
  return msg.role === 'user' ? renderUser(msg) : renderAssistant(msg);
}

const EMPTY_STATE = `<article class="msg msg--assistant">
  <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
  <div class="msg__body">
    <p>무엇을 도와드릴까요? 도면을 첨부하면 소방시설 배치를 함께 검토합니다.</p>
    <p class="disclaimer">로그인하지 않아도 질문할 수 있습니다.</p>
  </div>
</article>`;

const PENDING = `<article class="msg msg--assistant">
  <span class="msg__avatar" aria-hidden="true">${icons.flame(16)}</span>
  <div class="msg__body">
    <p class="typing" role="status" aria-label="답변을 작성하는 중입니다">
      <span></span><span></span><span></span>
    </p>
  </div>
</article>`;

export function mountMessageList(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `<div class="messages__inner"></div>`;
  const inner = must<HTMLDivElement>('.messages__inner', root);

  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>('[data-action]');
    if (el === null) return;

    const action = el.dataset['action'];
    if (action === 'open-panel') {
      actions.openPanel('plan');
    } else if (action === 'show-law') {
      event.preventDefault();
      actions.openPanel('law');
    } else if (action === 'draft-opinion') {
      actions.openPanel('check');
    }
  });

  let lastCount = -1;

  return {
    update(state) {
      const active = state.conversations.find((c) => c.id === state.activeConversationId);
      const messages = active?.messages ?? [];

      const body =
        messages.length === 0 ? EMPTY_STATE : messages.map(renderMessage).join('');
      inner.innerHTML = body + (state.pending ? PENDING : '');

      // 새 메시지가 붙었을 때만 아래로 스크롤합니다. 위를 읽는 중이면 건드리지 않습니다.
      const count = messages.length + (state.pending ? 1 : 0);
      if (count !== lastCount) {
        lastCount = count;
        root.scrollTop = root.scrollHeight;
      }
    },
  };
}
