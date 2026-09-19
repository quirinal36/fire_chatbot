/**
 * 도면 저장 (도면 탭). 원본 이미지와 벽 마스크는 비공개 버킷 plans 에, 축척 같은 메타는 plans 표에 둔다.
 * secret 키로 접근하므로 소유권 검사는 반드시 여기서 한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { HttpError } from './http-error';

export const BUCKET = 'plans';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_MASK_BYTES = 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;

export interface PlanRow {
  id: string;
  owner_id: string;
  name: string;
  width: number;
  height: number;
  wall_px: number;
  px_per_meter: number;
  scale_fixed: boolean;
  scale_status: 'assumed' | 'estimated' | 'auto' | 'confirmed';
  wall_height_m: number;
  /** 판정(개구부 종류·문·창·구역 이름). 화면이 정한 형식이며 서버는 크기와 JSON 여부만 본다 */
  annotations: unknown;
  image_path: string;
  mask_path: string;
  created_at: string;
  updated_at: string;
}

export const metaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  width: z.coerce.number().int().min(1).max(4096),
  height: z.coerce.number().int().min(1).max(4096),
  wallPx: z.coerce.number().int().min(1).max(256),
  pxPerMeter: z.coerce.number().positive(),
  scaleFixed: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  scaleStatus: z.enum(['assumed', 'estimated', 'auto', 'confirmed']).default('assumed'),
  wallHeightM: z.coerce.number().positive().max(20).default(2.7),
  /** 판정 JSON. 64KB 까지. 형식은 화면이 정하고 서버는 JSON 객체인지만 본다 */
  annotations: z
    .string()
    .max(65536)
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return null;
      try {
        const parsed: unknown = JSON.parse(v);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
        return parsed as Record<string, unknown>;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'annotations 는 JSON 객체여야 합니다' });
        return z.NEVER;
      }
    }),
});
export type PlanMeta = z.infer<typeof metaSchema>;

export interface PlanUpload {
  meta: PlanMeta;
  image: { bytes: Uint8Array; type: string };
  mask: { bytes: Uint8Array; type: string };
}

function fileOf(form: FormData, key: string, allowed: readonly string[], max: number): { bytes: Promise<Uint8Array>; type: string } {
  const f = form.get(key);
  if (!(f instanceof File)) throw new HttpError(400, 'invalid_request', `${key} 파일이 필요합니다.`);
  if (!allowed.includes(f.type)) throw new HttpError(415, 'unsupported_media_type', `${key} 는 ${allowed.join(', ')} 만 받습니다.`);
  if (f.size > max) throw new HttpError(413, 'payload_too_large', `${key} 파일이 너무 큽니다.`);
  return { bytes: f.arrayBuffer().then((b) => new Uint8Array(b)), type: f.type };
}

/** multipart/form-data 본문에서 메타와 두 파일을 읽는다 */
export async function parsePlanUpload(req: Request): Promise<PlanUpload> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('multipart/form-data')) throw new HttpError(415, 'unsupported_media_type', 'multipart 본문이 필요합니다.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'invalid_request', '본문을 읽지 못했습니다.');
  }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const parsed = metaSchema.safeParse(fields);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(본문)'))];
    throw new HttpError(400, 'invalid_request', `입력값을 확인해 주세요: ${names.join(', ')}`);
  }
  const image = fileOf(form, 'image', ['image/jpeg', 'image/png', 'image/webp'], MAX_IMAGE_BYTES);
  const mask = fileOf(form, 'mask', ['image/png'], MAX_MASK_BYTES);
  return {
    meta: parsed.data,
    image: { bytes: await image.bytes, type: image.type },
    mask: { bytes: await mask.bytes, type: mask.type },
  };
}

const ext = (type: string): string => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');

async function putFile(db: SupabaseClient, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`도면 파일 저장 실패: ${error.message}`);
}

export async function getPlan(db: SupabaseClient, ownerId: string, id: string): Promise<PlanRow> {
  const { data, error } = await db.from('plans').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'not_found', '도면을 찾을 수 없습니다.');
  return data as PlanRow;
}

export async function listPlans(db: SupabaseClient, ownerId: string, limit: number): Promise<PlanRow[]> {
  const { data, error } = await db
    .from('plans')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanRow[];
}

export async function createPlan(db: SupabaseClient, ownerId: string, up: PlanUpload): Promise<PlanRow> {
  const id = crypto.randomUUID();
  const imagePath = `${ownerId}/${id}/image.${ext(up.image.type)}`;
  const maskPath = `${ownerId}/${id}/mask.png`;
  await putFile(db, imagePath, up.image.bytes, up.image.type);
  await putFile(db, maskPath, up.mask.bytes, up.mask.type);
  const { data, error } = await db
    .from('plans')
    .insert({ id, owner_id: ownerId, ...columnsOf(up.meta), image_path: imagePath, mask_path: maskPath })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PlanRow;
}

export async function updatePlan(db: SupabaseClient, ownerId: string, id: string, up: PlanUpload): Promise<PlanRow> {
  const row = await getPlan(db, ownerId, id);
  const imagePath = `${ownerId}/${id}/image.${ext(up.image.type)}`;
  await putFile(db, imagePath, up.image.bytes, up.image.type);
  await putFile(db, row.mask_path, up.mask.bytes, up.mask.type);
  if (imagePath !== row.image_path) await db.storage.from(BUCKET).remove([row.image_path]);
  const { data, error } = await db
    .from('plans')
    .update({ ...columnsOf(up.meta), image_path: imagePath, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PlanRow;
}

export async function deletePlan(db: SupabaseClient, ownerId: string, id: string): Promise<void> {
  const row = await getPlan(db, ownerId, id);
  const { error } = await db.from('plans').delete().eq('id', id).eq('owner_id', ownerId);
  if (error) throw new Error(error.message);
  // 파일 삭제 실패는 사용자에게 영향이 없으므로 기록만 남기지 않고 넘어간다. 행이 없으면 다시 열 수 없다
  await db.storage.from(BUCKET).remove([row.image_path, row.mask_path]);
}

function columnsOf(m: PlanMeta) {
  return {
    name: m.name,
    width: m.width,
    height: m.height,
    wall_px: m.wallPx,
    px_per_meter: m.pxPerMeter,
    scale_fixed: m.scaleFixed,
    scale_status: m.scaleStatus,
    wall_height_m: m.wallHeightM,
    annotations: m.annotations ?? null,
  };
}

export function summaryOf(r: PlanRow) {
  return { id: r.id, name: r.name, width: r.width, height: r.height, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** 파일은 서명된 주소로 한 시간 동안 내려받는다 */
export async function detailOf(db: SupabaseClient, r: PlanRow) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls([r.image_path, r.mask_path], SIGNED_URL_SECONDS);
  if (error) throw new Error(`도면 파일 주소 발급 실패: ${error.message}`);
  const urlOf = (path: string): string => {
    const hit = data?.find((d) => d.path === path);
    if (!hit?.signedUrl) throw new Error(`도면 파일 주소 발급 실패: ${path}`);
    return hit.signedUrl;
  };
  return {
    ...summaryOf(r),
    wallPx: r.wall_px,
    pxPerMeter: r.px_per_meter,
    scaleFixed: r.scale_fixed,
    scaleStatus: r.scale_status,
    wallHeightM: r.wall_height_m,
    annotations: r.annotations ?? null,
    imageUrl: urlOf(r.image_path),
    maskUrl: urlOf(r.mask_path),
  };
}
