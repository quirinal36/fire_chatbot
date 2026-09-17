/**
 * 최초 지원 시설: 교육서비스 학원 (ISS-017 판단표를 코드로 옮긴 것)
 *
 * 근거: 소방시설 설치 및 관리에 관한 법률 시행령(2026-07-01 시행, MST 287375) 별표 2·4·7,
 *       다중이용업소의 안전관리에 관한 특별법 시행령(2026-07-01 시행) 제2조제3호
 *
 * 담당자 승인 전 초안이다. 승인 전에는 운영 화면에 판정이 나가지 않는다 (docs/rules/academy-decision-table.md).
 *
 * 다루지 않는 것 (추가 확인 필요로 남긴다)
 * - 복합건축물(근린생활시설과 주택이 함께 있는 건물)의 별도 기준
 * - 옥상 차고, 터널, 공장·창고, 특수가연물 등 학원과 무관한 조항
 * - 부칙의 경과조치에 따른 구 기준 적용 (적용 시점이 필요한 규칙은 날짜가 없으면 추가 확인)
 */
import type { Condition, RuleSetDefinition } from '../engine';

const neighborhood: Condition = { field: 'use_class', op: 'eq', value: 'neighborhood' };
const education: Condition = { field: 'use_class', op: 'eq', value: 'education' };
const generalAcademy: Condition = { field: 'use_class', op: 'in', value: ['neighborhood', 'education'] };

