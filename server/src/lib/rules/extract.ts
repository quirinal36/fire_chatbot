/**
 * 자연어에서 조건 후보 뽑기 (ISS-018 · 기획서 §6.2).
 *
 * 뽑은 값은 extracted 상태의 후보일 뿐이다. 사용자가 확인해야 판단에 쓴다.
 * 무엇의 면적인지 애매하면 note 에 적고 가장 보수적인 항목(영업장 바닥면적)에만 넣는다.
 */
import type { FactValue } from './engine';

export interface Extracted {
  readonly field: string;
  readonly value: FactValue;
  readonly note: string;
}

const num = (s: string) => Number(s.replace(/,/g, ''));

export function extractCandidates(text: string): Extracted[] {
  const t = text.normalize('NFC');
  const out: Extracted[] = [];
  const push = (field: string, value: FactValue, note: string) => {
    if (!out.some((o) => o.field === field)) out.push({ field, value, note });
  };

  if (/학원|교습소|코딩\s*교실|공부방/u.test(t)) {
    push('business_use', 'academy', '질문에 학원이 언급됨');
    if (/무도\s*학원/u.test(t)) push('business_kind', 'dance', '무도학원 언급');
    else if (/(운전|정비)\s*학원/u.test(t)) push('business_kind', 'driving', '운전·정비학원 언급');
  }

  const basement = /지하\s*(\d+)\s*층/u.exec(t);
  const floor = /(?<!지하\s*)(?<![\d.])(\d{1,3})\s*층(?!\s*(?:건물|짜리|규모|이상|이하|까지|건축물))/u.exec(t);
  if (basement) push('business_floor', -num(basement[1]!), `"${basement[0]}"`);
  else if (floor) push('business_floor', num(floor[1]!), `"${floor[0]}" — 영업장이 있는 층으로 보았음`);

  const building = /(?:지상\s*)?(\d{1,3})\s*층\s*(?:건물|짜리|규모|건축물)/u.exec(t);
  if (building) push('building_floors_above', num(building[1]!), `"${building[0]}"`);

  const cap = /수용\s*인원\s*(?:은|이|:)?\s*(\d[\d,]*)\s*명|(\d[\d,]*)\s*명\s*(?:규모|정원)/u.exec(t);
  if (cap) push('capacity', num(cap[1] ?? cap[2]!), `"${cap[0]}"`);

  const areaRe = /(연\s*면적|바닥\s*면적|면적|전용\s*면적)?\s*(?:은|이|:)?\s*(\d[\d,]*(?:\.\d+)?)\s*(㎡|m2|m\^2|제곱\s*미터|평)/giu;
  for (const m of t.matchAll(areaRe)) {
    let value = num(m[2]!);
    const unit = m[3]!;
    const pyeong = unit === '평';
    if (pyeong) value = Math.round(value * 3.305785 * 100) / 100;
    const label = (m[1] ?? '').replace(/\s+/g, '');
    const conv = pyeong ? ` (${m[2]}평 → ${value}㎡ 환산)` : '';
    if (label === '연면적') {
      // 사용자는 영업장 면적을 연면적이라고 부르기도 한다. 건물 연면적으로 확정하지 않는다
      push('business_area_m2', value, `"${m[0].trim()}"${conv} — 건물 전체 연면적인지 영업장 면적인지 확인 필요`);
    } else {
      push('business_area_m2', value, `"${m[0].trim()}"${conv}`);
    }
  }

  if (/용도\s*변경/u.test(t)) push('event_type', 'use_change', '용도변경 언급');
  else if (/신축/u.test(t)) push('event_type', 'new_building', '신축 언급');
  else if (/증축|개축/u.test(t)) push('event_type', 'extension', '증축·개축 언급');

  return out;
}
