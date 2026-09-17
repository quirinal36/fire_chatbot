import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import { auth } from './auth';
import { requestAnswer } from './api/chat';
import { initialConversations } from './data/conversations';
import { must } from './lib/dom';
import { createStore } from './lib/store';
import { mountChatHeader } from './components/chatHeader';
import { mountComposer } from './components/composer';
import { mountLoginModal } from './components/loginModal';
import { mountMessageList } from './components/messageList';
import { mountPanel } from './components/panel';
import { attachResizer } from './components/resizer';
import { mountSidebar, type Component } from './components/sidebar';
import type { AppActions } from './actions';
import type { AppState, Conversation, Message, PanelTab } from './types';

const WIDTH_KEY = 'fire-chatbot.widths';

interface StoredWidths {
  sidebar?: number;
  panel?: number;
}

function readWidths(): StoredWidths {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    return raw === null ? {} : (JSON.parse(raw) as StoredWidths);
  } catch {
    return {};
  }
}

function writeWidths(widths: StoredWidths): void {
  try {
    localStorage.setItem(WIDTH_KEY, JSON.stringify(widths));
  } catch {
    // 저장 실패는 화면 동작에 영향을 주지 않습니다.
  }
}

const stored = readWidths();
const firstConversation = initialConversations[0];

const store = createStore<AppState>({
  conversations: initialConversations,
  activeConversationId: firstConversation?.id ?? '',
  user: null,
  loginOpen: false,
  panelOpen: window.innerWidth >= 1080,
  panelTab: 'plan',
  sidebarWidth: stored.sidebar ?? 260,
  panelWidth: stored.panel ?? 520,
  pending: false,
});

/** 활성 대화에 메시지를 덧붙인 새 목록을 만듭니다. */
function appendMessage(
  conversations: readonly Conversation[],
  id: string,
  message: Message,
): readonly Conversation[] {
  return conversations.map((conv) =>
    conv.id === id ? { ...conv, messages: [...conv.messages, message] } : conv,
  );
}

let newConversationCount = 0;

const actions: AppActions = {
  selectConversation(id) {
    store.setState({ activeConversationId: id });
  },

  startNewConversation() {
    newConversationCount += 1;
    const conversation: Conversation = {
      id: `c-new-${newConversationCount}`,
      title: '새 대화',
      meta: '방금',
      messages: [],
    };
    store.setState((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
    }));
  },

  sendMessage(text) {
    const state = store.getState();
    const conversationId = state.activeConversationId;

    store.setState({
      conversations: appendMessage(state.conversations, conversationId, {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
      }),
      pending: true,
    });

    void requestAnswer({ conversationId, question: text })
      .then((answer) => {
        store.setState((current) => ({
          conversations: appendMessage(current.conversations, conversationId, answer),
          pending: false,
        }));
      })
      .catch(() => {
        store.setState((current) => ({
          conversations: appendMessage(current.conversations, conversationId, {
            id: `e-${Date.now()}`,
            role: 'assistant',
            paragraphs: ['답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'],
          }),
          pending: false,
        }));
      });
  },

  openPanel(tab?: PanelTab) {
    store.setState(tab === undefined ? { panelOpen: true } : { panelOpen: true, panelTab: tab });
  },

  closePanel() {
    store.setState({ panelOpen: false });
  },

  selectPanelTab(tab) {
    store.setState({ panelTab: tab });
  },

  openLogin() {
    store.setState({ loginOpen: true });
  },

  closeLogin() {
    store.setState({ loginOpen: false });
  },

  signIn(provider) {
    void auth.signIn(provider).then((user) => {
      store.setState({ user, loginOpen: false });
    });
  },

  signOut() {
    void auth.signOut().then(() => {
      store.setState({ user: null });
    });
  },

  setSidebarWidth(px) {
    store.setState({ sidebarWidth: px });
    writeWidths({ ...readWidths(), sidebar: px });
  },

  setPanelWidth(px) {
    store.setState({ panelWidth: px });
    writeWidths({ ...readWidths(), panel: px });
  },
};

const app = must<HTMLDivElement>('.app');
const sidebarEl = must<HTMLElement>('.sidebar');
const panelEl = must<HTMLElement>('.panel');

const components: readonly Component[] = [
  mountSidebar(sidebarEl, actions),
  mountChatHeader(must<HTMLElement>('.chat__header'), actions),
  mountMessageList(must<HTMLElement>('.messages'), actions),
  mountComposer(must<HTMLElement>('.composer-wrap'), actions),
  mountPanel(panelEl, actions),
  mountLoginModal(must<HTMLElement>('.modal'), actions),
];

attachResizer({
  handle: must<HTMLElement>('.resizer[data-target="sidebar"]'),
  min: 200,
  max: 420,
  edge: 'left',
  getWidth: () => store.getState().sidebarWidth,
  onResize: (width) => actions.setSidebarWidth(width),
});

attachResizer({
  handle: must<HTMLElement>('.resizer[data-target="panel"]'),
  min: 360,
  max: 760,
  edge: 'right',
  getWidth: () => store.getState().panelWidth,
  onResize: (width) => actions.setPanelWidth(width),
});

const panelResizer = must<HTMLElement>('.resizer[data-target="panel"]');

function render(state: AppState): void {
  sidebarEl.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  panelResizer.hidden = !state.panelOpen;
  for (const component of components) component.update(state);
}

store.subscribe(render);
render(store.getState());

// 새로고침해도 로그인 상태를 유지합니다.
void auth.restore().then((user) => {
  if (user !== null) store.setState({ user });
});

app.dataset['ready'] = 'true';
