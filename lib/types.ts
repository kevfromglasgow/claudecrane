// ============================================================
// lib/types.ts
//
// Core domain types for the OHL lattice tower crane lift
// planning tool. Pure types + documented constants only —
// no React, no I/O. Calculation logic lives in lib/calculations/*
// and imports these types.
// ============================================================

// ------------------------------------------------------------
// Shared primitives
// ------------------------------------------------------------

export interface Dimensions3D {
  lengthM: number;
  widthM: number;
  heightM: number;
}

export interface Point2D {
  x: number;
  y: number;
}

// ------------------------------------------------------------
// TOWER COMPONENT DATABASE
//
// Design decision (see SCHEMA_DECISIONS.md for full rationale):
// One JSON file per tower FAMILY (e.g. "AS4 AD", "AS4 AD10",
// "AS4 AD25", "AS4 AD55", "AS4 AD90", "AS4 ADJ", "AS4 ADT").
// Each family owns:
//   - a commonPortion (base weight, constant across all height
//     variants WITHIN that family, but different BETWEEN families
//     — confirmed from the AS4 weight diagrams: 37,657kg common
//     portion for AS4 AD vs 81,067kg for AS4 AD90, heavier as
//     angle-deviation band increases)
//   - a list of valid heightVariants, each of which ADDS its own
//     named components on top of the common portion (never a
//     linear scale factor — e.g. the E6 variant adds "E6 Body
//     Extn Top 4.5M" + "E6 Body Extn Bottom 4.5M" + specific
//     plan bracing, as distinct line items with their own weights)
//   - a list of legExtensionOptions, independent of height variant,
//     with NON-LINEAR weight deltas per step (confirmed from AS4 AD:
//     -3m=472kg -2m=629kg -1m=767kg ±0m=913kg +1m=1052kg +2m=1242kg
//     +3m=1391kg +4m=1608kg +5m=1912kg +6m=2022kg — deltas between
//     steps are NOT constant, so this must stay a lookup table)
//
// This means: NEVER hardcode a list of valid height variants or
// leg extensions in application logic. Always read family.heightVariants
// and family.legExtensionOptions. Different families have different
// variant sets (e.g. AS4 AD runs M3→STD→E3→E6→E9→E12→E15, while
// AS4 AD10/25/55/90/ADJ/ADT run M6→M3→STD→E3→E6→E9→E12 — a different
// minimum AND maximum). The tower family file is the single source
// of truth for what's valid for that family.
// ------------------------------------------------------------

/** A single physical component: box, panel, cross-arm, extension
 *  piece, or plan bracing item, as it appears on the erection
 *  weight diagrams. */
export interface TowerComponent {
  /** unique within the family, e.g. "e6_body_extn_top_4_5m" */
  id: string;
  /** display name exactly as labelled on the source drawing,
   *  e.g. "E6 Body Extn Top 4.5M" */
  name: string;
  /** unit weight in tonnes (source drawings give kg; convert at
   *  data-entry time and keep tonnes as the app-wide unit) */
  weightTonnes: number;
  /** number required for this variant/family (e.g. leg extensions
   *  are always qty 4 — one per leg — in the source drawings, but
   *  kept explicit rather than assumed) */
  quantity: number;
  dimensions?: Dimensions3D;
  /** number of lift/lug points on this component, if it is itself
   *  liftable as a discrete piece during erection */
  liftPoints?: number;
  /**
   * true (default) if this component is craned into place; false if
   * it's fixed by hand on site (e.g. plan bracing, fixed by linesmen)
   * and should never appear as a selectable crane lift — only shown
   * for reference/erection-sequence context, greyed out in any picker
   * UI. Defaults to true when omitted (most components ARE craned).
   */
  craneLift?: boolean;
  notes?: string;
  /** traceability back to the drawing item reference, e.g. "R" or "S" */
  drawingItemRef?: string;
}

export type TowerCategory = 'suspension' | 'angle' | 'terminal' | 'junction';

/**
 * A height variant of a tower family (e.g. "M3", "STD", "E6", "E12").
 * additionalComponents are ADDED to the family's commonPortion — they
 * are never a multiplier/scale factor on it.
 */
export interface HeightVariant {
  /** e.g. "STD", "E3", "E6", "E9", "E12", "E15", "M3", "M6" */
  variantId: string;
  /** display label, e.g. "STD.HEIGHT", "E6 TOWER" */
  label: string;
  /** overall height in mm, if known from the drawing title block */
  overallHeightMm?: number;
  additionalComponents: TowerComponent[];
  /** total tower weight in kg for this variant, as printed directly
   *  on the source drawing's summary table — useful as a cross-check
   *  against commonPortion + additionalComponents summed manually */
  printedTotalWeightKg?: number;
}

