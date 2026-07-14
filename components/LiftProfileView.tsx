// ============================================================
// components/LiftProfileView.tsx
//
// Side-view SVG lift profile: ground line, crane body, boom (and jib
// if fitted) at the correct angle for the given radius, hoist rope,
// rigging triangle, load, with boom-foul and two-blocking clearance
// annotations highlighted when violated.
//
// This component is a thin rendering layer over the calculation
// layer (lib/calculations/boomGeometry.ts) — it does not duplicate
// any geometry math itself, it only draws whatever that layer
// computes. If the numbers look wrong, the bug is in the calculation
// layer, not here.
//
// Deliberately hand-rolled SVG (no charting library) per the
// project's requirement for precise custom geometry.
// ============================================================

import React, { useMemo } from 'react';
import {
  computeBoomPose,
  computeBoomJibPose,
  checkBoomFoul,
  checkTwoBlocking,
  type BoomPose,
  type BoomJibPose,
} from '../lib/calculations/boomGeometry';
import type { Point2D } from '../lib/types';

export interface LiftProfileViewProps {
  boomLengthM: number;
  radiusM: number;
  jib?: { lengthM: number; offsetDeg: 0 | 20 | 40 };
  boomBaseHeightM?: number;

  loadWidthM: number;
  loadHeightM: number;
  currentLoadHeightAboveGroundM: number;

  riggingVerticalHeightM: number;
  hookBlockLengthM: number;
  overhoistProtectionM: number;
  assumedDeflectionM: number;

  minBoomClearanceM?: number; // default 2m
  minTwoBlockingGapM?: number; // default 1m

  /** optional fixed obstruction to draw and check clearance against,
   *  e.g. a building edge — { xM: horizontal distance from slew
   *  centre, heightM: obstruction height } */
  obstruction?: { xM: number; heightM: number; label?: string };

  widthPx?: number;
  heightPx?: number;
}

const COLORS = {
  ground: '#4a4a45',
  crane: '#33454f',
  boom: '#5b7280',
  boomViolation: '#c1451d',
  rope: '#1a1a1a',
  rigging: '#8a6d3b',
  load: '#2f5d62',
  loadFill: '#2f5d6222',
  obstruction: '#7a7a72',
  obstructionFill: '#7a7a7218',
  dimension: '#6b6b63',
  gap: '#c1451d',
  gapOk: '#3a7d4f',
  text: '#242420',
  bg: '#f6f5f1',
};

/** World (engineering: +x right, +y up, origin at slew centre / ground) to SVG (+y down) transform. */
function makeTransform(scale: number, marginPx: number, viewHeightPx: number) {
  return (p: Point2D) => ({
    x: p.x * scale + marginPx,
    y: viewHeightPx - marginPx - p.y * scale,
  });
}

