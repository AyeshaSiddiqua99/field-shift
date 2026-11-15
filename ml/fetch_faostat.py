"""Filter the FAOSTAT crop production bulk file down to yields of eight crops since 2005.

Source: FAOSTAT "Production_Crops_Livestock" bulk download (national yields, kg/ha).
Usage: python ml/fetch_faostat.py <path to the extracted ..._All_Data_(Normalized).csv>
Writes ml/data/yields.csv
"""
import os
import sys

import pandas as pd

ITEMS = {"Maize (corn)": "maize", "Wheat": "wheat", "Soya beans": "soybean", "Barley": "barley", "Rice": "rice", "Potatoes": "potato", "Sorghum": "sorghum", "Rape or colza seed": "rapeseed"}
src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "yields.csv")
os.makedirs(os.path.dirname(out), exist_ok=True)
keep = []
for ch in pd.read_csv(src, chunksize=500000, encoding="utf-8", encoding_errors="replace", usecols=["Area", "Item", "Element", "Year", "Unit", "Value", "Flag"]):
    m = (ch["Element"] == "Yield") & (ch["Item"].isin(list(ITEMS))) & (ch["Year"] >= 2005)
    if m.any():
        keep.append(ch[m])
d = pd.concat(keep)
print("rows", d.shape[0], "| units", d["Unit"].unique().tolist(), "| years", int(d["Year"].min()), "-", int(d["Year"].max()))
d["Item"] = d["Item"].map(ITEMS)
d = d.rename(columns={"Area": "area", "Item": "crop", "Year": "year", "Value": "yield_kg_ha"})[["area", "crop", "year", "yield_kg_ha", "Flag"]]
d.to_csv(out, index=False)
print("countries per crop:", d.groupby("crop")["area"].nunique().to_dict())
print("flags:", d["Flag"].value_counts().to_dict())
print(d[(d.area == "Argentina") & (d.crop == "maize")].sort_values("year").tail(5).to_string(index=False))
