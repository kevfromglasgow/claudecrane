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
