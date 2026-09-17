/** GET /api/case-fields — 조건 입력 항목 정의 (화면 양식용) */
import { NextResponse } from 'next/server';
import { FIELDS } from '@/lib/rules/fields';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({
    fields: Object.entries(FIELDS).map(([key, spec]) => ({ key, ...spec })),
  });
}
