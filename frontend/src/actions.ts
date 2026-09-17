import type { AuthProviderId, PanelTab } from './types';

/** 화면에서 일어난 일을 앱에 알리는 통로. 컴포넌트는 상태를 직접 고치지 않습니다. */
export interface AppActions {
  selectConversation(id: string): void;
  startNewConversation(): void;
  sendMessage(text: string): void;
  openPanel(tab?: PanelTab): void;
  closePanel(): void;
  selectPanelTab(tab: PanelTab): void;
  openLogin(): void;
  closeLogin(): void;
  signIn(provider: AuthProviderId): void;
  signOut(): void;
  setSidebarWidth(px: number): void;
  setPanelWidth(px: number): void;
}
