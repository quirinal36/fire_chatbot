-- ISS-022 · ISS-023 · ISS-024 검증. 롤백한다.
-- 실행: node scripts/db-migrate.mjs --file supabase/tests/admin_ops.sql
begin;
do $$
declare
  v1 uuid; v2 uuid; doc uuid; rs uuid; r1 uuid; r2 uuid; u_changed uuid; u_same uuid; res jsonb;
  j1 uuid; j2 uuid; claimed record; f uuid; cnt int;
begin
  -- 개정 영향 --------------------------------------------------------------
  perform ingest_version('{"document":{"source_type":"law","source_document_id":"T-IMP","title":"시험법","document_kind":"법률"},
    "version":{"source_version_id":"1","effective_date":"2020-01-01","content_hash":"a"},
    "units":[{"id":"00000000-0000-0000-0000-0000000000c1","unit_type":"article","locator":"제1조","ordinal":0,"text":"연면적 33㎡ 이상","parse_status":"ok"},
             {"id":"00000000-0000-0000-0000-0000000000c2","unit_type":"article","locator":"제2조","ordinal":1,"text":"변하지 않는 조문","parse_status":"ok"},
             {"id":"00000000-0000-0000-0000-0000000000c3","unit_type":"article","locator":"제3조","ordinal":2,"text":"표 | 불완전","parse_status":"needs_review"}]}'::jsonb);
  select id, document_id into v1, doc from legal_versions where source_version_id = '1' and document_id = (select id from legal_documents where source_document_id = 'T-IMP');

  -- 파싱 불완전 단위가 있으면 확인 없이 게시 불가
  begin
    perform publish_version(v1, '시험', '근거');
    raise exception 'FAIL: 파싱 확인 없이 게시됨';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform publish_version(v1, '시험', '근거', null, true);

  -- 파싱 불완전 단위는 규칙 근거 불가
  insert into rule_sets (id, code, version, status) values ('00000000-0000-0000-0000-0000000000d0', 'test-set', '1', 'pending_review');
  insert into rules (id, rule_set_id, rule_key, facility, definition, explanation_template)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d0', 'r1', '시설1', '{}', '{}'),
         ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d0', 'r2', '시설2', '{}', '{}');
  begin
    insert into rule_sources values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c3', 'basis');
    raise exception 'FAIL: 파싱 불완전 근거 허용';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  insert into rule_sources values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'basis'),
                                  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c2', 'basis');
  perform review_rule_set('00000000-0000-0000-0000-0000000000d0', 'approve', null, '시험', '승인');
  perform review_rule_set('00000000-0000-0000-0000-0000000000d0', 'publish', null, '시험', '게시');

  -- 새 버전: 제1조만 바뀜
  perform ingest_version('{"document":{"source_type":"law","source_document_id":"T-IMP","title":"시험법","document_kind":"법률"},
    "version":{"source_version_id":"2","effective_date":"2024-01-01","content_hash":"b"},
    "units":[{"id":"00000000-0000-0000-0000-0000000000f1","unit_type":"article","locator":"제1조","ordinal":0,"text":"연면적 50㎡ 이상","parse_status":"ok"},
             {"id":"00000000-0000-0000-0000-0000000000f2","unit_type":"article","locator":"제2조","ordinal":1,"text":"변하지  않는 조문","parse_status":"ok"}]}'::jsonb);
  select id into v2 from legal_versions where document_id = doc and source_version_id = '2';
  select count(*) into cnt from version_diff(v1, v2);
  if cnt <> 2 then raise exception 'FAIL diff: % (제1조 changed, 제3조 removed 기대)', cnt; end if;

  res := apply_revision_impact(v2);
  if (select invalidated_rules from rule_sets where id = '00000000-0000-0000-0000-0000000000d0') <> array['r1'] then
    raise exception 'FAIL impact: %', res;
  end if;

  -- 새 버전이 게시·현행이 되기 전에는 재승인 불가 (근거가 아직 구버전)
  begin
    perform revalidate_rule_set('00000000-0000-0000-0000-0000000000d0', null, '시험', '재검토');
    raise exception 'FAIL: 구버전 근거로 재승인됨';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 작업 큐 ------------------------------------------------------------------
  j1 := enqueue_job('check_updates', '{}', 'test-dedupe');
  j2 := enqueue_job('check_updates', '{}', 'test-dedupe');
  if j1 <> j2 then raise exception 'FAIL: 중복 작업 등록'; end if;
  select * into claimed from claim_job('w1', 60) where id = j1;
  if claimed.id is null then
    -- 다른 대기 작업이 먼저 잡혔을 수 있다: 대상 작업만 남기고 다시 시도
    update ingestion_jobs set status = 'cancelled' where id <> j1 and status = 'queued';
    select * into claimed from claim_job('w1', 60);
  end if;
  if claimed.id <> j1 then raise exception 'FAIL claim'; end if;
  if exists (select 1 from claim_job('w2', 60) where id = j1) then raise exception 'FAIL: lease 중 재할당'; end if;
  if update_job(j1, 'w2', 'succeeded', 'done', null, null, null) then raise exception 'FAIL: 다른 작업자가 완료 처리'; end if;
  perform update_job(j1, 'w1', 'failed', 'fetch', '{"i":3}', null, '일시 오류', 10);
  if (select status from ingestion_jobs where id = j1) <> 'queued' then raise exception 'FAIL: 재시도 대기 아님'; end if;
  update ingestion_jobs set next_run_at = now() - interval '1 second' where id = j1;
  select * into claimed from claim_job('w3', 60);
  if claimed.cursor->>'i' <> '3' or claimed.attempts <> 2 then raise exception 'FAIL: cursor/attempts %', to_jsonb(claimed); end if;
  -- lease 만료 후 다른 작업자가 이어받음
  update ingestion_jobs set lease_expires_at = now() - interval '1 second' where id = j1;
  select * into claimed from claim_job('w4', 60);
  if claimed.id <> j1 then raise exception 'FAIL: 만료 lease 회수'; end if;

  -- 내부 자료 정책 -------------------------------------------------------------
  perform ingest_version('{"document":{"source_type":"internal","source_document_id":"INT-1","title":"내부 질의회신","document_kind":"질의회신"},
    "version":{"source_version_id":"h1","content_hash":"h1"},
    "units":[{"id":"00000000-0000-0000-0000-00000000a0a1","unit_type":"file_section","locator":"1","ordinal":0,"text":"내부 본문","parse_status":"ok"}]}'::jsonb);
  insert into source_files (id, document_id, classification, origin, revision_hash)
  select '00000000-0000-0000-0000-00000000b0b1', id, '질의회신', '시험', 'h1' from legal_documents where source_document_id = 'INT-1';
  insert into search_chunks (unit_id, context_text, chunk_hash, visibility, transfer_allowed)
  values ('00000000-0000-0000-0000-00000000a0a1', '내부 본문', 'hh', 'internal', false);
  perform review_source_file('00000000-0000-0000-0000-00000000b0b1', 'approve_transfer', null, '시험', '전송 승인');
  if (select visibility || ':' || transfer_allowed from search_chunks where chunk_hash = 'hh') <> 'internal:true' then
    raise exception 'FAIL: 전송 승인만으로 공개됨';
  end if;
  perform review_source_file('00000000-0000-0000-0000-00000000b0b1', 'approve_disclosure', null, '시험', '공개 승인');
  if (select visibility from search_chunks where chunk_hash = 'hh') <> 'public' then raise exception 'FAIL: 공개 반영 안 됨'; end if;
end $$;
select 'PASS' as result;
rollback;
