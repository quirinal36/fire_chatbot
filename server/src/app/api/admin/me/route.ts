/** GET /api/admin/me — 관리자 여부 확인 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { reviewerLabel } from '@/lib/admin';
import { withErrors } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  const user = await requireAdmin(req);
  return NextResponse.json({ id: user.id, label: reviewerLabel(user) });
});
