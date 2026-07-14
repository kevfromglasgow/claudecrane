// ============================================================
// lib/calculations/craneCapacity.ts
//
// Pure functions for looking up rated capacity from a crane's duty
// chart data, searching across configurations for valid options,
// and running the utilisation / rope-out / two-blocking checks.
// No React, no I/O.
// ============================================================

import type { CraneModel, BoomConfig, JibConfig, RadiusCapacityPoint, CraneConfigResult, HookBlockSpec } from '../types';
import { computeBoomPose, computeBoomJibPose, GeometryError } from './boomGeometry';

export class OutOfChartRangeError extends Error {}

/**
 * Interpolates rated capacity at an arbitrary radius from a sorted-
 * or-unsorted list of published (radius, capacity) points. NEVER
 * extrapolates beyond the published min/max radius for this exact
 * chart — throws OutOfChartRangeError instead, so callers can flag
 * it clearly rather than silently trusting a guessed number.
 */
export function interpolateCapacity(points: RadiusCapacityPoint[], radiusM: number): number {
  if (points.length === 0) {
    throw new OutOfChartRangeError('No published capacity points for this configuration');
  }
  const sorted = [...points].sort((a, b) => a.radiusM - b.radiusM);
  const minRadius = sorted[0].radiusM;
  const maxRadius = sorted[sorted.length - 1].radiusM;

  if (radiusM < minRadius || radiusM > maxRadius) {
    throw new OutOfChartRangeError(
      `Radius ${radiusM}m is outside this configuration's published range (${minRadius}m\u2013${maxRadius}m) \u2014 refusing to extrapolate`
    );
  }

  // exact match
  const exact = sorted.find((p) => p.radiusM === radiusM);
  if (exact) return exact.capacityTonnes;

  // find the bracketing pair and linearly interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (radiusM > lo.radiusM && radiusM < hi.radiusM) {
      const t = (radiusM - lo.radiusM) / (hi.radiusM - lo.radiusM);
      return lo.capacityTonnes + t * (hi.capacityTonnes - lo.capacityTonnes);
    }
  }

  // Should be unreachable given the range check above, but guard anyway.
  throw new OutOfChartRangeError(`Could not bracket radius ${radiusM}m within the published points`);
}

/** Returns true if a radius falls within a configuration's published range (no throw). */
export function isRadiusInChartRange(points: RadiusCapacityPoint[], radiusM: number): boolean {
  if (points.length === 0) return false;
  const radii = points.map((p) => p.radiusM);
  return radiusM >= Math.min(...radii) && radiusM <= Math.max(...radii);
}

/**
 * Boom-length/radius geometry: minimum achievable tip height for a
 * given boom length and radius (right-triangle approximation, boom
 * pinned at a fixed height above ground — matches the crane manual's
 * own geometry convention: tipHeight = sqrt(boomLength^2 - radius^2)).
 * Throws if the radius exceeds the boom length (geometrically
 * impossible) rather than returning NaN.
 */
export function boomTipHeight(boomLengthM: number, radiusM: number): number {
  const underRoot = boomLengthM ** 2 - radiusM ** 2;
  if (underRoot < 0) {
    throw new RangeError(`Radius ${radiusM}m exceeds boom length ${boomLengthM}m \u2014 geometrically impossible`);
  }
  return Math.sqrt(underRoot);
}

/** Rope-out: total rope paid out across all parts of line for a given hook travel distance. */
export function ropeOut(partsOfLine: number, verticalRopeRunM: number): number {
  if (partsOfLine <= 0) throw new RangeError('Parts of line must be positive');
  return partsOfLine * verticalRopeRunM;
}

export interface EvaluateConfigInput {
  craneModel: string;
  counterweightId: string;
  boom: BoomConfig;
  jib?: JibConfig;
  radiusM: number;
  requiredHookHeightM: number;
  grossLoadTonnes: number;
  utilisationThresholdPercent: number; // e.g. 80
  totalRopeLengthM: number;
  partsOfLine: number;
  hookToLoadGapM: number; // for two-blocking check
  minSafeTwoBlockingGapM: number; // e.g. 1m minimum clearance
}

/**
 * Evaluates a single fully-specified crane configuration against a
 * lift's requirements. Does NOT search across configurations itself
 * (see findValidConfigurations below) — this is the per-configuration
 * check that function calls repeatedly.
 */
