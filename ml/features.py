"""Turn a season of NASA POWER daily weather into a handful of numbers the model can learn from.

Used both to build the training table and, at run time, by the server's /api/outlook.
Weather arrays are lists (daily, starting 2005-01-01) with None for gaps.
"""
import datetime as dt
import math

T0 = dt.date(2005, 1, 1)
FEATURES = ["rain_pct", "rain_mid_pct", "tmax_mid_a", "tmin_a", "heat_days_a", "dry_spell_a", "rad_a", "wet_a", "wet_min_a", "stress_a", "clim_rain", "clim_tmax"]
HEAT = {"maize": 32.0, "wheat": 30.0, "soybean": 32.0, "barley": 30.0, "rice": 35.0, "potato": 30.0, "sorghum": 36.0, "rapeseed": 28.0}


def idx(d):
    return (d - T0).days


def season_window(year, sow_m, harv_m):
    """Season that ends in harvest month of `year` (starts the year before if sowing month > harvest month)."""
    start = dt.date(year - 1 if sow_m > harv_m else year, sow_m, 1)
    end_y, end_m = (year + 1, 1) if harv_m == 12 else (year, harv_m + 1)
    return start, dt.date(end_y, end_m, 1) - dt.timedelta(days=1)


def _clean(a, fill):
    out, last = [], fill
    for v in a:
        if v is not None:
            last = v
        out.append(last)
    return out


def raw_features(w, crop, a, b):
    """Absolute season summaries for days a..b (indices into the daily arrays). Returns None if the season is not covered."""
    n = len(w["T2M"])
    if a < 0 or b >= n or b - a < 60:
        return None
    sl = lambda k, f=0.0: _clean(w[k], f)[a:b + 1]
    rain, tmax, tmin, t2m, rad, wet = sl("PRECTOTCORR"), sl("T2M_MAX", 20.0), sl("T2M_MIN", 10.0), sl("T2M", 15.0), sl("ALLSKY_SFC_SW_DWN", 15.0), sl("GWETROOT", 0.5)
    L = len(rain); t1, t2 = L // 3, 2 * L // 3
    run = dry = 0
    for r in rain:
        run = run + 1 if r < 1 else 0; dry = max(dry, run)
    # simple soil-water bucket (generic soil, 150 mm of plant-available water), same idea as the simulator: days the crop is badly short of water
    taw, dep, severe = 150.0, 75.0, 0
    for i in range(L):
        et0 = max(0.0, 0.0135 * 0.408 * rad[i] * (t2m[i] + 17.8)); frac = i / L
        kc = 0.35 + 0.85 * min(1.0, frac / 0.4) if frac < 0.75 else 1.2 - 0.8 * (frac - 0.75) / 0.25
        ks = 1.0 if dep <= 0.55 * taw else max(0.0, (taw - dep) / (0.45 * taw))
        dep = min(taw, max(0.0, dep - rain[i] + ks * kc * et0))
        if ks < 0.5:
            severe += 1
    thr = HEAT[crop]
    return {"rain": sum(rain), "rain_mid": sum(rain[t1:t2]), "tmax_mid": sum(tmax[t1:t2]) / max(1, t2 - t1), "tmin": sum(tmin) / L,
            "heat_days": sum(1 for v in tmax if v > thr), "dry_spell": dry, "rad": sum(rad) / L, "wet": sum(wet) / L,
            "wet_min": min(sum(wet[i:i + 15]) / 15 for i in range(0, L - 15, 5)), "stress": severe}


def anomalies(f, clim):
    """Express one season relative to that region's own average season (so countries can be pooled)."""
    return {"rain_pct": 100 * (f["rain"] / clim["rain"] - 1) if clim["rain"] else 0, "rain_mid_pct": 100 * (f["rain_mid"] / clim["rain_mid"] - 1) if clim["rain_mid"] else 0,
            "tmax_mid_a": f["tmax_mid"] - clim["tmax_mid"], "tmin_a": f["tmin"] - clim["tmin"], "heat_days_a": f["heat_days"] - clim["heat_days"],
            "dry_spell_a": f["dry_spell"] - clim["dry_spell"], "rad_a": f["rad"] - clim["rad"], "wet_a": f["wet"] - clim["wet"],
            "wet_min_a": f["wet_min"] - clim["wet_min"], "stress_a": f["stress"] - clim["stress"], "clim_rain": clim["rain"], "clim_tmax": clim["tmax_mid"]}


KEYS = ["rain", "rain_mid", "tmax_mid", "tmin", "heat_days", "dry_spell", "rad", "wet", "wet_min", "stress"]


def climatology(seasons):
    return {k: sum(s[k] for s in seasons) / len(seasons) for k in KEYS}


# plain-language driver names for the "main driver" line
WORDS = {"rain_pct": lambda v: f"{abs(v):.0f}% {'less' if v < 0 else 'more'} rain than normal", "rain_mid_pct": lambda v: f"{abs(v):.0f}% {'less' if v < 0 else 'more'} rain at mid-season",
         "tmax_mid_a": lambda v: f"mid-season highs {abs(v):.1f} C {'cooler' if v < 0 else 'hotter'} than normal", "tmin_a": lambda v: f"nights {abs(v):.1f} C {'cooler' if v < 0 else 'warmer'} than normal",
         "heat_days_a": lambda v: f"{abs(v):.0f} {'fewer' if v < 0 else 'more'} heat days than normal", "dry_spell_a": lambda v: f"a {'shorter' if v < 0 else 'longer'} dry spell by {abs(v):.0f} days",
         "rad_a": lambda v: f"{'less' if v < 0 else 'more'} sunshine than normal", "wet_a": lambda v: f"{'drier' if v < 0 else 'wetter'} root-zone soil than normal",
         "wet_min_a": lambda v: f"soil water dipped {'lower' if v < 0 else 'less low'} than usual at its driest", "stress_a": lambda v: f"{abs(v):.0f} {'fewer' if v < 0 else 'more'} days short of soil water than normal"}
