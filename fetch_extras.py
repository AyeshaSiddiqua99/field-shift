"""Pre-download soil, climate projections and satellite NDVI for the preset regions (slow services; run once).

Run:  python fetch_extras.py [soil|climate|ndvi|farms ...]
Failures are reported and skipped; the app falls back gracefully.
"""
import json
import os
import sys
import time

import services

regions = json.load(open(os.path.join(services.ROOT, "data", "regions.json")))
kinds = sys.argv[1:] or ["soil", "climate", "ndvi", "farms"]
fn = {"soil": services.soil, "climate": services.climate, "ndvi": services.ndvi, "farms": services.farms}
for kind in kinds:
    for rid, r in regions.items():
        t0 = time.time()
        try:
            out = fn[kind](r["lat"], r["lon"])
            n = len(out.get("series", out.get("farms", out.get("layers", out.get("models", [])))))
            print(f"{kind:8s} {rid:10s} ok  {time.time() - t0:5.1f}s  ({n} items)", flush=True)
        except Exception as e:
            print(f"{kind:8s} {rid:10s} FAIL {time.time() - t0:5.1f}s  {e}", flush=True)
        time.sleep(2 if kind != "soil" else 13)  # SoilGrids asks for <= 5 requests/minute
