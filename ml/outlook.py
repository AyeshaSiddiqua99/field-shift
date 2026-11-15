"""Season outlook for one place and crop: how far above/below its normal the latest finished season's yield is likely to be.

Called by the server's /api/outlook with that place's NASA POWER weather. The model is a small gradient-boosted model
(see train.py) trained on national yields of 30 countries; weather is one point per country. It is a REGIONAL estimate,
not a farm forecast, and it describes a season that has already happened (the weather so far), not the future.
"""
import datetime as dt
import json
import os
import sys

import joblib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import FEATURES, WORDS, anomalies, climatology, idx, raw_features, season_window

_model = None
_metrics = None


def _load():
    global _model, _metrics
    if _model is None:
        _model = joblib.load(os.path.join(HERE, "data", "outlook_model.joblib"))
        _metrics = json.load(open(os.path.join(HERE, "data", "outlook_metrics.json")))
    return _model, _metrics


CROPS = ("maize", "wheat", "soybean", "barley", "rice", "potato", "sorghum", "rapeseed")


def season_months(lat, crop):
    """Assumed sowing and harvest month, from latitude only (a rough rule; the page says so)."""
    north, trop = lat >= 0, abs(lat) < 23.5
    temp_n = north and not trop
    if crop in ("wheat", "barley"):
        return (10, 7) if temp_n else (11, 4) if north else (6, 12)
    if crop == "rapeseed":
        return (9, 7) if temp_n else (11, 4) if north else (5, 11)
    if crop == "potato":
        return (4, 9) if temp_n else (11, 3) if north else (9, 2)
    if crop == "rice":
        return (5, 10) if temp_n else (6, 11) if north else (11, 4)
    if crop == "soybean":
        return (5, 10) if temp_n else (6, 10) if north else (11, 4)
    if crop == "sorghum":
        return (5, 10) if temp_n else (6, 10) if north else (11, 4)
    return (5, 10) if temp_n else (6, 10) if north else (10, 3) if not trop else (11, 4)  # maize


def predict(raw, lat, lon, crop):
    if crop not in CROPS:
        raise ValueError("the model covers " + ", ".join(CROPS) + " only")
    model, metrics = _load()
    sm, hm = season_months(lat, crop)
    n = len(raw["T2M"]); last_day = dt.date(2005, 1, 1) + dt.timedelta(days=n - 1)
    seasons = {}
    for year in range(2006, last_day.year + 2):
        a, b = season_window(year, sm, hm)
        if b > last_day:
            continue
        f = raw_features(raw, crop, idx(a), idx(b))
        if f:
            seasons[year] = (f, a, b)
    if len(seasons) < 8:
        raise ValueError("not enough weather history for this place")
    base_years = [y for y in seasons if y <= 2024]
    clim = climatology([seasons[y][0] for y in base_years])
    year = max(seasons); f, a, b = seasons[year]
    feat = anomalies(f, clim)
    x = np.array([[feat[k] for k in FEATURES] + [float(crop == c) for c in CROPS]])
    med = float(model["median"].predict(x)[0]); lo = float(model["lo"].predict(x)[0]); hi = float(model["hi"].predict(x)[0])
    lo, hi = min(lo, med) - model.get("margin", 0), max(hi, med) + model.get("margin", 0)
    # main driver: which weather feature moves the estimate most, relative to a normal season
    drivers = []
    for k in WORDS:
        x2 = x.copy(); x2[0, FEATURES.index(k)] = 0.0
        drivers.append((med - float(model["median"].predict(x2)[0]), k))  # estimate with this feature as observed minus with it at normal = its push (+ raises, - lowers)
    push = max(drivers, key=lambda d: abs(d[0]))
    driver = f"{WORDS[push[1]](feat[push[1]])}, which {'raises' if push[0] > 0 else 'lowers'} the estimate by about {abs(push[0]):.0f} point{'' if round(abs(push[0])) == 1 else 's'}" if abs(push[0]) >= 2.0 else "no single weather factor stood out; the season was close to normal"
    t = metrics["tests"]["leave_one_year_out"]
    return {"crop": crop, "year": year, "season_start": a.isoformat(), "season_end": b.isoformat(), "assumed_months": [sm, hm],
            "estimate": round(med, 1), "low": round(lo, 1), "high": round(hi, 1), "driver": driver,
            "tested": {"error_model": t["gbm"]["mae"], "error_no_change": t["zero"]["mae"], "bad_years_caught": t["gbm"]["bad_year_recall"],
                       "bad_year_precision": t["gbm"]["bad_year_precision"], "range_coverage": metrics["tests"]["leave_one_year_out"].get("calibrated_coverage", metrics["tests"]["leave_one_year_out"]["gbm_interval_coverage_10_90"]),
                       "rows": metrics["rows"], "countries": metrics["trained_on"]["countries"]},
            "source": "Gradient-boosted model trained on FAOSTAT national yields and NASA POWER weather"}
