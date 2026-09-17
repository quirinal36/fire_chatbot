/**
 * 선 아이콘 모음 — 굵기 2px, 둥근 끝, currentColor 상속.
 * 디자인 시스템의 "아이콘" 절을 따릅니다. 이모지는 쓰지 않습니다.
 */

function stroke(path: string, size: number): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${path}</svg>`
  );
}

export const icons = {
  flame: (size = 18): string =>
    stroke(
      '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3.5.5 1.5 1.5 2 2 2 .5-1-.5-3 1-7z"></path>' +
        '<path d="M6 14a6 6 0 0 0 12 0"></path>',
      size,
    ),

  plus: (size = 16): string => stroke('<path d="M12 5v14M5 12h14"></path>', size),

  panel: (size = 15): string =>
    stroke(
      '<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M14 3v18M3 12h11"></path>',
      size,
    ),

  grid: (size = 15): string =>
    stroke(
      '<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M3 9h18M9 21V9"></path>',
      size,
    ),

  file: (size = 16): string =>
    stroke('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path>', size),

  law: (size = 16): string =>
    stroke(
      '<path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="M9 13h6M9 17h6"></path>',
      size,
    ),

  clip: (size = 18): string =>
    stroke(
      '<path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"></path>',
      size,
    ),

  send: (size = 18): string => stroke('<path d="M12 19V5M5 12l7-7 7 7"></path>', size),

  download: (size = 16): string => stroke('<path d="M12 3v12M6 11l6 6 6-6M4 21h16"></path>', size),

  close: (size = 16): string => stroke('<path d="M6 6l12 12M18 6L6 18"></path>', size),

  flag: (size = 14): string => stroke('<path d="M5 21V4M5 4h11l-2 4 2 4H5"></path>', size),

  back: (size = 16): string => stroke('<path d="M15 6l-6 6 6 6"></path>', size),

  external: (size = 14): string =>
    stroke('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>', size),

  logout: (size = 16): string =>
    stroke(
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>',
      size,
    ),
} as const;

/** 구글 로고 — 브랜드 고정색이라 currentColor 를 쓰지 않습니다. */
export const googleLogo = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"></path>
  <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"></path>
  <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z"></path>
  <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z"></path>
</svg>`;

export const kakaoLogo = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="#141413" d="M12 3C6.5 3 2 6.5 2 10.8c0 2.7 1.8 5.1 4.5 6.5l-1 3.8c-.1.3.2.5.5.3l4.4-3c.5.1 1.1.1 1.6.1 5.5 0 10-3.5 10-7.7S17.5 3 12 3z"></path>
</svg>`;
