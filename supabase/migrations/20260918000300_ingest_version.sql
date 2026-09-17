-- ISS-007 · 버전 하나를 원자적으로 저장한다.
-- 버전 행과 단위가 함께 들어가거나 아무것도 들어가지 않는다.
-- 동시에 같은 버전이 들어오면 먼저 들어온 쪽만 남고 나머지는 'exists' 를 받는다.

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

  insert into legal_versions (document_id, source_version_id, effective_date, promulgated_at, source_url, raw_path, content_hash)
  select v_doc_id, v.source_version_id, v.effective_date, v.promulgated_at, v.source_url, v.raw_path, v.content_hash
  from jsonb_to_record(p->'version') as v(
    source_version_id text, effective_date date, promulgated_at date, source_url text, raw_path text, content_hash text)
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

revoke execute on function public.ingest_version(jsonb) from public, anon, authenticated;
