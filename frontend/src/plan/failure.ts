/**
 * 도면 작업이 실패했을 때 보여 줄 안내와 복구 행동 (UX-006).
 *
 * 세 가지를 같은 자리에 놓는다 — 무슨 작업이 실패했는지, 왜 그런지, 다음에 무엇을 할 수 있는지.
 * 서버가 알려 준 오류 코드로만 원인을 단정한다. 모르는 오류를 한도나 로그인 문제로 바꿔 말하지 않는다.
 */

/** 실패할 수 있는 도면 작업 */
export type PlanTask = 'scale' | 'save';

/** 안내 아래에 놓을 버튼. planView 의 data-action 과 같은 이름이다 */
export type RecoveryAction = 'scale-mode' | 'scale-retry' | 'login' | 'save-retry';

export interface Failure {
  readonly message: string;
  readonly actions: readonly RecoveryAction[];
}

const TASK_LABEL: Record<PlanTask, string> = {
  scale: '자동 치수 읽기',
  save: '도면 저장',
};

/** 이 작업을 다시 해 보는 버튼 */
const RETRY: Record<PlanTask, RecoveryAction> = { scale: 'scale-retry', save: 'save-retry' };

/** 직접 길이를 입력하면 이어서 할 수 있는 작업인가 */
const MANUAL_HELPS: Record<PlanTask, boolean> = { scale: true, save: false };

function manual(task: PlanTask): RecoveryAction[] {
  return MANUAL_HELPS[task] ? ['scale-mode'] : [];
}

export interface FailureInput {
  /** 서버가 준 오류 코드. 알 수 없으면 null */
  readonly code: string | null;
  /** 서버가 준 안내. 화면에 그대로 쓰지 않고 작업 이름과 함께 덧붙인다 */
  readonly serverMessage: string | null;
}

/** ApiError 든 아니든 코드와 문구만 꺼낸다 */
export function failureInput(err: unknown): FailureInput {
  const e = err as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === 'string' ? e.code : null,
    serverMessage: typeof e?.message === 'string' && e.message ? e.message : null,
  };
}

/**
 * 작업·원인·다음 행동을 한 덩어리로 만든다.
 * `signedIn` 은 정식 로그인 상태다. 익명 세션은 false — 로그인하면 한도가 올라가는 경우에만 로그인을 권한다.
 */
export function describeFailure(task: PlanTask, input: FailureInput, signedIn: boolean): Failure {
  const label = TASK_LABEL[task];
  switch (input.code) {
    case 'rate_limited_anon':
      // 서버가 "로그인하면 한도가 올라간다" 고 알려 준 경우에만 로그인을 권한다
      return {
        message: `${label} 이용 한도에 도달했습니다. 로그인하면 오늘 더 이용할 수 있습니다.`,
        actions: signedIn ? manual(task) : ['login', ...manual(task)],
      };
    case 'rate_limited':
      return { message: `${label} 이용 한도에 도달했습니다. 내일 다시 이용할 수 있습니다.`, actions: manual(task) };
    case 'budget_exhausted':
      return { message: `오늘 ${label}에 쓸 수 있는 이용량이 모두 소진되었습니다. 내일 다시 이용할 수 있습니다.`, actions: manual(task) };
    case 'unauthorized':
      return { message: `${label}에 로그인 세션이 필요합니다. 다시 로그인해 주세요.`, actions: ['login'] };
    case 'network':
      return { message: `${label}을(를) 위해 서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.`, actions: [RETRY[task], ...manual(task)] };
    case 'model_error':
      // AI 가 못 읽은 것이다. 같은 그림으로 다시 불러도 대개 같다
      return { message: `AI 가 도면을 읽지 못했습니다 (${label}).${MANUAL_HELPS[task] ? ' 직접 길이를 입력해 계속할 수 있습니다.' : ''}`, actions: manual(task) };
    default:
      // 원인을 모른다. 단정하지 말고 서버 문구를 그대로 덧붙인 뒤 다시 시도할 길을 준다
      return {
        message: `${label}을(를) 완료하지 못했습니다${input.serverMessage ? `: ${input.serverMessage}` : '.'}`,
        actions: [RETRY[task], ...manual(task)],
      };
  }
}

/** 읽을 만한 치수를 찾지 못한 경우. 실패가 아니라 결과가 없는 것이므로 다시 부르라고 하지 않는다 */
export function noScaleFound(note: string): Failure {
  return {
    message: `도면에서 쓸 만한 치수를 찾지 못했습니다. 직접 길이를 입력해 계속할 수 있습니다. (${note})`,
    actions: ['scale-mode', 'scale-retry'],
  };
}
