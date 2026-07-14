// ============================================================
// lib/calculations/slingGeometry.ts
//
// Pure functions implementing the "uniform load method" for
// multi-leg lifts: sling length, required accessory capacity,
// and the two interchangeable ways of reaching a sling length
// (Pythagoras + capacity-factor, or the angle-based length-table
// shortcut). No React, no I/O — unit tested in isolation.
// ============================================================

import {
  CAPACITY_MODE_FACTORS,
  LENGTH_MODE_FACTORS,
  FLAT_SLING_METHOD_FACTORS,
  type CapacityModeFactorEntry,
  type LengthModeFactorEntry,
  type FlatSlingMethodFactor,
  type HitchType,
} from '../types';

export class OutOfRangeError extends Error {}

/**
 * Looks up the capacity mode factor for a given number of legs and
 * a target "not exceeding" included angle band. Only 90 and 120
 * degree bands are published — anything else throws rather than
 * interpolating (these are discrete regulatory bands, not a
 * continuous curve).
 */
export function getCapacityModeFactor(legs: 2 | 3 | 4, maxIncludedAngleDeg: 90 | 120): number {
  const entry = CAPACITY_MODE_FACTORS.find(
    (e: CapacityModeFactorEntry) => e.legs === legs && e.maxIncludedAngleDeg === maxIncludedAngleDeg
  );
  if (!entry) {
    throw new OutOfRangeError(`No capacity mode factor published for ${legs} legs at ${maxIncludedAngleDeg}\u00b0`);
  }
  return entry.modeFactor;
}

/**
 * Looks up the length-table mode factor for a given angle-from-vertical.
 * Only 30/60/90/120 degrees are published.
 */
export function getLengthModeFactor(angleFromVerticalDeg: 30 | 60 | 90 | 120): LengthModeFactorEntry {
  const entry = LENGTH_MODE_FACTORS.find((e) => e.angleFromVerticalDeg === angleFromVerticalDeg);
  if (!entry) {
    throw new OutOfRangeError(`No length mode factor published for ${angleFromVerticalDeg}\u00b0 from vertical`);
  }
  return entry;
}

/**
 * PATH A (Scenario 6 style): compute the diagonal between the two
 * furthest-apart lift points via Pythagoras. For a rectangular lift
 * point layout this is the diagonal of the rectangle formed by the
 * lift-point spacing.
 */
export function liftPointDiagonal(spacingLengthM: number, spacingWidthM: number): number {
  if (spacingLengthM <= 0 || spacingWidthM <= 0) {
    throw new RangeError('Lift point spacing must be positive');
  }
  return Math.sqrt(spacingLengthM ** 2 + spacingWidthM ** 2);
}

/**
 * PATH A, step 2: required sling length = diagonal, run through the
 * LENGTH mode factor table (angle-from-vertical based — e.g. diagonal
 * \u00f7 1.4 at 90\u00b0). This is the SAME table used by the Path B
 * shortcut below — the only difference between the two paths is
 * *how the lift-point spacing figure was obtained* (Pythagoras vs a
 * direct/simple measurement), not which table applies.
 *
 * CORRECTED per user clarification: the capacity mode factor table
 * (legs \u00d7 angle, e.g. 2.1 for 4 legs at \u226490\u00b0) is used ONLY for
 * accessory capacity sizing (requiredCapacityPerLeg below) and must
 * NEVER be used for sling length. Scenario 6 step 3 labels its factor
 * "2.1" but the arithmetic shown (3.39 / ? = 2.42) only works out
 * using 1.4 (the length table's 90\u00b0 factor) — the source document's
 * factor LABEL is a mislabel, not an arithmetic error; the stated
 * result (2.42m) is correct once the right table is used.
 */
export function requiredSlingLengthFromDiagonal(diagonalM: number, angleFromVerticalDeg: 30 | 60 | 90 | 120): number {
  return requiredSlingLengthFromAngleShortcut(diagonalM, angleFromVerticalDeg);
}

