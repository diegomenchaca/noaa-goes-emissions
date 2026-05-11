"""
prep_data.py — Generate cells.json for v-fire-climate.

All data accessed online from NOAA's AWS open-data registry via goes2go
(download=False).  No NetCDF files are saved to disk.

Fire (ABI-L2-FDCC): seasons 2018-2024; 2018-2023 bootstrapped from the
existing d-plot3/data/fire_density.json (saves ~30 network calls).
2024 and all LST data (ABI-L2-LSTC) are fetched fresh from AWS.

Output: data/cells.json
"""
import os, certifi, json, sys
from pathlib import Path

os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from goes_utils import abi_latlon, goes16_fdcc, goes16_lstc

OUT = Path(__file__).resolve().parent / "data"
OUT.mkdir(exist_ok=True)

# ── Grid: western US (SW-corner convention) ───────────────────────────────────
LAT_MIN, LAT_MAX =  32, 50    # 18 rows
LON_MIN, LON_MAX = -125, -100  # 25 cols
CELL = 1
YEARS = list(range(2018, 2025))
FIRE_MONTHS = [6, 7, 8, 9, 10]
LST_MONTHS  = [6, 7, 8, 9]

N_ROWS = LAT_MAX - LAT_MIN  # 18
N_COLS = LON_MAX - LON_MIN  # 25   (stored as positive range of 25)
# lon goes from -125 → -100, so N_COLS = 25

def cell_idx(lat, lon):
    """Map a lat/lon point to (row, col); None if outside grid."""
    row = int((lat - LAT_MIN) / CELL)
    col = int((lon - LON_MIN) / CELL)
    if 0 <= row < N_ROWS and 0 <= col < N_COLS:
        return row, col
    return None

# ── 1. Fire grids (frp sum + pixel count per cell per year) ──────────────────
fire_frp   = {yr: np.zeros((N_ROWS, N_COLS))      for yr in YEARS}
fire_count = {yr: np.zeros((N_ROWS, N_COLS), int)  for yr in YEARS}

# Bootstrap 2018-2023 from existing d-plot3 JSON (cell centers → SW corners)
bootstrap_path = ROOT / "d-plot3" / "data" / "fire_density.json"
if bootstrap_path.exists():
    print("Loading existing fire data (2018-2023) from d-plot3…")
    with open(bootstrap_path) as f:
        existing = json.load(f)
    for yr_str, cells in existing.items():
        yr = int(yr_str)
        if yr not in YEARS:
            continue
        for cell in cells:
            # existing stores cell centers; subtract 0.5 to get SW corner lat/lon
            lat_sw = cell["lat"] - 0.5
            lon_sw = cell["lon"] - 0.5
            idx = cell_idx(lat_sw + 0.5, lon_sw + 0.5)  # test center is in bounds
            if idx is None:
                continue
            r, c = idx
            fire_frp[yr][r, c]   += cell.get("frp", 0)
            fire_count[yr][r, c] += cell.get("count", 0)
    print(f"  Loaded years: {sorted(existing.keys())}")

# Fetch missing years from AWS
need_fire = [yr for yr in YEARS if fire_frp[yr].sum() == 0]
if need_fire:
    print(f"\nFetching fire data for {need_fire} from AWS…")
    G = goes16_fdcc()
    for yr in need_fire:
        for mo in FIRE_MONTHS:
            target = f"{yr}-{mo:02d}-15 20:00"
            try:
                ds = G.nearesttime(target, download=False)
                lat, lon = abi_latlon(ds)
                frp = ds["Power"].values
                ok = np.isfinite(frp) & (frp > 0) & (lat != 0.0)
                for fla, flo, fv in zip(lat[ok], lon[ok], frp[ok]):
                    idx = cell_idx(fla, flo)
                    if idx:
                        r, c = idx
                        fire_frp[yr][r, c]   += fv
                        fire_count[yr][r, c] += 1
                print(f"  {yr}-{mo:02d}: {ok.sum()} fire px")
            except Exception as e:
                print(f"  {yr}-{mo:02d} error: {e}")

