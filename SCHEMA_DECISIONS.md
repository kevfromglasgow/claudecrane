# Schema design decisions — for your review before I build the calculation layer / UI

## 1. Mode factors — resolved

Two separate tables, both kept, used for different questions:

- **Capacity mode factors** (legs × included angle, ≤90°/≤120°) → divides gross load to get required **minimum capacity per leg accessory**. This is also what Scenario 6 uses to go from the Pythagoras diagonal to required sling length (3.39m ÷ 2.1).
- **Length mode factors** (angle-from-vertical only: 30/60/90/120°) → an **alternative shortcut** that skips Pythagoras entirely: multiply/divide lift-point spacing directly by this factor to get sling length for a target angle.

Per your confirmation, these aren't competing methods — the length table is just a faster route to the same kind of number for people who don't want to do the diagonal calc by hand. The calculation layer will exposes **both entry paths** for sling length:

- Path A (Scenario 6 style): compute diagonal via Pythagoras → divide by capacity mode factor.
- Path B (shortcut): pick target angle → apply length-table factor directly to lift-point spacing.

Both should agree in principle; I won't force one as canonical in the UI, just let the user pick their preferred input method.

## 2. Tower schema — confirmed, one file per family

`TowerFamily` = `{ commonPortion, heightVariants[], legExtensionOptions[] }`. Confirmed directly from your AS4 weight diagrams:

- Common portion is constant *within* a family, different *between* families (37,657kg for AS4 AD vs 81,067kg for AS4 AD90 — heavier as angle band increases).
- Each height variant adds its own named components (never a scale factor) — e.g. E6 adds "E6 Body Extn Top 4.5M" + "E6 Body Extn Bottom 4.5M" + specific plan bracing.
- Leg extensions are non-linear deltas, always a lookup table (confirmed: AS4 AD deltas range 110–304kg per 1m step, not constant).
- Angle bands overlap by design at the edges (AD 0–2°, AD10 0–10°) and are **data, not hardcoded logic** — each family file is the sole source of truth for what variants/extensions are valid for it.
- BD only ever applies where `category === 'suspension'` — I've modelled `structuralGrade: 'AD' | 'BD' | null`, with `null` used for terminal/junction families where the AD/BD distinction doesn't exist. Validation layer should reject BD elsewhere.

See `data/tower-families/as4-ad.json` for a working (partial) example — only STD and E6 variants are filled in; the remaining variants (M3, E3, E9, E12, E15) follow the identical pattern and I can generate the rest of the fixture once you confirm the shape is right, or you can transcribe them yourself directly into more files following this template.

## 3. Crane data — multi-model, one file per crane, now built from your real CSV

`CraneModel` nests `counterweights[] → boomConfigs[] → capacities[]`, with optional `jibs[]` per boom config. This supports your fleet (LTM 1130-5.1 plus whatever else you add) without flattening configuration-specific charts together. Capacity lookup interpolates between the two nearest radius points for the *exact* boom/counterweight/jib combination and never extrapolates past the chart's published range for that configuration — out-of-range requests get flagged, not guessed.

**`data/cranes/ltm-1130-5.1.json` is now built from your real `LTM1130-5_1.csv`**, not placeholder data. Notes on the conversion:

- **File encoding is Mac OS Roman**, not UTF-8/Latin-1 — the jib-angle header rows (0°/20°/40°) decode incorrectly under any other codec. The parser detects/handles this.
- **12 config blocks parsed**: 8 plain (no-jib) counterweight charts (42, 29.3, 22.6, 12.7, 11.2, 9, 6.6, 0 tonnes) + 4 jib charts (42t+10.8m jib, 42t+19m jib, 6.6t+10.8m jib, 6.6t+19m jib).
- **Validated against two independently-known real values** before I trusted the output: 47.5m boom (no jib) @ 22m radius = 11.9t, and 47.5m boom + 10.8m jib @ 20° @ 22m radius = 8.6t (the latter is the exact figure quoted in your Scenario 6 instructions). Both matched exactly.
- **Front/rear split handled**: the 12.7m boom in the 42t/no-jib config publishes two columns (marked with `*` for "over rear" in your header row) — these come through as two separate `BoomConfig` entries with an `orientation` field, rather than being merged or one being silently dropped.
- **Real-world formatting inconsistency handled**: the 6.6t/no-jib block's header row has `"12.7 m"` (with a unit suffix) while every other block just has `"12.7"` — the parser strips non-numeric trailing characters generically rather than assuming one clean format, so this didn't silently drop that block's columns (it did on my first pass — caught it, fixed it, re-validated).
- Every boom/jib config in the output has at least one capacity point — no config was silently dropped or left empty.

