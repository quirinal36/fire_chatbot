-- 도면 AI 검토 호출 기록. 비용은 하루 예산(spent_today_usd)에 합산한다.

create table public.plan_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  model text not null,
  round integer not null default 1,
  quality double precision,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6),
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);
create index plan_reviews_owner_idx on public.plan_reviews (owner_id, created_at desc);
create index plan_reviews_created_idx on public.plan_reviews (created_at desc);
alter table public.plan_reviews enable row level security;

-- 오늘(서울 기준) 모델·임베딩 비용 합계. 답변과 도면 검토를 합친다
create or replace function public.spent_today_usd()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((
    select sum(cost_usd) from answer_runs
    where created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')
  ), 0) + coalesce((
    select sum(cost_usd) from plan_reviews
    where created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')
  ), 0);
$$;
