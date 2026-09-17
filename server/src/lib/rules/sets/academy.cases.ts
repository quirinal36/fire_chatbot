/**
 * 학원 판단표 사례 (ISS-017). 규칙 테스트와 판단표 문서가 같은 목록을 쓴다.
 * expected 에 없는 규칙은 검사하지 않는다.
 */
import type { FactValue, Status } from '../engine';

export interface AcademyCase {
  readonly id: string;
  readonly title: string;
  readonly kind: 'reference' | 'boundary' | 'exception' | 'missing' | 'event';
  readonly input: Readonly<Record<string, FactValue>>;
  readonly expected: Readonly<Record<string, Status>>;
}

const base = { business_use: 'academy', business_kind: 'general' } as const;

/** 작은 상가 건물의 일반 학원. 모든 건물 정보가 확인된 경우 */
const smallBuilding = {
  ...base,
  business_area_m2: 112,
  same_use_area_m2: 112,
  business_floor: 3,
  is_evacuation_floor: false,
  building_total_area_m2: 450,
  building_floors_above: 4,
  building_floors_below: 0,
  basement_windowless_max_area_m2: 0,
  upper_floor_max_area_m2: 110,
  nlf_area_total_m2: 450,
  capacity: 25,
  has_dormitory: false,
  academies_capacity_total: 25,
  other_multiuse_in_building: false,
  fire_compartment_separated: false,
  event_type: 'existing',
} as const;