export const ACADEMY_RULES: RuleSetDefinition = {
  code: 'academy',
  version: '2026-09-18.1',
  title: '교육서비스 학원 소방시설 설치 대상 판단표',
  scopeNote: '일반 학원(자동차운전·정비학원, 무도학원 제외). 근린생활시설 또는 교육연구시설로 분류되는 경우',
  rules: [
    {
      key: 'use_class',
      facility: '특정소방대상물 분류',
      scope: { field: 'business_use', op: 'eq', value: 'academy' },
      applicableWhen: neighborhood,
      explain: {
        applicable: '같은 건물의 학원 용도 바닥면적 합계가 500㎡ 미만이라 근린생활시설로 분류됩니다.',
        not_applicable: '근린생활시설이 아닌 학원(교육연구시설 등)으로 분류됩니다. 설치 기준이 달라집니다.',
        needs_review: '같은 건물에서 학원으로 쓰는 바닥면적 합계를 알아야 근린생활시설인지 정할 수 있습니다.',
      },
      sources: [
        { doc: '영', locator: '별표2/2.차', role: 'definition' },
        { doc: '영', locator: '별표2/8.라', role: 'definition' },
      ],
    },
    {
      key: 'extinguisher',
      facility: '소화기구',
      scope: generalAcademy,
      applicableWhen: { field: 'building_area_lower_bound_m2', op: 'gte', value: 33 },
      explain: {
        applicable: '연면적 33㎡ 이상인 특정소방대상물이므로 소화기구를 설치해야 합니다.',
        not_applicable: '건물 연면적이 33㎡ 미만이라 소화기구 설치 대상 기준(연면적 33㎡ 이상)에 해당하지 않습니다.',
        needs_review: '건물 연면적(또는 영업장 바닥면적)을 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/1.가.1)', role: 'basis' }],
    },
    {
      key: 'indoor_hydrant',
      facility: '옥내소화전설비',
      scope: generalAcademy,
      applicableWhen: {
        any: [
          { field: 'building_total_area_m2', op: 'gte', value: 3000 },
          { field: 'basement_windowless_max_area_m2', op: 'gte', value: 600 },
          { field: 'upper_floor_max_area_m2', op: 'gte', value: 600 },
          {
            all: [
              neighborhood,
              {
                any: [
                  { field: 'building_total_area_m2', op: 'gte', value: 1500 },
                  { field: 'basement_windowless_max_area_m2', op: 'gte', value: 300 },
                  { field: 'upper_floor_max_area_m2', op: 'gte', value: 300 },
                ],
              },
            ],
          },
        ],
      },
      explain: {
        applicable: '건물 연면적 또는 지하층·무창층·4층 이상 층의 바닥면적이 기준 이상이라 모든 층에 옥내소화전설비를 설치해야 합니다.',
        not_applicable: '연면적·지하층·무창층·4층 이상 층의 바닥면적이 모두 옥내소화전설비 기준 미만입니다.',
        needs_review: '건물 연면적과 지하층·무창층·4층 이상 층의 바닥면적을 알아야 판단할 수 있습니다.',
      },
      sources: [
        { doc: '영', locator: '별표4/1.다.1)', role: 'basis' },
        { doc: '영', locator: '별표4/1.다.2)', role: 'basis' },
      ],
    },
    {
      key: 'sprinkler',
      facility: '스프링클러설비',
      scope: generalAcademy,
      applicableWhen: {
        any: [
          { field: 'building_floors_above', op: 'gte', value: 6 },
          { field: 'basement_windowless_max_area_m2', op: 'gte', value: 1000 },
          { field: 'upper_floor_max_area_m2', op: 'gte', value: 1000 },
        ],
      },
      exceptions: [
        {
          // 영 별표4 제1호라목1) 단서 나): 스프링클러가 없는 기존 건물을 용도변경하는 경우 (6층 이상 기준에 한함)
          when: {
            all: [
              { field: 'event_type', op: 'eq', value: 'use_change' },
              { field: 'existing_has_sprinkler', op: 'eq', value: false },
              { field: 'basement_windowless_max_area_m2', op: 'lt', value: 1000 },
              { field: 'upper_floor_max_area_m2', op: 'lt', value: 1000 },
            ],
          },
          note: '스프링클러설비가 없는 기존 건물을 용도변경하는 경우의 6층 이상 기준 제외',
        },
      ],
      explain: {
        applicable: '6층 이상 건물이거나 지하층·무창층·4층 이상 층 중 바닥면적 1천㎡ 이상인 층이 있어 스프링클러설비 설치 대상입니다.',
        not_applicable: '6층 미만이고 바닥면적 1천㎡ 이상인 지하층·무창층·4층 이상 층이 없거나, 용도변경 제외 규정에 해당합니다.',
        needs_review: '건물 층수와 지하층·무창층·4층 이상 층의 바닥면적, 용도변경 여부를 알아야 판단할 수 있습니다.',
      },
      sources: [
        { doc: '영', locator: '별표4/1.라.1)', role: 'basis' },
        { doc: '영', locator: '별표4/1.라.1).나)', role: 'exception' },
        { doc: '영', locator: '별표4/1.라.7)', role: 'basis' },
      ],
    },
    {
      key: 'simple_sprinkler',
      facility: '간이스프링클러설비',
      scope: neighborhood,
      applicableWhen: { field: 'nlf_area_total_m2', op: 'gte', value: 1000 },
      explain: {
        applicable: '건물의 근린생활시설 부분 바닥면적 합계가 1천㎡ 이상이라 모든 층에 간이스프링클러설비를 설치해야 합니다.',
        not_applicable: '건물의 근린생활시설 부분 바닥면적 합계가 1천㎡ 미만입니다.',
        needs_review: '건물에서 근린생활시설로 쓰는 부분의 바닥면적 합계를 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/1.마.2)', role: 'basis' }],
    },
    {
      key: 'emergency_alarm',
      facility: '비상경보설비',
      scope: generalAcademy,
      applicableWhen: {
        any: [
          { field: 'building_total_area_m2', op: 'gte', value: 400 },
          { field: 'basement_windowless_max_area_m2', op: 'gte', value: 150 },
        ],
      },
      explain: {
        applicable: '건물 연면적 400㎡ 이상이거나 지하층·무창층 바닥면적이 150㎡ 이상이라 비상경보설비를 설치해야 합니다.',
        not_applicable: '건물 연면적 400㎡ 미만이고 지하층·무창층 바닥면적이 150㎡ 미만입니다.',
        needs_review: '건물 연면적과 지하층·무창층 바닥면적을 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/2.나', role: 'basis' }],
    },
    {
      key: 'fire_detection',
      facility: '자동화재탐지설비',
      scope: generalAcademy,
      applicableWhen: {
        any: [
          { field: 'building_floors_above', op: 'gte', value: 6 },
          { all: [neighborhood, { field: 'building_total_area_m2', op: 'gte', value: 600 }] },
          { all: [education, { field: 'building_total_area_m2', op: 'gte', value: 2000 }] },
        ],
      },
      explain: {
        applicable: '6층 이상 건물이거나 분류별 연면적 기준(근린생활시설 600㎡, 교육연구시설 2천㎡) 이상이라 자동화재탐지설비를 설치해야 합니다.',
        not_applicable: '6층 미만이고 연면적이 분류별 자동화재탐지설비 기준 미만입니다.',
        needs_review: '건물 층수와 연면적, 학원의 분류를 알아야 판단할 수 있습니다.',
      },
      sources: [
        { doc: '영', locator: '별표4/2.다.2)', role: 'basis' },
        { doc: '영', locator: '별표4/2.다.3)', role: 'basis' },
        { doc: '영', locator: '별표4/2.다.5)', role: 'basis' },
      ],
    },
    {
      key: 'visual_alarm',
      facility: '시각경보기',
      scope: generalAcademy,
      applicableWhen: { all: [{ rule: 'fire_detection', is: 'applicable' }, neighborhood] },
      explain: {
        applicable: '자동화재탐지설비 설치 대상인 근린생활시설이라 시각경보기를 설치해야 합니다.',
        not_applicable: '자동화재탐지설비 설치 대상이 아니거나, 시각경보기 설치 대상 용도(근린생활시설 등)가 아닙니다.',
        needs_review: '자동화재탐지설비 설치 대상 여부가 정해져야 판단할 수 있습니다.',
      },
      sources: [
        { doc: '영', locator: '별표4/2.라', role: 'basis' },
        { doc: '영', locator: '별표4/2.라.1)', role: 'basis' },
      ],
    },
    {
      key: 'evacuation_equipment',
      facility: '피난기구',
      scope: generalAcademy,
      applicableWhen: {
        all: [
          { field: 'business_floor', op: 'gte', value: -20 },
          { not: { field: 'business_floor', op: 'in', value: [1, 2] } },
          { field: 'is_evacuation_floor', op: 'eq', value: false },
        ],
      },
      exceptions: [
        { when: { field: 'business_floor', op: 'gte', value: 11 }, note: '층수가 11층 이상인 층 제외' },
      ],
      explain: {
        applicable: '피난층·지상 1·2층·11층 이상이 아닌 층이라 그 층에 피난기구를 설치해야 합니다.',
        not_applicable: '피난층, 지상 1층·2층 또는 11층 이상인 층이라 피난기구 설치 제외 대상입니다.',
        needs_review: '영업장이 있는 층과 그 층이 피난층인지를 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/3.가', role: 'basis' }],
    },
    {
      key: 'exit_signs',
      facility: '피난구유도등·통로유도등·유도표지',
      scope: generalAcademy,
      applicableWhen: generalAcademy,
      explain: {
        applicable: '축사·터널이 아닌 특정소방대상물이라 피난구유도등, 통로유도등 및 유도표지를 설치해야 합니다.',
        not_applicable: '유도등 설치 제외 대상입니다.',
        needs_review: '학원의 분류를 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/3.다.1)', role: 'basis' }],
    },
    {
      key: 'emergency_lighting',
      facility: '비상조명등',
      scope: generalAcademy,
      applicableWhen: {
        any: [
          {
            all: [
              // 지하층을 포함하는 층수 5층 이상 + 연면적 3천㎡ 이상
              { field: 'building_total_floors', op: 'gte', value: 5 },
              { field: 'building_total_area_m2', op: 'gte', value: 3000 },
            ],
          },
          { field: 'basement_windowless_max_area_m2', op: 'gte', value: 450 },
        ],
      },
      explain: {
        applicable: '지하층 포함 5층 이상·연면적 3천㎡ 이상이거나, 바닥면적 450㎡ 이상인 지하층·무창층이 있어 비상조명등 설치 대상입니다.',
        not_applicable: '비상조명등 설치 기준(지하층 포함 5층 이상·연면적 3천㎡ 이상, 또는 지하층·무창층 450㎡ 이상)에 해당하지 않습니다.',
        needs_review: '건물 층수(지하 포함)·연면적과 지하층·무창층 바닥면적을 알아야 판단할 수 있습니다.',
      },
      sources: [{ doc: '영', locator: '별표4/3.라', role: 'basis' }],
    },
    {
      key: 'multi_use_business',
      facility: '다중이용업소 해당 (안전시설등 설치 의무)',
      scope: { field: 'business_use', op: 'eq', value: 'academy' },
      applicableWhen: {
        any: [
          { field: 'capacity', op: 'gte', value: 300 },
          {
            all: [
              { field: 'capacity', op: 'gte', value: 100 },
              {
                any: [
                  { field: 'has_dormitory', op: 'eq', value: true },
                  { field: 'academies_capacity_total', op: 'gte', value: 300 },
                  { field: 'other_multiuse_in_building', op: 'eq', value: true },
                ],
              },
            ],
          },
        ],
      },
      exceptions: [
        {
          when: {
            all: [
              { field: 'capacity', op: 'lt', value: 300 },
              { field: 'fire_compartment_separated', op: 'eq', value: true },
            ],
          },
          note: '수용인원 300명 미만으로서 학원과 다른 용도가 방화구획으로 나뉜 경우 제외',
        },
      ],
      explain: {
        applicable: '수용인원 기준에 해당해 다중이용업소입니다. 다중이용업소법에 따른 안전시설등을 갖춰야 합니다.',
        not_applicable: '수용인원이 기준에 미치지 않거나 제외 조건에 해당해 다중이용업소가 아닙니다.',
        needs_review: '수용인원과 같은 건물의 기숙사·다른 학원·다른 다중이용업소, 방화구획 여부를 알아야 판단할 수 있습니다.',
      },
      sources: [
        { doc: '다중령', locator: '제2조제3호가목', role: 'basis' },
        { doc: '다중령', locator: '제2조제3호나목', role: 'basis' },
        { doc: '영', locator: '별표7/2.가', role: 'definition' },
      ],
    },
  ],
};
