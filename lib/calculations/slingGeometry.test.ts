import { describe, it, expect } from 'vitest';
import {
  getCapacityModeFactor,
  getLengthModeFactor,
  liftPointDiagonal,
  requiredSlingLengthFromDiagonal,
  requiredSlingLengthFromAngleShortcut,
  requiredCapacityPerLeg,
  slingVerticalHeight,
  getFlatSlingMethodFactor,
  adjustedFlatSlingWll,
  applyAdditionalFactorOfSafety,
  OutOfRangeError,
} from './slingGeometry';

describe('capacity mode factors', () => {
  it('matches the Sibbald reference card exactly for every legs/angle combo', () => {
    expect(getCapacityModeFactor(2, 90)).toBe(1.4);
    expect(getCapacityModeFactor(2, 120)).toBe(1.0);
    expect(getCapacityModeFactor(3, 90)).toBe(2.1);
    expect(getCapacityModeFactor(3, 120)).toBe(1.5);
    expect(getCapacityModeFactor(4, 90)).toBe(2.1);
    expect(getCapacityModeFactor(4, 120)).toBe(1.5);
  });
});

describe('length mode factors (angle-based shortcut table)', () => {
  it('matches the Sibbald reference card', () => {
    expect(getLengthModeFactor(30)).toEqual({ angleFromVerticalDeg: 30, operation: 'multiply', modeFactor: 2 });
    expect(getLengthModeFactor(60)).toEqual({ angleFromVerticalDeg: 60, operation: 'multiply', modeFactor: 1 });
    expect(getLengthModeFactor(90)).toEqual({ angleFromVerticalDeg: 90, operation: 'divide', modeFactor: 1.4 });
    expect(getLengthModeFactor(120)).toEqual({ angleFromVerticalDeg: 120, operation: 'divide', modeFactor: 1.7 });
  });
});

describe('Path A: Pythagoras diagonal + capacity mode factor (Scenario 6 worked example)', () => {
  // Scenario 6: 2.4m x 2.4m square load, 4-leg chains, angle not
  // exceeding 90 degrees.
  it('reproduces the 3.39m diagonal exactly', () => {
    const diagonal = liftPointDiagonal(2.4, 2.4);
    expect(diagonal).toBeCloseTo(3.394, 3);
  });

  it('reproduces the 2.42m required sling length exactly (3.39m \u00f7 1.4, the length-table factor)', () => {
    // CORRECTED: sling length always uses the LENGTH mode factor table
    // (angle-from-vertical based), never the capacity table. Scenario 6
    // step 3 labels its factor "2.1" but that's a mislabel — 2.1 is the
    // CAPACITY table's 4-leg/90\u00b0 factor (used later, correctly, in step
    // 5 for accessory sizing). The length table's 90\u00b0 factor is 1.4,
    // and 3.39 / 1.4 = 2.421..., which matches the document's stated
    // 2.42m exactly once the correct table is used.
    const diagonal = 3.39; // as rounded in the instructions
    const slingLength = requiredSlingLengthFromDiagonal(diagonal, 90);
    expect(slingLength).toBeCloseTo(2.421, 2);
  });

  it('reproduces the 5.75m vertical chain height from the worked example', () => {
    // Scenario 6 step 10: 6m diagonal chain length, half-base 1.695m.
    // The instructions round intermediate values (3.394->3.39->half
    // 1.695, rather than carrying full precision), so this checks to
    // 1 decimal place rather than demanding exact reproduction of a
    // rounding-drifted figure.
    const height = slingVerticalHeight(6, 1.695);
    expect(height).toBeCloseTo(5.75, 1);
  });
});

describe('Path B: angle-based length shortcut', () => {
  it('multiplies for shallow angles (30deg) and divides for steep angles (90/120deg)', () => {
    expect(requiredSlingLengthFromAngleShortcut(2, 30)).toBeCloseTo(4, 5); // 2 * 2
    expect(requiredSlingLengthFromAngleShortcut(2, 60)).toBeCloseTo(2, 5); // 2 * 1
    expect(requiredSlingLengthFromAngleShortcut(2.8, 90)).toBeCloseTo(2.8 / 1.4, 5);
    expect(requiredSlingLengthFromAngleShortcut(3.4, 120)).toBeCloseTo(3.4 / 1.7, 5);
  });
});

describe('required capacity per leg (uniform load method)', () => {
  it('reproduces the Sibbald worked example: 8t load, 90deg, 2 legs -> 5.71t per leg', () => {
    // Sibbald card example: "Accessories required: 2" -> this is a
    // 2-LEG lift (mode factor 1.4 at <=90deg), not 4-leg.
    const perLeg = requiredCapacityPerLeg(8, 2, 90);
    expect(perLeg).toBeCloseTo(5.714, 3);
  });

  it('reproduces Scenario 6 step 5: 6.4t load, 90deg, 4 legs (shackles) -> 3.05t', () => {
    // Note: Scenario 6 actually divides by mode factor 2.1 to get
    // 6.4 / 2.1 = 3.047..., rounds to 3.05t in the instructions.
    const perLeg = requiredCapacityPerLeg(6.4, 4, 90);
    expect(perLeg).toBeCloseTo(3.048, 2);
  });

  it('throws for an unpublished angle band rather than guessing', () => {
    // @ts-expect-error intentionally invalid angle for the runtime check
    expect(() => requiredCapacityPerLeg(10, 4, 45)).toThrow(OutOfRangeError);
  });
});

describe('flat/endless sling method-of-use factors', () => {
  it('matches the Sibbald WLL table for a straight lift (M=1.0)', () => {
    const entry = getFlatSlingMethodFactor('straight', false);
    expect(entry.mFactor).toBe(1.0);
  });

  it('matches for a choked basket hitch at 7-45deg (M=1.4)', () => {
    const entry = getFlatSlingMethodFactor('basket', false, '7-45');
    expect(entry.mFactor).toBe(1.4);
  });

  it('computes adjusted WLL correctly (e.g. 8000kg straight-lift sling in a basket hitch up to 7deg -> 16000kg equivalent)', () => {
    const adjustedTonnes = adjustedFlatSlingWll(8, 'basket', false, '0-7');
    expect(adjustedTonnes).toBeCloseTo(16, 5);
  });
});

describe('additional factor of safety', () => {
  it('applies a user-specified multiplier on top of the mode-factor result', () => {
    const base = 3.05;
    const withFos = applyAdditionalFactorOfSafety(base, 1.1);
    expect(withFos).toBeCloseTo(3.355, 3);
  });

  it('defaults to no change when no factor is supplied', () => {
    expect(applyAdditionalFactorOfSafety(5)).toBe(5);
  });

  it('rejects a non-positive factor', () => {
    expect(() => applyAdditionalFactorOfSafety(5, 0)).toThrow(RangeError);
  });
});
