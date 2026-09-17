import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import { FEATURES } from './config';
import { auth, AuthError } from './auth';
import { requestAnswer } from './api/chat';
import { ApiError } from './api/client';
import { sendFeedback } from './api/feedback';
import { listSessions, loadMessages } from './api/sessions';
import { fetchSource } from './api/sources';
import { must } from './lib/dom';
import { newId, newRequestId } from './lib/id';
import { createStore } from './lib/store';
import { mountChatHeader } from './components/chatHeader';
import { mountComposer } from './components/composer';
import { mountLoginModal } from './components/loginModal';
import { mountMessageList } from './components/messageList';
import { mountPanel } from './components/panel';
import { attachResizer } from './components/resizer';
import { mountSidebar, type Component } from './components/sidebar';
import type { AppActions } from './actions';
import type { AppState, AssistantMessage, Conversation, Message, PanelTab } from './types';

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

function blankConversation(): Conversation {
  return { id: newId(), title: '새 대화', meta: '방금', messages: [], loaded: true };
}

const first = blankConversation();

const store = createStore<AppState>({
  conversations: [first],
  activeConversationId: first.id,
  user: null,
  loginOpen: false,
  panelOpen: false,
  panelTab: FEATURES.planPanel ? 'plan' : 'law',
  sidebarWidth: stored.sidebar ?? 260,
  panelWidth: stored.panel ?? 520,
  phase: 'idle',
  selectedAnswerId: null,
  sourceView: null,
  notice: null,
});

function updateConversation(id: string, fn: (c: Conversation) => Conversation): void {
  store.setState((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)) }));
}

function append(id: string, message: Message): void {
  updateConversation(id, (c) => ({ ...c, messages: [...c.messages, message] }));
}

function updateMessage(conversationId: string, messageId: string, fn: (m: Message) => Message): void {
  updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) }));
}

function findAnswer(state: AppState, answerId: string): AssistantMessage | null {
  for (const c of state.conversations) {
    const m = c.messages.find((x) => x.id === answerId);
    if (m?.role === 'assistant') return m;
  }
  return null;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError || err instanceof AuthError) return err.message;
  return '답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function ask(conversationId: string, question: string, clientRequestId: string): Promise<void> {
  store.setState({ phase: 'sending' });
  try {
    const reply = await requestAnswer({ sessionId: conversationId, clientRequestId, question }, (phase) => store.setState({ phase }));
    const answer: AssistantMessage = {
      id: reply.messageId ?? newId(),
      role: 'assistant',
      serverId: reply.messageId,
      envelope: reply.envelope,
      feedback: 'idle',
    };
    append(conversationId, answer);
    updateConversation(conversationId, (c) => (c.title === '새 대화' ? { ...c, title: question.slice(0, 40), meta: '오늘' } : c));
    // 근거가 있으면 패널에 바로 띄운다. 좁은 화면에서는 사용자가 열 때까지 기다린다
    const wide = window.innerWidth >= 1080;
    store.setState((s) => ({
      selectedAnswerId: answer.id,
      sourceView: null,
      panelOpen: s.panelOpen || (wide && reply.envelope.sources.length > 0),
      panelTab: reply.envelope.assessment.length ? 'check' : s.panelTab === 'plan' && !FEATURES.planPanel ? 'law' : s.panelTab,
    }));
  } catch (err) {
    // 처리 중(409 in_progress)이 아니면 같은 요청 번호로 재시도할 수 있게 둔다
    const retryable = !(err instanceof ApiError && ['request_conflict', 'invalid_request', 'not_found'].includes(err.code));
    append(conversationId, {
      id: newId(),
      role: 'error',
      text: errorText(err),
      retry: retryable ? { clientRequestId, question } : null,
    });
  } finally {
    store.setState({ phase: 'idle' });
  }
}

async function loadConversation(id: string): Promise<void> {
  const conv = store.getState().conversations.find((c) => c.id === id);
  if (!conv || conv.loaded) return;
  try {
    const messages = await loadMessages(id);
    updateConversation(id, (c) => ({ ...c, messages, loaded: true }));
    const last = [...messages].reverse().find((m): m is AssistantMessage => m.role === 'assistant');
    store.setState({ selectedAnswerId: last?.id ?? null, sourceView: null });
  } catch (err) {
    store.setState({ notice: errorText(err) });
  }
}

async function refreshSessions(): Promise<void> {
  try {
    const sessions = await listSessions();
    store.setState((s) => {
      const active = s.conversations.find((c) => c.id === s.activeConversationId);
      // 아직 서버에 없는 새 대화(질문 전)는 목록 맨 앞에 둔다
      const keep = active && !sessions.some((x) => x.id === active.id) && active.messages.length === 0 ? [active] : [];
      const merged = sessions.map((x) => s.conversations.find((c) => c.id === x.id && c.loaded) ?? x);
      return { conversations: [...keep, ...merged] };
    });
  } catch (err) {
    store.setState({ notice: errorText(err) });
  }
}

