// ============================================================
// lib/data-prep/parseCraneCsv.ts
//
// Converts a hand-transcribed crane duty-chart CSV into the
// CraneModel shape defined in lib/types.ts. This is a build-time
// / data-prep utility (run via a script, not shipped to the
// browser) — its output is what actually gets bundled as
// data/cranes/*.json.
//
// This is a direct TypeScript port of scripts/parse_crane_csv.py,
// which was used to validate the parsing logic against the real
// LTM 1130-5.1 CSV (spot-checked against two independently-known
// real values before being trusted). Keep the two in sync if you
// change the algorithm, or retire the Python version once this is
// wired into the actual Next.js build pipeline.
//
// FILE FORMAT (confirmed against a real hand-transcribed CSV):
//   - Encoding is commonly Mac OS Roman when exported from Excel on
//     macOS — degree symbols in jib-angle header rows will decode
//     incorrectly under UTF-8/Latin-1. Detect/handle both.
//   - Each config block, top to bottom:
//       row 0: "Range", "<min>_<max>"
//       row 1: "Outriggers Fully Deployed", "Yes"/"No"
//       row 2: "Slew Radius", "<degrees>"
//       row 3: "Counterweight", "<tonnes>"
//       row 4: "FlyJib", "No" OR "<jib length in m>"
//       row 5: blank
//       row 6: boom-length header row (one column per boom, or per
//              boom+angle triplet if a jib is fitted for this block)
//       row 7 (jib configs only): jib-angle header row (0/20/40 deg)
//       data rows: col0 = radius, remaining cols = capacity at that
//              (boom[, angle]) column; blank = not achievable
//       block ends at a blank row, "Range", or EOF
//   - Boom-length header cells may carry an inconsistent unit suffix
//     ("12.7 m" vs "12.7") between blocks — always strip non-numeric
//     trailing characters rather than assuming a fixed format.
//   - A boom-length header cell suffixed "*" denotes a distinct
//     "over rear" column for that same boom length (default is
//     "over front" when unmarked). Confirmed real case: LTM 1130-5.1,
//     42t counterweight, 12.7m boom, no jib.
//   - Jib blocks repeat each boom length once per published offset
//     angle (typically 0/20/40°); the jib-angle header row supplies
//     the offset for each column.
//
// MERGING: capacities from a jib block are merged into the matching
// BoomConfig (same counterweight + boomLengthM, 'front' orientation)
// taken from that counterweight's plain (no-jib) block, added as an
// entry in that BoomConfig's `jibs[]` array. If a jib block references
// a boom length that has no corresponding plain-chart entry, a
// standalone BoomConfig (with empty `capacities`) is created to hold
// the jib entry rather than silently dropping it.
// ============================================================

import type {
  CraneModel,
  CounterweightConfig,
  BoomConfig,
  JibConfig,
  RadiusCapacityPoint,
  HookBlockSpec,
} from '../types';

interface ParsedColumn {
  col: number;
  boomLengthM: number;
  orientation: 'front' | 'rear';
  offsetDeg: number | null; // null for non-jib blocks
}

interface ParsedBlock {
  outriggersFullyDeployed: boolean;
  slewRadiusDeg: number | null;
  counterweightTonnes: number;
  jibLengthM: number | null;
  columns: ParsedColumn[];
  dataRows: Array<{ radiusM: number; values: Map<number, number> }>;
}

const NUM_PREFIX = /^(-?\d+(?:\.\d+)?)/;

function cellAt(rows: string[][], r: number, c: number): string {
  if (r < 0 || r >= rows.length) return '';
  const row = rows[r];
  if (c < 0 || c >= row.length) return '';
  return row[c].trim();
}

function isBlankRow(rows: string[][], r: number): boolean {
  const row = rows[r] ?? [];
  return row.every((x) => x.trim() === '');
}

