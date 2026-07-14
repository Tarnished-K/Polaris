create extension if not exists pgcrypto with schema extensions;

create type public.event_type as enum ('single_day', 'overnight');
create type public.event_status as enum ('active', 'finalized');
create type public.expense_category as enum ('lodging', 'transport', 'food', 'activity', 'shopping', 'other');
create type public.split_method as enum ('equal', 'fixed');
create type public.expense_status as enum ('draft', 'finalized');
create type public.settlement_status as enum ('pending', 'reported', 'paid');
create type public.settlement_item_direction as enum ('charge', 'offset');
create type public.integration_provider as enum ('line', 'discord');
create type public.integration_status as enum ('pending', 'active', 'disabled', 'error');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  share_token text unique not null check (char_length(share_token) >= 22),
  organizer_user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  event_type public.event_type not null,
  start_date date not null,
  end_date date not null,
  capacity integer not null check (capacity between 2 and 50),
  status public.event_status not null default 'active',
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_date_range check (end_date >= start_date),
  constraint events_single_day_range check (event_type <> 'single_day' or end_date = start_date),
  constraint events_finalized_at check ((status = 'finalized') = (finalized_at is not null))
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  device_token_hash text,
  is_organizer boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, device_token_hash),
  constraint members_claim_state check ((device_token_hash is null) = (claimed_at is null))
);

create unique index members_one_organizer_per_event on public.members(event_id) where is_organizer;

create table public.member_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_claim_tokens_expiry check (expires_at > created_at)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category public.expense_category not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  amount integer not null check (amount > 0),
  payer_member_id uuid not null references public.members(id) on delete restrict,
  split_method public.split_method not null default 'equal',
  status public.expense_status not null default 'finalized',
  day_index integer check (day_index is null or day_index >= 1),
  created_by_member_id uuid not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expense_targets (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  fixed_amount integer check (fixed_amount is null or fixed_amount >= 0),
  primary key (expense_id, member_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_member_id uuid not null references public.members(id) on delete restrict,
  to_member_id uuid not null references public.members(id) on delete restrict,
  amount integer not null check (amount >= 0),
  gross_amount integer not null check (gross_amount >= 0),
  offset_amount integer not null check (offset_amount >= 0),
  status public.settlement_status not null default 'pending',
  reported_at timestamptz,
  reported_by_member_id uuid references public.members(id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by_member_id uuid references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, from_member_id, to_member_id),
  constraint settlements_members_differ check (from_member_id <> to_member_id),
  constraint settlements_amount_equation check (amount = gross_amount - offset_amount),
  constraint settlements_direction check (gross_amount >= offset_amount)
);

create table public.settlement_items (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete restrict,
  direction public.settlement_item_direction not null,
  amount integer not null check (amount > 0),
  primary key (settlement_id, expense_id, direction)
);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.event_integrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  provider public.integration_provider not null,
  external_space_id text not null,
  external_space_name text,
  installation_id text,
  status public.integration_status not null default 'pending',
  config jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_space_id),
  unique (event_id, provider)
);

