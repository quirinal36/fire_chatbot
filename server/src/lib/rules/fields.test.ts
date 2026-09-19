import { describe, expect, it } from 'vitest';
import { questionsFor } from './fields';

describe('questionsFor', () => {
  it('파생값이 모자라면 그 원천을 묻는다', () => {
    expect(questionsFor(['use_class']).map((q) => q.field)).toEqual(['business_kind', 'same_use_area_m2']);
  });

  it('이미 확인한 원천은 다시 묻지 않는다', () => {
    const known = new Set(['business_kind']);
    expect(questionsFor(['use_class'], known).map((q) => q.field)).toEqual(['same_use_area_m2']);
  });

  it('원천을 모두 확인했으면 아무것도 묻지 않는다', () => {
    const known = new Set(['building_floors_above', 'building_floors_below']);
    expect(questionsFor(['building_total_floors'], known)).toEqual([]);
  });

  it('같은 항목을 두 번 묻지 않는다', () => {
    expect(questionsFor(['business_area_m2', 'business_area_m2']).map((q) => q.field)).toEqual(['business_area_m2']);
  });

  it('조건 항목이 아닌 이름은 질문으로 만들지 않는다', () => {
    expect(questionsFor(['made_up_fact'])).toEqual([]);
  });
});
