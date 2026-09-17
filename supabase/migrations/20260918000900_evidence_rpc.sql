-- ISS-010 · 근거와 문맥을 한 번에 가져온다 (왕복 수를 줄여 응답 지연을 낮춘다)

create or replace function public.evidence_bundle(p_unit_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  with recursive target as (
    select u.*, v.effective_date, v.version_status, v.source_url, v.document_id,
           d.title, d.code, d.source_type, d.source_document_id
    from legal_units u
    join legal_versions v on v.id = u.version_id
    join legal_documents d on d.id = v.document_id
    where u.id = any (p_unit_ids)
  ),
  ancestors as (
    select t.id as target_id, p.id, p.parent_unit_id, p.unit_type, p.locator, p.heading, p.text, 1 as depth
    from target t join legal_units p on p.id = t.parent_unit_id
    union all
    select a.target_id, p.id, p.parent_unit_id, p.unit_type, p.locator, p.heading, p.text, a.depth + 1
    from ancestors a join legal_units p on p.id = a.parent_unit_id
    where a.depth < 4
  ),
  notes as (
    select t.id as target_id, n.id, n.locator, n.heading, n.text,
           row_number() over (partition by t.id order by n.ordinal) as rn
    from target t
    join legal_units n on n.parent_unit_id = t.parent_unit_id and n.id <> t.id
    where t.parent_unit_id is not null
      and (n.text like '비고%' or n.text like '※%' or n.text like '%다만%' or n.locator like '%/비고%')
  ),
  children as (
    select t.id as target_id, c.id, c.locator, c.heading, c.text,
           row_number() over (partition by t.id order by c.ordinal) as rn
    from target t
    join legal_units c on c.parent_unit_id = t.id
    where length(trim(t.text)) < 40
  ),
  transfer as (
    select unit_id, bool_and(transfer_allowed) as allowed
    from search_chunks where unit_id = any (p_unit_ids) group by unit_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'unit_id', t.id,
    'version_id', t.version_id,
    'document_id', t.document_id,
    'source_document_id', t.source_document_id,
    'title', t.title,
    'code', t.code,
    'source_type', t.source_type,
    'unit_type', t.unit_type,
    'locator', t.locator,
    'heading', t.heading,
    'text', t.text,
    'parse_status', t.parse_status,
    'effective_date', t.effective_date,
    'version_status', t.version_status,
    'source_url', t.source_url,
    'transfer_allowed', coalesce(tr.allowed, true),
    'context',
      coalesce((select jsonb_agg(jsonb_build_object('unitId', a.id, 'locator', a.locator, 'heading', a.heading,
                  'text', case when a.unit_type = 'appendix' then '' else left(a.text, 600) end, 'relation', 'ancestor')
                  order by a.depth desc)
                from ancestors a where a.target_id = t.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('unitId', n.id, 'locator', n.locator, 'heading', n.heading,
                  'text', left(n.text, 800), 'relation', 'note') order by n.rn)
                from notes n where n.target_id = t.id and n.rn <= 3), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('unitId', c.id, 'locator', c.locator, 'heading', c.heading,
                  'text', left(c.text, 800), 'relation', 'child') order by c.rn)
                from children c where c.target_id = t.id and c.rn <= 5), '[]'::jsonb)
  )), '[]'::jsonb)
  from target t
  left join transfer tr on tr.unit_id = t.id;
$$;

revoke execute on function public.evidence_bundle(uuid[]) from public, anon, authenticated;