/**
 * Leg extension option, independent of height variant. Always
 * expressed as a delta in metres off the family's standard leg length.
 * Weight deltas are NON-LINEAR (confirmed) — must remain a lookup
 * table, never a per-metre formula.
 */
export interface LegExtensionOption {
  /** e.g. -3, -2, -1, 0, 1, 2, 3, 4, 5, 6 */
  deltaM: number;
  /** e.g. "+2M LEG EXTENSION" */
  label: string;
  /** weight of ONE leg's extension piece, in kg */
  unitWeightKg: number;
  /** number of legs this applies to — always 4 in the source
   *  drawings, kept explicit rather than assumed elsewhere */
  quantity: number;
}

/**
 * A tower family/design. Angle bands are BAND RANGES, not single
 * points, and are DATA — confirmed from your source drawings the
 * valid designations are AD (0-2°), AD10 (0-10°), AD25 (10-25°),
 * AD55 (25-55°), AD90 (55-90°), plus ADJ (junction, up to 45°) and
 * ADT (terminal). Do not hardcode this set anywhere else; this file
 * (or the family's JSON) is the single source of truth.
 */
export interface TowerFamily {
  /** e.g. "AS4_AD", "AS4_AD10", "AS4_ADJ" */
  familyId: string;
  /** e.g. "AS4 AD Type Tower (0-2 deg)" */
  displayName: string;
  category: TowerCategory;
  minAngleDeg: number;
  maxAngleDeg: number;
  /**
   * AD vs BD: same dimensions/geometry, BD is lighter (fewer
   * structural members). CONFIRMED from source drawings: BD only
   * exists for the base 0-2° suspension family — no BD variant is
   * published for AD10/25/55/90/ADJ/ADT. Enforce in validation:
   * structuralGrade === 'BD' is only ever valid when
   * category === 'suspension'. Set to null for families where the
   * AD/BD distinction doesn't apply (terminal/junction).
   */
  structuralGrade: 'AD' | 'BD' | null;
  /** base weight components, constant across all height variants
   *  IN THIS FAMILY, but differs BETWEEN families */
  commonPortion: TowerComponent[];
  /** valid variants for THIS family only — see file-level comment */
  heightVariants: HeightVariant[];
  legExtensionOptions: LegExtensionOption[];
  /** standard leg length in mm (4500mm per source drawings) */
  standardLegMm: number;
  /** traceability, e.g. "TWR_STD-BB-AS4AD-TOW-KLD-S-0003" */
  sourceDrawing?: string;
}

// ------------------------------------------------------------
// RIGGING / ACCESSORIES
// ------------------------------------------------------------

export type SlingType = 'chain' | 'wire_rope' | 'flat_webbing' | 'round_sling';
export type HitchType = 'straight' | 'choke' | 'basket';

export interface RiggingAccessory {
  id: string;
  /** e.g. "6m 4-leg chain set", "4.75t bow shackle" */
  name: string;
  type: SlingType | 'shackle' | 'spreader_beam' | 'other';
  /** rated WLL for straight-lift use — mode factor is applied
   *  separately by the calculation layer, never baked in here */
  wllTonnes: number;
  weightKg: number;
  /** relevant for slings/chains */
  lengthM?: number;
  /** relevant for slings, not shackles */
  hitchType?: HitchType;
  /** if this accessory IS a multi-leg set (e.g. "4-leg chain set") */
  legs?: number;
  notes?: string;
}

// ------------------------------------------------------------
// UNIFORM LOAD METHOD — MODE FACTORS
//
// IMPORTANT: there are two DIFFERENT tables here answering two
// DIFFERENT questions, confirmed against the Sibbald reference
// cards and against the user directly:
//
// 1. CAPACITY mode factors (legs × included-angle band) — used to
//    divide gross load and get the required MINIMUM CAPACITY per
//    single-leg accessory. This is the table used in Scenario 6
//    step 5 (4-leg, angle not exceeding 90° → factor 2.1) and again
//    in step 3 to get required sling length from the Pythagoras
//    diagonal (3.39m ÷ 2.1 = required sling length).
//
// 2. LENGTH mode factors (angle-from-vertical only, not leg-count
//    dependent) — an ALTERNATIVE SHORTCUT that skips doing Pythagoras
//    entirely: given the horizontal lift-point spacing, multiply/
//    divide by this factor directly to get the sling length needed
//    to achieve (not exceed) a target angle. Per user confirmation,
//    this is NOT a competing/conflicting method — it's a faster route
//    to the same kind of answer for people who don't want to compute
//    the 3D diagonal by hand.
//
// The calculation layer should expose BOTH paths for sling-length
// (Pythagoras-diagonal + capacity-factor, OR direct length-table
// shortcut) and let the user pick whichever they want to enter from,
// while always using the CAPACITY table for required accessory WLL.
// ------------------------------------------------------------

