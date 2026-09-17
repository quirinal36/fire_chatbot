-- ISS-017~019 · 규칙 저장과 사례 조건 revision

-- 규칙 근거는 파싱이 확인된 게시 단위만 허용한다 (기획서 §4.4)
create or replace function private.rule_source_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parse text;
  v_review text;
begin
  select u.parse_status, v.review_status into v_parse, v_review
  from legal_units u join legal_versions v on v.id = u.version_id
  where u.id = new.legal_unit_id;
  if v_parse is distinct from 'ok' then
    raise exception '파싱이 불완전한 단위(%)는 규칙 근거로 쓸 수 없다', new.legal_unit_id;
  end if;
  if v_review is distinct from 'published' then
    raise exception '게시되지 않은 버전의 단위(%)는 규칙 근거로 쓸 수 없다', new.legal_unit_id;
  end if;
  return new;
end;
$$;

create trigger rule_sources_guard before insert or update on public.rule_sources
for each row execute function private.rule_source_guard();

alter table public.rules add column sort_order integer not null default 0;

-- 규칙 세트 한 벌을 원자적으로 저장한다. 이미 승인·게시된 버전은 내용을 바꾸지 못한다.
create or replace function public.upsert_rule_set(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_set uuid;
  v_status text;
  v_rule jsonb;
  v_rule_id uuid;
  v_src jsonb;
  v_order integer := 0;
begin
  select id, status into v_set, v_status from rule_sets
  where code = p->>'code' and version = p->>'version' for update;

  if v_set is not null and v_status in ('approved', 'published', 'retired') then
    return jsonb_build_object('status', 'locked', 'rule_set_id', v_set, 'rule_status', v_status);
  end if;

  if v_set is null then
    insert into rule_sets (code, version, scope, status)
    values (p->>'code', p->>'version', p->'scope', 'pending_review')
    returning id into v_set;
  else
    update rule_sets set scope = p->'scope', status = 'pending_review', review_notes = null where id = v_set;
    delete from rules where rule_set_id = v_set;
  end if;

  for v_rule in select * from jsonb_array_elements(p->'rules') loop
    insert into rules (rule_set_id, rule_key, facility, required_inputs, definition, explanation_template, sort_order)
    values (
      v_set, v_rule->>'key', v_rule->>'facility',
      array(select jsonb_array_elements_text(v_rule->'required_inputs')),
      v_rule->'definition', v_rule->'explain'::text, v_order
    )
    returning id into v_rule_id;
    v_order := v_order + 1;

    for v_src in select * from jsonb_array_elements(v_rule->'sources') loop
      insert into rule_sources (rule_id, legal_unit_id, role)
      values (v_rule_id, (v_src->>'unit_id')::uuid, v_src->>'role')
      on conflict do nothing;
    end loop;
  end loop;

  return jsonb_build_object('status', 'saved', 'rule_set_id', v_set);
end;
$$;

-- 승인·반려·게시 (ISS-021 관리자 화면과 CLI 가 같이 쓴다)
create or replace function public.review_rule_set(
  p_rule_set_id uuid,
  p_action text,
  p_reviewer_id uuid,
  p_reviewer_label text,
  p_reason text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_version text;
  v_code text;
begin
  select status, version, code into v_status, v_version, v_code from rule_sets where id = p_rule_set_id for update;
  if v_status is null then raise exception '규칙 세트 없음'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '검토 사유가 필요하다'; end if;

  if p_action = 'approve' then
    if v_status not in ('pending_review', 'needs_review') then raise exception '% 상태는 승인할 수 없다', v_status; end if;
    -- 근거가 모두 게시·현행인지 다시 확인한다
    if exists (
      select 1 from rules r join rule_sources rs on rs.rule_id = r.id
      join legal_units u on u.id = rs.legal_unit_id join legal_versions v on v.id = u.version_id
      where r.rule_set_id = p_rule_set_id and (v.review_status <> 'published' or v.version_status <> 'current' or u.parse_status <> 'ok')
    ) then
      raise exception '현행·게시 상태가 아닌 근거가 있어 승인할 수 없다';
    end if;
    update rule_sets set status = 'approved', approved_by = p_reviewer_id, approved_at = now(), review_notes = p_reason where id = p_rule_set_id;
  elsif p_action = 'publish' then
    if v_status <> 'approved' then raise exception '승인된 규칙만 게시할 수 있다'; end if;
    -- 같은 코드의 이전 게시본은 은퇴시킨다
    update rule_sets set status = 'retired' where code = v_code and status = 'published' and id <> p_rule_set_id;
    update rule_sets set status = 'published', published_at = now() where id = p_rule_set_id;
  elsif p_action = 'reject' then
    update rule_sets set status = 'draft', review_notes = p_reason where id = p_rule_set_id;
  elsif p_action = 'request_changes' then
    update rule_sets set status = 'needs_review', review_notes = p_reason where id = p_rule_set_id;
  else
    raise exception '알 수 없는 검토 동작: %', p_action;
  end if;

  insert into review_events (subject_type, subject_id, action, reviewer_id, reviewer_label, reason, target_version)
  values ('rule_set', p_rule_set_id, p_action, p_reviewer_id, p_reviewer_label, p_reason, v_version);
  return (select status from rule_sets where id = p_rule_set_id);
end;
$$;

-- 사례 조건: 낙관적 잠금으로 수정하고 판단 캐시를 비운다
alter table public.building_cases
  add column assessment_cache jsonb,
  add column assessment_revision integer,
  add column assessment_rule_set text;

create or replace function public.update_case_fields(
  p_case_id uuid,
  p_owner uuid,
  p_expected_revision integer,
  p_patch jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_row building_cases;
begin
  select * into v_row from building_cases where id = p_case_id for update;
  if v_row.id is null or v_row.owner_id <> p_owner then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_row.revision, 'fields', v_row.fields);
  end if;

  update building_cases
  set fields = jsonb_strip_nulls(fields || p_patch),
      revision = revision + 1,
      updated_at = now(),
      assessment_cache = null,
      assessment_revision = null,
      assessment_rule_set = null
  where id = p_case_id
  returning * into v_row;

  return jsonb_build_object('status', 'updated', 'revision', v_row.revision, 'fields', v_row.fields);
end;
$$;

revoke execute on function public.upsert_rule_set(jsonb) from public, anon, authenticated;
revoke execute on function public.review_rule_set(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.update_case_fields(uuid, uuid, integer, jsonb) from public, anon, authenticated;
