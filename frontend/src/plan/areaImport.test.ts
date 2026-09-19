import { describe, expect, it } from 'vitest';
import { decideImport, importNote, IMPORT_TARGETS, isImportTarget, roundArea, type AreaChoice, type ImportRequest } from './areaImport';

const choice: AreaChoice = { id: 'room:2', label: '강의실', areaM2: 84.1234 };

const base: ImportRequest = {
  choice,
  targetKey: 'business_area_m2',
  scaleStatus: 'confirmed',
  caseReady: true,
  acknowledged: true,
};

describe('decideImport', () => {
  it('확인한 축척과 사용자의 확인이 모두 있으면 0.1㎡ 로 맞춰 가져온다', () => {
    const d = decideImport(base, '직접 지정');
    expect(d).toMatchObject({ ok: true, key: 'business_area_m2', value: 84.1 });
    if (d.ok) expect(d.note).toContain('강의실');
  });

  it('조건 카드가 없으면 먼저 시작하라고 알린다', () => {
    expect(decideImport({ ...base, caseReady: false }, null)).toMatchObject({ ok: false, block: 'no-case' });
  });

  it('추정·자동 인식 축척은 조건으로 가져오지 않는다', () => {
    for (const status of ['assumed', 'estimated', 'auto'] as const) {
      expect(decideImport({ ...base, scaleStatus: status }, null)).toMatchObject({ ok: false, block: 'scale-unconfirmed' });
    }
  });

  it('면적이 없거나 0 이면 막는다', () => {
    expect(decideImport({ ...base, choice: null }, null)).toMatchObject({ ok: false, block: 'no-area' });
    expect(decideImport({ ...base, choice: { ...choice, areaM2: 0 } }, null)).toMatchObject({ ok: false, block: 'no-area' });
  });

  it('건물 연면적처럼 뜻이 다른 항목에는 넣지 않는다', () => {
    expect(decideImport({ ...base, targetKey: 'building_total_area_m2' }, null)).toMatchObject({ ok: false, block: 'no-target' });
    expect(isImportTarget('building_total_area_m2')).toBe(false);
    expect(IMPORT_TARGETS.map((t) => t.key)).toEqual(['business_area_m2', 'same_use_area_m2']);
  });

  it('계산값 확인을 표시하기 전에는 가져오지 않는다', () => {
    expect(decideImport({ ...base, acknowledged: false }, null)).toMatchObject({ ok: false, block: 'not-acknowledged' });
  });

  it('막히는 이유는 조건 카드 → 축척 순으로 먼저 알린다', () => {
    expect(decideImport({ ...base, caseReady: false, scaleStatus: 'assumed' }, null)).toMatchObject({ ok: false, block: 'no-case' });
  });
});

describe('importNote', () => {
  it('어디서 온 값인지와 계산값임을 함께 남긴다', () => {
    const note = importNote({ id: 'floor', label: '전체 바닥 면적', areaM2: 12 }, '도면의 치수 4.2m');
    expect(note).toContain('도면에서 가져옴');
    expect(note).toContain('도면의 치수 4.2m');
    expect(note).toContain('계산');
  });
});

describe('roundArea', () => {
  it('0.1㎡ 단위로 맞춘다', () => {
    expect(roundArea(84.1234)).toBe(84.1);
    expect(roundArea(84.15)).toBe(84.2);
  });
});
