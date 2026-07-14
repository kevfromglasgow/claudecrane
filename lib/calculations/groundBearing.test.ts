import { describe, it, expect } from 'vitest';
import { totalRiggedWeight, maxOutriggerLoading, requiredMatArea, matLoading, checkGroundBearing } from './groundBearing';

describe('totalRiggedWeight (Scenario 6 step 13)', () => {
  it('computes 93T for a 60T-rigged crane (9T base) needing 42T counterweight', () => {
    // Confirmed: the Scenario 6 instructions state this step as
    // "60T + 33T = 99T", which is a typo in the source document —
    // 60 + 33 = 93, not 99. This function implements the correct sum.
    expect(totalRiggedWeight(60, 9, 42)).toBe(93);
  });

  it('rejects a required counterweight below the base counterweight', () => {
    expect(() => totalRiggedWeight(60, 9, 5)).toThrow(RangeError);
  });
});

describe('maxOutriggerLoading (Scenario 6 step 14)', () => {
  it('reproduces 80.956T for 99T rigged weight and 6.706T gross load', () => {
    expect(maxOutriggerLoading(99, 6.706)).toBeCloseTo(80.956, 3);
  });
});

describe('requiredMatArea (Scenario 6 step 15)', () => {
  it('reproduces 3.24 m2 at 25 t/m2 GBP limit', () => {
    expect(requiredMatArea(80.956, 25)).toBeCloseTo(3.2382, 3);
  });

  it('rejects a non-positive ground bearing pressure limit', () => {
    expect(() => requiredMatArea(80.956, 0)).toThrow(RangeError);
  });
});

describe('matLoading (Scenario 6 step 16)', () => {
  it('reproduces 20.239 t/m2 for a 4 m2 mat', () => {
    expect(matLoading(80.956, 4)).toBeCloseTo(20.239, 3);
  });

  it('rejects a non-positive mat area', () => {
    expect(() => matLoading(80.956, 0)).toThrow(RangeError);
  });
});

describe('checkGroundBearing end-to-end (full Scenario 6 reproduction, arithmetic-corrected)', () => {
  it('passes for the Scenario 6 configuration, using the mathematically correct rigged weight', () => {
    // Scenario 6's own downstream figures (80.956T, 3.24m2, 20.239t/m2)
    // were built on its step-13 arithmetic error (60+33 stated as 99
    // instead of 93) — see totalRiggedWeight's test above. This test
    // uses the corrected chain throughout so every step is internally
    // consistent: 0.75*93+6.706=76.456, 76.456/25=3.058, 76.456/4=19.114.
    const result = checkGroundBearing({
      baseRiggedWeightTonnes: 60,
      baseCounterweightTonnes: 9,
      requiredCounterweightTonnes: 42,
      grossLoadTonnes: 6.706,
      groundBearingPressureLimitTonnesPerM2: 25,
      selectedMatAreaM2: 4,
    });

    expect(result.totalRiggedWeightTonnes).toBe(93);
    expect(result.maxOutriggerLoadingTonnes).toBeCloseTo(76.456, 3);
    expect(result.requiredMatAreaM2).toBeCloseTo(3.058, 3);
    expect(result.matLoadingTonnesPerM2).toBeCloseTo(19.114, 3);
    expect(result.passes).toBe(true);
  });

  it('fails when the selected mat is too small for the required area', () => {
    const result = checkGroundBearing({
      baseRiggedWeightTonnes: 60,
      baseCounterweightTonnes: 9,
      requiredCounterweightTonnes: 42,
      grossLoadTonnes: 6.706,
      groundBearingPressureLimitTonnesPerM2: 25,
      selectedMatAreaM2: 2, // deliberately undersized vs the ~3.06 m2 required
    });
    expect(result.passes).toBe(false);
  });

  it('never silently accepts a ground bearing pressure of zero or less', () => {
    expect(() =>
      checkGroundBearing({
        baseRiggedWeightTonnes: 60,
        baseCounterweightTonnes: 9,
        requiredCounterweightTonnes: 42,
        grossLoadTonnes: 6.706,
        groundBearingPressureLimitTonnesPerM2: 0,
        selectedMatAreaM2: 4,
      })
    ).toThrow(RangeError);
  });
});