export function evaluateConfiguration(input: EvaluateConfigInput): CraneConfigResult {
  const {
    craneModel,
    counterweightId,
    boom,
    jib,
    radiusM,
    requiredHookHeightM,
    grossLoadTonnes,
    utilisationThresholdPercent,
    totalRopeLengthM,
    partsOfLine,
    hookToLoadGapM,
    minSafeTwoBlockingGapM,
  } = input;

  const capacityPoints = jib ? jib.capacities : boom.capacities;
  const outOfChartRange = !isRadiusInChartRange(capacityPoints, radiusM);

  let ratedCapacityAtRadiusTonnes = 0;
  if (!outOfChartRange) {
    ratedCapacityAtRadiusTonnes = interpolateCapacity(capacityPoints, radiusM);
  }

  const utilisationPercent = outOfChartRange ? Infinity : (grossLoadTonnes / ratedCapacityAtRadiusTonnes) * 100;
  const passesUtilisation = !outOfChartRange && utilisationPercent <= utilisationThresholdPercent;

  // Tip height achievable at this configuration, using the real
  // boom/jib geometry module (lib/calculations/boomGeometry.ts) rather
  // than a boom-only approximation — this now correctly accounts for
  // jib length and offset angle when a jib is fitted, instead of
  // silently using the plain boom's height for jib configurations.
  //
  // A radius beyond this configuration's maximum physical reach is
  // geometrically impossible — this happens routinely when searching
  // across every boom/jib config in a fleet (most configs won't reach
  // any given radius), so it's treated as "this configuration doesn't
  // work" rather than an exception that would abort the whole search.
  let tipHeightM: number;
  let boomFoulClearanceM: number | null;
  let boomFoulViolation: boolean;
  try {
    if (jib) {
      const pose = computeBoomJibPose(boom.boomLengthM, jib.jibLengthM, jib.offsetDeg, radiusM);
      tipHeightM = pose.jibTip.y;
    } else {
      const pose = computeBoomPose(boom.boomLengthM, radiusM);
      tipHeightM = pose.boomTip.y;
    }
    boomFoulClearanceM = tipHeightM - requiredHookHeightM;
    boomFoulViolation = boomFoulClearanceM < 0;
  } catch (err) {
    if (err instanceof GeometryError || err instanceof RangeError) {
      tipHeightM = 0;
      boomFoulClearanceM = null;
      boomFoulViolation = true;
    } else {
      throw err;
    }
  }

  const totalRopeOutM = ropeOut(partsOfLine, tipHeightM - requiredHookHeightM >= 0 ? tipHeightM : 0);
  const ropeOutOk = totalRopeOutM <= totalRopeLengthM;

  const twoBlockingRisk = hookToLoadGapM < minSafeTwoBlockingGapM;

  return {
    craneModel,
    counterweightId,
    boomLengthM: boom.boomLengthM,
    jib: jib ? { lengthM: jib.jibLengthM, offsetDeg: jib.offsetDeg } : undefined,
    radiusM,
    requiredHookHeightM,
    ratedCapacityAtRadiusTonnes,
    utilisationPercent,
    passesUtilisation,
    ropeOutM: totalRopeOutM,
    ropeOutOk,
    twoBlockingGapM: hookToLoadGapM,
    twoBlockingRisk,
    boomFoulClearanceM,
    boomFoulViolation,
    outOfChartRange,
  };
}

export interface FindValidConfigurationsInput {
  crane: CraneModel;
  radiusM: number;
  requiredHookHeightM: number;
  grossLoadTonnes: number;
  utilisationThresholdPercent?: number; // default 80
  hookBlock: HookBlockSpec;
  partsOfLine: number;
  hookToLoadGapM: number;
  minSafeTwoBlockingGapM?: number; // default 1m
}

/**
 * Searches across ALL counterweight/boom/jib combinations in a
 * CraneModel and returns every configuration that satisfies:
 *  - rated capacity >= gross load at the required radius (interpolated)
 *  - utilisation <= threshold
 *  - rope-out within total available rope length
 *  - not a two-blocking risk
 *  - boom does not foul the load (tip height >= required height)
 * Results are NOT filtered to "the one best crane" — callers should
 * present the full option space and let the user pick, per the
 * brief's requirement.
 */
export function findValidConfigurations(input: FindValidConfigurationsInput): CraneConfigResult[] {
  const {
    crane,
    radiusM,
    requiredHookHeightM,
    grossLoadTonnes,
    utilisationThresholdPercent = 80,
    hookBlock,
    partsOfLine,
    hookToLoadGapM,
    minSafeTwoBlockingGapM = 1,
  } = input;

  const results: CraneConfigResult[] = [];

  for (const cw of crane.counterweights) {
    for (const boom of cw.boomConfigs) {
      // plain boom configuration (no jib)
      const plainResult = evaluateConfiguration({
        craneModel: crane.craneModel,
        counterweightId: cw.id,
        boom,
        radiusM,
        requiredHookHeightM,
        grossLoadTonnes,
        utilisationThresholdPercent,
        totalRopeLengthM: crane.totalRopeLengthM,
        partsOfLine,
        hookToLoadGapM,
        minSafeTwoBlockingGapM,
      });
      if (isFullyValid(plainResult, hookBlock, grossLoadTonnes)) {
        results.push(plainResult);
      }

      // every jib configuration available at this boom length
      for (const jib of boom.jibs ?? []) {
        const jibResult = evaluateConfiguration({
          craneModel: crane.craneModel,
          counterweightId: cw.id,
          boom,
          jib,
          radiusM,
          requiredHookHeightM,
          grossLoadTonnes,
          utilisationThresholdPercent,
          totalRopeLengthM: crane.totalRopeLengthM,
          partsOfLine,
          hookToLoadGapM,
          minSafeTwoBlockingGapM,
        });
        if (isFullyValid(jibResult, hookBlock, grossLoadTonnes)) {
          results.push(jibResult);
        }
      }
    }
  }

  return results;
}

function isFullyValid(result: CraneConfigResult, hookBlock: HookBlockSpec, grossLoadTonnes: number): boolean {
  return (
    !result.outOfChartRange &&
    result.ratedCapacityAtRadiusTonnes >= grossLoadTonnes &&
    result.passesUtilisation &&
    result.ropeOutOk &&
    !result.twoBlockingRisk &&
    !result.boomFoulViolation &&
    hookBlock.ratedCapacityTonnes >= grossLoadTonnes
  );
}

/** Sorts valid configurations so the "smallest/cheapest" option (by
 *  counterweight, then boom length, then jib presence) comes first —
 *  a reasonable default ordering for presenting the option space,
 *  per the brief's "let the user pick the smallest/cheapest" goal. */
export function rankConfigurations(results: CraneConfigResult[]): CraneConfigResult[] {
  return [...results].sort((a, b) => {
    if (a.boomLengthM !== b.boomLengthM) return a.boomLengthM - b.boomLengthM;
    const aHasJib = a.jib ? 1 : 0;
    const bHasJib = b.jib ? 1 : 0;
    if (aHasJib !== bHasJib) return aHasJib - bHasJib;
    return a.utilisationPercent - b.utilisationPercent;
  });
}