export interface CapacityModeFactorEntry {
  legs: 2 | 3 | 4;
  /** the "not exceeding" angle band */
  maxIncludedAngleDeg: 90 | 120;
  modeFactor: number;
}

export interface LengthModeFactorEntry {
  angleFromVerticalDeg: 30 | 60 | 90 | 120;
  operation: 'multiply' | 'divide';
  modeFactor: number;
}

/** Source: Sibbald "Mode factors for capacity ... of accessories"
 *  (left-hand table). Confirmed against Scenario 6 step 5
 *  (4-leg, ≤90° → 2.1) and step 8 (utilisation, unrelated but same
 *  source card). */
export const CAPACITY_MODE_FACTORS: CapacityModeFactorEntry[] = [
  { legs: 2, maxIncludedAngleDeg: 90, modeFactor: 1.4 },
  { legs: 2, maxIncludedAngleDeg: 120, modeFactor: 1.0 },
  { legs: 3, maxIncludedAngleDeg: 90, modeFactor: 2.1 },
  { legs: 3, maxIncludedAngleDeg: 120, modeFactor: 1.5 },
  { legs: 4, maxIncludedAngleDeg: 90, modeFactor: 2.1 },
  { legs: 4, maxIncludedAngleDeg: 120, modeFactor: 1.5 },
];

/** Source: Sibbald "Mode factors for ... length of accessories"
 *  (right-hand table). Shortcut method — see comment block above. */
export const LENGTH_MODE_FACTORS: LengthModeFactorEntry[] = [
  { angleFromVerticalDeg: 30, operation: 'multiply', modeFactor: 2 },
  { angleFromVerticalDeg: 60, operation: 'multiply', modeFactor: 1 },
  { angleFromVerticalDeg: 90, operation: 'divide', modeFactor: 1.4 },
  { angleFromVerticalDeg: 120, operation: 'divide', modeFactor: 1.7 },
];

/**
 * Flat/endless sling WLL-by-method-of-use table (straight lift,
 * choke hitch, basket hitch at various angle bands, straight/choked
 * angled lift). Source: Sibbald "Flat or endless slings rated
 * capacity relating to method of use". Keyed by the sling's rated
 * straight-lift WLL, this gives the M-factor to apply for a given
 * hitch/angle combination.
 */
export interface FlatSlingMethodFactor {
  hitchType: HitchType;
  /** only relevant for basket/angled-lift hitches */
  angleBandDeg?: '0-7' | '7-45' | '45-60';
  /** true if this row is for a 2-sling configuration rather than 1 */
  twoSlings: boolean;
  mFactor: number;
}

export const FLAT_SLING_METHOD_FACTORS: FlatSlingMethodFactor[] = [
  { hitchType: 'straight', twoSlings: false, mFactor: 1.0 },
  { hitchType: 'choke', twoSlings: false, mFactor: 0.8 },
  { hitchType: 'basket', angleBandDeg: '0-7', twoSlings: false, mFactor: 2.0 },
  { hitchType: 'basket', angleBandDeg: '7-45', twoSlings: false, mFactor: 1.4 },
  { hitchType: 'basket', angleBandDeg: '45-60', twoSlings: false, mFactor: 1.0 },
  { hitchType: 'straight', angleBandDeg: '7-45', twoSlings: true, mFactor: 1.4 },
  { hitchType: 'straight', angleBandDeg: '45-60', twoSlings: true, mFactor: 1.0 },
  { hitchType: 'choke', angleBandDeg: '7-45', twoSlings: true, mFactor: 1.12 },
  { hitchType: 'choke', angleBandDeg: '45-60', twoSlings: true, mFactor: 0.8 },
];

// ------------------------------------------------------------
// TOWER INSTANCE ("SITE") AND LIFTABLE COMPONENTS
//
// A TowerInstance ("Site") is a specific real tower: which family,
// which height variant, which leg extension. You define it ONCE per
// physical location, then come back to the planner repeatedly and
// pick a different component of that same tower for each separate
// lift (e.g. today the four leg cones, next week the body extension
// box) — matching how erection actually happens: multiple separate
// crane visits/lifts to build up one tower.
// ------------------------------------------------------------

