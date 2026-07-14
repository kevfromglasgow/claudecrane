# Roadmap to a production build

This lays out where the tool is now, what's built this session (CSV bulk
import for sites), and a phased plan to get to what you've described:
per-component dimensions/lift-points, persistent lift records, site
geometry (crane pad / telehandler pad / laydown / tower footprint),
telehandler-vs-crane selection, bolted composite lifts, and a proper
multi-crane fleet search.

One scope note up front: you said the top-and-tail (two-crane) rotation
itself is **out of scope for now** — this tool is for confirming the
**main crane's** capacity for whatever's being lifted, with the tailing
crane assumed to be a separate, not-yet-selected piece of kit. That
significantly simplifies things — the geometry/capacity work already
built (`craneCapacity.ts`, `boomGeometry.ts`) is exactly the right shape
for "can this one crane lift this one component to this radius/height,"
which is what you need. If/when you do want the tailing crane modelled
(checking that both cranes can handle their share of the load through
the full rotation arc, not just the final vertical lift), that's a
materially bigger, separate piece of geometry — flagged as Phase 7,
deliberately last.

---

## Done this session

**CSV bulk import for sites** (`lib/sitesCsvImport.ts`, wired into `/sites`).
Upload a CSV with columns `Label, Tower family, Height variant, Leg
Extension`, get a per-row preview (which rows resolved cleanly, which
have errors and why) before anything touches the database, then import
all valid rows in one go. Matching is deliberately forgiving — "AS4 AD",
"as4_ad", "AS4-AD" all resolve to the same family, leg extension accepts
"+3", "+3m", "3", "±0M LEG EXTENSION", etc. 11 new unit tests, all
passing. A starter template is attached (`sites-template.csv`) — open it,
replace the example rows with your real sites, re-upload.

---

## Phase 2 — Component dimensions/lift-points + persistent lift records

**Goal:** stop losing the dimensions/lift-points you enter per lift, and
let the tower data carry real geometry instead of weight-only.

**What I need from you:**
- Per tower family, a CSV (or one CSV with a `family` column covering
  all of them — your call) with one row per component, columns:
  ```
  family, component_id, length_m, width_m, height_m, lift_points
  ```
  `component_id` should match the ids already in the family JSON files
  (e.g. `e6_body_extn_top_4_5m`) — I can send you the current list of
  ids per family so you're filling in a template, not guessing spellings.
- For the leg cones specifically: since each leg extension option has
  its own height (per your earlier point — cones get taller with leg
  extension), I'll need dimensions **per leg extension option**, not
  just per family — so that CSV needs a `leg_extension_delta_m` column
  too, populated only for cone rows.

**What I'll build:**
- Extend `TowerComponent` with optional `dimensions`/`liftPoints` fields
  (the types already have a `Dimensions3D` shape ready for this).
- A `lift_records` Supabase table: site, component(s) lifted, entered
  dimensions/lift-points, chosen crane/config, the full calculation
  result (capacity, utilisation, boom-foul/two-blocking status), who
  saved it, when.
- "Plan this lift" on `/sites` will save a real record instead of just
  passing a weight through the URL.

---

## Phase 3 — Site geometry (coordinates, pads, footprint)

**Goal:** auto-derive the working radius from real coordinates instead
of the user typing a number.

**What I need from you, and one thing I need to ask first:**

Is the crane pad / telehandler pad / laydown area layout a **fixed
template per tower family** (i.e. "the crane pad is always 15m along
the line and 8m off it, relative to the tower centre, for any AD55
tower"), which then needs rotating to match each site's actual
orientation on the ground? Or do you have real, independently-surveyed
absolute coordinates for every pad at every site? This changes the data
model:
- **If it's a template + orientation:** I need the template (one CSV
  per family: point name, relative easting offset, relative northing
  offset, from tower centre) **plus a bearing value per site** (degrees
  from north that the tower's "reference axis" points on the ground) so
  I can rotate the template into real coordinates automatically.
- **If it's always independently surveyed:** simpler — just a per-site
  CSV: `site_label, point_name, easting, northing` (tower centre, crane
  pad centre, telehandler pad centre, laydown corners, tower footprint
  corners).

Either way, for the "largest radius to reach any leg" calculation, I
need the **tower footprint corner coordinates** (all 4, since it's not
necessarily square) so the tool can compute distance from a chosen
crane stand position to the *furthest* leg, not just the centre.

**What I'll build:** once the format's confirmed — a `site_geometry`
table, a radius calculator (distance from crane-pad point to each
footprint corner, report the max), and eventually the plan-view SVG
(crane pad polygon, tower footprint, radius circle) using this data.

---

## Phase 4 — Telehandler vs. crane selection

**Goal:** some components are light/low enough for a telehandler; the
tool should say so instead of always assuming a crane.

**What I need from you:** a duty chart for whichever telehandler(s) you
use, in **the same CSV format as the crane charts** (radius/height vs.
capacity) — if the format doesn't naturally fit (telehandlers are often
rated by "load chart" at a boom angle/extension rather than radius
directly), send me a sample of the actual chart and I'll adapt the
parser rather than force your data into the wrong shape.

