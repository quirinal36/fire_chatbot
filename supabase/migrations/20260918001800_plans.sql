-- 도면 저장 (도면 탭). 사용자가 올린 2D 도면과 편집한 벽 마스크·축척을 계정에 보관한다.
-- 파일 본체는 비공개 버킷 plans 에 두고 서버(secret 키)만 접근한다.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  wall_px integer not null check (wall_px between 1 and 256),
  px_per_meter double precision not null check (px_per_meter > 0),
  scale_fixed boolean not null default false,
  wall_height_m double precision not null default 2.7 check (wall_height_m > 0 and wall_height_m <= 20),
  image_path text not null,
  mask_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_owner_idx on public.plans (owner_id, updated_at desc);

-- 서버만 쓴다. 정책 없이 RLS 만 켜서 클라이언트 키로는 읽고 쓰지 못하게 한다.
alter table public.plans enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('plans', 'plans', false, 8388608)
on conflict (id) do nothing;
