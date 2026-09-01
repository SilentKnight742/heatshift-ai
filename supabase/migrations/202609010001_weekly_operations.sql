-- HeatShift AI weekly operations schema. Apply with the Supabase SQL editor or CLI.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  global_week_start date not null default date '2024-07-15',
  walkthrough_completed boolean not null default false,
  domain_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint historical_week check (global_week_start >= date '2019-01-01')
);

alter table public.workspaces
  add column if not exists domain_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  system_key text unique,
  name text not null,
  state_code char(2) not null,
  site_type text not null,
  geometry jsonb not null,
  centroid jsonb not null,
  timezone text not null,
  curated boolean not null default false,
  fictional_operation boolean not null default true,
  data_status text not null default 'unavailable',
  evidence_week_start date,
  source_label text not null,
  created_at timestamptz not null default now(),
  constraint system_or_owner check (
    (curated and owner_id is null and system_key is not null)
    or (not curated and owner_id is not null and system_key is null)
  )
);

create table if not exists public.site_days (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  observation_date date not null,
  heatmap jsonb not null,
  hourly_observations jsonb not null,
  derived_hourly_cells jsonb not null,
  satellite_context jsonb not null default '{}'::jsonb,
  provenance jsonb not null,
  integrity_sha256 char(64) not null,
  immutable boolean not null default false,
  unique(site_id, observation_date)
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  worker_count integer not null check (worker_count between 1 and 100),
  ppe text not null,
  acclimatization text not null,
  workload_default text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  location jsonb not null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 720 and duration_minutes % 30 = 0),
  workload text not null,
  original_start timestamptz not null,
  earliest_start timestamptz not null,
  latest_finish timestamptz not null,
  assigned_crew_id uuid not null references public.crews(id),
  eligible_crew_ids uuid[] not null,
  status text not null default 'pending',
  movable boolean not null default true,
  shaded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint valid_job_window check (earliest_start <= original_start and original_start < latest_finish),
  constraint valid_job_status check (status in ('pending','in_progress','completed','cancelled','deferred'))
);

create table if not exists public.job_dependencies (
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  depends_on_job_id uuid not null references public.jobs(id) on delete cascade,
  primary key(job_id, depends_on_job_id),
  constraint no_self_dependency check (job_id <> depends_on_job_id)
);

create table if not exists public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  week_start date not null,
  layer text not null check (layer in ('original','heatshift','working')),
  immutable boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id, site_id, week_start, layer)
);

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  schedule_version_id uuid not null references public.schedule_versions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  crew_id uuid not null references public.crews(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  screening_score integer not null check (screening_score between 0 and 100),
  unique(schedule_version_id, job_id),
  constraint positive_entry_duration check (ends_at > starts_at)
);

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  week_start date not null,
  deterministic_metrics jsonb not null,
  recommendations jsonb not null,
  limitations jsonb not null,
  policy_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  week_start date not null,
  idempotency_key text not null,
  request_hash char(64) not null,
  state text not null,
  activity_ids jsonb not null default '{}'::jsonb,
  completed_stages jsonb not null default '[]'::jsonb,
  reserved_credits integer not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key),
  unique(request_hash)
);

create table if not exists public.live_quota (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  provisioning_job_id uuid unique references public.provisioning_jobs(id),
  used_at timestamptz not null default now()
);

create table if not exists public.provider_credit_reservations (
  provisioning_job_id uuid primary key references public.provisioning_jobs(id) on delete cascade,
  credits integer not null check (credits > 0),
  released_at timestamptz
);

alter table public.workspaces enable row level security;
alter table public.sites enable row level security;
alter table public.site_days enable row level security;
alter table public.crews enable row level security;
alter table public.jobs enable row level security;
alter table public.job_dependencies enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.analyses enable row level security;
alter table public.provisioning_jobs enable row level security;
alter table public.live_quota enable row level security;
alter table public.provider_credit_reservations enable row level security;

