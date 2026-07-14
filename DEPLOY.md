# Running and deploying this locally / on Netlify

## What's actually here now

Up to this point I'd only built the calculation engine (`lib/`), the data
(`data/`), and one standalone component (`components/LiftProfileView.tsx`) —
there was no runnable app around them. This drop adds that: a real Next.js
App Router project (`app/layout.tsx`, `app/page.tsx`) with Tailwind
configured, wired to the calculation layer, that builds to a static site.

`app/page.tsx` is a working (if basic) demo: sliders/number-inputs for load,
rigging, geometry, and crane config (boom length + fly jib), a live capacity/
utilisation readout, and the side-view lift profile SVG — all computed
client-side. It only has one crane (LTM 1130-5.1) and doesn't yet have the
plan view, tower picker, or accessory library from the original brief; it's
enough to click around and see the calculation layer actually working end to
end, which is what "deploy this to test its use" needs.

**Verified working**, not just theoretical: `npm run build` completes with
zero errors and produces a real static site (`out/`, ~936KB) that I've
confirmed contains the actual rendered page content and CSS, and
`npm test` (82 unit tests) still passes under the same config.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Edit any slider/number field and the lift
profile + capacity readout update immediately (everything runs in the
browser, no server calls).

To exactly reproduce what a static deploy will look like:

```bash
npm run build      # produces out/
npx serve out       # or: python3 -m http.server -d out 8000
```

## Deploy to Netlify

The `output: 'export'` setting in `next.config.js` makes this a plain static
site — no Next.js server, no Netlify functions needed, matching the "no
persistent backend" requirement from the brief.

**Option A — connect your Git repo (recommended, gives you auto-deploys on push):**
1. Push this folder to a GitHub/GitLab/Bitbucket repo.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `out`
4. Deploy. Every push to your main branch will rebuild automatically.

**Option B — drag-and-drop (fastest way to test right now, no Git needed):**
1. Locally: `npm install && npm run build`
2. In Netlify: **Add new site → Deploy manually**, drag the `out/` folder
   onto the page.
3. You get a live URL immediately. Re-drag `out/` any time you rebuild.

**Option C — Netlify CLI:**
```bash
npm install -g netlify-cli
npm run build
netlify deploy --dir=out           # draft URL to check first
netlify deploy --dir=out --prod    # promote to production
```

## Setting up Supabase (the backend for Sites)

The `/sites` page needs a Supabase project connected before it'll do anything
useful — without it, it shows a "not connected" message rather than crashing
(confirmed: `npm run build` succeeds with zero environment variables set).

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com), sign up (GitHub login is easiest).
2. **New project** → name it, pick a region, set a database password, wait ~2 minutes.
3. **Settings → API** (left sidebar) → copy the **Project URL** and the **anon public** key.

### 2. Create the `sites` table
1. **SQL Editor** (left sidebar) → **New query**.
2. Paste in the entire contents of `sql/schema.sql` from this project, click **Run**.
3. That creates the `sites` table with Row Level Security already enabled (see the
   comments in that file — the starting policy is deliberately open/no-login-required
   for a small trusted team; tighten it once you need real per-user access control).

### 3. Local development
1. Copy `.env.local.example` to `.env.local`.
2. Fill in the two values from step 1.
3. `npm run dev` → go to `http://localhost:3000/sites` → create a site, it should
   actually save and reload from the database.

### 4. Connect it on Netlify (for the deployed site)
1. Netlify → your site → **Extensions** → search **Supabase** → **Install**.
2. **Project configuration → General → Supabase** → **Connect** (OAuth) → pick your
   Supabase project → framework **Next.js**.
3. Netlify automatically creates the right environment variables for you — no manual
   copy-pasting into Netlify's env var settings needed.
4. Redeploy (or it'll pick it up on the next build).

## A note on scope

This is genuinely a working, deployable app now — but it's an early slice,
not the full tool from the original brief. Before you'd want to actually
plan a real lift with it, it's still missing: the plan view, the crane-pad
polygon/outrigger footprint check, the rigging accessory library, multiple
crane models, and the print/export summary. The Sites page is real (creates,
lists, and deletes rows in Supabase) but doesn't yet let you enter
dimensions/lift-points per component or feed a picked component all the way
into a saved lift record — right now "Plan this lift" just carries the
weight and a label over to the existing demo planner via the URL.
