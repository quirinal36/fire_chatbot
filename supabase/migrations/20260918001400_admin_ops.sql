-- ISS-021 · ISS-022 · ISS-023 · ISS-024

-- ---------------------------------------------------------------------------
-- ISS-021 · 버전 게시: 파싱이 불완전한 단위가 있으면 확인을 명시해야 게시한다
-- ---------------------------------------------------------------------------
drop function if exists public.publish_version(uuid, text, text, uuid);

create or replace function public.publish_version(
  p_version_id uuid,
  p_reviewer_label text,
  p_reason text,
  p_reviewer_id uuid default null,
  p_acknowledge_parse_issues boolean default false
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_units integer;
  v_review integer;
begin
  select review_status into v_status from legal_versions where id = p_version_id for update;
  if v_status is null then raise exception '버전 없음: %', p_version_id; end if;
  if v_status = 'published' then return 'already'; end if;
  if v_status = 'rejected' then raise exception '반려된 버전은 게시할 수 없다'; end if;
  select count(*), count(*) filter (where parse_status = 'needs_review') into v_units, v_review
  from legal_units where version_id = p_version_id;
  if v_units = 0 then raise exception '단위가 없는 버전은 게시할 수 없다'; end if;
  if v_review > 0 and not p_acknowledge_parse_issues then
    raise exception '파싱 확인이 필요한 단위 %건이 있다. 검색 노출만 허용한다는 확인이 필요하다 (규칙 근거로는 여전히 쓸 수 없다)', v_review;
  end if;
  if coalesce(trim(p_reviewer_label), '') = '' or coalesce(trim(p_reason), '') = '' then
    raise exception '검토자와 게시 근거가 필요하다';
  end if;

  update legal_versions set review_status = 'published', published_at = now() where id = p_version_id;
  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason, target_version)
  select 'legal_version', p_version_id, 'publish', p_reviewer_id, p_reviewer_label,
         p_reason || case when v_review > 0 then format(' [파싱 확인 필요 %s건 인지]', v_review) else '' end,
         v.source_version_id
  from legal_versions v where v.id = p_version_id;
  return 'published';
end;
$$;

create or replace function public.reject_version(p_version_id uuid, p_reviewer_label text, p_reason text, p_reviewer_id uuid default null)
returns text
language plpgsql
set search_path = public
as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception '반려 사유가 필요하다'; end if;
  update legal_versions set review_status = 'rejected' where id = p_version_id and review_status <> 'published';
  if not found then raise exception '게시된 버전은 반려할 수 없다. 새 버전으로 대체한다'; end if;
  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason, target_version)
  select 'legal_version', p_version_id, 'reject', p_reviewer_id, p_reviewer_label, p_reason, source_version_id
  from legal_versions where id = p_version_id;
  perform refresh_version_status((select document_id from legal_versions where id = p_version_id));
  return 'rejected';
end;
$$;

-- ---------------------------------------------------------------------------
-- ISS-022 · 개정 영향: 근거 조문이 바뀐 규칙은 재검토 전까지 판정하지 않는다
-- ---------------------------------------------------------------------------
alter table public.rule_sets
  add column invalidated_rules text[] not null default '{}',
  add column invalidated_at timestamptz,
  add column invalidation_reason text;

-- 새 버전과 이전 버전을 locator 로 비교해 달라진 단위 목록을 돌려준다
create or replace function public.version_diff(p_old uuid, p_new uuid)
returns table (locator text, change text, old_unit_id uuid, new_unit_id uuid, old_text text, new_text text)
language sql
stable
set search_path = public
as $$
  with o as (select id, locator, regexp_replace(text, '\s+', ' ', 'g') as t, text from legal_units where version_id = p_old),
       n as (select id, locator, regexp_replace(text, '\s+', ' ', 'g') as t, text from legal_units where version_id = p_new)
  select coalesce(o.locator, n.locator),
         case when o.id is null then 'added' when n.id is null then 'removed' else 'changed' end,
         o.id, n.id, o.text, n.text
  from o full outer join n on n.locator = o.locator
  where o.id is null or n.id is null or o.t <> n.t
  order by 1;
$$;