# ── 2. LST grids (summer mean K per cell per year) ────────────────────────────
print("\nFetching LST data for all years from AWS…")
G_lst = goes16_lstc()
lst_mean = {yr: np.full((N_ROWS, N_COLS), np.nan) for yr in YEARS}

for yr in YEARS:
    monthly = []
    for mo in LST_MONTHS:
        target = f"{yr}-{mo:02d}-15 20:00"
        try:
            ds = G_lst.nearesttime(target, download=False)
            lat, lon = abi_latlon(ds)
            lst_k = ds["LST"].values

            # Vectorised bin to 1° grid
            flat_lat = lat.ravel()
            flat_lon = lon.ravel()
            flat_lst = lst_k.ravel()
            ok = np.isfinite(flat_lst) & (flat_lat != 0.0)

            fla, flo, fls = flat_lat[ok], flat_lon[ok], flat_lst[ok]
            ri = ((fla - LAT_MIN) / CELL).astype(int)
            ci = ((flo - LON_MIN) / CELL).astype(int)
            ib = (ri >= 0) & (ri < N_ROWS) & (ci >= 0) & (ci < N_COLS)
            ri, ci, fls = ri[ib], ci[ib], fls[ib]

            lin = ri * N_COLS + ci
            cell_sum = np.zeros(N_ROWS * N_COLS)
            cell_cnt = np.zeros(N_ROWS * N_COLS, int)
            np.add.at(cell_sum, lin, fls)
            np.add.at(cell_cnt, lin, 1)
            arr = np.where(cell_cnt > 0, cell_sum / cell_cnt, np.nan).reshape(N_ROWS, N_COLS)
            monthly.append(arr)
            print(f"  {yr}-{mo:02d}: LST ok, {ok.sum()} valid px")
        except Exception as e:
            print(f"  {yr}-{mo:02d} LST error: {e}")

    if monthly:
        lst_mean[yr] = np.nanmean(np.stack(monthly), axis=0)

# ── 3. LST anomaly vs. 7-year mean ───────────────────────────────────────────
stack = np.stack([lst_mean[yr] for yr in YEARS], axis=0)  # (7, 18, 25)
baseline = np.nanmean(stack, axis=0)
lst_anom = {yr: lst_mean[yr] - baseline for yr in YEARS}  # K difference = °C difference

# ── 4. Assemble cells.json ───────────────────────────────────────────────────
print("\nAssembling cells.json…")
cells = []
for r in range(N_ROWS):
    for c in range(N_COLS):
        lat_sw = LAT_MIN + r * CELL
        lon_sw = LON_MIN + c * CELL

        fire = {str(yr): {
            "frp":   round(float(fire_frp[yr][r, c]), 1),
            "count": int(fire_count[yr][r, c])
        } for yr in YEARS}

        lst = {str(yr): {
            "anomaly": None if np.isnan(lst_anom[yr][r, c])
                       else round(float(lst_anom[yr][r, c]), 2)
        } for yr in YEARS}

        has_fire = any(v["frp"] > 0 for v in fire.values())
        has_lst  = any(v["anomaly"] is not None for v in lst.values())
        if has_fire or has_lst:
            cells.append({"lat": lat_sw, "lon": lon_sw, "fire": fire, "lst": lst})

out = {
    "meta": {
        "lat_min": LAT_MIN, "lat_max": LAT_MAX,
        "lon_min": LON_MIN, "lon_max": LON_MAX,
        "cell_size": CELL,
        "years": YEARS,
        "frp_unit": "MW_seasonal_total",
        "lst_unit": "celsius_anomaly_vs_7yr_mean",
        "note": "Data from NOAA GOES-16 ABI-L2-FDCC & LSTC, AWS S3 open data"
    },
    "cells": cells
}

out_path = OUT / "cells.json"
with open(out_path, "w") as f:
    json.dump(out, f, separators=(",", ":"))

sz = out_path.stat().st_size
print(f"\nSaved {len(cells)} cells → {out_path}  ({sz/1024:.0f} KB)")
