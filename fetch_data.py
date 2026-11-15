"""Download 20 years of NASA POWER daily data for the preset regions and cache them as compact JSON.

Run once:  python fetch_data.py
Source: NASA POWER (MERRA-2 / SYN1DEG), https://power.larc.nasa.gov/
"""
import json
import os
import sys
import urllib.request

REGIONS = {
    "iowa":      {"name": "Iowa, USA (corn belt)",            "lat": 42.0,  "lon": -93.6},
    "punjab":    {"name": "Punjab, India",                    "lat": 30.9,  "lon": 75.8},
    "pampas":    {"name": "Pampas, Argentina",                "lat": -33.0, "lon": -62.0},
    "nakuru":    {"name": "Nakuru, Kenya (highland)",         "lat": -0.3,  "lon": 36.1},
    "kano":      {"name": "Kano, Nigeria (Sahel savanna)",    "lat": 12.3,  "lon": 8.7},
    "andalusia": {"name": "Andalusia, Spain (Mediterranean)", "lat": 37.4,  "lon": -5.9},
}
PARAMS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "GWETROOT", "GWETTOP"]
import datetime
START = "20050101"
END = (datetime.date.today() - datetime.timedelta(days=10)).strftime("%Y%m%d")  # NASA POWER lags real time by a few days
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def fetch(lat, lon):
    url = (
        "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=" + ",".join(PARAMS)
        + f"&community=AG&longitude={lon}&latitude={lat}&start={START}&end={END}&format=JSON"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "field-shift-demo"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def compact(raw):
    p = raw["properties"]["parameter"]
    dates = sorted(p["T2M"].keys())
    out = {"start": dates[0], "n": len(dates), "elev": raw["geometry"]["coordinates"][2]}
    for k in PARAMS:
        out[k] = [None if p[k][d] in (-999, -999.0) else round(p[k][d], 3) for d in dates]
    return out


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for rid, r in REGIONS.items():
        print("fetching", rid, flush=True)
        try:
            d = compact(fetch(r["lat"], r["lon"]))
        except Exception as e:  # keep going; report at the end
            print("  FAILED:", e, file=sys.stderr)
            continue
        d.update(r)
        with open(os.path.join(OUT, rid + ".json"), "w") as f:
            json.dump(d, f, separators=(",", ":"))
        index[rid] = {k: r[k] for k in ("name", "lat", "lon")}
        print("  ok", d["n"], "days")
    with open(os.path.join(OUT, "regions.json"), "w") as f:
        json.dump(index, f, indent=1)
    print("done:", len(index), "of", len(REGIONS))
