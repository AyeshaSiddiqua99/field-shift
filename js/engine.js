// Field Shift engine
// NASA POWER daily climate -> crop water balance -> rotation ranking, with uncertainty.
// All functions are pure so the same code runs in the browser and in node tests.

export const SOILS = {
  sand: { name: 'Sandy', awc: 85, K: 0.12, CN: 68 },   // awc = plant-available water, mm per m of root zone
  loam: { name: 'Loam', awc: 170, K: 0.30, CN: 76 },
  clay: { name: 'Clay', awc: 150, K: 0.24, CN: 84 },
};

// Approximate FAO-56 (Kc) and FAO-33 (Ky) defaults. These are ASSUMPTIONS, shown in the UI.
// kc = [initial, mid, end]; p = fraction of available water usable before stress; topt = optimum temp band (C)
export const CROPS = [
  { id: 'maize',     name: 'Maize',       family: 'cereal',  cash: true,  days: 130, kc: [0.30, 1.20, 0.35], ky: 1.25, root: 1.0, p: 0.55, tbase: 8,  topt: [18, 30], tmax: 40, heat: 35, frost: 0,  residueC: 0.45, color: 0x7fb83f },
  { id: 'wheat',     name: 'Wheat',       family: 'cereal',  cash: true,  days: 140, kc: [0.30, 1.15, 0.30], ky: 1.00, root: 1.0, p: 0.55, tbase: 0,  topt: [12, 24], tmax: 35, heat: 32, frost: -6, residueC: 0.35, color: 0xc9b458 },
  { id: 'soybean',   name: 'Soybean',     family: 'legume',  cash: true,  days: 120, kc: [0.40, 1.15, 0.50], ky: 0.85, root: 0.8, p: 0.50, tbase: 8,  topt: [20, 30], tmax: 40, heat: 35, frost: 0,  residueC: 0.60, color: 0x4f9e4a },
  { id: 'sorghum',   name: 'Sorghum',     family: 'cereal',  cash: true,  days: 115, kc: [0.30, 1.00, 0.55], ky: 0.90, root: 1.0, p: 0.60, tbase: 8,  topt: [22, 32], tmax: 42, heat: 38, frost: 0,  residueC: 0.45, color: 0xa66a3a },
  { id: 'millet',    name: 'Pearl millet', family: 'cereal', cash: true,  days: 100, kc: [0.30, 1.00, 0.30], ky: 0.80, root: 1.0, p: 0.65, tbase: 10, topt: [25, 35], tmax: 42, heat: 40, frost: 2,  residueC: 0.45, color: 0xb5a14a },
  { id: 'groundnut', name: 'Groundnut',   family: 'legume',  cash: true,  days: 125, kc: [0.40, 1.15, 0.60], ky: 0.70, root: 0.6, p: 0.50, tbase: 10, topt: [22, 32], tmax: 40, heat: 36, frost: 1,  residueC: 0.60, color: 0x5fae5a },
  { id: 'chickpea',  name: 'Chickpea',    family: 'legume',  cash: true,  days: 110, kc: [0.40, 1.00, 0.35], ky: 0.90, root: 0.8, p: 0.50, tbase: 5,  topt: [15, 25], tmax: 35, heat: 33, frost: -4, residueC: 0.55, color: 0x86b872 },
  { id: 'potato',    name: 'Potato',      family: 'tuber',   cash: true,  days: 110, kc: [0.50, 1.15, 0.75], ky: 1.10, root: 0.5, p: 0.35, tbase: 5,  topt: [14, 22], tmax: 30, heat: 29, frost: -1, residueC: 0.85, color: 0x3f8f4a },
  { id: 'sunflower', name: 'Sunflower',   family: 'oilseed', cash: true,  days: 120, kc: [0.35, 1.10, 0.35], ky: 0.95, root: 1.0, p: 0.45, tbase: 6,  topt: [18, 28], tmax: 38, heat: 35, frost: -1, residueC: 0.55, color: 0xd9a92b },
  { id: 'cover',     name: 'Legume cover', family: 'legume', cash: false, days: 90,  kc: [0.30, 0.85, 0.60], ky: 0.50, root: 0.6, p: 0.60, tbase: 3,  topt: [12, 28], tmax: 38, heat: 38, frost: -5, residueC: 0.20, color: 0x2f7d4f },
];
// sow = acceptable 10-day mean air temperature (C) at sowing; value = rough relative gross value per ha (maize = 1).
// The value index is a crude ASSUMPTION (no market data is wired in) and is randomised in the robustness test.
const EXTRA = {
  maize: { sow: [11, 30], value: 1.00, root: 1.2 }, wheat: { sow: [4, 17], value: 0.80, root: 1.1 }, soybean: { sow: [13, 30], value: 0.85, root: 0.9 },
  sorghum: { sow: [16, 34], value: 0.55, root: 1.3 }, millet: { sow: [20, 36], value: 0.35, root: 1.2 }, groundnut: { sow: [18, 32], value: 0.75, root: 0.7 },
  chickpea: { sow: [4, 20], value: 0.55, root: 0.8, maxRain: 300 }, potato: { sow: [6, 20], value: 1.30, root: 0.5 }, sunflower: { sow: [9, 26], value: 0.65, root: 1.2, maxRain: 600 },
  cover: { sow: [4, 28], value: 0, root: 0.6 },
};
// maxRain = in-season rainfall (mm) above which disease and waterlogging losses start (crude proxy, not simulated explicitly)
EXTRA.groundnut.maxRain = 700; EXTRA.millet.maxRain = 700;
// ph = optimum soil pH band; residue = relative crop residue / root return to the soil (0-1, rough literature-style values)
const PHRES = { maize: [5.8, 7.5, 1.0], wheat: [6.0, 7.5, 0.8], soybean: [6.0, 7.0, 0.5], sorghum: [5.5, 8.0, 0.9], millet: [5.0, 7.5, 0.6],
  groundnut: [5.5, 7.0, 0.35], chickpea: [6.0, 8.0, 0.4], potato: [5.0, 6.5, 0.15], sunflower: [6.0, 7.5, 0.7], cover: [5.5, 7.5, 0.9] };
