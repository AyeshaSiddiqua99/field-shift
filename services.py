"""Data services for Field Shift: soil, climate projections, satellite NDVI, farm outlines, geocoding.

Every call is cached on disk (data/cache) so repeated use is instant and external services are hit rarely.
Sources:
  soil     ISRIC SoilGrids v2 (250 m, global)            https://rest.isric.org
  climate  Open-Meteo Climate API (CMIP6 HighResMIP)      https://open-meteo.com   (NOT a NASA product)
  ndvi     NASA MODIS MOD13Q1 via ORNL DAAC web service   https://modis.ornl.gov
  farms    OpenStreetMap via Overpass (landuse=farmland)  ODbL
  geocode  OpenStreetMap Nominatim
"""
import csv
import hashlib
import io
import json
import math
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "cache")
os.makedirs(CACHE, exist_ok=True)
UA = "field-shift-demo/1.0 (hackathon prototype)"


def _http(url, data=None, timeout=60, retries=0, wait=(5, 15, 30)):
    last = None
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:  # 429 / 5xx: back off and retry
            last = e
            if e.code not in (429, 500, 502, 503, 504) or i == retries:
                break
        except Exception as e:
            last = e
            if i == retries:
                break
        time.sleep(wait[min(i, len(wait) - 1)])
    raise RuntimeError(f"{type(last).__name__}: {last}")


def cached(kind, key, fn, ttl_days=None):
    h = hashlib.sha1(key.encode()).hexdigest()[:16]
    path = os.path.join(CACHE, f"{kind}_{h}.json")
    if os.path.exists(path) and (ttl_days is None or time.time() - os.path.getmtime(path) < ttl_days * 86400):
        with open(path) as f:
            return json.load(f)
    out = fn()
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    return out


def _r(x, n=2):
    return round(float(x), n)


# ---------------- soil ----------------
SOIL_PROPS = ["clay", "sand", "silt", "soc", "phh2o", "nitrogen", "bdod"]
SOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]


def soil(lat, lon):
    def go():
        url = ("https://rest.isric.org/soilgrids/v2.0/properties/query?" + f"lon={lon}&lat={lat}"
               + "".join(f"&property={p}" for p in SOIL_PROPS) + "".join(f"&depth={d}" for d in SOIL_DEPTHS) + "&value=mean")
        j = _http(url, timeout=90, retries=2)
        by_depth = {d: {} for d in SOIL_DEPTHS}
        for layer in j["properties"]["layers"]:
            f = layer["unit_measure"].get("d_factor", 1) or 1
            for dep in layer["depths"]:
                v = dep["values"].get("mean")
                by_depth[dep["label"]][layer["name"]] = None if v is None else v / f
        layers = []
        for d in SOIL_DEPTHS:
            top, bot = d.replace("cm", "").split("-")
            v = by_depth[d]
            layers.append({"top": int(top), "bottom": int(bot), "clay": v.get("clay"), "sand": v.get("sand"), "silt": v.get("silt"),
                           "soc": v.get("soc"), "ph": v.get("phh2o"), "n": v.get("nitrogen"), "bd": v.get("bdod")})
        return {"lat": lat, "lon": lon, "source": "ISRIC SoilGrids v2.0 (250 m)", "layers": layers}
    return cached("soil", f"{lat:.3f},{lon:.3f}", go)


# ---------------- climate projections ----------------
CLIM_MODELS = ["EC_Earth3P_HR", "MPI_ESM1_2_XR", "CMCC_CM2_VHR4"]
HORIZONS = {"2030s": (2030, 2039), "2040s": (2040, 2049)}


def _model_deltas(lat, lon, model):
    url = ("https://climate-api.open-meteo.com/v1/climate?" + f"latitude={lat}&longitude={lon}&start_date=2005-01-01&end_date=2049-12-31"
           + f"&models={model}&daily=temperature_2m_mean,precipitation_sum")
    j = _http(url, timeout=120, retries=3, wait=(8, 20, 40))
    d = j["daily"]; times = d["time"]
    tk = next(k for k in d if k.startswith("temperature_2m_mean")); pk = next(k for k in d if k.startswith("precipitation_sum"))
    T, P = d[tk], d[pk]
    yr = [int(t[:4]) for t in times]

    def sel(a, b): return [i for i, y in enumerate(yr) if a <= y <= b and T[i] is not None and P[i] is not None]
    base = sel(2005, 2024)
    wet = sorted(P[i] for i in base if P[i] > 1)
    p90 = wet[int(0.9 * (len(wet) - 1))] if wet else 1e9
    nb = len(base) / 365.25
    mT = sum(T[i] for i in base) / len(base); tot_b = sum(P[i] for i in base) / nb; H_b = sum(P[i] for i in base if P[i] > p90) / nb
    out = {}
    for name, (a, b) in HORIZONS.items():
        ix = sel(a, b); n = len(ix) / 365.25
        tot = sum(P[i] for i in ix) / n; H = sum(P[i] for i in ix if P[i] > p90) / n
        out[name] = {"dT": sum(T[i] for i in ix) / len(ix) - mT, "dP": tot / tot_b - 1 if tot_b else 0,
                     "ext": (H / H_b) / (tot / tot_b) - 1 if H_b and tot_b and tot else 0}
    return out


