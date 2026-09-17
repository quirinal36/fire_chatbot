-- ISS-010 · 검색 범위 지정과 키워드 적중 수
-- 코드·법령명이 질문에 있으면 그 문서 안에서 한 번 더 찾는다.
-- 키워드 적중 수로 근거 부족을 판단한다.

drop function if exists public.search_keyword(text[], date, text[], integer);
drop function if exists public.search_vector(extensions.vector, text, text, date, text[], integer);

create or replace function public.search_keyword(
  p_terms text[],
  p_as_of date,
  p_visibility text[] default array['public'],
  p_limit integer default 30,
  p_scope_codes text[] default null,
  p_scope_titles text[] default null
)
returns table (chunk_id uuid, unit_id uuid, score real, matched integer)
language sql
stable
set search_path = public, extensions
as $$
  with live as (select version_id, document_id from versions_as_of(p_as_of)),
  terms as (
    select distinct replace(replace(t, '%', ''), '_', '') as t
    from unnest(p_terms) t where length(t) >= 2
  )
  select c.id, c.unit_id,
    (select coalesce(sum(least(length(t), 6)), 0) from terms where c.context_text ilike '%' || t || '%')::real
      + word_similarity(array_to_string(p_terms, ' '), c.context_text) as score,
    (select count(*) from terms where c.context_text ilike '%' || t || '%')::integer as matched
  from search_chunks c
  join legal_units u on u.id = c.unit_id
  join live l on l.version_id = u.version_id
  join legal_documents d on d.id = l.document_id
  where c.visibility = any (p_visibility)
    and c.context_text ilike any (array(select '%' || t || '%' from terms))
    and (p_scope_codes is null and p_scope_titles is null
         or d.code = any (p_scope_codes) or d.title = any (p_scope_titles))
  order by score desc
  limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.search_vector(
  p_embedding extensions.vector(1536),
  p_model text,
  p_revision text,
  p_as_of date,
  p_visibility text[] default array['public'],
  p_limit integer default 30,
  p_scope_codes text[] default null,
  p_scope_titles text[] default null
)
returns table (chunk_id uuid, unit_id uuid, score real)
language sql
stable
set search_path = public, extensions
as $$
  with live as (select version_id, document_id from versions_as_of(p_as_of))
  select c.id, c.unit_id, (1 - (c.embedding <=> p_embedding))::real as score
  from search_chunks c
  join legal_units u on u.id = c.unit_id
  join live l on l.version_id = u.version_id
  join legal_documents d on d.id = l.document_id
  where c.visibility = any (p_visibility)
    and c.embedding_model = p_model
    and c.embedding_revision = p_revision
    and c.embedding is not null
    and (p_scope_codes is null and p_scope_titles is null
         or d.code = any (p_scope_codes) or d.title = any (p_scope_titles))
  order by c.embedding <=> p_embedding
  limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function public.search_keyword(text[], date, text[], integer, text[], text[]) from public, anon, authenticated;
revoke execute on function public.search_vector(extensions.vector, text, text, date, text[], integer, text[], text[]) from public, anon, authenticated;