for (const [id, [lo, hi, res]] of Object.entries(PHRES)) Object.assign(EXTRA[id], { ph: [lo, hi], residue: res });
CROPS.forEach(c => Object.assign(c, EXTRA[c.id]));
export const CROP = Object.fromEntries(CROPS.map(c => [c.id, c]));

export const DEFAULT_P = { kc: 1, ky: 1, awc: 1, heat: 0, legume: 0.08, mono: 0.12, vm: {} };

// soil parameters: either measured (farm.sp, from soil database) or a coarse class chosen by hand
const soilOf = farm => farm.sp || SOILS[farm.soil];

const TEXTURES = ['Sand', 'Loamy sand', 'Sandy loam', 'Loam', 'Silt loam', 'Silt', 'Sandy clay loam', 'Clay loam', 'Silty clay loam', 'Sandy clay', 'Silty clay', 'Clay'];
export function textureClass(sand, silt, clay) { // USDA triangle, percent
  if (silt + 1.5 * clay < 15) return 'Sand';
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'Loamy sand';
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return 'Sandy loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'Loam';
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return 'Silt loam';
  if (silt >= 80 && clay < 12) return 'Silt';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'Sandy clay loam';
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'Clay loam';
  if (clay >= 27 && clay < 40 && sand <= 20) return 'Silty clay loam';
  if (clay >= 35 && sand > 45) return 'Sandy clay';
  if (clay >= 40 && silt >= 40) return 'Silty clay';
  if (clay >= 40 && sand <= 45 && silt < 40) return 'Clay';
  return 'Loam';
}
const HSG = { 'Sand': 'A', 'Loamy sand': 'A', 'Sandy loam': 'B', 'Loam': 'B', 'Silt loam': 'B', 'Silt': 'B', 'Sandy clay loam': 'C', 'Clay loam': 'C', 'Silty clay loam': 'C', 'Sandy clay': 'D', 'Silty clay': 'D', 'Clay': 'D' };
const CN_BY_HSG = { A: 68, B: 76, C: 82, D: 86 };

