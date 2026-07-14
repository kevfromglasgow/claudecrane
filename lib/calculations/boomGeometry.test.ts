import { describe, it, expect } from 'vitest';
import {
  computeBoomPose,
  computeBoomJibPose,
  distancePointToSegment,
  checkBoomFoul,
  checkTwoBlocking,
  GeometryError,
} from './boomGeometry';

describe('computeBoomPose', () => {
  it('reproduces a 3-4-5 right triangle (boom 50m, radius 30m -> tip height 40m)', () => {
    const pose = computeBoomPose(50, 30);
    expect(pose.boomTip.y).toBeCloseTo(40, 5);
    expect(pose.boomTip.x).toBeCloseTo(30, 5);
    expect(pose.boomAngleDeg).toBeCloseTo(53.13, 1);
  });

  it('a vertical boom (radius 0) reaches full boom length in height', () => {
    const pose = computeBoomPose(40, 0);
    expect(pose.boomTip.y).toBeCloseTo(40, 5);
    expect(pose.boomAngleDeg).toBeCloseTo(90, 5);
  });

  it('a fully horizontal boom (radius = boom length) has zero height gain', () => {
    const pose = computeBoomPose(40, 40);
    expect(pose.boomTip.y).toBeCloseTo(0, 5);
    expect(pose.boomAngleDeg).toBeCloseTo(0, 5);
  });

  it('throws when radius exceeds boom length', () => {
    expect(() => computeBoomPose(20, 25)).toThrow(GeometryError);
  });

  it('applies the boom base height offset', () => {
    const pose = computeBoomPose(50, 30, 2.3);
    expect(pose.boomTip.y).toBeCloseTo(42.3, 5);
    expect(pose.boomBase.y).toBe(2.3);
  });
});

describe('computeBoomJibPose', () => {
  it('at 0deg offset, the jib continues in a straight line from the boom (equivalent to one longer boom)', () => {
    // With 0 deg offset, boom+jib in a straight line should behave
    // exactly like a single boom of length (boomLength + jibLength)
    // at the same radius.
    const totalLength = 47.5 + 10.8;
    const straightBoom = computeBoomPose(totalLength, 30);
    const boomJib = computeBoomJibPose(47.5, 10.8, 0, 30);

    expect(boomJib.jibTip.x).toBeCloseTo(straightBoom.boomTip.x, 3);
    expect(boomJib.jibTip.y).toBeCloseTo(straightBoom.boomTip.y, 3);
    expect(boomJib.boomAngleDeg).toBeCloseTo(straightBoom.boomAngleDeg, 3);
  });

  it('a folded jib (20deg offset) sits at a shallower absolute angle than the boom', () => {
    const pose = computeBoomJibPose(47.5, 10.8, 20, 22);
    expect(pose.jibAngleDeg).toBeCloseTo(pose.boomAngleDeg - 20, 3);
  });

  it('reaches the exact target radius at the combined jib tip', () => {
    const pose = computeBoomJibPose(47.5, 10.8, 20, 22);
    expect(pose.jibTip.x).toBeCloseTo(22, 3);
  });

  it('throws when the requested radius exceeds the maximum possible combined reach', () => {
    expect(() => computeBoomJibPose(10, 5, 0, 100)).toThrow(GeometryError);
  });
});

describe('distancePointToSegment', () => {
  it('returns perpendicular distance when the closest point is mid-segment', () => {
    const d = distancePointToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(5, 5);
  });

  it('returns distance to the nearest endpoint when the closest point is off the segment', () => {
    const d = distancePointToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(5, 5); // 3-4-5 triangle to the (0,0) endpoint
  });

  it('handles a degenerate (zero-length) segment as a point-to-point distance', () => {
    const d = distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(d).toBeCloseTo(5, 5);
  });
});

describe('checkBoomFoul', () => {
  it('flags a violation when an envelope point sits closer than the minimum clearance to the boom line', () => {
    const pose = computeBoomPose(50, 30); // tip at (30, 40)
    const result = checkBoomFoul({
      pose,
      envelopePoints: [{ x: 15, y: 20.5 }], // sits essentially ON the boom line (midpoint is (15,20))
      minClearanceM: 2,
    });
    expect(result.minClearanceFoundM).toBeLessThan(2);
    expect(result.violatesMinimum).toBe(true);
  });

  it('does not flag a violation when the envelope is comfortably clear', () => {
    const pose = computeBoomPose(50, 30);
    const result = checkBoomFoul({
      pose,
      envelopePoints: [{ x: 5, y: 0 }], // load sitting on the ground, well clear of the boom line
      minClearanceM: 2,
    });
    expect(result.violatesMinimum).toBe(false);
  });

  it('checks both the boom AND jib segments when a jib is fitted', () => {
    const pose = computeBoomJibPose(47.5, 10.8, 20, 22);
    // a point right at the jib tip should have ~zero clearance to the jib segment
    const result = checkBoomFoul({
      pose,
      envelopePoints: [pose.jibTip],
      minClearanceM: 1,
    });
    expect(result.minClearanceFoundM).toBeCloseTo(0, 3);
  });
});

describe('checkTwoBlocking', () => {
  it('reproduces a safe (non-violating) configuration with a clear gap', () => {
    const result = checkTwoBlocking({
      ropeFromPoint: { x: 22, y: 50 },
      currentLoadHeightAboveGroundM: 10,
      loadHeightM: 3.25,
      riggingVerticalHeightM: 5.75,
      hookBlockLengthM: 1,
      overhoistProtectionM: 1,
      assumedDeflectionM: 2,
    });
    // top of rigging = 10 + 3.25 + 5.75 = 19; hook block bottom = 50 - (1+1+2) = 46
    // gap = 46 - 19 = 27 -> safe
    expect(result.remainingGapM).toBeCloseTo(27, 3);
    expect(result.twoBlockingRisk).toBe(false);
  });

  it('flags a two-blocking risk when the load is hoisted close to the tip', () => {
    const result = checkTwoBlocking({
      ropeFromPoint: { x: 22, y: 20 },
      currentLoadHeightAboveGroundM: 10,
      loadHeightM: 3.25,
      riggingVerticalHeightM: 5.75,
      hookBlockLengthM: 1,
      overhoistProtectionM: 1,
      assumedDeflectionM: 2,
    });
    // top of rigging = 19; hook block bottom = 20 - 4 = 16 -> gap = -3, definitely a risk
    expect(result.remainingGapM).toBeLessThan(1);
    expect(result.twoBlockingRisk).toBe(true);
  });
});
