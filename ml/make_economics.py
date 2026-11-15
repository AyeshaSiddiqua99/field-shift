"""World reference prices and yields per crop, from FAOSTAT bulk files, for the 'Best crops here' list.

price  = median producer price (USD/tonne) over countries that report it, 2019 onwards (FAOSTAT Prices bulk file)
yield  = 75th percentile of national yields (t/ha), 2015-2024, as a rough 'well-managed' yield (FAOSTAT Production bulk file)
Usage: python ml/make_economics.py <Production ...Normalized.csv> <Prices ...Normalized.csv>
Writes data/crop_economics.json. This is revenue per hectare at world prices, NOT profit (no cost data).
"""
import json
import os
import sys

import pandas as pd

MAP = {"maize": "Maize (corn)", "wheat": "Wheat", "soybean": "Soya beans", "sorghum": "Sorghum", "millet": "Millet", "groundnut": "Groundnuts, excluding shelled",
       "chickpea": "Chick peas, dry", "potato": "Potatoes", "sunflower": "Sunflower seed", "barley": "Barley", "rice": "Rice", "rapeseed": "Rape or colza seed"}
items = set(MAP.values())
Y = pd.concat(ch[(ch.Element == "Yield") & ch.Item.isin(items) & (ch.Year >= 2015)] for ch in pd.read_csv(sys.argv[1], chunksize=500000, encoding="utf-8", encoding_errors="replace", usecols=["Area", "Item", "Element", "Year", "Value"]))
P = pd.read_csv(sys.argv[2], encoding="utf-8", encoding_errors="replace", usecols=["Area", "Item", "Element", "Year", "Value"])
P = P[(P.Element == "Producer Price (USD/tonne)") & P.Item.isin(items) & (P.Year >= 2019)]
out = {}
for k, it in MAP.items():
    y = Y[Y.Item == it].groupby("Area")["Value"].mean() / 1000.0
    p = P[P.Item == it]
    out[k] = {"price_usd_t": round(float(p["Value"].median())), "yield_t_ha": round(float(y.quantile(0.75)), 2), "price_countries": int(p.Area.nunique()), "yield_countries": int(len(y))}
here = os.path.dirname(os.path.abspath(__file__))
json.dump(out, open(os.path.join(os.path.dirname(here), "data", "crop_economics.json"), "w"), indent=1)
for k, v in out.items():
    print(k, v, "revenue/ha at yield:", round(v["price_usd_t"] * v["yield_t_ha"]))