// SoilGrids layers (0-100 cm) -> model soil parameters. Water retention uses the Saxton & Rawls (2006) pedotransfer equations.
export function soilFromLayers(layers) {
  const ok = layers.filter(l => l.clay != null && l.sand != null && l.silt != null);
  if (!ok.length) return null;
  let wAwc = 0, wth = 0; const det = [];
  for (const l of ok) {
    const S = l.sand / 100, C = l.clay / 100, OM = Math.min(8, (l.soc ?? 10) / 10 * 1.724), th = l.bottom - l.top;
    const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031, wp = t1500 + (0.14 * t1500 - 0.02);
    const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299, fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
    const awc = clamp((fc - wp) * 1000, 40, 260); wAwc += awc * th; wth += th;
    det.push({ ...l, awc, fc: fc * 100, wp: wp * 100, texture: textureClass(l.sand, l.silt, l.clay) });
  }
  const top = ok.filter(l => l.bottom <= 30), tw = top.reduce((s, l) => s + (l.bottom - l.top), 0) || 1;
  const avg = key => top.reduce((s, l) => s + (l[key] ?? 0) * (l.bottom - l.top), 0) / tw;
  const sand = avg('sand'), silt = avg('silt'), clay = avg('clay'), soc = avg('soc'), ph = avg('ph'), n = avg('n'), bd = avg('bd');
  const texture = textureClass(sand, silt, clay), hsg = HSG[texture], om = Math.min(8, soc / 10 * 1.724);
  const K = clamp((0.12 + 0.35 * silt / 100 - 0.05 * sand / 100) * Math.max(0.7, 1 - 0.03 * om), 0.05, 0.5);
  return { awc: wAwc / wth, K, CN: CN_BY_HSG[hsg], ph: ph || null, soc, n, bd, sand, silt, clay, texture, hsg, om, layers: det, measured: true };
}

const STAGE_END = [0.15, 0.40, 0.75, 1.0];
const KY_W = [0.5, 0.8, 1.3, 0.7];                      // relative sensitivity of each growth stage to water deficit
const E0 = 12;                                          // erosion index scale (arbitrary units -> 0..100)

// ---------- small helpers ----------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
export function quantile(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; }
export function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

const kcAt = (cr, t) => { const [a, m, e] = cr.kc; return t < 0.15 ? a : t < 0.40 ? a + (m - a) * (t - 0.15) / 0.25 : t < 0.75 ? m : m + (e - m) * (t - 0.75) / 0.25; };
export const canopyAt = (t) => t < 0.15 ? 0.05 : t < 0.40 ? 0.05 + 0.9 * (t - 0.15) / 0.25 : t < 0.75 ? 0.95 : 0.95 - 0.55 * (t - 0.75) / 0.25;
const stageOf = t => t < 0.15 ? 0 : t < 0.40 ? 1 : t < 0.75 ? 2 : 3;
function thermal(T, cr) {
  const [lo, hi] = cr.topt;
  if (T <= cr.tbase || T >= cr.tmax) return 0;
  if (T < lo) return (T - cr.tbase) / (lo - cr.tbase);
  if (T <= hi) return 1;
  return (cr.tmax - T) / (cr.tmax - hi);
}
function runoffQ(P, CN) { if (P <= 0) return 0; const S = 25400 / CN - 254, Ia = 0.2 * S; if (P <= Ia) return 0; const x = P - Ia; return x * x / (x + S); }
const LS = s => 0.065 + 0.045 * s + 0.0065 * s * s;

// ---------- climate preparation ----------
const T0 = Date.UTC(2005, 0, 1);
export const YEAR0 = 2006, YEAR1 = 2023; // calendar years used as planting years (need spin-up before and a full year after)

