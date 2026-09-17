/**
 * Supabase 저장 구현 (ISS-007). 원문은 Storage, 구조는 ingest_version RPC 한 번으로 저장한다.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawDocument } from '../law-api/types';
import type { IngestStore, NewVersionInput } from './ingest';
import { PARSER_VERSION, type NormalizedUnit } from './normalize';

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

function unitRows(units: readonly NormalizedUnit[], attachment: (u: NormalizedUnit) => string | null) {
  const ids = new Map(units.map((u) => [u.key, randomUUID()]));
  return units.map((u) => ({
    id: ids.get(u.key),
    parent_id: u.parentKey ? ids.get(u.parentKey) : null,
    unit_type: u.unitType,
    locator: u.locator,
    ordinal: u.ordinal,
    heading: u.heading,
    text: u.text,
    attachment_path: attachment(u),
    parse_status: u.parseStatus,
    parse_notes: u.parseNotes,
  }));
}

export function supabaseIngestStore(db: SupabaseClient): IngestStore {
  return {
    async findVersion(doc) {
      const docId = await documentId(db, doc);
      if (docId === null) return null;
      let q = db
        .from('legal_versions')
        .select('id, content_hash, parser_version')
        .eq('document_id', docId)
        .eq('source_version_id', doc.versionId);
      q = doc.effectiveDate ? q.eq('effective_date', doc.effectiveDate) : q.is('effective_date', null);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`버전 조회 실패: ${error.message}`);
      return data ? { id: data.id, contentHash: data.content_hash, parserVersion: data.parser_version } : null;
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
          parser_version: PARSER_VERSION,
        },
        units: unitRows(input.units, (u) => attachmentPath.get(u.key) ?? null),
      };

      const { data, error } = await db.rpc('ingest_version', { p: payload });
      if (error) throw new Error(`버전 저장 실패: ${error.message}`);
      const result = data as { status: string; version_id: string; document_id?: string; unit_count?: number };
      if (result.status === 'created' && doc.sourceType === 'interpretation' && result.document_id) {
        // 소방청 해석은 공개 자료다. 출처·선정 여부를 기록한다 (ISS-024)
        await db.from('source_files').upsert(
          {
            document_id: result.document_id,
            classification: '소방청 법령해석',
            origin: '국가법령정보 공동활용 API (nfaCgmExpc)',
            revision_hash: input.contentHash,
            disclosure: 'public',
            disclosure_approved_at: new Date().toISOString(),
            transfer_allowed: true,
            transfer_approved_at: new Date().toISOString(),
          },
          { onConflict: 'document_id,revision_hash', ignoreDuplicates: true },
        );
      }
      return { versionId: result.version_id, unitCount: result.unit_count ?? 0 };
    },

    async replaceUnits(versionId, units) {
      // 첨부 파일은 다시 받지 않는다. 같은 locator 의 기존 경로를 옮겨 붙인다
      const { data: old, error } = await db
        .from('legal_units')
        .select('locator, attachment_path')
        .eq('version_id', versionId)
        .not('attachment_path', 'is', null);
      if (error) throw new Error(`기존 첨부 조회 실패: ${error.message}`);
      const paths = new Map((old ?? []).map((o) => [o.locator as string, o.attachment_path as string]));
      const { data, error: rpcError } = await db.rpc('replace_version_units', {
        p_version_id: versionId,
        p_parser_version: PARSER_VERSION,
        p_units: unitRows(units, (u) => paths.get(u.locator) ?? null),
      });
      if (rpcError) throw new Error(`단위 교체 실패: ${rpcError.message}`);
      return data as number;
    },
  };
}
