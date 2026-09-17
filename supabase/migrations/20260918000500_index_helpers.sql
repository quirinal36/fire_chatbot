-- ISS-009 · 인덱스 구축 보조 함수

-- 조각을 한꺼번에 넣는다. 같은 (unit, hash) 는 건너뛴다.
create or replace function public.upsert_chunks(p jsonb)
returns integer
language sql
set search_path = public
as $$
  with ins as (
    insert into search_chunks (unit_id, context_text, chunk_hash, visibility, transfer_allowed)
    select c.unit_id, c.context_text, c.chunk_hash, c.visibility, c.transfer_allowed
    from jsonb_to_recordset(p) as c(unit_id uuid, context_text text, chunk_hash text, visibility text, transfer_allowed boolean)
    on conflict (unit_id, chunk_hash) do nothing
    returning 1
  )
  select count(*)::integer from ins;
$$;

-- 임베딩을 한꺼번에 기록한다. 모델·revision 을 같이 적어 질의 시 불일치를 막는다.
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
    returning 1
  )
  select count(*)::integer from upd;
$$;

-- 게시 기록과 상태 변경을 한 트랜잭션으로 처리한다 (ISS-009 제한된 게시 절차)
create or replace function public.publish_version(p_version_id uuid, p_reviewer_label text, p_reason text, p_reviewer_id uuid default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_units integer;
begin
  select review_status into v_status from legal_versions where id = p_version_id for update;
  if v_status is null then raise exception '버전 없음: %', p_version_id; end if;
  if v_status = 'published' then return 'already'; end if;
  if v_status = 'rejected' then raise exception '반려된 버전은 게시할 수 없다'; end if;
  select count(*) into v_units from legal_units where version_id = p_version_id;
  if v_units = 0 then raise exception '단위가 없는 버전은 게시할 수 없다'; end if;
  if coalesce(trim(p_reviewer_label), '') = '' or coalesce(trim(p_reason), '') = '' then
    raise exception '검토자와 게시 근거가 필요하다';
  end if;

  update legal_versions set review_status = 'published', published_at = now() where id = p_version_id;
  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason, target_version)
  select 'legal_version', p_version_id, 'publish', p_reviewer_id, p_reviewer_label, p_reason, v.source_version_id
  from legal_versions v where v.id = p_version_id;
  return 'published';
end;
$$;

revoke execute on function public.upsert_chunks(jsonb) from public, anon, authenticated;
revoke execute on function public.set_chunk_embeddings(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.publish_version(uuid, text, text, uuid) from public, anon, authenticated;