function parseBoomHeaderCell(raw: string): { boomLengthM: number; orientation: 'front' | 'rear' } | null {
  let v = raw.trim();
  if (v === '') return null;
  let orientation: 'front' | 'rear' = 'front';
  if (v.endsWith('*')) {
    orientation = 'rear';
    v = v.slice(0, -1).trim();
  }
  const m = NUM_PREFIX.exec(v);
  if (!m) return null;
  return { boomLengthM: parseFloat(m[1]), orientation };
}

function parseAngleHeaderCell(raw: string): number | null {
  // strip degree-symbol variants across encodings (° U+00B0, or the
  // mis-decoded \xA1 seen under Mac OS Roman misread as Latin-1/UTF-8)
  const v = raw.trim().replace(/[\u00b0\u00a1\s]+$/g, '');
  if (v === '') return null;
  const m = NUM_PREFIX.exec(v);
  if (!m) return null;
  return Math.round(parseFloat(m[1]));
}

/**
 * Splits raw CSV text into a grid of string cells. Assumes no quoted
 * commas (true of every duty-chart CSV seen so far — verify this
 * holds before reusing on a new source file; if a cell ever needs an
 * embedded comma, swap this for a proper CSV parser like papaparse).
 */
function toRows(csvText: string): string[][] {
  const lines = csvText.split(/\r\n|\n/);
  return lines.map((line) => line.split(','));
}

