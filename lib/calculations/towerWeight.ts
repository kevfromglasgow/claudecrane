// ============================================================
// lib/calculations/towerWeight.ts
//
// Sums a tower family's component weights for a given height variant
// and leg extension selection. Pure functions, no React, no I/O.
//
// IMPORTANT MODELING FACT (discovered by reconciling AS4 AD/BD
// itemized data against the manufacturer's printed totals — see
// SCHEMA_DECISIONS.md): every published "TOWER WEIGHT Kgs" total
// already INCLUDES the ±0m leg extension (4 legs at the standard
// unit weight). Legs are not an optional add-on — every real tower
// has SOME leg length, and ±0m is just the standard/baseline one.
// This module always adds the selected leg extension (defaulting to
// deltaM = 0) rather than treating "no leg extension chosen" as zero
// weight.
// ============================================================

import type { TowerFamily, HeightVariant, LegExtensionOption, TowerComponent, TowerInstance, LiftableComponent } from '../types';

export class TowerDataError extends Error {}

function sumComponents(components: TowerComponent[]): number {
  return components.reduce((sum, c) => sum + c.weightTonnes * c.quantity, 0);
}

/** Total weight of a family's common portion (before any height variant or leg extension). */
export function commonPortionWeight(family: TowerFamily): number {
  return sumComponents(family.commonPortion);
}

/** Finds a height variant by id, throwing a clear error if it isn't valid for this family
 *  (per the schema rule: never assume a variant id from one family applies to another). */
export function getHeightVariant(family: TowerFamily, variantId: string): HeightVariant {
  const variant = family.heightVariants.find((v) => v.variantId === variantId);
  if (!variant) {
    const valid = family.heightVariants.map((v) => v.variantId).join(', ');
    throw new TowerDataError(`'${variantId}' is not a valid height variant for family '${family.familyId}'. Valid options: ${valid}`);
  }
  return variant;
}

/** Finds a leg extension option by delta, throwing a clear error if it isn't published for this family. */
export function getLegExtensionOption(family: TowerFamily, deltaM: number): LegExtensionOption {
  const option = family.legExtensionOptions.find((o) => o.deltaM === deltaM);
  if (!option) {
    const valid = family.legExtensionOptions.map((o) => o.deltaM).join(', ');
    throw new TowerDataError(`${deltaM}m leg extension is not published for family '${family.familyId}'. Valid deltas: ${valid}`);
  }
  return option;
}

export interface TowerWeightBreakdown {
  familyId: string;
  variantId: string;
  legExtensionDeltaM: number;
  commonPortionTonnes: number;
  variantAdditionsTonnes: number;
  legExtensionTonnes: number;
  totalTonnes: number;
  /** present only if the source drawing's printed total is known for
   *  this variant, for cross-checking against the computed total */
  printedTotalTonnes?: number;
  /** true if printedTotalTonnes is known and matches totalTonnes to
   *  within a small tolerance (accounts for kg/tonne rounding) */
  reconcilesWithPrintedTotal?: boolean;
}

/**
 * Computes the full weight breakdown for a tower: common portion +
 * this height variant's additional components + the selected leg
 * extension (always applied — see module-level note; defaults to
 * deltaM = 0 if not specified).
 */
export function calculateTowerWeight(family: TowerFamily, variantId: string, legExtensionDeltaM: number = 0): TowerWeightBreakdown {
  const variant = getHeightVariant(family, variantId);
  const legOption = getLegExtensionOption(family, legExtensionDeltaM);

  const commonPortionTonnes = commonPortionWeight(family);
  const variantAdditionsTonnes = sumComponents(variant.additionalComponents);
  const legExtensionTonnes = (legOption.unitWeightKg / 1000) * legOption.quantity;

  const totalTonnes = commonPortionTonnes + variantAdditionsTonnes + legExtensionTonnes;

  const breakdown: TowerWeightBreakdown = {
    familyId: family.familyId,
    variantId,
    legExtensionDeltaM,
    commonPortionTonnes,
    variantAdditionsTonnes,
    legExtensionTonnes,
    totalTonnes,
  };

  if (variant.printedTotalWeightKg !== undefined) {
    const printedTotalTonnes = variant.printedTotalWeightKg / 1000;
    breakdown.printedTotalTonnes = printedTotalTonnes;
    // only meaningful to compare directly at leg extension = 0, since
    // the printed total bakes in the ±0m leg extension specifically
    if (legExtensionDeltaM === 0) {
      breakdown.reconcilesWithPrintedTotal = Math.abs(printedTotalTonnes - totalTonnes) < 0.001;
    }
  }

  return breakdown;
}

// ------------------------------------------------------------
// SITE-BASED LIFT PICKER
//
// A TowerInstance ("Site") pins down family + variant + leg
// extension ONCE. listLiftableComponents then expands that into every
// individual craneable item for that specific tower: the common
// portion's own components, this variant's additions, AND the
// selected leg extension exploded into ONE ENTRY PER PHYSICAL LEG
// (4 separate cone lifts, not one "x4" combined lift), since each
// leg is genuinely a separate crane lift on site.
//
// Items with craneLift === false (e.g. plan bracing fixed by
// linesmen) are still included in the list — callers/UI should grey
// these out rather than omit them, so the erection sequence stays
// visible for reference even though they're not selectable as a lift.
// ------------------------------------------------------------

function toLiftableComponent(
  siteId: string,
  source: LiftableComponent['source'],
  component: TowerComponent,
  indexSuffix?: number
): LiftableComponent {
  const idSuffix = indexSuffix !== undefined ? `_${indexSuffix}` : '';
  return {
    id: `${siteId}__${component.id}${idSuffix}`,
    siteId,
    source,
    name: indexSuffix !== undefined ? `${component.name} (leg ${indexSuffix + 1} of ${component.quantity})` : component.name,
    weightTonnes: component.weightTonnes,
    quantity: indexSuffix !== undefined ? 1 : component.quantity,
    craneLift: component.craneLift ?? true,
    drawingItemRef: component.drawingItemRef,
    notes: component.notes,
  };
}

/**
 * Expands a TowerInstance into every liftable component for that
 * specific tower (common portion + this variant's additions + the
 * selected leg extension exploded per-leg).
 */
export function listLiftableComponents(family: TowerFamily, site: TowerInstance): LiftableComponent[] {
  if (family.familyId !== site.familyId) {
    throw new TowerDataError(`Site '${site.siteId}' references family '${site.familyId}', but family '${family.familyId}' was supplied`);
  }
  const variant = getHeightVariant(family, site.variantId);
  const legOption = getLegExtensionOption(family, site.legExtensionDeltaM);

  const items: LiftableComponent[] = [];

  for (const c of family.commonPortion) {
    items.push(toLiftableComponent(site.siteId, 'commonPortion', c));
  }
  for (const c of variant.additionalComponents) {
    items.push(toLiftableComponent(site.siteId, 'variantAddition', c));
  }

  // Leg extension: exploded into one entry PER PHYSICAL LEG (e.g. 4
  // separate cone lifts), since each is a genuinely separate crane
  // lift on site, even though they share one weight/height spec.
  const legComponent: TowerComponent = {
    id: `leg_extension_${legOption.deltaM}m`,
    name: `Leg Cone (${legOption.label})`,
    weightTonnes: legOption.unitWeightKg / 1000,
    quantity: legOption.quantity,
    craneLift: true,
  };
  for (let i = 0; i < legOption.quantity; i++) {
    items.push(toLiftableComponent(site.siteId, 'legExtension', legComponent, i));
  }

  return items;
}
