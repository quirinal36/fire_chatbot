import { FEATURES } from '../config';
import { must } from '../lib/dom';
import { icons } from '../lib/icons';
import type { AppActions } from '../actions';
import type { Component } from './sidebar';

const MAX_HEIGHT = 200;

export function mountComposer(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `
    <form class="composer" novalidate>
      <div class="composer__box">
        <label class="sr-only" for="composer-input">질문 입력</label>
        <textarea id="composer-input" class="composer__input" rows="2"
          placeholder="예: 3층 학원에 자동화재탐지설비가 필요한가요?" maxlength="1000"></textarea>
        <div class="composer__row">
          <div class="composer__tools">
            <button type="button" class="btn btn--quiet btn--icon" aria-label="도면 첨부" data-feature="planPanel">
              ${icons.clip()}
            </button>
          </div>
          <button type="submit" class="btn btn--accent btn--icon composer__send"
            aria-label="보내기" disabled>${icons.send()}</button>
        </div>
      </div>
      <p class="composer__note">
        로그인 없이도 질문할 수 있습니다.
      </p>
    </form>
  `;

  // 도면 첨부는 기획서 §2.2 의 후속 범위다. src/config.ts 참고.
  const attach = must<HTMLButtonElement>('[data-feature="planPanel"]', root);
  attach.hidden = !FEATURES.planPanel;

  const form = must<HTMLFormElement>('form', root);
  const input = must<HTMLTextAreaElement>('#composer-input', root);
  const send = must<HTMLButtonElement>('.composer__send', root);
  const note = must<HTMLParagraphElement>('.composer__note', root);

  function resize(): void {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_HEIGHT)}px`;
  }

  let busy = false;

  function submit(): void {
    const text = input.value.trim();
    if (text === '' || busy) return;
    actions.sendMessage(text);
    input.value = '';
    send.disabled = true;
    resize();
  }

  input.addEventListener('input', () => {
    send.disabled = input.value.trim() === '';
    resize();
  });

  // Enter 로 보내고, Shift+Enter 로 줄을 바꿉니다.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  return {
    update(state) {
      busy = state.phase !== 'idle';
      send.disabled = busy || input.value.trim() === '';
      note.textContent =
        state.user === null || state.user.anonymous
          ? '로그인 없이도 질문할 수 있습니다. 답변은 참고용이며 최종 판단은 관할 소방서에 확인하세요.'
          : `${state.user.name} 님으로 로그인되어 있습니다. 대화가 계정에 저장됩니다.`;
    },
  };
}
