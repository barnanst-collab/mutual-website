-- ============================================================
-- PostSwap — profiles + email notifications (run in SQL Editor)
-- ============================================================

-- Existing: public.swaps, public."messages (for DMs)"
alter table if exists public.swaps disable row level security;
alter table if exists public."messages (for DMs)" disable row level security;

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
