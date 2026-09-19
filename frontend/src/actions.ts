import type { FeedbackCategory } from './api/feedback';
import type { AuthProviderId, PanelTab } from './types';

/** 화면에서 일어난 일을 앱에 알리는 통로. 컴포넌트는 상태를 직접 고치지 않습니다. */
export interface AppActions {
  selectConversation(id: string): void;
  startNewConversation(): void;
  sendMessage(text: string): void;
  /** 실패한 요청을 같은 요청 번호로 다시 보낸다 */
  retry(errorMessageId: string): void;
  openPanel(tab?: PanelTab): void;
  closePanel(): void;
  selectPanelTab(tab: PanelTab): void;
  /** 도면 작업 공간 넓히기·되돌리기 */
  setPanelExpanded(on: boolean): void;
  /** 답변의 근거 목록을 패널에 띄운다 */
  showSources(answerId: string): void;
  /** 근거 카드 한 건의 원문을 연다 */
  openSource(sourceId: string, answerId?: string): void;
  closeSource(): void;
  toggleFeedback(answerId: string): void;
  /** 현재 대화에 영업장 사례를 만든다 */
  startCase(): void;
  saveCaseFields(patch: import('./api/cases').FieldPatch): void;
  reloadCase(): void;
  submitFeedback(answerId: string, category: FeedbackCategory, comment: string): void;
  openLogin(): void;
  closeLogin(): void;
  signIn(provider: AuthProviderId): void;
  signOut(): void;
  dismissNotice(): void;
  setSidebarWidth(px: number): void;
  setPanelWidth(px: number): void;
}
