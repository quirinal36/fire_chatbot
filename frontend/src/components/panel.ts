import { esc, must, onAction } from '../lib/dom';
import { icons } from '../lib/icons';
import { planSvg } from '../data/plan';
import { sampleReview } from '../data/review';
import type { AppActions } from '../actions';
import type { PanelTab, Review } from '../types';
import type { Component } from './sidebar';

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'plan', label: '도면' },
  { id: 'law', label: '법령' },
  { id: 'check', label: '체크리스트' },
];

function renderPlan(review: Review): string {
  const stats = review.stats
    .map(
      (stat) => `<li class="stat">
        <span class="stat__label">${esc(stat.label)}</span>
        <span class="stat__value${stat.tone === 'flag' ? ' stat__value--flag' : ''}">${esc(stat.value)}</span>
      </li>`,
    )
    .join('');

  return `
    <div class="plan__head">
      <h2 class="plan__title">${esc(review.planTitle)}</h2>
      <span class="plan__scale">${esc(review.planScale)}</span>
    </div>
    <figure class="plan__figure">${planSvg()}</figure>
    <ul class="legend">
      <li><span class="legend__dot" style="background: var(--success)"></span>적정 헤드</li>
      <li><span class="legend__dot" style="background: var(--accent)"></span>간격 초과</li>
      <li><span class="legend__dot legend__dot--square" style="background: var(--kakao-yellow)"></span>소화기</li>
    </ul>
    <ul class="stats">${stats}</ul>
  `;
}

function renderLaw(review: Review): string {
  const entries = review.laws
    .map(
      (law) => `<li class="law-entry">
        <span class="law-entry__source">${esc(law.source)}</span>
        <span class="law-entry__text">${esc(law.text)}</span>
      </li>`,
    )
    .join('');

  return `<ul class="law-list">${entries}</ul>
    <p class="panel__note">조문 전문과 개정일은 국가법령정보센터 연동 후 표시됩니다.</p>`;
}

function renderChecks(review: Review): string {
  const items = review.checks
    .map(
      (check) => `<li class="check">
        <span class="check__dot" style="background: var(--${check.tone === 'pass' ? 'success' : 'accent'})"></span>
        <span class="check__label">${esc(check.label)}</span>
        <span class="check__status tone-${check.tone}">${esc(check.status)}</span>
      </li>`,
    )
    .join('');

  return `<ul class="check-list">${items}</ul>`;
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
          aria-label="검토 결과 내려받기">${icons.download()}</button>
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
  });

  let lastTab: PanelTab | null = null;

  return {
    update(state) {
      root.hidden = !state.panelOpen;
      root.style.setProperty('--panel-width', `${state.panelWidth}px`);
      if (!state.panelOpen) return;

      for (const tab of tabs) {
        tab.setAttribute('aria-selected', String(tab.dataset['tab'] === state.panelTab));
      }

      if (lastTab === state.panelTab) return;
      lastTab = state.panelTab;

      if (state.panelTab === 'plan') body.innerHTML = renderPlan(sampleReview);
      else if (state.panelTab === 'law') body.innerHTML = renderLaw(sampleReview);
      else body.innerHTML = renderChecks(sampleReview);
    },
  };
}
