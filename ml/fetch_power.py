"""Download NASA POWER daily weather (2005-2024) for every region in regions.py. Slow; run once; resumable.

Usage: python ml/fetch_power.py
Writes ml/cache/power_<lat>_<lon>.json (not committed to git).
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regions import REGIONS

PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,GWETROOT"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
os.makedirs(CACHE, exist_ok=True)


def path(lat, lon):
    return os.path.join(CACHE, f"power_{lat}_{lon}.json")


def fetch(lat, lon):
    p = path(lat, lon)
    if os.path.exists(p):
        return lat, lon, "cached"
    url = (f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters={PARAMS}&community=AG"
           f"&longitude={lon}&latitude={lat}&start=20050101&end=20241231&format=JSON")
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "field-shift-ml"}), timeout=180) as r:
                raw = json.load(r)
            par = raw["properties"]["parameter"]; dates = sorted(par["T2M"])
            out = {"lat": lat, "lon": lon, "start": dates[0], "n": len(dates)}
            for k in PARAMS.split(","):
                out[k] = [None if par[k][d] in (-999, -999.0) else round(par[k][d], 2) for d in dates]
            with open(p, "w") as f:
                json.dump(out, f, separators=(",", ":"))
            return lat, lon, f"ok {len(dates)} days"
        except Exception as e:
            last = e
            time.sleep(5 * (attempt + 1))
    return lat, lon, f"FAILED {type(last).__name__}: {last}"


if __name__ == "__main__":
    pts = sorted({(r[2], r[3]) for r in REGIONS})
    print(len(pts), "unique points", flush=True)
    with cf.ThreadPoolExecutor(4) as ex:
        for lat, lon, msg in ex.map(lambda p: fetch(*p), pts):
            print(f"{lat:7.1f} {lon:7.1f}  {msg}", flush=True)
    print("done", flush=True)
