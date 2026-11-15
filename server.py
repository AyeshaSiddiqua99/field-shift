"""Local server: serves the app and proxies the data services (NASA POWER, SoilGrids, climate projections, MODIS NDVI, OSM farms).

Run:  python server.py   ->  http://localhost:8765
"""
import datetime
import json
import os
import traceback
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import services

ROOT = os.path.dirname(os.path.abspath(__file__))
PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,GWETROOT,GWETTOP"


def power(lat, lon):
    end = (datetime.date.today() - datetime.timedelta(days=10)).strftime("%Y%m%d")  # POWER lags real time by a few days

    def go():
        url = (f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters={PARAMS}"
               f"&community=AG&longitude={lon}&latitude={lat}&start=20050101&end={end}&format=JSON")
        raw = services._http(url, timeout=120, retries=1)
        p = raw["properties"]["parameter"]
        dates = sorted(p["T2M"].keys())
        out = {"start": dates[0], "n": len(dates), "elev": raw["geometry"]["coordinates"][2], "lat": lat, "lon": lon,
               "name": f"{lat:.2f}, {lon:.2f}"}
        for k in PARAMS.split(","):
            out[k] = [None if p[k][d] in (-999, -999.0) else round(p[k][d], 3) for d in dates]
        return out
    return services.cached("power", f"{lat:.2f},{lon:.2f},{end[:6]}", go)  # month in the key: refreshed monthly


def num(q, k, lo, hi):
    v = float(q[k][0])
    if not lo <= v <= hi:
        raise ValueError(f"{k} out of range")
    return v


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, fmt, *args):  # quiet
        pass

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return super().do_GET()
        q = parse_qs(u.query)
        if u.path in ("/api/gibs", "/api/esri"):
            return self.tile(u.path, q)
        if u.path == "/api/earth":
            try:
                data = services.earth(q.get("kind", ["day"])[0])
            except Exception as e:
                return self.reply(502, {"error": str(e)})
            self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.send_header("Content-Length", str(len(data))); self.end_headers()
            return self.wfile.write(data)
        if u.path == "/api/outlook":
            try:
                lat, lon, crop = round(num(q, "lat", -60, 72), 4), round(num(q, "lon", -180, 180), 4), q["crop"][0]
                import sys
                sys.path.insert(0, os.path.join(ROOT, "ml"))
                import outlook
                return self.reply(200, outlook.predict(power(lat, lon), lat, lon, crop))
            except Exception as e:
                traceback.print_exc()
                return self.reply(502, {"error": str(e)})
        if u.path == "/api/layerdates":
            try:
                return self.reply(200, services.gibs_latest())
            except Exception as e:
                return self.reply(502, {"error": str(e)})
        if u.path == "/api/legend":
            try:
                return self.reply(200, services.legend(q["key"][0]))
            except Exception as e:
                return self.reply(502, {"error": str(e)})
        try:
            if u.path == "/api/geocode":
                text = q["q"][0].strip()[:120]
                if len(text) < 2:
                    raise ValueError("query too short")
                body = services.geocode(text)
            else:
                lat, lon = num(q, "lat", -60, 72), num(q, "lon", -180, 180)
                fn = {"/api/power": power, "/api/soil": services.soil, "/api/climate": services.climate,
                      "/api/ndvi": services.ndvi, "/api/farms": services.farms, "/api/slope": services.slope,
                      "/api/yield": services.yield_series, "/api/fires": services.fires, "/api/history": services.crop_history, "/api/buyers": services.buyers, "/api/firehistory": services.fire_history, "/api/water": services.water, "/api/future": services.future}.get(u.path)
                if fn is None:
                    return self.send_error(404)
                lat, lon = round(lat, 4), round(lon, 4)
                body = fn(lat, lon)
            self.reply(200, body)
        except Exception as e:
            traceback.print_exc()
            self.reply(502, {"error": str(e)})

    def tile(self, path, q):
        try:
            z, x, y = int(q["z"][0]), int(q["x"][0]), int(q["y"][0])
            if not (0 <= z <= 19 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
                raise ValueError("bad tile")
            if path == "/api/esri":
                data, used, ctype = services.esri_tile(z, x, y), None, "image/jpeg"
            else:
                key = q["key"][0]
                if key not in services.GIBS_LAYERS:
                    raise ValueError("unknown layer")
                date = q.get("date", [""])[0]
                if services.GIBS_LAYERS[key][3] and not (len(date) == 10 and date[4] == "-" and date[7] == "-"):
                    raise ValueError("bad date")
                data, used = services.gibs_tile(key, date, z, x, y)
                ctype = "image/png"
        except services.NoData as e:
            return self.reply(404, {"error": str(e)})
        except Exception as e:
            return self.reply(502, {"error": str(e)})
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if used:
            self.send_header("X-Date-Used", used)
            self.send_header("Access-Control-Expose-Headers", "X-Date-Used")
        self.end_headers()
        self.wfile.write(data)

    def reply(self, code, obj):
        b = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print("Field Shift demo on http://localhost:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
