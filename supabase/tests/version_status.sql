-- ISS-008 버전 보존 검증. 롤백하므로 데이터가 남지 않는다.
-- 실행: node scripts/db-migrate.mjs --file supabase/tests/version_status.sql
begin;
select ingest_version('{"document":{"source_type":"law","source_document_id":"T-VER","title":"시험법","document_kind":"법률"},
  "version":{"source_version_id":"1","effective_date":"2020-01-01","content_hash":"h1"},
  "units":[{"id":"00000000-0000-0000-0000-0000000000a1","unit_type":"article","locator":"제1조","ordinal":0,"text":"구버전","parse_status":"ok"}]}'::jsonb);
select ingest_version('{"document":{"source_type":"law","source_document_id":"T-VER","title":"시험법","document_kind":"법률"},
  "version":{"source_version_id":"2","effective_date":"2024-01-01","content_hash":"h2"},
  "units":[{"id":"00000000-0000-0000-0000-0000000000a2","unit_type":"article","locator":"제1조","ordinal":0,"text":"현행","parse_status":"ok"}]}'::jsonb);
select ingest_version('{"document":{"source_type":"law","source_document_id":"T-VER","title":"시험법","document_kind":"법률"},
  "version":{"source_version_id":"3","effective_date":"2999-01-01","content_hash":"h3"},
  "units":[{"id":"00000000-0000-0000-0000-0000000000a3","unit_type":"article","locator":"제1조","ordinal":0,"text":"예정","parse_status":"ok"}]}'::jsonb);
-- 같은 버전 키 재수집은 새 행을 만들지 않는다
select ingest_version('{"document":{"source_type":"law","source_document_id":"T-VER","title":"시험법","document_kind":"법률"},
  "version":{"source_version_id":"2","effective_date":"2024-01-01","content_hash":"다른hash"},
  "units":[{"id":"00000000-0000-0000-0000-0000000000a4","unit_type":"article","locator":"제1조","ordinal":0,"text":"덮어쓰기 시도","parse_status":"ok"}]}'::jsonb) ->> 'status' as rerun;
do $$
declare got text;
begin
  select string_agg(v.source_version_id || ':' || v.version_status || ':' || u.text, ',' order by v.source_version_id) into got
  from legal_versions v join legal_documents d on d.id = v.document_id join legal_units u on u.version_id = v.id
  where d.source_document_id = 'T-VER';
  if got <> '1:historical:구버전,2:current:현행,3:scheduled:예정' then
    raise exception 'FAIL: %', got;
  end if;
end $$;
select 'PASS' as result;
rollback;
