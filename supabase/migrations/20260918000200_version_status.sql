-- ISS-007 · ISS-008 · 버전 상태 계산
--
-- 한 문서의 버전들 중 기준일(오늘) 이전에 시행된 가장 늦은 버전이 현행이다.
-- 기준일 이후 시행 버전은 시행예정, 나머지는 연혁이다. 구버전을 지우거나 덮어쓰지 않는다.

create or replace function public.refresh_version_status(p_document_id uuid, p_today date default (now() at time zone 'Asia/Seoul')::date)
returns void
language sql
set search_path = public
as $$
  with ranked as (
    select id,
      case
        when effective_date > p_today then 'scheduled'
        when id = (
          select v2.id from legal_versions v2
          where v2.document_id = p_document_id
            and (v2.effective_date is null or v2.effective_date <= p_today)
            and v2.review_status <> 'rejected'
          order by v2.effective_date desc nulls last, v2.fetched_at desc
          limit 1
        ) then 'current'
        else 'historical'
      end as next_status
    from legal_versions
    where document_id = p_document_id
  )
  update legal_versions v
  set version_status = r.next_status
  from ranked r
  where v.id = r.id and v.version_status is distinct from r.next_status;
$$;

revoke execute on function public.refresh_version_status(uuid, date) from public, anon, authenticated;
