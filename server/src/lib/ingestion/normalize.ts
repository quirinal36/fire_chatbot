/**
 * 원문 → 조항·별표 단위 정규화 (ISS-008 · 기획서 §4.4).
 *
 * - locator 는 버전 안에서 고유하며 사람이 읽을 수 있다: 제7조제1항제2호가목, 별표4/1.가.1)
 * - 하위 단위는 parent 를 통해 상위 제목·조건을 되짚을 수 있다
 * - 괘선 표나 구조를 확신할 수 없는 별표는 needs_review 로 표시해 자동 판단 근거에서 뺀다
 * - 별표 원문의 줄 배치는 별표 단위 본문에 그대로 보존한다 (근거 카드 표시용)
 */
import type { RawAppendix, RawArticle, RawDocument } from '../law-api/types';

/**
 * 정규화 규칙을 바꾸면 올린다. 저장된 버전의 값과 다르면 수집 CLI 가 같은 원문을 다시 정규화한다.
 * 2: 별표의 "27의2." 가지번호, "비고" 절 분리
 * 3: 비고 아래 번호를 비고의 하위로(별표7/비고.1)
 */
export const PARSER_VERSION = '3';

export type UnitType =
  | 'chapter'
  | 'article'
  | 'paragraph'
  | 'item'
  | 'subitem'
  | 'appendix'
  | 'appendix_section'
  | 'addendum'
  | 'interpretation_part';

export interface NormalizedUnit {
  /** 정규화 결과 안에서의 임시 키. 저장 시 UUID 로 바뀐다 */
  readonly key: string;
  readonly parentKey: string | null;
  readonly unitType: UnitType;
  readonly locator: string;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly text: string;
  readonly parseStatus: 'ok' | 'needs_review';
  readonly parseNotes: string | null;
  readonly attachmentUrl: string | null;
}

/** "①" → "1". ①~⑳ 은 U+2460~U+2473 에 연속으로 있다 */
export function paragraphNumber(mark: string): string {
  const code = mark.trim().codePointAt(0) ?? 0;
  if (code >= 0x2460 && code <= 0x2473) return String(code - 0x2460 + 1);
  return mark.trim().replace(/\D+$/u, '');
}

/** "3의2." → "3의2", "가." → "가" */
const stripMark = (s: string) => s.trim().replace(/[.)]\s*$/u, '');

function appendixLabel(a: RawAppendix): string {
  const n = String(Number.parseInt(a.number, 10));
  const branch = Number.parseInt(a.branch || '0', 10);
  const kind = a.kind.includes('서식') ? '서식' : '별표';
  return `${kind}${n}${branch > 0 ? `의${branch}` : ''}`;
}

const HANGUL = /[가-힣]/u;
const BOX = /[┌┐└┘├┤┬┴┼│─━┃]/u;

/** 번호 기호의 단계와 locator 에 쓸 표기. 별표 본문의 계층 구분에 쓴다 */
const MARKERS: ReadonlyArray<[RegExp, number, (m: RegExpExecArray) => string]> = [
  [/^(비고)(?:\s|$)/u, 0, () => '비고'],
  [/^(\d+(?:의\d+)?)\.\s/u, 1, (m) => m[1]!],
  [/^([가-힣])\.\s/u, 2, (m) => m[1]!],
  [/^(\d+)\)\s/u, 3, (m) => `${m[1]})`],
  [/^([가-힣])\)\s/u, 4, (m) => `${m[1]})`],
  [/^\((\d+)\)\s/u, 5, (m) => `(${m[1]})`],
];

function markerOf(line: string): { level: number; token: string } | null {
  const body = line.trimStart();
  if (!body) return null;
  for (const [re, level, token] of MARKERS) {
    const m = re.exec(body);
    if (m) return { level, token: token(m) };
  }
  return null;
}

