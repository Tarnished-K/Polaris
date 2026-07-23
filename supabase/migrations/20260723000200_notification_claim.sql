create or replace function public.claim_notification_jobs(p_limit integer default 20)
returns table(
  id uuid,
  integration_id uuid,
  notification_type text,
  payload jsonb,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.notification_jobs j
    where j.status in ('pending', 'failed')
      and j.scheduled_for <= now()
    order by j.scheduled_for, j.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update public.notification_jobs j
    set status = 'processing', attempts = j.attempts + 1
    from candidates c
    where j.id = c.id
    returning j.id, j.integration_id, j.notification_type, j.payload, j.attempts, j.max_attempts
  )
  select * from claimed;
end;
$$;

revoke execute on function public.claim_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(integer) to service_role;
