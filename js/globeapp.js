// Merge into the globe app (app.html): after the globe lands on an address, pick a farm (real OpenStreetMap outlines),
// then show that farm's real NASA layers in 3D. The rest of the dashboard is the teammate's demo and is labelled simulated.
import { createMap } from './map.js';
import { createStack } from './stack3d.js';

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
