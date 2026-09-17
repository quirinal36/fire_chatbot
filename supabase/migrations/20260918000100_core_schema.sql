-- ISS-005 · 핵심 스키마 (기획서 §5)
--
-- 원칙
-- - UUID 내부 키와 원천 문자열 ID 를 분리한다. 법령ID 와 법령일련번호(MST)를 섞지 않는다.
-- - 일반 사용자 요청은 서버(secret 키)가 처리한다. 브라우저 역할(anon·authenticated)은
--   게시된 공개 법령만 읽을 수 있고 운영 테이블에는 권한이 없다.
-- - secret 키는 RLS 를 우회하므로 서버 코드가 소유권·관리자 검사를 한다.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 법령 corpus
-- ---------------------------------------------------------------------------

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('law', 'admrul', 'interpretation', 'internal')),
  -- law: 법령ID, admrul: 행정규칙ID, interpretation: 해석례일련번호, internal: 내부 식별자
  source_document_id text not null,
  title text not null,
  issuer text,
  document_kind text not null,
  -- NFPC 103 · NFTC 103 같은 정확 일치 검색용 코드
  code text,
  created_at timestamptz not null default now(),
  unique (source_type, source_document_id)
);

create table public.legal_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents (id) on delete restrict,
  -- law: 법령일련번호(MST), admrul: 행정규칙일련번호, internal: 파일 content hash
  source_version_id text not null,
  effective_date date,
  promulgated_at date,
  version_status text not null default 'current'
    check (version_status in ('current', 'scheduled', 'historical')),
  -- 인증값이 담긴 링크를 저장하지 않는다 (ISS-003 발견 1)
  source_url text check (source_url is null or source_url !~* '[?&]oc='),
  raw_path text,
  content_hash text not null,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'needs_review', 'approved', 'published', 'rejected', 'superseded')),
  fetched_at timestamptz not null default now(),
  published_at timestamptz,
  unique nulls not distinct (document_id, source_version_id, effective_date)
);
create index legal_versions_document_idx on public.legal_versions (document_id, effective_date desc);

create table public.legal_units (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.legal_versions (id) on delete cascade,
  unit_type text not null check (unit_type in (
    'chapter', 'article', 'paragraph', 'item', 'subitem',
    'appendix', 'appendix_section', 'addendum', 'interpretation_part', 'file_section'
  )),
  -- 버전 안에서 고유한 위치. 예: 제11조, 제11조제1항제2호, 별표4, 별표4/1.가, 부칙<2024.5.7>
  locator text not null,
  parent_unit_id uuid references public.legal_units (id) on delete cascade,
  ordinal integer not null default 0,
  heading text,
  text text not null default '',
  attachment_path text,
  parse_status text not null default 'ok' check (parse_status in ('ok', 'needs_review')),
  parse_notes text,
  unique (version_id, locator)
);
create index legal_units_parent_idx on public.legal_units (parent_unit_id);

create table public.search_chunks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.legal_units (id) on delete cascade,
  -- 상위 제목·조건·비고를 앞에 붙인 검색용 본문
  context_text text not null,
  chunk_hash text not null,
  embedding_model text,
  embedding_revision text,
  embedding extensions.vector(1536),
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  -- 내부 자료의 외부 모델 전송 허용 여부. 공개 법령은 true
  transfer_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (unit_id, chunk_hash),
  check ((embedding is null) = (embedding_model is null))
);
create index search_chunks_trgm_idx on public.search_chunks using gin (context_text extensions.gin_trgm_ops);
create index search_chunks_embedding_idx on public.search_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.legal_relations (
  id uuid primary key default gen_random_uuid(),
  from_unit_id uuid not null references public.legal_units (id) on delete cascade,
  to_document_id uuid references public.legal_documents (id) on delete cascade,
  to_unit_id uuid references public.legal_units (id) on delete cascade,
  relation_type text not null check (relation_type in ('cites', 'delegates', 'exception_of', 'annex_of', 'interprets')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  check (to_document_id is not null or to_unit_id is not null)
);

-- 소방청 해석·내부 자료의 출처와 두 가지 승인 (기획서 §9)
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents (id) on delete cascade,
  classification text not null,
  origin text not null,
  file_path text,
  revision_hash text not null,
  -- 공개 승인: 검색 결과·근거 카드에 노출해도 되는가
  disclosure text not null default 'private' check (disclosure in ('private', 'public')),
  disclosure_approved_by uuid,
  disclosure_approved_at timestamptz,
  -- 전송 승인: 외부 모델 API 로 본문을 보내도 되는가
  transfer_allowed boolean not null default false,
  transfer_approved_by uuid,
  transfer_approved_at timestamptz,
  selected_by_reviewer boolean not null default false,
  created_at timestamptz not null default now(),
  unique (document_id, revision_hash),
  check (disclosure = 'private' or disclosure_approved_at is not null),
  check (not transfer_allowed or transfer_approved_at is not null)
);

