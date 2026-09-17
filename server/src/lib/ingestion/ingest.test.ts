import { describe, expect, it, vi } from 'vitest';
import { fixture } from '@/test/fixtures';
import type { LawCallResult } from '../law-api/client';
import { ingestCatalog, stableJson, type IngestStore } from './ingest';
import type { CatalogEntry } from './catalog';
import type { NormalizedUnit } from './normalize';

vi.mock('../law-api/client', async (orig) => {
  const actual = await orig<typeof import('../law-api/client')>();
  return { ...actual, callLawApi: vi.fn() };
});
const { callLawApi } = await import('../law-api/client');
const call = vi.mocked(callLawApi);
const ok = (json: unknown): LawCallResult => ({ ok: true, status: 200, ms: 1, json: json as Record<string, unknown> });

function memoryStore() {
  const versions = new Map<string, { id: string; contentHash: string; parserVersion: string; units: readonly NormalizedUnit[] }>();
  const store: IngestStore = {
    async findVersion(doc) {
      return versions.get(`${doc.documentId}:${doc.versionId}:${doc.effectiveDate}`) ?? null;
    },
    async saveNewVersion(input) {
      const id = `v${versions.size + 1}`;
      versions.set(`${input.doc.documentId}:${input.doc.versionId}:${input.doc.effectiveDate}`, {
        id, contentHash: input.contentHash, parserVersion: '1', units: input.units,
      });
      return { versionId: id, unitCount: input.units.length };
    },
    async replaceUnits(versionId, units) {
      for (const v of versions.values()) if (v.id === versionId) { v.units = units; v.parserVersion = 'next'; }
      return units.length;
    },
  };
  return { store, versions };
}

const nfpc: CatalogEntry = { sourceType: 'admrul', code: 'NFPC 103A', ruleId: '31177', priority: 'P0' };
const expc: CatalogEntry = { sourceType: 'interpretation', serial: '2656985', reason: 't', priority: 'P1' };

describe('ingestCatalog', () => {
  it('같은 원문은 두 번째 실행에서 unchanged', async () => {
    call.mockImplementation(async () => ok(fixture('service-admrul-body.json')));
    const { store, versions } = memoryStore();
    const first = await ingestCatalog([nfpc], { store });
    expect(first[0]).toMatchObject({ status: 'new', missing: [] });
    // 저장 후 파서 버전이 최신이라고 가정
    for (const v of versions.values()) v.parserVersion = (await import('./normalize')).PARSER_VERSION;
    const second = await ingestCatalog([nfpc], { store });
    expect(second[0]!.status).toBe('unchanged');
    expect(versions.size).toBe(1);
  });

  it('파서 버전이 다르면 같은 원문을 다시 정규화한다', async () => {
    call.mockImplementation(async () => ok(fixture('service-admrul-body.json')));
    const { store } = memoryStore();
    await ingestCatalog([nfpc], { store });
    const again = await ingestCatalog([nfpc], { store });
    expect(again[0]!.status).toBe('reparsed');
  });

  it('같은 버전 키에 다른 원문이 오면 덮어쓰지 않는다', async () => {
    const body = fixture('service-admrul-body.json') as { AdmRulService: { 조문내용: string[] } };
    call.mockImplementation(async () => ok(body));
    const { store, versions } = memoryStore();
    await ingestCatalog([nfpc], { store });
    const before = [...versions.values()][0]!.contentHash;
    const changed = structuredClone(body);
    changed.AdmRulService.조문내용[0] += ' 변경';
    call.mockImplementation(async () => ok(changed));
    const out = await ingestCatalog([nfpc], { store });
    expect(out[0]!.status).toBe('conflict');
    expect([...versions.values()][0]!.contentHash).toBe(before);
  });

  it('한 문서가 실패해도 나머지를 처리하고, 인증 오류는 재시도 불가로 표시한다', async () => {
    call.mockImplementation(async (target) =>
      target === 'admrul'
        ? { ok: false, reason: 'api_error', status: 200, ms: 1, detail: '검증 실패 OC=secret123' }
        : ok(fixture('service-nfaCgmExpc-body.json')),
    );
    const { store } = memoryStore();
    const out = await ingestCatalog([nfpc, expc], { store, secrets: ['secret123'] });
    expect(out[0]).toMatchObject({ status: 'failed', retryable: false });
    expect(JSON.stringify(out[0])).not.toContain('secret123');
    expect(out[1]!.status).toBe('new');
  });

  it('코드가 다른 문서가 오면 실패로 처리한다', async () => {
    call.mockImplementation(async () => ok(fixture('service-admrul-nftc-body.json')));
    const { store } = memoryStore();
    const out = await ingestCatalog([nfpc], { store });
    expect(out[0]).toMatchObject({ status: 'failed' });
  });

  it('stableJson 은 키 순서와 무관하다', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
