import { describe, it, expect } from 'vitest';
import asAd from '../../data/tower-families/as4-ad.json';
import asBd from '../../data/tower-families/as4-bd.json';
import {
  commonPortionWeight,
  getHeightVariant,
  getLegExtensionOption,
  calculateTowerWeight,
  listLiftableComponents,
  TowerDataError,
} from './towerWeight';
import type { TowerFamily, TowerInstance } from '../types';

const familyAD = asAd as unknown as TowerFamily;
const familyBD = asBd as unknown as TowerFamily;

describe('commonPortionWeight', () => {
  it('reproduces the AS4 AD common portion total exactly (37.657t)', () => {
    expect(commonPortionWeight(familyAD)).toBeCloseTo(37.657, 3);
  });

  it('reproduces the AS4 BD common portion total exactly (31.774t)', () => {
    expect(commonPortionWeight(familyBD)).toBeCloseTo(31.774, 3);
  });
});

describe('getHeightVariant / getLegExtensionOption error handling', () => {
  it('throws a clear error for an unknown variant rather than returning undefined', () => {
    expect(() => getHeightVariant(familyAD, 'E99')).toThrow(TowerDataError);
  });

  it('throws a clear error for an unpublished leg extension delta', () => {
    expect(() => getLegExtensionOption(familyAD, 99)).toThrow(TowerDataError);
  });
});

describe('calculateTowerWeight — every AS4 AD variant reconciles exactly to the printed total at ±0m legs', () => {
  const variantIds = ['M3', 'STD', 'E3', 'E6', 'E9', 'E12', 'E15'];

  for (const variantId of variantIds) {
    it(`${variantId} matches its printed total exactly`, () => {
      const breakdown = calculateTowerWeight(familyAD, variantId, 0);
      expect(breakdown.reconcilesWithPrintedTotal).toBe(true);
      expect(breakdown.totalTonnes).toBeCloseTo(breakdown.printedTotalTonnes!, 3);
    });
  }
});

describe('calculateTowerWeight — every AS4 BD variant reconciles exactly to the printed total at ±0m legs', () => {
  const variantIds = ['M3', 'STD', 'E3', 'E6', 'E9', 'E12', 'E15'];

  for (const variantId of variantIds) {
    it(`${variantId} matches its printed total exactly`, () => {
      const breakdown = calculateTowerWeight(familyBD, variantId, 0);
      expect(breakdown.reconcilesWithPrintedTotal).toBe(true);
      expect(breakdown.totalTonnes).toBeCloseTo(breakdown.printedTotalTonnes!, 3);
    });
  }
});

describe('calculateTowerWeight — leg extension is always applied, never treated as zero', () => {
  it('a ±0m selection adds the ±0m leg weight, not nothing', () => {
    const breakdown = calculateTowerWeight(familyAD, 'STD', 0);
    // ±0m option: 913kg x 4 legs = 3.652t
    expect(breakdown.legExtensionTonnes).toBeCloseTo(3.652, 3);
    expect(breakdown.legExtensionTonnes).toBeGreaterThan(0);
  });

  it('defaults to ±0m when no leg extension delta is specified at all', () => {
    const explicit = calculateTowerWeight(familyAD, 'STD', 0);
    const implicit = calculateTowerWeight(familyAD, 'STD');
    expect(implicit.totalTonnes).toBeCloseTo(explicit.totalTonnes, 5);
  });

  it('a +6m selection increases total weight vs ±0m by the correct amount', () => {
    const base = calculateTowerWeight(familyAD, 'STD', 0);
    const extended = calculateTowerWeight(familyAD, 'STD', 6);
    // +6m option: 2022kg x 4 = 8.088t vs ±0m's 3.652t -> diff = 4.436t
    expect(extended.totalTonnes - base.totalTonnes).toBeCloseTo(4.436, 3);
  });
});

describe('calculateTowerWeight — shared bracing item applies only to the correct variants (AS4 AD)', () => {
  it('M3 includes the shared M7.8-level bracing item', () => {
    const breakdown = calculateTowerWeight(familyAD, 'M3', 0);
    expect(breakdown.variantAdditionsTonnes).toBeCloseTo(0.902, 3);
  });

  it('STD does NOT include the shared bracing item (has its own distinct extension instead)', () => {
    const breakdown = calculateTowerWeight(familyAD, 'STD', 0);
    // 3.586 + 1.077 = 4.663, NOT including the 0.902 shared item
    expect(breakdown.variantAdditionsTonnes).toBeCloseTo(4.663, 3);
  });
});

describe('listLiftableComponents (site-based lift picker)', () => {
  const site: TowerInstance = {
    siteId: 'site1',
    label: 'Site 1',
    familyId: 'AS4_AD',
    variantId: 'E6',
    legExtensionDeltaM: 3,
  };

  it('rejects a site whose familyId does not match the supplied family', () => {
    const wrongFamilySite: TowerInstance = { ...site, familyId: 'AS4_BD' };
    expect(() => listLiftableComponents(familyAD, wrongFamilySite)).toThrow(TowerDataError);
  });

  it('includes the common portion, this variant\'s additions, and the leg extension exploded per-leg', () => {
    const items = listLiftableComponents(familyAD, site);

    const commonItems = items.filter((i) => i.source === 'commonPortion');
    const variantItems = items.filter((i) => i.source === 'variantAddition');
    const legItems = items.filter((i) => i.source === 'legExtension');

    expect(commonItems.length).toBe(familyAD.commonPortion.length);
    expect(variantItems.length).toBe(getHeightVariant(familyAD, 'E6').additionalComponents.length);
    // leg extension is exploded into one entry PER PHYSICAL LEG (quantity 4), not one combined entry
    expect(legItems.length).toBe(4);
  });

  it('each exploded leg entry has quantity 1 and the correct per-leg weight', () => {
    const items = listLiftableComponents(familyAD, site);
    const legItems = items.filter((i) => i.source === 'legExtension');
    const legOption = getLegExtensionOption(familyAD, 3);

    for (const item of legItems) {
      expect(item.quantity).toBe(1);
      expect(item.weightTonnes).toBeCloseTo(legOption.unitWeightKg / 1000, 5);
      expect(item.craneLift).toBe(true);
    }
    // ids must be distinct even though the underlying spec is identical
    const ids = new Set(legItems.map((i) => i.id));
    expect(ids.size).toBe(4);
  });

  it('marks bracing items as craneLift=false (greyed out, not selectable) while still listing them', () => {
    const items = listLiftableComponents(familyAD, site);
    const bracingItems = items.filter((i) => i.name.includes('Bracing'));
    expect(bracingItems.length).toBeGreaterThan(0);
    for (const item of bracingItems) {
      expect(item.craneLift).toBe(false);
    }
  });

  it('marks ordinary body-extension items as craneLift=true', () => {
    const items = listLiftableComponents(familyAD, site);
    const bodyExtItems = items.filter((i) => i.name.includes('Body Extn'));
    expect(bodyExtItems.length).toBeGreaterThan(0);
    for (const item of bodyExtItems) {
      expect(item.craneLift).toBe(true);
    }
  });

  it('works identically for AS4 BD (a different family) given a matching site', () => {
    const bdSite: TowerInstance = {
      siteId: 'site2',
      label: 'Site 2',
      familyId: 'AS4_BD',
      variantId: 'M3',
      legExtensionDeltaM: 0,
    };
    const items = listLiftableComponents(familyBD, bdSite);
    expect(items.filter((i) => i.source === 'legExtension').length).toBe(4);
  });
});
