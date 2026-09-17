/**
 * 답변·조문 본문 표시 (ISS-033).
 *
 * 서버가 주는 글은 세 종류가 섞여 있다.
 *  - 모델이 쓴 문장: **강조**, `코드`, 목록 같은 최소 markdown
 *  - 조문·별표: "1. 가. 1) 가)" 번호 계층
 *  - 별표의 표: 고정폭 공백 정렬과 괘선 문자
 *
 * 표는 배치를 그대로 두고, 번호 계층은 들여쓴 목록으로, 나머지는 문단으로 그린다.
 * 허용한 문법만 처리하고 입력은 먼저 모두 이스케이프한다. HTML·링크를 넣을 수 없다.
 */
import { esc } from './dom';

const BOX = /[┌┐└┘├┤┬┴┼│─━┃╔╗╚╝═║]/u;
/** 1. · 1) · 가. · 가) · (1) · 가) · - · • */
const MARKER = /^(\s*)(?:(\d+(?:의\d+)?)[.)]|([가-힣])[.)]|\((\d+)\)|[-*•])\s+/u;

export function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,]|$)/g, '$1<em>$2</em>');
}

/** 표·정렬이 있어 배치를 지켜야 하는 덩어리인가 */
export function isPreformatted(block: string): boolean {
  if (BOX.test(block)) return true;
  const lines = block.split('\n');
  // 줄 가운데에 3칸 이상 공백이 여러 줄 반복되면 칸 맞춤 표로 본다
  const aligned = lines.filter((l) => /\S {3,}\S/.test(l)).length;
  return lines.length >= 2 && aligned >= 2;
}

interface Item {
  level: number;
  html: string;
}

function listItems(block: string): Item[] | null {
  const lines = block.split('\n').filter((l) => l.trim() !== '');
  const items: Item[] = [];
  for (const line of lines) {
    const m = MARKER.exec(line);
    if (!m) {
      // 번호 없는 줄은 앞 항목에 이어 붙인다. 첫 줄이면 목록이 아니다
      if (items.length === 0) return null;
      items[items.length - 1]!.html += ` ${inline(line.trim())}`;
      continue;
    }
    const indent = m[1]!.length;
    // 들여쓰기가 있으면 그것으로, 없으면 번호 종류(1. → 가. → 1) → 가))로 단계를 잡는다
    const kind = m[2] !== undefined ? 0 : m[3] !== undefined ? 1 : m[4] !== undefined ? 3 : 0;
    items.push({ level: Math.min(indent > 0 ? Math.floor(indent / 2) : kind, 4), html: inline(line.trim()) });
  }
  return items.length >= 2 ? items : null;
}

function renderList(items: readonly Item[]): string {
  let html = '';
  let depth = 0;
  for (const item of items) {
    while (depth < item.level) {
      html += '<ul class="doc__list">';
      depth += 1;
    }
    while (depth > item.level) {
      html += '</ul>';
      depth -= 1;
    }
    if (depth === 0) {
      html += '<ul class="doc__list">';
      depth = 1;
    }
    html += `<li>${item.html}</li>`;
  }
  return html + '</ul>'.repeat(depth);
}

/** 블록 단위로 그린다. 반환값은 이미 이스케이프된 HTML 이다 */
export function renderRich(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return blocks
    .map((raw) => {
      const block = raw.replace(/\s+$/g, '');
      if (block.trim() === '') return '';
      if (isPreformatted(block)) return `<pre class="doc__pre">${esc(block)}</pre>`;
      const items = listItems(block);
      if (items) return renderList(items);
      return `<p>${inline(block).replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('');
}
