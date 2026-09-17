-- ISS-008 · 파서 개선 시 같은 원문을 다시 정규화한다.
-- 규칙이 근거로 쓰고 있는 단위가 있으면 교체하지 않는다 (근거 연결이 끊기면 안 된다).

alter table public.legal_versions add column parser_version text not null default '1';

create or replace function public.replace_version_units(p_version_id uuid, p_parser_version text, p_units jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  perform 1 from legal_versions where id = p_version_id for update;
  if not found then raise exception '버전 없음: %', p_version_id; end if;
  if exists (
    select 1 from rule_sources rs join legal_units u on u.id = rs.legal_unit_id where u.version_id = p_version_id
  ) then
    raise exception '규칙이 참조하는 버전은 다시 정규화할 수 없다. 새 버전으로 수집하거나 규칙을 먼저 재검토한다';
  end if;

  delete from legal_units where version_id = p_version_id;
  insert into legal_units (id, version_id, unit_type, locator, parent_unit_id, ordinal, heading, text, attachment_path, parse_status, parse_notes)
  select u.id, p_version_id, u.unit_type, u.locator, u.parent_id, u.ordinal, u.heading, u.text, u.attachment_path, u.parse_status, u.parse_notes
  from jsonb_to_recordset(p_units) as u(
    id uuid, unit_type text, locator text, parent_id uuid, ordinal integer, heading text, text text,
    attachment_path text, parse_status text, parse_notes text);
  get diagnostics v_count = row_count;
  update legal_versions set parser_version = p_parser_version where id = p_version_id;
  return v_count;
end;
$$;

revoke execute on function public.replace_version_units(uuid, text, jsonb) from public, anon, authenticated;

-- ingest_version 이 파서 버전을 함께 기록하도록 다시 만든다
create or replace function public.ingest_version(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_doc_id uuid;
  v_version_id uuid;
  v_existing record;
  v_units integer;
begin
  insert into legal_documents (source_type, source_document_id, title, issuer, document_kind, code)
  select d.source_type, d.source_document_id, d.title, d.issuer, d.document_kind, d.code
  from jsonb_to_record(p->'document') as d(
    source_type text, source_document_id text, title text, issuer text, document_kind text, code text)
  on conflict (source_type, source_document_id) do update
    set title = excluded.title, issuer = excluded.issuer, document_kind = excluded.document_kind,
        code = coalesce(excluded.code, legal_documents.code)
  returning id into v_doc_id;

  insert into legal_versions (document_id, source_version_id, effective_date, promulgated_at, source_url, raw_path, content_hash, parser_version)
  select v_doc_id, v.source_version_id, v.effective_date, v.promulgated_at, v.source_url, v.raw_path, v.content_hash,
         coalesce(v.parser_version, '1')
  from jsonb_to_record(p->'version') as v(
    source_version_id text, effective_date date, promulgated_at date, source_url text, raw_path text, content_hash text,
    parser_version text)
  on conflict do nothing
  returning id into v_version_id;

  if v_version_id is null then
    select lv.id, lv.content_hash into v_existing
    from legal_versions lv
    where lv.document_id = v_doc_id
      and lv.source_version_id = p->'version'->>'source_version_id'
      and lv.effective_date is not distinct from (p->'version'->>'effective_date')::date;
    return jsonb_build_object('status', 'exists', 'version_id', v_existing.id, 'content_hash', v_existing.content_hash);
  end if;

  insert into legal_units (id, version_id, unit_type, locator, parent_unit_id, ordinal, heading, text, attachment_path, parse_status, parse_notes)
  select u.id, v_version_id, u.unit_type, u.locator, u.parent_id, u.ordinal, u.heading, u.text, u.attachment_path, u.parse_status, u.parse_notes
  from jsonb_to_recordset(p->'units') as u(
    id uuid, unit_type text, locator text, parent_id uuid, ordinal integer, heading text, text text,
    attachment_path text, parse_status text, parse_notes text);
  get diagnostics v_units = row_count;

  perform refresh_version_status(v_doc_id);

  return jsonb_build_object('status', 'created', 'version_id', v_version_id, 'document_id', v_doc_id, 'unit_count', v_units);
end;
$$;
