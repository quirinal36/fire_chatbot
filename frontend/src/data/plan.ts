/**
 * 3층 평면도 도해.
 *
 * 실제 서비스에서는 업로드된 도면을 서버에서 해석해 좌표를 내려주고, 이 함수는
 * 그 좌표로 기호만 찍게 바뀝니다. 지금은 화면 확인용 고정 도면입니다.
 *
 * 기호 약속 (디자인 시스템 "아이콘" 절)
 *   적정 헤드   → success 원
 *   간격 초과   → accent 원
 *   미설치 구역 → accent 점선 원
 *   소화기      → kakao-yellow 사각형에 '소'
 */

const OK_HEADS: ReadonlyArray<readonly [number, number]> = [
  [70, 200], [110, 200], [150, 200],
  [70, 245], [110, 245], [150, 245],
  [205, 70], [250, 70], [205, 115], [250, 115],
  [315, 70], [360, 70], [315, 115], [360, 115],
  [220, 185], [270, 185], [320, 185],
  [210, 250], [260, 250], [310, 250],
];

const FLAGGED_HEADS: ReadonlyArray<readonly [number, number]> = [
  [70, 80], [138, 80], [70, 140], [138, 140],
];

const ROOM_LABELS: ReadonlyArray<readonly [number, number, string]> = [
  [40, 48, '사무실 A'],
  [40, 188, '사무실 B'],
  [190, 48, '회의실 1'],
  [300, 48, '회의실 2'],
  [190, 168, '복도'],
  [190, 238, '사무실 C'],
  [350, 168, '피난계단'],
];

const EXTINGUISHERS: ReadonlyArray<readonly [number, number]> = [
  [122, 42],
  [300, 200],
];

export function planSvg(): string {
  const ok = OK_HEADS.map(
    ([x, y]) => `<circle cx="${x}" cy="${y}" r="4" style="fill: var(--success)"></circle>`,
  ).join('');

  const flagged = FLAGGED_HEADS.map(
    ([x, y]) => `<circle cx="${x}" cy="${y}" r="4" style="fill: var(--accent)"></circle>`,
  ).join('');

  const labels = ROOM_LABELS.map(
    ([x, y, text]) => `<text x="${x}" y="${y}">${text}</text>`,
  ).join('');

  const extinguishers = EXTINGUISHERS.map(
    ([x, y]) =>
      `<g><rect x="${x}" y="${y}" width="14" height="14" rx="3" style="fill: var(--kakao-yellow)"></rect>` +
      `<text x="${x + 7}" y="${y + 11}" text-anchor="middle" font-size="9" font-weight="700" ` +
      `style="fill: #141413">소</text></g>`,
  ).join('');

  return `<svg viewBox="0 0 440 320" role="img"
    aria-label="3층 평면도. 스프링클러 헤드 24개 중 사무실 A 서측 4개가 수평거리 기준을 초과하고, 동측 피난계단 전실에 헤드가 없습니다."
    font-family="var(--font-sans)">
    <g style="stroke: var(--ink); fill: var(--surface-raised)" stroke-width="2.5">
      <rect x="30" y="30" width="380" height="260"></rect>
    </g>
    <g style="stroke: var(--ink)" stroke-width="1.5" fill="none">
      <line x1="180" y1="30" x2="180" y2="290"></line>
      <line x1="30" y1="170" x2="180" y2="170"></line>
      <line x1="290" y1="30" x2="290" y2="150"></line>
      <line x1="180" y1="150" x2="410" y2="150"></line>
      <line x1="340" y1="150" x2="340" y2="290"></line>
      <line x1="180" y1="220" x2="340" y2="220"></line>
    </g>
    <rect x="60" y="60" width="90" height="90" rx="4" stroke-width="1.5" stroke-dasharray="4 3"
      style="fill: var(--accent); stroke: var(--accent)" fill-opacity="0.12"></rect>
    <g font-size="10" style="fill: var(--ink-muted)">${labels}</g>
    <g>${ok}</g>
    <g>${flagged}</g>
    <line x1="70" y1="80" x2="138" y2="80" stroke-width="1.2" style="stroke: var(--accent)"></line>
    <text x="104" y="72" text-anchor="middle" font-size="9" font-weight="600"
      style="fill: var(--accent)">3.4m</text>
    <rect x="352" y="240" width="18" height="18" rx="9" fill="none" stroke-width="1.5"
      stroke-dasharray="3 2" style="stroke: var(--accent)"></rect>
    <text x="378" y="284" text-anchor="end" font-size="9" style="fill: var(--accent)">헤드 없음</text>
    <g style="fill: var(--ink)">
      <rect x="205" y="286" width="26" height="6" rx="1"></rect>
      <rect x="400" y="200" width="8" height="26" rx="1"></rect>
    </g>
    <text x="218" y="306" text-anchor="middle" font-size="9" style="fill: var(--ink-muted)">주출입구</text>
    <text x="395" y="240" text-anchor="end" font-size="9" style="fill: var(--ink-muted)">비상구</text>
    ${extinguishers}
  </svg>`;
}
