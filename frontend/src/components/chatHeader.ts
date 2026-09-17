import { esc, must, onAction } from '../lib/dom';
import { icons } from '../lib/icons';
import type { AppActions } from '../actions';
import type { Component } from './sidebar';

export function mountChatHeader(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `
    <div class="chat__title">
      <h1></h1>
      <span class="badge" hidden>비회원 대화</span>
    </div>
    <div class="chat__actions">
      <button type="button" class="btn btn--compact" data-action="toggle-panel">
        ${icons.panel()} 도면 패널
      </button>
      <button type="button" class="btn btn--compact btn--primary" data-action="login">로그인</button>
      <button type="button" class="btn btn--compact" data-action="logout" hidden>로그아웃</button>
    </div>
  `;

  const heading = must<HTMLHeadingElement>('h1', root);
  const badge = must<HTMLSpanElement>('.badge', root);
  const loginBtn = must<HTMLButtonElement>('[data-action="login"]', root);
  const logoutBtn = must<HTMLButtonElement>('[data-action="logout"]', root);
  const panelBtn = must<HTMLButtonElement>('[data-action="toggle-panel"]', root);

  onAction(root, {
    'toggle-panel': () => {
      if (panelBtn.getAttribute('aria-expanded') === 'true') actions.closePanel();
      else actions.openPanel();
    },
    login: () => actions.openLogin(),
    logout: () => actions.signOut(),
  });

  return {
    update(state) {
      const active = state.conversations.find((c) => c.id === state.activeConversationId);
      heading.textContent = active?.title ?? '새 대화';

      const anonymous = state.user === null;
      badge.hidden = !anonymous;
      loginBtn.hidden = !anonymous;
      logoutBtn.hidden = anonymous;

      panelBtn.setAttribute('aria-expanded', String(state.panelOpen));
      panelBtn.innerHTML = `${icons.panel()} ${esc(state.panelOpen ? '패널 닫기' : '도면 패널')}`;
    },
  };
}
