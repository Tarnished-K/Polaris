create function public.get_event_state(p_share_token text, p_device_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_state jsonb := public.get_event_state(p_share_token);
  v_member_id uuid;
begin
  select m.id into v_member_id
  from public.events e
  join public.members m on m.event_id = e.id
  where e.share_token = p_share_token
    and (
      (m.is_organizer and e.organizer_user_id = (select auth.uid()))
      or (
        p_device_token is not null
        and char_length(p_device_token) >= 32
        and m.device_token_hash = warikan_private.hash_token(p_device_token)
      )
    )
  order by m.is_organizer desc
  limit 1;

  return v_state || jsonb_build_object('currentMemberId', v_member_id);
end;
$$;

grant execute on function public.get_event_state(text, text) to anon, authenticated;
