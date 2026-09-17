/** 앱 전체에서 쓰는 도메인 타입 */

export type AuthProviderId = 'google' | 'kakao';

export interface User {
  readonly id: string;
  /** 익명 세션이면 '손님' */
  readonly name: string;
  readonly provider: AuthProviderId | 'anonymous';
  readonly anonymous: boolean;
}

/** 서버 AnswerEnvelope 의 근거 한 건 (server/src/lib/chat/schema.ts) */
export interface SourceRef {
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  readonly code: string | null;
  readonly locator: string;
  readonly heading: string | null;
  readonly excerpt: string;
  readonly effectiveDate: string | null;
  readonly versionStatus: string;
  readonly needsReview: boolean;
  readonly url: string | null;
}

export type AssessmentStatus = 'applicable' | 'not_applicable' | 'needs_review';

export interface Assessment {
  readonly facility: string;
  readonly status: AssessmentStatus;
  readonly ruleId: string;
  readonly ruleSetVersion: string;
  readonly explanation: string;
  readonly missingInputs: readonly string[];
  readonly sourceIds: readonly string[];
}

export type AnswerStatus = 'answered' | 'insufficient_evidence' | 'date_unclear' | 'fallback';

export interface AnswerEnvelope {
  readonly status: AnswerStatus;
  readonly answer: {
    readonly mode: 'legal_search' | 'case_guidance';
    readonly summary: string;
    readonly statements: readonly { readonly text: string; readonly sourceIds: readonly string[] }[];
    readonly followUpQuestions: readonly { readonly field: string; readonly question: string }[];
    readonly limitations: readonly string[];
  };
  readonly assessment: readonly Assessment[];
  readonly sources: readonly SourceRef[];
  readonly asOf: string;
  readonly pendingChanges: readonly { readonly documentTitle: string; readonly effectiveDate: string }[];
  readonly caseRevision: number | null;
  readonly corpusVersion: string;
  readonly disclaimer: string;
}

export interface UserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly text: string;
}

export type FeedbackState = 'idle' | 'open' | 'sending' | 'sent' | 'failed';

export interface AssistantMessage {
  readonly id: string;
  readonly role: 'assistant';
  /** 서버 메시지 id. 오류 신고에 쓴다 */
  readonly serverId: string | null;
  readonly envelope: AnswerEnvelope;
  readonly feedback: FeedbackState;
}

/** 요청이 실패했을 때 남기는 안내. 같은 요청 번호로 다시 보낼 수 있다 */
export interface ErrorMessage {
  readonly id: string;
  readonly role: 'error';
  readonly text: string;
  readonly retry: { readonly clientRequestId: string; readonly question: string } | null;
}

export type Message = UserMessage | AssistantMessage | ErrorMessage;

export interface Conversation {
  readonly id: string;
  readonly title: string;
  /** 목록에 보이는 부가 정보. 예: 오늘 */
  readonly meta: string;
  readonly messages: readonly Message[];
  /** 서버에서 메시지를 불러왔는지 */
  readonly loaded: boolean;
}

export type PanelTab = 'plan' | 'law' | 'check';

export type Phase = 'idle' | 'sending' | 'searching' | 'writing';

export interface SourceDetail {
  readonly id: string;
  readonly documentTitle: string;
  readonly code: string | null;
  readonly issuer: string | null;
  readonly locator: string;
  readonly heading: string | null;
  readonly text: string;
  readonly parseStatus: 'ok' | 'needs_review';
  readonly parseNotes: string | null;
  readonly effectiveDate: string | null;
  readonly promulgatedAt: string | null;
  readonly versionStatus: string;
  readonly sourceVersionId: string;
  readonly sourceUrl: string | null;
  readonly attachmentUrl: string | null;
  readonly ancestors: readonly { readonly id: string; readonly locator: string; readonly heading: string | null }[];
  readonly children: readonly { readonly id: string; readonly locator: string; readonly heading: string | null; readonly text: string }[];
  readonly currentUnitId: string | null;
}

export type SourceView =
  | { readonly id: string; readonly state: 'loading' }
  | { readonly id: string; readonly state: 'ready'; readonly detail: SourceDetail }
  | { readonly id: string; readonly state: 'error'; readonly message: string };

export interface AppState {
  readonly conversations: readonly Conversation[];
  readonly activeConversationId: string;
  readonly user: User | null;
  readonly loginOpen: boolean;
  readonly panelOpen: boolean;
  readonly panelTab: PanelTab;
  readonly sidebarWidth: number;
  readonly panelWidth: number;
  /** 답변 처리 단계 */
  readonly phase: Phase;
  /** 패널에 근거를 보여 줄 답변 */
  readonly selectedAnswerId: string | null;
  readonly sourceView: SourceView | null;
  /** 화면 상단 알림 (로그인 실패 등) */
  readonly notice: string | null;
}