drop policy if exists "workspace owner" on public.workspaces;
drop policy if exists "site owner or curated reader" on public.sites;
drop policy if exists "site owner writes" on public.sites;
drop policy if exists "site day owner or curated reader" on public.site_days;
drop policy if exists "private site day writes" on public.site_days;
create policy "workspace owner" on public.workspaces for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "site owner or curated reader" on public.sites for select using (owner_id = auth.uid() or curated);
create policy "site owner writes" on public.sites for all using (owner_id = auth.uid() and not curated) with check (owner_id = auth.uid() and not curated);
create policy "site day owner or curated reader" on public.site_days for select using (
  exists(select 1 from public.sites where sites.id = site_days.site_id and (sites.owner_id = auth.uid() or sites.curated))
);
create policy "private site day writes" on public.site_days for all using (
  exists(select 1 from public.sites where sites.id = site_days.site_id and sites.owner_id = auth.uid() and not site_days.immutable)
) with check (
  exists(select 1 from public.sites where sites.id = site_days.site_id and sites.owner_id = auth.uid())
);

drop policy if exists "owner isolation" on public.crews;
drop policy if exists "owner isolation" on public.jobs;
drop policy if exists "owner isolation" on public.job_dependencies;
drop policy if exists "owner isolation" on public.schedule_versions;
drop policy if exists "owner isolation" on public.schedule_entries;
drop policy if exists "owner isolation" on public.analyses;
drop policy if exists "owner isolation" on public.provisioning_jobs;
drop policy if exists "owner isolation" on public.live_quota;

create policy "owner isolation" on public.crews for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid() and not s.curated)
  );

create policy "owner isolation" on public.jobs for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid() and not s.curated)
    and exists(select 1 from public.crews c where c.id = assigned_crew_id and c.owner_id = auth.uid() and c.site_id = site_id)
    and not exists(
      select 1 from unnest(eligible_crew_ids) eligible_id
      where not exists(
        select 1 from public.crews c
        where c.id = eligible_id and c.owner_id = auth.uid() and c.site_id = site_id
      )
    )
  );

create policy "owner isolation" on public.job_dependencies for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(
      select 1 from public.jobs job
      join public.jobs prerequisite on prerequisite.id = depends_on_job_id
      where job.id = job_id
        and job.owner_id = auth.uid()
        and prerequisite.owner_id = auth.uid()
        and job.site_id = prerequisite.site_id
    )
  );

create policy "owner isolation" on public.schedule_versions for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid() and not s.curated)
  );

create policy "owner isolation" on public.schedule_entries for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(
      select 1 from public.schedule_versions version
      join public.jobs job on job.id = job_id and job.site_id = version.site_id
      join public.crews crew on crew.id = crew_id and crew.site_id = version.site_id
      where version.id = schedule_version_id
        and version.owner_id = auth.uid()
        and job.owner_id = auth.uid()
        and crew.owner_id = auth.uid()
    )
  );

create policy "owner isolation" on public.analyses for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid() and not s.curated)
  );

create policy "owner isolation" on public.provisioning_jobs for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists(select 1 from public.sites s where s.id = site_id and s.owner_id = auth.uid() and not s.curated)
  );

create policy "owner isolation" on public.live_quota for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (
      provisioning_job_id is null
      or exists(
        select 1 from public.provisioning_jobs job
        where job.id = provisioning_job_id and job.owner_id = auth.uid()
      )
    )
  );

-- Reservations contain global provider accounting and are never exposed directly
-- to anonymous clients. Only the server-side secret/service role may access them.
revoke all on public.provider_credit_reservations from anon, authenticated;

