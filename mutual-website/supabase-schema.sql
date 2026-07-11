-- PostSwap: ensure anon can read/write swaps + messages
-- Run in Supabase Dashboard → SQL Editor → Run
--
-- Existing tables:
--   public.swaps
--   public."messages (for DMs)"

-- 1) Turn RLS OFF (simplest for demo / anon key inserts)
alter table if exists public.swaps disable row level security;
alter table if exists public."messages (for DMs)" disable row level security;

-- 2) If you prefer RLS ON with open policies instead, use this block:
/*
alter table public.swaps enable row level security;
alter table public."messages (for DMs)" enable row level security;

drop policy if exists "swaps_select_anon" on public.swaps;
drop policy if exists "swaps_insert_anon" on public.swaps;
drop policy if exists "swaps_update_anon" on public.swaps;
drop policy if exists "messages_select_anon" on public."messages (for DMs)";
drop policy if exists "messages_insert_anon" on public."messages (for DMs)";

create policy "swaps_select_anon" on public.swaps for select to anon, authenticated using (true);
create policy "swaps_insert_anon" on public.swaps for insert to anon, authenticated with check (true);
create policy "swaps_update_anon" on public.swaps for update to anon, authenticated using (true) with check (true);

create policy "messages_select_anon" on public."messages (for DMs)" for select to anon, authenticated using (true);
create policy "messages_insert_anon" on public."messages (for DMs)" for insert to anon, authenticated with check (true);
*/

-- 3) Optional profiles table
create table if not exists public.profiles (
  id text primary key,
  name text not null,
  email text not null unique,
  craft text,
  station text,
  state text,
  initials text,
  employee_id text,
  notifications jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.profiles disable row level security;
