create or replace function warikan_private.next_member_name(p_event_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := btrim(p_name);
  v_name text := btrim(p_name);
  v_suffix integer := 1;
begin
  if char_length(v_base) not between 1 and 50 then
    raise exception 'INVALID_MEMBER_NAME' using errcode = '22023';
  end if;

  while exists (
    select 1
    from public.members
    where event_id = p_event_id
      and name = v_name
  ) loop
    v_name := v_base || '(' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;

  return v_name;
end;
$$;
