/**
 * Supabase 저장 구현 (ISS-007). 원문은 Storage, 구조는 ingest_version RPC 한 번으로 저장한다.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawDocument } from '../law-api/types';
import type { IngestStore, NewVersionInput } from './ingest';

export const RAW_BUCKET = 'raw-sources';

/** OC 없이 열리는 공식 화면 주소. 원천마다 형식이 다르다 */
export function officialPageUrl(doc: RawDocument): string | null {
  switch (doc.sourceType) {
    case 'law': {
      const u = new URL('https://www.law.go.kr/LSW/lsInfoP.do');
      u.searchParams.set('lsiSeq', doc.versionId);
      if (doc.effectiveDate) u.searchParams.set('efYd', doc.effectiveDate.replaceAll('-', ''));
      return u.toString();
    }
    case 'admrul':
      return `https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=${encodeURIComponent(doc.versionId)}`;
    case 'interpretation':
      // 소방청 해석의 공개 화면 주소 형식은 확인하지 못했다. 추측한 URL 을 노출하지 않는다.
      return null;
  }
}

const sourceTypeOf = (doc: RawDocument) => doc.sourceType;

async function documentId(db: SupabaseClient, doc: RawDocument): Promise<string | null> {
  const { data, error } = await db
    .from('legal_documents')
    .select('id')
    .eq('source_type', sourceTypeOf(doc))
    .eq('source_document_id', doc.documentId)
    .maybeSingle();
  if (error) throw new Error(`문서 조회 실패: ${error.message}`);
  return data?.id ?? null;
}

async function upload(db: SupabaseClient, path: string, body: Uint8Array | string, contentType: string) {
  const { error } = await db.storage.from(RAW_BUCKET).upload(path, body, { contentType, upsert: false });
  // 경로에 hash 가 들어가므로 이미 있으면 같은 내용이다
  if (error && !/exists|Duplicate/i.test(error.message)) throw new Error(`Storage 저장 실패 (${path}): ${error.message}`);
}

export function supabaseIngestStore(db: SupabaseClient): IngestStore {
  return {
    async findVersion(doc) {
      const docId = await documentId(db, doc);
      if (docId === null) return null;
      let q = db
        .from('legal_versions')
        .select('id, content_hash')
        .eq('document_id', docId)
        .eq('source_version_id', doc.versionId);
      q = doc.effectiveDate ? q.eq('effective_date', doc.effectiveDate) : q.is('effective_date', null);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`버전 조회 실패: ${error.message}`);
      return data ? { id: data.id, contentHash: data.content_hash } : null;
    },

    async saveNewVersion(input: NewVersionInput) {
      const { doc } = input;
      const base = `${doc.sourceType}/${doc.documentId}/${doc.versionId}_${doc.effectiveDate ?? 'na'}_${input.contentHash.slice(0, 12)}`;
      await upload(db, `${base}.json`, input.rawJson, 'application/json');

      const attachmentPath = new Map<string, string>();
      for (const a of input.attachments) {
        // Storage 키는 ASCII 만 허용한다. 단위 순번으로 이름을 짓는다
        const unit = input.units.find((u) => u.key === a.unitKey)!;
        const path = `${base}/attachment-${unit.ordinal}.${a.file.extension}`;
        await upload(db, path, a.file.bytes, a.file.contentType);
        attachmentPath.set(a.unitKey, path);
      }

      const ids = new Map(input.units.map((u) => [u.key, randomUUID()]));
      const payload = {
        document: {
          source_type: doc.sourceType,
          source_document_id: doc.documentId,
          title: doc.title,
          issuer: doc.issuer || null,
          document_kind: doc.kind || doc.sourceType,
          code: doc.code,
        },
        version: {
          source_version_id: doc.versionId,
          effective_date: doc.effectiveDate,
          promulgated_at: doc.promulgatedAt,
          source_url: officialPageUrl(doc),
          raw_path: `${base}.json`,
          content_hash: input.contentHash,
        },
        units: input.units.map((u) => ({
          id: ids.get(u.key),
          parent_id: u.parentKey ? ids.get(u.parentKey) : null,
          unit_type: u.unitType,
          locator: u.locator,
          ordinal: u.ordinal,
          heading: u.heading,
          text: u.text,
          attachment_path: attachmentPath.get(u.key) ?? null,
          parse_status: u.parseStatus,
          parse_notes: u.parseNotes,
        })),
      };

      const { data, error } = await db.rpc('ingest_version', { p: payload });
      if (error) throw new Error(`버전 저장 실패: ${error.message}`);
      const result = data as { status: string; version_id: string; unit_count?: number };
      return { versionId: result.version_id, unitCount: result.unit_count ?? 0 };
    },
  };
}