/** 고정 폭 줄바꿈을 잇는다. 한글 사이 줄바꿈은 단어 중간일 가능성이 높아 공백 없이 붙인다 */
export function joinWrapped(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (HANGUL.test(out.at(-1)!) && HANGUL.test(line[0]!)) out += line;
    else out += ` ${line}`;
  }
  return out;
}

interface Section {
  level: number;
  path: string[];
  heading: string;
  lines: string[];
}

/**
 * 별표 본문을 번호 계층으로 나눈다. 번호 없는 머리말은 버리지 않고 별표 단위에 남는다.
 * "비고" 뒤의 번호는 본문 번호와 겹치므로 비고의 하위로 둔다.
 */
export function splitAppendixSections(text: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let base = 0;
  let current: Section | null = null;
  for (const line of text.split('\n')) {
    const marker = markerOf(line);
    if (!marker) {
      current?.lines.push(line);
      continue;
    }
    if (marker.level === 0) {
      stack.length = 0;
      stack.push(marker.token);
      base = 1;
    } else {
      const depth = marker.level + base;
      if (stack.length > depth - 1) stack.length = depth - 1;
      // 상위 번호가 비어 있는 경우(예: 가. 로 시작하는 별표)는 빈 칸으로 둔다
      while (stack.length < depth - 1) stack.push('_');
      stack.push(marker.token);
    }
    current = { level: marker.level, path: [...stack], heading: '', lines: [line] };
    sections.push(current);
  }
  for (const s of sections) s.heading = joinWrapped(s.lines).slice(0, 120);
  return sections;
}

const sectionLocator = (path: string[]) => path.join('.');

/** 기술기준의 1.2.3 절. 부모는 번호의 앞부분이다 */
function normalizeDecimal(a: RawArticle, ordinal: number, units: NormalizedUnit[], seen: Set<string>, keyByNumber: Map<string, string>) {
  const key = `d:${a.number}:${a.key}`;
  const parentNumber = a.number.includes('.') ? a.number.slice(0, a.number.lastIndexOf('.')) : null;
  keyByNumber.set(a.number, key);
  // 기술기준 본문에는 표·그림이 <img> 태그로 들어 있다. 내용을 읽을 수 없으므로 검토 대상이다
  const hasImage = /<img\b/iu.test(a.text);
  const text = (a.text || a.title).replace(/<img\b[^>]*>(?:<\/img>)?/giu, '[그림]');
  units.push({
    key,
    parentKey: parentNumber ? (keyByNumber.get(parentNumber) ?? null) : null,
    unitType: a.number.includes('.') ? 'paragraph' : 'chapter',
    locator: unique(a.number, seen),
    ordinal,
    heading: a.title || null,
    text,
    parseStatus: hasImage ? 'needs_review' : 'ok',
    parseNotes: hasImage ? '표·그림이 이미지로만 제공됨' : null,
    attachmentUrl: null,
  });
}

interface HeadingState {
  current: string | null;
  /** 제2장 · 제2장제1절 */
  labels: Partial<Record<'편' | '장' | '절' | '관', string>>;
}

const HEADING_ORDER = ['편', '장', '절', '관'] as const;

/** "제2장 소방시설등의 설치ㆍ관리" → 제2장, 그 아래 "제1절 …" → 제2장제1절 */
function headingLocator(text: string, state: HeadingState, fallback: string): string {
  const m = /^제\s*(\d+(?:의\d+)?)\s*(편|장|절|관)/u.exec(text.trim());
  if (!m) return `편장절:${fallback}`;
  const level = m[2] as (typeof HEADING_ORDER)[number];
  const idx = HEADING_ORDER.indexOf(level);
  state.labels[level] = `제${m[1]}${level}`;
  for (const lower of HEADING_ORDER.slice(idx + 1)) delete state.labels[lower];
  return HEADING_ORDER.slice(0, idx + 1)
    .map((l) => state.labels[l] ?? '')
    .join('');
}

