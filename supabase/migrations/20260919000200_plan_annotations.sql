-- 도면 저장본에 판정(개구부 종류·문·창·구역 이름)을 함께 둔다. 없으면 null (구버전 저장본).
alter table public.plans add column if not exists annotations jsonb;

-- 도면 AI 호출 기록에 종류를 둔다. 검토(review) 외에 치수 읽기(scale)도 비용을 남겨야 하루 예산에 잡힌다.
alter table public.plan_reviews
  add column if not exists kind text not null default 'review'
  check (kind in ('review', 'scale'));
