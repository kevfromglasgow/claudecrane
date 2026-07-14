'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import craneData from '../data/cranes/ltm-1130-5.1.json';
import type { CraneModel } from '../lib/types';
import { interpolateCapacity, isRadiusInChartRange } from '../lib/calculations/craneCapacity';
import LiftProfileView from '../components/LiftProfileView';

const crane = craneData as unknown as CraneModel;

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-700">
        {label} {unit ? <span className="text-stone-400">({unit})</span> : null}
      </span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-20 rounded border border-stone-300 px-2 py-1 text-right"
        />
      </div>
    </label>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const initialGrossLoad = useMemo(() => {
    const v = searchParams.get('grossLoadTonnes');
    const parsed = v ? parseFloat(v) : NaN;
    return Number.isFinite(parsed) ? parsed : 6.706;
  }, [searchParams]);
  const planningLabel = searchParams.get('label');

  const [radiusM, setRadiusM] = useState(22);
  const [boomLengthM, setBoomLengthM] = useState(47.5);
  const [jibChoice, setJibChoice] = useState<'none' | '10.8@0' | '10.8@20' | '10.8@40' | '19@0' | '19@20' | '19@40'>(
    '10.8@20'
  );

  const [loadWidthM, setLoadWidthM] = useState(2.4);
  const [loadHeightM, setLoadHeightM] = useState(3.25);
  const [currentLoadHeightAboveGroundM, setCurrentLoadHeightAboveGroundM] = useState(33);

  const [riggingVerticalHeightM, setRiggingVerticalHeightM] = useState(5.75);
  const [hookBlockLengthM, setHookBlockLengthM] = useState(1);
  const [overhoistProtectionM, setOverhoistProtectionM] = useState(1);
  const [assumedDeflectionM, setAssumedDeflectionM] = useState(2);

  const [grossLoadTonnes, setGrossLoadTonnes] = useState(initialGrossLoad);

  useEffect(() => {
    setGrossLoadTonnes(initialGrossLoad);
  }, [initialGrossLoad]);

  const counterweight42 = crane.counterweights.find((c) => c.weightTonnes === 42)!;
  const boomOptions = counterweight42.boomConfigs
    .filter((b) => b.orientation === undefined)
    .map((b) => b.boomLengthM)
    .sort((a, b) => a - b);

  const jib = useMemo(() => {
    if (jibChoice === 'none') return undefined;
    const [lengthStr, offsetStr] = jibChoice.split('@');
    return { lengthM: parseFloat(lengthStr), offsetDeg: parseInt(offsetStr, 10) as 0 | 20 | 40 };
  }, [jibChoice]);

  const capacityCheck = useMemo(() => {
    const boom = counterweight42.boomConfigs.find((b) => b.boomLengthM === boomLengthM && b.orientation === undefined);
    if (!boom) return { available: false as const };

    const points = jib ? boom.jibs?.find((j) => j.jibLengthM === jib.lengthM && j.offsetDeg === jib.offsetDeg)?.capacities : boom.capacities;
    if (!points) return { available: false as const };

    if (!isRadiusInChartRange(points, radiusM)) {
      return { available: false as const, outOfRange: true };
    }
    const capacityTonnes = interpolateCapacity(points, radiusM);
    const utilisationPercent = (grossLoadTonnes / capacityTonnes) * 100;
    return { available: true as const, capacityTonnes, utilisationPercent, passes: utilisationPercent <= 80 };
  }, [boomLengthM, jib, radiusM, grossLoadTonnes, counterweight42]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">OHL Crane Lift Planner</h1>
          <p className="mt-1 text-sm text-stone-600">
            Liebherr LTM 1130-5.1 &middot; interactive demo &mdash; every number below is computed client-side by the
            calculation layer, not hardcoded.
          </p>
          {planningLabel && (
            <p className="mt-2 inline-block rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
              Planning: {planningLabel}
            </p>
          )}
        </div>
        <a href="/sites" className="text-sm font-medium text-blue-700 hover:underline">
          Sites &rarr;
        </a>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
        <section className="space-y-6 rounded-lg border border-stone-200 bg-white p-5">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Load</h2>
            <div className="space-y-3">
              <NumberField label="Gross load" value={grossLoadTonnes} min={0.5} max={20} step={0.001} unit="t" onChange={setGrossLoadTonnes} />
              <NumberField label="Load width" value={loadWidthM} min={0.5} max={6} step={0.05} unit="m" onChange={setLoadWidthM} />
              <NumberField label="Load height" value={loadHeightM} min={0.5} max={6} step={0.05} unit="m" onChange={setLoadHeightM} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Rigging</h2>
            <div className="space-y-3">
              <NumberField
                label="Rigging vertical height"
                value={riggingVerticalHeightM}
                min={0.5}
                max={15}
                step={0.05}
                unit="m"
                onChange={setRiggingVerticalHeightM}
              />
              <NumberField label="Hook block length" value={hookBlockLengthM} min={0.2} max={3} step={0.05} unit="m" onChange={setHookBlockLengthM} />
              <NumberField
                label="Overhoist protection"
                value={overhoistProtectionM}
                min={0}
                max={3}
                step={0.05}
                unit="m"
                onChange={setOverhoistProtectionM}
              />
              <NumberField label="Assumed deflection" value={assumedDeflectionM} min={0} max={3} step={0.05} unit="m" onChange={setAssumedDeflectionM} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Lift geometry</h2>
            <div className="space-y-3">
              <NumberField label="Radius" value={radiusM} min={3} max={60} step={0.5} unit="m" onChange={setRadiusM} />
              <NumberField
                label="Current load height above ground"
                value={currentLoadHeightAboveGroundM}
                min={0}
                max={60}
                step={0.5}
                unit="m"
                onChange={setCurrentLoadHeightAboveGroundM}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Crane configuration</h2>
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-stone-700">Boom length (m)</span>
                <select
                  className="rounded border border-stone-300 px-2 py-1"
                  value={boomLengthM}
                  onChange={(e) => setBoomLengthM(parseFloat(e.target.value))}
                >
                  {boomOptions.map((len) => (
                    <option key={len} value={len}>
                      {len}m
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-stone-700">Fly jib</span>
                <select
                  className="rounded border border-stone-300 px-2 py-1"
                  value={jibChoice}
                  onChange={(e) => setJibChoice(e.target.value as typeof jibChoice)}
                >
                  <option value="none">No jib</option>
                  <option value="10.8@0">10.8m @ 0&deg;</option>
                  <option value="10.8@20">10.8m @ 20&deg;</option>
                  <option value="10.8@40">10.8m @ 40&deg;</option>
                  <option value="19@0">19m @ 0&deg;</option>
                  <option value="19@20">19m @ 20&deg;</option>
                  <option value="19@40">19m @ 40&deg;</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded border border-stone-200 bg-stone-50 p-4 text-sm">
            {!capacityCheck.available ? (
              <p className="font-medium text-red-700">
                {('outOfRange' in capacityCheck && capacityCheck.outOfRange)
                  ? 'Radius is outside this configuration\u2019s published chart range.'
                  : 'This boom/jib configuration has no published data at this counterweight.'}
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  Rated capacity at {radiusM}m: <strong>{capacityCheck.capacityTonnes!.toFixed(2)}t</strong>
                </p>
                <p>
                  Utilisation:{' '}
                  <strong className={capacityCheck.passes ? 'text-green-700' : 'text-red-700'}>
                    {capacityCheck.utilisationPercent!.toFixed(1)}%
                  </strong>{' '}
                  (80% threshold)
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Side-view lift profile</h2>
          <LiftProfileView
            boomLengthM={boomLengthM}
            radiusM={radiusM}
            jib={jib}
            loadWidthM={loadWidthM}
            loadHeightM={loadHeightM}
            currentLoadHeightAboveGroundM={currentLoadHeightAboveGroundM}
            riggingVerticalHeightM={riggingVerticalHeightM}
            hookBlockLengthM={hookBlockLengthM}
            overhoistProtectionM={overhoistProtectionM}
            assumedDeflectionM={assumedDeflectionM}
          />
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
