import { describe, it, expect } from 'vitest';
import {
  rotateLocalOffset,
  placeLocalPoint,
  placeSiteLayout,
  planDistance,
  maxRadiusToFootprint,
  bearingBetween,
  bisectorBearing,
  derivePlacementBearing,
  BearingError,
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

describe('bearingBetween', () => {
  it('due north is bearing 0', () => {
    expect(bearingBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0, 5);
  });
  it('due east is bearing 90', () => {
    expect(bearingBetween({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 5);
  });
  it('due south is bearing 180', () => {
    expect(bearingBetween({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(180, 5);
  });
  it('due west is bearing 270', () => {
    expect(bearingBetween({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(270, 5);
  });
  it('throws for two identical points', () => {
    expect(() => bearingBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toThrow(BearingError);
  });
});

describe('bisectorBearing', () => {
  it('two identical bearings bisect to themselves (a dead-straight suspension tower)', () => {
    expect(bisectorBearing(45, 45)).toBeCloseTo(45, 5);
  });

  it('a symmetric 90deg bend (0 and 90) bisects to 45', () => {
    expect(bisectorBearing(0, 90)).toBeCloseTo(45, 5);
  });

  it('correctly handles wraparound across 0/360 (350 and 10 should bisect to 0, NOT the naive average of 180)', () => {
    expect(bisectorBearing(350, 10)).toBeCloseTo(0, 3);
  });

  it('a near-straight-through tower (small deviation) bisects close to the shared direction', () => {
    // e.g. an AD10 tower deviating slightly: incoming 88, outgoing 92
    expect(bisectorBearing(88, 92)).toBeCloseTo(90, 5);
  });

  it('throws for exactly opposite bearings (undefined 180deg bisector)', () => {
    expect(() => bisectorBearing(0, 180)).toThrow(BearingError);
    expect(() => bisectorBearing(45, 225)).toThrow(BearingError);
  });
});

describe('derivePlacementBearing', () => {
  it('uses the bisector when both previous and next tower coordinates are known', () => {
    // previous tower due south, next tower due east -> incoming bearing
    // (south->this, i.e. heading north) = 0, outgoing (this->east) = 90
    // -> bisector 45
    const bearing = derivePlacementBearing({
      previousTower: { x: 0, y: -100 },
      thisTower: { x: 0, y: 0 },
      nextTower: { x: 100, y: 0 },
    });
    expect(bearing).toBeCloseTo(45, 3);
  });

  it('falls back to the single known span for a terminal tower (next only)', () => {
    const bearing = derivePlacementBearing({
      thisTower: { x: 0, y: 0 },
      nextTower: { x: 0, y: 100 },
    });
    expect(bearing).toBeCloseTo(0, 5);
  });

  it('falls back to the single known span for a terminal tower (previous only)', () => {
    const bearing = derivePlacementBearing({
      previousTower: { x: -100, y: 0 },
      thisTower: { x: 0, y: 0 },
    });
    expect(bearing).toBeCloseTo(90, 5);
  });

  it('throws when neither adjacent tower is known', () => {
    expect(() => derivePlacementBearing({ thisTower: { x: 0, y: 0 } })).toThrow(BearingError);
  });

  it("a realistic straight-through suspension tower: previous/this/next collinear gives that line's bearing", () => {
    const bearing = derivePlacementBearing({
      previousTower: { x: 0, y: -200 },
      thisTower: { x: 0, y: 0 },
      nextTower: { x: 0, y: 200 },
    });
    expect(bearing).toBeCloseTo(0, 5);
  });
});
