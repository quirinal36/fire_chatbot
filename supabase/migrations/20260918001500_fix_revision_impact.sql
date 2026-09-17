-- apply_revision_impact: 레코드 변수 이름이 SQL 별칭과 겹쳐 실행되지 않던 문제 수정

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
  grp record;
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

  for grp in select (x->>'set')::uuid as set_id, array_agg(distinct x->>'rule') as rules
             from jsonb_array_elements(v_affected) x group by 1 loop
    update rule_sets
    set invalidated_rules = (select array(select distinct unnest(invalidated_rules || grp.rules))),
        invalidated_at = now(),
        invalidation_reason = format('근거 법령 개정 감지 (새 버전 %s)', p_new_version)
    where id = grp.set_id;
    insert into review_events (subject_type, subject_id, action, reviewer_label, reason, target_version)
    values ('rule_set', grp.set_id, 'invalidate', '시스템(개정 감지)', format('영향 규칙: %s', array_to_string(grp.rules, ', ')), p_new_version::text);
    v_sets := v_sets + 1;
  end loop;

  if v_sets > 0 then
    update building_cases set assessment_cache = null, assessment_revision = null, assessment_rule_set = null
    where assessment_cache is not null;
  end if;

  return jsonb_build_object('status', 'checked', 'previous', v_old, 'affected', v_affected);
end;
$$;

