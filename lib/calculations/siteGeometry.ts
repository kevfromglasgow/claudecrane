// ============================================================
// lib/calculations/siteGeometry.ts
//
// Converts a per-tower-family site layout TEMPLATE (crane pad,
// telehandler pad, laydown area, tower footprint corners — all
// defined as LOCAL offsets from the tower centre, in a fixed
// reference orientation) into REAL-WORLD coordinates for a specific
// site, given that site's real tower-centre coordinate and bearing.
//
// CONVENTION (must match how templates are drawn — see
// ROADMAP.md's open question on what the bearing physically
// represents): bearing is measured in degrees CLOCKWISE FROM NORTH
// (standard surveying azimuth, 0-360°), and describes which real-
// world direction the template's local +Y axis ("forward"/"up" in
// the drawing) points. Local +X is 90° clockwise from local +Y
// (i.e. "to the right" when facing the +Y/forward direction).
//
// Verified convention behaviour (see tests): bearing 0° means the
// template is unrotated (local Y = north, local X = east). Bearing
// 90° means the template's local +Y ("forward") now points east.
// ============================================================

import type { Point2D } from '../types';

export interface LocalPoint {
  name: string;
  xLocal: number;
  yLocal: number;
}

export interface SiteLayoutTemplate {
  familyId: string;
  /** named reference points relative to tower centre, e.g. crane pad
   *  centre, telehandler pad centre, laydown area corners */
  points: LocalPoint[];
  /** the tower footprint's corner points, relative to tower centre —
   *  kept separate from `points` since these specifically drive the
   *  "largest radius to reach any leg" calculation */
  footprintCorners: LocalPoint[];
}

export interface SitePlacement {
  towerCentreEasting: number;
  towerCentreNorthing: number;
  /** degrees clockwise from north — see module-level convention note */
  bearingDeg: number;
}

// ------------------------------------------------------------
// DERIVING THE PLACEMENT BEARING FROM ADJACENT TOWER COORDINATES
//
// Confirmed convention: the template's reference ("forward") axis
// represents the tower's overall line direction — the BISECTOR of
// the incoming span (previous tower -> this tower) and outgoing span
// (this tower -> next tower) bearings. This matches real angle-tower
// design (cross-arms/body oriented to bisect the deviation angle,
// balancing the horizontal pull from both spans) and degenerates
// correctly for suspension towers, where incoming and outgoing
// bearing are essentially identical anyway — no special-casing
// needed between tower categories, one formula covers both.
//
// Rather than asking for a manually-calculated bearing number (error-
// prone), this is derived from coordinates you likely already have:
// the previous tower's centre, this tower's centre, and the next
// tower's centre. For a true end-of-line terminal tower, only one
// adjacent tower exists — that single span's bearing is used directly
// (no bisector needed, nothing to average against).
// ------------------------------------------------------------

export class BearingError extends Error {}