**What I'll build:** treat the telehandler exactly like another
"crane model" in the existing search (`findValidConfigurations` already
generalizes to "any piece of equipment with a duty chart") — the result
list will just include it alongside crane options wherever it's
actually capable, with a clear "Telehandler" vs "Crane" tag so you're
not comparing apples to oranges by accident.

---

## Phase 5 — Bolted/composite lifts (e.g. B+C+D as one piece)

**Goal:** let you define that certain components get bolted together on
the ground and lifted as one unit.

**What I need from you:** nothing structured yet — this one I think is
best solved as a UI feature rather than upfront data, since which
components get bolted together sounds like a per-job judgement call
(you said yourself "this is to be determined"), not a fixed rule per
tower type. Confirm that's right?

**What I'll build (proposed):** on the site's component list, a
"combine into one lift" action — select 2+ components, tool sums their
weights automatically, you enter the combined dimensions/lift-points by
hand (matching the manual-entry pattern already established), and it
gets saved as one lift record referencing all the original components
for traceability.

---

## Phase 6 — Multi-crane fleet search

**Goal:** more than one crane model in the picker, tool searches across
all of them.

**What I need from you:** duty-chart CSVs for each additional crane, in
the same format as the LTM 1130-5.1 one already parsed (5 spec rows,
blank row, header row(s), data rows — see `scripts/parse_crane_csv.py`
for the exact shape it expects). If a chart doesn't fit that shape
(different manufacturer, different layout), send me one as-is and I'll
extend the parser rather than ask you to reformat it.

**What I'll build:** generalize `findValidConfigurations` (currently
takes one `CraneModel`) to search across an array of them, tagging each
result with which crane/model it came from, so the option list spans
your whole fleet.

---

## Phase 7 — Top-and-tail (two-crane) geometry — deferred

Not started, and deliberately last per your own scoping. When you're
ready: this needs the component modelled as a rigid body rotating from
horizontal to vertical, with each crane's hook tracing a different arc
and BOTH cranes' capacity checked continuously through that rotation
(not just at the final vertical position) — a genuinely different and
larger geometry problem than the single-lift case already built. Flag
when you want to open this up; I'd want to understand the actual
rigging arrangement (where each crane's hook attaches relative to the
component's centre of gravity) before designing the model.

---

## Cross-cutting: "production-ready for professional engineers" concerns

Separate from the feature phases above, a few things that matter for
this to be trustworthy in real use, roughly in the order I'd tackle them:

1. **Real login**, replacing the current wide-open RLS policy — Supabase
   Auth (email/password or magic link) is a small addition given the
   groundwork already there; tell me when you want this and whether you
   need role distinctions (e.g. "can edit sites" vs "can only view").
2. **Audit trail** — who created/edited each site and lift record, when.
   Comes almost for free once real auth exists (Supabase can stamp
   `created_by`/`updated_by` automatically).
3. **PDF/print export of a completed lift plan** — you mentioned this
   was a "nice to have" in the original brief; worth prioritising once
   the tool is doing real work, since a site team needs a physical
   document, not a browser tab.
4. **Data provenance flags carried through the UI** — several tower
   families (AD10/25/55/90) have partially-verified data (see
   `SCHEMA_DECISIONS.md`) — before this goes near a real lift, the UI
   should visibly warn when a selected site's family/variant has
   unverified component weights, not just bury that caveat in a docs
   file only I look at.

## What to send me, in priority order

Given the phases above, the most useful things to prepare next, in the
order that unblocks the most work:

1. Component dimension/lift-point CSVs (Phase 2) — this is the most
   immediately valuable, since weight-only lift planning is already
   working and this is the natural next layer.
2. An answer to the template-vs-surveyed question in Phase 3, plus
   whichever data format that implies.
3. Any additional crane duty charts you have ready (Phase 6) — even one
   more crane meaningfully improves what the tool can already do.
4. Telehandler chart (Phase 4) and your take on the bolted-lift question
   (Phase 5) whenever convenient — these don't block anything else.