export interface TowerInstance {
  siteId: string;
  /** human label, e.g. "Site 1" or a real site name */
  label: string;
  familyId: string;
  variantId: string;
  legExtensionDeltaM: number;
  /**
   * Real-world tower centre coordinate and bearing, for placing this
   * site's crane pad / telehandler pad / laydown / footprint via its
   * family's SiteLayoutTemplate (see lib/calculations/siteGeometry.ts).
   * Optional since not every site will have surveyed geometry entered
   * yet — sites without these just can't use the radius-from-geometry
   * features, everything else still works.
   */
  towerCentreEasting?: number;
  towerCentreNorthing?: number;
  /** degrees clockwise from north — see siteGeometry.ts for the exact convention */
  bearingDeg?: number;
  notes?: string;
}

/**
 * One craneable item drawn from a TowerInstance, ready to hand to the
 * lift planner. Weight comes straight from the tower data (common
 * portion / variant additions / leg extension, per which group it
 * belongs to). Dimensions and lift points are NOT auto-filled yet —
 * per current decision, these are always manual entry for now (no
 * plan-view/lift-point drawing data exists yet), left undefined for
 * the user to fill in. Revisit once plan-view drawings with
 * lift-point positions are available per component.
 */
export interface LiftableComponent {
  /** stable id combining site + component, e.g. "site1__e6_body_extn_top" */
  id: string;
  siteId: string;
  /** which group this came from — affects how many identical physical
   *  pieces exist (leg extension components are physically 4 separate
   *  cones, one per leg, even though they share one weight spec) */
  source: 'commonPortion' | 'variantAddition' | 'legExtension';
  name: string;
  weightTonnes: number;
  /** how many physically identical pieces this represents — e.g. 4
   *  for a leg extension (one cone per leg). Each is still a SEPARATE
   *  individual lift, not one combined lift of quantity x weight. */
  quantity: number;
  /** true if this can actually be picked as a crane lift; false means
   *  hand-fixed by linesmen — show greyed out, reference only */
  craneLift: boolean;
  /** always required, always manual entry for now (see note above) */
  dimensions?: Dimensions3D;
  liftPoints?: number;
  drawingItemRef?: string;
  notes?: string;
}

// ------------------------------------------------------------
// LIFT DEFINITION
// ------------------------------------------------------------

export interface LiftLoad {
  netWeightTonnes: number;
  dimensions: Dimensions3D;
  /** 2, 3, or 4 typically */
  liftPoints: number;
  /** if drawn from the tower component DB rather than a custom load */
  sourceComponentId?: string;
  /** true if the user has manually overridden DB-sourced values —
   *  UI must display this clearly per the brief's requirement */
  isManualOverride?: boolean;
}

/**
 * Additive clearances on top of the geometric lift height, each
 * shown as its own transparent line item per the brief — these are
 * NEVER bundled into a single figure even though Scenario 6's worked
 * example happens to lump overhoist + hook block + deflection into
 * one 4m allowance for speed. Keep them separate here.
 */
export interface HeightClearances {
  overhoistProtectionM: number;
  assumedDeflectionM: number;
  hookBlockLengthM: number;
  additionalLineItems?: { label: string; valueM: number }[];
}

// ------------------------------------------------------------
// CRANE DUTY CHART DATA
//
// Design decision: the tool must support MULTIPLE crane models
// (confirmed by user — not just the LTM 1130-5.1 used in the CPCS
// exam). One JSON file per crane model. Charts are configuration-
// specific (boom length × counterweight × outrigger spread, plus
// optional jib), so capacities are nested under CounterweightConfig
// → BoomConfig → RadiusCapacityPoint[], never flattened to a single
// lookup.
//
// Capacity lookup at an arbitrary radius MUST interpolate between
// the two nearest published radius points and MUST NEVER extrapolate
// beyond the chart's published min/max radius for that exact
// configuration — flag out-of-range clearly rather than guessing.
// ------------------------------------------------------------

export interface HookBlockSpec {
  id: string;
  /** e.g. "110t / 7-sheave" */
  label: string;
  ratedCapacityTonnes: number;
  sheaves: number;
  maxLines: number;
  weightKg: number;
}

export interface RadiusCapacityPoint {
  radiusM: number;
  capacityTonnes: number;
}

export interface JibConfig {
  jibLengthM: number;
  offsetDeg: 0 | 20 | 40;
  capacities: RadiusCapacityPoint[];
}

