// ============================================================
// lib/towerFamilies.ts
//
// Static registry of every tower family fixture, for use in
// site-creation pickers. Bundled at build time (these are just JSON
// imports), no runtime fetch needed — matches the "static data
// ships with the app" decision from the original brief.
// ============================================================

import asAd from '../data/tower-families/as4-ad.json';
import asBd from '../data/tower-families/as4-bd.json';
import asAd10 from '../data/tower-families/as4-ad10.json';
import asAd25 from '../data/tower-families/as4-ad25.json';
import asAd55 from '../data/tower-families/as4-ad55.json';
import asAd90 from '../data/tower-families/as4-ad90.json';
import asAdj from '../data/tower-families/as4-adj.json';
import asAdt from '../data/tower-families/as4-adt.json';
import type { TowerFamily } from './types';

export const TOWER_FAMILIES: TowerFamily[] = [
  asAd,
  asBd,
  asAd10,
  asAd25,
  asAd55,
  asAd90,
  asAdj,
  asAdt,
] as unknown as TowerFamily[];

export function getTowerFamily(familyId: string): TowerFamily | undefined {
  return TOWER_FAMILIES.find((f) => f.familyId === familyId);
}
