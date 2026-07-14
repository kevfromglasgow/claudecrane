// ============================================================
// lib/calculations/boomGeometry.ts
//
// 2D geometry for the crane's side-view lift profile: boom angle
// and tip position, jib tip position (composed vector when a folding
// jib is fitted), two-blocking gap, and boom-line fouling clearance
// against the load/rigging envelope or a fixed obstruction (e.g. a
// building edge). Pure functions, no React, no I/O.
//
// COORDINATE CONVENTION: origin (0,0) is the crane's slew centre at
// ground level. +x is horizontal distance from the crane (radius
// direction), +y is height above ground. All angles in degrees
// unless a function name says "Rad".
// ============================================================

import type { Point2D } from '../types';

export class GeometryError extends Error {}

export interface BoomPose {
  boomBase: Point2D;
  boomTip: Point2D;
  boomAngleDeg: number; // from horizontal
}

export interface BoomJibPose extends BoomPose {
  jibTip: Point2D;
  jibAngleDeg: number; // from horizontal (absolute, not relative to boom)
}

/**
 * Computes the boom's pose (base position, tip position, angle from
 * horizontal) for a given boom length and target radius. The boom
 * base is pinned at (0, boomBaseHeightM) — a small fixed offset
 * above ground for the boom pivot (default 0, override with the
 * actual crane's pivot height for a more accurate side-view profile).
 *
 * Radius is measured horizontally from the slew centreline (x=0) to
 * the boom tip, matching how manufacturer duty charts define radius.
 */
export function computeBoomPose(boomLengthM: number, radiusM: number, boomBaseHeightM: number = 0): BoomPose {
  if (boomLengthM <= 0) throw new RangeError('Boom length must be positive');
  if (radiusM < 0) throw new RangeError('Radius must be non-negative');
  if (radiusM > boomLengthM) {
    throw new GeometryError(`Radius ${radiusM}m exceeds boom length ${boomLengthM}m \u2014 geometrically impossible`);
  }

  const boomAngleRad = Math.acos(radiusM / boomLengthM);
  const boomAngleDeg = (boomAngleRad * 180) / Math.PI;
  const boomBase: Point2D = { x: 0, y: boomBaseHeightM };
  const boomTip: Point2D = {
    x: radiusM,
    y: boomBaseHeightM + boomLengthM * Math.sin(boomAngleRad),
  };

  return { boomBase, boomTip, boomAngleDeg };
}

/**
 * Computes the combined boom+jib pose. The jib's offset angle is
 * measured from the boom's own line (0\u00b0 = jib continues straight out
 * from the boom; 20\u00b0/40\u00b0 = jib folded DOWN from the boom line by
 * that many degrees, matching the LTM 1130-5.1 manual's folding-jib
 * convention). The jib's absolute angle from horizontal is therefore
 * (boomAngleDeg - offsetDeg).
 *
 * NOTE: this determines the jib tip's geometric POSITION for drawing
 * and clearance checks. It intentionally does NOT re-derive rated
 * capacity or the radius/height the chart reports for this
 * configuration — those come directly from the published duty chart
 * (see craneCapacity.ts), which already accounts for the real
 * manufacturer geometry more precisely than this simplified model.
 * Use this module for VISUALIZATION and CLEARANCE checks only.
 */
export function computeBoomJibPose(
  boomLengthM: number,
  jibLengthM: number,
  jibOffsetDeg: 0 | 20 | 40,
  radiusM: number,
  boomBaseHeightM: number = 0
): BoomJibPose {
  // The boom's own angle must be solved such that the COMBINED boom+jib
  // horizontal reach equals the target radius (not the boom alone),
  // since with a jib fitted the boom is normally raised to a steeper
  // angle than it would be for the same radius with no jib.
  const jibOffsetRad = (jibOffsetDeg * Math.PI) / 180;

  // Solve boomAngleRad such that:
  //   boomLengthM*cos(boomAngleRad) + jibLengthM*cos(boomAngleRad - jibOffsetRad) = radiusM
  // No closed-form inverse for arbitrary offset, so solve numerically
  // (bisection — this function is deterministic, monotonic over the
  // valid range, and only needs to run once per configuration, so a
  // simple bisection is fast enough and easy to verify).
  const horizontalReach = (angleRad: number) =>
    boomLengthM * Math.cos(angleRad) + jibLengthM * Math.cos(angleRad - jibOffsetRad);

  const maxReach = horizontalReach(0);
  if (radiusM > maxReach) {
    throw new GeometryError(
      `Radius ${radiusM}m exceeds this boom+jib configuration's maximum horizontal reach (${maxReach.toFixed(2)}m)`
    );
  }
  if (radiusM < 0) throw new RangeError('Radius must be non-negative');

  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // horizontalReach is DEcreasing as angle increases (more vertical = less horizontal reach)
    if (horizontalReach(mid) > radiusM) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const boomAngleRad = (lo + hi) / 2;
  const boomAngleDeg = (boomAngleRad * 180) / Math.PI;
  const jibAngleRad = boomAngleRad - jibOffsetRad;
  const jibAngleDeg = (jibAngleRad * 180) / Math.PI;

  const boomBase: Point2D = { x: 0, y: boomBaseHeightM };
  const boomTip: Point2D = {
    x: boomLengthM * Math.cos(boomAngleRad),
    y: boomBaseHeightM + boomLengthM * Math.sin(boomAngleRad),
  };
  const jibTip: Point2D = {
    x: boomTip.x + jibLengthM * Math.cos(jibAngleRad),
    y: boomTip.y + jibLengthM * Math.sin(jibAngleRad),
  };

  return { boomBase, boomTip, boomAngleDeg, jibTip, jibAngleDeg };
}