export function prepClimate(raw, scen = { dT: 0, dP: 0, ext: 0 }) {
  const n = raw.n, fill = (arr, d) => { const o = new Float32Array(n); let last = d; for (let i = 0; i < n; i++) { const v = arr[i]; if (v != null) last = v; o[i] = last; } return o; };
  const tmean0 = fill(raw.T2M, 15), tmax0 = fill(raw.T2M_MAX, 20), tmin0 = fill(raw.T2M_MIN, 10);
  const prec0 = new Float32Array(n); for (let i = 0; i < n; i++) prec0[i] = raw.PRECTOTCORR[i] != null ? Math.max(0, raw.PRECTOTCORR[i]) : 0;
  const doy = new Int16Array(n), yearOf = new Int16Array(n);
  for (let i = 0; i < n; i++) { const d = new Date(T0 + i * 864e5); yearOf[i] = d.getUTCFullYear(); doy[i] = Math.floor((d - Date.UTC(yearOf[i], 0, 1)) / 864e5) + 1; }
  // every planting year with a full year of weather after the latest possible sowing (grows as the data is refreshed)
  const yStarts = []; for (let y = YEAR0; ; y++) { const ys = Math.round((Date.UTC(y, 0, 1) - T0) / 864e5); if (ys + 726 > n) break; yStarts.push(ys); }

  // scenario: warming + rainfall change + heavier storms (heavy days scaled up, light days adjusted so the annual total matches)
  const tmean = tmean0.map(v => v + scen.dT), tmax = tmax0.map(v => v + scen.dT), tmin = tmin0.map(v => v + scen.dT);
  const wet = []; for (let i = 0; i < n; i++) if (prec0[i] > 1) wet.push(prec0[i]);
  const p90 = wet.length ? quantile(wet, 0.9) : 1e9;
  const prec = new Float32Array(prec0);
  if (scen.dP !== 0 || scen.ext !== 0) {
    let i = 0;
    while (i < n) {
      let j = i; while (j < n && yearOf[j] === yearOf[i]) j++;
      let sH = 0, sL = 0; for (let k = i; k < j; k++) (prec0[k] > p90 ? (sH += prec0[k]) : (sL += prec0[k]));
      const target = (sH + sL) * (1 + scen.dP); let fH = 1 + scen.ext, fL;
      if (sL <= 0) { fH = sH > 0 ? target / sH : 1; fL = 1; }
      else { fL = (target - sH * fH) / sL; if (fL < 0) { fL = 0; fH = sH > 0 ? target / sH : 1; } }
      for (let k = i; k < j; k++) prec[k] = prec0[k] > p90 ? prec0[k] * fH : prec0[k] * fL;
      i = j;
    }
  }
  // reference ET: Hargreaves radiation form, using NASA POWER measured-model solar radiation (MJ/m2/day)
  const rad = fill(raw.ALLSKY_SFC_SW_DWN, 15), et0 = new Float32Array(n);
  for (let i = 0; i < n; i++) et0[i] = Math.max(0, 0.0135 * 0.408 * rad[i] * (tmean[i] + 17.8));

  // simple stats for display
  const ann = {}; for (let i = 0; i < n; i++) { const y = yearOf[i]; (ann[y] ??= { t: 0, p: 0, c: 0 }); ann[y].t += tmean0[i]; ann[y].p += prec0[i]; ann[y].c++; }
  const ys = Object.keys(ann).map(Number).filter(y => ann[y].c > 360), xs = ys.map(y => y), ts = ys.map(y => ann[y].t / ann[y].c);
  const mx = mean(xs), mt = mean(ts); let num = 0, den = 0; xs.forEach((x, k) => { num += (x - mx) * (ts[k] - mt); den += (x - mx) ** 2; });
  const stats = {
    meanT: mean(ts), meanP: mean(ys.map(y => ann[y].p)),
    trendPerDecade: den ? 10 * num / den : 0,
    scenT: mean(ts) + scen.dT, scenP: mean(ys.map(y => ann[y].p)) * (1 + scen.dP),
  };
  return { n, lat: raw.lat, lon: raw.lon, name: raw.name, tmean, tmax, tmin, prec, et0, rad, doy, yearOf, yStarts, gwroot: raw.GWETROOT, stats, p90 };
}

