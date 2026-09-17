/**
 * 원문 수집 파이프라인 (ISS-007).
 *
 * 선정 목록 → 버전 본문 → 원문 저장 → 정규화 → 단위 저장.
 * - 문서 ID·버전·원문 hash 로 중복을 막는다. 같은 원문이면 아무것도 쓰지 않는다.
 * - 같은 버전 키에 다른 원문이 오면 덮어쓰지 않고 이상 항목으로 보고한다.
 * - 한 문서의 실패가 다른 문서를 막지 않는다. 다시 실행하면 실패한 것만 다시 처리된다.
 */
import { createHash } from 'node:crypto';
import { fetchJson, type FetchOptions } from '../law-api';
import { parseEflawBody, parseEflawList } from '../law-api/adapters/eflaw';
import { parseAdmrulBody } from '../law-api/adapters/admrul';
import { parseInterpretationBody } from '../law-api/adapters/appendix-and-interpretation';
import type { RawDocument } from '../law-api/types';
import { redactSecrets } from '../redact';
import { downloadAttachment, type AttachmentResult } from './attachments';
import { entryLabel, type CatalogEntry } from './catalog';
import { normalizeDocument, PARSER_VERSION, type NormalizedUnit } from './normalize';

export interface FetchedVersion {
  readonly doc: RawDocument;
  readonly raw: unknown;
}

export interface StoredAttachment {
  readonly unitKey: string;
  readonly path: string;
}

export interface NewVersionInput {
  readonly doc: RawDocument;
  readonly rawJson: string;
  readonly contentHash: string;
  readonly units: readonly NormalizedUnit[];
  readonly attachments: readonly { unitKey: string; file: Extract<AttachmentResult, { ok: true }> }[];
}

export interface IngestStore {
  findVersion(doc: RawDocument): Promise<{ id: string; contentHash: string; parserVersion: string } | null>;
  saveNewVersion(input: NewVersionInput): Promise<{ versionId: string; unitCount: number }>;
  /** 같은 원문을 새 정규화 규칙으로 다시 저장한다. 규칙이 참조 중이면 실패한다 */
  replaceUnits(versionId: string, units: readonly NormalizedUnit[]): Promise<number>;
}

export type DocumentOutcome =
  | { label: string; status: 'new'; versionId: string; units: number; needsReview: number; missing: string[]; attachmentFailures: string[] }
  | { label: string; status: 'unchanged'; versionId: string }
  | { label: string; status: 'reparsed'; versionId: string; units: number; needsReview: number }
  | { label: string; status: 'conflict'; versionId: string; detail: string }
  | { label: string; status: 'failed'; error: string; retryable: boolean };

export interface IngestOptions {
  readonly store: IngestStore;
  readonly fetch?: FetchOptions;
  readonly downloadAttachments?: boolean;
  readonly download?: typeof downloadAttachment;
  /** 비밀값 마스킹에 쓸 값 (OC) */
  readonly secrets?: readonly string[];
  readonly log?: (line: string) => void;
}

export function hashContent(json: string): string {
  return createHash('sha256').update(json).digest('hex');
}

