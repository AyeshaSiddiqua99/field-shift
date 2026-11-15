// Farm layers: the world -> type an address -> pick a farm -> see its NASA layers in 3D. Nothing else.
import { createMap } from './map.js';
import { createStack } from './stack3d.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
let mapApi = null, stack = null, farms = [], areaTok = 0;

async function fetchJSON(url, ms = 60000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'request failed'); return j; }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message); } finally { clearTimeout(t); }
}
function areaHa(pts) { const k = Math.cos(mean(pts.map(p => p[0])) * Math.PI / 180), q = pts.map(p => [p[1] * 111320 * k, p[0] * 110540]); let a = 0; for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2 / 1e4; }
const fmtArea = ha => `${ha < 10 ? ha.toFixed(1) : Math.round(ha)} ha (${Math.round(ha * 2.47105)} acres)`;
const isoAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// ----- step 2-3: type an address, see the farms near it -----
function goToArea(lat, lon, name) {
  const tk = ++areaTok;
  mapApi.clearFarms(); mapApi.setMarker(lat, lon); mapApi.setView(lat, lon, 13); farms = [];
  $('farmlist').innerHTML = `<span>Searching OpenStreetMap for farmland near ${esc(name)} (this can take up to a minute)...</span>`;
  fetchJSON(`/api/farms?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, 120000).then(r => {
    if (tk !== areaTok) return; farms = r.farms; mapApi.showFarms(farms);
    if (!farms.length) { $('farmlist').innerHTML = '<span>No farmland outlines are mapped near here. Click the map to choose a point instead.</span>'; return; }
    mapApi.fitFarms(farms.slice(0, 12));
    $('farmlist').innerHTML = `<span class="fl-title">${farms.length} mapped farmland areas near ${esc(name)}. Pick one:</span>` + farms.slice(0, 14).map((f, i) =>
      `<button type="button" data-i="${i}">${esc(f.name || (f.kind === 'orchard' ? 'Orchard' : f.kind === 'vineyard' ? 'Vineyard' : 'Farmland'))} &middot; ${fmtArea(f.ha)} &middot; ${f.d < 1000 ? f.d + ' m' : (f.d / 1000).toFixed(1) + ' km'} away</button>`).join('') +
      '<span class="note">Outlines come from OpenStreetMap volunteers. They show mapped farmland, not who owns it, and this is not a list of farms for sale.</span>';
  }).catch(e => { if (tk === areaTok) $('farmlist').innerHTML = `<span>Farm search is unavailable (${esc(e.message)}). Click the map to choose a point instead.</span>`; });
}

// ----- step 4: the layers for the chosen farm -----
function show(lat, lon, label, poly) {
  document.body.classList.add('has-farm'); $('picked').textContent = label;
  mapApi.setMarker(lat, lon, poly); stack.setSite({ lat, lon, poly });
}
const pickFarm = f => show(f.lat, f.lon, `${f.name || 'Farm'}, ${fmtArea(f.ha)}`, f.poly);

const LAYER_EL = { rain: 'c-rain', soil: 'c-soil', heat: 'c-heat', veg: 'c-veg', water: 'c-water' };
function onLayerStatus(key, st) {
  const el = $(LAYER_EL[key]); if (!el) return; const cap = el.querySelector('.cap'), orig = cap.dataset.orig || (cap.dataset.orig = cap.textContent);
  cap.classList.toggle('no', !st.ok && !(st.empty && key === 'rain'));
  cap.textContent = st.empty ? (key === 'rain' ? 'NASA IMERG saw no rain here on this date' : 'NASA has no clear reading here (cloud)') : !st.ok ? 'no NASA image for this date' : st.used ? `${orig} - image of ${st.used}` : orig;
}
async function loadLegends() { // NASA's own published colour scales
  for (const k of ['rain', 'soil', 'heat', 'veg', 'water']) {
    const el = $('leg-' + k);
    try {
      const L = await fetchJSON(`/api/legend?key=${k}`, 30000);
      el.innerHTML = L.classes ? L.classes.map(c => `<span class="lc"><i style="background:${c.rgb}"></i>${esc(c.label)}</span>`).join('') :
        `<div class="lbar" style="background:linear-gradient(to right, ${L.stops.join(',')})"></div><div class="lticks">${L.ticks.map(t => `<span style="left:${(t.p * 100).toFixed(0)}%">${esc(t.label)}</span>`).join('')}</div><div class="lunits">${esc(L.units)}. Clear = no data, or none.</div>`;
    } catch { el.innerHTML = ''; }
  }
}

function init() {
  mapApi = createMap($('map'), { onPick: (lat, lon) => show(lat, lon, `Point ${lat.toFixed(4)}, ${lon.toFixed(4)}`, null), onFarm: pickFarm });
  mapApi.setView(25, 10, 2); // step 1: the world
  stack = createStack($('stackview'), onLayerStatus); loadLegends();

  const d = $('date'); d.max = isoAgo(3); d.value = isoAgo(12); stack.setDate(d.value); // most recent days are often not published yet
  fetchJSON('/api/layerdates', 60000).then(L => { if (L.common && L.common < d.value) { d.value = L.common; stack.setDate(d.value); } }).catch(() => {}); // start on a date every layer has
  const shift = n => { const t = new Date(d.value + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); const iso = t.toISOString().slice(0, 10); if (iso >= d.min && iso <= d.max) { d.value = iso; stack.setDate(iso); } };
  d.addEventListener('change', () => { if (d.value) stack.setDate(d.value); });
  $('prev').addEventListener('click', () => shift(-7)); $('next').addEventListener('click', () => shift(7));
  $('winkm').addEventListener('change', () => stack.setWindowKm(+$('winkm').value));

  $('placeform').addEventListener('submit', async e => {
    e.preventDefault(); const q = $('place').value.trim(); if (q.length < 2) return; const el = $('placeresults'); el.innerHTML = '<span class="note">Searching...</span>';
    try { const r = await fetchJSON(`/api/geocode?q=${encodeURIComponent(q)}`, 30000); el._r = r.results; el.innerHTML = r.results.length ? r.results.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name.split(',').slice(0, 3).join(','))}</button>`).join('') : '<span class="note">No match. Try a nearby town.</span>'; }
    catch (er) { el.innerHTML = `<span class="note">Search unavailable (${esc(er.message)}).</span>`; }
  });
  $('placeresults').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; const p = $('placeresults')._r[+b.dataset.i]; $('placeresults').innerHTML = ''; goToArea(p.lat, p.lon, p.name.split(',').slice(0, 2).join(',')); });
  $('farmlist').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pickFarm(farms[+b.dataset.i]); });
  addEventListener('resize', () => mapApi.invalidate());
}
init();