// ---------- one crop season (+ 365 day erosion year) ----------
export function seasonSim(c, cr, farm, plantIdx, P, light) {
  const L = cr.days;
  if (plantIdx - 60 < 0 || plantIdx + 365 > c.n) return null;
  const soil = soilOf(farm), TAW = soil.awc * P.awc * cr.root, RAW = cr.p * TAW, CN0 = Math.min(92, soil.CN + 0.5 * farm.slope);
  let Dr = 0.5 * TAW;
  for (let i = plantIdx - 60; i < plantIdx; i++) { // fallow spin-up: stored water before planting
    const q = runoffQ(c.prec[i], CN0), ks = Dr <= RAW ? 1 : Math.max(0, (TAW - Dr) / (TAW - RAW));
    Dr = clamp(Dr - (c.prec[i] - q) + ks * 0.3 * c.et0[i], 0, TAW);
  }
  let irrLeft = farm.irrig, irrUsed = 0, sumF = 0, heat = 0, frostPen = 1, stress = 0, severe = 0, drain = 0, seasonRain = 0;
  const eta = [0, 0, 0, 0], etc = [0, 0, 0, 0];
  for (let k = 0; k < L; k++) {
    const i = plantIdx + k, t = k / L, st = stageOf(t), e = kcAt(cr, t) * P.kc * c.et0[i];
    if (irrLeft > 0 && Dr > RAW) { const a = Math.min(irrLeft, 30, Dr); Dr -= a; irrLeft -= a; irrUsed += a; }
    const q = runoffQ(c.prec[i], CN0 - 6 * canopyAt(t)), ks = Dr <= RAW ? 1 : Math.max(0, (TAW - Dr) / (TAW - RAW)), ea = ks * e;
    Dr = Dr - (c.prec[i] - q) + ea;
    if (Dr < 0) { drain -= Dr; Dr = 0; } else if (Dr > TAW) Dr = TAW;
    eta[st] += ea; etc[st] += e; if (ks < 0.8) stress++; if (ks < 0.5) severe++; seasonRain += c.prec[i];
    sumF += thermal(c.tmean[i], cr);
    if (t >= 0.4 && t < 0.75 && c.tmax[i] > cr.heat + P.heat) heat++;
    // frost damage: only before maturity; threshold 1C below the tolerance because grid-cell minima are smoother than field minima
    if (t > 0.08 && t < 0.9 && c.tmin[i] < cr.frost - 1) frostPen = Math.min(frostPen, t < 0.75 ? 0.25 : 0.75);
  }
  // FAO-33 style: relative yield = 1 - Ky * (1 - ETa/ETc), with the deficit weighted toward the sensitive mid-season stages
  let dn = 0, dd = 0; for (let s = 0; s < 4; s++) { dn += KY_W[s] * (etc[s] - eta[s]); dd += KY_W[s] * etc[s]; }
  const wf = Math.max(0, 1 - cr.ky * P.ky * (dd > 0 ? dn / dd : 0));
  const Ft = clamp(sumF / L / 0.9, 0, 1), heatPen = Math.max(0.35, 1 - 0.025 * heat);
  const wetPen = cr.maxRain && seasonRain > cr.maxRain ? Math.max(0.4, 1 - 0.003 * (seasonRain - cr.maxRain)) : 1;
  // soil pH: -12% per 0.5 pH unit outside the crop's optimum band (floor 0.5)
  const phd = soil.ph == null ? 0 : Math.max(0, cr.ph[0] - soil.ph, soil.ph - cr.ph[1]), phPen = Math.max(0.5, 1 - 0.24 * phd);
  const out = { rel: Ft * wf * heatPen * frostPen * wetPen * phPen, phPen, eta: eta[0] + eta[1] + eta[2] + eta[3], irr: irrUsed, stress, severe, heat, frost: frostPen < 1, wf, Ft };
  if (!light) {
    let E = 0, bare = 0;
    for (let j = 0; j < 365; j++) {
      const i = plantIdx + j; let C, cov = 0;
      if (j < L) { cov = canopyAt(j / L); C = 0.9 - 0.75 * cov; } else C = cr.residueC;
      E += C * Math.pow(runoffQ(c.prec[i], CN0 - 6 * cov), 1.5); if (C > 0.6) bare++;
    }
    E *= soil.K * LS(farm.slope);
    out.eros = 100 * (1 - Math.exp(-E / E0)); out.bare = bare / 365;
  }
  return out;
}

