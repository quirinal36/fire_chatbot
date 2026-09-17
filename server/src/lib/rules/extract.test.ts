import { describe, expect, it } from 'vitest';
import { extractCandidates } from './extract';

const pick = (text: string) => Object.fromEntries(extractCandidates(text).map((c) => [c.field, c.value]));

describe('extractCandidates', () => {
  it('렛츠코딩앤플레이 설명', () => {
    const got = extractCandidates('3층, 연면적 112m^2, 수용인원 : 25명, 건물용도 : 상가용집합건물 코딩 학원');
    const map = Object.fromEntries(got.map((c) => [c.field, c]));
    expect(map['business_floor']?.value).toBe(3);
    expect(map['capacity']?.value).toBe(25);
    expect(map['business_area_m2']?.value).toBe(112);
    expect(map['business_area_m2']?.note).toContain('확인 필요');
    expect(map['business_use']?.value).toBe('academy');
  });
  it('수용인원·지하층·평 환산·건물 층수', () => {
    expect(pick('지하 1층 학원, 수용인원은 120명, 30평')).toMatchObject({ business_floor: -1, capacity: 120, business_area_m2: 99.17 });
    expect(pick('5층 건물 3층에 학원을 열어요')).toMatchObject({ building_floors_above: 5, business_floor: 3 });
    expect(pick('6층 이상 건물 기준')).not.toHaveProperty('business_floor');
  });
  it('사건 종류', () => {
    expect(pick('용도변경해서 학원 차리려고요').event_type).toBe('use_change');
    expect(pick('신축 건물').event_type).toBe('new_building');
  });
  it('무도학원', () => {
    expect(pick('무도학원 소방시설').business_kind).toBe('dance');
  });
});