/** Standard surveying bearing (degrees clockwise from north) from one point to another. */
export function bearingBetween(from: Point2D, to: Point2D): number {
  const dEasting = to.x - from.x;
  const dNorthing = to.y - from.y;
  if (dEasting === 0 && dNorthing === 0) {
    throw new BearingError('Cannot compute a bearing between two identical points');
  }
  const rad = Math.atan2(dEasting, dNorthing); // atan2(x, y) gives azimuth directly under this convention
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Bisector of two bearings, computed via vector addition (NOT naive
 * angle averaging, which breaks across the 0/360° wraparound — e.g.
 * naively averaging 350° and 10° gives 180°, the wrong answer; vector
 * addition correctly gives 0°/360°).
 *
 * Throws if the two bearings are exactly opposite (180° apart) — the
 * bisector is undefined in that degenerate case (would represent an
 * impossible 180° line deviation, not a realistic tower).
 */
export function bisectorBearing(bearingInDeg: number, bearingOutDeg: number): number {
  const toVector = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
  };
  const vIn = toVector(bearingInDeg);
  const vOut = toVector(bearingOutDeg);
  const sum = { x: vIn.x + vOut.x, y: vIn.y + vOut.y };

  if (Math.hypot(sum.x, sum.y) < 1e-9) {
    throw new BearingError(
      `Bearings ${bearingInDeg}\u00b0 and ${bearingOutDeg}\u00b0 are exactly opposite \u2014 bisector is undefined for a 180\u00b0 deviation`
    );
  }
  const rad = Math.atan2(sum.x, sum.y);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface AdjacentTowerCoordinates {
  previousTower?: Point2D;
  thisTower: Point2D;
  nextTower?: Point2D;
}

/**
 * Computes the template placement bearing for a site from its own
 * coordinate plus whichever adjacent tower coordinate(s) are known:
 *  - both previous AND next known -> bisector of the two spans
 *  - only one known (true terminal tower) -> that single span's bearing
 *  - neither known -> throws (nothing to derive a bearing from)
 */
export function derivePlacementBearing(coords: AdjacentTowerCoordinates): number {
  const { previousTower, thisTower, nextTower } = coords;

  if (previousTower && nextTower) {
    const bearingIn = bearingBetween(previousTower, thisTower);
    const bearingOut = bearingBetween(thisTower, nextTower);
    return bisectorBearing(bearingIn, bearingOut);
  }
  if (nextTower) return bearingBetween(thisTower, nextTower);
  if (previousTower) return bearingBetween(previousTower, thisTower);

  throw new BearingError('At least one adjacent tower coordinate (previous or next) is required to derive a placement bearing');
}


/**
 * Rotates a single local (template-frame) offset into a real-world
 * (easting, northing) OFFSET from the tower centre — does not yet add
 * the tower centre coordinate itself (see placeLocalPoint for that).
 */
export function rotateLocalOffset(local: { xLocal: number; yLocal: number }, bearingDeg: number): Point2D {
  const rad = (bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Azimuth-style (clockwise-from-north) rotation, NOT the standard
  // counter-clockwise mathematical rotation matrix — verified against
  // known bearings in siteGeometry.test.ts.
  const eastingOffset = local.xLocal * cos + local.yLocal * sin;
  const northingOffset = -local.xLocal * sin + local.yLocal * cos;
  return { x: eastingOffset, y: northingOffset };
}

/** Rotates + translates a single local point into a full real-world (easting, northing) coordinate. */
export function placeLocalPoint(local: { xLocal: number; yLocal: number }, placement: SitePlacement): Point2D {
  const offset = rotateLocalOffset(local, placement.bearingDeg);
  return {
    x: placement.towerCentreEasting + offset.x,
    y: placement.towerCentreNorthing + offset.y,
  };
}

export interface PlacedSiteLayout {
  familyId: string;
  points: { name: string; easting: number; northing: number }[];
  footprintCorners: { name: string; easting: number; northing: number }[];
}

/** Places every point in a template (named points + footprint corners) for a specific site. */
export function placeSiteLayout(template: SiteLayoutTemplate, placement: SitePlacement): PlacedSiteLayout {
  return {
    familyId: template.familyId,
    points: template.points.map((p) => {
      const { x, y } = placeLocalPoint(p, placement);
      return { name: p.name, easting: x, northing: y };
    }),
    footprintCorners: template.footprintCorners.map((p) => {
      const { x, y } = placeLocalPoint(p, placement);
      return { name: p.name, easting: x, northing: y };
    }),
  };
}

/** Straight-line distance between two real-world (easting, northing) points. */
export function planDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The radius the crane needs to reach the FURTHEST tower leg from a
 * given crane stand position — per the brief's requirement to check
 * against the worst-case corner, not just the tower centre.
 */
export function maxRadiusToFootprint(craneStandPoint: Point2D, footprintCorners: Point2D[]): number {
  if (footprintCorners.length === 0) {
    throw new RangeError('At least one footprint corner is required');
  }
  return Math.max(...footprintCorners.map((corner) => planDistance(craneStandPoint, corner)));
}