// day-by-day trace of one crop (for the 3D view). Same equations as seasonSim.
export function trace(c, cr, farm, plantIdx, P, i0, i1) {
  const soil = soilOf(farm), TAW = soil.awc * P.awc * cr.root, RAW = cr.p * TAW, CN0 = Math.min(92, soil.CN + 0.5 * farm.slope), L = cr.days;
  let Dr = 0.5 * TAW;
  for (let i = i0 - 60; i < i0; i++) { const q = runoffQ(c.prec[i], CN0), ks = Dr <= RAW ? 1 : Math.max(0, (TAW - Dr) / (TAW - RAW)); Dr = clamp(Dr - (c.prec[i] - q) + ks * 0.3 * c.et0[i], 0, TAW); }
  const m = i1 - i0, o = { canopy: new Float32Array(m), t: new Float32Array(m), moist: new Float32Array(m), ks: new Float32Array(m), inSeason: new Uint8Array(m), heat: new Uint8Array(m), frost: new Uint8Array(m), plant: plantIdx - i0, harvest: plantIdx + L - i0 };
  let irrLeft = farm.irrig;
  for (let i = i0; i < i1; i++) {
    const idx = i - i0, inS = i >= plantIdx && i < plantIdx + L, t = inS ? (i - plantIdx) / L : 0;
    if (i === plantIdx) irrLeft = farm.irrig;
    const e = (inS ? kcAt(cr, t) * P.kc : 0.3) * c.et0[i];
    if (inS && irrLeft > 0 && Dr > RAW) { const a = Math.min(irrLeft, 30, Dr); Dr -= a; irrLeft -= a; }
    const q = runoffQ(c.prec[i], CN0 - (inS ? 6 * canopyAt(t) : 0)), ks = Dr <= RAW ? 1 : Math.max(0, (TAW - Dr) / (TAW - RAW));
    Dr = clamp(Dr - (c.prec[i] - q) + ks * e, 0, TAW);
    o.canopy[idx] = inS ? canopyAt(t) : 0; o.t[idx] = t; o.inSeason[idx] = inS ? 1 : 0; o.moist[idx] = 1 - Dr / TAW; o.ks[idx] = inS ? ks : 1;
    o.heat[idx] = inS && c.tmax[i] > cr.heat + P.heat ? 1 : 0; o.frost[idx] = c.tmin[i] < 0 ? 1 : 0;
  }
  return o;
}

// ---------- per-crop table: best planting date + yearly results ----------
export function evalCrops(c, farm, P = DEFAULT_P) {
  const table = {};
  for (const cr of CROPS) {
    const doys = []; for (let d = 1; d <= 361; d += 10) doys.push(d);
    const ms = doys.map(doy => {
      // sowing window: mean 10-day air temperature after sowing must be acceptable for the crop
      let tw = 0; for (const ys of c.yStarts) { let s = 0; for (let d = 0; d < 10; d++) s += c.tmean[ys + doy - 1 + d]; tw += s / 10; }
      tw /= c.yStarts.length; if (tw < cr.sow[0] || tw > cr.sow[1]) return -1;
      let s = 0, k = 0;
      for (const ys of c.yStarts) { const r = seasonSim(c, cr, farm, ys + doy - 1, P, true); if (r) { s += r.rel; k++; } }
      return k ? s / k : 0;
    });
    let bi = 0; ms.forEach((m, i) => { if (m > ms[bi]) bi = i; });
    let best = null;
    if (ms[bi] >= 0) {
      // the optimum is usually flat: sow at the START of the plateau within 2% of the best (farmers sow as early as is safe)
      const thr = ms[bi] - 0.02; let i = bi;
      for (let guard = 0; guard < doys.length; guard++) { const prev = (i - 1 + doys.length) % doys.length; if (ms[prev] >= thr && prev !== bi) i = prev; else break; }
      best = { doy: doys[i], m: ms[i] };
    }
    if (!best) { // no acceptable sowing window in this climate: the crop cannot be grown here
      const z = { rel: 0, eta: 0, irr: 0, stress: 0, heat: 0, frost: false, eros: 60, bare: 0.7 };
      table[cr.id] = { doy: 1, rows: c.yStarts.map(() => ({ ...z })), meanRel: 0, noWindow: true };
      continue;
    }
    const rows = c.yStarts.map(ys => seasonSim(c, cr, farm, ys + best.doy - 1, P, false));
    table[cr.id] = { doy: best.doy, rows, meanRel: mean(rows.map(r => r.rel)) };
  }
  return table;
}

// rotation effects: rule-of-thumb assumptions, shown in the UI and varied in the robustness test
export function rotMod(cr, pred, P) {
  if (pred.id === cr.id) return 1 - P.mono;
  let m = 1;
  if (pred.family === 'legume' && cr.family !== 'legume') m *= 1 + P.legume;
  else if (pred.family === cr.family && cr.family !== 'legume') m *= 0.96;
  return m;
}