export const ACADEMY_CASES: readonly AcademyCase[] = [
  {
    id: 'A01',
    title: '렛츠코딩앤플레이 (3층·112㎡·25명·상가 집합건물), 건물 정보 미확인',
    kind: 'reference',
    input: { ...base, business_area_m2: 112, same_use_area_m2: 112, business_floor: 3, capacity: 25 },
    expected: {
      use_class: 'applicable',
      extinguisher: 'applicable',
      indoor_hydrant: 'needs_review',
      sprinkler: 'needs_review',
      simple_sprinkler: 'needs_review',
      emergency_alarm: 'needs_review',
      fire_detection: 'needs_review',
      visual_alarm: 'needs_review',
      evacuation_equipment: 'needs_review',
      exit_signs: 'applicable',
      emergency_lighting: 'needs_review',
      multi_use_business: 'not_applicable',
    },
  },
  {
    id: 'A02',
    title: '렛츠코딩앤플레이 + 건물 정보 확인 (4층·연면적 450㎡·피난층 아님) — 가정 수치',
    kind: 'reference',
    input: smallBuilding,
    expected: {
      extinguisher: 'applicable',
      indoor_hydrant: 'not_applicable',
      sprinkler: 'not_applicable',
      simple_sprinkler: 'not_applicable',
      emergency_alarm: 'applicable',
      fire_detection: 'not_applicable',
      visual_alarm: 'not_applicable',
      evacuation_equipment: 'applicable',
      exit_signs: 'applicable',
      emergency_lighting: 'not_applicable',
      multi_use_business: 'not_applicable',
    },
  },
  { id: 'B01', title: '연면적 32㎡ (소화기구 경계 미만)', kind: 'boundary', input: { ...smallBuilding, business_area_m2: 32, same_use_area_m2: 32, building_total_area_m2: 32 }, expected: { extinguisher: 'not_applicable' } },
  { id: 'B02', title: '연면적 33㎡ (소화기구 경계)', kind: 'boundary', input: { ...smallBuilding, business_area_m2: 33, same_use_area_m2: 33, building_total_area_m2: 33 }, expected: { extinguisher: 'applicable' } },
  { id: 'B03', title: '학원 용도 합계 499㎡ → 근린생활시설', kind: 'boundary', input: { ...smallBuilding, same_use_area_m2: 499 }, expected: { use_class: 'applicable' } },
  { id: 'B04', title: '학원 용도 합계 500㎡ → 교육연구시설', kind: 'boundary', input: { ...smallBuilding, same_use_area_m2: 500 }, expected: { use_class: 'not_applicable', simple_sprinkler: undefined as never } },
  { id: 'B05', title: '근린생활시설 연면적 599㎡ → 자동화재탐지설비 비해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 599, nlf_area_total_m2: 599 }, expected: { fire_detection: 'not_applicable', visual_alarm: 'not_applicable' } },
  { id: 'B06', title: '근린생활시설 연면적 600㎡ → 자동화재탐지설비·시각경보기 해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 600, nlf_area_total_m2: 600 }, expected: { fire_detection: 'applicable', visual_alarm: 'applicable' } },
  { id: 'B07', title: '교육연구시설 연면적 1,999㎡ → 자동화재탐지설비 비해당', kind: 'boundary', input: { ...smallBuilding, same_use_area_m2: 600, building_total_area_m2: 1999 }, expected: { fire_detection: 'not_applicable' } },
  { id: 'B08', title: '교육연구시설 연면적 2,000㎡ → 자동화재탐지설비 해당, 시각경보기 비해당', kind: 'boundary', input: { ...smallBuilding, same_use_area_m2: 600, building_total_area_m2: 2000 }, expected: { fire_detection: 'applicable', visual_alarm: 'not_applicable' } },
  { id: 'B09', title: '연면적 399㎡ → 비상경보설비 비해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 399 }, expected: { emergency_alarm: 'not_applicable' } },
  { id: 'B10', title: '지하층 150㎡ → 비상경보설비 해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 399, building_floors_below: 1, basement_windowless_max_area_m2: 150 }, expected: { emergency_alarm: 'applicable' } },
  { id: 'B11', title: '근린생활시설 연면적 1,499㎡ → 옥내소화전 비해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 1499, nlf_area_total_m2: 900 }, expected: { indoor_hydrant: 'not_applicable' } },
  { id: 'B12', title: '근린생활시설 연면적 1,500㎡ → 옥내소화전 해당', kind: 'boundary', input: { ...smallBuilding, building_total_area_m2: 1500, nlf_area_total_m2: 900 }, expected: { indoor_hydrant: 'applicable' } },
  { id: 'B13', title: '교육연구시설 연면적 1,500㎡ → 옥내소화전 비해당 (3천㎡ 기준)', kind: 'boundary', input: { ...smallBuilding, same_use_area_m2: 600, building_total_area_m2: 1500 }, expected: { indoor_hydrant: 'not_applicable' } },
  { id: 'B14', title: '4층 이상 층 바닥면적 300㎡ (근린생활시설) → 옥내소화전 해당', kind: 'boundary', input: { ...smallBuilding, upper_floor_max_area_m2: 300 }, expected: { indoor_hydrant: 'applicable' } },
  { id: 'B15', title: '5층 건물 → 스프링클러 비해당', kind: 'boundary', input: { ...smallBuilding, building_floors_above: 5 }, expected: { sprinkler: 'not_applicable' } },
  { id: 'B16', title: '6층 건물 → 스프링클러·자동화재탐지설비 해당', kind: 'boundary', input: { ...smallBuilding, building_floors_above: 6 }, expected: { sprinkler: 'applicable', fire_detection: 'applicable' } },
  { id: 'B17', title: '4층 이상 층 바닥면적 1,000㎡ → 스프링클러 해당', kind: 'boundary', input: { ...smallBuilding, upper_floor_max_area_m2: 1000 }, expected: { sprinkler: 'applicable' } },
  { id: 'B18', title: '근린생활시설 부분 합계 999㎡ → 간이스프링클러 비해당', kind: 'boundary', input: { ...smallBuilding, nlf_area_total_m2: 999 }, expected: { simple_sprinkler: 'not_applicable' } },
  { id: 'B19', title: '근린생활시설 부분 합계 1,000㎡ → 간이스프링클러 해당', kind: 'boundary', input: { ...smallBuilding, nlf_area_total_m2: 1000 }, expected: { simple_sprinkler: 'applicable' } },
  { id: 'B20', title: '수용인원 99명 → 다중이용업 비해당', kind: 'boundary', input: { ...smallBuilding, capacity: 99, other_multiuse_in_building: true }, expected: { multi_use_business: 'not_applicable' } },
  { id: 'B21', title: '수용인원 100명 + 같은 건물 노래연습장 → 다중이용업 해당', kind: 'boundary', input: { ...smallBuilding, capacity: 100, other_multiuse_in_building: true }, expected: { multi_use_business: 'applicable' } },
  { id: 'B22', title: '수용인원 100명, 조건 없음 → 비해당', kind: 'boundary', input: { ...smallBuilding, capacity: 100 }, expected: { multi_use_business: 'not_applicable' } },
  { id: 'B23', title: '수용인원 300명 → 다중이용업 해당', kind: 'boundary', input: { ...smallBuilding, capacity: 300 }, expected: { multi_use_business: 'applicable' } },
  { id: 'B24', title: '5층(지하 포함)·연면적 3,000㎡ → 비상조명등 해당', kind: 'boundary', input: { ...smallBuilding, building_floors_above: 4, building_floors_below: 1, building_total_area_m2: 3000 }, expected: { emergency_lighting: 'applicable' } },
  { id: 'B25', title: '지하층 449㎡ → 비상조명등 비해당, 450㎡ → 해당', kind: 'boundary', input: { ...smallBuilding, building_floors_below: 1, basement_windowless_max_area_m2: 450 }, expected: { emergency_lighting: 'applicable' } },
  { id: 'E01', title: '2층 학원 → 피난기구 제외', kind: 'exception', input: { ...smallBuilding, business_floor: 2 }, expected: { evacuation_equipment: 'not_applicable' } },
  { id: 'E02', title: '11층 학원 → 피난기구 제외', kind: 'exception', input: { ...smallBuilding, business_floor: 11, building_floors_above: 12 }, expected: { evacuation_equipment: 'not_applicable' } },
  { id: 'E03', title: '3층이지만 피난층 → 피난기구 제외', kind: 'exception', input: { ...smallBuilding, is_evacuation_floor: true }, expected: { evacuation_equipment: 'not_applicable' } },
  { id: 'E04', title: '지하 1층 학원 → 피난기구 해당', kind: 'exception', input: { ...smallBuilding, business_floor: -1, building_floors_below: 1, basement_windowless_max_area_m2: 112 }, expected: { evacuation_equipment: 'applicable' } },
  { id: 'E05', title: '수용인원 150명 + 기숙사, 방화구획 분리 → 다중이용업 제외', kind: 'exception', input: { ...smallBuilding, capacity: 150, has_dormitory: true, fire_compartment_separated: true }, expected: { multi_use_business: 'not_applicable' } },
  { id: 'E06', title: '수용인원 300명 + 방화구획 분리 → 제외 규정 적용 안 됨 (가목)', kind: 'exception', input: { ...smallBuilding, capacity: 300, fire_compartment_separated: true }, expected: { multi_use_business: 'applicable' } },
  { id: 'E07', title: '무도학원 → 이 판단표 범위 밖', kind: 'exception', input: { ...smallBuilding, business_kind: 'dance' }, expected: { extinguisher: undefined as never } },
  { id: 'V01', title: '스프링클러 없는 6층 건물을 용도변경 → 6층 기준 제외', kind: 'event', input: { ...smallBuilding, building_floors_above: 6, event_type: 'use_change', existing_has_sprinkler: false }, expected: { sprinkler: 'not_applicable' } },
  { id: 'V02', title: '6층 건물 신축 → 스프링클러 해당', kind: 'event', input: { ...smallBuilding, building_floors_above: 6, event_type: 'new_building' }, expected: { sprinkler: 'applicable' } },
  { id: 'V03', title: '6층 건물 용도변경, 기존 스프링클러 여부 모름 → 추가 확인', kind: 'event', input: { ...smallBuilding, building_floors_above: 6, event_type: 'use_change' }, expected: { sprinkler: 'needs_review' } },
  { id: 'M01', title: '학원 용도 합계 모름 → 분류 불가 → 대부분 추가 확인', kind: 'missing', input: { ...base, business_area_m2: 112, business_floor: 3 }, expected: { use_class: 'needs_review', extinguisher: 'needs_review', exit_signs: 'needs_review' } },
  { id: 'M02', title: '수용인원 모름 → 다중이용업 추가 확인', kind: 'missing', input: { ...base, same_use_area_m2: 112 }, expected: { multi_use_business: 'needs_review' } },
  { id: 'M03', title: '영업장 층 모름 → 피난기구 추가 확인', kind: 'missing', input: { ...smallBuilding, business_floor: undefined as never }, expected: { evacuation_equipment: 'needs_review' } },
];