-- Server-only cross-instance guard used before any paid FortyGuard call. This
-- supplements the user-scoped provisioning snapshot with an atomic global lock.
create table if not exists public.heatshift_provider_reservations (
  reservation_key text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_hash char(64),
  credits integer not null check (credits > 0),
  released_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.heatshift_provider_reservations add column if not exists request_hash char(64);
create unique index if not exists one_heatshift_live_week_per_owner
  on public.heatshift_provider_reservations(owner_id);
create unique index if not exists one_active_heatshift_exact_request
  on public.heatshift_provider_reservations(request_hash) where request_hash is not null and released_at is null;
alter table public.heatshift_provider_reservations enable row level security;
revoke all on public.heatshift_provider_reservations from anon, authenticated;

create or replace function public.claim_heatshift_provider_reservation(
  p_owner_id uuid,
  p_reservation_key text,
  p_request_hash text,
  p_credits integer,
  p_provider_remaining integer,
  p_required_reserve integer
) returns text
language plpgsql security definer set search_path = public
as $$
declare outstanding bigint;
begin
  perform pg_advisory_xact_lock(hashtext('heatshift-provider-credit-reserve'));
  if exists(select 1 from public.heatshift_provider_reservations where reservation_key = p_reservation_key and owner_id = p_owner_id and released_at is null) then
    return 'existing';
  end if;
  if exists(select 1 from public.heatshift_provider_reservations where request_hash = p_request_hash and released_at is null) then
    return 'request_in_progress';
  end if;
  if exists(select 1 from public.heatshift_provider_reservations where owner_id = p_owner_id and reservation_key <> p_reservation_key) then
    return 'quota_used';
  end if;
  select coalesce(sum(credits), 0) into outstanding
    from public.heatshift_provider_reservations where released_at is null;
  if p_provider_remaining - outstanding - p_credits < p_required_reserve then
    return 'insufficient_credits';
  end if;
  insert into public.heatshift_provider_reservations(reservation_key, owner_id, request_hash, credits, released_at)
    values(p_reservation_key, p_owner_id, p_request_hash, p_credits, null)
  on conflict(reservation_key) do update
    set request_hash = excluded.request_hash, credits = excluded.credits, released_at = null;
  return 'reserved';
end;
$$;

create or replace function public.release_heatshift_provider_reservation(p_reservation_key text)
returns void
language sql security definer set search_path = public
as $$
  update public.heatshift_provider_reservations set released_at = coalesce(released_at, now())
    where reservation_key = p_reservation_key;
$$;

drop function if exists public.claim_heatshift_provider_reservation(uuid,text,integer,integer,integer);
revoke all on function public.claim_heatshift_provider_reservation(uuid,text,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.release_heatshift_provider_reservation(text) from public, anon, authenticated;
grant execute on function public.claim_heatshift_provider_reservation(uuid,text,text,integer,integer,integer) to service_role;
grant execute on function public.release_heatshift_provider_reservation(text) to service_role;

create table if not exists public.provider_request_cache (
  request_hash char(64) primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.provider_request_cache enable row level security;
revoke all on public.provider_request_cache from anon, authenticated;

create or replace function public.create_anonymous_workspace()
returns public.workspaces
language plpgsql security invoker set search_path = public
as $$
declare result public.workspaces;
begin
  insert into public.workspaces(owner_id) values(auth.uid())
  on conflict(owner_id) do nothing;
  select * into result from public.workspaces where owner_id = auth.uid();
  return result;
end;
$$;

grant execute on function public.create_anonymous_workspace() to authenticated;

-- New Supabase projects can disable "Automatically expose new tables". Keep
-- access explicit so the application does not depend on permissive project-wide
-- default grants. Anonymous visitors first sign in anonymously and therefore use
-- the authenticated role; the unauthenticated anon role receives no table access.
grant usage on schema public to authenticated, service_role;

revoke all on public.workspaces,
  public.sites,
  public.site_days,
  public.crews,
  public.jobs,
  public.job_dependencies,
  public.schedule_versions,
  public.schedule_entries,
  public.analyses,
  public.provisioning_jobs,
  public.live_quota,
  public.provider_credit_reservations,
  public.heatshift_provider_reservations,
  public.provider_request_cache
from anon;

grant select, insert, update, delete on public.workspaces,
  public.sites,
  public.site_days,
  public.crews,
  public.jobs,
  public.job_dependencies,
  public.schedule_versions,
  public.schedule_entries,
  public.analyses,
  public.provisioning_jobs,
  public.live_quota
to authenticated;

grant all on public.workspaces,
  public.sites,
  public.site_days,
  public.crews,
  public.jobs,
  public.job_dependencies,
  public.schedule_versions,
  public.schedule_entries,
  public.analyses,
  public.provisioning_jobs,
  public.live_quota,
  public.provider_credit_reservations,
  public.heatshift_provider_reservations,
  public.provider_request_cache
to service_role;