Two files now exist for this:
- `scripts/parse_crane_csv.py` — the actual script that produced the current `ltm-1130-5.1.json`, already run and validated against your CSV.
- `lib/data-prep/parseCraneCsv.ts` — a direct TypeScript port of the same algorithm, meant to be wired into the real Next.js build pipeline once that's scaffolded (so future CSV updates re-generate the JSON via `tsx`/build step rather than by re-running a one-off Python script).

**Note on the CSV format for any crane you add later**: the asterisk-for-rear-lift convention only showed up on a header cell in this file (never on an individual data-value cell), so that's what the parser/types currently model (`BoomConfig.orientation`). If a future chart marks rear-lift on individual value cells instead of whole columns, flag it — the type will need a per-point override added.

## 4. CSV vs JSON for your manual conversion

- **Duty charts → CSV**, long format: one row per `(craneModel, counterweightId, boomLengthM, jibLengthM?, jibOffsetDeg?, radiusM, capacityTonnes)`. Matches the PDF's matrix layout much better for hand-transcription (each PDF column = boom length, each row = radius) than nested JSON would. I'll pivot this into the nested `CraneModel` shape at build/load time.
- **Tower components → JSON**, since you're transcribing directly from tables that are already hierarchical (family → variant → components), matching the shape above.
- **Crane pad corners → CSV**: trivially flat, `padId, x, y`.

## 5. Ground bearing / mat sizing check — confirmed in scope

```
maxOutriggerLoading = 0.75 × totalRiggedWeight + grossLoad
requiredMatArea = maxOutriggerLoading ÷ groundBearingPressureLimit
matLoading = maxOutriggerLoading ÷ selectedMatArea   (must be ≤ GBP limit)
```

Per your note: **`groundBearingPressureLimitTonnesPerM2` is always a user-entered figure**, determined by an actual site ground test — never a default or built-in lookup. I've updated `GroundBearingResult` in `types.ts` to spell this out explicitly, and the UI (when I get to it) will require this field before running the check rather than pre-filling anything.

## Files in this drop

```
package.json / tsconfig.json          — minimal Node/TS project so tests actually run (npx vitest run)
lib/types.ts                          — all types + mode factor constants, heavily commented
lib/data-prep/parseCraneCsv.ts        — TS duty-chart CSV parser (for the real build pipeline later)
lib/calculations/slingGeometry.ts     — sling length (both entry paths), mode factors, flat-sling WLL, FoS
lib/calculations/slingGeometry.test.ts
lib/calculations/craneCapacity.ts     — interpolation (never extrapolates), config search/ranking, utilisation/rope-out/two-blocking/boom-foul
lib/calculations/craneCapacity.test.ts
lib/calculations/groundBearing.ts     — outrigger loading / mat sizing (GBP always user-supplied)
lib/calculations/groundBearing.test.ts
lib/calculations/towerWeight.ts       — common portion + variant + leg extension aggregation
lib/calculations/towerWeight.test.ts
scripts/parse_crane_csv.py            — script that generated ltm-1130-5.1.json, already run
data/tower-families/as4-ad.json       — FULL, itemized, every variant reconciled exactly to manufacturer totals
data/tower-families/as4-bd.json       — FULL, itemized, every variant reconciled exactly to manufacturer totals
data/tower-families/as4-ad10.json     — PARTIAL (common portion + leg ext verified; totals stated but not itemized)
data/tower-families/as4-ad25.json     — PARTIAL (same status as AD10)
data/tower-families/as4-ad55.json     — PARTIAL (same status as AD10)
data/tower-families/as4-ad90.json     — PARTIAL (same status as AD10, one item inferred by arithmetic)
data/tower-families/as4-adj.json      — STUB (only overall common-portion total confirmed)
data/tower-families/as4-adt.json      — STUB (same as ADJ)
data/cranes/ltm-1130-5.1.json         — REAL data, built from your CSV, validated
data/crane-pads/example-pad.json      — trivial placeholder pad
```

**65 unit tests, all passing, `npx tsc --noEmit` clean.**

## Tower data completion — what got extracted from Tower Types - Merged.pdf

I used a reconciliation method rather than trusting the raw extracted text at face value: for every variant, I checked `commonPortion + additionalComponents + (±0m leg extension × 4) = the manufacturer's own printed total`. Where that didn't produce an exact integer match, I didn't guess — I left it flagged rather than publish a wrong weight for a safety tool.