-- 새 버전 수집 직후 호출한다. 이전 현행(또는 게시) 버전 대비 바뀐 근거를 가진 규칙을 무효로 표시하고 판단 캐시를 비운다.
create or replace function public.apply_revision_impact(p_new_version uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_doc uuid;
  v_old uuid;
  v_affected jsonb;
  v_sets integer := 0;
  r record;
begin
  select document_id into v_doc from legal_versions where id = p_new_version;
  select id into v_old from legal_versions
  where document_id = v_doc and id <> p_new_version and review_status = 'published'
  order by effective_date desc nulls last, fetched_at desc limit 1;
  if v_old is null then return jsonb_build_object('status', 'no_previous'); end if;

  -- 이전 버전 단위를 근거로 쓰는 규칙 중, 해당 locator 가 바뀌거나 사라진 것
  with changed as (select locator from version_diff(v_old, p_new_version) where change <> 'added'),
  hit as (
    select rs.id as set_id, r.rule_key, u.locator
    from rule_sources s
    join legal_units u on u.id = s.legal_unit_id and u.version_id = v_old
    join rules r on r.id = s.rule_id
    join rule_sets rs on rs.id = r.rule_set_id and rs.status in ('published', 'approved', 'pending_review')
    where u.locator in (select locator from changed)
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('set', set_id, 'rule', rule_key, 'locator', locator)), '[]'::jsonb)
  into v_affected from hit;

  for r in select (x->>'set')::uuid as set_id, array_agg(distinct x->>'rule') as rules
           from jsonb_array_elements(v_affected) x group by 1 loop
    update rule_sets
    set invalidated_rules = (select array(select distinct unnest(invalidated_rules || r.rules))),
        invalidated_at = now(),
        invalidation_reason = format('근거 법령 개정 감지 (새 버전 %s)', p_new_version)
    where id = r.set_id;
    insert into review_events (subject_type, subject_id, action, reviewer_label, reason, target_version)
    values ('rule_set', r.set_id, 'invalidate', '시스템(개정 감지)', format('영향 규칙: %s', array_to_string(r.rules, ', ')), p_new_version::text);
    v_sets := v_sets + 1;
  end loop;

  if v_sets > 0 then
    update building_cases set assessment_cache = null, assessment_revision = null, assessment_rule_set = null
    where assessment_cache is not null;
  end if;

  return jsonb_build_object('status', 'checked', 'previous', v_old, 'affected', v_affected);
end;
$$;

-- review_rule_set 에 재승인 동작을 더한다: 무효 표시를 지우려면 근거가 모두 현행이어야 한다
create or replace function public.revalidate_rule_set(p_rule_set_id uuid, p_reviewer_id uuid, p_reviewer_label text, p_reason text)
returns text
language plpgsql
set search_path = public
as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception '검토 사유가 필요하다'; end if;
  if exists (
    select 1 from rules r join rule_sources rs on rs.rule_id = r.id
    join legal_units u on u.id = rs.legal_unit_id join legal_versions v on v.id = u.version_id
    where r.rule_set_id = p_rule_set_id and r.rule_key = any ((select invalidated_rules from rule_sets where id = p_rule_set_id))
      and (v.version_status <> 'current' or v.review_status <> 'published')
  ) then
    raise exception '영향받은 규칙의 근거가 아직 현행 게시본이 아니다. 규칙을 새 버전으로 동기화해 승인한다';
  end if;
  update rule_sets set invalidated_rules = '{}', invalidated_at = null, invalidation_reason = null where id = p_rule_set_id;
  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason)
  values ('rule_set', p_rule_set_id, 'approve', p_reviewer_id, p_reviewer_label, '재검토 완료: ' || p_reason);
  update building_cases set assessment_cache = null, assessment_revision = null, assessment_rule_set = null
  where assessment_cache is not null;
  return 'revalidated';
end;
$$;

-- ---------------------------------------------------------------------------
-- ISS-023 · 작업 큐
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(p_kind text, p_payload jsonb, p_dedupe_key text, p_created_by uuid default null, p_run_at timestamptz default now())
returns uuid
language plpgsql
set search_path = public
as $$
declare v_id uuid;
begin
  insert into ingestion_jobs (kind, payload, dedupe_key, created_by, next_run_at)
  values (p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, p_created_by, p_run_at)
  on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from ingestion_jobs where dedupe_key = p_dedupe_key and status in ('queued', 'running') limit 1;
  end if;
  return v_id;
end;
$$;

-- 실행할 작업 하나를 원자적으로 가져온다. lease 가 끝난 running 작업도 다시 가져온다
create or replace function public.claim_job(p_worker text, p_lease_seconds integer default 120)
returns setof public.ingestion_jobs
language sql
set search_path = public
as $$
  with next as (
    select id from ingestion_jobs
    where (status = 'queued' and next_run_at <= now())
       or (status = 'running' and lease_expires_at < now())
    order by next_run_at
    for update skip locked
    limit 1
  )
  update ingestion_jobs j
  set status = 'running',
      lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = j.attempts + 1,
      updated_at = now()
  from next
  where j.id = next.id
  returning j.*;
$$;

