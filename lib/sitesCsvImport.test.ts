import { describe, it, expect } from 'vitest';
import { parseSitesCsv } from './sitesCsvImport';

const HEADER = 'Label,Tower family,Height variant,Leg Extension';

describe('parseSitesCsv', () => {
  it('resolves a well-formed row using exact family/variant/leg values', () => {
    const csv = `${HEADER}\nSite 1,AS4_AD,STD,+0`;
    const results = parseSitesCsv(csv);
    expect(results).toHaveLength(1);
    expect(results[0].errors).toEqual([]);
    expect(results[0].resolved).toEqual({
      label: 'Site 1',
      familyId: 'AS4_AD',
      variantId: 'STD',
      legExtensionDeltaM: 0,
    });
  });

  it('is forgiving of spacing/casing/underscore differences in the family name', () => {
    const variants = ['AS4 AD', 'as4_ad', 'AS4-AD', 'AS4 AD Type Tower (0-2 deg)'];
    for (const familyText of variants) {
      const csv = `${HEADER}\nSite 1,${familyText},STD,0`;
      const results = parseSitesCsv(csv);
      expect(results[0].errors, `failed for input "${familyText}"`).toEqual([]);
      expect(results[0].resolved?.familyId).toBe('AS4_AD');
    }
  });

  it('parses leg extension values in several common formats', () => {
    const formats = ['+3', '+3m', '3', '3M'];
    for (const legText of formats) {
      const csv = `${HEADER}\nSite 1,AS4_AD,STD,${legText}`;
      const results = parseSitesCsv(csv);
      expect(results[0].errors, `failed for leg input "${legText}"`).toEqual([]);
      expect(results[0].resolved?.legExtensionDeltaM).toBe(3);
    }
  });

  it('parses the ±0m leg extension label correctly', () => {
    const csv = `${HEADER}\nSite 1,AS4_AD,STD,±0M LEG EXTENSION`;
    const results = parseSitesCsv(csv);
    expect(results[0].errors).toEqual([]);
    expect(results[0].resolved?.legExtensionDeltaM).toBe(0);
  });

  it('reports a clear error for an unknown tower family rather than silently skipping', () => {
    const csv = `${HEADER}\nSite 1,NOT_A_REAL_FAMILY,STD,0`;
    const results = parseSitesCsv(csv);
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].errors[0]).toMatch(/doesn't match any known tower family/);
  });

  it('reports a clear error for an unknown height variant', () => {
    const csv = `${HEADER}\nSite 1,AS4_AD,E99,0`;
    const results = parseSitesCsv(csv);
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].errors[0]).toMatch(/doesn't match any height variant/);
  });

  it('reports a clear error for an unpublished leg extension delta', () => {
    const csv = `${HEADER}\nSite 1,AS4_AD,STD,+99`;
    const results = parseSitesCsv(csv);
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].errors[0]).toMatch(/not published/);
  });

  it('reports an empty-label error without blocking other row checks', () => {
    const csv = `${HEADER}\n,AS4_AD,STD,0`;
    const results = parseSitesCsv(csv);
    expect(results[0].errors).toContain('Label is empty');
  });

  it('flags a stub family (no height variant data) with a clear message', () => {
    const csv = `${HEADER}\nSite 1,AS4_ADJ,STD,0`;
    const results = parseSitesCsv(csv);
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].errors.join(' ')).toMatch(/no height variant data loaded yet/);
  });

  it('processes multiple rows independently, mixing valid and invalid', () => {
    const csv = `${HEADER}\nGood Site,AS4_AD,STD,0\nBad Site,NOPE,STD,0\nAnother Good,AS4_BD,M3,+3`;
    const results = parseSitesCsv(csv);
    expect(results).toHaveLength(3);
    expect(results[0].resolved).toBeDefined();
    expect(results[1].resolved).toBeUndefined();
    expect(results[2].resolved).toBeDefined();
    expect(results[2].resolved?.familyId).toBe('AS4_BD');
  });

  it('numbers rows correctly matching spreadsheet row numbers (header = row 1)', () => {
    const csv = `${HEADER}\nSite 1,AS4_AD,STD,0\nSite 2,AS4_AD,STD,0`;
    const results = parseSitesCsv(csv);
    expect(results[0].rowNumber).toBe(2);
    expect(results[1].rowNumber).toBe(3);
  });
});
