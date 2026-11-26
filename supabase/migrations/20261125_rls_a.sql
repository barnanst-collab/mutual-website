-- Part A. Additive only. Does not enable row level security.
-- Run this before the frontend deploy. Do not run part B until the new
-- frontend is live and the map has loaded.
-- Ids are text. on conflict (id) do nothing so a migrated profile is not overwritten.
-- State is whatever the signup form sent. This does not default anyone to NV.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := coalesce(
    nullif(trim(meta->>'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Carrier'
  );
begin
  insert into public.profiles (
    id,
    name,
    email,
    craft,
    station,
    state,
    initials,
    employee_id
  )
  values (
    new.id::text,
    v_name,
    lower(trim(new.email)),
    nullif(meta->>'craft', ''),
    nullif(meta->>'station', ''),
    nullif(meta->>'state', ''),
    coalesce(nullif(meta->>'initials', ''), upper(left(v_name, 2))),
    nullif(meta->>'employee_id', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop view if exists public.profiles_public;
create view public.profiles_public
with (security_invoker = false) as
select id, name, initials, craft, station, state
from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- The caller cannot choose to_email. A new_dm is queued only after that
-- caller already has a message row to that person. auth.uid() is null for
-- the anon role, so an anon call raises and inserts nothing.

create or replace function public.queue_notification(
  p_to_user_id text,
  p_subject text,
  p_body text,
  p_event text,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_email text;
  v_notes jsonb;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_to_user_id is null
     or length(trim(p_to_user_id)) = 0
     or p_to_user_id = v_me
     or p_to_user_id = 'guest' then
    return jsonb_build_object('queued', 0, 'reason', 'no_recipient');
  end if;
  if p_event is distinct from 'new_dm' then
    raise exception 'unsupported event' using errcode = '22023';
  end if;
  if p_subject is null or length(p_subject) = 0 or length(p_subject) > 200
     or p_body is null or length(p_body) = 0 or length(p_body) > 8000 then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public."messages (for DMs)" m
    where m.from_user = v_me
      and m.to_user = p_to_user_id
  ) then
    return jsonb_build_object('queued', 0, 'reason', 'no_message');
  end if;

  select p.email, p.notifications
    into v_email, v_notes
  from public.profiles p
  where p.id = p_to_user_id;

  if nullif(trim(v_email), '') is null then
    return jsonb_build_object('queued', 0, 'reason', 'no_recipient');
  end if;
  if coalesce(v_notes->>'emailEnabled', 'true') = 'false'
     or coalesce(v_notes->>'onDm', 'true') = 'false' then
    return jsonb_build_object('queued', 0, 'reason', 'prefs');
  end if;

  insert into public.email_queue (
    to_email, to_user_id, subject, body, event_type, meta, status
  )
  values (
    v_email,
    p_to_user_id,
    p_subject,
    p_body,
    'new_dm',
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('from_user_id', v_me),
    'pending'
  )
  returning id into v_id;

  return jsonb_build_object('queued', 1, 'id', v_id);
end;
$$;

grant execute on function public.queue_notification(text, text, text, text, jsonb) to authenticated;

-- Returns a count only. The caller must own the swap.
-- Match rule: exact craft, and the profile state abbreviation or full name
-- appears in the listing text.

create or replace function public.notify_matching_swap(p_swap_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.uid()::text;
  v_current text;
  v_desired text;
  v_craft text;
  v_notes text;
  v_seniority text;
  v_owner text;
  v_hay text;
  v_route text;
  v_count integer := 0;
  r record;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_swap_id is null or length(p_swap_id) = 0 or length(p_swap_id) > 80 then
    return jsonb_build_object('queued', 0, 'reason', 'missing');
  end if;

  select
    s.current_location,
    s.desired_location,
    s.craft,
    s.notes,
    s.seniority::text,
    s.user_id
  into v_current, v_desired, v_craft, v_notes, v_seniority, v_owner
  from public.swaps s
  where s.id::text = p_swap_id;

  if v_owner is null then
    return jsonb_build_object('queued', 0, 'reason', 'missing');
  end if;
  if v_owner is distinct from v_me then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(trim(v_craft), '') is null then
    return jsonb_build_object('queued', 0, 'reason', 'no_swap_craft');
  end if;

  v_hay := upper(coalesce(v_current, '') || ' ' || coalesce(v_desired, ''));
  v_route := coalesce(v_current, '?') || ' → ' || coalesce(v_desired, '?');

  for r in
    select p.id, p.email, p.name, p.state, p.craft as profile_craft
    from public.profiles p
    join (
      values
        ('AL', 'ALABAMA'),
        ('AK', 'ALASKA'),
        ('AZ', 'ARIZONA'),
        ('AR', 'ARKANSAS'),
        ('CA', 'CALIFORNIA'),
        ('CO', 'COLORADO'),
        ('CT', 'CONNECTICUT'),
        ('DE', 'DELAWARE'),
        ('FL', 'FLORIDA'),
        ('GA', 'GEORGIA'),
        ('HI', 'HAWAII'),
        ('ID', 'IDAHO'),
        ('IL', 'ILLINOIS'),
        ('IN', 'INDIANA'),
        ('IA', 'IOWA'),
        ('KS', 'KANSAS'),
        ('KY', 'KENTUCKY'),
        ('LA', 'LOUISIANA'),
        ('ME', 'MAINE'),
        ('MD', 'MARYLAND'),
        ('MA', 'MASSACHUSETTS'),
        ('MI', 'MICHIGAN'),
        ('MN', 'MINNESOTA'),
        ('MS', 'MISSISSIPPI'),
        ('MO', 'MISSOURI'),
        ('MT', 'MONTANA'),
        ('NE', 'NEBRASKA'),
        ('NV', 'NEVADA'),
        ('NH', 'NEW HAMPSHIRE'),
        ('NJ', 'NEW JERSEY'),
        ('NM', 'NEW MEXICO'),
        ('NY', 'NEW YORK'),
        ('NC', 'NORTH CAROLINA'),
        ('ND', 'NORTH DAKOTA'),
        ('OH', 'OHIO'),
        ('OK', 'OKLAHOMA'),
        ('OR', 'OREGON'),
        ('PA', 'PENNSYLVANIA'),
        ('RI', 'RHODE ISLAND'),
        ('SC', 'SOUTH CAROLINA'),
        ('SD', 'SOUTH DAKOTA'),
        ('TN', 'TENNESSEE'),
        ('TX', 'TEXAS'),
        ('UT', 'UTAH'),
        ('VT', 'VERMONT'),
        ('VA', 'VIRGINIA'),
        ('WA', 'WASHINGTON'),
        ('WV', 'WEST VIRGINIA'),
        ('WI', 'WISCONSIN'),
        ('WY', 'WYOMING'),
        ('DC', 'DISTRICT OF COLUMBIA')
    ) as st(abbr, fullname)
      on upper(trim(p.state)) = st.abbr
    where p.id is distinct from v_me
      and nullif(trim(p.email), '') is not null
      and lower(trim(coalesce(p.craft, ''))) = lower(trim(v_craft))
      and coalesce(p.notifications->>'emailEnabled', 'true') <> 'false'
      and coalesce(p.notifications->>'onStateSwap', 'true') <> 'false'
      and (
        strpos(v_hay, st.abbr) > 0
        or strpos(v_hay, st.fullname) > 0
      )
      and not exists (
        select 1
        from public.email_queue q
        where q.event_type = 'matching_swap'
          and q.to_user_id = p.id
          and q.meta->>'swap_id' = p_swap_id
      )
  loop
    insert into public.email_queue (
      to_email, to_user_id, subject, body, event_type, meta, status
    )
    values (
      r.email,
      r.id,
      'New ' || v_craft || ' swap in ' || r.state,
      'Hi ' || coalesce(nullif(r.name, ''), 'Carrier') || E'\n\n'
        || 'A new mutual swap was posted in your state (' || r.state || ') for your craft:' || E'\n'
        || v_route || E'\n'
        || 'Craft: ' || v_craft || ' (exact match to your profile)' || E'\n'
        || 'Seniority: ' || coalesce(v_seniority, '—') || ' yrs' || E'\n'
        || case
             when nullif(v_notes, '') is not null then 'Note: ' || v_notes || E'\n'
             else ''
           end
        || E'\nBrowse Open Swaps on PostSwap to learn more or send a DM.\n\n— PostSwap\n'
        || 'You only get these when craft matches yours exactly. Turn off in Profile → Email notifications.',
      'matching_swap',
      jsonb_build_object(
        'swap_id', p_swap_id,
        'state', r.state,
        'craft', v_craft,
        'profile_craft', r.profile_craft,
        'craft_match', 'exact'
      ),
      'pending'
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('queued', v_count);
end;
$$;

grant execute on function public.notify_matching_swap(text) to authenticated;