/**
 * PATH B (shortcut): given the lift-point spacing (half-diagonal or
 * a single horizontal distance from lift point to the load's centre
 * — whatever "distance lift point to lift point" measurement the
 * source card uses) and a TARGET angle-from-vertical, compute the
 * sling length directly via the length-table factor, skipping
 * Pythagoras entirely. This is NOT a different answer in principle
 * from Path A — it's a faster route to the same kind of number for
 * a chosen target angle, per the user's confirmation.
 */
export function requiredSlingLengthFromAngleShortcut(
  liftPointSpacingM: number,
  angleFromVerticalDeg: 30 | 60 | 90 | 120
): number {
  const { operation, modeFactor } = getLengthModeFactor(angleFromVerticalDeg);
  return operation === 'multiply' ? liftPointSpacingM * modeFactor : liftPointSpacingM / modeFactor;
}

/**
 * Required minimum capacity per single-leg accessory (uniform load
 * method): gross load ÷ capacity mode factor, per Scenario 6 step 5.
 * Rounds UP to the nearest available accessory rating is the CALLER's
 * job (accessory selection), not this function's — this returns the
 * exact theoretical minimum.
 */
export function requiredCapacityPerLeg(grossLoadTonnes: number, legs: 2 | 3 | 4, maxIncludedAngleDeg: 90 | 120): number {
  if (grossLoadTonnes <= 0) throw new RangeError('Gross load must be positive');
  const factor = getCapacityModeFactor(legs, maxIncludedAngleDeg);
  return grossLoadTonnes / factor;
}

/**
 * Vertical height of a set of slings/chains given their length and
 * the horizontal half-spacing from lift point to the lift centreline
 * (Scenario 6 step 10: X = sqrt(sling_length^2 - half_diagonal^2)).
 */
export function slingVerticalHeight(slingLengthM: number, halfDiagonalM: number): number {
  const underRoot = slingLengthM ** 2 - halfDiagonalM ** 2;
  if (underRoot < 0) {
    throw new RangeError('Sling length is shorter than the half-diagonal — geometrically impossible');
  }
  return Math.sqrt(underRoot);
}

/** Flat/endless sling WLL adjustment for a given hitch type + angle band. */
export function getFlatSlingMethodFactor(
  hitchType: HitchType,
  twoSlings: boolean,
  angleBandDeg?: '0-7' | '7-45' | '45-60'
): FlatSlingMethodFactor {
  const entry = FLAT_SLING_METHOD_FACTORS.find(
    (e) => e.hitchType === hitchType && e.twoSlings === twoSlings && e.angleBandDeg === angleBandDeg
  );
  if (!entry) {
    throw new OutOfRangeError(
      `No flat-sling method factor published for hitchType=${hitchType}, twoSlings=${twoSlings}, angleBand=${angleBandDeg ?? 'n/a'}`
    );
  }
  return entry;
}

/**
 * Adjusted WLL for a flat/endless sling given its straight-lift rated
 * WLL and the method-of-use factor.
 */
export function adjustedFlatSlingWll(
  straightLiftWllTonnes: number,
  hitchType: HitchType,
  twoSlings: boolean,
  angleBandDeg?: '0-7' | '7-45' | '45-60'
): number {
  const { mFactor } = getFlatSlingMethodFactor(hitchType, twoSlings, angleBandDeg);
  return straightLiftWllTonnes * mFactor;
}

/**
 * Applies an optional additional user-specified factor of safety on
 * top of the standard mode-factor-derived requirement (per the
 * brief's "optional additional factor of safety" requirement).
 * factor > 1 increases the requirement (e.g. 1.1 = +10%).
 */
export function applyAdditionalFactorOfSafety(valueTonnes: number, additionalFactor: number = 1): number {
  if (additionalFactor <= 0) throw new RangeError('Additional factor of safety must be positive');
  return valueTonnes * additionalFactor;
}
