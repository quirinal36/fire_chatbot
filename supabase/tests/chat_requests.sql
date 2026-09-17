-- ISS-013 중복 요청·소유권 검증. 롤백한다.
-- 실행: node scripts/db-migrate.mjs --file supabase/tests/chat_requests.sql
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid');
do $$
declare r jsonb; m uuid;
begin
  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-1', '질문');
  if r->>'state' <> 'new' then raise exception 'FAIL new: %', r; end if;
  m := (r->>'message_id')::uuid;

  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-1', '질문');
  if r->>'state' <> 'in_progress' then raise exception 'FAIL in_progress: %', r; end if;

  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-1', '다른 질문');
  if r->>'state' <> 'conflict' then raise exception 'FAIL conflict: %', r; end if;

  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000bbbb', 'req-2', '남의 세션');
  if r->>'state' <> 'forbidden' then raise exception 'FAIL forbidden: %', r; end if;

  perform finish_chat_request(m, 'succeeded', '{"status":"answered"}'::jsonb,
    '{"status":"succeeded","prompt_version":"p","corpus_version":"c","input_snapshot":{}}'::jsonb);
  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-1', '질문');
  if r->>'state' <> 'completed' or r->>'reply_id' is null then raise exception 'FAIL completed: %', r; end if;

  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-3', '실패할 질문');
  perform finish_chat_request((r->>'message_id')::uuid, 'failed', null,
    '{"status":"failed","prompt_version":"p","corpus_version":"c","input_snapshot":{},"error_code":"x"}'::jsonb);
  r := begin_chat_request('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aaaa', 'req-3', '실패할 질문');
  if r->>'state' <> 'retry' then raise exception 'FAIL retry: %', r; end if;

  if not consume_request_quota('test-scope', 2) or not consume_request_quota('test-scope', 2) then raise exception 'FAIL quota under'; end if;
  if consume_request_quota('test-scope', 2) then raise exception 'FAIL quota over'; end if;
end $$;
select 'PASS' as result;
rollback;