export function evalRotation(table, ids, P) {
  const k = ids.length, nY = table[ids[0]].rows.length, farmY = [], water = [], irr = [], eros = [], bare = [], stress = [], build = [];
  for (let y = 0; y < nY; y++) {
    let inc = 0, w = 0, ir = 0, er = 0, ba = 0, st = 0, bd = 0;
    for (let j = 0; j < k; j++) {
      const cr = CROP[ids[j]], pred = CROP[ids[(j + k - 1) % k]], r = table[cr.id].rows[y], att = Math.min(1, r.rel * rotMod(cr, pred, P));
      if (cr.cash) inc += cr.value * (P.vm?.[cr.id] ?? 1) * att; w += r.eta; ir += r.irr; er += r.eros; ba += r.bare; st += r.stress;
      bd += (cr.cash ? att : 0.8) * cr.residue; // biomass returned to the soil follows crop growth
    }
    farmY.push(inc / k); water.push(w / k); irr.push(ir / k); eros.push(er / k); bare.push(ba / k); stress.push(st / k); build.push(bd / k);
  }
  const hasN = ids.some(id => CROP[id].family === 'legume'), fams = new Set(ids.map(id => CROP[id].family)).size, m = mean(farmY), w = mean(water);
  return {
    ids, farmY, mean: m, p10: quantile(farmY, 0.1), fail: farmY.filter(v => v < 0.5 * m).length / nY, // "bad year" = income under half of own average
    eta: w, irr: mean(irr), effic: m / (w / 100 || 1), eros: mean(eros), bare: mean(bare), stress: mean(stress),
    // soil health PROXY: low erosion, little bare ground, residue returned, a legume in the cycle, crop-family diversity
    soil: clamp(55 - 0.5 * mean(eros) - 20 * mean(bare) + 35 * mean(build) + (hasN ? 7 : 0) + 4 * (fams - 1), 0, 100), build: mean(build),
  };
}

// irrigation each crop would need (mm per season) to avoid water stress, using unlimited water in the same simulation
export function waterNeed(c, table, farm, ids, P = DEFAULT_P) {
  const big = { ...farm, irrig: 5000 };
  return [...new Set(ids)].map(id => {
    const t = table[id]; if (t.noWindow || !CROP[id].cash && id !== 'cover') return { id, mean: 0, p90: 0 };
    const v = c.yStarts.map(ys => seasonSim(c, CROP[id], big, ys + t.doy - 1, P, true)?.irr ?? 0);
    return { id, mean: mean(v), p90: quantile(v, 0.9) };
  });
}

function candidates(table) {
  let cash = CROPS.filter(c => c.cash && table[c.id].meanRel >= 0.35).map(c => c.id);
  if (cash.length < 3) cash = CROPS.filter(c => c.cash).sort((a, b) => table[b.id].meanRel - table[a.id].meanRel).slice(0, 4).map(c => c.id);
  const out = [];
  for (let i = 0; i < cash.length; i++) for (let j = i + 1; j < cash.length; j++) {
    out.push([cash[i], cash[j]], [cash[i], cash[j], 'cover'], [cash[i], 'cover', cash[j]]);
    for (let l = j + 1; l < cash.length; l++) out.push([cash[i], cash[j], cash[l]], [cash[i], cash[l], cash[j]]);
  }
  return out;
}

// score = weighted sum of min-max normalised goals; weights come from the farmer
export function rank(table, W, current, P = DEFAULT_P) {
  const cands = candidates(table).map(ids => evalRotation(table, ids, P));
  const cur = evalRotation(table, current, P);
  const keys = { income: 'mean', stability: 'p10', water: 'effic', soil: 'soil' };
  const lo = {}, hi = {}; for (const [g, key] of Object.entries(keys)) { const v = cands.map(x => x[key]); lo[g] = Math.min(...v); hi[g] = Math.max(...v); }
  const sw = (W.income + W.stability + W.water + W.soil) || 1;
  const score = x => { let s = 0; const parts = {}; for (const [g, key] of Object.entries(keys)) { const nv = hi[g] > lo[g] ? (x[key] - lo[g]) / (hi[g] - lo[g]) : 0.5; parts[g] = nv; s += (W[g] / sw) * nv; } x.score = s; x.parts = parts; };
  cands.forEach(score); score(cur);
  cands.sort((a, b) => b.score - a.score);
  return { top: cands.slice(0, 3), all: cands, current: cur };
}