-- ---------------------------------------------------------------------------
-- 규칙
-- ---------------------------------------------------------------------------

create table public.rule_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'approved', 'published', 'needs_review', 'retired')),
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  unique (code, version),
  check (status not in ('approved', 'published') or approved_at is not null)
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.rule_sets (id) on delete cascade,
  rule_key text not null,
  facility text not null,
  required_inputs text[] not null default '{}',
  definition jsonb not null,
  explanation_template text not null,
  unique (rule_set_id, rule_key)
);

create table public.rule_sources (
  rule_id uuid not null references public.rules (id) on delete cascade,
  legal_unit_id uuid not null references public.legal_units (id) on delete restrict,
  role text not null check (role in ('basis', 'exception', 'definition', 'transition')),
  primary key (rule_id, legal_unit_id, role)
);

-- ---------------------------------------------------------------------------
-- 세션·대화·답변
-- ---------------------------------------------------------------------------

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'reviewer')),
  created_at timestamptz not null default now()
);

create table public.building_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- { field: { value, unit, state: unknown|extracted|user_confirmed, sourceMessageId } }
  fields jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index building_cases_owner_idx on public.building_cases (owner_id);

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '새 대화',
  case_id uuid references public.building_cases (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_sessions_owner_idx on public.chat_sessions (owner_id, updated_at desc);

create table public.answer_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'fallback', 'failed')),
  model text,
  prompt_version text not null,
  rule_set_version text,
  corpus_version text not null,
  source_unit_ids uuid[] not null default '{}',
  input_snapshot jsonb not null,
  case_id uuid references public.building_cases (id) on delete set null,
  case_revision integer,
  input_tokens integer,
  output_tokens integer,
  embedding_tokens integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  attempts integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index answer_runs_created_idx on public.answer_runs (created_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  client_request_id text,
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  answer_run_id uuid references public.answer_runs (id) on delete set null,
  reply_to uuid references public.chat_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 같은 세션의 재전송·동시 요청을 하나로 묶는다 (ISS-013)
  unique (session_id, client_request_id)
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- 운영
-- ---------------------------------------------------------------------------

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  stage text not null default 'queued',
  cursor jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  result jsonb,
  -- 같은 작업의 중복 등록 방지
  dedupe_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ingestion_jobs_dedupe_idx on public.ingestion_jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
create index ingestion_jobs_ready_idx on public.ingestion_jobs (next_run_at) where status in ('queued', 'running');

create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('legal_version', 'legal_unit', 'rule_set', 'source_file', 'feedback')),
  subject_id uuid not null,
  action text not null check (action in ('approve', 'reject', 'request_changes', 'invalidate', 'publish', 'resolve')),
  reviewer_id uuid,
  reviewer_label text,
  reason text,
  target_version text,
  created_at timestamptz not null default now()
);
create index review_events_subject_idx on public.review_events (subject_type, subject_id, created_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  answer_run_id uuid references public.answer_runs (id) on delete set null,
  category text not null check (category in ('wrong_law', 'wrong_conclusion', 'missing_source', 'outdated', 'other')),
  comment text check (char_length(comment) <= 2000),
  status text not null default 'open' check (status in ('open', 'triaged', 'resolved', 'dismissed')),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index feedback_status_idx on public.feedback (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'legal_documents', 'legal_versions', 'legal_units', 'search_chunks', 'legal_relations',
    'source_files', 'rule_sets', 'rules', 'rule_sources', 'admin_users', 'building_cases',
    'chat_sessions', 'answer_runs', 'chat_messages', 'ingestion_jobs', 'review_events', 'feedback'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 공개 corpus 는 게시된 공개 법령만 읽기 허용
grant select on public.legal_documents, public.legal_versions, public.legal_units to anon, authenticated;

create policy legal_versions_published_read on public.legal_versions
  for select to anon, authenticated
  using (review_status = 'published');

create policy legal_documents_published_read on public.legal_documents
  for select to anon, authenticated
  using (
    source_type <> 'internal'
    and exists (select 1 from public.legal_versions v where v.document_id = id and v.review_status = 'published')
  );

create policy legal_units_published_read on public.legal_units
  for select to anon, authenticated
  using (exists (
    select 1 from public.legal_versions v
    join public.legal_documents d on d.id = v.document_id
    where v.id = version_id and v.review_status = 'published' and d.source_type <> 'internal'
  ));

-- 원문 보관 버킷. 비공개이며 서버만 접근한다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('raw-sources', 'raw-sources', false, 20971520)
on conflict (id) do nothing;