function normalizeArticle(a: RawArticle, ordinal: number, units: NormalizedUnit[], seen: Set<string>, headingKey: HeadingState) {
  if (a.isHeading) {
    const key = `h:${a.key}:${ordinal}`;
    units.push({
      key,
      parentKey: null,
      unitType: 'chapter',
      locator: unique(headingLocator(a.text, headingKey, a.key), seen),
      ordinal,
      heading: a.text.trim(),
      text: a.text.trim(),
      parseStatus: 'ok',
      parseNotes: null,
      attachmentUrl: null,
    });
    headingKey.current = key;
    return;
  }
  const articleLoc = unique(`제${a.number}조`, seen);
  const articleKey = `a:${a.key}:${ordinal}`;
  // 번호 없는 단일 항의 호는 조에 바로 붙인다
  const bodyText = [a.text, ...a.paragraphs.filter((p) => p.number === '').map((p) => p.text)].filter(Boolean).join('\n');
  units.push({
    key: articleKey,
    parentKey: headingKey.current,
    unitType: 'article',
    locator: articleLoc,
    ordinal,
    heading: a.title || null,
    text: bodyText,
    parseStatus: 'ok',
    parseNotes: null,
    attachmentUrl: null,
  });

  let childOrdinal = 0;
  for (const p of a.paragraphs) {
    let parentKey = articleKey;
    let parentLoc = articleLoc;
    if (p.number !== '') {
      const loc = unique(`${articleLoc}제${paragraphNumber(p.number)}항`, seen);
      parentKey = `${articleKey}:p${childOrdinal}`;
      parentLoc = loc;
      units.push({
        key: parentKey,
        parentKey: articleKey,
        unitType: 'paragraph',
        locator: loc,
        ordinal: childOrdinal++,
        heading: null,
        text: p.text,
        parseStatus: 'ok',
        parseNotes: null,
        attachmentUrl: null,
      });
    }
    for (const [ii, item] of p.items.entries()) {
      const itemLoc = unique(`${parentLoc}제${stripMark(item.number)}호`, seen);
      const itemKey = `${parentKey}:i${ii}`;
      units.push({
        key: itemKey,
        parentKey,
        unitType: 'item',
        locator: itemLoc,
        ordinal: ii,
        heading: null,
        text: item.text,
        parseStatus: 'ok',
        parseNotes: null,
        attachmentUrl: null,
      });
      for (const [si, sub] of item.subitems.entries()) {
        units.push({
          key: `${itemKey}:s${si}`,
          parentKey: itemKey,
          unitType: 'subitem',
          locator: unique(`${itemLoc}${stripMark(sub.number)}목`, seen),
          ordinal: si,
          heading: null,
          text: sub.text,
          parseStatus: 'ok',
          parseNotes: null,
          attachmentUrl: null,
        });
      }
    }
  }
}

function unique(locator: string, seen: Set<string>): string {
  let loc = locator;
  for (let n = 2; seen.has(loc); n++) loc = `${locator}#${n}`;
  seen.add(loc);
  return loc;
}

