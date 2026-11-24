-- ============================================================
-- PostSwap — profiles + email notifications (run in SQL Editor)
-- ============================================================

-- Existing: public.swaps, public."messages (for DMs)"
alter table if exists public.swaps disable row level security;

-- Listing status for owner controls. Does not enable row level security.
-- open = on the public map and list. closed / archived = hidden from the public, kept for the owner.
alter table public.swaps
  add column if not exists status text not null default 'open';

alter table public.swaps drop constraint if exists swaps_status_check;
alter table public.swaps
  add constraint swaps_status_check
  check (status in ('open', 'closed', 'archived'));

-- Structured locations. Does not enable row level security and does not delete rows.
-- Run this block on its own. Do not re-run the whole file (the bottom enables message RLS).
alter table public.swaps add column if not exists current_city text;
alter table public.swaps add column if not exists current_state text;
alter table public.swaps add column if not exists current_zip text;
alter table public.swaps add column if not exists desired_city text;
alter table public.swaps add column if not exists desired_state text;
alter table public.swaps add column if not exists desired_zip text;
alter table public.swaps add column if not exists lat double precision;
alter table public.swaps add column if not exists lng double precision;

-- Messages RLS is enabled at the bottom of this file.
-- A user may read a row only when from_user or to_user is one of their identity keys.

-- ---------- Profiles (email + notification settings) ----------
create table if not exists public.profiles (
  id text primary key,
  name text not null,
  email text not null unique,
  craft text,
  station text,
  state text,
  initials text,
  employee_id text,
  -- { emailEnabled, onInterest, onStateSwap, onDm }
  notifications jsonb not null default '{
    "emailEnabled": true,
    "onInterest": true,
    "onStateSwap": true,
    "onDm": true
  }'::jsonb,
  -- Message ids this account has opened. Client also keeps a per-user local copy.
  dm_read_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles disable row level security;

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_state_idx on public.profiles (state);

-- ---------- Outbound email queue ----------
create table if not exists public.email_queue (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  to_user_id text,
  subject text not null,
  body text not null,
  event_type text not null, -- 'new_dm' | 'matching_swap' | 'interest'
  meta jsonb default '{}'::jsonb,
  status text not null default 'pending', -- pending | sent | failed | skipped
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.email_queue disable row level security;

create index if not exists email_queue_status_idx
  on public.email_queue (status, created_at);

-- Optional: allow reading own queued mail for debugging
comment on table public.email_queue is
  'PostSwap notification outbox. Process with Edge Function dispatch-emails or a cron job.';

-- ---------- Helper: default notifications if missing ----------
-- (client also sends full notifications object on save)

-- Per-account inbox read state (safe to re-run)
alter table public.profiles
  add column if not exists dm_read_ids jsonb not null default '[]'::jsonb;

-- ---------- Messages RLS ----------
-- The app signs in with its own profiles, not Supabase Auth, so auth.uid()
-- cannot name the participant. The client sends identity keys in the
-- x-postswap-keys header as UTF-8 base64 of values joined by "|".
-- The browser never requests this table without a from_user / to_user filter.
-- Run this block in the SQL editor to enforce it on the server.

create or replace function public.postswap_participant_keys()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text;
  decoded text;
begin
  raw := nullif(current_setting('request.headers', true), '')::json->>'x-postswap-keys';
  if raw is null or raw = '' then
    return array[]::text[];
  end if;
  decoded := convert_from(decode(raw, 'base64'), 'utf8');
  return string_to_array(decoded, '|');
exception when others then
  return array[]::text[];
end;
$$;

revoke all on function public.postswap_participant_keys() from public;
grant execute on function public.postswap_participant_keys() to anon, authenticated;

alter table if exists public."messages (for DMs)" enable row level security;

drop policy if exists "messages_select_anon" on public."messages (for DMs)";
drop policy if exists "messages_insert_anon" on public."messages (for DMs)";
drop policy if exists "messages_select_participant" on public."messages (for DMs)";
drop policy if exists "messages_insert_participant" on public."messages (for DMs)";

create policy "messages_select_participant"
  on public."messages (for DMs)"
  for select
  to anon, authenticated
  using (
    from_user = any (public.postswap_participant_keys())
    or to_user = any (public.postswap_participant_keys())
  );

create policy "messages_insert_participant"
  on public."messages (for DMs)"
  for insert
  to anon, authenticated
  with check (
    from_user = any (public.postswap_participant_keys())
  );
