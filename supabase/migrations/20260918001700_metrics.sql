-- ISS-027 · 운영 지표
create or replace function public.usage_metrics(p_days integer default 14)
returns jsonb
language sql
stable
set search_path = public
as $$
  with runs as (
    select *, (created_at at time zone 'Asia/Seoul')::date as day
    from answer_runs
    where created_at >= now() - make_interval(days => greatest(1, least(p_days, 180)))
  ),
  daily as (
    select day,
      count(*) as requests,
      coalesce(sum(input_tokens), 0) as input_tokens,
      coalesce(sum(output_tokens), 0) as output_tokens,
      coalesce(sum(embedding_tokens), 0) as embedding_tokens,
      coalesce(sum(cost_usd), 0) as cost_usd,
      coalesce(percentile_cont(0.95) within group (order by latency_ms), 0) as p95,
      count(*) filter (where input_snapshot->>'searchStatus' = 'insufficient_evidence') as insufficient,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'fallback') as fallback
    from runs group by day
  )
  select jsonb_build_object(
    'days', p_days,
    'totals', (select jsonb_build_object(
      'requests', count(*),
      'inputTokens', coalesce(sum(input_tokens), 0),
      'outputTokens', coalesce(sum(output_tokens), 0),
      'embeddingTokens', coalesce(sum(embedding_tokens), 0),
      'costUsd', coalesce(sum(cost_usd), 0),
      'avgCostUsd', coalesce(avg(cost_usd), 0),
      'avgInputTokens', coalesce(avg(input_tokens), 0),
      'p50LatencyMs', coalesce(percentile_cont(0.5) within group (order by latency_ms), 0),
      'p95LatencyMs', coalesce(percentile_cont(0.95) within group (order by latency_ms), 0),
      'failed', count(*) filter (where status = 'failed'),
      'fallback', count(*) filter (where status = 'fallback'),
      'insufficientRate', coalesce(avg((input_snapshot->>'searchStatus' = 'insufficient_evidence')::int), 0),
      'openFeedback', (select count(*) from feedback where status in ('open', 'triaged'))
    ) from runs),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', day, 'requests', requests, 'inputTokens', input_tokens, 'outputTokens', output_tokens,
      'embeddingTokens', embedding_tokens, 'costUsd', cost_usd, 'p95LatencyMs', p95,
      'insufficient', insufficient, 'failed', failed, 'fallback', fallback) order by day desc) from daily), '[]'::jsonb),
    'errors', coalesce((select jsonb_object_agg(error_code, n) from (
      select error_code, count(*) n from runs where error_code is not null group by error_code) e), '{}'::jsonb),
    'models', coalesce((select jsonb_object_agg(model, n) from (
      select model, count(*) n from runs where model is not null group by model) m), '{}'::jsonb),
    'feedbackByCategory', coalesce((select jsonb_object_agg(category, n) from (
      select category, count(*) n from feedback group by category) f), '{}'::jsonb),
    'failedJobs', (select count(*) from ingestion_jobs where status = 'failed')
  );
$$;
revoke execute on function public.usage_metrics(integer) from public, anon, authenticated;
