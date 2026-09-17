/**
 * 소방본부 내부 자료 등록 (ISS-024 · 기획서 §9).
 *
 * - 등록 직후에는 비공개·외부 전송 불가다. 공개 승인과 전송 승인은 따로 받는다
 * - 같은 내용을 다시 올리면 같은 revision(hash)이라 새로 만들지 않는다
 * - 실제 내부 자료는 담당자 승인 전까지 넣지 않는다. 개발은 비식별 시험 자료로 한다
 */
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InternalDocInput {
  readonly title: string;
  readonly classification: string;
  readonly origin: string;
  readonly text: string;
  /** 비식별 시험 자료인지 */
  readonly synthetic: boolean;
}

export function splitSections(text: string): { locator: string; heading: string | null; text: string }[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => {
      const [first, ...rest] = block.split('\n');
      const isHeading = first!.length <= 40 && rest.length > 0;
      return { locator: String(i + 1), heading: isHeading ? first!.replace(/^#+\s*/, '') : null, text: block };
    });
}

export async function registerInternalDocument(db: SupabaseClient, input: InternalDocInput) {
  const hash = createHash('sha256').update(input.text).digest('hex');
  const sourceDocumentId = `internal:${createHash('sha256').update(input.title).digest('hex').slice(0, 16)}`;
  const sections = splitSections(input.text);
  if (sections.length === 0) throw new Error('본문이 비어 있다');

  const { data, error } = await db.rpc('ingest_version', {
    p: {
      document: {
        source_type: 'internal',
        source_document_id: sourceDocumentId,
        title: input.title,
        issuer: input.origin,
        document_kind: input.classification,
        code: null,
      },
      version: { source_version_id: hash.slice(0, 16), effective_date: null, content_hash: hash, source_url: null, parser_version: 'internal-1' },
      units: sections.map((s, i) => ({
        id: randomUUID(),
        parent_id: null,
        unit_type: 'file_section',
        locator: s.locator,
        ordinal: i,
        heading: s.heading,
        text: s.text,
        parse_status: 'ok',
        parse_notes: input.synthetic ? '비식별 시험 자료' : null,
      })),
    },
  });
  if (error) throw new Error(error.message);
  const r = data as { status: string; version_id: string; document_id?: string };
  let documentId = r.document_id;
  if (!documentId) {
    const { data: doc } = await db.from('legal_documents').select('id').eq('source_type', 'internal').eq('source_document_id', sourceDocumentId).single();
    documentId = doc!.id as string;
  }
  const { data: file, error: fileError } = await db
    .from('source_files')
    .upsert(
      {
        document_id: documentId,
        classification: input.synthetic ? `${input.classification} (비식별 시험 자료)` : input.classification,
        origin: input.origin,
        revision_hash: hash,
      },
      { onConflict: 'document_id,revision_hash', ignoreDuplicates: false },
    )
    .select('id, disclosure, transfer_allowed')
    .single();
  if (fileError) throw new Error(fileError.message);
  return { status: r.status, versionId: r.version_id, documentId, fileId: file.id, sections: sections.length };
}