- **AS4 AD and AS4 BD (both 0-2°): fully itemized, every single variant (M3/STD/E3/E6/E9/E12/E15) reconciles to an EXACT match.** This also surfaced an important modeling fact I'd missed initially: **the manufacturer's printed tower total already includes the ±0m leg extension (4 legs)** — legs aren't an optional add-on, every real tower has some leg length and ±0m is just the standard one. `calculateTowerWeight()` always applies the selected leg extension (defaulting to ±0m) rather than treating "none selected" as zero weight.
- **AS4 AD10/25/55/90 (angle families): common portion and leg extension options verified exact; height-variant itemization NOT attempted.** The raw extracted text for these families' item-to-value tables came out scrambled in a way I couldn't reliably un-scramble (unlike AD/BD, where the same reconciliation method worked cleanly first try). Rather than force a fit and risk mislabeling a component's weight, I left `additionalComponents: []` with the manufacturer's printed totals still populated — so total-weight-only lift planning works today for these families, itemized component-level lifts do not yet.
- One item in AD90's common portion (Panel-1, 1.242t) was back-calculated as the arithmetic remainder needed to hit the stated common-portion total, not directly read — flagged in that file.
- **AS4 ADJ and ADT (junction/terminal): stubbed.** These have a more complex triple-cross-arm structure that didn't resolve cleanly on this pass — only the overall common-portion totals are populated.
- Also worth knowing: **two arithmetic slips exist in the Scenario 6 instructions document itself**, both caught by unit tests that check the calculation against the documented formula rather than the document's own (wrong) arithmetic:
  - Step 3: "3.39m ÷ 2.1 = 2.42m" — actually 1.614m. The *formula* is right, the document's arithmetic isn't.
  - Step 13: "60T + 33T = 99T" — actually 93T.
  
  Flagged clearly in the test files. If you want the tool to instead reproduce the source document's numbers exactly (e.g. for training/certification consistency) rather than being mathematically correct, tell me and I'll adjust — right now it favours correctness over matching the document.

## Calculation layer — what's built and tested

- **Sling geometry** (`slingGeometry.ts`): both sling-length entry paths (Pythagoras+capacity-factor, and the angle-based shortcut you clarified), required capacity per leg, flat-sling WLL by method-of-use, optional additional FoS. Tests validated against both the Sibbald reference card's own worked example and the Scenario 6 worked example.
- **Crane capacity** (`craneCapacity.ts`): interpolation that never extrapolates past a chart's published range (throws instead), boom tip-height geometry, rope-out, and a full-fleet configuration search (`findValidConfigurations`) that returns every valid option rather than picking one, plus a ranking helper. Tests run against your real LTM 1130-5.1 data and reproduce the exact 8.6t/22m/47.5m-boom+10.8m-jib figure from your CPCS exam.
- **Ground bearing** (`groundBearing.ts`): outrigger loading and mat sizing, with the ground bearing pressure limit always required as an explicit input (never defaulted), per your note that you'll determine it from an actual site test.
- **Tower weight** (`towerWeight.ts`): sums common portion + variant additions + leg extension, with a `reconcilesWithPrintedTotal` flag on the result so the UI can show a cross-check against the manufacturer's stated total wherever that's known.

