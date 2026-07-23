create table public.member_payment_profiles (
  member_id uuid primary key references public.members(id) on delete cascade,
  paypay_id text,
  accepts_cash boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint member_payment_profiles_paypay_id check (
    paypay_id is null or paypay_id ~ '^[a-z][a-z0-9_]{2,14}$'
  ),
  constraint member_payment_profiles_method_required check (
    paypay_id is not null or accepts_cash
  )
);

create table public.settlement_payment_links (
  settlement_id uuid primary key references public.settlements(id) on delete cascade,
  created_by_member_id uuid not null references public.members(id) on delete cascade,
  paypay_request_url text not null,
  updated_at timestamptz not null default now(),
  constraint settlement_payment_links_url_length check (
    char_length(paypay_request_url) between 1 and 2048
  ),
  constraint settlement_payment_links_paypay_https check (
    paypay_request_url ~* '^https://([a-z0-9-]+\.)*paypay\.ne\.jp(/|$)'
  )
);

create trigger member_payment_profiles_set_updated_at
before update on public.member_payment_profiles
for each row execute function public.set_updated_at();

create trigger settlement_payment_links_set_updated_at
before update on public.settlement_payment_links
for each row execute function public.set_updated_at();

alter table public.member_payment_profiles enable row level security;
alter table public.settlement_payment_links enable row level security;

revoke all on public.member_payment_profiles from public, anon, authenticated;
revoke all on public.settlement_payment_links from public, anon, authenticated;

create function public.get_payment_state(
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
          v_actor.is_organizer
          or profile.member_id = v_actor.id
          or exists (
            select 1
            from public.settlements settlement
            where settlement.event_id = v_actor.event_id
              and settlement.from_member_id = v_actor.id
              and settlement.to_member_id = profile.member_id
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
        and (
          v_actor.is_organizer
          or settlement.from_member_id = v_actor.id
          or settlement.to_member_id = v_actor.id
        )
    ), '[]'::jsonb)
  );
end;
$$;

create function public.upsert_payment_profile(
  p_share_token text,
  p_device_token text,
  p_paypay_id text default null,
  p_accepts_cash boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_paypay_id text := nullif(btrim(p_paypay_id), '');
  v_profile public.member_payment_profiles;
begin
  if v_paypay_id is not null and v_paypay_id !~ '^[a-z][a-z0-9_]{2,14}$' then
    raise exception 'INVALID_PAYPAY_ID' using errcode = '22023';
  end if;
  if v_paypay_id is null and not p_accepts_cash then
    raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023';
  end if;

  insert into public.member_payment_profiles(member_id, paypay_id, accepts_cash)
  values (v_actor.id, v_paypay_id, p_accepts_cash)
  on conflict (member_id) do update
    set paypay_id = excluded.paypay_id,
        accepts_cash = excluded.accepts_cash
  returning * into v_profile;

  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'upsert_payment_profile',
    jsonb_build_object('hasPayPayId', v_profile.paypay_id is not null, 'acceptsCash', v_profile.accepts_cash)
  );

  return jsonb_build_object(
    'memberId', v_profile.member_id,
    'paypayId', v_profile.paypay_id,
    'acceptsCash', v_profile.accepts_cash
  );
end;
$$;

create function public.set_settlement_payment_link(
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
  where id = p_settlement_id and event_id = v_actor.event_id
  for update;

  if v_settlement.id is null or v_settlement.amount = 0 then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_settlement.to_member_id <> v_actor.id then
    raise exception 'RECEIVER_REQUIRED' using errcode = '42501';
  end if;

  if v_url is null then
    delete from public.settlement_payment_links where settlement_id = v_settlement.id;
  else
    if char_length(v_url) > 2048
      or v_url !~* '^https://([a-z0-9-]+\.)*paypay\.ne\.jp(/|$)'
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

grant execute on function public.get_payment_state(text, text) to anon, authenticated;
grant execute on function public.upsert_payment_profile(text, text, text, boolean) to anon, authenticated;
grant execute on function public.set_settlement_payment_link(text, text, uuid, text) to anon, authenticated;
