-- ISS-011 · 근거 카드 한 건. 접근 가능 여부 판단에 필요한 값을 함께 돌려준다.
create or replace function public.source_detail(p_unit_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with t as (
    select u.*, v.effective_date, v.promulgated_at, v.version_status, v.review_status, v.source_url,
           v.source_version_id, v.document_id, d.title, d.code, d.source_type, d.issuer
    from legal_units u
    join legal_versions v on v.id = u.version_id
    join legal_documents d on d.id = v.document_id
    where u.id = p_unit_id
  )
  select jsonb_build_object(
    'id', t.id,
    'versionId', t.version_id,
    'documentTitle', t.title,
    'code', t.code,
    'issuer', t.issuer,
    'sourceType', t.source_type,
    'unitType', t.unit_type,
    'locator', t.locator,
    'heading', t.heading,
    'text', t.text,
    'parseStatus', t.parse_status,
    'parseNotes', t.parse_notes,
    'effectiveDate', t.effective_date,
    'promulgatedAt', t.promulgated_at,
    'versionStatus', t.version_status,
    'reviewStatus', t.review_status,
    'sourceVersionId', t.source_version_id,
    'sourceUrl', t.source_url,
    'disclosed', t.source_type <> 'internal' or exists (
      select 1 from source_files f where f.document_id = t.document_id and f.disclosure = 'public'),
    'attachmentPath', coalesce(t.attachment_path, (
      with recursive up as (
        select p.id, p.parent_unit_id, p.attachment_path from legal_units p where p.id = t.parent_unit_id
        union all
        select p.id, p.parent_unit_id, p.attachment_path from up join legal_units p on p.id = up.parent_unit_id
      ) select attachment_path from up where attachment_path is not null limit 1)),
    'ancestors', coalesce((
      with recursive up as (
        select p.id, p.parent_unit_id, p.locator, p.heading, 1 as depth from legal_units p where p.id = t.parent_unit_id
        union all
        select p.id, p.parent_unit_id, p.locator, p.heading, up.depth + 1 from up join legal_units p on p.id = up.parent_unit_id
      ) select jsonb_agg(jsonb_build_object('id', id, 'locator', locator, 'heading', heading) order by depth desc) from up), '[]'::jsonb),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'locator', c.locator, 'heading', c.heading, 'text', left(c.text, 400)) order by c.ordinal)
      from (select * from legal_units c where c.parent_unit_id = t.id order by c.ordinal limit 30) c), '[]'::jsonb),
    'currentUnitId', (
      select cu.id from legal_versions cv
      join legal_units cu on cu.version_id = cv.id and cu.locator = t.locator
      where cv.document_id = t.document_id and cv.version_status = 'current' and cv.review_status = 'published'
        and cv.id <> t.version_id
      limit 1)
  )
  from t;
$$;
revoke execute on function public.source_detail(uuid) from public, anon, authenticated;