A few real bugs got caught by the tests along the way (not just wrong test expectations) — worth knowing about since it's exactly why the brief asked for unit-tested, verifiable calculation logic: `evaluateConfiguration` originally threw an uncaught exception whenever a search radius exceeded a candidate boom's physical length, which would have crashed the entire fleet-wide search the first time it hit a boom too short for the requested radius (which happens on nearly every real search, since most booms in a fleet can't reach any given radius). Fixed to treat that as "this configuration doesn't work" rather than a crash.

## Session 3 — corrections, boom/jib geometry, and the first UI component

**Three corrections, all confirmed and fixed:**
1. **±0m leg extension** — confirmed it's the standard leg length, not "no extension." Already modelled correctly.
2. **Ground bearing step 13** — confirmed 60+33=93t, the document's "99t" was a typo. Fixed in `groundBearing.ts`/tests.
3. **Sling length methodology — a real bug, now fixed.** The capacity mode factor table (legs × angle, e.g. 2.1 for 4-legs/90°) is used ONLY for accessory capacity sizing. Sling *length* always uses the separate length-table (angle-only: 30°×2, 60°×1, 90°÷1.4, 120°÷1.7) — Scenario 6 step 3's "mode factor = 2.1" was a mislabel, not an arithmetic error: 3.39 ÷ 1.4 = 2.421, which matches the document's stated 2.42m exactly once the right table is used. `requiredSlingLengthFromDiagonal` now takes an angle and uses the length table, converging with the shortcut path (Path A and Path B are genuinely the same formula now, differing only in how the lift-point spacing was measured).

**New: `lib/calculations/boomGeometry.ts`** (17 tests) — the "proper dedicated helper" for boom-foul/two-blocking:
- `computeBoomPose` / `computeBoomJibPose`: real 2D positions for boom base/tip and jib tip, solving the boom angle numerically so the *combined* boom+jib horizontal reach hits the target radius (not just the boom alone) — this actually resolves jib offset trigonometry properly, which the old placeholder in `craneCapacity.ts` didn't do at all (it silently used the plain boom's geometry for jib configs).
- `checkBoomFoul`: point-to-line-segment distance from the load/rigging envelope to both the boom AND jib segments, flagging violations against a configurable minimum clearance (this is the "horizontal clearance between the sling/load envelope and the boom line" check from your original brief).
- `checkTwoBlocking`: proper vertical stack-up (hook block + overhoist + deflection + rigging height + load) against the tip/jib-tip height, replacing the old flat `hookToLoadGapM` placeholder.
- `craneCapacity.ts`'s fleet-wide search (`findValidConfigurations`) still uses its own simpler/faster checks for broad filtering across every config in a fleet — that's a deliberate design choice (you don't have full load-envelope geometry before you've picked a candidate), not an oversight. `boomGeometry.ts` is the precise module used once a specific configuration is being visualized/finalized, which is exactly what the new UI component below does.

**New: `components/LiftProfileView.tsx`** — first real SVG side-view lift-profile component, wired directly to the calculation layer (no duplicated geometry math in the component itself). Renders ground line, crane body, boom/jib at the correct computed angle, hoist rope, rigging triangle, load, an optional obstruction (e.g. a building edge, matching your air-conditioning-unit scenario), and live clearance annotations that switch color when boom-foul or two-blocking is violated. Smoke-tested (rendered to static markup, checked for `NaN`/valid SVG output) against three cases: the exact Scenario 6 numbers, a plain no-jib boom, and a deliberately-impossible radius — all render cleanly, including the error-fallback path.

Added `react`, `react-dom`, `@types/react` as dev dependencies and enabled JSX in `tsconfig.json` so this actually type-checks and runs, not just reads as plausible code.

## What's missing if you want AD10/25/55/90 fully itemized, or ADJ/ADT filled in

The common portion and leg-extension tables extracted cleanly for every family (flat, simple lists). What didn't extract cleanly was each height variant's **item-ref-to-weight pairing** (e.g. "which specific number is the E6 top extension vs the E6 bottom extension vs the shared bracing item") — for AD10/25/55/90 the raw text came out with items and values in different, seemingly-arbitrary orders that I couldn't confidently re-pair without guessing, unlike AD/BD where the same job worked cleanly first try.

If you want these done properly, the fastest path is a clean, simple list per family — doesn't need to be pretty, a plain text or CSV list like:

```
AS4 AD10 - STD variant:
Standard Body Extension: 7217 kg, qty 1
Plan Bracing at M7.8 Level on STD HT Tower (Plan D-D): 1316 kg, qty 1

AS4 AD10 - E3 variant:
E3 Body Extn Top 6.0M: ... kg
E3 Body Extn Bottom 3.0M: ... kg
Plan Bracing at M4.8 Level on E3 Tower (Plan H-H): ... kg

[etc. for E6, E9, E12]
```

— basically the same item-name/weight pairing that's already legible in the *common portion* tables (those extracted perfectly), just for each height variant's additions. Once I have that, I'll run it through the same exact-match reconciliation check against the printed totals before publishing it, same as AD/BD.

## Session 4 — Site/component picker workflow, and the backend decision

**Backend platform: going with Supabase**, per your confirmation you need multi-device/shareable data. Reasoning: Netlify has an official Supabase extension (OAuth-connect from the Netlify UI, auto-configures environment variables — no manual wiring), and Supabase's Postgres model maps naturally onto the relational domain already built here (tower families → variants → components; sites → towers; lifts → sites/components) — it's the same shape as the TypeScript types already in `lib/types.ts`. Firebase's Firestore is document/NoSQL-shaped, which would fight against that structure rather than fit it. Supabase also bundles Auth + Row Level Security, which covers "shareable with a teammate" without extra plumbing. **Not yet wired up** — no Supabase project exists yet, this was a platform decision only. Next concrete step when you're ready: create the Supabase project, define `sites` and (later) `lift_records` tables mirroring `TowerInstance`, add `@supabase/supabase-js`, swap local-state site storage for real queries.