def climate(lat, lon):
    def go():
        per, errs = {}, {}
        for i, m in enumerate(CLIM_MODELS):
            if i:
                time.sleep(3)
            try:
                per[m] = _model_deltas(lat, lon, m)
            except Exception as e:
                errs[m] = str(e)
        if not per:
            raise RuntimeError("no climate model responded: " + "; ".join(errs.values()))
        out = {"lat": lat, "lon": lon, "baseline": "2005-2024", "models": list(per), "failed": errs,
               "source": "Open-Meteo Climate API, CMIP6 HighResMIP models (single high-emission pathway; not a NASA product)", "horizons": {}}
        for h in HORIZONS:
            row = {}
            for k in ("dT", "dP", "ext"):
                v = [per[m][h][k] for m in per]
                row[k] = _r(sum(v) / len(v), 3); row[k + "_range"] = [_r(min(v), 3), _r(max(v), 3)]
            out["horizons"][h] = row
        return out
    return cached("clim", f"{lat:.2f},{lon:.2f}", go)


# ---------------- satellite NDVI (NASA MODIS via ORNL DAAC) ----------------
def ndvi(lat, lon):
    def go():
        url = ("https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?" + f"latitude={lat}&longitude={lon}&band=250m_16_days_NDVI"
               + "&startDate=A2019001&endDate=A2023365&kmAboveBelow=0&kmLeftRight=0")
        j = _http(url, timeout=240, retries=1, wait=(10,))
        scale = float(j.get("scale", 0.0001) or 0.0001); pts = []
        for s in j.get("subset", []):
            v = s["data"][0] if s.get("data") else None
            pts.append([s["calendar_date"], None if v is None or v <= -3000 else _r(v * scale, 3)])
        return {"lat": lat, "lon": lon, "source": "NASA MODIS MOD13Q1 250 m 16-day NDVI via ORNL DAAC", "series": pts}
    return cached("ndvi", f"{lat:.3f},{lon:.3f}", go)


# ---------------- farm outlines (OpenStreetMap) ----------------
def _area_ha(poly, lat0):
    k = math.cos(math.radians(lat0)); pts = [((lo * 111320 * k), (la * 110540)) for la, lo in poly]
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]; a += x1 * y2 - x2 * y1
    return abs(a) / 2 / 10000


def farms(lat, lon, radius=4000):
    def go():
        q = (f'[out:json][timeout:40];way["landuse"~"^(farmland|orchard|vineyard)$"](around:{radius},{lat},{lon});out tags geom 60;')
        data = urllib.parse.urlencode({"data": q}).encode()
        j = None
        for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
            try:
                j = _http(ep, data=data, timeout=60); break
            except Exception as e:
                err = e
        if j is None:
            raise RuntimeError(f"farm search unavailable: {err}")
        out = []
        for el in j.get("elements", []):
            g = el.get("geometry")
            if not g or len(g) < 4:
                continue
            poly = [[p["lat"], p["lon"]] for p in g]
            ha = _area_ha(poly, lat)
            if ha < 0.3:
                continue
            step = max(1, len(poly) // 60); poly = poly[::step]
            clat = sum(p[0] for p in poly) / len(poly); clon = sum(p[1] for p in poly) / len(poly)
            t = el.get("tags", {})
            out.append({"id": el["id"], "kind": t.get("landuse"), "name": t.get("name"), "crop": t.get("crop"), "ha": round(ha, 1),
                        "lat": round(clat, 5), "lon": round(clon, 5), "poly": poly,
                        "d": round(math.hypot((clat - lat) * 110540, (clon - lon) * 111320 * math.cos(math.radians(lat))))})
        out.sort(key=lambda f: f["d"])
        return {"lat": lat, "lon": lon, "radius": radius, "source": "OpenStreetMap contributors (ODbL)", "farms": out[:30]}
    return cached("farms", f"{lat:.2f},{lon:.2f},{radius}", go, ttl_days=30)


def slope(lat, lon):
    """Terrain slope (%) from a 90 m DEM (Open-Meteo elevation API): centre + 4 points about 120 m away."""
    def go():
        d = 120.0; dlat = d / 110540.0; dlon = d / (111320.0 * math.cos(math.radians(lat)))
        pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
        url = ("https://api.open-meteo.com/v1/elevation?" + "latitude=" + ",".join(f"{p[0]:.6f}" for p in pts)
               + "&longitude=" + ",".join(f"{p[1]:.6f}" for p in pts))
        z = _http(url, timeout=30, retries=2, wait=(3, 8))["elevation"]
        dzdy = (z[1] - z[2]) / (2 * d); dzdx = (z[3] - z[4]) / (2 * d)
        return {"lat": lat, "lon": lon, "elev": round(z[0], 1), "slope": round(math.hypot(dzdx, dzdy) * 100, 1),
                "source": "Copernicus 90 m DEM via Open-Meteo elevation API"}
    return cached("slope", f"{lat:.4f},{lon:.4f}", go)


def geocode(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 5})
    j = _http(url, timeout=30)
    return {"results": [{"name": r["display_name"], "lat": float(r["lat"]), "lon": float(r["lon"])} for r in j]}


