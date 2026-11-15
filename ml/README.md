# Season outlook model (the "AI" part)

A small gradient-boosted model (scikit-learn `HistGradientBoostingRegressor`, median plus 10th/90th percentile) that estimates how far a finished growing season's yield was above or below its normal.

- **Inputs:** NASA POWER daily weather for a place, summarised as 12 season numbers relative to that place's own normal (`features.py`), plus the crop (8 crops: maize, wheat, soybean, barley, rice, potato, sorghum, rapeseed).
- **Target:** national yield anomaly, in % vs the country's own linear trend (FAOSTAT yields, 2006-2024).
- **Training data:** 2,071 country-crop-years, 109 series. One weather point per country, so this is a **regional** estimate, not a forecast for a single farm. Growing-season months are assumed from latitude.
- **Honest test (leave-one-year-out):** average error 8.10 points vs 8.43 for "no change"; catches 46% of years 8%+ below trend; the range is widened so it holds about 81% of the time. Leave-one-country-out is similar (8.30). Full numbers in `data/outlook_metrics.json`.
- Where it fails: it missed several known events (e.g. Ukraine and Russia wheat 2010, France wheat 2016), and it uses the crop label only weakly.

## Files
| file | what |
|---|---|
| `fetch_faostat.py` | filter the FAOSTAT bulk file to yields of the 8 crops -> `data/yields.csv` |
| `regions.py` | one hand-picked region and season per country and crop (approximate) |
| `fetch_power.py` | download NASA POWER weather for those regions (`ml/cache/`, not committed, ~19 MB) |
| `features.py` | weather -> season features, plain-language driver names |
| `build_table.py` | build `data/train.csv` |
| `train.py` | train, test (leave-one-country-out, leave-one-year-out), write `data/outlook_model.joblib` and metrics |
| `outlook.py` | `predict(power_json, lat, lon, crop)` used by the server |
| `make_economics.py` | FAOSTAT world prices and yields per crop (used by the crop list, not by the model) |

Rebuild: `python fetch_faostat.py <FAOSTAT csv>`, `python fetch_power.py`, `python build_table.py`, `python train.py`. Needs `pandas numpy scikit-learn scipy joblib`.

## Data credit
Yields and prices: FAOSTAT (FAO, CC BY 4.0). Weather: NASA POWER (MERRA-2 / CERES).
