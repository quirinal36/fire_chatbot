/**
 * 영업장·건물 조건 항목 (ISS-018 · 기획서 §7).
 *
 * 각 항목은 unknown / extracted / user_confirmed 상태를 가진다.
 * 규칙 판단에는 user_confirmed 만 쓴다. 추출한 값은 사용자가 확인하기 전까지 후보다.
 */
import { z } from 'zod';
import type { Facts, FactValue } from './engine';

export type FieldState = 'unknown' | 'extracted' | 'user_confirmed';

export interface FieldValue {
  readonly value: FactValue | null;
  readonly state: FieldState;
  /** 추출한 메시지 id */
  readonly sourceMessageId?: string | null;
  /** 추출 근거 문구나 애매함 설명 */
  readonly note?: string | null;
}

export type CaseFields = Readonly<Record<string, FieldValue>>;

interface FieldSpec {
  readonly label: string;
  readonly kind: 'number' | 'integer' | 'boolean' | 'enum' | 'date';
  readonly unit?: string;
  readonly options?: readonly { value: string; label: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly question: string;
}

export const FIELDS = {
  business_use: {
    label: '업종',
    kind: 'enum',
    options: [{ value: 'academy', label: '학원(교육서비스)' }],
    question: '어떤 업종의 영업장인가요?',
  },
  business_kind: {
    label: '학원 종류',
    kind: 'enum',
    options: [
      { value: 'general', label: '일반 학원(교과·예체능·코딩 등)' },
      { value: 'driving', label: '자동차운전·정비학원' },
      { value: 'dance', label: '무도학원' },
    ],
    question: '자동차운전·정비학원이나 무도학원인가요, 일반 학원인가요?',
  },
  business_area_m2: { label: '영업장 바닥면적', kind: 'number', unit: '㎡', min: 0, max: 1_000_000, question: '학원이 쓰는 바닥면적은 몇 ㎡인가요?' },
  same_use_area_m2: {
    label: '같은 건물의 학원 용도 바닥면적 합계',
    kind: 'number',
    unit: '㎡',
    min: 0,
    max: 1_000_000,
    question: '같은 건물에서 학원으로 쓰는 바닥면적을 모두 더하면 몇 ㎡인가요? (다른 학원 포함)',
  },
  business_floor: { label: '영업장 층', kind: 'integer', min: -10, max: 200, question: '학원은 몇 층에 있나요? (지하는 음수, 예: 지하 1층 = -1)' },
  is_evacuation_floor: {
    label: '영업장 층이 피난층인가',
    kind: 'boolean',
    question: '학원이 있는 층에서 계단 없이 바로 건물 밖(지상)으로 나갈 수 있나요?',
  },
  building_total_area_m2: { label: '건물 연면적', kind: 'number', unit: '㎡', min: 0, max: 10_000_000, question: '건물 전체의 연면적은 몇 ㎡인가요? (건축물대장에서 확인)' },
  building_floors_above: { label: '건물 지상 층수', kind: 'integer', min: 1, max: 200, question: '건물은 지상 몇 층까지 있나요?' },
  building_floors_below: { label: '건물 지하 층수', kind: 'integer', min: 0, max: 20, question: '건물에 지하층이 몇 개 있나요? (없으면 0)' },
  basement_windowless_max_area_m2: {
    label: '지하층·무창층 중 가장 넓은 층의 바닥면적',
    kind: 'number',
    unit: '㎡',
    min: 0,
    max: 1_000_000,
    question: '지하층이나 창이 거의 없는 층(무창층) 중 가장 넓은 층의 바닥면적은 몇 ㎡인가요? (없으면 0)',
  },
  upper_floor_max_area_m2: {
    label: '4층 이상 층 중 가장 넓은 층의 바닥면적',
    kind: 'number',
    unit: '㎡',
    min: 0,
    max: 1_000_000,
    question: '4층 이상인 층 중 가장 넓은 층의 바닥면적은 몇 ㎡인가요? (4층 이상이 없으면 0)',
  },
  nlf_area_total_m2: {
    label: '건물에서 근린생활시설로 쓰는 부분의 바닥면적 합계',
    kind: 'number',
    unit: '㎡',
    min: 0,
    max: 10_000_000,
    question: '건물에서 상가(근린생활시설)로 쓰는 부분의 바닥면적을 모두 더하면 몇 ㎡인가요?',
  },
  capacity: { label: '수용인원', kind: 'integer', unit: '명', min: 0, max: 100_000, question: '학원의 수용인원은 몇 명인가요? (강의실 등 바닥면적 ÷ 1.9㎡)' },
  has_dormitory: { label: '같은 건물에 기숙사가 있는가', kind: 'boolean', question: '같은 건물에 기숙사가 있나요?' },
  academies_capacity_total: {
    label: '같은 건물 학원들의 수용인원 합계',
    kind: 'integer',
    unit: '명',
    min: 0,
    max: 100_000,
    question: '같은 건물에 학원이 여럿이면, 학원들의 수용인원 합계는 몇 명인가요?',
  },
  other_multiuse_in_building: {
    label: '같은 건물에 다른 다중이용업소가 있는가',
    kind: 'boolean',
    question: '같은 건물에 노래연습장·PC방·음식점(다중이용업) 같은 다른 다중이용업소가 있나요?',
  },
  fire_compartment_separated: {
    label: '학원과 다른 용도가 방화구획으로 나뉘어 있는가',
    kind: 'boolean',
    question: '학원 부분과 다른 용도 부분이 방화구획(방화문·방화벽)으로 나뉘어 있나요?',
  },
  event_type: {
    label: '적용 사건',
    kind: 'enum',
    options: [
      { value: 'existing', label: '이미 있는 건물에서 영업(변경 없음)' },
      { value: 'new_building', label: '신축' },
      { value: 'use_change', label: '용도변경' },
      { value: 'extension', label: '증축·개축' },
    ],
    question: '신축, 용도변경, 증축 중 어떤 경우인가요? 이미 있는 건물이면 그렇다고 알려 주세요.',
  },
  existing_has_sprinkler: { label: '건물에 스프링클러가 이미 있는가', kind: 'boolean', question: '건물에 스프링클러설비가 이미 설치되어 있나요?' },
  event_date: { label: '허가·신고 날짜', kind: 'date', question: '건축허가(또는 용도변경 신고) 날짜는 언제인가요?' },
} as const satisfies Record<string, FieldSpec>;

export type FieldKey = keyof typeof FIELDS;
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];