**New: the "pick a site, then pick a component" workflow**, per your description of how erection actually happens (separate crane visits for cones, then the body extension, etc.):

- `TowerInstance` (= your "Site"): pins down family + height variant + leg extension ONCE — e.g. `{ familyId: 'AS4_AD55', variantId: 'STD', legExtensionDeltaM: 3 }`.
- `listLiftableComponents(family, site)`: expands that into every individual craneable item — common portion components, this variant's additions, AND the leg extension **exploded into one entry per physical leg** (4 separate cone lifts, e.g. "Leg Cone (+3M) — leg 1 of 4" through "leg 4 of 4"), since each cone really is a separate crane lift on site even though all 4 share the same weight/height spec for a given site. 12 new tests, all passing.
- **`craneLift: false` flag added to `TowerComponent`**, and every "Plan Bracing..." item in the fully-itemized AS4 AD and AS4 BD fixtures is now marked `craneLift: false` (25 items total) — these still appear in `listLiftableComponents`'s output for erection-sequence reference, but a picker UI should grey them out per your instruction, not offer them as a selectable lift. You mentioned you'll come back with more info on how bracing should really be handled — this is a placeholder gate, easy to change later (e.g. to "excluded entirely" or "shown with a different UI treatment") since it's just one boolean per component.
- **Dimensions/lift-points are manual entry for every component, always** — `LiftableComponent.dimensions`/`liftPoints` are left undefined, weight is pre-filled from the tower data. This is intentionally simple for now per your note that plan-views with lift-point positions may come later; revisit `LiftableComponent` when that data exists (would just add per-component dimensions/lift-point data to `TowerComponent` itself, no structural change needed).

**Not yet done**: no UI for creating/picking sites, or for picking a `LiftableComponent` and feeding it into the lift planner page — `app/page.tsx` still only has the old "type in a gross load number" flow. That's the natural next step once you want it.

## Session 5 — Supabase actually wired up

- `sql/schema.sql` — the `sites` table (matches `TowerInstance` exactly), with RLS enabled from the start. Policy is deliberately open (`anon, authenticated`, no login required) for now — fine for a small trusted team, flagged clearly in the file's comments as the first thing to tighten once that changes.
- `lib/supabaseClient.ts` — the client is guarded so **missing env vars never break the build**: confirmed by actually running `npm run build` with zero Supabase env vars set — it succeeds, and the `/sites` page shows a clear "not connected yet" message instead of crashing.
- `lib/sitesApi.ts` — typed CRUD (`listSites`/`createSite`/`deleteSite`), converting between Postgres's snake_case columns and `TowerInstance`.
- `lib/towerFamilies.ts` — small registry bundling all 8 tower family JSON files for the site-creation picker.
- **`app/sites/page.tsx`** — real, working page: create a site (family/variant/leg-extension dropdowns, all driven from the actual data), list existing sites (from Supabase), click one to see every `listLiftableComponent` for it (bracing items visibly greyed out per your instruction), and a "Plan this lift →" link per craneable item that carries its weight into the existing demo planner.
- `app/page.tsx` now reads `?grossLoadTonnes=&label=` from the URL (via `useSearchParams`, wrapped in `Suspense` as Next.js requires) and shows a "Planning: ..." banner when arrived at via that link — so the two pages are genuinely connected, not just two separate demos.
- `.env.local.example` + `.gitignore` added.

**Not yet done**: no auth/login screen (matches the deliberately-open RLS policy above), no way to enter dimensions/lift-points against a picked component yet, and "Plan this lift" doesn't create a persistent lift *record* in Supabase — it just carries the weight over via URL for now. Natural next steps once you've tried this: add a `lift_records` table, capture dimensions/lift-points per lift, and revisit the RLS policy once more than one person needs different access levels.

## A note on how this project's files persist between sessions

This coding sandbox resets between conversation turns — anything I only save to my own scratch workspace disappears. The `/mnt/user-data/outputs/lift-planner` folder (and the zip) are what actually persist and are what I restore from at the start of each new piece of work. Practically: whatever zip I hand you at the end of a session is the real, current state of the project — if you download and unzip a new one, it supersedes anything from earlier messages.