export function LiftProfileView({
  boomLengthM,
  radiusM,
  jib,
  boomBaseHeightM = 2.3,
  loadWidthM,
  loadHeightM,
  currentLoadHeightAboveGroundM,
  riggingVerticalHeightM,
  hookBlockLengthM,
  overhoistProtectionM,
  assumedDeflectionM,
  minBoomClearanceM = 2,
  minTwoBlockingGapM = 1,
  obstruction,
  widthPx = 720,
  heightPx = 480,
}: LiftProfileViewProps) {
  const geometry = useMemo(() => {
    let pose: BoomPose | BoomJibPose;
    let geometryError: string | null = null;
    try {
      pose = jib
        ? computeBoomJibPose(boomLengthM, jib.lengthM, jib.offsetDeg, radiusM, boomBaseHeightM)
        : computeBoomPose(boomLengthM, radiusM, boomBaseHeightM);
    } catch (err) {
      geometryError = err instanceof Error ? err.message : 'Unknown geometry error';
      pose = computeBoomPose(boomLengthM, Math.min(radiusM, boomLengthM), boomBaseHeightM);
    }

    const tip: Point2D = jib && 'jibTip' in pose ? (pose as BoomJibPose).jibTip : pose.boomTip;

    // Load top-left/top-right corners at its current height, used as
    // the envelope for the boom-foul check.
    const loadTopY = currentLoadHeightAboveGroundM + loadHeightM;
    const envelopePoints: Point2D[] = [
      { x: radiusM - loadWidthM / 2, y: loadTopY },
      { x: radiusM + loadWidthM / 2, y: loadTopY },
      { x: radiusM, y: loadTopY + riggingVerticalHeightM }, // sling apex / hook point
    ];

    const boomFoul = checkBoomFoul({ pose, envelopePoints, minClearanceM: minBoomClearanceM });
    const twoBlocking = checkTwoBlocking(
      {
        ropeFromPoint: tip,
        currentLoadHeightAboveGroundM,
        loadHeightM,
        riggingVerticalHeightM,
        hookBlockLengthM,
        overhoistProtectionM,
        assumedDeflectionM,
      },
      minTwoBlockingGapM
    );

    return { pose, tip, envelopePoints, boomFoul, twoBlocking, geometryError };
  }, [
    boomLengthM,
    radiusM,
    jib,
    boomBaseHeightM,
    loadWidthM,
    loadHeightM,
    currentLoadHeightAboveGroundM,
    riggingVerticalHeightM,
    hookBlockLengthM,
    overhoistProtectionM,
    assumedDeflectionM,
    minBoomClearanceM,
    minTwoBlockingGapM,
  ]);

  const { pose, tip, boomFoul, twoBlocking, geometryError } = geometry;

  const maxWorldX = Math.max(radiusM + loadWidthM, obstruction?.xM ?? 0) * 1.15;
  const maxWorldY = Math.max(tip.y, obstruction?.heightM ?? 0) * 1.15;
  const scale = Math.min((widthPx - 60) / maxWorldX, (heightPx - 60) / maxWorldY);
  const margin = 40;
  const toSvg = makeTransform(scale, margin, heightPx);

  const boomBaseSvg = toSvg(pose.boomBase);
  const boomTipSvg = toSvg(pose.boomTip);
  const jibTipSvg = jib && 'jibTip' in pose ? toSvg((pose as BoomJibPose).jibTip) : null;
  const tipSvg = toSvg(tip);

  const hookBottomWorld = { x: tip.x, y: tip.y - hookBlockLengthM - overhoistProtectionM - assumedDeflectionM };
  const hookBottomSvg = toSvg(hookBottomWorld);

  const loadTopY = currentLoadHeightAboveGroundM + loadHeightM;
  const loadTopLeft = toSvg({ x: radiusM - loadWidthM / 2, y: loadTopY });
  const loadBottomRight = toSvg({ x: radiusM + loadWidthM / 2, y: currentLoadHeightAboveGroundM });
  const slingApexSvg = toSvg({ x: radiusM, y: loadTopY + riggingVerticalHeightM });
  const groundSvg = toSvg({ x: 0, y: 0 });

  const boomColor = boomFoul.violatesMinimum ? COLORS.boomViolation : COLORS.boom;
  const gapColor = twoBlocking.twoBlockingRisk ? COLORS.gap : COLORS.gapOk;

  return (
    <svg
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      width="100%"
      height="auto"
      role="img"
      aria-label="Side-view lift profile"
      style={{ background: COLORS.bg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
    >
      {/* ground line */}
      <line
        x1={0}
        y1={groundSvg.y}
        x2={widthPx}
        y2={groundSvg.y}
        stroke={COLORS.ground}
        strokeWidth={2}
      />
      <text x={8} y={groundSvg.y - 6} fill={COLORS.text} fontSize={11}>
        Existing ground level
      </text>

      {/* optional obstruction (e.g. building edge) */}
      {obstruction &&
        (() => {
          const obsBase = toSvg({ x: obstruction.xM, y: 0 });
          const obsTop = toSvg({ x: obstruction.xM, y: obstruction.heightM });
          return (
            <g>
              <rect
                x={obsBase.x}
                y={obsTop.y}
                width={widthPx - obsBase.x - 4}
                height={obsBase.y - obsTop.y}
                fill={COLORS.obstructionFill}
                stroke={COLORS.obstruction}
                strokeDasharray="4 3"
              />
              <text x={obsBase.x + 6} y={obsTop.y + 14} fill={COLORS.text} fontSize={11}>
                {obstruction.label ?? 'Obstruction'} ({obstruction.heightM.toFixed(1)}m)
              </text>
            </g>
          );
        })()}

      {/* crane body (simple representative block at the slew centre) */}
      <rect
        x={boomBaseSvg.x - 14}
        y={boomBaseSvg.y}
        width={28}
        height={groundSvg.y - boomBaseSvg.y}
        fill={COLORS.crane}
      />

      {/* boom */}
      <line
        x1={boomBaseSvg.x}
        y1={boomBaseSvg.y}
        x2={boomTipSvg.x}
        y2={boomTipSvg.y}
        stroke={boomColor}
        strokeWidth={6}
        strokeLinecap="round"
      />

      {/* jib, if fitted */}
      {jibTipSvg && (
        <line
          x1={boomTipSvg.x}
          y1={boomTipSvg.y}
          x2={jibTipSvg.x}
          y2={jibTipSvg.y}
          stroke={boomColor}
          strokeWidth={4}
          strokeLinecap="round"
        />
      )}

      {/* hoist rope, tip/jib-tip down to hook block bottom */}
      <line
        x1={tipSvg.x}
        y1={tipSvg.y}
        x2={hookBottomSvg.x}
        y2={hookBottomSvg.y}
        stroke={COLORS.rope}
        strokeWidth={1.5}
        strokeDasharray="5 3"
      />

      {/* rigging triangle: hook block bottom to the two load lift points */}
      <polygon
        points={`${hookBottomSvg.x},${hookBottomSvg.y} ${loadTopLeft.x},${loadTopLeft.y} ${toSvg({ x: radiusM + loadWidthM / 2, y: loadTopY }).x},${toSvg({ x: radiusM + loadWidthM / 2, y: loadTopY }).y}`}
        fill="none"
        stroke={COLORS.rigging}
        strokeWidth={1.5}
      />

      {/* the gap between hook block bottom and sling apex, highlighted by risk status */}
      <line
        x1={hookBottomSvg.x}
        y1={hookBottomSvg.y}
        x2={slingApexSvg.x}
        y2={slingApexSvg.y}
        stroke={gapColor}
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* load */}
      <rect
        x={loadTopLeft.x}
        y={loadTopLeft.y}
        width={loadBottomRight.x - loadTopLeft.x}
        height={loadBottomRight.y - loadTopLeft.y}
        fill={COLORS.loadFill}
        stroke={COLORS.load}
        strokeWidth={2}
      />

      {/* radius dimension line along the ground */}
      <line
        x1={groundSvg.x}
        y1={groundSvg.y + 20}
        x2={toSvg({ x: radiusM, y: 0 }).x}
        y2={groundSvg.y + 20}
        stroke={COLORS.dimension}
        strokeWidth={1}
      />
      <text
        x={(groundSvg.x + toSvg({ x: radiusM, y: 0 }).x) / 2}
        y={groundSvg.y + 34}
        fill={COLORS.dimension}
        fontSize={11}
        textAnchor="middle"
      >
        radius {radiusM.toFixed(1)}m
      </text>

      {/* clearance / status annotations */}
      <text x={widthPx - 12} y={20} fill={boomColor} fontSize={12} textAnchor="end" fontWeight={600}>
        {boomFoul.violatesMinimum
          ? `\u26a0 Boom clearance ${boomFoul.minClearanceFoundM.toFixed(2)}m (min ${minBoomClearanceM}m)`
          : `Boom clearance OK (${boomFoul.minClearanceFoundM.toFixed(2)}m)`}
      </text>
      <text x={widthPx - 12} y={38} fill={gapColor} fontSize={12} textAnchor="end" fontWeight={600}>
        {twoBlocking.twoBlockingRisk
          ? `\u26a0 Two-blocking gap ${twoBlocking.remainingGapM.toFixed(2)}m (min ${minTwoBlockingGapM}m)`
          : `Two-blocking gap OK (${twoBlocking.remainingGapM.toFixed(2)}m)`}
      </text>

      {geometryError && (
        <text x={widthPx / 2} y={heightPx / 2} fill={COLORS.boomViolation} fontSize={13} textAnchor="middle" fontWeight={600}>
          {geometryError}
        </text>
      )}
    </svg>
  );
}

export default LiftProfileView;
