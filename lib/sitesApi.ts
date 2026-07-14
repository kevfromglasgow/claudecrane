// ============================================================
// lib/sitesApi.ts
//
// Typed CRUD over Supabase's `sites` table (see sql/schema.sql),
// converting between Postgres's snake_case columns and the app's
// TowerInstance shape. Kept separate from lib/calculations/* since
// this does real I/O — calculations stay pure/testable, this doesn't.
// ============================================================

import { getSupabase } from './supabaseClient';
import type { TowerInstance } from './types';

interface SiteRow {
  site_id: string;
  label: string;
  family_id: string;
  variant_id: string;
  leg_extension_delta_m: number;
  notes: string | null;
}

function rowToTowerInstance(row: SiteRow): TowerInstance {
  return {
    siteId: row.site_id,
    label: row.label,
    familyId: row.family_id,
    variantId: row.variant_id,
    legExtensionDeltaM: row.leg_extension_delta_m,
    notes: row.notes ?? undefined,
  };
}

export async function listSites(): Promise<TowerInstance[]> {
  const { data, error } = await getSupabase().from('sites').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as SiteRow[]).map(rowToTowerInstance);
}

export async function createSite(input: Omit<TowerInstance, 'siteId'>): Promise<TowerInstance> {
  const { data, error } = await getSupabase()
    .from('sites')
    .insert({
      label: input.label,
      family_id: input.familyId,
      variant_id: input.variantId,
      leg_extension_delta_m: input.legExtensionDeltaM,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToTowerInstance(data as SiteRow);
}

/** Bulk insert, for CSV import — one round trip instead of one per row. */
export async function createSitesBulk(inputs: Omit<TowerInstance, 'siteId'>[]): Promise<TowerInstance[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await getSupabase()
    .from('sites')
    .insert(
      inputs.map((input) => ({
        label: input.label,
        family_id: input.familyId,
        variant_id: input.variantId,
        leg_extension_delta_m: input.legExtensionDeltaM,
        notes: input.notes ?? null,
      }))
    )
    .select();
  if (error) throw error;
  return (data as SiteRow[]).map(rowToTowerInstance);
}

export async function deleteSite(siteId: string): Promise<void> {
  const { error } = await getSupabase().from('sites').delete().eq('site_id', siteId);
  if (error) throw error;
}
