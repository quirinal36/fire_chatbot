import { describe, expect, it } from 'vitest';
import { metaSchema } from './plans';

const required = { name: '3층 학원', width: '100', height: '80', wallPx: '8', pxPerMeter: '40', wallHeightM: '2.7' };

describe('plan metadata', () => {
  it('keeps an explicit scale status and treats older uploads as assumed', () => {
    expect(metaSchema.parse(required).scaleStatus).toBe('assumed');
    expect(metaSchema.parse({ ...required, scaleStatus: 'confirmed' }).scaleStatus).toBe('confirmed');
    expect(metaSchema.safeParse({ ...required, scaleStatus: 'measured' }).success).toBe(false);
  });

  it('판정 JSON 은 객체만 받고, 없으면 null', () => {
    expect(metaSchema.parse(required).annotations).toBeNull();
    expect(metaSchema.parse({ ...required, annotations: '' }).annotations).toBeNull();
    expect(metaSchema.parse({ ...required, annotations: '{"v":1,"judgments":[]}' }).annotations).toEqual({ v: 1, judgments: [] });
    expect(metaSchema.safeParse({ ...required, annotations: '[1,2]' }).success).toBe(false);
    expect(metaSchema.safeParse({ ...required, annotations: 'not json' }).success).toBe(false);
  });
});
