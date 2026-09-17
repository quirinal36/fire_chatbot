-- ISS-009 · ISS-010 · 검색 함수
--
-- 모든 검색은 여기서 필터를 강제한다. 호출하는 서버 코드가 빠뜨려도 새지 않게 한다.
-- - 게시(published)된 버전만
-- - 기준일에 시행 중인 버전만 (문서마다 하나)
-- - 허용된 공개 범위만 (기본 public)
-- - 질의와 같은 임베딩 모델·revision 만

create or replace function public.versions_as_of(p_as_of date)
returns table (version_id uuid, document_id uuid)
language sql
stable
set search_path = public
as $$
  select distinct on (v.document_id) v.id, v.document_id
  from legal_versions v
  where v.review_status = 'published'
    and (v.effective_date is null or v.effective_date <= p_as_of)
  order by v.document_id, v.effective_date desc nulls last, v.fetched_at desc;
$$;

create or replace function public.search_keyword(
  p_terms text[],
  p_as_of date,
  p_visibility text[] default array['public'],
  p_limit integer default 30
)
returns table (chunk_id uuid, unit_id uuid, score real)
language sql
stable
set search_path = public, extensions
as $$
  with live as (select version_id from versions_as_of(p_as_of))
  select c.id, c.unit_id,
    (
      select coalesce(sum(case when c.context_text ilike '%' || t || '%' then least(length(t), 6)::real else 0 end), 0)
      from unnest(p_terms) t
      where length(t) >= 2
    ) + word_similarity(array_to_string(p_terms, ' '), c.context_text) as score
  from search_chunks c
  join legal_units u on u.id = c.unit_id
  join live l on l.version_id = u.version_id
  where c.visibility = any (p_visibility)
    and c.context_text ilike any (array(
      select '%' || replace(replace(t, '%', ''), '_', '') || '%' from unnest(p_terms) t where length(t) >= 2
    ))
  order by score desc
  limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.search_vector(
  p_embedding extensions.vector(1536),
  p_model text,
  p_revision text,
  p_as_of date,
  p_visibility text[] default array['public'],
  p_limit integer default 30
)
returns table (chunk_id uuid, unit_id uuid, score real)
language sql
stable
set search_path = public, extensions
as $$
  with live as (select version_id from versions_as_of(p_as_of))
  select c.id, c.unit_id, (1 - (c.embedding <=> p_embedding))::real as score
  from search_chunks c
  join legal_units u on u.id = c.unit_id
  join live l on l.version_id = u.version_id
  where c.visibility = any (p_visibility)
    and c.embedding_model = p_model
    and c.embedding_revision = p_revision
    and c.embedding is not null
  order by c.embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 200);
$$;

-- 정확 일치: 문서 코드(NFPC 103)·제목 일부와 locator(제11조, 별표4) 조합
create or replace function public.search_exact(
  p_codes text[],
  p_title_terms text[],
  p_locators text[],
  p_as_of date,
  p_visibility text[] default array['public'],
  p_limit integer default 30
)
returns table (unit_id uuid, score real)
language sql
stable
set search_path = public
as $$
  with live as (select version_id, document_id from versions_as_of(p_as_of))
  select u.id,
    (case when d.code = any (p_codes) then 3 else 0 end
     + case when exists (select 1 from unnest(p_title_terms) t where d.title like '%' || t || '%') then 1 else 0 end
     + case when u.locator = any (p_locators) then 3 else 0 end)::real as score
  from legal_units u
  join live l on l.version_id = u.version_id
  join legal_documents d on d.id = l.document_id
  where (d.code = any (p_codes) or exists (select 1 from unnest(p_title_terms) t where d.title like '%' || t || '%'))
    and (cardinality(p_locators) = 0 or u.locator = any (p_locators))
    and (d.source_type <> 'internal' or 'internal' = any (p_visibility))
    and (cardinality(p_locators) > 0 or u.parent_unit_id is null)
  order by score desc, u.ordinal
  limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function public.versions_as_of(date) from public, anon, authenticated;
revoke execute on function public.search_keyword(text[], date, text[], integer) from public, anon, authenticated;
revoke execute on function public.search_vector(extensions.vector, text, text, date, text[], integer) from public, anon, authenticated;
revoke execute on function public.search_exact(text[], text[], text[], date, text[], integer) from public, anon, authenticated;