export function pipeline(raw, scen, farm, W, current, P = DEFAULT_P) {
  const c = prepClimate(raw, scen), table = evalCrops(c, farm, P);
  return { c, table, ranking: rank(table, W, current, P) };
}

export const planKey = r => r.ids.join('>');

// Robust ranking: re-run the whole ranking N times with randomised assumptions (crop coefficients, soil water
// capacity, heat thresholds, rotation effects, crop values) and keep the plan that scores best across all runs.
export function robustRank(raw, scen, farm, W, current, baseRanking, N = 8) {
  const rnd = mulberry32(42), c = prepClimate(raw, scen), acc = {};
  const take = rk => { for (const x of rk.all) { const a = (acc[planKey(x)] ??= { sum: 0, n: 0, wins: 0, top3: 0 }); a.sum += x.score; a.n++; } acc[planKey(rk.top[0])].wins++; rk.top.forEach(x => acc[planKey(x)].top3++); };
  take(baseRanking);
  for (let i = 0; i < N; i++) {
    const vm = {}; for (const cr of CROPS) vm[cr.id] = 0.7 + 0.6 * rnd();
    const P = { kc: 0.9 + 0.2 * rnd(), ky: 0.8 + 0.4 * rnd(), awc: 0.8 + 0.4 * rnd(), heat: -1.5 + 3 * rnd(), legume: 0.03 + 0.09 * rnd(), mono: 0.05 + 0.13 * rnd(), vm };
    take(rank(evalCrops(c, farm, P), W, current, P));
  }
  const runs = N + 1, inBase = new Set(baseRanking.all.map(planKey));
  const order = Object.keys(acc).filter(k => inBase.has(k) && acc[k].n >= runs * 0.6).sort((a, b) => acc[b].sum / acc[b].n - acc[a].sum / acc[a].n);
  return { runs, stat: acc, order };
}

// sanity check: simulated root-zone wetness vs NASA POWER / MERRA-2 GWETROOT (monthly anomalies)
export function modelCheck(c, farm) {
  const soil = soilOf(farm), TAW = soil.awc * 1.0, RAW = 0.5 * TAW, CN0 = Math.min(92, soil.CN + 0.5 * farm.slope);
  let Dr = 0.5 * TAW; const w = new Float32Array(c.n);
  for (let i = 0; i < c.n; i++) {
    const q = runoffQ(c.prec[i], CN0), ks = Dr <= RAW ? 1 : Math.max(0, (TAW - Dr) / (TAW - RAW));
    Dr = clamp(Dr - (c.prec[i] - q) + ks * 0.8 * c.et0[i], 0, TAW); w[i] = 1 - Dr / TAW;
  }
  const buckets = {}; // key by year-month
  for (let i = 365; i < c.n; i++) {
    const g = c.gwroot[i]; if (g == null) continue; const d = new Date(T0 + i * 864e5), ym = d.getUTCFullYear() * 12 + d.getUTCMonth();
    (buckets[ym] ??= { m: d.getUTCMonth(), a: 0, b: 0, n: 0 }); buckets[ym].a += w[i]; buckets[ym].b += g; buckets[ym].n++;
  }
  const rows = Object.values(buckets).map(o => ({ m: o.m, a: o.a / o.n, b: o.b / o.n }));
  const clim = Array.from({ length: 12 }, (_, m) => { const r = rows.filter(x => x.m === m); return { a: mean(r.map(x => x.a)), b: mean(r.map(x => x.b)) }; });
  const A = rows.map(r => r.a - clim[r.m].a), B = rows.map(r => r.b - clim[r.m].b), ma = mean(A), mb = mean(B);
  let sab = 0, saa = 0, sbb = 0; A.forEach((a, i) => { sab += (a - ma) * (B[i] - mb); saa += (a - ma) ** 2; sbb += (B[i] - mb) ** 2; });
  return { r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN, months: rows.length };
}

export function yieldYearLabel(i) { return YEAR0 + i; }
