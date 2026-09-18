/** 도면 저장·불러오기 (도면 탭). 파일은 multipart 로 올리고, 내려받을 때는 서명된 주소를 받는다 */
import { apiFetch, apiJson } from './client';

export interface PlanSummary {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanDetail extends PlanSummary {
  readonly wallPx: number;
  readonly pxPerMeter: number;
  readonly scaleFixed: boolean;
  readonly wallHeightM: number;
  readonly imageUrl: string;
  readonly maskUrl: string;
}

export interface PlanPayload {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly wallPx: number;
  readonly pxPerMeter: number;
  readonly scaleFixed: boolean;
  readonly wallHeightM: number;
  readonly image: Blob;
  readonly mask: Blob;
}

function formOf(p: PlanPayload): FormData {
  const form = new FormData();
  form.set('name', p.name);
  form.set('width', String(p.width));
  form.set('height', String(p.height));
  form.set('wallPx', String(p.wallPx));
  form.set('pxPerMeter', String(p.pxPerMeter));
  form.set('scaleFixed', String(p.scaleFixed));
  form.set('wallHeightM', String(p.wallHeightM));
  form.set('image', p.image, 'image');
  form.set('mask', p.mask, 'mask.png');
  return form;
}

export async function listPlans(): Promise<PlanSummary[]> {
  return (await apiJson<{ plans: PlanSummary[] }>('/api/plans')).plans;
}

export function getPlan(id: string): Promise<PlanDetail> {
  return apiJson<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`);
}

export function createPlan(p: PlanPayload): Promise<PlanDetail> {
  return apiJson<PlanDetail>('/api/plans', { method: 'POST', body: formOf(p) });
}

export function updatePlan(id: string, p: PlanPayload): Promise<PlanDetail> {
  return apiJson<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`, { method: 'PUT', body: formOf(p) });
}

export async function deletePlan(id: string): Promise<void> {
  await apiFetch(`/api/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ------------------------------ AI 검토 ------------------------------ */

export interface ReviewContext {
  readonly planId: string | null;
  readonly round: number;
  readonly grid: { readonly cols: number; readonly rows: number };
  readonly params: { readonly dark: number; readonly wallPx: number; readonly pxPerMeter: number };
  readonly openings: readonly { id: number; widthM: number; cell: string }[];
  readonly rooms: readonly { id: number; areaM2: number; cell: string }[];
}

export interface PlanReview {
  readonly quality: number;
  readonly summary: string;
  readonly falseWalls: readonly { cell: string; what: string }[];
  readonly missingWalls: readonly { from: { x: number; y: number }; to: { x: number; y: number }; why: string }[];
  readonly openings: readonly { id: number; kind: 'door' | 'window' | 'open' }[];
  readonly rooms: readonly { id: number; name: string }[];
  readonly scale: { pxPerMeter: number | null; basis: string };
  readonly params: { dark: number | null; wallPx: number | null };
}

export interface ReviewResponse {
  readonly review: PlanReview;
  readonly model: string;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  readonly latencyMs: number;
}

export function reviewPlan(image: Blob, width: number, height: number, context: ReviewContext): Promise<ReviewResponse> {
  const form = new FormData();
  form.set('meta', JSON.stringify({ context, width, height }));
  form.set('image', image, 'overlay.jpg');
  return apiJson<ReviewResponse>('/api/plans/review', { method: 'POST', body: form });
}
