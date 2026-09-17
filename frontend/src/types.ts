/** 앱 전체에서 쓰는 도메인 타입 */

export type Role = 'user' | 'assistant';

export type AuthProviderId = 'google' | 'kakao';

export interface User {
  readonly id: string;
  readonly name: string;
  /** 소속 부서. 예: 예방과 */
  readonly department: string;
  readonly provider: AuthProviderId;
}

export interface Attachment {
  readonly name: string;
  /** 사람이 읽는 크기 표기. 예: 2.4 MB */
  readonly size: string;
  readonly kind: 'drawing' | 'document';
}

export interface LawRef {
  readonly id: string;
  readonly label: string;
  /** 국가법령정보센터 링크. 연동 전에는 비워 둡니다. */
  readonly href?: string;
}

export interface UserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly text: string;
  readonly attachments?: readonly Attachment[];
}

export interface AssistantAction {
  readonly id: 'open-panel' | 'draft-opinion';
  readonly label: string;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: 'assistant';
  /** 문단. 굵게 표시할 곳은 **표시** 로 감쌉니다. */
  readonly paragraphs: readonly string[];
  readonly lawRefs?: readonly LawRef[];
  readonly bullets?: readonly string[];
  readonly actions?: readonly AssistantAction[];
  readonly disclaimer?: string;
}

export type Message = UserMessage | AssistantMessage;

export interface Conversation {
  readonly id: string;
  readonly title: string;
  /** 목록에 보이는 부가 정보. 예: 오늘 · 도면 1개 */
  readonly meta: string;
  readonly messages: readonly Message[];
}

export type PanelTab = 'plan' | 'law' | 'check';

export type Tone = 'pass' | 'flag';

export interface CheckItem {
  readonly label: string;
  readonly status: string;
  readonly tone: Tone;
}

export interface PlanStat {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
}

export interface LawEntry {
  readonly source: string;
  readonly text: string;
}

/** 도면 패널이 보여주는 검토 결과 한 건 */
export interface Review {
  readonly planTitle: string;
  readonly planScale: string;
  readonly stats: readonly PlanStat[];
  readonly laws: readonly LawEntry[];
  readonly checks: readonly CheckItem[];
}

export interface AppState {
  readonly conversations: readonly Conversation[];
  readonly activeConversationId: string;
  readonly user: User | null;
  readonly loginOpen: boolean;
  readonly panelOpen: boolean;
  readonly panelTab: PanelTab;
  readonly sidebarWidth: number;
  readonly panelWidth: number;
  /** AI 응답을 기다리는 중인지 */
  readonly pending: boolean;
}
