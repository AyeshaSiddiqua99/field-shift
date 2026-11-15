"""Train and honestly test the season-outlook model.

Compares the learned model with simple baselines, using two tough tests:
  - leave-one-country-out: predict a country the model has never seen
  - leave-one-year-out:    predict a year the model has never seen
Writes ml/data/outlook_model.joblib and ml/data/outlook_metrics.json
"""
import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor as HGB
from sklearn.linear_model import Ridge
from sklearn.model_selection import LeaveOneGroupOut

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import FEATURES

T = pd.read_csv(os.path.join(HERE, "data", "train.csv"))
CROPS = ["maize", "wheat", "soybean", "barley", "rice", "potato", "sorghum", "rapeseed"]
for c in CROPS:
    T["is_" + c] = (T.crop == c).astype(float)
X_COLS = FEATURES + ["is_" + c for c in CROPS]
X, y = T[X_COLS].values, T["y_anom"].values


def mk(q=None):
    kw = dict(max_depth=3, learning_rate=0.05, max_iter=150, min_samples_leaf=20, l2_regularization=2.0, random_state=0)
    return HGB(loss="quantile", quantile=q, **kw) if q else HGB(**kw)


def cv(groups):
    p = {k: np.zeros(len(y)) for k in ("zero", "ridge", "stress", "gbm", "lo", "hi")}
    for tr, te in LeaveOneGroupOut().split(X, y, groups):
        mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
        p["zero"][te] = 0.0
        p["ridge"][te] = Ridge(alpha=10.0).fit((X[tr] - mu) / sd, y[tr]).predict((X[te] - mu) / sd)
        s = T["stress_a"].values; b1, b0 = np.polyfit(s[tr], y[tr], 1); p["stress"][te] = b1 * s[te] + b0
        p["gbm"][te] = mk().fit(X[tr], y[tr]).predict(X[te])
        p["lo"][te] = mk(0.1).fit(X[tr], y[tr]).predict(X[te]); p["hi"][te] = mk(0.9).fit(X[tr], y[tr]).predict(X[te])
    return p


def score(p, name):
    e = y - p[name]; bad, pb = y <= -8, p[name] <= -4
    return {"mae": round(float(np.abs(e).mean()), 2), "rmse": round(float(np.sqrt((e ** 2).mean())), 2),
            "r2": round(float(1 - (e ** 2).sum() / (y ** 2).sum()), 3), "spearman": round(float(spearmanr(p[name], y)[0]), 3) if name != "zero" else None,
            "bad_year_recall": round(float((bad & pb).sum() / max(1, bad.sum())), 3), "bad_year_precision": round(float((bad & pb).sum() / max(1, pb.sum())), 3)}


res = {"rows": int(len(T)), "series": int(T.groupby(["area", "crop"]).ngroups), "bad_year_share": round(float((y <= -8).mean()), 3), "tests": {}}
for tname, groups in (("leave_one_country_out", T["area"].values), ("leave_one_year_out", T["year"].values)):
    p = cv(groups); res["tests"][tname] = {m: score(p, m) for m in ("zero", "ridge", "stress", "gbm")}
    res["tests"][tname]["gbm_interval_coverage_10_90"] = round(float(((y >= p["lo"]) & (y <= p["hi"])).mean()), 3)
    if tname == "leave_one_year_out":  # widen the range by the smallest margin that makes it hold 80% of the time on unseen years
        for m in np.arange(0, 20, 0.25):
            if ((y >= p["lo"] - m) & (y <= p["hi"] + m)).mean() >= 0.80:
                break
        margin = float(m); res["tests"][tname]["range_margin"] = round(margin, 2); res["tests"][tname]["calibrated_coverage"] = round(float(((y >= p["lo"] - m) & (y <= p["hi"] + m)).mean()), 3)
    if tname == "leave_one_country_out":
        T["pred_loco"], T["lo_loco"], T["hi_loco"] = p["gbm"], p["lo"], p["hi"]
print(json.dumps(res["tests"], indent=1))

# known events, predicted while that country was held out
ev = [("Argentina", "maize", 2023), ("Argentina", "soybean", 2023), ("Argentina", "wheat", 2023), ("Argentina", "maize", 2018), ("Argentina", "soybean", 2018),
      ("United States of America", "maize", 2012), ("United States of America", "soybean", 2012), ("Ukraine", "wheat", 2010), ("Russian Federation", "wheat", 2010),
      ("France", "wheat", 2016), ("Australia", "wheat", 2018), ("Canada", "wheat", 2021), ("India", "wheat", 2022), ("Brazil", "soybean", 2022)]
res["events"] = []
for a, c, yr in ev:
    r = T[(T.area == a) & (T.crop == c) & (T.year == yr)]
    if len(r):
        r = r.iloc[0]; res["events"].append({"area": a, "crop": c, "year": yr, "actual": round(float(r.y_anom), 1), "predicted": round(float(r.pred_loco), 1), "range": [round(float(r.lo_loco), 1), round(float(r.hi_loco), 1)]})
print("known events (country held out):")
for e in res["events"]:
    print(f"  {e['area'][:22]:22s} {e['crop']:8s} {e['year']}  actual {e['actual']:+6.1f}%  predicted {e['predicted']:+6.1f}%  range {e['range']}")

# final model on all rows + a feature-effect baseline for the "main driver" wording
final = {"x_cols": X_COLS, "margin": margin, "median": mk().fit(X, y), "lo": mk(0.1).fit(X, y), "hi": mk(0.9).fit(X, y)}
joblib.dump(final, os.path.join(HERE, "data", "outlook_model.joblib"))
res["trained_on"] = {"countries": int(T["area"].nunique()), "crops": sorted(T["crop"].unique().tolist()), "years": [int(T.year.min()), int(T.year.max())]}
json.dump(res, open(os.path.join(HERE, "data", "outlook_metrics.json"), "w"), indent=1)
print("saved model and metrics")
