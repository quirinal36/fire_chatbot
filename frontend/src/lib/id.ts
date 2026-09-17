/** 요청 번호. 재전송 시 같은 값을 보내 서버가 중복을 막는다 (ISS-013) */
export function newRequestId(): string {
  return `r${crypto.randomUUID().replaceAll('-', '')}`;
}

export function newId(): string {
  return crypto.randomUUID();
}
