-- revalidate_rule_set: 배열 비교 문법 수정

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
    where r.rule_set_id = p_rule_set_id and r.rule_key in (select unnest(invalidated_rules) from rule_sets where id = p_rule_set_id)
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

