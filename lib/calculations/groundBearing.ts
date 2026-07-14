// ============================================================
// lib/calculations/groundBearing.ts
//
// Outrigger loading and mat sizing check (Scenario 6 steps 13-16).
// Pure functions, no React, no I/O.
//
// IMPORTANT: groundBearingPressureLimitTonnesPerM2 is ALWAYS supplied
// by the caller (a real site ground test result) — this module never
// defaults or looks up a "typical" ground bearing pressure. There is
// no safe generic value for this.
// ============================================================

import type { GroundBearingResult } from '../types';

/**
 * Total rigged weight of the crane in its lifting configuration:
 * base rigged weight (as supplied with the crane, including its
 * base counterweight) plus any additional counterweight needed
 * beyond that base to reach the configuration's total counterweight
 * requirement.
 *
 * e.g. LTM 1130-5.1: base rigged weight = 60t (includes 9t base
 * counterweight). For a 42t counterweight configuration, additional
 * counterweight needed = 42 - 9 = 33t, so total rigged weight = 93t
 * (Scenario 6 uses a different crane's numbers giving 99t — the
 * formula is the same, just check base/required counterweight
 * figures for whichever crane is in use).
 */
export function totalRiggedWeight(
  baseRiggedWeightTonnes: number,
  baseCounterweightTonnes: number,
  requiredCounterweightTonnes: number
): number {
  if (requiredCounterweightTonnes < baseCounterweightTonnes) {
    throw new RangeError(
      `Required counterweight (${requiredCounterweightTonnes}t) cannot be less than the crane's base counterweight (${baseCounterweightTonnes}t)`
    );
  }
  const additionalCounterweight = requiredCounterweightTonnes - baseCounterweightTonnes;
  return baseRiggedWeightTonnes + additionalCounterweight;
}

/**
 * Maximum outrigger loading per Scenario 6 step 14:
 * 0.75 x total rigged weight + gross load.
 */
export function maxOutriggerLoading(totalRiggedWeightTonnes: number, grossLoadTonnes: number): number {
  return 0.75 * totalRiggedWeightTonnes + grossLoadTonnes;
}

/**
 * Required mat area per Scenario 6 step 15:
 * max outrigger loading / ground bearing pressure limit.
 *
 * groundBearingPressureLimitTonnesPerM2 MUST be a real, user-supplied
 * site test result. This function does not validate its plausibility
 * beyond requiring it to be positive — the caller/UI is responsible
 * for making sure a real figure was entered rather than a placeholder.
 */
export function requiredMatArea(maxOutriggerLoadingTonnes: number, groundBearingPressureLimitTonnesPerM2: number): number {
  if (groundBearingPressureLimitTonnesPerM2 <= 0) {
    throw new RangeError('Ground bearing pressure limit must be a positive, site-tested value');
  }
  return maxOutriggerLoadingTonnes / groundBearingPressureLimitTonnesPerM2;
}

/** Mat loading given a selected mat area — must be checked against the same GBP limit. */
export function matLoading(maxOutriggerLoadingTonnes: number, selectedMatAreaM2: number): number {
  if (selectedMatAreaM2 <= 0) throw new RangeError('Selected mat area must be positive');
  return maxOutriggerLoadingTonnes / selectedMatAreaM2;
}

export interface GroundBearingCheckInput {
  baseRiggedWeightTonnes: number;
  baseCounterweightTonnes: number;
  requiredCounterweightTonnes: number;
  grossLoadTonnes: number;
  /** REQUIRED, site-tested figure — see module-level note. */
  groundBearingPressureLimitTonnesPerM2: number;
  selectedMatAreaM2: number;
}

/** Runs the full ground-bearing / mat-sizing check end to end. */
export function checkGroundBearing(input: GroundBearingCheckInput): GroundBearingResult {
  const {
    baseRiggedWeightTonnes,
    baseCounterweightTonnes,
    requiredCounterweightTonnes,
    grossLoadTonnes,
    groundBearingPressureLimitTonnesPerM2,
    selectedMatAreaM2,
  } = input;

  const riggedWeight = totalRiggedWeight(baseRiggedWeightTonnes, baseCounterweightTonnes, requiredCounterweightTonnes);
  const outriggerLoad = maxOutriggerLoading(riggedWeight, grossLoadTonnes);
  const reqMatArea = requiredMatArea(outriggerLoad, groundBearingPressureLimitTonnesPerM2);
  const loading = matLoading(outriggerLoad, selectedMatAreaM2);

  return {
    totalRiggedWeightTonnes: riggedWeight,
    maxOutriggerLoadingTonnes: outriggerLoad,
    groundBearingPressureLimitTonnesPerM2,
    requiredMatAreaM2: reqMatArea,
    selectedMatAreaM2,
    matLoadingTonnesPerM2: loading,
    passes: loading <= groundBearingPressureLimitTonnesPerM2 && selectedMatAreaM2 >= reqMatArea,
  };
}