/**
 * Perpendicular distance from a point to a line SEGMENT (not an
 * infinite line) — used to check whether the load/rigging envelope
 * comes close to fouling the boom or jib line during the lift.
 */
export function distancePointToSegment(point: Point2D, segStart: Point2D, segEnd: Point2D): number {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // segment is a single point
    return Math.hypot(point.x - segStart.x, point.y - segStart.y);
  }

  let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closest: Point2D = { x: segStart.x + t * dx, y: segStart.y + t * dy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

export interface BoomFoulCheckInput {
  pose: BoomPose | BoomJibPose;
  /** points defining the load/rigging envelope that must clear the
   *  boom/jib line — e.g. the four top corners of the load plus the
   *  hook and sling apex */
  envelopePoints: Point2D[];
  /** minimum acceptable clearance in metres before flagging a foul risk */
  minClearanceM: number;
}

export interface BoomFoulCheckResult {
  minClearanceFoundM: number;
  violatesMinimum: boolean;
  closestEnvelopePoint: Point2D;
}

/**
 * Checks the load/rigging envelope against the boom line (and the
 * jib line too, if fitted) for fouling risk, returning the smallest
 * clearance found across every envelope point and both line segments.
 */
export function checkBoomFoul(input: BoomFoulCheckInput): BoomFoulCheckResult {
  const { pose, envelopePoints, minClearanceM } = input;
  if (envelopePoints.length === 0) {
    throw new RangeError('At least one envelope point is required to check boom-foul clearance');
  }

  const segments: [Point2D, Point2D][] = [[pose.boomBase, pose.boomTip]];
  if ('jibTip' in pose) {
    segments.push([pose.boomTip, pose.jibTip]);
  }

  let minClearanceFoundM = Infinity;
  let closestEnvelopePoint = envelopePoints[0];

  for (const point of envelopePoints) {
    for (const [segStart, segEnd] of segments) {
      const d = distancePointToSegment(point, segStart, segEnd);
      if (d < minClearanceFoundM) {
        minClearanceFoundM = d;
        closestEnvelopePoint = point;
      }
    }
  }

  return {
    minClearanceFoundM,
    violatesMinimum: minClearanceFoundM < minClearanceM,
    closestEnvelopePoint,
  };
}

export interface TwoBlockingInput {
  /** hook/jib-tip position, i.e. where the rope runs from */
  ropeFromPoint: Point2D;
  currentLoadHeightAboveGroundM: number;
  loadHeightM: number;
  riggingVerticalHeightM: number; // vertical height of the sling/chain triangle
  hookBlockLengthM: number;
  overhoistProtectionM: number;
  assumedDeflectionM: number;
}

export interface TwoBlockingResult {
  /** total vertical distance consumed from tip/jib-tip down to the
   *  top of the load (hook block + overhoist/deflection allowance +
   *  rigging height), for reference/display */
  consumedVerticalM: number;
  /** remaining gap between the bottom of the hook block assembly and
   *  the top of the rigging/load stack — the actual two-blocking
   *  safety margin */
  remainingGapM: number;
  twoBlockingRisk: boolean;
}

/**
 * Computes the two-blocking gap: given the current load height, works
 * out how much vertical clearance remains between the hook block
 * (plus its overhoist/deflection allowances) and the top of the
 * rigging/load stack, using the tip/jib-tip height available.
 */
export function checkTwoBlocking(input: TwoBlockingInput, minSafeGapM: number = 1): TwoBlockingResult {
  const {
    ropeFromPoint,
    currentLoadHeightAboveGroundM,
    loadHeightM,
    riggingVerticalHeightM,
    hookBlockLengthM,
    overhoistProtectionM,
    assumedDeflectionM,
  } = input;

  const topOfLoadHeightM = currentLoadHeightAboveGroundM + loadHeightM;
  const topOfRiggingHeightM = topOfLoadHeightM + riggingVerticalHeightM;
  const consumedVerticalM = hookBlockLengthM + overhoistProtectionM + assumedDeflectionM;
  const hookBlockBottomHeightM = ropeFromPoint.y - consumedVerticalM;
  const remainingGapM = hookBlockBottomHeightM - topOfRiggingHeightM;

  return {
    consumedVerticalM,
    remainingGapM,
    twoBlockingRisk: remainingGapM < minSafeGapM,
  };
}