# ---------------- national cereal yield (World Bank, from FAO data) ----------------
def country(lat, lon):
    def go():
        j = _http(f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=3", timeout=30)
        a = j.get("address", {})
        return {"iso2": a.get("country_code", ""), "name": a.get("country")}
    return cached("country", f"{lat:.1f},{lon:.1f}", go)


def yield_series(lat, lon):
    c = country(lat, lon)
    if not c.get("iso2"):
        raise RuntimeError("no country at this point (open water?)")

    def go():
        url = f"https://api.worldbank.org/v2/country/{c['iso2']}/indicator/AG.YLD.CREL.KG?format=json&date=2005:2024&per_page=40"
        j = _http(url, timeout=90, retries=2)
        rows = (j[1] or []) if isinstance(j, list) and len(j) > 1 else []
        return {"country": c["name"], "iso2": c["iso2"], "series": sorted([[int(r["date"]), r["value"]] for r in rows if r.get("value")]),
                "source": "World Bank indicator AG.YLD.CREL.KG (cereal yield, kg/ha, national average; underlying data FAO)"}
    return cached("wbyield", c["iso2"], go, ttl_days=30)


# ---------------- active fires, last 24 h (NASA FIRMS, MODIS C6.1 near-real-time; no key needed) ----------------
_fires = {"t": 0, "rows": []}


def fires(lat, lon, radius_km=50):
    if time.time() - _fires["t"] > 1800 or not _fires["rows"]:
        req = urllib.request.Request("https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode("utf-8", "replace")
        rows = []
        for row in csv.DictReader(io.StringIO(text)):
            try:
                rows.append((float(row["latitude"]), float(row["longitude"]), float(row.get("frp") or 0), row["acq_date"]))
            except (KeyError, ValueError):
                continue
        _fires.update(t=time.time(), rows=rows)
    near = []
    for la, lo, frp, d in _fires["rows"]:
        dy = (la - lat) * 110.54; dx = (lo - lon) * 111.32 * math.cos(math.radians(lat)); km = math.hypot(dx, dy)
        if km <= radius_km:
            near.append({"lat": la, "lon": lo, "frp": frp, "km": round(km, 1)})
    near.sort(key=lambda p: p["km"])
    dates = [d for *_, d in _fires["rows"]]
    return {"radius_km": radius_km, "count": len(near), "nearest_km": near[0]["km"] if near else None, "points": near[:20],
            "as_of": max(dates) if dates else None, "source": "NASA FIRMS, MODIS C6.1 near-real-time active fires, last 24 h"}


# ---------------- map tiles for the 3D layer stack: NASA GIBS layers + Esri imagery (served via us: no CORS, cached) ----------------
# key -> (GIBS layer id, tile grid, max zoom, has a date, how many days a snapped date may differ from the one asked for)
GIBS_LAYERS = {
    "rain": ("IMERG_Precipitation_Rate", "GoogleMapsCompatible_Level6", 6, True, 4),             # NASA GPM IMERG, ~10 km
    "soil": ("MERRA2_Soil_Water_Root_Zone_Monthly", "GoogleMapsCompatible_Level6", 6, True, 120),  # NASA GMAO MERRA-2 (monthly, published ~3 months late), ~50 km
    "heat": ("MODIS_Terra_L3_Land_Surface_Temp_8Day_Day", "GoogleMapsCompatible_Level7", 7, True, 10),  # NASA MODIS, 1 km, 8-day composites (daily images are often cloud-blank)
    "veg": ("MODIS_Terra_L3_NDVI_16Day", "GoogleMapsCompatible_Level9", 9, True, 20),           # NASA MODIS NDVI, 250 m, 16-day composites
    "water": ("OSM_Land_Water_Map", "GoogleMapsCompatible_Level9", 9, False, 0),                # land/water map, static
}
TILE_DIR = os.path.join(CACHE, "tiles")
os.makedirs(TILE_DIR, exist_ok=True)


class NoData(Exception):
    pass


def _gibs_ranges():
    wanted_key = ",".join(sorted(v[0] for v in GIBS_LAYERS.values()))  # cache is keyed on the layer list, so changing a layer refreshes it

    def go():
        req = urllib.request.Request("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read().decode("utf-8", "replace")
        import re
        wanted = {v[0] for v in GIBS_LAYERS.values()}
        out = {}
        for b in txt.split("<Layer>")[1:]:
            m = re.search(r"<ows:Identifier>([^<]+)</ows:Identifier>", b)
            if m and m.group(1) in wanted:
                dim = re.search(r"<Dimension>.*?</Dimension>", b, re.S)
                out[m.group(1)] = re.findall(r"<Value>([^<]+)</Value>", dim.group(0)) if dim else []
        return out
    return cached("gibsranges", wanted_key, go, ttl_days=7)


def _add_months(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return d.replace(year=y, month=m + 1, day=min(d.day, 28))


def gibs_snap(layer, date, tol):
    """Latest date the layer really has that is not after `date` (None if nothing within `tol` days)."""
    import datetime as dt
    target = dt.date.fromisoformat(date); best = None
    for r in _gibs_ranges().get(layer, []):
        p = r.split("/"); a = dt.date.fromisoformat(p[0][:10]); b = dt.date.fromisoformat(p[1][:10]) if len(p) > 1 else a; step = p[2] if len(p) > 2 else "P1D"
        if a > target:
            continue
        top = min(target, b)
        if step == "P1D":
            cand = top
        elif step.endswith("D"):
            n = int(step[1:-1]); cand = a + dt.timedelta(days=((top - a).days // n) * n)
        elif step.endswith("M"):
            n = int(step[1:-1]); k = (((top.year - a.year) * 12 + top.month - a.month) // n) * n; cand = _add_months(a, k)
            if cand > top: cand = _add_months(a, k - n)
        elif step.endswith("Y"):
            n = int(step[1:-1]); k = ((top.year - a.year) // n) * n; cand = a.replace(year=a.year + k)
            if cand > top: cand = a.replace(year=a.year + k - n)
        else:
            cand = a
        if cand <= target and (best is None or cand > best):
            best = cand
    if best is None or (target - best).days > tol:
        return None
    return best.isoformat()


def _fetch_png(url, path):
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NoData("no tile")
        raise
    with open(path, "wb") as f:
        f.write(data)
    return data


def gibs_tile(key, date, z, x, y):
    layer, tms, maxz, timed, tol = GIBS_LAYERS[key]
    z = min(z, maxz)
    used = None
    if timed:
        used = gibs_snap(layer, date, tol)
        if not used:
            raise NoData("no NASA image for this date")
    url = f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{used + '/' if used else ''}{tms}/{z}/{y}/{x}.png"
    return _fetch_png(url, os.path.join(TILE_DIR, f"{layer}_{used or 'static'}_{z}_{x}_{y}.png")), used


def gibs_latest():
    """Latest date each dated layer has, and the latest date on which ALL of them have data ('common')."""
    r = _gibs_ranges(); out = {}
    for key, (layer, _tms, _z, timed, _tol) in GIBS_LAYERS.items():
        if timed:
            ends = [(v.split("/")[1] if "/" in v else v)[:10] for v in r.get(layer, [])]
            out[key] = max(ends) if ends else None
    out["common"] = min(v for v in out.values() if v)
    return out


# ---------------- colour legends: taken from NASA's own published GIBS colour scales ----------------
# key -> (colour map file, colour map title, units to show, range to show, subtract this to convert Kelvin to Celsius)
LEGENDS = {
    "rain": ("GPM_Precipitation_Rate", "Rain Rate", "mm of rain per hour", 0.1, 53.0, 0),
    "soil": ("MERRA2_Soil_Water_Root_Zone_Monthly", "Soil Water Root Zone", "m3 of water per m3 of soil", 0.0, 0.45, 0),
    "heat": ("MODIS_Land_Surface_Temp", "Land Surface Temperature", "degrees C (scale shown: typical land values)", 250.0, 330.0, 273.15),
    "veg": ("MODIS_L3_NDVI", "Vegetation Indices", "NDVI: 0 = bare, 1 = dense green", 0.0, 1.0, 0),
}


def legend(key):
    if key == "water":  # no published scale: these two colours were read from the map tile itself (water is the lighter grey)
        return {"key": key, "title": "Land and water", "units": "", "classes": [{"label": "water", "rgb": "rgb(128,128,128)"}, {"label": "land", "rgb": "rgb(75,75,75)"}]}
    if key not in LEGENDS:
        raise ValueError("unknown layer")
    name, title, units, vmin, vmax, off = LEGENDS[key]

    def go():
        import re
        req = urllib.request.Request(f"https://gibs.earthdata.nasa.gov/colormaps/v1.3/{name}.xml", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            x = r.read().decode("utf-8", "replace")
        block = re.search(r'<ColorMap title="' + re.escape(title) + r'"[^>]*>.*?</ColorMap>', x, re.S).group(0)
        num = lambda s: float("inf") if "INF" in s and "+" in s else float("-inf") if "INF" in s else float(s)
        ents = []
        for m in re.finditer(r"<ColorMapEntry ([^>]*?)/?>", block):
            a = m.group(1); rgb = re.search(r'rgb="(\d+),(\d+),(\d+)"', a); val = re.search(r'\bvalue="\[([^,]+),([^\)\]]+)[\)\]]"', a)
            if not rgb or not val or 'transparent="true"' in a:
                continue
            ents.append((num(val.group(1)), num(val.group(2)), tuple(int(v) for v in rgb.groups())))
        ents = sorted([e for e in ents if e[1] > vmin and e[0] < vmax], key=lambda e: e[0])
        if len(ents) < 2:
            raise RuntimeError("colour scale not found")
        pick = lambda p: ents[round(p * (len(ents) - 1))]
        fmt = lambda v: (f"{v:.0f}" if off else f"{v:.2f}" if vmax <= 1 else f"{v:.2g}")
        ticks = [{"p": p, "label": ("<" if False else "") + fmt((vmin if p == 0 else vmax if p == 1 else pick(p)[0]) - off) + ("+" if p == 1 and key in ("rain", "soil") else "")} for p in (0, 0.25, 0.5, 0.75, 1)]  # "+" = NASA's scale continues above that value
        return {"key": key, "title": title, "units": units, "stops": [f"rgb({e[2][0]},{e[2][1]},{e[2][2]})" for e in (pick(i / 39) for i in range(40))], "ticks": ticks,
                "entries": [{"lo": round(e[0] - off, 4), "hi": round(e[1] - off, 4) if e[1] != float("inf") else None, "rgb": list(e[2])} for e in ents],
                "source": f"NASA GIBS colour map {name}"}
    return cached("legend", key + ":v4", go, ttl_days=30)


def esri_tile(z, x, y):
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    return _fetch_png(url, os.path.join(TILE_DIR, f"esri_{z}_{x}_{y}.jpg"))


# ---------- what grew there before: Agriculture and Agri-Food Canada Annual Crop Inventory (Canada only, 30 m, satellite-classified) ----------
ACI = {10: "Cloud", 20: "Water", 30: "Barren", 34: "Urban/developed", 35: "Greenhouses", 50: "Shrubland", 80: "Wetland", 85: "Peatland", 110: "Grassland", 120: "Agriculture (unspecified)",
       121: "Cropland", 122: "Pasture/forage", 130: "Too wet to seed", 131: "Fallow", 132: "Cereals", 133: "Barley", 134: "Other grains", 135: "Millet", 136: "Oats", 137: "Rye", 139: "Triticale",
       140: "Wheat", 142: "Sorghum", 145: "Winter wheat", 146: "Spring wheat", 147: "Corn", 148: "Tobacco", 149: "Ginseng", 150: "Oilseeds", 153: "Canola", 154: "Flax", 155: "Mustard",
       157: "Sunflower", 158: "Soybeans", 160: "Pulses", 162: "Peas", 163: "Chickpeas", 167: "Beans", 168: "Fababeans", 174: "Lentils", 175: "Vegetables", 176: "Tomatoes", 177: "Potatoes",
       178: "Sugar beets", 180: "Fruits", 188: "Orchard", 190: "Vineyard", 192: "Sod", 195: "Buckwheat", 197: "Hemp", 199: "Other crops", 200: "Forest", 210: "Forest", 220: "Forest", 230: "Forest"}


def crop_history(lat, lon):
    if not (41.5 <= lat <= 70 and -141 <= lon <= -52):
        return {"covered": False, "years": []}
    import concurrent.futures as cf
    import urllib.parse

    def one(y):
        g = urllib.parse.quote(json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}))
        u = (f"https://agriculture.canada.ca/imagery-images/rest/services/annual_crop_inventory/{y}/ImageServer/identify"
             f"?geometry={g}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json")
        try:
            v = int(_http(u, timeout=30, retries=1)["value"])
        except Exception:
            return {"year": y, "code": None, "crop": None}
        return {"year": y, "code": v, "crop": ACI.get(v, f"class {v}")}

    def go():
        with cf.ThreadPoolExecutor(6) as ex:
            return {"covered": True, "source": "Agriculture and Agri-Food Canada, Annual Crop Inventory (satellite-classified, 30 m)", "years": list(ex.map(one, range(2015, 2026)))}
    return cached("crophist", f"{lat:.4f},{lon:.4f}", go, ttl_days=90)


# ---------- NASA Blue Marble whole-Earth image for the 3D globe (GIBS WMS, equirectangular) ----------
EARTH = {"day": ("BlueMarble_NextGeneration", ""), "night": ("VIIRS_Black_Marble", "&TIME=2016-01-01")}


def earth(kind):
    layer, extra = EARTH[kind]
    path = os.path.join(CACHE, f"earth_{kind}.jpg")
    if os.path.exists(path):
        return open(path, "rb").read()
    url = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1"
           f"&LAYERS={layer}&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048&FORMAT=image/jpeg{extra}")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
        data = r.read()
    if len(data) < 20000:
        raise RuntimeError("NASA GIBS returned no image")
    open(path, "wb").write(data)
    return data


# ---------- places a farmer could contact to sell (OpenStreetMap; NOT confirmed buyers) ----------
FOOD = ("food", "flour", "feed", "grain", "malt", "beer", "brew", "wine", "spirit", "distill", "ethanol", "bread", "bake", "candy", "chocolate", "dairy",
        "meat", "juice", "snack", "cereal", "oil", "sugar", "starch", "tofu", "soy", "vegetable", "fruit", "potato", "chip", "pasta", "frozen", "canned", "cider")


def buyers(lat, lon, radius=50000):
    def go():
        a = f"(around:{radius},{lat},{lon})"
        q = (f'[out:json][timeout:60];(nwr["industrial"~"grain|mill|agricultur|food|ethanol|brewery|distillery"]{a};nwr["craft"~"miller|brewery|distillery|winery"]{a};'
             f'nwr["shop"="farm"]{a};nwr["amenity"="marketplace"]{a};nwr["man_made"="works"]["product"]{a};nwr["man_made"="silo"]["name"]{a};);out center tags 300;')
        data = urllib.parse.urlencode({"data": q}).encode(); j = None; err = None
        for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
            try:
                j = _http(ep, data=data, timeout=90); break
            except Exception as e:
                err = e
        if j is None:
            raise RuntimeError(f"place search unavailable: {err}")
        out, seen = [], set()
        for el in j.get("elements", []):
            t = el.get("tags", {}); name = t.get("name")
            c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
            if not name or c.get("lat") is None:
                continue
            prod = (t.get("product", "") + " " + t.get("industrial", "") + " " + t.get("craft", "")).lower()
            if t.get("amenity") == "marketplace":
                kind = "market"
            elif t.get("shop") == "farm":
                kind = "farmshop"
            elif t.get("man_made") == "silo" or any(k in prod for k in ("grain", "mill", "miller", "ethanol", "feed", "flour", "malt")):
                kind = "grain"
            elif any(k in prod for k in FOOD) or "brewery" in prod or "distillery" in prod or "winery" in prod:
                kind = "food"
            else:
                continue
            key = (name.lower(), round(c["lat"], 3), round(c["lon"], 3))
            if key in seen:
                continue
            seen.add(key)
            d = math.hypot((c["lat"] - lat) * 110540, (c["lon"] - lon) * 111320 * math.cos(math.radians(lat)))
            out.append({"name": name, "kind": kind, "lat": round(c["lat"], 5), "lon": round(c["lon"], 5), "km": round(d / 1000, 1), "what": t.get("product") or t.get("industrial") or t.get("craft") or ""})
        out.sort(key=lambda p: p["km"])
        return {"source": "OpenStreetMap contributors (ODbL)", "radius_km": radius // 1000, "places": out[:80]}
    return cached("buyers", f"{lat:.2f},{lon:.2f},{radius}", go, ttl_days=30)


# ---------- past fires near a place: NASA FIRMS yearly country archives (MODIS hotspots, no key needed) ----------
FIRMS_ALIAS = {"United States of America": "United_States", "Russia": "Russian_Federation", "Côte d'Ivoire": "Ivory_Coast", "DR Congo": "Democratic_Republic_of_the_Congo",
               "Democratic Republic of the Congo": "Democratic_Republic_of_the_Congo", "Tanzania": "United_Republic_of_Tanzania", "Iran": "Iran"}


def _country_en(lat, lon):
    def go():
        j = _http(f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=3&accept-language=en", timeout=30)
        return {"name": j.get("address", {}).get("country", "")}
    return cached("country_en", f"{lat:.1f},{lon:.1f}", go)["name"]


def _firms_year(country, year):
    path = os.path.join(CACHE, f"firms_{country}_{year}.csv")
    if not os.path.exists(path):
        url = f"https://firms.modaps.eosdis.nasa.gov/data/country/modis/{year}/modis_{year}_{country}.csv"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=180) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(path, "wb").close(); return []
            raise
        open(path, "wb").write(data)
    rows = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            try:
                rows.append((float(row["latitude"]), float(row["longitude"]), row["acq_date"], int(float(row.get("confidence") or 0)), float(row.get("frp") or 0)))
            except (KeyError, ValueError):
                continue
    return rows


def fire_history(lat, lon, radius_km=30):
    def go():
        name = _country_en(lat, lon)
        if not name:
            return {"covered": False, "years": []}
        country = FIRMS_ALIAS.get(name, name.replace(" ", "_"))
        import concurrent.futures as cf
        yrs = list(range(2015, datetime_year()))
        with cf.ThreadPoolExecutor(4) as ex:
            data = dict(zip(yrs, ex.map(lambda y: _firms_year(country, y), yrs)))
        if not any(data.values()):
            return {"covered": False, "country": name, "years": []}
        k = math.cos(math.radians(lat)); years, near = [], []
        for y in yrs:
            n = 0
            for la, lo, d, conf, frp in data[y]:
                if conf < 50 or abs(la - lat) > radius_km / 110 or abs(lo - lon) > radius_km / (111 * k):
                    continue
                km = math.hypot((la - lat) * 110.54, (lo - lon) * 111.32 * k)
                if km <= radius_km:
                    n += 1; near.append({"lat": la, "lon": lo, "date": d, "km": round(km, 1), "frp": frp})
            years.append({"year": y, "count": n})
        near.sort(key=lambda p: p["km"])
        return {"covered": True, "country": name, "radius_km": radius_km, "years": years, "nearest": near[:60], "total": len(near),
                "source": "NASA FIRMS, MODIS fire hotspots (yearly country archives), confidence 50% or more"}
    return cached("firehist", f"{lat:.3f},{lon:.3f},{radius_km}", go, ttl_days=60)


def datetime_year():
    import datetime as _dt
    return _dt.date.today().year


# ---------- water near a field: lakes, ponds, rivers, canals, streams (OpenStreetMap) ----------
def water(lat, lon, radius=10000):
    def go():
        k = math.cos(math.radians(lat)); dl = radius / 110540; dn = radius / (111320 * k)
        bb = f"{lat - dl},{lon - dn},{lat + dl},{lon + dn}"
        q = (f'[out:json][timeout:80];(way["natural"="water"](around:{radius},{lat},{lon});relation["natural"="water"](around:{radius},{lat},{lon});'
             f'way["waterway"~"^(river|canal)$"](around:{radius},{lat},{lon});way["waterway"~"^(stream|ditch|drain)$"](around:3000,{lat},{lon});'
             f'way["landuse"="reservoir"](around:{radius},{lat},{lon}););out tags geom({bb});')
        data = urllib.parse.urlencode({"data": q}).encode(); j = None; err = None
        for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
            try:
                j = _http(ep, data=data, timeout=110); break
            except Exception as e:
                err = e
        if j is None:
            raise RuntimeError(f"water search unavailable: {err}")
        out = []
        for el in j.get("elements", []):
            t = el.get("tags", {})
            pts = [(p["lat"], p["lon"]) for p in el.get("geometry", []) if p]
            for m in el.get("members", []):
                pts += [(p["lat"], p["lon"]) for p in m.get("geometry", []) or [] if p]
            if el.get("type") == "node":
                pts = [(el["lat"], el["lon"])]
            if not pts:
                continue
            best = min(pts, key=lambda p: (p[0] - lat) ** 2 + ((p[1] - lon) * k) ** 2)
            km = math.hypot((best[0] - lat) * 110.54, (best[1] - lon) * 111.32 * k)
            ww = t.get("waterway"); nat = t.get("water") or t.get("natural")
            kind = ("well" if t.get("man_made") == "water_well" else "river" if ww in ("river", "canal") else "stream" if ww else
                    "reservoir" if t.get("landuse") == "reservoir" or nat == "reservoir" else "pond" if nat in ("pond", "basin", "lagoon") else "lake")
            out.append({"name": t.get("name"), "kind": kind, "km": round(km, 2), "lat": round(best[0], 5), "lon": round(best[1], 5)})
        out.sort(key=lambda w: w["km"])
        nearest = {}
        for w in out:
            nearest.setdefault(w["kind"], w)
        named = []
        for w in out:
            if w["name"] and all(w["name"] != x["name"] for x in named):
                named.append(w)
        return {"source": "OpenStreetMap contributors (ODbL)", "nearest": nearest, "named": named[:12], "count": len(out)}
    return cached("water", f"{lat:.3f},{lon:.3f},{radius}", go, ttl_days=30)


# ---------- the 2050s at a place: NASA NEX-GDDP-CMIP6 (downscaled CMIP6, 0.25 deg, SSP2-4.5) ----------
# Change factors: each model's 2049-2051 against its own 2012-2014, so model bias cancels. Applied to the NASA POWER record by the app.
NEX = "https://ds.nccs.nasa.gov/thredds"
NEX_MODELS = ("CanESM5", "MRI-ESM2-0", "GFDL-ESM4")
NEX_YEARS = {"historical": (2012, 2013, 2014), "ssp245": (2049, 2050, 2051)}


def _nex_files(model, exp, var):
    def go():
        with urllib.request.urlopen(urllib.request.Request(f"{NEX}/catalog/AMES/NEX/GDDP-CMIP6/{model}/{exp}/r1i1p1f1/{var}/catalog.xml", headers={"User-Agent": UA}), timeout=60) as r:
            x = r.read().decode()
        import re
        return re.findall(r'name="([^"]+\.nc)"', x)
    return cached("nexcat", f"{model},{exp},{var}", go, ttl_days=180)


def _nex_year(model, exp, var, year, lat, lon):
    fn = [f for f in _nex_files(model, exp, var) if f"_{year}" in f]
    if not fn:
        raise RuntimeError(f"no NEX file {model} {exp} {var} {year}")
    fn = sorted(fn)[-1]  # latest version
    u = (f"{NEX}/ncss/grid/AMES/NEX/GDDP-CMIP6/{model}/{exp}/r1i1p1f1/{var}/{fn}?var={var}&latitude={lat}&longitude={lon % 360:.3f}"
         f"&time_start=1900-01-01&time_end=2200-01-01&accept=csv")
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=150) as r:
                rows = r.read().decode().splitlines()[1:]
            return [float(x.split(",")[-1]) for x in rows if x]
        except Exception as e:
            last = e; time.sleep(2)
    raise last


def future(lat, lon):
    # NEX-GDDP-CMIP6 is a 0.25 degree grid (cell centres at .125, .375, ...): every field in the same cell gets the same answer, so share it
    lat = math.floor(lat / 0.25) * 0.25 + 0.125; lon = math.floor(lon / 0.25) * 0.25 + 0.125

    def go():
        import concurrent.futures as cf
        jobs = [(m, e, v, y) for m in NEX_MODELS for e, ys in NEX_YEARS.items() for v in ("tasmax", "pr") for y in ys]
        with cf.ThreadPoolExecutor(len(jobs)) as ex:  # each request takes ~15 s on NASA's side, so ask for all of them at once
            res = dict(zip(jobs, ex.map(lambda j: _nex_year(*j, lat, lon), jobs)))
        models = []
        for m in NEX_MODELS:
            def avg(e, v):
                vals = [x for y in NEX_YEARS[e] for x in res[(m, e, v, y)]]
                return sum(vals) / len(vals)
            def hot(e):
                vals = [x for y in NEX_YEARS[e] for x in res[(m, e, "tasmax", y)]]
                return sum(1 for x in vals if x - 273.15 > 30) / len(NEX_YEARS[e])
            dT = avg("ssp245", "tasmax") - avg("historical", "tasmax")
            dP = avg("ssp245", "pr") / avg("historical", "pr") - 1 if avg("historical", "pr") > 0 else 0.0
            models.append({"model": m, "dT": round(dT, 2), "dP": round(dP, 3), "hot_now": round(hot("historical"), 1), "hot_2050s": round(hot("ssp245"), 1)})
        return {"source": "NASA NEX-GDDP-CMIP6 (downscaled CMIP6), scenario SSP2-4.5 (middle of the road)", "scenario": "SSP2-4.5",
                "periods": {"now": "2012-2014", "future": "2049-2051"}, "models": models}
    return cached("future", f"cell {lat:.3f},{lon:.3f}", go)
