import { describe, expect, it } from 'vitest';
import { metaSchema } from './plans';

const required = { name: '3층 학원', width: '100', height: '80', wallPx: '8', pxPerMeter: '40', wallHeightM: '2.7' };

describe('plan metadata', () => {
  it('keeps an explicit scale status and treats older uploads as assumed', () => {
    expect(metaSchema.parse(required).scaleStatus).toBe('assumed');
    expect(metaSchema.parse({ ...required, scaleStatus: 'confirmed' }).scaleStatus).toBe('confirmed');
    expect(metaSchema.safeParse({ ...required, scaleStatus: 'measured' }).success).toBe(false);
  });
});
