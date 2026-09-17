/** 사용자에게 그대로 보여도 되는 오류. 상태 코드와 코드명을 함께 싣는다 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
