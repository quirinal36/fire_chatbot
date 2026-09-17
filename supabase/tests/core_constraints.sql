-- ISS-005 제약 검증. 롤백하므로 데이터가 남지 않는다.
-- 실행: node scripts/db-migrate.mjs --file supabase/tests/core_constraints.sql
begin;
insert into legal_documents (id, source_type, source_document_id, title, document_kind)
values ('00000000-0000-0000-0000-000000000001', 'law', 'X1', 't', '법률');
do $$ begin
  begin
    insert into legal_documents (source_type, source_document_id, title, document_kind) values ('law', 'X1', 'dup', '법률');
    raise exception 'FAIL: 원천 ID 중복 허용';
  exception when unique_violation then null; end;
  begin
    insert into legal_versions (document_id, source_version_id, content_hash, source_url)
    values ('00000000-0000-0000-0000-000000000001', '1', 'h', '/DRF/lawService.do?OC=abc&x=1');
    raise exception 'FAIL: OC 링크 저장 허용';
  exception when check_violation then null; end;
  insert into legal_versions (document_id, source_version_id, content_hash) values ('00000000-0000-0000-0000-000000000001', '1', 'h');
  begin
    insert into legal_versions (document_id, source_version_id, content_hash) values ('00000000-0000-0000-0000-000000000001', '1', 'h2');
    raise exception 'FAIL: 시행일 없는 버전 중복 허용';
  exception when unique_violation then null; end;
  begin
    insert into rule_sets (code, version, status) values ('x', '1', 'published');
    raise exception 'FAIL: 승인 없는 게시 허용';
  exception when check_violation then null; end;
  begin
    insert into source_files (document_id, classification, origin, revision_hash, transfer_allowed)
    values ('00000000-0000-0000-0000-000000000001', 'c', 'o', 'r', true);
    raise exception 'FAIL: 승인 없는 전송 허용';
  exception when check_violation then null; end;
end $$;
select 'PASS' as result;
rollback;
