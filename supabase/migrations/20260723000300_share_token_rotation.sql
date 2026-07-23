create or replace function warikan_private.random_token(p_bytes integer default 32)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_bytes < 16 or p_bytes > 64 then
    raise exception 'INVALID_TOKEN_SIZE' using errcode = '22023';
  end if;
  return pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
end
$$;

create function public.organizer_regenerate_share_token(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_share_token text := warikan_private.random_token(32);
begin
  update public.events
  set share_token = v_share_token
  where id = v_event.id;

  perform warikan_private.write_log(v_event.id, null, 'regenerate_share_token');
  return public.get_event_state(v_share_token);
end
$$;

revoke all on function public.organizer_regenerate_share_token(uuid) from public, anon;
grant execute on function public.organizer_regenerate_share_token(uuid) to authenticated;