export interface BoomConfig {
  boomLengthM: number;
  /** chart is specific to boomLength × counterweight × outrigger
   *  spread — capacities here apply ONLY to this exact combination */
  capacities: RadiusCapacityPoint[];
  /** optional fly-jib configurations available at this boom length */
  jibs?: JibConfig[];
  /** e.g. 7 or 14m lattice insert, if this config uses a boom extension */
  boomExtensionM?: number;
  /**
   * Some duty charts publish TWO separate columns for the same boom
   * length — one for lifting over the front of the carrier, one over
   * the rear (source charts mark the "over rear" column with a "*").
   * Confirmed real-world case: LTM 1130-5.1, 42t counterweight, 12.7m
   * boom, no jib — published as two distinct columns. Default is
   * 'front' when a chart only publishes one column (the overwhelming
   * majority of configs). Where a chart marks the orientation on an
   * individual VALUE cell rather than the whole column header, that
   * is NOT yet modelled here (not encountered in data received so
   * far) — flag it if you hit a chart like that and this type will
   * need a per-point orientation override too.
   */
  orientation?: 'front' | 'rear';
}

export interface CounterweightConfig {
  id: string;
  weightTonnes: number;
  /** as published on the chart's spec header ("Outriggers Fully
   *  Deployed: Yes/No") — kept as a direct boolean rather than a
   *  descriptive spread label, since that's what the source data
   *  actually states */
  outriggersFullyDeployed: boolean;
  /** slew radius in degrees, as published (360 = full slew) */
  slewRadiusDeg?: number;
  boomConfigs: BoomConfig[];
}

export interface CraneModel {
  /** e.g. "Liebherr LTM 1130-5.1" */
  craneModel: string;
  /** rigged weight INCLUDING the base counterweight (e.g. 60t
   *  including 9t ballast, per the LTM 1130-5.1 spec sheet) */
  riggedWeightTonnes: number;
  /** the counterweight already included in riggedWeightTonnes */
  baseCounterweightTonnes: number;
  maxLinePullTonnes: number;
  totalRopeLengthM: number;
  hookBlocks: HookBlockSpec[];
  counterweights: CounterweightConfig[];
  /** per-axle max loading, tonnes — for future transport-planning use */
  axleLoadingTonnes?: number[];
}

// ------------------------------------------------------------
// CRANE PAD / SITE GEOMETRY
// ------------------------------------------------------------

export interface CranePad {
  padId: string;
  siteId?: string;
  /** 4 corner points, site survey coordinates */
  corners: Point2D[];
}

export interface OutriggerFootprint {
  /** matches CounterweightConfig.outriggerSpread for the selected config */
  spreadM: number;
  widthM: number;
  lengthM: number;
}

// ------------------------------------------------------------
// CALCULATION RESULTS
// ------------------------------------------------------------

export interface CraneConfigResult {
  craneModel: string;
  counterweightId: string;
  boomLengthM: number;
  jib?: { lengthM: number; offsetDeg: number };
  radiusM: number;
  requiredHookHeightM: number;
  /** interpolated, never extrapolated */
  ratedCapacityAtRadiusTonnes: number;
  utilisationPercent: number;
  /** vs user-configurable threshold, default 80% */
  passesUtilisation: boolean;
  ropeOutM: number;
  ropeOutOk: boolean;
  twoBlockingGapM: number;
  twoBlockingRisk: boolean;
  /** null if not applicable / not violated */
  boomFoulClearanceM: number | null;
  boomFoulViolation: boolean;
  /** true if requested radius exceeds this configuration's published
   *  chart range — result should be excluded/flagged, never estimated */
  outOfChartRange: boolean;
}

/**
 * Ground bearing / mat sizing check — present in Scenario 6 (steps
 * 13-16), confirmed in scope for v1.
 *
 * IMPORTANT: groundBearingPressureLimitTonnesPerM2 is ALWAYS a
 * user-entered value (determined by an actual site ground
 * investigation/test), never a default or lookup baked into the
 * app. The UI must require explicit entry of this figure per site
 * before running this check — there is no safe generic default.
 */
export interface GroundBearingResult {
  totalRiggedWeightTonnes: number;
  maxOutriggerLoadingTonnes: number; // (0.75 × totalRiggedWeight) + grossLoad
  /** user-supplied per site test result — see note above */
  groundBearingPressureLimitTonnesPerM2: number;
  requiredMatAreaM2: number;
  selectedMatAreaM2: number;
  matLoadingTonnesPerM2: number;
  passes: boolean;
}
