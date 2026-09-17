-- ISS-009 · 같은 조각 본문은 다시 임베딩하지 않는다.
-- 재정규화로 단위가 교체되어도 본문 hash 가 같으면 캐시에서 벡터를 채운다.

create table public.embedding_cache (
  chunk_hash text not null,
  embedding_model text not null,
  embedding_revision text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (chunk_hash, embedding_model, embedding_revision)
);
alter table public.embedding_cache enable row level security;
revoke all on public.embedding_cache from anon, authenticated;

insert into embedding_cache (chunk_hash, embedding_model, embedding_revision, embedding)
select distinct on (chunk_hash, embedding_model, embedding_revision) chunk_hash, embedding_model, embedding_revision, embedding
from search_chunks where embedding is not null
on conflict do nothing;

create or replace function public.set_chunk_embeddings(p_model text, p_revision text, p jsonb)
returns integer
language sql
set search_path = public, extensions
as $$
  with upd as (
    update search_chunks c
    set embedding = e.embedding::extensions.vector(1536),
        embedding_model = p_model,
        embedding_revision = p_revision
    from jsonb_to_recordset(p) as e(id uuid, embedding text)
    where c.id = e.id
    returning c.chunk_hash, c.embedding
  ), cached as (
    insert into embedding_cache (chunk_hash, embedding_model, embedding_revision, embedding)
    select chunk_hash, p_model, p_revision, embedding from upd
    on conflict do nothing
  )
  select count(*)::integer from upd;
$$;

-- 캐시에 있는 벡터를 빈 조각에 채운다
create or replace function public.fill_embeddings_from_cache(p_model text, p_revision text)
returns integer
language sql
set search_path = public, extensions
as $$
  with upd as (
    update search_chunks c
    set embedding = k.embedding, embedding_model = k.embedding_model, embedding_revision = k.embedding_revision
    from embedding_cache k
    where k.chunk_hash = c.chunk_hash and k.embedding_model = p_model and k.embedding_revision = p_revision
      and (c.embedding is null or c.embedding_model <> p_model or c.embedding_revision <> p_revision)
    returning 1
  )
  select count(*)::integer from upd;
$$;

revoke execute on function public.fill_embeddings_from_cache(text, text) from public, anon, authenticated;
