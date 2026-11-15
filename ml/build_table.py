"""Build the training table: one row per country, crop and year.

features = that season's NASA weather expressed relative to the region's own normal (see features.py)
target   = yield anomaly in percent: how far the national yield was above/below its own linear trend that year
Usage: python ml/build_table.py   (needs ml/data/yields.csv and ml/cache/power_*.json)
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import FEATURES, anomalies, climatology, idx, raw_features, season_window
from regions import REGIONS

Y = pd.read_csv(os.path.join(HERE, "data", "yields.csv"))
rows, skipped = [], []
for area, crop, lat, lon, sm, hm in REGIONS:
    p = os.path.join(HERE, "cache", f"power_{lat}_{lon}.json")
    if not os.path.exists(p):
        skipped.append((area, crop, "no weather file")); continue
    w = json.load(open(p))
    ys = Y[(Y.area == area) & (Y.crop == crop)].set_index("year")["yield_kg_ha"].to_dict()
    seasons = {}
    for year in range(2006, 2025):
        if year not in ys:
            continue
        a, b = season_window(year, sm, hm)
        f = raw_features(w, crop, idx(a), idx(b))
        if f:
            seasons[year] = f
    if len(seasons) < 14:
        skipped.append((area, crop, f"only {len(seasons)} seasons")); continue
    clim = climatology(list(seasons.values()))
    yrs = sorted(seasons); yv = np.array([ys[y] for y in yrs]); k, c0 = np.polyfit(yrs, yv, 1)
    for y in yrs:
        trend = k * y + c0
        r = {"area": area, "crop": crop, "year": y, "lat": lat, "lon": lon, "yield": ys[y], "trend": trend, "y_anom": 100 * (ys[y] - trend) / trend}
        r.update(anomalies(seasons[y], clim)); rows.append(r)
T = pd.DataFrame(rows)
T.to_csv(os.path.join(HERE, "data", "train.csv"), index=False)
print("rows", len(T), "| region-crop series", T.groupby(["area", "crop"]).ngroups, "| skipped", skipped)
print("target spread (std, % of trend):", round(T.y_anom.std(), 1), "| share of years 8%+ below trend:", round((T.y_anom <= -8).mean() * 100, 1), "%")
print(T.groupby("crop")["y_anom"].agg(["count", "std"]).round(1).to_string())
