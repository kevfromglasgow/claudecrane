import { describe, it, expect } from 'vitest';
import craneData from '../../data/cranes/ltm-1130-5.1.json';
import {
  interpolateCapacity,
  isRadiusInChartRange,
  boomTipHeight,
  ropeOut,
  evaluateConfiguration,
  findValidConfigurations,
  rankConfigurations,
  OutOfChartRangeError,
} from './craneCapacity';
import type { CraneModel } from '../types';

const crane = craneData as unknown as CraneModel;

function getBoom(counterweightTonnes: number, boomLengthM: number) {
  const cw = crane.counterweights.find((c) => c.weightTonnes === counterweightTonnes)!;
  return cw.boomConfigs.find((b) => b.boomLengthM === boomLengthM && b.orientation === undefined)!;
}

describe('interpolateCapacity', () => {
  it('returns the exact published value at a known radius (real LTM 1130-5.1 data)', () => {
    const boom = getBoom(42, 47.5);
    // Verified real value from the CSV: 47.5m boom, no jib, 22m radius = 11.9t
    expect(interpolateCapacity(boom.capacities, 22)).toBeCloseTo(11.9, 5);
  });

  it('interpolates linearly between two published points', () => {
    const points = [
      { radiusM: 20, capacityTonnes: 10 },
      { radiusM: 30, capacityTonnes: 20 },
    ];
    expect(interpolateCapacity(points, 25)).toBeCloseTo(15, 5);
    expect(interpolateCapacity(points, 22)).toBeCloseTo(12, 5);
  });

  it('throws rather than extrapolating below the minimum published radius', () => {
    const boom = getBoom(42, 47.5);
    const minRadius = Math.min(...boom.capacities.map((p) => p.radiusM));
    expect(() => interpolateCapacity(boom.capacities, minRadius - 1)).toThrow(OutOfChartRangeError);
  });

  it('throws rather than extrapolating above the maximum published radius', () => {
    const boom = getBoom(42, 47.5);
    const maxRadius = Math.max(...boom.capacities.map((p) => p.radiusM));
    expect(() => interpolateCapacity(boom.capacities, maxRadius + 1)).toThrow(OutOfChartRangeError);
  });

  it('throws for a configuration with no published points at all', () => {
    expect(() => interpolateCapacity([], 10)).toThrow(OutOfChartRangeError);
  });
});

describe('isRadiusInChartRange', () => {
  it('correctly reports in/out of range', () => {
    const points = [
      { radiusM: 5, capacityTonnes: 50 },
      { radiusM: 10, capacityTonnes: 20 },
    ];
    expect(isRadiusInChartRange(points, 7)).toBe(true);
    expect(isRadiusInChartRange(points, 5)).toBe(true);
    expect(isRadiusInChartRange(points, 10)).toBe(true);
    expect(isRadiusInChartRange(points, 4.9)).toBe(false);
    expect(isRadiusInChartRange(points, 10.1)).toBe(false);
    expect(isRadiusInChartRange([], 5)).toBe(false);
  });
});

describe('boomTipHeight', () => {
  it('computes tip height via right-triangle geometry', () => {
    expect(boomTipHeight(50, 30)).toBeCloseTo(40, 5); // 3-4-5 triangle x10
  });

  it('throws when radius exceeds boom length', () => {
    expect(() => boomTipHeight(20, 25)).toThrow(RangeError);
  });
});

describe('ropeOut', () => {
  it('multiplies parts of line by vertical rope run', () => {
    expect(ropeOut(4, 10)).toBe(40);
  });

  it('rejects non-positive parts of line', () => {
    expect(() => ropeOut(0, 10)).toThrow(RangeError);
  });
});