-- 진행 저장. lease 를 가진 작업자만 쓸 수 있다
create or replace function public.update_job(
  p_job_id uuid,
  p_worker text,
  p_status text,
  p_stage text,
  p_cursor jsonb,
  p_result jsonb,
  p_error text,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_attempts integer; v_max integer;
begin
  select attempts, max_attempts into v_attempts, v_max from ingestion_jobs
  where id = p_job_id and lease_owner = p_worker and status = 'running' for update;
  if not found then return false; end if;

  if p_status = 'failed' and v_attempts < v_max and p_retry_after_seconds is not null then
    -- 재시도 가능한 실패: 지수 백오프로 다시 대기열에
    update ingestion_jobs
    set status = 'queued', stage = p_stage, cursor = p_cursor, last_error = p_error,
        next_run_at = now() + make_interval(secs => p_retry_after_seconds * power(2, v_attempts - 1)::int),
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_job_id;
  elsif p_status = 'queued' then
    -- 시간 예산이 끝나 이어서 할 작업: 시도 횟수를 되돌린다
    update ingestion_jobs
    set status = 'queued', stage = p_stage, cursor = p_cursor, result = coalesce(p_result, result),
        attempts = greatest(attempts - 1, 0), next_run_at = now(),
        lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_job_id;
  else
    update ingestion_jobs
    set status = p_status, stage = p_stage, cursor = p_cursor, result = coalesce(p_result, result),
        last_error = p_error, lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_job_id;
  end if;
  return true;
end;
$$;

create or replace function public.retry_job(p_job_id uuid)
returns boolean
language sql
set search_path = public
as $$
  with upd as (
    update ingestion_jobs
    set status = 'queued', attempts = 0, next_run_at = now(), last_error = null, updated_at = now()
    where id = p_job_id and status in ('failed', 'cancelled')
    returning 1
  )
  select exists (select 1 from upd);
$$;

-- ---------------------------------------------------------------------------
-- ISS-024 · 내부 자료·해석의 공개/전송 정책을 검색 조각에 반영
-- ---------------------------------------------------------------------------
create or replace function public.apply_source_policy(p_document_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_type text;
  v_public boolean;
  v_transfer boolean;
  v_count integer;
begin
  select source_type into v_type from legal_documents where id = p_document_id;
  if v_type is null then raise exception '문서 없음'; end if;

  if v_type = 'internal' then
    -- 가장 최근 revision 의 승인 상태를 따른다. 승인 기록이 없으면 비공개·전송 불가
    select disclosure = 'public', transfer_allowed into v_public, v_transfer
    from source_files where document_id = p_document_id order by created_at desc limit 1;
    v_public := coalesce(v_public, false);
    v_transfer := coalesce(v_transfer, false);
  else
    v_public := true;
    v_transfer := true;
  end if;

  update search_chunks c
  set visibility = case when v_public then 'public' else 'internal' end,
      transfer_allowed = v_transfer
  from legal_units u join legal_versions v on v.id = u.version_id
  where c.unit_id = u.id and v.document_id = p_document_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.review_source_file(
  p_file_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_reviewer_label text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_doc uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception '검토 사유가 필요하다'; end if;
  select document_id into v_doc from source_files where id = p_file_id for update;
  if v_doc is null then raise exception '자료 없음'; end if;

  case p_action
    when 'approve_disclosure' then
      update source_files set disclosure = 'public', disclosure_approved_by = p_reviewer_id, disclosure_approved_at = now() where id = p_file_id;
    when 'revoke_disclosure' then
      update source_files set disclosure = 'private', disclosure_approved_by = null, disclosure_approved_at = null where id = p_file_id;
    when 'approve_transfer' then
      update source_files set transfer_allowed = true, transfer_approved_by = p_reviewer_id, transfer_approved_at = now() where id = p_file_id;
    when 'revoke_transfer' then
      update source_files set transfer_allowed = false, transfer_approved_by = null, transfer_approved_at = null where id = p_file_id;
    when 'select' then
      update source_files set selected_by_reviewer = true where id = p_file_id;
    when 'unselect' then
      update source_files set selected_by_reviewer = false where id = p_file_id;
    else
      raise exception '알 수 없는 동작: %', p_action;
  end case;

  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason, target_version)
  values ('source_file', p_file_id,
          case when p_action like 'approve%' or p_action = 'select' then 'approve' else 'reject' end,
          p_reviewer_id, p_reviewer_label, p_action || ': ' || p_reason, null);

  -- 내부 자료는 승인해도 게시 상태의 버전이어야 검색된다. 정책은 조각에 즉시 반영한다
  perform apply_source_policy(v_doc);
  return (select to_jsonb(f) from source_files f where id = p_file_id);
end;
$$;

-- 피드백 처리 (ISS-021)
create or replace function public.handle_feedback(p_feedback_id uuid, p_status text, p_reviewer_id uuid, p_reviewer_label text, p_note text)
returns text
language plpgsql
set search_path = public
as $$
begin
  if p_status not in ('triaged', 'resolved', 'dismissed', 'open') then raise exception '알 수 없는 상태'; end if;
  update feedback set status = p_status, handled_by = p_reviewer_id, handled_at = now() where id = p_feedback_id;
  if not found then raise exception '신고 없음'; end if;
  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason)
  values ('feedback', p_feedback_id, case when p_status = 'open' then 'request_changes' else 'resolve' end, p_reviewer_id, p_reviewer_label,
          p_status || coalesce(': ' || nullif(trim(p_note), ''), ''));
  return p_status;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'publish_version(uuid, text, text, uuid, boolean)', 'reject_version(uuid, text, text, uuid)',
    'version_diff(uuid, uuid)', 'apply_revision_impact(uuid)', 'revalidate_rule_set(uuid, uuid, text, text)',
    'enqueue_job(text, jsonb, text, uuid, timestamptz)', 'claim_job(text, integer)',
    'update_job(uuid, text, text, text, jsonb, jsonb, text, integer)', 'retry_job(uuid)',
    'apply_source_policy(uuid)', 'review_source_file(uuid, text, uuid, text, text)',
    'handle_feedback(uuid, text, uuid, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
