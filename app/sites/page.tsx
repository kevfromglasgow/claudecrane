'use client';

import { useEffect, useMemo, useState } from 'react';
import { TOWER_FAMILIES, getTowerFamily } from '../../lib/towerFamilies';
import { listLiftableComponents } from '../../lib/calculations/towerWeight';
import { listSites, createSite, createSitesBulk, deleteSite } from '../../lib/sitesApi';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { parseSitesCsv, type SiteCsvRowResult } from '../../lib/sitesCsvImport';
import type { TowerInstance, LiftableComponent } from '../../lib/types';

export default function SitesPage() {
  const [configured] = useState(isSupabaseConfigured());
  const [sites, setSites] = useState<TowerInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [csvRows, setCsvRows] = useState<SiteCsvRowResult[] | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [familyId, setFamilyId] = useState(TOWER_FAMILIES[0].familyId);
  const family = useMemo(() => getTowerFamily(familyId), [familyId]);
  const [variantId, setVariantId] = useState(family?.heightVariants[0]?.variantId ?? '');
  const [legExtensionDeltaM, setLegExtensionDeltaM] = useState(0);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setSites(await listSites());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (configured) refresh();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    if (!family || !variantId) return;
    setError(null);
    try {
      await createSite({ label, familyId, variantId, legExtensionDeltaM });
      setLabel('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create site');
    }
  }

  async function handleDeleteSite(siteId: string) {
    setError(null);
    try {
      await deleteSite(siteId);
      if (selectedSiteId === siteId) setSelectedSiteId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete site');
    }
  }

  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvRows(parseSitesCsv(text));
    };
    reader.readAsText(file);
  }

  async function handleConfirmCsvImport() {
    if (!csvRows) return;
    const validInputs = csvRows.filter((r) => r.resolved).map((r) => r.resolved!);
    if (validInputs.length === 0) return;
    setCsvImporting(true);
    setError(null);
    try {
      await createSitesBulk(validInputs);
      setCsvRows(null);
      setCsvFileName(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk import failed');
    } finally {
      setCsvImporting(false);
    }
  }

  const selectedSite = sites.find((s) => s.siteId === selectedSiteId) ?? null;
  const selectedFamily = selectedSite ? getTowerFamily(selectedSite.familyId) : null;
  const liftableComponents: LiftableComponent[] =
    selectedSite && selectedFamily ? listLiftableComponents(selectedFamily, selectedSite) : [];

  if (!configured) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-stone-900">Sites</h1>
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Supabase isn&rsquo;t connected yet.</p>
          <p className="mt-1">
            Set <code className="rounded bg-white px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-white px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{' '}
            <code className="rounded bg-white px-1">.env.local</code> (see{' '}
            <code className="rounded bg-white px-1">.env.local.example</code>) for local dev, or connect the
            Supabase extension in Netlify for a deployed site. See DEPLOY.md for the full walkthrough.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Sites</h1>
        <p className="mt-1 text-sm text-stone-600">
          Define each physical tower once (family + height variant + leg extension), then come back here any time
          you need to plan the next lift for it.
        </p>
      </header>

      {error && <div className="mb-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
        <section className="space-y-6">
          <form onSubmit={handleCreateSite} className="space-y-3 rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">New site</h2>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-700">Label</span>
              <input
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Site 1 - Glenrothes"
                className="rounded border border-stone-300 px-2 py-1"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-700">Tower family</span>
              <select
                value={familyId}
                onChange={(e) => {
                  setFamilyId(e.target.value);
                  const f = getTowerFamily(e.target.value);
                  setVariantId(f?.heightVariants[0]?.variantId ?? '');
                  setLegExtensionDeltaM(0);
                }}
                className="rounded border border-stone-300 px-2 py-1"
              >
                {TOWER_FAMILIES.map((f) => (
                  <option key={f.familyId} value={f.familyId}>
                    {f.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-700">Height variant</span>
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="rounded border border-stone-300 px-2 py-1"
                disabled={!family || family.heightVariants.length === 0}
              >
                {family?.heightVariants.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.label}
                  </option>
                ))}
              </select>
              {family && family.heightVariants.length === 0 && (
                <span className="text-xs text-amber-700">
                  This family has no variant data yet (stub) &mdash; pick another family.
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-700">Leg extension</span>
              <select
                value={legExtensionDeltaM}
                onChange={(e) => setLegExtensionDeltaM(parseFloat(e.target.value))}
                className="rounded border border-stone-300 px-2 py-1"
              >
                {family?.legExtensionOptions.map((o) => (
                  <option key={o.deltaM} value={o.deltaM}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={!family || family.heightVariants.length === 0}
              className="w-full rounded bg-stone-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Create site
            </button>
          </form>

          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Bulk import from CSV</h2>
            <p className="mb-3 text-xs text-stone-500">
              Columns: <code className="rounded bg-stone-100 px-1">Label</code>,{' '}
              <code className="rounded bg-stone-100 px-1">Tower family</code>,{' '}
              <code className="rounded bg-stone-100 px-1">Height variant</code>,{' '}
              <code className="rounded bg-stone-100 px-1">Leg Extension</code>. Family/variant names are matched
              loosely (spacing/case/underscores don&rsquo;t matter), so values copied straight out of a spreadsheet
              should work.
            </p>
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} className="text-sm" />

            {csvRows && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-stone-600">
                  {csvFileName}: <strong>{csvRows.filter((r) => r.resolved).length}</strong> of {csvRows.length} rows
                  ready to import
                  {csvRows.some((r) => !r.resolved) && (
                    <span className="text-red-700"> &mdash; {csvRows.filter((r) => !r.resolved).length} row(s) have errors</span>
                  )}
                  .
                </p>

                <div className="max-h-64 overflow-y-auto rounded border border-stone-200">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-stone-50">
                      <tr className="border-b border-stone-200 uppercase tracking-wide text-stone-500">
                        <th className="px-2 py-1">Row</th>
                        <th className="px-2 py-1">Label</th>
                        <th className="px-2 py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r) => (
                        <tr key={r.rowNumber} className="border-b border-stone-100">
                          <td className="px-2 py-1">{r.rowNumber}</td>
                          <td className="px-2 py-1">{r.raw['Label'] || <em className="text-stone-400">(blank)</em>}</td>
                          <td className="px-2 py-1">
                            {r.resolved ? (
                              <span className="text-green-700">OK</span>
                            ) : (
                              <span className="text-red-700">{r.errors.join('; ')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmCsvImport}
                    disabled={csvImporting || csvRows.every((r) => !r.resolved)}
                    className="rounded bg-stone-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {csvImporting ? 'Importing…' : `Import ${csvRows.filter((r) => r.resolved).length} valid site(s)`}
                  </button>
                  <button
                    onClick={() => {
                      setCsvRows(null);
                      setCsvFileName(null);
                    }}
                    className="rounded border border-stone-300 px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Existing sites</h2>
            {loading ? (
              <p className="text-sm text-stone-500">Loading&hellip;</p>
            ) : sites.length === 0 ? (
              <p className="text-sm text-stone-500">No sites yet &mdash; create one on the left.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {sites.map((s) => (
                  <li key={s.siteId} className="flex items-center justify-between py-2">
                    <button
                      onClick={() => setSelectedSiteId(s.siteId)}
                      className={`text-left text-sm ${selectedSiteId === s.siteId ? 'font-semibold text-stone-900' : 'text-stone-700'}`}
                    >
                      {s.label}
                      <span className="ml-2 text-xs text-stone-400">
                        {s.familyId} / {s.variantId} / {s.legExtensionDeltaM >= 0 ? '+' : ''}
                        {s.legExtensionDeltaM}m legs
                      </span>
                    </button>
                    <button onClick={() => handleDeleteSite(s.siteId)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
            {selectedSite ? `Components — ${selectedSite.label}` : 'Select a site to see its components'}
          </h2>

          {selectedSite && liftableComponents.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-2">Component</th>
                  <th className="py-2">Weight</th>
                  <th className="py-2">Source</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {liftableComponents.map((c) => (
                  <tr key={c.id} className={`border-b border-stone-100 ${c.craneLift ? '' : 'opacity-40'}`}>
                    <td className="py-2">{c.name}</td>
                    <td className="py-2">{c.weightTonnes.toFixed(3)}t</td>
                    <td className="py-2 text-xs text-stone-500">{c.source}</td>
                    <td className="py-2 text-right">
                      {c.craneLift ? (
                        <a
                          href={`/?grossLoadTonnes=${c.weightTonnes}&label=${encodeURIComponent(`${selectedSite.label} \u2014 ${c.name}`)}`}
                          className="text-xs font-medium text-blue-700 hover:underline"
                        >
                          Plan this lift &rarr;
                        </a>
                      ) : (
                        <span className="text-xs text-stone-400">fixed by linesmen</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
