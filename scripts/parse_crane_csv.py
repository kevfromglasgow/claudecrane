"""
parse_crane_csv.py

Reference implementation of the LTM 1130-5.1 duty-chart CSV parser.
Converts the hand-transcribed CSV (one block per counterweight/jib
configuration, 5 spec rows + blank + header row(s) + data rows,
repeated) into the CraneModel JSON shape defined in lib/types.ts.

FILE FORMAT (confirmed against the actual uploaded CSV):
  - Encoding is Mac OS Roman (not UTF-8/Latin-1) — degree symbols in
    jib-angle header rows decode incorrectly under any other codec.
  - Each config block:
      row 0: "Range", "<min>_<max>"
      row 1: "Outriggers Fully Deployed", "Yes"/"No"
      row 2: "Slew Radius", "<degrees>"
      row 3: "Counterweight", "<tonnes>"
      row 4: "FlyJib", "No" OR "<jib length in m>"
      row 5: blank
      row 6: boom-length header row (one column per boom, or per
             boom+angle triplet if a jib is fitted)
      row 7 (jib configs only): jib-angle header row (0/20/40 deg)
      data rows: col0 = radius, remaining cols = capacity at that
             (boom[, angle]) column, blank = not achievable
      terminated by a blank row or EOF
  - Boom-length header cells may carry a unit suffix ("12.7 m" vs
    "12.7") inconsistently between blocks — parser strips this.
  - A boom-length header cell suffixed "*" denotes a separate
    "over rear" column for that same boom length (vs the default
    "over front") — this ONLY occurred on the 12.7m boom in the
    42t/no-jib block in the file received; parser handles it
    generically wherever it appears.
  - Jib blocks repeat each boom length 3× (one column per 0/20/40
    degree offset); the jib-angle row underneath the boom-length row
    supplies the offset for each column.

MERGING: a jib block's capacities are merged into the matching
BoomConfig (same counterweight + boomLengthM) from that counterweight's
plain (no-jib) block, as an entry in that BoomConfig's `jibs[]` array.
"""
import json
import re

SRC = "/mnt/user-data/uploads/LTM1130-5_1.csv"
OUT = "/home/claude/lift-planner/data/cranes/ltm-1130-5.1.json"

NUM_RE = re.compile(r'^(-?\d+(?:\.\d+)?)')


def load_rows(path):
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("mac_roman")
    lines = text.split("\r\n")
    return [line.split(",") for line in lines]


def cell(rows, r, c):
    if r < 0 or r >= len(rows):
        return ""
    row = rows[r]
    if c < 0 or c >= len(row):
        return ""
    return row[c].strip()


def is_blank_row(rows, r):
    row = rows[r] if r < len(rows) else []
    return all(x.strip() == "" for x in row)


def parse_boom_header_cell(raw_val):
    v = raw_val.strip()
    if v == "":
        return None
    orientation = "front"
    if v.endswith("*"):
        orientation = "rear"
        v = v[:-1].strip()
    m = NUM_RE.match(v)
    if not m:
        return None
    return float(m.group(1)), orientation


def parse_angle_header_cell(raw_val):
    v = raw_val.strip().rstrip("\xa1\u00b0 ")
    if v == "":
        return None
    m = NUM_RE.match(v)
    if not m:
        return None
    return int(float(m.group(1)))


def parse_blocks(rows):
    i = 0
    n = len(rows)
    blocks = []
    while i < n:
        if cell(rows, i, 0) == "Range":
            outriggers_raw = cell(rows, i + 1, 1)
            slew_raw = cell(rows, i + 2, 1)
            cw = float(cell(rows, i + 3, 1))
            flyjib_raw = cell(rows, i + 4, 1)
            has_jib = flyjib_raw not in ("No", "")
            jib_len = float(flyjib_raw) if has_jib else None
            header_start = i + 6
            if has_jib:
                boom_header = rows[header_start]
                angle_header = rows[header_start + 1]
                data_start = header_start + 2
            else:
                boom_header = rows[header_start]
                angle_header = None
                data_start = header_start + 1

            columns = []
            for c in range(1, len(boom_header)):
                parsed = parse_boom_header_cell(boom_header[c] if c < len(boom_header) else "")
                if parsed is None:
                    continue
                boom_len, orientation = parsed
                offset = None
                if angle_header is not None:
                    offset = parse_angle_header_cell(angle_header[c] if c < len(angle_header) else "")
                    if offset is None:
                        continue
                columns.append({"col": c, "boomLengthM": boom_len, "orientation": orientation, "offsetDeg": offset})

            r = data_start
            data_rows = []
            while r < n and not is_blank_row(rows, r) and cell(rows, r, 0) != "Range":
                radius_val = cell(rows, r, 0)
                if radius_val != "":
                    try:
                        radius = float(radius_val)
                        row_vals = {}
                        for colinfo in columns:
                            v = cell(rows, r, colinfo["col"])
                            if v != "":
                                try:
                                    row_vals[colinfo["col"]] = float(v)
                                except ValueError:
                                    pass
                        data_rows.append((radius, row_vals))
                    except ValueError:
                        pass
                r += 1

            blocks.append({
                "outriggersFullyDeployed": outriggers_raw == "Yes",
                "slewRadiusDeg": float(slew_raw) if slew_raw else None,
                "counterweightTonnes": cw,
                "jibLengthM": jib_len,
                "columns": columns,
                "dataRows": data_rows,
            })
            i = r + 1
        else:
            i += 1
    return blocks


