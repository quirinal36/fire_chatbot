import { must, onAction } from '../lib/dom';
import { googleLogo, icons, kakaoLogo } from '../lib/icons';
import type { AppActions } from '../actions';
import type { Component } from './sidebar';

export function mountLoginModal(root: HTMLElement, actions: AppActions): Component {
  root.innerHTML = `
    <button type="button" class="modal__scrim" data-action="close" aria-label="닫기"></button>
    <div class="modal__card" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div class="modal__head">
        <span class="modal__mark">${icons.flame(26)}</span>
        <h2 class="modal__title" id="login-title">소방본부 AI 상담</h2>
        <p class="modal__sub">로그인하면 대화 기록이 계정에 저장됩니다.</p>
      </div>

      <div class="providers">
        <button type="button" class="btn provider" data-action="google">
          ${googleLogo} Google로 계속하기
        </button>
        <button type="button" class="btn provider provider--kakao" data-action="kakao">
          ${kakaoLogo} 카카오로 계속하기
        </button>
      </div>

      <div class="modal__foot">
        <button type="button" class="btn btn--quiet btn--compact" data-action="close">
          로그인 없이 계속하기
        </button>
        <p class="modal__terms">
          계속하면 <a href="#terms">이용약관</a> 및 <a href="#privacy">개인정보처리방침</a>에
          동의하는 것으로 간주됩니다.
        </p>
      </div>
    </div>
  `;

  const card = must<HTMLDivElement>('.modal__card', root);
  let restoreFocusTo: HTMLElement | null = null;

  onAction(root, {
    close: () => actions.closeLogin(),
    google: () => actions.signIn('google'),
    kakao: () => actions.signIn('kakao'),
  });

  // 열려 있는 동안 Escape 로 닫고, Tab 이 모달 밖으로 나가지 않게 가둡니다.
  document.addEventListener('keydown', (event) => {
    if (root.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      actions.closeLogin();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = card.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    update(state) {
      const wasHidden = root.hidden;
      root.hidden = !state.loginOpen;

      if (state.loginOpen && wasHidden) {
        const active = document.activeElement;
        restoreFocusTo = active instanceof HTMLElement ? active : null;
        must<HTMLButtonElement>('[data-action="google"]', root).focus();
      } else if (!state.loginOpen && !wasHidden) {
        restoreFocusTo?.focus();
        restoreFocusTo = null;
      }
    },
  };
}
