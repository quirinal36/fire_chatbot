-- 캐시 채우기를 나눠 실행한다. API 역할의 문장 제한(8초) 안에서 HNSW 갱신이 끝나야 한다.
drop function if exists public.fill_embeddings_from_cache(text, text);

create or replace function public.fill_embeddings_from_cache(p_model text, p_revision text, p_limit integer default 200)
returns integer
language sql
set search_path = public, extensions
as $$
  with todo as (
    select c.id, k.embedding
    from search_chunks c
    join embedding_cache k
      on k.chunk_hash = c.chunk_hash and k.embedding_model = p_model and k.embedding_revision = p_revision
    where c.embedding is null or c.embedding_model <> p_model or c.embedding_revision <> p_revision
    limit p_limit
  ), upd as (
    update search_chunks c
    set embedding = t.embedding, embedding_model = p_model, embedding_revision = p_revision
    from todo t
    where c.id = t.id
    returning 1
  )
  select count(*)::integer from upd;
$$;

revoke execute on function public.fill_embeddings_from_cache(text, text, integer) from public, anon, authenticated;