def build_crane_model(blocks):
    plain_blocks = [b for b in blocks if b["jibLengthM"] is None]
    jib_blocks = [b for b in blocks if b["jibLengthM"] is not None]

    counterweights = []
    for b in plain_blocks:
        boom_configs = []
        # group columns by (boomLengthM, orientation)
        for colinfo in b["columns"]:
            capacities = []
            for radius, vals in b["dataRows"]:
                v = vals.get(colinfo["col"])
                if v is not None:
                    capacities.append({"radiusM": radius, "capacityTonnes": v})
            boom_entry = {
                "boomLengthM": colinfo["boomLengthM"],
                "capacities": capacities,
            }
            if colinfo["orientation"] == "rear":
                boom_entry["orientation"] = "rear"
            boom_configs.append(boom_entry)

        # attach jibs for this counterweight from matching jib blocks
        matching_jib_blocks = [jb for jb in jib_blocks if jb["counterweightTonnes"] == b["counterweightTonnes"]]
        for jb in matching_jib_blocks:
            # group jib columns by boomLengthM -> list of offsetDeg columns
            booms_in_jib = {}
            for colinfo in jb["columns"]:
                booms_in_jib.setdefault(colinfo["boomLengthM"], []).append(colinfo)

            for boom_len, col_list in booms_in_jib.items():
                jib_capacities_by_offset = {}
                for colinfo in col_list:
                    capacities = []
                    for radius, vals in jb["dataRows"]:
                        v = vals.get(colinfo["col"])
                        if v is not None:
                            capacities.append({"radiusM": radius, "capacityTonnes": v})
                    jib_capacities_by_offset[colinfo["offsetDeg"]] = capacities

                jib_config_entries = [
                    {"jibLengthM": jb["jibLengthM"], "offsetDeg": offset, "capacities": caps}
                    for offset, caps in sorted(jib_capacities_by_offset.items())
                ]

                # find matching boom_config (front orientation, since jib
                # columns in this file never carry an asterisk)
                target = next((bc for bc in boom_configs if bc["boomLengthM"] == boom_len and bc.get("orientation") is None), None)
                if target is None:
                    # boom length only appears in the jib chart, not the
                    # plain chart — create a standalone entry for it
                    target = {"boomLengthM": boom_len, "capacities": []}
                    boom_configs.append(target)
                target.setdefault("jibs", []).extend(jib_config_entries)

        cw_label = f"{b['counterweightTonnes']:g}".replace('.', '_')
        counterweights.append({
            "id": f"cw_{cw_label}t",
            "weightTonnes": b["counterweightTonnes"],
            "outriggersFullyDeployed": b["outriggersFullyDeployed"],
            "slewRadiusDeg": b["slewRadiusDeg"],
            "boomConfigs": boom_configs,
        })

    return {
        "craneModel": "Liebherr LTM 1130-5.1",
        "riggedWeightTonnes": 60,
        "baseCounterweightTonnes": 9,
        "maxLinePullTonnes": 9.34,
        "totalRopeLengthM": 250,
        "hookBlocks": [
            {"id": "hb_110t", "label": "110t / 7-sheave", "ratedCapacityTonnes": 110, "sheaves": 7, "maxLines": 14, "weightKg": 1240},
            {"id": "hb_90_2t", "label": "90.2t / 5-sheave", "ratedCapacityTonnes": 90.2, "sheaves": 5, "maxLines": 11, "weightKg": 900},
            {"id": "hb_59_1t", "label": "59.1t / 3-sheave", "ratedCapacityTonnes": 59.1, "sheaves": 3, "maxLines": 7, "weightKg": 700},
            {"id": "hb_26_1t", "label": "26.1t / 1-sheave", "ratedCapacityTonnes": 26.1, "sheaves": 1, "maxLines": 3, "weightKg": 450},
            {"id": "hb_8_8t", "label": "8.8t / single line", "ratedCapacityTonnes": 8.8, "sheaves": 0, "maxLines": 1, "weightKg": 250},
        ],
        "counterweights": counterweights,
    }


if __name__ == "__main__":
    rows = load_rows(SRC)
    blocks = parse_blocks(rows)
    print(f"Parsed {len(blocks)} config blocks from source CSV")
    model = build_crane_model(blocks)
    print(f"Built CraneModel with {len(model['counterweights'])} counterweight configs")
    for cw in model["counterweights"]:
        n_jibs = sum(len(bc.get("jibs", [])) for bc in cw["boomConfigs"])
        print(f"  {cw['weightTonnes']}t: {len(cw['boomConfigs'])} boom configs, {n_jibs} jib configs attached")
    with open(OUT, "w") as f:
        json.dump(model, f, indent=2)
    print(f"Wrote {OUT}")
