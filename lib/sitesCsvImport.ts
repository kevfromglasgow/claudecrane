// ============================================================
// lib/sitesCsvImport.ts
//
// Parses a CSV of sites (columns: Label, Tower family, Height
// variant, Leg Extension) into validated TowerInstance inputs, with
// per-row error reporting so the UI can show exactly which rows
// failed and why before anything is written to the database.
//
// Matching is intentionally forgiving on free-text spelling (e.g.
// "AS4 AD55", "AS4_AD55", "ad55" should all resolve to the same
// family) since this is meant for engineers pasting values out of
// a spreadsheet, not a strict machine format.
// ============================================================

import Papa from 'papaparse';
import { TOWER_FAMILIES } from './towerFamilies';
import type { TowerFamily, HeightVariant, LegExtensionOption } from './types';

export interface SiteCsvRowResult {
  rowNumber: number; // 1-based, matching a spreadsheet row (header = row 1)
  raw: Record<string, string>;
  resolved?: {
    label: string;
    familyId: string;
    variantId: string;
    legExtensionDeltaM: number;
  };
  errors: string[];
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function matchFamily(input: string): { family?: TowerFamily; error?: string } {
  const key = normalize(input);
  if (!key) return { error: 'Tower family is empty' };

  const exact = TOWER_FAMILIES.find((f) => normalize(f.familyId) === key || normalize(f.displayName) === key);
  if (exact) return { family: exact };

  const contains = TOWER_FAMILIES.filter(
    (f) => normalize(f.familyId).includes(key) || normalize(f.displayName).includes(key) || key.includes(normalize(f.familyId))
  );
  if (contains.length === 1) return { family: contains[0] };
  if (contains.length > 1) {
    return { error: `"${input}" matches more than one tower family (${contains.map((f) => f.displayName).join(', ')}) — use a more specific name` };
  }
  return {
    error: `"${input}" doesn't match any known tower family. Valid options: ${TOWER_FAMILIES.map((f) => f.familyId).join(', ')}`,
  };
}

function matchVariant(family: TowerFamily, input: string): { variant?: HeightVariant; error?: string } {
  const key = normalize(input);
  if (!key) return { error: 'Height variant is empty' };
  if (family.heightVariants.length === 0) {
    return { error: `Family '${family.familyId}' has no height variant data loaded yet (stub family)` };
  }

  const exact = family.heightVariants.find((v) => normalize(v.variantId) === key || normalize(v.label) === key);
  if (exact) return { variant: exact };

  const contains = family.heightVariants.filter((v) => normalize(v.label).includes(key));
  if (contains.length === 1) return { variant: contains[0] };

  return {
    error: `"${input}" doesn't match any height variant for ${family.familyId}. Valid options: ${family.heightVariants.map((v) => v.variantId).join(', ')}`,
  };
}

const LEADING_SIGNED_NUMBER = /(-?\+?\d+(?:\.\d+)?)/;

function matchLegExtension(family: TowerFamily, input: string): { option?: LegExtensionOption; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'Leg extension is empty' };

  // strip a leading "±" (common on the ±0m option) before extracting the number
  const cleaned = trimmed.replace(/^±/, '').replace(/\+/g, '');
  const m = LEADING_SIGNED_NUMBER.exec(cleaned);
  if (!m) {
    return { error: `"${input}" doesn't look like a leg extension value (expected something like "+3m", "-2", "0")` };
  }
  const deltaM = parseFloat(m[1]);
  const option = family.legExtensionOptions.find((o) => o.deltaM === deltaM);
  if (!option) {
    return {
      error: `${deltaM}m leg extension is not published for ${family.familyId}. Valid deltas: ${family.legExtensionOptions.map((o) => o.deltaM).join(', ')}`,
    };
  }
  return { option };
}

/**
 * Parses raw CSV text into per-row results. Does NOT write to the
 * database — that's a separate step once the caller has shown the
 * user a preview and they've confirmed.
 */
export function parseSitesCsv(csvText: string): SiteCsvRowResult[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const results: SiteCsvRowResult[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const errors: string[] = [];

    const label = (raw['Label'] ?? '').trim();
    if (!label) errors.push('Label is empty');

    const familyInput = raw['Tower family'] ?? '';
    const { family, error: familyError } = matchFamily(familyInput);
    if (familyError) errors.push(familyError);

    let variant;
    if (family) {
      const variantInput = raw['Height variant'] ?? '';
      const variantResult = matchVariant(family, variantInput);
      variant = variantResult.variant;
      if (variantResult.error) errors.push(variantResult.error);
    }

    let legOption;
    if (family) {
      const legInput = raw['Leg Extension'] ?? '';
      const legResult = matchLegExtension(family, legInput);
      legOption = legResult.option;
      if (legResult.error) errors.push(legResult.error);
    }

    const result: SiteCsvRowResult = { rowNumber, raw, errors };
    if (errors.length === 0 && family && variant && legOption) {
      result.resolved = {
        label,
        familyId: family.familyId,
        variantId: variant.variantId,
        legExtensionDeltaM: legOption.deltaM,
      };
    }
    results.push(result);
  });

  return results;
}
