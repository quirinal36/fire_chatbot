import { PROVIDER_LABEL } from '../auth';
import { esc, must, onAction } from '../lib/dom';
import { icons } from '../lib/icons';
import type { AppActions } from '../actions';
import type { AppState } from '../types';

export interface Component {
  update(state: AppState): void;
}

export function mountSidebar(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `
    <div class="brand">
      <span class="brand__mark">${icons.flame(18)}</span>
      <span>
        <span class="brand__name">소방본부 AI 상담</span>
        <span class="brand__sub">소방법 · 신규 건축물 · 설치 기준</span>
      </span>
    </div>

    <button type="button" class="btn" data-action="new-chat">
      ${icons.plus()} 새 대화
    </button>

    <p class="sidebar__section-title" id="conv-list-label">최근 대화</p>
    <ul class="conv-list" aria-labelledby="conv-list-label"></ul>

    <div class="account-slot"></div>
  `;

  const list = must<HTMLUListElement>('.conv-list', root);
  const accountSlot = must<HTMLDivElement>('.account-slot', root);

  onAction(root, {
    'new-chat': () => actions.startNewConversation(),
    'select-conv': (el) => {
      const id = el.dataset['id'];
      if (id !== undefined) actions.selectConversation(id);
    },
    login: () => actions.openLogin(),
    logout: () => actions.signOut(),
  });

  return {
    update(state) {
      list.innerHTML = state.conversations
        .map((conv) => {
          const active = conv.id === state.activeConversationId;
          return `<li>
            <button type="button" class="conv" data-action="select-conv"
              data-id="${esc(conv.id)}" aria-current="${active}">
              <span class="conv__title">${esc(conv.title)}</span>
              <span class="conv__meta">${esc(conv.meta)}</span>
            </button>
          </li>`;
        })
        .join('');

      const { user } = state;
      accountSlot.innerHTML =
        user === null
          ? `<div class="account">
              <p class="account__hint">로그인하면 대화 기록이 계정에 저장됩니다.</p>
              <button type="button" class="btn btn--primary" data-action="login">로그인</button>
            </div>`
          : `<div class="account account--in">
              <span class="avatar" aria-hidden="true">${esc(user.name.slice(0, 1))}</span>
              <span class="account__who">
                <span class="account__name">${esc(user.name)} · ${esc(user.department)}</span>
                <span class="account__provider">${esc(PROVIDER_LABEL[user.provider])}</span>
              </span>
              <button type="button" class="btn btn--quiet btn--icon" data-action="logout"
                aria-label="로그아웃">${icons.logout()}</button>
            </div>`;
    },
  };
}