const actions: AppActions = {
  selectConversation(id) {
    store.setState({ activeConversationId: id, selectedAnswerId: null, sourceView: null });
    void loadConversation(id);
  },

  startNewConversation() {
    const state = store.getState();
    const current = state.conversations.find((c) => c.id === state.activeConversationId);
    if (current && current.messages.length === 0) return;
    const conversation = blankConversation();
    store.setState((s) => ({
      conversations: [conversation, ...s.conversations],
      activeConversationId: conversation.id,
      selectedAnswerId: null,
      sourceView: null,
    }));
  },

  sendMessage(text) {
    const state = store.getState();
    if (state.phase !== 'idle') return;
    const conversationId = state.activeConversationId;
    append(conversationId, { id: newId(), role: 'user', text });
    void ask(conversationId, text, newRequestId());
  },

  retry(errorMessageId) {
    const state = store.getState();
    if (state.phase !== 'idle') return;
    const conversationId = state.activeConversationId;
    const conv = state.conversations.find((c) => c.id === conversationId);
    const msg = conv?.messages.find((m) => m.id === errorMessageId);
    if (msg?.role !== 'error' || msg.retry === null) return;
    const { question, clientRequestId } = msg.retry;
    updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== errorMessageId) }));
    void ask(conversationId, question, clientRequestId);
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

  showSources(answerId) {
    store.setState({ selectedAnswerId: answerId, sourceView: null, panelOpen: true, panelTab: 'law' });
  },

  openSource(sourceId, answerId) {
    store.setState((s) => ({
      selectedAnswerId: answerId ?? s.selectedAnswerId,
      sourceView: { id: sourceId, state: 'loading' },
      panelOpen: true,
      panelTab: 'law',
    }));
    fetchSource(sourceId)
      .then((detail) => {
        if (store.getState().sourceView?.id === sourceId) store.setState({ sourceView: { id: sourceId, state: 'ready', detail } });
      })
      .catch((err: unknown) => {
        if (store.getState().sourceView?.id === sourceId) {
          store.setState({ sourceView: { id: sourceId, state: 'error', message: errorText(err) } });
        }
      });
  },

  closeSource() {
    store.setState({ sourceView: null });
  },

  toggleFeedback(answerId) {
    const state = store.getState();
    const answer = findAnswer(state, answerId);
    if (!answer || answer.feedback === 'sent' || answer.feedback === 'sending') return;
    updateMessage(state.activeConversationId, answerId, (m) =>
      m.role === 'assistant' ? { ...m, feedback: m.feedback === 'open' ? 'idle' : 'open' } : m,
    );
  },

  submitFeedback(answerId, category, comment) {
    const state = store.getState();
    const conversationId = state.activeConversationId;
    const answer = findAnswer(state, answerId);
    if (!answer?.serverId) return;
    const set = (feedback: AssistantMessage['feedback']) =>
      updateMessage(conversationId, answerId, (m) => (m.role === 'assistant' ? { ...m, feedback } : m));
    set('sending');
    sendFeedback(answer.serverId, category, comment)
      .then(() => set('sent'))
      .catch(() => set('failed'));
  },

  openLogin() {
    store.setState({ loginOpen: true });
  },

  closeLogin() {
    store.setState({ loginOpen: false });
  },

  signIn(provider) {
    auth.signIn(provider).catch((err: unknown) => {
      store.setState({ loginOpen: false, notice: errorText(err) });
    });
  },

  signOut() {
    void auth.signOut().then((user) => {
      const conversation = blankConversation();
      store.setState({
        user,
        conversations: [conversation],
        activeConversationId: conversation.id,
        selectedAnswerId: null,
        sourceView: null,
      });
      void refreshSessions();
    });
  },

  dismissNotice() {
    store.setState({ notice: null });
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

// 세션을 복구(없으면 비회원 세션 생성)한 뒤 대화 목록을 불러온다
auth
  .restore()
  .then((user) => {
    store.setState({ user });
    return refreshSessions();
  })
  .catch((err: unknown) => store.setState({ notice: errorText(err) }));

// 소셜 로그인에서 돌아오면 사용자 정보가 바뀐다
auth.onChange((user) => {
  const prev = store.getState().user;
  if (prev?.id === user?.id && prev?.anonymous === user?.anonymous) return;
  store.setState({ user });
});

app.dataset['ready'] = 'true';