/** 키 순서를 고정한 JSON. 같은 원문은 같은 hash 를 갖는다 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export async function fetchEntry(entry: CatalogEntry, opts: FetchOptions = {}): Promise<FetchedVersion[]> {
  switch (entry.sourceType) {
    case 'law': {
      const versions: FetchedVersion[] = [];
      // 현행(nw=3)과 시행예정(nw=2)을 따로 찾는다. 목록의 MST·시행일로 본문을 고정한다.
      for (const nw of [3, 2]) {
        let items;
        try {
          items = parseEflawList(await fetchJson('eflaw', 'search', { nw, search: 1, query: entry.title, display: 100, page: 1 }, opts)).items;
        } catch (err) {
          if (nw === 2) continue; // 시행예정이 없으면 목록 자체가 비어 올 수 있다
          throw err;
        }
        for (const item of items.filter((i) => i.lawId === entry.lawId)) {
          if (!item.effectiveDate) continue;
          const raw = await fetchJson('eflaw', 'service', { MST: item.mst, efYd: item.effectiveDate.replaceAll('-', '') }, opts);
          versions.push({ doc: parseEflawBody(raw, item.mst), raw });
        }
      }
      if (versions.length === 0) throw new Error(`목록에서 법령ID ${entry.lawId} 를 찾지 못함`);
      return versions;
    }
    case 'admrul': {
      // 행정규칙ID 로 조회하면 현행 본문이 온다. 본문 안의 일련번호로 버전을 식별한다.
      const raw = await fetchJson('admrul', 'service', { LID: entry.ruleId }, opts);
      const doc = parseAdmrulBody(raw);
      if (doc.code !== entry.code) throw new Error(`코드 불일치: 기대 ${entry.code}, 실제 ${doc.code ?? '없음'}`);
      return [{ doc, raw }];
    }
    case 'interpretation': {
      const raw = await fetchJson('nfaCgmExpc', 'service', { ID: entry.serial }, opts);
      return [{ doc: parseInterpretationBody(raw), raw }];
    }
  }
}

export function missingParts(entry: CatalogEntry, doc: RawDocument): string[] {
  const missing: string[] = [];
  if (doc.sourceType !== 'interpretation' && doc.articles.filter((a) => !a.isHeading).length === 0) missing.push('조문 없음');
  if (doc.sourceType === 'law' && doc.addenda.length === 0) missing.push('부칙 없음');
  if (entry.sourceType === 'law') {
    for (const n of entry.requiredAppendices ?? []) {
      const found = doc.appendices.find((a) => Number.parseInt(a.number, 10) === n && Number.parseInt(a.branch || '0', 10) === 0);
      if (!found) missing.push(`별표 ${n} 없음`);
      else if (!found.text.trim()) missing.push(`별표 ${n} 본문 없음`);
    }
  }
  if (doc.interpretation && !doc.interpretation.answer.trim()) missing.push('회답 없음');
  return missing;
}

async function ingestVersion(entry: CatalogEntry, fetched: FetchedVersion, opts: IngestOptions): Promise<DocumentOutcome> {
  const label = `${entryLabel(entry)} (${fetched.doc.versionId}, ${fetched.doc.effectiveDate ?? '시행일 없음'})`;
  const rawJson = redactSecrets(stableJson(fetched.raw), opts.secrets);
  const contentHash = hashContent(rawJson);

  const existing = await opts.store.findVersion(fetched.doc);
  if (existing) {
    if (existing.contentHash === contentHash && existing.parserVersion !== PARSER_VERSION) {
      const units = normalizeDocument(fetched.doc);
      const count = await opts.store.replaceUnits(existing.id, units);
      return {
        label,
        status: 'reparsed',
        versionId: existing.id,
        units: count,
        needsReview: units.filter((u) => u.parseStatus === 'needs_review').length,
      };
    }
    return existing.contentHash === contentHash
      ? { label, status: 'unchanged', versionId: existing.id }
      : {
          label,
          status: 'conflict',
          versionId: existing.id,
          detail: '같은 버전 키에 다른 원문. 기존 버전을 유지하고 검토가 필요함',
        };
  }

  const units = normalizeDocument(fetched.doc);
  const attachments: NewVersionInput['attachments'][number][] = [];
  const attachmentFailures: string[] = [];
  if (opts.downloadAttachments) {
    const download = opts.download ?? downloadAttachment;
    for (const u of units.filter((x) => x.unitType === 'appendix' && x.attachmentUrl)) {
      const file = await download(u.attachmentUrl!);
      if (file.ok) attachments.push({ unitKey: u.key, file });
      else attachmentFailures.push(`${u.locator}: ${file.reason}`);
    }
  }

  const saved = await opts.store.saveNewVersion({ doc: fetched.doc, rawJson, contentHash, units, attachments });
  return {
    label,
    status: 'new',
    versionId: saved.versionId,
    units: saved.unitCount,
    needsReview: units.filter((u) => u.parseStatus === 'needs_review').length,
    missing: missingParts(entry, fetched.doc),
    attachmentFailures,
  };
}

export async function ingestCatalog(entries: readonly CatalogEntry[], opts: IngestOptions): Promise<DocumentOutcome[]> {
  const outcomes: DocumentOutcome[] = [];
  const log = opts.log ?? (() => {});
  for (const entry of entries) {
    try {
      for (const fetched of await fetchEntry(entry, opts.fetch)) {
        const outcome = await ingestVersion(entry, fetched, opts);
        outcomes.push(outcome);
        log(`${outcome.status.padEnd(9)} ${outcome.label}`);
      }
    } catch (err) {
      const retryable = typeof err === 'object' && err !== null && 'retryable' in err ? Boolean(err.retryable) : true;
      const message = redactSecrets(err instanceof Error ? err.message : String(err), opts.secrets);
      outcomes.push({ label: entryLabel(entry), status: 'failed', error: message, retryable });
      log(`failed    ${entryLabel(entry)}: ${message}`);
    }
  }
  return outcomes;
}