function normalizeAppendix(a: RawAppendix, ordinal: number, units: NormalizedUnit[], seen: Set<string>) {
  const label = appendixLabel(a);
  const key = `b:${a.key}:${ordinal}`;
  const hasTable = BOX.test(a.text);
  const sections = splitAppendixSections(a.text);
  const notes: string[] = [];
  if (hasTable) notes.push('괘선 표 포함: 표 구조를 자동으로 복원하지 않음');
  if (!a.text.trim()) notes.push('본문 없음: 첨부 파일로만 제공');
  else if (sections.length === 0) notes.push('번호 계층을 찾지 못함');
  const status = notes.length ? 'needs_review' : 'ok';

  const appendixLoc = unique(label, seen);
  units.push({
    key,
    parentKey: null,
    unitType: 'appendix',
    locator: appendixLoc,
    ordinal,
    heading: a.title,
    // 원래 줄 배치를 보존한다
    text: a.text,
    parseStatus: status,
    parseNotes: notes.join('; ') || null,
    attachmentUrl: a.pdfUrl ?? a.fileUrl,
  });

  const keyByPath = new Map<string, string>();
  for (const [i, s] of sections.entries()) {
    const pathKey = s.path.join('/');
    const parentPath = s.path.slice(0, -1).join('/');
    const sKey = `${key}:${i}`;
    keyByPath.set(pathKey, sKey);
    const sectionHasTable = s.lines.some((l) => BOX.test(l));
    units.push({
      key: sKey,
      parentKey: keyByPath.get(parentPath) ?? key,
      unitType: 'appendix_section',
      locator: unique(`${appendixLoc}/${sectionLocator(s.path)}`, seen),
      ordinal: i,
      heading: s.level <= 2 ? s.heading.slice(0, 80) : null,
      text: joinWrapped(s.lines),
      parseStatus: sectionHasTable ? 'needs_review' : status,
      parseNotes: sectionHasTable ? '괘선 표 포함' : status === 'ok' ? '줄바꿈 결합은 추정값' : notes.join('; '),
      attachmentUrl: null,
    });
  }
}

export function normalizeDocument(doc: RawDocument): NormalizedUnit[] {
  const units: NormalizedUnit[] = [];
  const seen = new Set<string>();
  const headingKey: HeadingState = { current: null, labels: {} };

  const keyByNumber = new Map<string, string>();
  doc.articles.forEach((a, i) =>
    a.numbering === 'decimal'
      ? normalizeDecimal(a, i, units, seen, keyByNumber)
      : normalizeArticle(a, i, units, seen, headingKey),
  );
  doc.appendices.forEach((a, i) => normalizeAppendix(a, 10_000 + i, units, seen));
  doc.addenda.forEach((b, i) => {
    const firstLine = b.text.split('\n')[0] ?? '';
    units.push({
      key: `ad:${b.key}:${i}`,
      parentKey: null,
      unitType: 'addendum',
      locator: unique(`부칙<${b.promulgatedAt ?? '날짜없음'}${b.number ? `,${b.number}` : ''}>`, seen),
      ordinal: 20_000 + i,
      heading: firstLine.slice(0, 80) || null,
      text: b.text,
      parseStatus: 'ok',
      parseNotes: null,
      attachmentUrl: null,
    });
  });

  if (doc.interpretation) {
    const parts: Array<[string, string]> = [
      ['질의요지', doc.interpretation.question],
      ['회답', doc.interpretation.answer],
      ['이유', doc.interpretation.reason],
      ['관련법령', doc.interpretation.relatedLaw],
    ];
    parts.forEach(([name, text], i) => {
      const missing = !text.trim();
      units.push({
        key: `x:${name}`,
        parentKey: null,
        unitType: 'interpretation_part',
        locator: name,
        ordinal: i,
        heading: name,
        text,
        // 이유가 비어 온 해석은 근거로 쓰기 전에 원문 확인이 필요하다 (ISS-003 발견 2)
        parseStatus: missing && name !== '관련법령' ? 'needs_review' : 'ok',
        parseNotes: missing ? `${name} 비어 있음` : null,
        attachmentUrl: null,
      });
    });
  }
  return units;
}

/** 검색 조각에 붙일 상위 문맥. 문서 제목 + 상위 단위 제목 경로 */
export function contextPath(units: readonly NormalizedUnit[], unit: NormalizedUnit): string[] {
  const byKey = new Map(units.map((u) => [u.key, u]));
  const path: string[] = [];
  let cur = unit.parentKey ? byKey.get(unit.parentKey) : undefined;
  while (cur) {
    path.unshift(cur.heading ? `${cur.locator}(${cur.heading})` : cur.locator);
    cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined;
  }
  return path;
}
