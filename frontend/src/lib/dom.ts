/** DOM 유틸 — 선택자 조회와 HTML 이스케이프 */

/** 반드시 존재해야 하는 요소를 찾습니다. 없으면 즉시 실패시켜 원인을 드러냅니다. */
export function must<T extends Element>(
  selector: string,
  root: ParentNode = document,
): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  }
  return found;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 사용자 입력이나 서버 응답을 HTML 에 넣기 전에 반드시 통과시킵니다. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** **굵게** 표시만 허용하는 최소 마크업 변환. 나머지는 모두 이스케이프됩니다. */
export function inlineMarkup(value: string): string {
  return esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** 클릭 위임. data-action 속성을 읽어 핸들러를 부릅니다. */
export function onAction(
  root: Element,
  handlers: Record<string, (el: HTMLElement, event: MouseEvent) => void>,
): void {
  root.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl === null || !root.contains(actionEl)) return;
    const action = actionEl.dataset['action'];
    if (action === undefined) return;
    const handler = handlers[action];
    if (handler !== undefined) handler(actionEl, event as MouseEvent);
  });
}
