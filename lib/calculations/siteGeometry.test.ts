import { describe, it, expect } from 'vitest';
import {
  rotateLocalOffset,
  placeLocalPoint,
  placeSiteLayout,
  planDistance,
  maxRadiusToFootprint,
  type SiteLayoutTemplate,
  type SitePlacement,
} from './siteGeometry';

describe('rotateLocalOffset — bearing convention sanity checks', () => {
  it('bearing 0deg leaves the template unrotated (local Y=north, local X=east)', () => {
    const offset = rotateLocalOffset({ xLocal: 0, yLocal: 10 }, 0);
    expect(offset.x).toBeCloseTo(0, 5); // no easting component
    expect(offset.y).toBeCloseTo(10, 5); // all northing — "forward" points north
  });

  it('bearing 90deg rotates the template\'s "forward" (+Y) axis to point east', () => {
    const offset = rotateLocalOffset({ xLocal: 0, yLocal: 10 }, 90);
    expect(offset.x).toBeCloseTo(10, 5); // forward now points east
    expect(offset.y).toBeCloseTo(0, 5);
  });

  it('bearing 180deg rotates "forward" to point south', () => {
    const offset = rotateLocalOffset({ xLocal: 0, yLocal: 10 }, 180);
    expect(offset.x).toBeCloseTo(0, 5);
    expect(offset.y).toBeCloseTo(-10, 5);
  });

  it('bearing 270deg rotates "forward" to point west', () => {
    const offset = rotateLocalOffset({ xLocal: 0, yLocal: 10 }, 270);
    expect(offset.x).toBeCloseTo(-10, 5);
    expect(offset.y).toBeCloseTo(0, 5);
  });

  it('local +X ("right of forward") rotates consistently with a clockwise/azimuth frame at bearing 0', () => {
    // at bearing 0 (forward=north), "right of forward" should point east
    const offset = rotateLocalOffset({ xLocal: 10, yLocal: 0 }, 0);
    expect(offset.x).toBeCloseTo(10, 5);
    expect(offset.y).toBeCloseTo(0, 5);
  });

  it('a 45deg bearing splits the offset evenly between easting and northing', () => {
    const offset = rotateLocalOffset({ xLocal: 0, yLocal: 10 }, 45);
    const expected = 10 * Math.SQRT1_2;
    expect(offset.x).toBeCloseTo(expected, 5);
    expect(offset.y).toBeCloseTo(expected, 5);
  });

  it('preserves distance from origin regardless of bearing (rotation is not a scale change)', () => {
    const local = { xLocal: 7, yLocal: -4 };
    const originalDistance = Math.hypot(local.xLocal, local.yLocal);
    for (const bearing of [0, 37, 90, 145, 270, 359]) {
      const offset = rotateLocalOffset(local, bearing);
      expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(originalDistance, 5);
    }
  });

  it('360deg bearing is equivalent to 0deg', () => {
    const a = rotateLocalOffset({ xLocal: 5, yLocal: 5 }, 0);
    const b = rotateLocalOffset({ xLocal: 5, yLocal: 5 }, 360);
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
  });
});

describe('placeLocalPoint', () => {
  it('adds the rotated offset onto the tower centre coordinate', () => {
    const placement: SitePlacement = { towerCentreEasting: 500000, towerCentreNorthing: 700000, bearingDeg: 90 };
    const world = placeLocalPoint({ xLocal: 0, yLocal: 15 }, placement);
    // bearing 90: forward (+Y) points east, so a point 15m "forward" of tower centre is 15m east
    expect(world.x).toBeCloseTo(500015, 3);
    expect(world.y).toBeCloseTo(700000, 3);
  });

  it('the tower centre itself (local 0,0) always maps to the tower centre regardless of bearing', () => {
    for (const bearing of [0, 90, 180, 270]) {
      const placement: SitePlacement = { towerCentreEasting: 123, towerCentreNorthing: 456, bearingDeg: bearing };
      const world = placeLocalPoint({ xLocal: 0, yLocal: 0 }, placement);
      expect(world.x).toBeCloseTo(123, 5);
      expect(world.y).toBeCloseTo(456, 5);
    }
  });
});

describe('placeSiteLayout', () => {
  const template: SiteLayoutTemplate = {
    familyId: 'AS4_AD55',
    points: [
      { name: 'crane_pad_centre', xLocal: 0, yLocal: 20 },
      { name: 'telehandler_pad_centre', xLocal: 8, yLocal: 15 },
    ],
    footprintCorners: [
      { name: 'corner_1', xLocal: -3, yLocal: -3 },
      { name: 'corner_2', xLocal: 3, yLocal: -3 },
      { name: 'corner_3', xLocal: 3, yLocal: 3 },
      { name: 'corner_4', xLocal: -3, yLocal: 3 },
    ],
  };

  it('places every named point and footprint corner for a given site placement', () => {
    const placement: SitePlacement = { towerCentreEasting: 1000, towerCentreNorthing: 2000, bearingDeg: 0 };
    const placed = placeSiteLayout(template, placement);

    expect(placed.points).toHaveLength(2);
    expect(placed.footprintCorners).toHaveLength(4);

    const cranePad = placed.points.find((p) => p.name === 'crane_pad_centre')!;
    expect(cranePad.easting).toBeCloseTo(1000, 3);
    expect(cranePad.northing).toBeCloseTo(2020, 3);
  });

  it('rotates the whole layout consistently at a non-trivial bearing', () => {
    const placement: SitePlacement = { towerCentreEasting: 0, towerCentreNorthing: 0, bearingDeg: 90 };
    const placed = placeSiteLayout(template, placement);
    const cranePad = placed.points.find((p) => p.name === 'crane_pad_centre')!;
    // local (0,20) at bearing 90 -> (20, 0)
    expect(cranePad.easting).toBeCloseTo(20, 3);
    expect(cranePad.northing).toBeCloseTo(0, 3);
  });
});

describe('planDistance', () => {
  it('computes straight-line distance (3-4-5 triangle)', () => {
    expect(planDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 5);
  });
});

describe('maxRadiusToFootprint', () => {
  it('returns the distance to the FURTHEST corner, not the nearest or the centre', () => {
    const standPoint = { x: 0, y: 0 };
    const corners = [
      { x: 5, y: 0 }, // distance 5
      { x: 10, y: 0 }, // distance 10 <- furthest
      { x: 3, y: 0 }, // distance 3
    ];
    expect(maxRadiusToFootprint(standPoint, corners)).toBeCloseTo(10, 5);
  });

  it('throws rather than silently returning 0 for an empty footprint', () => {
    expect(() => maxRadiusToFootprint({ x: 0, y: 0 }, [])).toThrow(RangeError);
  });
});