function parseBlocks(rows: string[][]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const n = rows.length;
  let i = 0;

  while (i < n) {
    if (cellAt(rows, i, 0) === 'Range') {
      const outriggersRaw = cellAt(rows, i + 1, 1);
      const slewRaw = cellAt(rows, i + 2, 1);
      const counterweightTonnes = parseFloat(cellAt(rows, i + 3, 1));
      const flyJibRaw = cellAt(rows, i + 4, 1);
      const hasJib = flyJibRaw !== 'No' && flyJibRaw !== '';
      const jibLengthM = hasJib ? parseFloat(flyJibRaw) : null;

      const headerStart = i + 6;
      const boomHeader = rows[headerStart] ?? [];
      const angleHeader = hasJib ? rows[headerStart + 1] ?? [] : null;
      const dataStart = hasJib ? headerStart + 2 : headerStart + 1;

      const columns: ParsedColumn[] = [];
      for (let c = 1; c < boomHeader.length; c++) {
        const parsedBoom = parseBoomHeaderCell(boomHeader[c] ?? '');
        if (!parsedBoom) continue;
        let offsetDeg: number | null = null;
        if (angleHeader) {
          offsetDeg = parseAngleHeaderCell(angleHeader[c] ?? '');
          if (offsetDeg === null) continue; // jib block but this column has no valid angle — skip
        }
        columns.push({ col: c, boomLengthM: parsedBoom.boomLengthM, orientation: parsedBoom.orientation, offsetDeg });
      }

      let r = dataStart;
      const dataRows: ParsedBlock['dataRows'] = [];
      while (r < n && !isBlankRow(rows, r) && cellAt(rows, r, 0) !== 'Range') {
        const radiusRaw = cellAt(rows, r, 0);
        if (radiusRaw !== '') {
          const radiusM = parseFloat(radiusRaw);
          if (!Number.isNaN(radiusM)) {
            const values = new Map<number, number>();
            for (const colInfo of columns) {
              const raw = cellAt(rows, r, colInfo.col);
              if (raw !== '') {
                const v = parseFloat(raw);
                if (!Number.isNaN(v)) values.set(colInfo.col, v);
              }
            }
            dataRows.push({ radiusM, values });
          }
        }
        r++;
      }

      blocks.push({
        outriggersFullyDeployed: outriggersRaw === 'Yes',
        slewRadiusDeg: slewRaw ? parseFloat(slewRaw) : null,
        counterweightTonnes,
        jibLengthM,
        columns,
        dataRows,
      });
      i = r + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

/** Static metadata that isn't published in the duty-chart CSV itself
 *  (rope length, hook blocks, rigged weight) — supply per crane model. */
export interface CraneStaticMeta {
  craneModel: string;
  riggedWeightTonnes: number;
  baseCounterweightTonnes: number;
  maxLinePullTonnes: number;
  totalRopeLengthM: number;
  hookBlocks: HookBlockSpec[];
}

function buildCraneModel(blocks: ParsedBlock[], meta: CraneStaticMeta): CraneModel {
  const plainBlocks = blocks.filter((b) => b.jibLengthM === null);
  const jibBlocks = blocks.filter((b) => b.jibLengthM !== null);

  const counterweights: CounterweightConfig[] = plainBlocks.map((b) => {
    const boomConfigs: BoomConfig[] = b.columns.map((colInfo) => {
      const capacities: RadiusCapacityPoint[] = [];
      for (const row of b.dataRows) {
        const v = row.values.get(colInfo.col);
        if (v !== undefined) capacities.push({ radiusM: row.radiusM, capacityTonnes: v });
      }
      const entry: BoomConfig = { boomLengthM: colInfo.boomLengthM, capacities };
      if (colInfo.orientation === 'rear') entry.orientation = 'rear';
      return entry;
    });

    // attach jib configs for this counterweight
    const matchingJibBlocks = jibBlocks.filter((jb) => jb.counterweightTonnes === b.counterweightTonnes);
    for (const jb of matchingJibBlocks) {
      const boomsInJib = new Map<number, ParsedColumn[]>();
      for (const colInfo of jb.columns) {
        const list = boomsInJib.get(colInfo.boomLengthM) ?? [];
        list.push(colInfo);
        boomsInJib.set(colInfo.boomLengthM, list);
      }

      for (const [boomLengthM, colList] of boomsInJib.entries()) {
        const jibEntries: JibConfig[] = colList
          .slice()
          .sort((a, b2) => (a.offsetDeg ?? 0) - (b2.offsetDeg ?? 0))
          .map((colInfo) => {
            const capacities: RadiusCapacityPoint[] = [];
            for (const row of jb.dataRows) {
              const v = row.values.get(colInfo.col);
              if (v !== undefined) capacities.push({ radiusM: row.radiusM, capacityTonnes: v });
            }
            return {
              jibLengthM: jb.jibLengthM as number,
              offsetDeg: (colInfo.offsetDeg ?? 0) as 0 | 20 | 40,
              capacities,
            };
          });

        let target = boomConfigs.find((bc) => bc.boomLengthM === boomLengthM && bc.orientation === undefined);
        if (!target) {
          // jib chart references a boom length absent from the plain
          // chart — keep the data rather than dropping it
          target = { boomLengthM, capacities: [] };
          boomConfigs.push(target);
        }
        target.jibs = [...(target.jibs ?? []), ...jibEntries];
      }
    }

    const cwLabel = Number.isInteger(b.counterweightTonnes)
      ? String(b.counterweightTonnes)
      : String(b.counterweightTonnes).replace('.', '_');
    return {
      id: `cw_${cwLabel}t`,
      weightTonnes: b.counterweightTonnes,
      outriggersFullyDeployed: b.outriggersFullyDeployed,
      slewRadiusDeg: b.slewRadiusDeg ?? undefined,
      boomConfigs,
    };
  });

  return {
    craneModel: meta.craneModel,
    riggedWeightTonnes: meta.riggedWeightTonnes,
    baseCounterweightTonnes: meta.baseCounterweightTonnes,
    maxLinePullTonnes: meta.maxLinePullTonnes,
    totalRopeLengthM: meta.totalRopeLengthM,
    hookBlocks: meta.hookBlocks,
    counterweights,
  };
}

/** Main entry point: parse a duty-chart CSV's raw text into a
 *  fully-shaped CraneModel, given the crane's static (non-chart)
 *  metadata. */
export function parseCraneDutyChartCsv(csvText: string, meta: CraneStaticMeta): CraneModel {
  const rows = toRows(csvText);
  const blocks = parseBlocks(rows);
  return buildCraneModel(blocks, meta);
}
