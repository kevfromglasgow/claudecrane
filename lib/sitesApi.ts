// ============================================================
// lib/sitesApi.ts
//
// Typed CRUD over Supabase's `sites` table (see sql/schema.sql +
// sql/migration_002_add_site_geometry.sql), converting between
// Postgres's snake_case columns and the app's TowerInstance shape.
// Kept separate from lib/calculations/* since this does real I/O —
// calculations stay pure/testable, this doesn't.
// ============================================================

import { getSupabase } from './supabaseClient';
import type { TowerInstance } from './types';

interface SiteRow {
  site_id: string;
  label: string;
  family_id: string;
  variant_id: string;
  leg_extension_delta_m: number;
  tower_centre_easting: number | null;
  tower_centre_northing: number | null;
  bearing_deg: number | null;
  notes: string | null;
}

function rowToTowerInstance(row: SiteRow): TowerInstance {
  return {
    siteId: row.site_id,
    label: row.label,
    familyId: row.family_id,
    variantId: row.variant_id,
    legExtensionDeltaM: row.leg_extension_delta_m,
    towerCentreEasting: row.tower_centre_easting ?? undefined,
    towerCentreNorthing: row.tower_centre_northing ?? undefined,
    bearingDeg: row.bearing_deg ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function towerInstanceToRow(input: Omit<TowerInstance, 'siteId'>) {
  return {
    label: input.label,
    family_id: input.familyId,
    variant_id: input.variantId,
    leg_extension_delta_m: input.legExtensionDeltaM,
    tower_centre_easting: input.towerCentreEasting ?? null,
    tower_centre_northing: input.towerCentreNorthing ?? null,
    bearing_deg: input.bearingDeg ?? null,
    notes: input.notes ?? null,
  };
}

export async function listSites(): Promise<TowerInstance[]> {
  const { data, error } = await getSupabase().from('sites').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as SiteRow[]).map(rowToTowerInstance);
}

export async function createSite(input: Omit<TowerInstance, 'siteId'>): Promise<TowerInstance> {
  const { data, error } = await getSupabase().from('sites').insert(towerInstanceToRow(input)).select().single();
  if (error) throw error;
  return rowToTowerInstance(data as SiteRow);
}

/** Bulk insert, for CSV import — one round trip instead of one per row. */
export async function createSitesBulk(inputs: Omit<TowerInstance, 'siteId'>[]): Promise<TowerInstance[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await getSupabase()
    .from('sites')
    .insert(inputs.map(towerInstanceToRow))
    .select();
  if (error) throw error;
  return (data as SiteRow[]).map(rowToTowerInstance);
}

export async function updateSiteGeometry(
  siteId: string,
  geometry: { towerCentreEasting: number; towerCentreNorthing: number; bearingDeg: number }
): Promise<TowerInstance> {
  const { data, error } = await getSupabase()
    .from('sites')
    .update({
      tower_centre_easting: geometry.towerCentreEasting,
      tower_centre_northing: geometry.towerCentreNorthing,
      bearing_deg: geometry.bearingDeg,
    })
    .eq('site_id', siteId)
    .select()
    .single();
  if (error) throw error;
  return rowToTowerInstance(data as SiteRow);
}

export async function deleteSite(siteId: string): Promise<void> {
  const { error } = await getSupabase().from('sites').delete().eq('site_id', siteId);
  if (error) throw error;
}