create table public.member_external_accounts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  provider public.integration_provider not null,
  external_user_id text not null,
  display_name text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, external_user_id),
  unique (member_id, provider)
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  integration_id uuid references public.event_integrations(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  notification_type text not null check (char_length(notification_type) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  status public.notification_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  dedupe_key text,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notification_jobs_dedupe on public.notification_jobs(event_id, dedupe_key) where dedupe_key is not null;
create index notification_jobs_dispatch on public.notification_jobs(status, scheduled_for) where status in ('pending', 'failed');

create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.notification_jobs(id) on delete cascade,
  provider public.integration_provider,
  attempt integer not null check (attempt >= 1),
  status public.notification_status not null,
  provider_message_id text,
  response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (job_id, attempt)
);

create index members_event_id_idx on public.members(event_id);
create index expenses_event_id_idx on public.expenses(event_id, created_at);
create index expense_targets_member_id_idx on public.expense_targets(member_id);
create index settlements_event_id_idx on public.settlements(event_id);
create index activity_logs_event_id_idx on public.activity_logs(event_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_updated_at();
create trigger event_integrations_set_updated_at before update on public.event_integrations for each row execute function public.set_updated_at();
create trigger notification_jobs_set_updated_at before update on public.notification_jobs for each row execute function public.set_updated_at();

alter table public.events enable row level security;
alter table public.members enable row level security;
alter table public.member_claim_tokens enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_targets enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_items enable row level security;
alter table public.activity_logs enable row level security;
alter table public.event_integrations enable row level security;
alter table public.member_external_accounts enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.notification_deliveries enable row level security;

create policy events_organizer_all on public.events for all to authenticated
using (organizer_user_id = (select auth.uid()))
with check (organizer_user_id = (select auth.uid()));

create policy members_organizer_all on public.members for all to authenticated
using (exists (select 1 from public.events e where e.id = members.event_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.events e where e.id = members.event_id and e.organizer_user_id = (select auth.uid())));

create policy expenses_organizer_all on public.expenses for all to authenticated
using (exists (select 1 from public.events e where e.id = expenses.event_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.events e where e.id = expenses.event_id and e.organizer_user_id = (select auth.uid())));

create policy expense_targets_organizer_all on public.expense_targets for all to authenticated
using (exists (select 1 from public.expenses x join public.events e on e.id = x.event_id where x.id = expense_targets.expense_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.expenses x join public.events e on e.id = x.event_id where x.id = expense_targets.expense_id and e.organizer_user_id = (select auth.uid())));

create policy settlements_organizer_all on public.settlements for all to authenticated
using (exists (select 1 from public.events e where e.id = settlements.event_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.events e where e.id = settlements.event_id and e.organizer_user_id = (select auth.uid())));

create policy settlement_items_organizer_all on public.settlement_items for all to authenticated
using (exists (select 1 from public.settlements s join public.events e on e.id = s.event_id where s.id = settlement_items.settlement_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.settlements s join public.events e on e.id = s.event_id where s.id = settlement_items.settlement_id and e.organizer_user_id = (select auth.uid())));

create policy activity_logs_organizer_select on public.activity_logs for select to authenticated
using (exists (select 1 from public.events e where e.id = activity_logs.event_id and e.organizer_user_id = (select auth.uid())));

create policy event_integrations_organizer_all on public.event_integrations for all to authenticated
using (exists (select 1 from public.events e where e.id = event_integrations.event_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.events e where e.id = event_integrations.event_id and e.organizer_user_id = (select auth.uid())));

create policy member_external_accounts_organizer_all on public.member_external_accounts for all to authenticated
using (exists (select 1 from public.members m join public.events e on e.id = m.event_id where m.id = member_external_accounts.member_id and e.organizer_user_id = (select auth.uid())))
with check (exists (select 1 from public.members m join public.events e on e.id = m.event_id where m.id = member_external_accounts.member_id and e.organizer_user_id = (select auth.uid())));

create policy notification_jobs_organizer_select on public.notification_jobs for select to authenticated
using (exists (select 1 from public.events e where e.id = notification_jobs.event_id and e.organizer_user_id = (select auth.uid())));

create policy notification_deliveries_organizer_select on public.notification_deliveries for select to authenticated
using (exists (select 1 from public.notification_jobs j join public.events e on e.id = j.event_id where j.id = notification_deliveries.job_id and e.organizer_user_id = (select auth.uid())));

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on public.events, public.members, public.expenses, public.expense_targets, public.settlements, public.settlement_items, public.event_integrations, public.member_external_accounts to authenticated;
grant select on public.activity_logs, public.notification_jobs, public.notification_deliveries to authenticated;

comment on table public.notification_jobs is 'Transactional outbox for LINE, Discord, web push, and future notification adapters.';
comment on column public.notification_jobs.dedupe_key is 'Stable event-scoped key preventing duplicate reminders or invitations.';