export function fieldValueSchema(key: FieldKey): z.ZodType<FactValue> {
  const spec: FieldSpec = FIELDS[key];
  switch (spec.kind) {
    case 'number':
      return z.number().finite().min(spec.min ?? -Infinity).max(spec.max ?? Infinity);
    case 'integer':
      return z.number().int().min(spec.min ?? -Infinity).max(spec.max ?? Infinity);
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    case 'enum':
      return z.enum(spec.options!.map((o) => o.value) as [string, ...string[]]);
  }
}

/**
 * 규칙에 넣을 사실. 사용자가 확인한 값만 쓰고, 법령 정의에 따른 파생값을 더한다.
 * - 특정소방대상물 분류: 같은 건물 학원 용도 바닥면적 합계 500㎡ 미만이면 근린생활시설(영 별표 2 제2호차목)
 * - 건물 연면적은 영업장 바닥면적보다 작을 수 없다 (하한만 쓰는 규칙에서 사용)
 */
export function toFacts(fields: CaseFields): Facts {
  const facts: Record<string, FactValue> = {};
  for (const [key, f] of Object.entries(fields)) {
    if (f.state === 'user_confirmed' && f.value !== null) facts[key] = f.value;
  }

  if (facts['business_use'] === 'academy') {
    const kind = facts['business_kind'];
    const sameUse = facts['same_use_area_m2'];
    const area = facts['business_area_m2'];
    if (kind === 'dance') facts['use_class'] = 'amusement';
    else if (kind === 'driving') facts['use_class'] = 'vehicle_related';
    else if (kind === 'general') {
      if (typeof sameUse === 'number') facts['use_class'] = sameUse < 500 ? 'neighborhood' : 'education';
      else if (typeof area === 'number' && area >= 500) facts['use_class'] = 'education';
    }
  }

  const above = facts['building_floors_above'];
  const below = facts['building_floors_below'];
  if (typeof above === 'number' && typeof below === 'number') facts['building_total_floors'] = above + below;

  const total = facts['building_total_area_m2'];
  const area = facts['business_area_m2'];
  if (typeof total === 'number') facts['building_area_lower_bound_m2'] = total;
  else if (typeof area === 'number') facts['building_area_lower_bound_m2'] = area;

  return facts;
}

export function questionsFor(missing: readonly string[]): { field: string; question: string }[] {
  const seen = new Set<string>();
  const out: { field: string; question: string }[] = [];
  for (const m of missing) {
    // 파생값이 모르면 그 원천 입력을 묻는다
    const sources =
      m === 'use_class'
        ? ['business_kind', 'same_use_area_m2']
        : m === 'building_area_lower_bound_m2'
          ? ['building_total_area_m2']
          : m === 'building_total_floors'
            ? ['building_floors_above', 'building_floors_below']
            : [m];
    for (const s of sources) {
      if (seen.has(s) || !(s in FIELDS)) continue;
      seen.add(s);
      out.push({ field: s, question: FIELDS[s as FieldKey].question });
    }
  }
  return out;
}
