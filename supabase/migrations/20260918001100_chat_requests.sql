-- ISS-013 · ISS-015 · ISS-026 · 채팅 요청의 중복 방지, 결과 기록, 사용량 한도

-- 처리 중(pending) 요청이 이 시간보다 오래되면 중단된 것으로 보고 다시 처리한다
create or replace function private.chat_stale_after() returns interval language sql immutable as $$ select interval '3 minutes' $$;

create or replace function public.begin_chat_request(
  p_session_id uuid,
  p_owner uuid,
  p_client_request_id text,
  p_question text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_msg record;
  v_reply uuid;
begin
  insert into chat_sessions (id, owner_id, title)
  values (p_session_id, p_owner, left(regexp_replace(p_question, '\s+', ' ', 'g'), 40))
  on conflict (id) do nothing;

  select owner_id into v_owner from chat_sessions where id = p_session_id;
  if v_owner is distinct from p_owner then
    return jsonb_build_object('state', 'forbidden');
  end if;

  insert into chat_messages (session_id, role, content, client_request_id, status)
  values (p_session_id, 'user', jsonb_build_object('text', p_question), p_client_request_id, 'pending')
  on conflict (session_id, client_request_id) do nothing
  returning id, status into v_msg;

  if v_msg.id is not null then
    return jsonb_build_object('state', 'new', 'message_id', v_msg.id);
  end if;

  -- 같은 요청 번호로 다시 온 요청
  select id, status, content, created_at into v_msg
  from chat_messages
  where session_id = p_session_id and client_request_id = p_client_request_id
  for update;

  if v_msg.content->>'text' is distinct from p_question then
    return jsonb_build_object('state', 'conflict', 'message_id', v_msg.id);
  end if;

  if v_msg.status = 'completed' then
    select id into v_reply from chat_messages where reply_to = v_msg.id and role = 'assistant' order by created_at desc limit 1;
    return jsonb_build_object('state', 'completed', 'message_id', v_msg.id, 'reply_id', v_reply);
  end if;

  if v_msg.status = 'failed' or v_msg.created_at < now() - private.chat_stale_after() then
    update chat_messages set status = 'pending', created_at = now() where id = v_msg.id;
    return jsonb_build_object('state', 'retry', 'message_id', v_msg.id);
  end if;

  return jsonb_build_object('state', 'in_progress', 'message_id', v_msg.id);
end;
$$;

create or replace function public.finish_chat_request(
  p_message_id uuid,
  p_status text,
  p_envelope jsonb,
  p_run jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_session uuid;
  v_run uuid;
  v_reply uuid;
begin
  select session_id into v_session from chat_messages where id = p_message_id and role = 'user' for update;
  if v_session is null then raise exception '요청 메시지 없음'; end if;

  insert into answer_runs (
    session_id, status, model, prompt_version, rule_set_version, corpus_version, source_unit_ids,
    input_snapshot, case_id, case_revision, input_tokens, output_tokens, embedding_tokens,
    cost_usd, latency_ms, attempts, error_code, finished_at
  )
  select v_session, r.status, r.model, r.prompt_version, r.rule_set_version, r.corpus_version,
         coalesce(r.source_unit_ids, '{}'), r.input_snapshot, r.case_id, r.case_revision,
         r.input_tokens, r.output_tokens, r.embedding_tokens, r.cost_usd, r.latency_ms, coalesce(r.attempts, 0),
         r.error_code, now()
  from jsonb_to_record(p_run) as r(
    status text, model text, prompt_version text, rule_set_version text, corpus_version text,
    source_unit_ids uuid[], input_snapshot jsonb, case_id uuid, case_revision integer,
    input_tokens integer, output_tokens integer, embedding_tokens integer, cost_usd numeric,
    latency_ms integer, attempts integer, error_code text)
  returning id into v_run;

  if p_envelope is not null then
    insert into chat_messages (session_id, role, content, status, answer_run_id, reply_to)
    values (v_session, 'assistant', p_envelope, 'completed', v_run, p_message_id)
    returning id into v_reply;
  end if;

  update chat_messages
  set status = case when p_status = 'failed' then 'failed' else 'completed' end,
      answer_run_id = v_run
  where id = p_message_id;
  update chat_sessions set updated_at = now() where id = v_session;
  return v_reply;
end;
$$;

-- 게시된 corpus 의 식별값. 게시·개정이 바뀌면 달라진다
create or replace function public.corpus_version()
returns text
language sql
stable
set search_path = public
as $$
  select 'c-' || left(md5(coalesce(string_agg(id::text || ':' || coalesce(published_at::text, ''), ',' order by id), '')), 12)
  from legal_versions where review_status = 'published';
$$;

-- 사용량 한도 (ISS-026). 한도 검사와 증가를 한 문장으로 처리해 동시 요청에서도 넘지 않는다.
create table public.usage_counters (
  scope text not null,
  day date not null,
  requests integer not null default 0,
  primary key (scope, day)
);
alter table public.usage_counters enable row level security;
revoke all on public.usage_counters from anon, authenticated;

create or replace function public.consume_request_quota(p_scope text, p_limit integer)
returns boolean
language sql
set search_path = public
as $$
  with day as (select (now() at time zone 'Asia/Seoul')::date as d),
  upsert as (
    insert into usage_counters (scope, day, requests)
    select p_scope, d, 1 from day
    on conflict (scope, day) do update
      set requests = usage_counters.requests + 1
      where usage_counters.requests < p_limit
    returning requests
  )
  select exists (select 1 from upsert);
$$;

-- 오늘(서울 기준) 모델·임베딩 비용 합계
create or replace function public.spent_today_usd()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from answer_runs
  where created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
$$;

create or replace function public.is_admin(p_user uuid, p_roles text[] default array['admin', 'reviewer'])
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from admin_users where user_id = p_user and role = any (p_roles));
$$;

revoke execute on function public.begin_chat_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_chat_request(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.corpus_version() from public, anon, authenticated;
revoke execute on function public.consume_request_quota(text, integer) from public, anon, authenticated;
revoke execute on function public.spent_today_usd() from public, anon, authenticated;
revoke execute on function public.is_admin(uuid, text[]) from public, anon, authenticated;
