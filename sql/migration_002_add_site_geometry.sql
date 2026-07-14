-- ============================================================
-- sql/migration_002_add_site_geometry.sql
--
-- Run this in Supabase's SQL Editor to add tower-centre coordinate
-- and bearing columns to the `sites` table you already created from
-- sql/schema.sql. Safe to run even if you're not ready to populate
-- these yet — they're nullable, so existing sites are unaffected.
-- ============================================================

alter table public.sites
  add column if not exists tower_centre_easting numeric,
  add column if not exists tower_centre_northing numeric,
  add column if not exists bearing_deg numeric;

-- Optional but recommended: keep bearing sane (0-360, or null if not
-- yet surveyed) at the database level, not just in the app.
-- NOTE: unlike ADD COLUMN above, Postgres doesn't support
-- "IF NOT EXISTS" for constraints — if you ever re-run this file and
-- it says the constraint already exists, that's fine, just skip that
-- one line and re-run the rest.
alter table public.sites
  add constraint bearing_deg_range
  check (bearing_deg is null or (bearing_deg >= 0 and bearing_deg < 360));
