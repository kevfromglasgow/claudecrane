-- ============================================================
-- sql/schema.sql
--
-- Paste this into Supabase's SQL Editor (New query) and click Run.
-- Creates the `sites` table matching lib/types.ts's TowerInstance,
-- with Row Level Security enabled so this is safe to query directly
-- from the browser using the public anon key (per Supabase's model:
-- RLS policies, not a hidden key, are what actually protect data).
--
-- Starting policy below is deliberately permissive (any signed-in
-- user can read/write any site) — fine for a small team sharing one
-- planning tool. Tighten later (e.g. scope by organisation/site
-- ownership) once more than one team uses this.
-- ============================================================

create table if not exists public.sites (
  site_id uuid primary key default gen_random_uuid(),
  label text not null,
  family_id text not null,
  variant_id text not null,
  leg_extension_delta_m numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sites enable row level security;

-- TEMPORARY, SIMPLE POLICY: allow anyone with your Supabase URL/anon
-- key to read and write sites — no login required. This is fine for
-- a small trusted team behind a private URL for now, since it gets
-- you a working shared backend today without also building a login
-- screen. NOT appropriate once this is used more widely — swap the
-- `to anon, authenticated` below for `to authenticated` (and add
-- Supabase Auth email/password sign-in) as soon as you want real
-- per-user access control.
create policy "sites_select_anon"
  on public.sites for select
  to anon, authenticated
  using (true);

create policy "sites_insert_anon"
  on public.sites for insert
  to anon, authenticated
  with check (true);

create policy "sites_update_anon"
  on public.sites for update
  to anon, authenticated
  using (true);

create policy "sites_delete_anon"
  on public.sites for delete
  to anon, authenticated
  using (true);

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();
