alter table public.plans
  add column if not exists scale_status text not null default 'assumed'
  check (scale_status in ('assumed', 'estimated', 'auto', 'confirmed'));
