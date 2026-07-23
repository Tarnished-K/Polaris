create or replace function public.get_payment_state(
  p_share_token text,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
begin
  return jsonb_build_object(
    'currentMemberId', v_actor.id,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberId', profile.member_id,
        'paypayId', profile.paypay_id,
        'acceptsCash', profile.accepts_cash
      ) order by profile.member_id)
      from public.member_payment_profiles profile
      join public.members member on member.id = profile.member_id
      where member.event_id = v_actor.event_id
        and (
          profile.member_id = v_actor.id
          or exists (
            select 1
            from public.settlements settlement
            where settlement.event_id = v_actor.event_id
              and settlement.from_member_id = v_actor.id
              and settlement.to_member_id = profile.member_id
              and settlement.amount > 0
              and settlement.status in ('pending', 'reported')
          )
        )
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'settlementId', link.settlement_id,
        'paypayRequestUrl', link.paypay_request_url
      ) order by link.settlement_id)
      from public.settlement_payment_links link
      join public.settlements settlement on settlement.id = link.settlement_id
      where settlement.event_id = v_actor.event_id
        and settlement.amount > 0
        and settlement.status in ('pending', 'reported')
        and (
          settlement.from_member_id = v_actor.id
          or settlement.to_member_id = v_actor.id
        )
    ), '[]'::jsonb)
  );
end;
$$;

delete from public.settlement_payment_links
where paypay_request_url !~* '^https://(paypay\.ne\.jp|qr\.paypay\.ne\.jp)(/|$)';

alter table public.settlement_payment_links
  drop constraint settlement_payment_links_paypay_https;
alter table public.settlement_payment_links
  add constraint settlement_payment_links_paypay_https
  check (
    paypay_request_url ~* '^https://(paypay\.ne\.jp|qr\.paypay\.ne\.jp)(/|$)'
  );

create function public.delete_payment_profile(
  p_share_token text,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_deleted integer;
begin
  delete from public.member_payment_profiles
  where member_id = v_actor.id;
  get diagnostics v_deleted = row_count;

  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'delete_payment_profile',
    jsonb_build_object('removed', v_deleted = 1)
  );
end;
$$;

create or replace function public.set_settlement_payment_link(
  p_share_token text,
  p_device_token text,
  p_settlement_id uuid,
  p_paypay_request_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_url text := nullif(btrim(p_paypay_request_url), '');
begin
  select * into v_settlement
  from public.settlements
  where id = p_settlement_id
    and event_id = v_actor.event_id
    and amount > 0
    and status in ('pending', 'reported')
  for update;

  if v_settlement.id is null then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_settlement.to_member_id <> v_actor.id then
    raise exception 'RECEIVER_REQUIRED' using errcode = '42501';
  end if;

  if v_url is null then
    delete from public.settlement_payment_links where settlement_id = v_settlement.id;
  else
    if char_length(v_url) > 2048
      or v_url !~* '^https://(paypay\.ne\.jp|qr\.paypay\.ne\.jp)(/|$)'
    then
      raise exception 'INVALID_PAYPAY_REQUEST_URL' using errcode = '22023';
    end if;

    insert into public.settlement_payment_links(
      settlement_id,
      created_by_member_id,
      paypay_request_url
    )
    values (v_settlement.id, v_actor.id, v_url)
    on conflict (settlement_id) do update
      set created_by_member_id = excluded.created_by_member_id,
          paypay_request_url = excluded.paypay_request_url;
  end if;

  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'set_settlement_payment_link',
    jsonb_build_object('settlementId', v_settlement.id, 'configured', v_url is not null)
  );
end;
$$;

create function warikan_private.delete_paid_settlement_payment_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'paid' then
    delete from public.settlement_payment_links
    where settlement_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists settlements_delete_paid_payment_link on public.settlements;
create trigger settlements_delete_paid_payment_link
after update of status on public.settlements
for each row execute function warikan_private.delete_paid_settlement_payment_link();

delete from public.settlement_payment_links link
using public.settlements settlement
where settlement.id = link.settlement_id
  and settlement.status = 'paid';

create function public.purge_expired_payment_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_ids uuid[];
  v_deleted_profiles integer := 0;
  v_deleted_links integer := 0;
begin
  select array_agg(eligible.event_id order by eligible.event_id)
  into v_event_ids
  from (
    select event.id as event_id
    from public.events event
    where event.status = 'finalized'
      and (
        (
          exists (
            select 1
            from public.settlements settlement
            where settlement.event_id = event.id
              and settlement.amount > 0
          )
          and not exists (
            select 1
            from public.settlements settlement
            where settlement.event_id = event.id
              and settlement.amount > 0
              and (
                settlement.status <> 'paid'
                or settlement.confirmed_at is null
              )
          )
          and (
            select max(settlement.confirmed_at)
            from public.settlements settlement
            where settlement.event_id = event.id
              and settlement.amount > 0
          ) <= now() - interval '30 days'
        )
        or (
          not exists (
            select 1
            from public.settlements settlement
            where settlement.event_id = event.id
              and settlement.amount > 0
          )
          and event.finalized_at <= now() - interval '30 days'
        )
      )
  ) eligible;

  if coalesce(cardinality(v_event_ids), 0) = 0 then
    return jsonb_build_object('profilesDeleted', 0, 'linksDeleted', 0);
  end if;

  delete from public.settlement_payment_links link
  using public.settlements settlement
  where settlement.id = link.settlement_id
    and settlement.event_id = any(v_event_ids);
  get diagnostics v_deleted_links = row_count;

  delete from public.member_payment_profiles profile
  using public.members member
  where member.id = profile.member_id
    and member.event_id = any(v_event_ids);
  get diagnostics v_deleted_profiles = row_count;

  return jsonb_build_object(
    'profilesDeleted', v_deleted_profiles,
    'linksDeleted', v_deleted_links
  );
end;
$$;

create function public.organizer_delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform warikan_private.require_organizer(p_event_id);

  -- These rows hold RESTRICT references back to event members. Remove them in
  -- dependency order before the event-level cascades delete the members.
  delete from public.settlements where event_id = p_event_id;
  delete from public.expenses where event_id = p_event_id;
  delete from public.events where id = p_event_id;
end;
$$;

revoke execute on function warikan_private.delete_paid_settlement_payment_link()
  from public, anon, authenticated;

revoke execute on function public.get_payment_state(text, text)
  from public, anon, authenticated;
revoke execute on function public.upsert_payment_profile(text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.delete_payment_profile(text, text)
  from public, anon, authenticated;
revoke execute on function public.set_settlement_payment_link(text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.purge_expired_payment_data()
  from public, anon, authenticated;
revoke execute on function public.organizer_delete_event(uuid)
  from public, anon, authenticated;

grant execute on function public.get_payment_state(text, text)
  to anon, authenticated;
grant execute on function public.upsert_payment_profile(text, text, text, boolean)
  to anon, authenticated;
grant execute on function public.delete_payment_profile(text, text)
  to anon, authenticated;
grant execute on function public.set_settlement_payment_link(text, text, uuid, text)
  to anon, authenticated;
grant execute on function public.purge_expired_payment_data()
  to service_role, postgres;
grant execute on function public.organizer_delete_event(uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
    execute $schedule$
      select cron.schedule(
        'purge-expired-payment-data',
        '17 3 * * *',
        'select public.purge_expired_payment_data();'
      )
    $schedule$;
  end if;
end;
$$;
