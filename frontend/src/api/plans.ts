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
