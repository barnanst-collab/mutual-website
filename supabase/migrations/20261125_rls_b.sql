-- Part B. Enables row level security. Run only after part A and the new frontend are live.
-- Ids are text, so every auth check uses auth.uid()::text.
-- Guest swaps stay publicly readable (user_id = 'guest'), even when status is not open.
-- Open swaps stay publicly readable. Anon cannot insert, update, or delete.
-- This does not delete rows. Message rows with guest on either side become
-- invisible under the participant policy. They are not removed.
-- service_role bypasses row level security, so dispatch-emails can still
-- read and update email_queue.

-- ---------- Remove the old header-based message access ----------

drop policy if exists "messages_select_anon" on public."messages (for DMs)";
drop policy if exists "messages_insert_anon" on public."messages (for DMs)";
drop policy if exists "messages_select_participant" on public."messages (for DMs)";
drop policy if exists "messages_insert_participant" on public."messages (for DMs)";
drop policy if exists "messages_insert_sender" on public."messages (for DMs)";

drop function if exists public.postswap_participant_keys();

-- ---------- Swaps ----------

drop policy if exists "swaps_select_anon" on public.swaps;
drop policy if exists "swaps_insert_anon" on public.swaps;
drop policy if exists "swaps_update_anon" on public.swaps;
drop policy if exists "swaps_delete_anon" on public.swaps;
drop policy if exists "swaps_select_public" on public.swaps;
drop policy if exists "swaps_insert_owner" on public.swaps;
drop policy if exists "swaps_update_owner" on public.swaps;
drop policy if exists "swaps_delete_owner" on public.swaps;

alter table public.swaps enable row level security;

create policy "swaps_select_public"
  on public.swaps
  for select
  to anon, authenticated
  using (
    status = 'open'
    or user_id = 'guest'
    or user_id = auth.uid()::text
  );

create policy "swaps_insert_owner"
  on public.swaps
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "swaps_update_owner"
  on public.swaps
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "swaps_delete_owner"
  on public.swaps
  for delete
  to authenticated
  using (user_id = auth.uid()::text);

-- ---------- Profiles ----------

drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;

alter table public.profiles enable row level security;

create policy "profiles_select_self"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid()::text);

create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid()::text);

create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid()::text)
  with check (id = auth.uid()::text);

-- ---------- Messages ----------
-- Anon has no policy, so an anon select returns no rows.

alter table public."messages (for DMs)" enable row level security;

create policy "messages_select_participant"
  on public."messages (for DMs)"
  for select
  to authenticated
  using (
    from_user = auth.uid()::text
    or to_user = auth.uid()::text
  );

create policy "messages_insert_sender"
  on public."messages (for DMs)"
  for insert
  to authenticated
  with check (from_user = auth.uid()::text);

-- ---------- email_queue ----------
-- Members may read their own rows. They cannot insert, update, or delete.
-- service_role is not in this revoke.

drop policy if exists "email_queue_select_self" on public.email_queue;

alter table public.email_queue enable row level security;

create policy "email_queue_select_self"
  on public.email_queue
  for select
  to authenticated
  using (to_user_id = auth.uid()::text);

revoke insert, update, delete on public.email_queue from anon, authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.queue_notification(text, text, text, text, jsonb) from public, anon;
revoke all on function public.notify_matching_swap(text) from public, anon;

grant execute on function public.queue_notification(text, text, text, text, jsonb) to authenticated;
grant execute on function public.notify_matching_swap(text) to authenticated;
