/**
 * 마우스와 터치로 좌우 폭을 조절하는 드래그 핸들.
 * 키보드로도 조절할 수 있게 방향키를 함께 받습니다.
 */

const KEY_STEP = 16;

export interface ResizerOptions {
  readonly handle: HTMLElement;
  readonly min: number;
  readonly max: number;
  /** 'left' 는 핸들 왼쪽 패널, 'right' 는 오른쪽 패널의 폭을 바꿉니다. */
  readonly edge: 'left' | 'right';
  getWidth(): number;
  onResize(width: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function attachResizer(options: ResizerOptions): void {
  const { handle, min, max, edge } = options;

  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', String(min));
  handle.setAttribute('aria-valuemax', String(max));
  handle.tabIndex = 0;

  let startX = 0;
  let startWidth = 0;
  let pointerId: number | null = null;

  function apply(width: number): void {
    const next = clamp(Math.round(width), min, max);
    handle.setAttribute('aria-valuenow', String(next));
    options.onResize(next);
  }

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startWidth = options.getWidth();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-active');
    handle.closest('.app')?.classList.add('is-dragging');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const delta = event.clientX - startX;
    apply(edge === 'left' ? startWidth + delta : startWidth - delta);
  });

  function end(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    handle.releasePointerCapture(event.pointerId);
    handle.classList.remove('is-active');
    handle.closest('.app')?.classList.remove('is-dragging');
  }

  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);

  handle.addEventListener('keydown', (event: KeyboardEvent) => {
    const toward = edge === 'left' ? 1 : -1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      apply(options.getWidth() - KEY_STEP * toward);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      apply(options.getWidth() + KEY_STEP * toward);
    }
  });
}
