/** 도면 저장·불러오기 (도면 탭). 파일은 multipart 로 올리고, 내려받을 때는 서명된 주소를 받는다 */
import { apiFetch, apiJson } from './client';

export type ScaleStatus = 'assumed' | 'estimated' | 'auto' | 'confirmed';

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
  readonly scaleStatus: ScaleStatus;
  readonly wallHeightM: number;
  /** 저장한 판정(개구부 종류·문·창·구역 이름). 구버전 저장본은 null */
  readonly annotations: unknown;
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
  readonly scaleStatus: ScaleStatus;
  readonly wallHeightM: number;
  /** 판정 JSON 문자열 */
  readonly annotations?: string;
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
  form.set('scaleStatus', p.scaleStatus);
  form.set('wallHeightM', String(p.wallHeightM));
  if (p.annotations) form.set('annotations', p.annotations);
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

/* ------------------------------ 치수 읽기 ------------------------------ */

export interface ScaleEstimate {
  /** 보낸 그림 기준 1m 당 픽셀 */
  readonly pxPerMeter: number;
  readonly used: number;
  readonly total: number;
  readonly spread: number;
  readonly labels: readonly string[];
}

/** 치수선이 없을 때 표준 치수(문 폭·침대 등)로 어림한 값. 확정이 아니다 */
export interface ScaleGuess {
  readonly pxPerMeter: number;
  readonly used: number;
  readonly spread: number;
  readonly basis: string;
}

export interface ScaleResponse {
  readonly estimate: ScaleEstimate | null;
  readonly guess: ScaleGuess | null;
  readonly note: string;
  readonly model: string;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  readonly latencyMs: number;
}

/** 치수선을 읽어 축척을 정한다. 읽지 못하면 estimate 가 null */
export function readPlanScale(image: Blob, width: number, height: number): Promise<ScaleResponse> {
  const form = new FormData();
  form.set('meta', JSON.stringify({ width, height }));
  form.set('image', image, 'plan.jpg');
  return apiJson<ScaleResponse>('/api/plans/scale', { method: 'POST', body: form });
}