describe('evaluateConfiguration (real LTM 1130-5.1 jib config from Scenario 6)', () => {
  it('reproduces the verified 8.6t @ 22m radius for 47.5m boom + 10.8m jib @ 20deg', () => {
    const boom = getBoom(42, 47.5);
    const jib = boom.jibs!.find((j) => j.jibLengthM === 10.8 && j.offsetDeg === 20)!;

    const result = evaluateConfiguration({
      craneModel: crane.craneModel,
      counterweightId: 'cw_42t',
      boom,
      jib,
      radiusM: 22,
      requiredHookHeightM: 15, // arbitrary for this geometry-focused test
      grossLoadTonnes: 6.706, // Scenario 6's revised gross load
      utilisationThresholdPercent: 80,
      totalRopeLengthM: crane.totalRopeLengthM,
      partsOfLine: 1,
      hookToLoadGapM: 2,
      minSafeTwoBlockingGapM: 1,
    });

    expect(result.ratedCapacityAtRadiusTonnes).toBeCloseTo(8.6, 5);
    // Scenario 6: 6.706 / 8.6 * 100 = 77.9% < 80% -> passes
    expect(result.utilisationPercent).toBeCloseTo(77.9, 0);
    expect(result.passesUtilisation).toBe(true);
    expect(result.outOfChartRange).toBe(false);
  });

  it('flags out-of-chart-range radii instead of guessing a capacity', () => {
    const boom = getBoom(42, 47.5);
    const result = evaluateConfiguration({
      craneModel: crane.craneModel,
      counterweightId: 'cw_42t',
      boom,
      radiusM: 9999,
      requiredHookHeightM: 15,
      grossLoadTonnes: 5,
      utilisationThresholdPercent: 80,
      totalRopeLengthM: crane.totalRopeLengthM,
      partsOfLine: 1,
      hookToLoadGapM: 2,
      minSafeTwoBlockingGapM: 1,
    });
    expect(result.outOfChartRange).toBe(true);
    expect(result.ratedCapacityAtRadiusTonnes).toBe(0);
    expect(result.passesUtilisation).toBe(false);
  });

  it('flags a two-blocking risk when the hook-to-load gap is below the safe minimum', () => {
    const boom = getBoom(42, 47.5);
    const result = evaluateConfiguration({
      craneModel: crane.craneModel,
      counterweightId: 'cw_42t',
      boom,
      radiusM: 22,
      requiredHookHeightM: 10,
      grossLoadTonnes: 5,
      utilisationThresholdPercent: 80,
      totalRopeLengthM: crane.totalRopeLengthM,
      partsOfLine: 1,
      hookToLoadGapM: 0.3,
      minSafeTwoBlockingGapM: 1,
    });
    expect(result.twoBlockingRisk).toBe(true);
  });

  it('flags a boom-foul violation when required hook height exceeds achievable tip height', () => {
    const boom = getBoom(42, 47.5);
    const tip = boomTipHeight(47.5, 22);
    const result = evaluateConfiguration({
      craneModel: crane.craneModel,
      counterweightId: 'cw_42t',
      boom,
      radiusM: 22,
      requiredHookHeightM: tip + 10, // deliberately unreachable
      grossLoadTonnes: 5,
      utilisationThresholdPercent: 80,
      totalRopeLengthM: crane.totalRopeLengthM,
      partsOfLine: 1,
      hookToLoadGapM: 2,
      minSafeTwoBlockingGapM: 1,
    });
    expect(result.boomFoulViolation).toBe(true);
  });
});

describe('findValidConfigurations + rankConfigurations', () => {
  it('finds at least the known-good 42t/47.5m/10.8m-jib-20deg configuration for a light load at 22m radius', () => {
    const hookBlock = crane.hookBlocks.find((h) => h.id === 'hb_26_1t')!;
    const cw42Id = crane.counterweights.find((c) => c.weightTonnes === 42)!.id;
    const results = findValidConfigurations({
      crane,
      radiusM: 22,
      requiredHookHeightM: 10,
      grossLoadTonnes: 6.706,
      hookBlock,
      partsOfLine: 1,
      hookToLoadGapM: 2,
    });

    const match = results.find(
      (r) => r.counterweightId === cw42Id && r.boomLengthM === 47.5 && r.jib?.lengthM === 10.8 && r.jib?.offsetDeg === 20
    );
    expect(match).toBeDefined();
    expect(match!.ratedCapacityAtRadiusTonnes).toBeCloseTo(8.6, 5);
  });

  it('never returns a configuration whose rated capacity is below the gross load', () => {
    const hookBlock = crane.hookBlocks.find((h) => h.id === 'hb_110t')!;
    const results = findValidConfigurations({
      crane,
      radiusM: 22,
      requiredHookHeightM: 10,
      grossLoadTonnes: 6.706,
      hookBlock,
      partsOfLine: 1,
      hookToLoadGapM: 2,
    });
    for (const r of results) {
      expect(r.ratedCapacityAtRadiusTonnes).toBeGreaterThanOrEqual(6.706);
    }
  });

  it('rankConfigurations sorts shortest boom (and no-jib before jib) first', () => {
    const hookBlock = crane.hookBlocks.find((h) => h.id === 'hb_110t')!;
    const results = findValidConfigurations({
      crane,
      radiusM: 10,
      requiredHookHeightM: 8,
      grossLoadTonnes: 3,
      hookBlock,
      partsOfLine: 1,
      hookToLoadGapM: 2,
    });
    const ranked = rankConfigurations(results);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].boomLengthM).toBeGreaterThanOrEqual(ranked[i - 1].boomLengthM);
    }
  });
});
