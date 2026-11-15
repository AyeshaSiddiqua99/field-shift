// Merge into the globe app (app.html): after the globe lands on an address, pick a farm (real OpenStreetMap outlines),
// then show that farm's real NASA layers in 3D. The rest of the dashboard is the teammate's demo and is labelled simulated.
import { createMap } from './map.js';
import { createStack } from './stack3d.js';
import { CROPS, prepClimate, evalCrops, soilFromLayers } from './engine.js';

const q = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const isoAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
let map = null, stack = null, farms = [], tok = 0, shift = null;

async function fetchJSON(url, ms = 60000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'request failed'); return j; }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message); } finally { clearTimeout(t); }
}
function areaHa(pts) { const k = Math.cos(mean(pts.map(p => p[0])) * Math.PI / 180), p2 = pts.map(p => [p[1] * 111320 * k, p[0] * 110540]); let a = 0; for (let i = 0; i < p2.length; i++) { const [x1, y1] = p2[i], [x2, y2] = p2[(i + 1) % p2.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2 / 1e4; }
const fmtArea = ha => `${ha < 10 ? ha.toFixed(1) : Math.round(ha)} ha (${Math.round(ha * 2.47105)} acres)`;

// ---------- the layers panel lives inside the dashboard's field panel ----------
const LAYERS = [['rain', 'Rainfall', '#4aa3ff', 'mm/h'], ['soil', 'Soil moisture', '#2bd4a0', 'm³/m³'], ['heat', 'Heat', '#ff7a3d', '°C'], ['veg', 'Vegetation', '#7fd34a', 'NDVI'], ['water', 'Water', '#31c8f0', '']];
const fld = q('#fld'); fld.classList.add('ga');
fld.insertAdjacentHTML('beforeend', `<div id="gal"><div class="galtop"><b id="galtitle">Your farm</b>
  <button class="chip" id="galprev" type="button">&larr; week</button><input id="galdate" type="date" min="2000-06-01" aria-label="Date"><button class="chip" id="galnext" type="button">week &rarr;</button>
  <select id="galwin" aria-label="Area shown"><option value="6">6 km</option><option value="12" selected>12 km</option><option value="30">30 km</option></select></div>
  <div id="stackview" aria-label="3D stack of real NASA layers over your farm. Drag to rotate, scroll to zoom."></div>
  <div id="legs">${LAYERS.map(([k, n, c]) => `<div class="lg" id="lg-${k}" style="border-color:${c}"><b>${n}</b><div class="lbody"></div><div class="lcap"></div></div>`).join('')}</div></div>`);

// ---------- season outlook: the learned model's estimate for this place (kept apart from the measured NASA layers) ----------
q('#gal').insertAdjacentHTML('beforeend', `<div id="ol"><div class="olh"><b>Season outlook</b><span class="olb">Model estimate</span><span class="olq" id="olp">Pick a farm</span><button type="button" class="oli" id="oli" aria-label="About this estimate">i</button>
  <select id="olcrop" aria-label="Crop"><option value="maize">Maize</option><option value="wheat">Wheat</option><option value="soybean">Soybean</option><option value="barley">Barley</option><option value="rice">Rice</option><option value="potato">Potato</option><option value="sorghum">Sorghum</option><option value="rapeseed">Canola / rapeseed</option></select></div>
  <div class="oltrack"><i class="olz"></i><i class="olr" id="olr"></i><i class="olm" id="olm"></i></div><div class="olt"><span>30% below normal</span><span>normal</span><span>30% above</span></div><div class="olx" id="olx">Pick a farm to see the outlook.</div><div class="olinfo" id="olinfo" hidden></div></div>`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let olSite = null, olTok = 0;
async function showOutlook() {
  if (!olSite) return; const crop = q('#olcrop').value, my = ++olTok;
  q('#olx').textContent = 'Estimating from this place\'s NASA weather...'; q('#olp').textContent = 'working';
  try {
    const r = await fetchJSON(`/api/outlook?lat=${olSite.lat}&lon=${olSite.lon}&crop=${crop}`, 120000); if (my !== olTok) return;
    const p = x => (Math.max(-30, Math.min(30, x)) + 30) / 60 * 100, sg = x => (x > 0 ? '+' : '') + Math.round(x), v = r.estimate;
    q('#olr').style.left = p(r.low) + '%'; q('#olr').style.width = (p(r.high) - p(r.low)) + '%'; q('#olm').style.left = p(v) + '%';
    q('#olp').textContent = `${r.year} season`;
    q('#olx').innerHTML = `<b>${sg(v)}% vs normal</b> <i>(likely ${sg(r.low)}% to ${sg(r.high)}%)</i>. ${v < -5 ? 'Below normal' : v > 5 ? 'Above normal' : 'Near normal'}. Main driver: ${esc(r.driver)}.`;
    const t = r.tested;
    q('#olinfo').innerHTML = `A learned model, trained on ${t.rows} country-seasons (${t.countries} countries; 8 crops; FAOSTAT national yields and NASA POWER weather). On years it never saw, its average error was ${t.error_model} points against ${t.error_no_change} for "no change", and it caught about ${Math.round(100 * t.bad_years_caught)}% of bad years (yield 8% or more below trend). Its range holds about ${Math.round(100 * t.range_coverage)}% of the time. It is a <b>regional</b> estimate for a season that has already happened (the weather so far), not a forecast for this farm. The ${MONTHS[r.assumed_months[0] - 1]} to ${MONTHS[r.assumed_months[1] - 1]} season is assumed from latitude.`;
  } catch (e) { if (my === olTok) { q('#olp').textContent = 'unavailable'; q('#olx').textContent = `Outlook unavailable (${e.message}).`; } }
}
q('#olcrop').addEventListener('change', showOutlook);
q('#oli').addEventListener('click', () => { const i = q('#olinfo'); i.hidden = !i.hidden; });


// ---------- best crops here: the simulator's suitability (NASA weather + SoilGrids soil) next to FAOSTAT world prices ----------
q('#gal').insertAdjacentHTML('beforeend', `<div id="bc"><div class="olh"><b>Crops that suit this place</b><span class="olb">Simulated + FAOSTAT</span><button type="button" class="oli" id="bci" aria-label="About this list">i</button></div>
  <div class="olx" id="bcx">Pick a farm to see which crops suit it.</div><div id="bch2"></div><div id="bcl"></div><div class="olinfo" id="bcinfo" hidden>Suitability comes from the simulator (water balance, heat, frost and sowing window using this place's NASA POWER weather for 2006 onwards and its SoilGrids soil): the share of the crop's potential yield it reaches in an average year, and how often a year falls below half of that. Revenue = that share x a well-managed yield (75th percentile of national yields) x the world median producer price, all from FAOSTAT. It is <b>revenue, not profit</b>: there is no cost data, and potato costs several times more per hectare than cereals. Crops with no sowing window here are shown as not suited. The list covers the simulator's 9 crops. The \"grew here\" strip is Canada's Annual Crop Inventory (satellite-classified, so a field can be misread); outside Canada there is no open source wired in yet. The ranking itself does not use it and does not know what is sold nearby.</div></div>`);
q('#bci').addEventListener('click', () => { const i = q('#bcinfo'); i.hidden = !i.hidden; });
let econ = null, bcTok = 0;
async function showCrops(site) {
  const my = ++bcTok; q('#bcl').innerHTML = ''; q('#bch2').innerHTML = '';
  fetchJSON(`/api/history?lat=${site.lat}&lon=${site.lon}`, 90000).then(h => { if (my !== bcTok) return;
    q('#bch2').innerHTML = !h.covered ? '<div class="olx">What grew here before: no open crop map is wired in outside Canada yet.</div>' : '<div class="olx"><b>What grew here (AAFC satellite crop map)</b></div><div class="hist">' + h.years.map(y => `<span><em>${y.year}</em>${esc(y.crop || '?')}</span>`).join('') + '</div>'; }).catch(e => { if (my === bcTok) q('#bch2').innerHTML = `<div class="olx">What grew here: unavailable (${esc(e.message)}).</div>`; }); q('#bcx').textContent = 'Working out which crops suit this place (weather and soil)...';
  try {
    econ = econ || await fetchJSON('data/crop_economics.json', 20000);
    const [raw, soil, sl] = await Promise.all([fetchJSON(`/api/power?lat=${site.lat}&lon=${site.lon}`, 120000), fetchJSON(`/api/soil?lat=${site.lat}&lon=${site.lon}`, 60000).catch(() => null), fetchJSON(`/api/slope?lat=${site.lat}&lon=${site.lon}`, 30000).catch(() => null)]);
    if (my !== bcTok) return;
    const sp = soil ? soilFromLayers(soil.layers) : null, table = evalCrops(prepClimate(raw), { soil: 'loam', sp: sp || undefined, slope: sl ? Math.round(sl.slope) : 3, irrig: 0 });
    const rows = CROPS.filter(c => c.cash).map(c => { const t = table[c.id], e = econ[c.id], bad = t.noWindow ? 1 : t.rows.filter(r => r.rel < 0.5).length / t.rows.length;
      return { n: c.name, rel: t.noWindow ? 0 : t.meanRel, bad, rev: t.noWindow ? 0 : Math.round(e.price_usd_t * e.yield_t_ha * t.meanRel / 10) * 10, no: !!t.noWindow }; }).sort((a, b) => b.rev - a.rev || b.rel - a.rel);
    q('#bcx').innerHTML = `Rain-fed, ${sp ? 'measured soil (' + esc(sp.texture) + ')' : 'average loam soil (soil data unavailable)'}. Slope ${sl ? Math.round(sl.slope) + '%' : 'assumed 3%'}. Highest revenue first (not profit).`;
    q('#bcl').innerHTML = '<div class="bch"><span>Crop</span><span>Fit (share of potential yield)</span><span>Bad years</span><span>Revenue / ha</span></div>' + rows.map(r =>
      `<div class="bcr"><span>${esc(r.n)}</span><span class="bct"><i style="width:${Math.round(r.rel * 100)}%"></i><em>${r.no ? 'not suited' : Math.round(r.rel * 100) + '%'}</em></span><span>${r.no ? '-' : Math.round(r.bad * 100) + '%'}</span><span>${r.no ? '-' : '$' + r.rev.toLocaleString('en-US')}</span></div>`).join('');
  } catch (e) { if (my === bcTok) q('#bcx').textContent = `Crop list unavailable (${e.message}).`; }
}
document.head.insertAdjacentHTML('beforeend', '<style>#bc .hist{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 8px}#bc .hist span{font-size:11px;background:rgba(255,255,255,.08);border-radius:6px;padding:2px 6px}#bc .hist em{font-style:normal;color:var(--mut);margin-right:4px}#bc{margin-top:10px;border:1px dashed rgba(255,255,255,.3);border-radius:14px;padding:12px 14px}#bc .bch,#bc .bcr{display:grid;grid-template-columns:1.1fr 2fr .7fr 1fr;gap:8px;align-items:center;font-size:12px;padding:3px 0}#bc .bch{color:var(--mut);font-size:10.5px}#bc .bct{position:relative;height:16px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}#bc .bct i{position:absolute;left:0;top:0;bottom:0;background:#4f9e4a;opacity:.75}#bc .bct em{position:relative;font-style:normal;padding-left:6px;font-size:11px}</style>');

function onStatus(key, st) {
  const cap = q(`#lg-${key} .lcap`); if (!cap) return; cap.classList.toggle('no', !st.ok && !(st.empty && key === 'rain'));
  cap.textContent = st.empty ? (key === 'rain' ? 'no rain seen' : 'no clear reading (cloud)') : !st.ok ? 'no image this date' : st.used ? `image of ${st.used}` : 'static map';
}
async function loadLegends() { // NASA's own published colour scales
  for (const [k, , , unit] of LAYERS) {
    const body = q(`#lg-${k} .lbody`);
    try {
      const L = await fetchJSON(`/api/legend?key=${k}`, 30000);
      body.innerHTML = L.classes ? L.classes.map(c => `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:6px;font-size:9.5px;color:var(--mut)"><i style="width:10px;height:7px;border:1px solid rgba(255,255,255,.3);background:${c.rgb};display:inline-block"></i>${esc(c.label)}</span>`).join('') :
        `<div class="lb" style="background:linear-gradient(to right, ${L.stops.join(',')})" title="${esc(L.title)}: ${esc(L.units)}"></div><div class="lt"><span>${esc(L.ticks[0].label)}</span><span>${esc(L.ticks.at(-1).label)}</span></div><div class="lu">${esc(unit)}</div>`;
    } catch { body.innerHTML = ''; }
  }
}
function showLayers(site, name) {
  q('#galtitle').textContent = name;
  if (!stack) {
    stack = createStack(q('#stackview'), onStatus); loadLegends();
    const d = q('#galdate'); d.max = isoAgo(3); d.value = isoAgo(12); stack.setDate(d.value);
    fetchJSON('/api/layerdates', 60000).then(L => { if (L.common && L.common < d.value) { d.value = L.common; stack.setDate(d.value); } }).catch(() => {}); // start on a date every layer has
    shift = n => { const t = new Date(d.value + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); const iso = t.toISOString().slice(0, 10); if (iso >= d.min && iso <= d.max) { d.value = iso; stack.setDate(iso); } };
    d.addEventListener('change', () => { if (d.value) stack.setDate(d.value); });
    q('#galprev').addEventListener('click', () => shift(-7)); q('#galnext').addEventListener('click', () => shift(7));
    q('#galwin').addEventListener('change', () => stack.setWindowKm(+q('#galwin').value));
  }
  stack.setSite(site);
  olSite = { lat: +site.lat.toFixed(4), lon: +site.lon.toFixed(4) }; showOutlook(); showCrops(olSite);
}

// ---------- after the globe lands: pick a farm ----------
function choose(lat, lon, name, poly) { // hand over to the teammate's dashboard, then show the real layers
  const A = window.APP; A.S.loc = [lat, lon]; A.S.name = name; A.S.ex.clear(); A.S.pf.clear(); A.S.w = { water: 1, soil: 1, profit: 1 };
  A.metrics(); A.terrain(); A.reveal(); showLayers({ lat, lon, poly }, name);
}
const pickFarm = f => choose(f.lat, f.lon, `${f.name || 'Farm'}, ${fmtArea(f.ha)}`, f.poly);

function arrive(p) {
  document.body.className = 'pick'; q('#where').textContent = p[0]; q('#pwhere').textContent = p[0];
  if (!map) map = createMap(q('#pmap'), { onPick: (lat, lon) => choose(lat, lon, `Point ${lat.toFixed(4)}, ${lon.toFixed(4)}`, null), onFarm: pickFarm });
  map.invalidate(); map.clearFarms(); map.setMarker(p[1], p[2]); map.setView(p[1], p[2], 13); farms = [];
  const my = ++tok, box = q('#pfarms'); box.innerHTML = `<span class="hint">Searching OpenStreetMap for farmland near ${esc(p[0])} (this can take up to a minute)...</span>`;
  fetchJSON(`/api/farms?lat=${p[1].toFixed(4)}&lon=${p[2].toFixed(4)}`, 120000).then(r => {
    if (my !== tok) return; farms = r.farms; map.showFarms(farms);
    if (!farms.length) { box.innerHTML = '<span class="hint">No farmland outlines are mapped near here. Click the map to choose a point instead.</span>'; return; }
    map.fitFarms(farms.slice(0, 12));
    box.innerHTML = `<span class="ft">${farms.length} mapped farmland areas near ${esc(p[0])}. Pick one:</span>` + farms.slice(0, 14).map((f, i) =>
      `<button type="button" class="chip" data-i="${i}">${esc(f.name || (f.kind === 'orchard' ? 'Orchard' : f.kind === 'vineyard' ? 'Vineyard' : 'Farmland'))} &middot; ${fmtArea(f.ha)} &middot; ${f.d < 1000 ? f.d + ' m' : (f.d / 1000).toFixed(1) + ' km'} away</button>`).join('');
  }).catch(e => { if (my === tok) box.innerHTML = `<span class="hint">Farm search is unavailable (${esc(e.message)}). Click the map to choose a point instead.</span>`; });
}
q('#pfarms').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pickFarm(farms[+b.dataset.i]); });
q('#pback').addEventListener('click', () => window.APP.home());
addEventListener('resize', () => map?.invalidate());
window.GA = { arrive };
