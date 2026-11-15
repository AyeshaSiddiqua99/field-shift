// CropAhead: one simple path for any farmer.  Find your farm -> pick your field -> eight plain answers.
// Real data only: NASA (GIBS, POWER), AAFC crop map, FAOSTAT, OMAFA, University of Guelph trials, Statistics Canada, OpenStreetMap.
import { createGlobe } from './globe3d.js';
import { createMap } from './map.js';
import { createStack } from './stack3d.js';
import { CROPS, CROP, DEFAULT_P, prepClimate, evalCrops, soilFromLayers, seasonSim, trace, waterNeed } from './engine.js';
import { createGrowSim } from './growsim.js';

const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = v => '$' + Math.round(v).toLocaleString('en-US');
const money2 = v => '$' + v.toFixed(2);
const isoAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
async function getJSON(url, ms = 60000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'request failed'); return j; }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'took too long' : e.message); } finally { clearTimeout(t); }
}
function countUp(el, to, fmt = v => Math.round(v), ms = 1400) {
  const t0 = performance.now();
  (function f(now) { const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(f); })(t0);
}

// ---------- crop words and pictures ----------
const EMOJI = { Corn: '🌽', Soybeans: '🫘', Wheat: '🌾', 'Winter wheat': '🌾', 'Spring wheat': '🌾', Barley: '🌾', Oats: '🌾', Rye: '🌾', Cereals: '🌾', Canola: '🌼', Potatoes: '🥔', Sunflower: '🌻',
  Beans: '🫘', Peas: '🫛', Chickpeas: '🫛', Sorghum: '🌾', Millet: '🌾', 'Pasture/forage': '🐄', Grassland: '🌿', 'Urban/developed': '🏘️', Forest: '🌳', Water: '💧', Fallow: '🟫', Vegetables: '🥕',
  Tomatoes: '🍅', Fruits: '🍎', Orchard: '🍎', Vineyard: '🍇', 'Sugar beets': '🥕', Wetland: '💧', Shrubland: '🌿', Hemp: '🌿', Tobacco: '🌿' };
const emo = c => EMOJI[c] || (/wheat/i.test(c || '') ? '🌾' : '🌱');
const TO_MODEL = { Corn: 'maize', Soybeans: 'soybean', Wheat: 'wheat', 'Winter wheat': 'wheat', 'Spring wheat': 'wheat', Barley: 'barley', Canola: 'rapeseed', Potatoes: 'potato', Sorghum: 'sorghum' };
const TO_ENGINE = { Corn: 'maize', Soybeans: 'soybean', Wheat: 'wheat', 'Winter wheat': 'wheat', 'Spring wheat': 'wheat', Potatoes: 'potato', Sunflower: 'sunflower', Chickpeas: 'chickpea', Sorghum: 'sorghum', Millet: 'millet' };
const MODEL_NAME = { maize: 'corn', wheat: 'wheat', soybean: 'soybeans', barley: 'barley', rice: 'rice', potato: 'potatoes', sorghum: 'sorghum', rapeseed: 'canola' };
const ENGINE_EMO = { maize: '🌽', wheat: '🌾', soybean: '🫘', sorghum: '🌾', millet: '🌾', groundnut: '🥜', chickpea: '🫛', potato: '🥔', sunflower: '🌻' };
const ENGINE_NAME = { maize: 'Corn', wheat: 'Wheat', soybean: 'Soybeans', sorghum: 'Sorghum', millet: 'Millet', groundnut: 'Peanuts (groundnut)', chickpea: 'Chickpeas', potato: 'Potatoes', sunflower: 'Sunflower' };
const FAO_ALIAS = { 'United States': 'United States of America', China: 'China, mainland', Russia: 'Russian Federation', 'United Kingdom': 'United Kingdom of Great Britain and Northern Ireland', Turkey: 'Türkiye',
  Iran: 'Iran (Islamic Republic of)', Tanzania: 'United Republic of Tanzania', Vietnam: 'Viet Nam', Bolivia: 'Bolivia (Plurinational State of)', Netherlands: 'Netherlands (Kingdom of the)', 'South Korea': 'Republic of Korea' };

const S = { name: '', lat: 0, lon: 0, country: '', ontario: false, site: null, hist: null, mainHist: null, econ: null, rot: null, countryCrops: null, tok: 0 };

// ---------- read to me ----------
let talking = false;
function speak(text) { if (!talking || !('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ' ')); u.rate = 0.92; speechSynthesis.speak(u); }
q('#talk').onclick = () => {
  talking = !talking; q('#talk').setAttribute('aria-pressed', talking);
  if (!talking) speechSynthesis?.cancel(); else speak(currentWords());
};
function currentWords() {
  const ch = q('.ch.show'); if (ch) return [...ch.querySelectorAll('h2, .say, .mood, .warn')].map(e => e.innerText).join('. ');
  const sc = q('.screen.show'); return sc ? [...sc.querySelectorAll('h1, h2, .lead')].map(e => e.innerText).join('. ') : '';
}

// ---------- screens ----------
const globe = createGlobe(q('#globe'));
function screen(id) {
  qa('.screen').forEach(s => s.classList.toggle('show', s.id === id));
  const n = { 's-home': 1, 's-pick': 2, 's-field': 3 }[id];
  [1, 2, 3].forEach(i => { const e = q('#st' + i); e.className = i === n ? 'on' : i < n ? 'done' : ''; });
  q('#globe').style.opacity = id === 's-home' ? '1' : id === 's-pick' ? '0.3' : '0.18'; q('#globe').style.transition = 'opacity 1.2s';
  globe.setOffset(id === 's-home' && innerWidth > 900 ? -1.0 : 0); globe.pause(false); scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => speak(currentWords()), 400);
}
q('#logo').onclick = () => { screen('s-home'); globe.reset(); };
globe.setOffset(innerWidth > 900 ? -1.0 : 0);

// ---------- 1. find the farm ----------
const EG = [['Ajax, Ontario, Canada', '📍'], ['Saskatoon, Canada', '📍'], ['Ames, Iowa, USA', '📍'], ['Ludhiana, Punjab, India', '📍'], ['Nakuru, Kenya', '📍']];
q('#eg').innerHTML = '<span style="color:var(--mut);align-self:center">Try:</span>' + EG.map(([n, f]) => `<button class="chip" type="button" data-q="${esc(n)}">${f} ${esc(n.split(',')[0])}</button>`).join('');
q('#eg').onclick = e => { const b = e.target.closest('button'); if (b) { q('#q').value = b.dataset.q; find(); } };
q('#find').onsubmit = e => { e.preventDefault(); find(); };
async function find() {
  const text = q('#q').value.trim(); if (text.length < 2) { q('#msg').textContent = 'Type the name of your town first.'; return; }
  q('#msg').textContent = 'Looking for it on the map...';
  let p = null; const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) p = { name: `${(+m[1]).toFixed(3)}, ${(+m[2]).toFixed(3)}`, lat: +m[1], lon: +m[2] };
  else { try { const r = await getJSON('/api/geocode?q=' + encodeURIComponent(text), 30000); p = r.results[0]; } catch (e) { q('#msg').textContent = `The map search is not answering (${e.message}). Try again.`; return; } }
  if (!p) { q('#msg').textContent = 'I could not find that place. Try the nearest town name.'; return; }
  const parts = p.name.split(',').map(s => s.trim());
  S.name = parts.slice(0, 2).join(', '); S.lat = p.lat; S.lon = p.lon; S.country = parts.at(-1) || '';
  S.ontario = /Ontario/.test(p.name) && /Canada/.test(p.name);
  q('#msg').textContent = `Flying to ${S.name}... 🚀`;
  document.body.classList.add('flying'); await globe.flyTo(p.lat, p.lon); document.body.classList.remove('flying'); q('#msg').textContent = ''; showPick();
}

// ---------- 2. pick the field ----------
let map = null, farms = [];
function showPick() {
  screen('s-pick');
  if (!map) map = createMap(q('#pmap'), { onPick: (lat, lon) => openField({ lat, lon, poly: null, ha: null, name: 'The spot you tapped' }), onFarm: f => openField(fieldOf(f)) });
  setTimeout(() => { map.invalidate(); map.clearFarms(); map.setMarker(S.lat, S.lon); map.setView(S.lat, S.lon, 13); }, 60);
  const my = ++S.tok; q('#pcards').innerHTML = ''; q('#pinfo').innerHTML = `<span class="wait" style="--c:var(--sun)">Looking for farm fields near ${esc(S.name)}...</span>`;
  getJSON(`/api/farms?lat=${S.lat.toFixed(4)}&lon=${S.lon.toFixed(4)}`, 120000).then(r => {
    if (my !== S.tok) return; farms = r.farms; map.showFarms(farms);
    if (!farms.length) { q('#pinfo').textContent = 'No field outlines are mapped here. Tap your field on the map instead.'; return; }
    map.invalidate(); map.fitFarms(farms.slice(0, 12)); setTimeout(() => { map.invalidate(); map.fitFarms(farms.slice(0, 12)); }, 700);
    q('#pinfo').textContent = 'Tap your field on the map, or choose one below.';
    q('#pcards').innerHTML = farms.slice(0, 12).map((f, i) => { const g = fieldOf(f); return `<button class="fcard" data-i="${i}"><span class="ic">${f.kind === 'orchard' ? '🍎' : f.kind === 'vineyard' ? '🍇' : '🌾'}</span><span><b>${esc(g.name)}</b><span>${f.d < 1000 ? f.d + ' m' : (f.d / 1000).toFixed(1) + ' km'} away</span></span></button>`; }).join('');
  }).catch(e => { if (my === S.tok) q('#pinfo').textContent = 'The field search is busy right now. Just tap your field on the map instead. 👆'; });
}
const fieldOf = f => ({ lat: f.lat, lon: f.lon, poly: f.poly, ha: f.ha, name: (f.name || (f.kind === 'orchard' ? 'Orchard' : f.kind === 'vineyard' ? 'Vineyard' : 'Farm field')) + `, ${Math.round(f.ha * 2.47105)} acres` });
q('#pcards').onclick = e => { const b = e.target.closest('[data-i]'); if (b) openField(fieldOf(farms[+b.dataset.i])); };
q('#other').onclick = () => showPick();

// ---------- 3. the answers ----------
const CH = [
  ['space', '🛰️', 'From space', 'What NASA sees', 'var(--sky)'],
  ['past', '📜', 'Past crops', 'What grew here', 'var(--sun)'],
  ['year', '🤖', 'AI forecast', 'Good or bad season?', 'var(--leaf)'],
  ['rotate', '🔄', 'Why rotate', 'Proof + money', 'var(--plum)'],
  ['crops', '🌱', 'Best crops', 'What fits here', 'var(--rose)'],
  ['water', '💧', 'Water & fire', 'Irrigation + fire risk', 'var(--sky)'],
  ['grow', '🎬', 'Grow it', 'Watch it grow', 'var(--leaf)'],
  ['sell', '🏪', 'Where to sell', 'Places + prices', 'var(--teal)'],
];
q('#nav').innerHTML = CH.map(([k, e, t, s, c], i) => `<button type="button" data-k="${k}" style="--c:${c}"><span class="n">${e}</span><b>${i + 1}. ${t}</b><small>${s}</small></button>`).join('');
q('#chapters').innerHTML = CH.map(([k, , , , c], i) => `<article class="ch" id="ch-${k}" style="--c:${c}"><div class="card pane"><div class="body"></div><div class="foot">
  ${i ? `<button class="big alt" data-go="${CH[i - 1][0]}">◀ Back</button>` : '<span></span>'}${i < CH.length - 1 ? `<button class="big" data-go="${CH[i + 1][0]}">Next: ${CH[i + 1][2]} ▶</button>` : '<button class="big" data-other="1">Check another field ▶</button>'}</div></div></article>`).join('');
q('#nav').onclick = e => { const b = e.target.closest('[data-k]'); if (b) chapter(b.dataset.k); };
q('#chapters').onclick = e => { const b = e.target.closest('[data-go]'); if (b) chapter(b.dataset.go); if (e.target.closest('[data-other]')) showPick(); };
const body = k => q(`#ch-${k} .body`);
const onShow = {};
function chapter(k) {
  qa('.ch').forEach(c => c.classList.toggle('show', c.id === 'ch-' + k)); qa('#nav button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  (innerWidth < 980 ? q('#ch-' + k) : q('#nav')).scrollIntoView({ behavior: 'smooth', block: 'start' }); { const nb = q(`#nav [data-k="${k}"]`); q('#nav').scrollTo({ left: nb.offsetLeft - 16, behavior: 'smooth' }); } onShow[k]?.(); setTimeout(() => speak(currentWords()), 350);
}

async function openField(site) {
  S.site = site; const my = ++S.tok; screen('s-field'); S.fut = null; S.cropMode = 'now'; S.sim = null; S.lastPick = null;
  q('#next').innerHTML = '<div class="wait" style="--c:var(--leaf)">Working out what to plant next season...</div>';
  q('#ftitle').textContent = site.name; q('#fwhere').textContent = `near ${S.name}`;
  for (const [k] of CH) body(k).innerHTML = `<div class="wait">Getting the facts...</div>`;
  showHero(site); chapter('space'); renderSpace(site);
  [S.econ, S.rot, S.countryCrops] = await Promise.all([S.econ || getJSON('data/crop_economics.json'), S.rot || getJSON('data/rotation.json'), S.countryCrops || getJSON('data/country_crops.json')]);
  if (my !== S.tok) return;
  const L = `lat=${site.lat.toFixed(4)}&lon=${site.lon.toFixed(4)}`;
  const hist = getJSON(`/api/history?${L}`, 90000).catch(() => null);
  hist.then(h => { if (my === S.tok) { S.hist = h; renderPast(h); renderRotate(); } });
  hist.then(h => { if (my === S.tok) renderYear(L, h); });
  const power = getJSON(`/api/power?${L}`, 120000), soil = getJSON(`/api/soil?${L}`, 60000).catch(() => null), slope = getJSON(`/api/slope?${L}`, 30000).catch(() => null);
  Promise.all([power, soil, slope, hist]).then(([p, s, sl, h]) => {
    if (my !== S.tok) return;
    const sp = s ? soilFromLayers(s.layers) : null, farm = { soil: 'loam', sp: sp || undefined, slope: sl ? Math.round(sl.slope) : 3, irrig: 0 };
    const c = prepClimate(p), table = evalCrops(c, farm);
    S.sim = { c, table, farm, sp, raw: p };
    renderCrops(table, sp, h); renderGrow(); renderNeed(); renderNext();
  }).catch(e => { if (my === S.tok) for (const k of ['crops', 'grow']) body(k).innerHTML = `<p class="say">Could not get the weather for this field (${esc(e.message)}).</p>`; });
  renderRotate(); renderWater(L, my); renderSell(L, my);
}

// ----- chapter 1: from space -----
let stack = null; const stackBox = document.createElement('div'); stackBox.style.cssText = 'position:absolute;inset:0';
const LAYERS = [['base', '📷', 'Photo from above', 'A satellite photo of the area. Your field has an orange outline.'],
  ['rain', '🌧️', 'Rain', 'How hard it was raining (NASA GPM satellites).'],
  ['soil', '💧', 'Water in the soil', 'How much water is in the ground where roots are (NASA MERRA-2).'],
  ['heat', '🌡️', 'Ground heat', 'How hot the ground was in the day (NASA MODIS).'],
  ['veg', '🌿', 'Plant health', 'Green = healthy, growing plants. Brown = bare or dry (NASA MODIS).'],
  ['water', '🏞️', 'Rivers and lakes', 'Where open water is.']];
function renderSpace(site) {
  body('space').innerHTML = `<span class="tag">Real NASA pictures</span><h2>Your field, seen from space</h2>
    <p class="say">Each layer is a <b>real NASA satellite picture</b> of your area, stacked like pancakes. <b>Drag</b> to turn it, <b>scroll</b> to zoom.</p>
    <div class="grid2"><div id="stack"><span class="hint">✋ Drag to turn · scroll to zoom</span></div>
    <div><div id="lays">${LAYERS.map(([k, e, t, d]) => `<div class="lay" id="ly-${k}"><span class="e">${e}</span><b>${t}</b><p>${d}</p><p class="val"></p><div class="lg"></div><p class="cap"></p></div>`).join('')}</div>
    <div class="datebar"><button class="chip" id="dprev">◀ 1 week</button><b id="dlab"></b><button class="chip" id="dnext">1 week ▶</button></div></div></div>
    <details class="how"><summary>How do we know?</summary>Pictures come straight from NASA's GIBS service (GPM IMERG rain, MERRA-2 root-zone soil water, MODIS land temperature and NDVI plant health). Colours use NASA's own published colour scales. The photo is Esri World Imagery.</details>`;
  q('#stack').prepend(stackBox);
  if (!stack) stack = createStack(stackBox, (key, st) => {
    const c = q(`#ly-${key} .cap`); if (c) c.textContent = st.empty ? (key === 'rain' ? 'No rain that week' : 'Clouds hid the ground that week') : !st.ok ? 'No picture for this date' : st.used ? `Picture from ${st.used}` : '';
    READ[key] = st; showReading(key);
  });
  let d = isoAgo(12); const setD = v => { d = v; stack.setDate(d); q('#dlab').textContent = new Date(d + 'T00:00:00Z').toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  setD(d); stack.setSite(site);
  const shift = n => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); const v = t.toISOString().slice(0, 10); if (v <= isoAgo(3)) setD(v); };
  q('#dprev').onclick = () => shift(-7); q('#dnext').onclick = () => shift(7);
  for (const [k] of LAYERS) READ[k] && showReading(k);
  for (const [k] of LAYERS.slice(1)) (LEG[k] ? Promise.resolve(LEG[k]) : getJSON(`/api/legend?key=${k}`, 30000)).then(L => {
    LEG[k] = L;
    q(`#ly-${k} .lg`).innerHTML = L.classes ? `<div style="display:flex;gap:10px;font-size:13px;color:var(--mut)">${L.classes.map(c => `<span><i style="display:inline-block;width:12px;height:10px;background:${c.rgb};border-radius:2px"></i> ${esc(c.label)}</span>`).join('')}</div>`
      : `<div class="bar" style="background:linear-gradient(90deg,${L.stops.join(',')})"></div><div class="ends"><span>${esc(L.ticks[0].label)}</span><span>${esc(UNIT[k])}</span><span>${esc(L.ticks.at(-1).label)}</span></div>`;
    showReading(k);
  }).catch(() => {});
}

// the actual number at your field: read the colour at the centre of each NASA picture and look it up in NASA's colour scale
const READ = {}, LEG = {}, UNIT = { rain: 'mm per hour', soil: 'water per soil volume', heat: '°C', veg: 'plant greenness (0 to 1)', water: '' };
const WORD = {
  rain: v => v < 0.1 ? 'no rain' : v < 1 ? 'light rain' : v < 5 ? 'steady rain' : 'heavy rain',
  soil: v => v < 0.15 ? 'dry 🏜️' : v < 0.25 ? 'a bit dry' : v < 0.35 ? 'moist 👍' : 'wet 💦',
  heat: v => v < 5 ? 'cold ❄️' : v < 18 ? 'cool' : v < 30 ? 'warm' : v < 40 ? 'hot 🔥' : 'very hot 🔥',
  veg: v => v < 0.2 ? 'bare ground' : v < 0.4 ? 'thin plants' : v < 0.6 ? 'growing well' : 'lush and green 🌿',
};
function showReading(k) {
  const el = q(`#ly-${k} .val`), st = READ[k]; if (!el || !st) return;
  if (k === 'base') { el.textContent = ''; return; }
  if (st.empty) { el.innerHTML = k === 'rain' ? 'At your field: <b>no rain</b> when the satellite looked' : 'At your field: <b>hidden by clouds</b> that week'; return; }
  if (!st.ok || !st.canvas) { el.textContent = ''; return; }
  const px = st.canvas.getContext('2d').getImageData(250, 250, 12, 12).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  if (!n) { el.innerHTML = k === 'rain' ? 'At your field: <b>no rain</b> when the satellite looked' : k === 'water' ? 'At your field: <b>land</b>' : 'At your field: <b>no reading</b> (cloud or gap)'; return; }
  r /= n; g /= n; b /= n; const L = LEG[k]; if (!L) return;
  if (L.classes) { const best = L.classes.map(c => { const m = c.rgb.match(/\d+/g).map(Number); return [(m[0] - r) ** 2 + (m[1] - g) ** 2 + (m[2] - b) ** 2, c.label]; }).sort((a, b2) => a[0] - b2[0])[0]; el.innerHTML = `At your field: <b>${esc(best[1])}</b>`; return; }
  if (!L.entries) return;
  let best = null; for (const e of L.entries) { const d = (e.rgb[0] - r) ** 2 + (e.rgb[1] - g) ** 2 + (e.rgb[2] - b) ** 2; if (!best || d < best.d) best = { d, e }; }
  if (best.d > 2500) { el.textContent = ''; return; }
  const lo = best.e.lo, hi = best.e.hi, v = hi == null || !isFinite(lo) ? (isFinite(lo) ? lo : hi) : (lo + hi) / 2;
  const f = k === 'heat' ? `${Math.round(v)} °C` : k === 'rain' ? `${v < 1 ? v.toFixed(1) : Math.round(v)} mm/hour` : v.toFixed(2);
  el.innerHTML = `At your field: <b>${f}</b> = <b style="color:var(--c)">${WORD[k](v)}</b>`;
}

// ----- chapter 2: past crops -----
function renderPast(h) {
  const b = body('past');
  if (!h || !h.covered) {
    S.mainHist = null;
    b.innerHTML = `<span class="tag">Crop history</span><h2>What grew on this field before?</h2><p class="say">Satellite crop maps are open to everyone in <b>Canada</b>, so we can only show crop history there for now.</p>
      <div class="warn">Outside Canada, you know best: think about which crops you planted the last few years. If it was the <b>same crop every year</b>, step 4 shows why switching helps.</div>`;
    return;
  }
  const ys = h.years.filter(y => y.crop), cnt = {}; ys.forEach(y => cnt[y.crop] = (cnt[y.crop] || 0) + 1);
  const [top, n] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || ['?', 0]; S.mainHist = top;
  const same = n >= Math.ceil(ys.length * 0.7) && TO_ENGINE[top];
  b.innerHTML = `<span class="tag">Real satellite crop map</span><h2>What grew on this field</h2>
    <p class="say"><b>${emo(top)} ${esc(top)}</b> grew here <b>${n} of the last ${ys.length} years</b>.</p>
    <div class="tl">${h.years.map((y, i) => `<div class="yr" style="animation-delay:${i * 0.09}s"><small>${y.year}</small><span class="e">${emo(y.crop)}</span><b>${esc(y.crop || '?')}</b></div>`).join('')}</div>
    ${same ? `<div class="warn">⚠️ Growing the <b>same crop again and again</b> tires the soil and lets pests and disease build up. In Ontario, corn after corn gives about <b>8.5% less corn</b> (Ontario Ministry of Agriculture). <a href="#" data-go2="rotate">See step 4 →</a></div>`
      : `<div class="warn" style="border-color:var(--leaf);background:rgba(94,224,138,.08)">✅ This field already changes crops. That is good for the soil. Step 4 shows how much it pays.</div>`}
    <details class="how"><summary>How do we know?</summary>${esc(h.source)}. Agriculture and Agri-Food Canada classifies every 30 m square of farmland from satellite pictures each year. It can sometimes mistake one crop for another.</details>`;
  b.querySelector('[data-go2]')?.addEventListener('click', e => { e.preventDefault(); chapter('rotate'); });
}

// ----- chapter 3: this year -----
async function renderYear(L, h) {
  const b = body('year'), crops = ['maize', 'soybean', 'wheat', 'barley', 'rapeseed', 'potato', 'sorghum', 'rice'];
  let crop = TO_MODEL[S.mainHist] || 'maize';
  const draw = async () => {
    b.innerHTML = `<span class="tag">Our AI, using NASA weather</span><h2>Was this a good season around here?</h2><div class="wait">The AI is reading 20 years of NASA weather for your area...</div>`;
    let r; try { r = await getJSON(`/api/outlook?${L}&crop=${crop}`, 120000); } catch (e) { b.innerHTML += `<p class="say">The AI could not answer right now (${esc(e.message)}).</p>`; return; }
    const v = r.estimate, mood = v > 5 ? ['A good year', '😀', 'var(--leaf)'] : v < -5 ? ['A tough year', '😟', 'var(--bad)'] : ['A normal year', '🙂', 'var(--sun)'];
    const nm = MODEL_NAME[crop], ang = Math.max(-90, Math.min(90, v / 30 * 90));
    const why = /no single/.test(r.driver) ? 'The weather was close to normal. Nothing unusual stood out.' : 'The biggest reason: ' + r.driver.replace(/, which (raises|lowers) the estimate by about (\d+) points?/, (m, w, n) => ` (this ${w === 'raises' ? 'helps' : 'hurts'} by about ${n}%)`) + '.';
    b.innerHTML = `<span class="tag">Our AI, using NASA weather</span><h2>Was ${r.year} a good season for ${nm} around here?</h2>
      <div class="grid2"><div>
        <div class="mood" style="color:${mood[2]}">${mood[1]} ${mood[0]} for ${nm}</div>
        <p class="say">Our AI compared this season's NASA weather with the last 20 years. It expects ${nm} harvests around here to be about <b>${Math.abs(Math.round(v))}% ${v >= 0 ? 'above' : 'below'} usual</b>.</p>
        <p class="say" style="font-size:19px">${esc(why)}</p>
        <div class="warn" style="font-size:16px">🤔 <b>How sure is it?</b> It could be anywhere from ${Math.round(r.low)}% to +${Math.round(r.high)}%. It is for your <b>whole area</b>, not just your field. It beats guessing, but not by much, so use it as a hint, not a promise.</div>
        <p style="margin:14px 0 6px;color:var(--mut)">Check another crop:</p><div class="chips" id="ycrops">${crops.map(c => `<button class="chip ${c === crop ? 'on' : ''}" data-c="${c}">${MODEL_NAME[c]}</button>`).join('')}</div>
      </div>
      <svg class="gauge" viewBox="0 -34 400 274" role="img" aria-label="${mood[0]}">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".5" stop-color="#ffc94a"/><stop offset="1" stop-color="#5ee08a"/></linearGradient></defs>
        <path d="M40 200 A160 160 0 0 1 360 200" fill="none" stroke="url(#gg)" stroke-width="34" stroke-linecap="round"/>
        <text x="30" y="236" fill="#b3c0dd" font-size="18" font-weight="800">Bad</text><text x="200" y="-10" fill="#b3c0dd" font-size="18" font-weight="800" text-anchor="middle">Normal</text><text x="370" y="236" fill="#b3c0dd" font-size="18" font-weight="800" text-anchor="end">Good</text>
        <g class="needle" style="transform:rotate(-90deg)"><line x1="200" y1="200" x2="200" y2="62" stroke="#fff" stroke-width="8" stroke-linecap="round"/></g>
        <circle cx="200" cy="200" r="16" fill="#fff"/>
      </svg></div>
      <details class="how"><summary>How does the AI work?</summary>It is a machine-learning model (gradient-boosted trees) trained on ${r.tested.rows.toLocaleString()} past harvests in ${r.tested.countries} countries (UN FAO yields) matched with NASA POWER weather. Tested on years it never saw, its average miss was ${r.tested.error_model} points, against ${r.tested.error_no_change} for simply guessing "normal". It warned about ${Math.round(r.tested.bad_years_caught * 100)}% of the bad years. The growing season (${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][r.assumed_months[0] - 1]} to ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][r.assumed_months[1] - 1]}) is a guess from your latitude.</details>`;
    requestAnimationFrame(() => setTimeout(() => { const n = b.querySelector('.needle'); if (n) n.style.transform = `rotate(${ang}deg)`; }, 120));
    b.querySelector('#ycrops').onclick = e => { const c = e.target.closest('[data-c]'); if (c) { crop = c.dataset.c; draw(); } };
  };
  draw();
}

// ----- chapter 4: why rotate -----
let wheelTimer = null;
function renderRotate() {
  const R = S.rot, b = body('rotate'); if (!R) return;
  const e = R.elora, rows = Object.entries(e.corn_bu_ac), mx = Math.max(...rows.map(r => r[1])), cols = ['#ff6b6b', '#ffc94a', '#5ee08a'];
  const nets = Object.entries(e.net_ac), acres = S.site?.ha ? S.site.ha * 2.47105 : null;
  const gain = e.net_ac['Corn, corn, soybean, wheat'] - e.net_ac['Corn every year'];
  const p = R.prices, cornBu = p.cad_t.Corn / p.bu_per_t.Corn, lossBu = R.omafa.corn_budget_yield_bu_ac * R.omafa.corn_after_corn_loss_pct / 100, lossCad = lossBu * cornBu;
  const nSave = R.omafa.n_credit_after_soy_kg_ha / 2.47105 * R.omafa.n_cost_per_kg;
  const isCornCorn = S.mainHist === 'Corn';
  b.innerHTML = `<span class="tag">Proof from 40+ years of field trials</span><h2>Why switching crops pays</h2>
    <p class="say">Planting a <b>different crop each year</b> (for example corn, then soybeans, then wheat) breaks pest cycles, feeds the soil, and gives <b>bigger harvests</b>. This is not a guess: farm scientists in Ontario have tested it since 1982.</p>
    <div class="wheel" id="wheel"><span class="st" data-i="0">🌽 Year 1: Corn</span><span class="ar">→</span><span class="st" data-i="1">🫘 Year 2: Soybeans</span><span class="ar">→</span><span class="st" data-i="2">🌾 Year 3: Wheat</span><span class="ar">↺</span></div>
    <div class="facts">
      <div class="fact"><div class="big-num" data-n="${Math.round((e.corn_bu_ac['Corn, corn, soybean, wheat'] / e.corn_bu_ac['Corn every year'] - 1) * 100)}" data-s="%" data-p="+">0</div><p>more corn when corn is part of a rotation with soybeans and wheat, compared with corn every year.</p><small>University of Guelph trial, Elora, Ontario, ${e.period}</small></div>
      <div class="fact"><div class="big-num" data-n="${R.bowles.drought_loss_cut_pct[1]}" data-s="%" data-p="up to ">0</div><p>smaller corn losses in drought years on farms that rotate crops.</p><small>Bowles et al. 2020: 11 long-term trials across North America</small></div>
      <div class="fact"><div class="big-num" data-n="${R.omafa.corn_after_corn_loss_pct}" data-s="%" data-p="−" data-d="1">0</div><p>less corn when you plant corn after corn, says Ontario's 2026 farm budget guide.</p><small>Ontario Ministry of Agriculture (OMAFA), Publication 60, 2026</small></div>
    </div>
    <h3 style="font:800 22px Fraunces,Georgia,serif;margin:24px 0 4px">Corn harvest, bushels per acre (Elora trial, ${e.period})</h3>
    <div class="vs">${rows.map(([k, v], i) => `<div class="row"><span>${esc(k)}</span><div class="tr"><i data-w="${v / mx * 100}" style="background:${cols[i]}"></i></div><b>${v}</b></div>`).join('')}</div>
    <h3 style="font:800 22px Fraunces,Georgia,serif;margin:18px 0 4px">Money left over, per acre per year</h3>
    <div class="vs">${nets.map(([k, v], i) => `<div class="row"><span>${esc(k)}</span><div class="tr"><i data-w="${v / 190 * 100}" style="background:${cols[i]}"></i></div><b>$${v}</b></div>`).join('')}</div>
    ${S.ontario ? `<div class="money"><span class="tag" style="--c:var(--leaf)">For your field</span>
      <p class="say" style="margin:8px 0">${isCornCorn ? 'Your field has grown corn most years. ' : ''}In the Elora trial, a <b>corn, corn, soybeans, wheat</b> rotation left <b>$${gain} more per acre each year</b> than corn every year.</p>
      ${acres ? `<div class="big-num" id="mtot">$0</div><p style="margin:0;font-size:19px">more per year for your <b>${Math.round(acres)} acres</b>, if your field gains as much as the trial did.</p>` : ''}
      <ul style="font-size:18px;margin:14px 0 0;padding-left:22px">
        <li>Each year corn follows corn, you lose about <b>${Math.round(lossBu)} bushels an acre</b>: about <b>${money(lossCad)} an acre</b> at today's Ontario corn price (${money2(cornBu)}/bushel, ${esc(p.month)}).</li>
        <li>Corn after soybeans needs less nitrogen fertilizer: about <b>${money(nSave)} an acre saved</b>.</li></ul></div>`
      : `<div class="money"><span class="tag" style="--c:var(--leaf)">For your field</span><p class="say" style="margin:8px 0">The dollar amounts above come from Ontario, Canada. We do not have farm cost data for your area yet, so we do not guess a dollar figure for your field. The yield proof comes from trials across North America.</p></div>`}
    <details class="how"><summary>Where do these numbers come from?</summary><ul>
      <li><a href="${e.url}" target="_blank" rel="noopener">${esc(e.title)}</a> (${esc(e.paper)}). Net returns are the trial's own figures (2002-2017 prices, Canadian dollars), so treat the dollar total as a rough guide.</li>
      <li><a href="${R.ridgetown.url}" target="_blank" rel="noopener">${esc(R.ridgetown.title)}</a>: corn ${R.ridgetown.corn_bu_ac['Corn every year']} bu/ac every year vs ${R.ridgetown.corn_bu_ac['Corn, soybean, wheat + red clover']} with soybeans, wheat and red clover. Best: ${esc(R.ridgetown.best_net)}.</li>
      <li><a href="${R.bowles.url}" target="_blank" rel="noopener">${esc(R.bowles.title)}</a>: corn yields ${R.bowles.corn_gain_pct}% higher on average in the most varied rotations; drought losses cut by ${R.bowles.drought_loss_cut_pct[0]}% to ${R.bowles.drought_loss_cut_pct[1]}%.</li>
      <li><a href="${R.gaudin.url}" target="_blank" rel="noopener">${esc(R.gaudin.title)}</a>: in hot, dry years, varied rotations gave ${R.gaudin.hot_dry_corn_pct}% more corn and ${R.gaudin.hot_dry_soy_pct}% more soybeans.</li>
      <li><a href="${R.omafa.url}" target="_blank" rel="noopener">${esc(R.omafa.title)}</a>: corn after corn ${R.omafa.corn_after_corn_loss_pct}% less yield; budget yield ${R.omafa.corn_budget_yield_bu_ac} bu/ac; nitrogen credit after soybeans ${R.omafa.n_credit_after_soy_kg_ha} kg/ha at $${R.omafa.n_cost_per_kg}/kg.</li>
      <li><a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a>, ${esc(p.month)}: corn $${p.cad_t.Corn}/tonne.</li>
      <li>"For your field" assumes your field gains what the trial gained. Real farms differ: soil, weather and how you farm all matter.</li></ul></details>`;
  onShow.rotate = () => {
    setTimeout(() => {
      b.querySelectorAll('.vs i').forEach(i => i.style.width = i.dataset.w + '%');
      b.querySelectorAll('.big-num[data-n]').forEach(el => countUp(el, +el.dataset.n, v => (el.dataset.p || '') + (el.dataset.d ? v.toFixed(1) : Math.round(v)) + el.dataset.s));
      const t = b.querySelector('#mtot'); if (t && acres) countUp(t, gain * acres, v => money(v), 1800);
    }, 150);
    clearInterval(wheelTimer); let i = 0; const st = [...b.querySelectorAll('#wheel .st')];
    const tick = () => { st.forEach((s, j) => s.classList.toggle('on', j === i % 3)); i++; }; tick(); wheelTimer = setInterval(tick, 1300);
  };
  if (q('#ch-rotate').classList.contains('show')) onShow.rotate();
}

// ----- chapter 5: best crops -----
// one crop's numbers from a table (or the average of several tables, one per climate model)
function cropStats(tables, id) {
  const ts = tables.map(t => t[id]).filter(t => !t.noWindow); if (!ts.length) return null;
  const fit = ts.reduce((s, t) => s + t.meanRel, 0) / ts.length, bad = ts.reduce((s, t) => s + t.rows.filter(r => r.rel < 0.5).length / t.rows.length, 0) / ts.length;
  return { fit, bad };
}
function renderCrops(table, sp, h) { S.cropArgs = { table, sp, h }; S.cropMode = S.cropMode || 'now'; drawCrops(); }
async function loadFuture() {
  if (S.fut) return S.fut;
  const L = `lat=${S.site.lat.toFixed(4)}&lon=${S.site.lon.toFixed(4)}`, my = S.tok;
  const f = await getJSON(`/api/future?${L}`, 240000); if (my !== S.tok) throw new Error('field changed');
  const raw = S.sim.raw, tables = f.models.map(m => evalCrops(prepClimate(raw, { dT: m.dT, dP: m.dP, ext: 0 }), S.sim.farm));
  S.fut = { ...f, tables }; return S.fut;
}
function drawCrops() {
  const { table, sp, h } = S.cropArgs, b = body('crops'), fut = S.cropMode === 'future' ? S.fut : null;
  const grown = new Set((h?.years || []).map(y => TO_ENGINE[y.crop]).filter(Boolean));
  const fao = S.countryCrops?.countries?.[FAO_ALIAS[S.country] || S.country];
  const rows = CROPS.filter(c => c.cash && !table[c.id].noWindow).map(c => {
    const now = cropStats([table], c.id), st = fut ? cropStats(fut.tables, c.id) || { fit: 0, bad: 1 } : now;
    return { id: c.id, fit: st.fit, bad: st.bad, rel: st.fit * (1 - st.bad), change: fut ? st.fit * (1 - st.bad) - now.fit * (1 - now.bad) : 0, here: grown.has(c.id), inCountry: !fao || fao.includes(c.id) };
  }).sort((a, b) => b.rel - a.rel);
  const good = r => r.fit >= 0.55 && r.bad <= 0.3 && r.inCountry;
  const proven = rows.filter(r => r.here), maybe = rows.filter(r => !r.here && good(r)), no = rows.filter(r => !r.here && !good(r));
  const card = r => { const blocks = Math.round(r.fit * 5);
    return `<div class="crop"><span class="e">${ENGINE_EMO[r.id]}</span><b>${ENGINE_NAME[r.id]}${r.here ? '<span class="badge ok">✓ Grown on this field</span>' : !r.inCountry ? '<span class="badge new">Rare in your country</span>' : h?.covered ? '<span class="badge new">New for this field</span>' : ''}</b>
      <span class="meter" title="How well it grows here">${[0, 1, 2, 3, 4].map(i => `<i class="${i < blocks ? 'f' : ''}"></i>`).join('')}</span>
      <span class="why">${Math.round(r.bad * 10) === 0 ? 'Bad harvests are <b>rare</b> here' : `Bad harvest about <b>${Math.round(r.bad * 10)} year${Math.round(r.bad * 10) === 1 ? '' : 's'} in 10</b>`}. Grows to about <b>${Math.round(r.fit * 100)}%</b> of its best here.${fut ? (r.change > 0.03 ? ' <b style="color:var(--leaf)">▲ Better in the 2050s</b>' : r.change < -0.03 ? ' <b style="color:var(--bad)">▼ Harder in the 2050s</b>' : ' <span style="color:var(--mut)">● About the same in the 2050s</span>') : ''}</span></div>`; };
  const ms = S.fut?.models || [], rng = (k, f) => { const v = ms.map(m => m[k]); return [Math.min(...v), Math.max(...v)].map(f); }, avg = k => ms.reduce((s, m) => s + m[k], 0) / (ms.length || 1);
  b.innerHTML = `<span class="tag">Simulated with NASA weather + your soil</span><h2>Which crops fit this field?</h2>
    <div class="chips" style="margin:6px 0 10px"><button class="chip ${fut ? '' : 'on'}" data-mode="now">🌤️ Today</button><button class="chip ${fut ? 'on' : ''}" data-mode="future">🔮 In the 2050s</button></div>
    ${fut ? `<p class="say">NASA's climate projections for your area in the <b>2050s</b> (3 climate models, middle-of-the-road scenario):</p>
      <div class="price"><div><span>🌡️ Summer days</span><b>+${avg('dT').toFixed(1)} °C</b><span>hotter (models: ${rng('dT', v => v.toFixed(1)).join(' to ')})</span></div>
      <div><span>🌧️ Rain</span><b>${avg('dP') >= 0 ? '+' : ''}${Math.round(avg('dP') * 100)}%</b><span>(models: ${rng('dP', v => Math.round(v * 100)).join(' to ')}%)</span></div>
      <div><span>🔥 Days above 30 °C</span><b>${Math.round(avg('hot_now'))} → ${Math.round(avg('hot_2050s'))}</b><span>a year</span></div></div>
      <p class="say" style="font-size:19px">Here is how each crop would do in that climate on your soil. ▲ = gets better, ▼ = gets harder.</p>`
    : `<p class="say">We tested each crop against <b>20 years of NASA weather</b> on <b>your soil</b> (${sp ? esc(sp.texture.toLowerCase()) : 'average soil'}). More green blocks = grows better here.</p>`}
    <p class="msg" id="futmsg"></p>
    ${proven.length ? `<div class="grp">✓ Crops this field already knows</div>${proven.map(card).join('')}` : ''}
    ${maybe.length ? `<div class="grp">${h?.covered ? '💡 Could also work: try a small piece first' : '🌱 Crops that grow well here'}</div>${maybe.map(card).join('')}` : ''}
    ${no.length ? `<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:800">Not a good fit here (${no.length})</summary>${no.map(card).join('')}</details>` : ''}
    <details class="how"><summary>How do we know?</summary>Our crop simulator runs each crop through every season since 2006 using NASA POWER weather and SoilGrids soil: water, heat, frost and the right planting time, without irrigation. "Bad harvest" = less than half of a normal crop. "Grows to X% of its best" = how close it gets to its harvest with no water or heat stress. Crops that your country hardly grows (UN FAO) are never suggested. The simulator does not know local markets or equipment, so talk to your local agronomist before changing.${fut ? ` <b>2050s:</b> ${esc(S.fut.source)}. For each model we take how much hotter and wetter ${S.fut.periods.future} is than ${S.fut.periods.now} at your spot, add that change to the real NASA POWER weather record, and grow every crop again. It shows what the 2050s are likely to be like on average, not the weather of a particular year. Planting dates and varieties may also change by then.` : ''}</details>`;
  b.querySelectorAll('[data-mode]').forEach(x => x.onclick = async () => {
    if (x.dataset.mode === 'now') { S.cropMode = 'now'; drawCrops(); return; }
    b.querySelector('#futmsg').innerHTML = '<span class="wait" style="--c:var(--rose)">Asking NASA for the 2050s climate at your field (up to a minute the first time)...</span>';
    try { await loadFuture(); S.cropMode = 'future'; drawCrops(); } catch (e) { b.querySelector('#futmsg').textContent = `NASA's climate server did not answer (${e.message}). Try again in a minute.`; }
  });
}

// ----- chapter 6: where to sell -----
let smap = null;
function renderSell(L, my) {
  const b = body('sell'), R = S.rot;
  const KIND = { grain: ['🏭', 'Grain buyers and mills', '#ffc94a'], food: ['🥫', 'Food and drink makers', '#ff7eb6'], market: ['🧺', "Farmers' markets", '#5ee08a'], farmshop: ['🏡', 'Farm shops', '#4cc3ff'] };
  b.innerHTML = `<span class="tag">Map of places near you</span><h2>Who could buy from you?</h2>
    <p class="say">These are <b>places to contact</b> within 50 km: grain buyers, food makers, farmers' markets and farm shops. They are not confirmed buyers, so call first.</p>
    ${S.ontario ? `<div class="price">${Object.entries(R.prices.cad_t).map(([k, v]) => `<div><span>${emo(k)} ${k}, Ontario</span><b>${money2(v / R.prices.bu_per_t[k])}</b><span>per bushel · ${money(v)}/tonne</span></div>`).join('')}</div>
      <p style="margin:-6px 0 14px;color:var(--mut);font-size:14px">Average price farmers got in Ontario, ${esc(R.prices.month)} (Statistics Canada).</p>` : ''}
    <div class="grid2"><div id="smap"></div><div id="splist"><div class="wait">Searching the map for places near you (up to a minute)...</div></div></div>
    <details class="how"><summary>How do we know?</summary>Places come from OpenStreetMap, a map that volunteers keep up to date, so some places are missing or closed. ${S.ontario ? 'Prices: Statistics Canada table 32-10-0077-01.' : ''}</details>`;
  if (smap) { smap.remove(); smap = null; } S.buyers = null;
  const plot = () => {
    if (!smap || !S.buyers) return; smap.__group.clearLayers();
    S.buyers.places.forEach(p => { const k = KIND[p.kind]; window.L.marker([p.lat, p.lon], { icon: window.L.divIcon({ className: '', html: `<div class="pin" style="background:${k[2]}"></div>` }) }).bindTooltip(`${k[0]} ${esc(p.name)}`).addTo(smap.__group); });
  };
  const init = () => {
    if (smap || !q('#smap')?.offsetWidth) return;
    smap = window.L.map(q('#smap')).setView([S.site.lat, S.site.lon], 9);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(smap);
    window.L.marker([S.site.lat, S.site.lon], { icon: window.L.divIcon({ className: '', html: '<div style="font-size:30px;transform:translate(-8px,-24px)">🚜</div>' }) }).addTo(smap).bindTooltip('Your field');
    smap.__group = window.L.layerGroup().addTo(smap); plot();
  };
  onShow.sell = () => setTimeout(() => { init(); smap?.invalidateSize(); }, 80);
  getJSON(`/api/buyers?${L}`, 120000).then(r => {
    if (my !== S.tok) return; S.buyers = r; plot();
    const groups = Object.keys(KIND).map(k => [k, r.places.filter(p => p.kind === k)]).filter(g => g[1].length);
    q('#splist').innerHTML = !r.places.length ? '<p class="say">No places are mapped near here yet. Ask your local farm co-op or agronomist.</p>'
      : groups.map(([k, ps]) => `<div class="grp">${KIND[k][0]} ${KIND[k][1]}</div>` + ps.slice(0, 8).map(p => `<div class="plc" data-lat="${p.lat}" data-lon="${p.lon}"><span class="e">${KIND[k][0]}</span><span><b>${esc(p.name)}</b><span>${p.km} km away${p.what ? ' · ' + esc(p.what.replace(/_/g, ' ')) : ''}</span></span></div>`).join('')).join('');
    q('#splist').onclick = e => { const c = e.target.closest('.plc'); if (c && smap) smap.flyTo([+c.dataset.lat, +c.dataset.lon], 14); };
  }).catch(e => { if (my === S.tok) q('#splist').innerHTML = `<p class="say">The place search is busy (${esc(e.message)}). Try again in a minute.</p>`; });
}

// ---------- satellite view of the chosen field (banner at the top of the answers) ----------
let hero = null;
function showHero(site) {
  const L = window.L;
  if (!hero) {
    hero = L.map(q('#fhero'), { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }).addTo(hero);
    hero.__g = L.layerGroup().addTo(hero);
  }
  hero.__g.clearLayers(); hero.invalidateSize();
  hero.setView([site.lat, site.lon], 12, { animate: false });
  let target;
  if (site.poly && site.poly.length > 2) { const pg = L.polygon(site.poly, { color: '#ffc94a', weight: 4, fillColor: '#ffc94a', fillOpacity: 0.12 }).addTo(hero.__g); target = pg.getBounds().pad(0.6); }
  else { L.circle([site.lat, site.lon], { radius: 120, color: '#ffc94a', weight: 4, fillOpacity: 0.1 }).addTo(hero.__g); target = L.latLng(site.lat, site.lon).toBounds(700); }
  setTimeout(() => { hero.invalidateSize(); hero.flyToBounds(target, { duration: 2.2, maxZoom: 17 }); }, 300);
}

// ---------- the one big answer: what to plant next season ----------
function renderNext() {
  const box = q('#next'); if (!S.sim) return;
  const t = S.sim.table, hy = (S.hist?.years || []).filter(y => y.crop);
  const lastRec = [...hy].reverse().find(y => TO_ENGINE[y.crop]);
  const last = S.lastPick || (lastRec ? TO_ENGINE[lastRec.crop] : null);
  const fao = S.countryCrops?.countries?.[FAO_ALIAS[S.country] || S.country];
  if (!last) {
    const opts = CROPS.filter(c => c.cash && !t[c.id].noWindow && (!fao || fao.includes(c.id))).map(c => c.id);
    box.innerHTML = `<div class="nx"><div class="nxe">🌱</div><div><span class="tag" style="--c:var(--leaf)">Next season</span><h3>What did you grow on this field last season?</h3>
      <p>Tap it, and we will tell you what to plant next.</p><div class="chips">${opts.map(id => `<button class="chip" data-last="${id}">${ENGINE_EMO[id]} ${ENGINE_NAME[id]}</button>`).join('')}</div></div></div>`;
    box.querySelectorAll('[data-last]').forEach(x => x.onclick = () => { S.lastPick = x.dataset.last; renderNext(); });
    return;
  }
  const next = rotationFor(last)[1] || rotationFor(last)[2];
  if (!next) { box.innerHTML = ''; return; }
  let run = 0; if (!S.lastPick) for (let i = hy.length - 1; i >= 0 && TO_ENGINE[hy[i].crop] === last; i--) run++;
  const st = cropStats([t], next), R = S.rot;
  const why = [];
  if (run >= 2) why.push(`${ENGINE_NAME[last]} grew here <b>${run} years in a row</b>. Switching breaks the pests and diseases that build up${last === 'maize' && S.ontario ? ` and avoids the ${R.omafa.corn_after_corn_loss_pct}% corn-after-corn loss` : ''}.`);
  else why.push(`After ${ENGINE_NAME[last].toLowerCase()}, changing crops keeps the soil healthy and pests down.`);
  if (CROP[next].family === 'legume') why.push(`${ENGINE_NAME[next]} make their own nitrogen, so you buy less fertilizer${S.ontario ? `, and the corn after them needs about ${money(R.omafa.n_credit_after_soy_kg_ha / 2.47105 * R.omafa.n_cost_per_kg)} an acre less` : ''}.`);
  box.innerHTML = `<div class="nx"><div class="nxe">${ENGINE_EMO[next]}</div><div><span class="tag" style="--c:var(--leaf)">Our suggestion for next season</span>
    <h3>Plant <b>${ENGINE_NAME[next]}</b>${S.lastPick ? '' : ` after ${lastRec.year}'s ${esc(lastRec.crop.toLowerCase())}`}</h3>
    <p>${why.join(' ')} Here it grows to about <b>${Math.round(st.fit * 100)}%</b> of its best, ${Math.round(st.bad * 10) ? `with a bad harvest about <b>${Math.round(st.bad * 10)} year${Math.round(st.bad * 10) === 1 ? '' : 's'} in 10</b>` : 'and bad harvests are <b>rare</b>'}.</p>
    <div class="chips"><button class="chip" data-jump="rotate">🔄 Why switch?</button><button class="chip" data-jump="grow">🎬 Watch it grow</button><button class="chip" data-jump="crops">🌱 Other crops</button>${S.lastPick ? '<button class="chip" data-reset="1">↺ Change last crop</button>' : ''}</div></div></div>`;
  box.querySelectorAll('[data-jump]').forEach(x => x.onclick = () => chapter(x.dataset.jump));
  box.querySelector('[data-reset]')?.addEventListener('click', () => { S.lastPick = null; renderNext(); });
}

// ---------- shared: which crop the field grows now, and the rotation we suggest ----------
function mainCrop() {
  const t = S.sim.table, fromHist = TO_ENGINE[S.mainHist];
  if (fromHist && !t[fromHist].noWindow) return fromHist;
  return ['maize', 'wheat', 'sorghum', 'millet', 'soybean'].filter(id => !t[id].noWindow).sort((a, b) => t[b].meanRel - t[a].meanRel)[0] || 'maize';
}
function rotationFor(main) {
  const t = S.sim.table, fao = S.countryCrops?.countries?.[FAO_ALIAS[S.country] || S.country];
  const ok = id => id !== main && !t[id].noWindow && t[id].meanRel >= 0.45 && (!fao || fao.includes(id));
  // the classic, field-tested order (corn -> soybeans -> wheat in Ontario); crops this field has grown before come first
  const grown = new Set((S.hist?.years || []).map(y => TO_ENGINE[y.crop]).filter(Boolean));
  const pick = list => [...list.filter(id => grown.has(id)), ...list.filter(id => !grown.has(id))].find(ok);
  const leg = CROP[main].family === 'legume' ? null : pick(['soybean', 'chickpea', 'groundnut']);
  const other = pick(['wheat', 'sorghum', 'millet', 'maize', 'sunflower', 'potato'].filter(id => id !== leg));
  return [main, leg, other].filter(Boolean);
}

// ---------- water & fire ----------
let wmap = null;
function renderNeed() {
  const el = q('#wneed'); if (!el || !S.sim) return;
  const id = mainCrop(), need = waterNeed(S.sim.c, S.sim.table, S.sim.farm, [id])[0], acres = S.site?.ha ? S.site.ha * 2.47105 : null;
  const L1 = need.p90 * 4046.86, peakDay = 5 * 4046.86 * (acres || 1);
  el.innerHTML = need.p90 < 5 ? `<p class="say">${ENGINE_EMO[id]} ${ENGINE_NAME[id]} here gets enough rain in almost every year. <b>Extra water is rarely needed.</b></p>`
    : `<p class="say">${ENGINE_EMO[id]} To keep ${ENGINE_NAME[id].toLowerCase()} here from <b>ever</b> going thirsty, you would add up to about <b>${Math.round(need.p90)} mm of water</b> in a dry year (1 in 10), about <b>${Math.round(need.mean)} mm</b> in a normal year. This is the most it could use${S.ontario ? ': most Ontario field crops grow on rain alone' : ''}.</p>
      <div class="price"><div><span>Per acre, dry year</span><b>${(L1 / 1e6).toFixed(1)} million L</b><span>for the whole season</span></div>
      ${acres ? `<div><span>Your ${Math.round(acres)} acres, dry year</span><b>${(L1 * acres / 1e6).toFixed(0)} million L</b><span>for the whole season</span></div><div><span>On a hot day, about</span><b>${peakDay >= 1e6 ? (peakDay / 1e6).toFixed(1) + ' million L' : Math.round(peakDay / 1000) + ' thousand L'}</b><span>per day (5 mm a day)</span></div>` : ''}</div>
      ${S.ontario ? `<div class="warn">📋 <b>Ontario rule:</b> taking <b>more than 50,000 litres a day</b> from a lake, river, pond or well needs a <a href="https://www.ontario.ca/page/permits-take-water" target="_blank" rel="noopener">Permit to Take Water</a> from the province, unless your use is exempt.${acres && peakDay > 50000 ? ` Watering this field on a hot day would need about <b>${Math.round(peakDay / 50000)} times</b> that amount, so <b>check before you pump</b>.` : ''}</div>`
      : `<div class="warn">📋 In most countries you need a <b>permit or licence</b> to pump from rivers and lakes or to drill a well. Ask your local water office before you dig or pump.</div>`}`;
}
function renderWater(L, my) {
  const b = body('water');
  b.innerHTML = `<span class="tag">Water for your crops + fire history</span><h2>Where could water come from? Is fire a risk?</h2>
    <div id="wneed"><div class="wait">Working out how much water your crop needs...</div></div>
    <div class="grid2" style="margin-top:14px"><div id="wmap" style="height:min(50vh,440px);border-radius:18px;overflow:hidden;border:1px solid var(--line)"></div>
    <div><div class="grp" style="margin-top:0">💧 Water near your field</div><div id="wlist"><div class="wait">Searching the map for lakes, rivers and ponds (can take a minute)...</div></div>
    <div class="grp">🔥 Fires seen from space nearby</div><div id="flist"><div class="wait">Checking 10+ years of NASA fire records...</div></div></div></div>
    <details class="how"><summary>How do we know?</summary>Water need: our simulator re-runs every season since 2006 with unlimited water and counts how much extra the crop would have used (NASA POWER weather, SoilGrids soil). Lakes, rivers and ponds: OpenStreetMap; a "reservoir" can be a town water tank, so check each place. Fires: NASA FIRMS, MODIS satellite fire hotspots (confidence 50% or more) within 30 km, from NASA's yearly archives. Some hotspots are farm or brush burning, not wildfires.</details>`;
  renderNeed();
  const W = { lake: ['🏞️', 'Lake'], pond: ['💧', 'Pond'], river: ['🌊', 'River or canal'], stream: ['〰️', 'Stream or ditch'], reservoir: ['🛢️', 'Reservoir'], well: ['🕳️', 'Well'] };
  const drawMap = () => {
    if (wmap || !q('#wmap')?.offsetWidth) return;
    wmap = window.L.map(q('#wmap')).setView([S.site.lat, S.site.lon], 12);
    window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery &copy; Esri' }).addTo(wmap);
    window.L.marker([S.site.lat, S.site.lon], { icon: window.L.divIcon({ className: '', html: '<div style="font-size:30px;transform:translate(-8px,-24px)">🚜</div>' }) }).addTo(wmap);
    wmap.__g = window.L.layerGroup().addTo(wmap); plotAll();
  };
  const plotAll = () => {
    if (!wmap) return; wmap.__g.clearLayers();
    for (const w of Object.values(S.water?.nearest || {})) window.L.circleMarker([w.lat, w.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#31c8f0', fillOpacity: 0.95 }).bindTooltip(`${W[w.kind][0]} ${esc(w.name || W[w.kind][1])}, ${w.km} km`).addTo(wmap.__g);
    for (const f of (S.fires?.nearest || []).slice(0, 40)) window.L.circleMarker([f.lat, f.lon], { radius: 6, color: '#fff', weight: 1, fillColor: '#ff5a3c', fillOpacity: 0.9 }).bindTooltip(`🔥 Fire seen ${f.date}, ${f.km} km away`).addTo(wmap.__g);
  };
  if (wmap) { wmap.remove(); wmap = null; } S.water = null; S.fires = null;
  onShow.water = () => setTimeout(() => { drawMap(); wmap?.invalidateSize(); }, 80);
  getJSON(`/api/water?${L}`, 150000).then(r => {
    if (my !== S.tok) return; S.water = r; plotAll();
    const order = ['stream', 'pond', 'lake', 'river', 'reservoir', 'well'].filter(k => r.nearest[k]);
    q('#wlist').innerHTML = !order.length ? '<p>No lakes, rivers or ponds are mapped within 10 km. Ground water (a well) may be the only option: ask your local water office.</p>'
      : order.map(k => { const w = r.nearest[k]; return `<div class="plc" data-lat="${w.lat}" data-lon="${w.lon}"><span class="e">${W[k][0]}</span><span><b>Nearest ${W[k][1].toLowerCase()}${w.name ? ': ' + esc(w.name) : ''}</b><span>${w.km < 1 ? Math.round(w.km * 1000) + ' m' : w.km + ' km'} from your field</span></span></div>`; }).join('');
    q('#wlist').onclick = e => { const c = e.target.closest('.plc'); if (c && wmap) wmap.flyTo([+c.dataset.lat, +c.dataset.lon], 15); };
  }).catch(e => { if (my === S.tok) q('#wlist').innerHTML = `<p>The water search is busy right now (${esc(e.message)}). Try again in a minute.</p>`; });
  getJSON(`/api/firehistory?${L}`, 240000).then(r => {
    if (my !== S.tok) return; S.fires = r; plotAll();
    if (!r.covered) { q('#flist').innerHTML = '<p>NASA fire records could not be matched to this country.</p>'; return; }
    const mx = Math.max(1, ...r.years.map(y => y.count)), yrs = r.years.length, f0 = r.nearest[0];
    const verdict = !r.total ? `✅ <b>No fires</b> were seen within ${r.radius_km} km in ${yrs} years. Fire risk looks <b>low</b>.`
      : r.total < 10 ? `🙂 Only <b>${r.total} small fire${r.total === 1 ? '' : 's'}</b> seen within ${r.radius_km} km in ${yrs} years (nearest ${f0.km} km away, ${f0.date}). Often these are field or brush burning.`
      : `⚠️ <b>${r.total} fires</b> seen within ${r.radius_km} km in ${yrs} years. Fire is a real risk here: keep fire breaks and check local fire alerts.`;
    q('#flist').innerHTML = `<p style="font-size:18px;margin:4px 0 10px">${verdict}</p><div style="display:flex;align-items:flex-end;gap:4px;height:70px">${r.years.map(y => `<div title="${y.year}: ${y.count}" style="flex:1;text-align:center"><div style="height:${Math.max(2, y.count / mx * 54)}px;background:${y.count ? '#ff5a3c' : 'rgba(255,255,255,.15)'};border-radius:4px 4px 0 0"></div><small style="font-size:10px;color:var(--mut)">${String(y.year).slice(2)}</small></div>`).join('')}</div>`;
  }).catch(e => { if (my === S.tok) q('#flist').innerHTML = `<p>NASA fire records are busy right now (${esc(e.message)}).</p>`; });
}

// ---------- grow it: watch both plans grow through real past seasons ----------
let grow = null;
const BUDGET_BU = { maize: 193, soybean: 52, wheat: 96 }, PRICE_KEY = { maize: 'Corn', soybean: 'Soybeans', wheat: 'Wheat' };
function renderGrow() {
  const b = body('grow'); if (!S.sim) return;
  const { c, table, farm } = S.sim, main = mainCrop(), rot = rotationFor(main), years = c.yStarts.slice(-(rot.length + 1)); // one full rotation, then the main crop again (the year rotation pays back)
  const plansIds = [years.map(() => main), years.map((_, i) => rot[i % rot.length])];
  const R = S.rot, money_ok = S.ontario && plansIds.flat().every(id => BUDGET_BU[id]);
  const COST = { maize: R.omafa.corn_operating_cost_ac, soybean: R.omafa.soy_operating_cost_ac, wheat: R.omafa.wheat_operating_cost_ac };
  const plans = plansIds.map((ids, k) => ({
    label: k ? 'Our rotation' : 'Same crop every year',
    seasons: ids.map((id, si) => {
      const cr = CROP[id], ys = years[si], plant = ys + table[id].doy - 1, prev = si ? ids[si - 1] : main;
      const base = seasonSim(c, cr, farm, plant, DEFAULT_P, true)?.rel ?? 0;
      const pen = prev === id ? (id === 'soybean' ? R.omafa.soy_after_soy_loss_pct : R.omafa.corn_after_corn_loss_pct) / 100 : 0;
      const rel = base * (1 - pen), avg = table[id].meanRel || 1;
      const bu = BUDGET_BU[id] ? BUDGET_BU[id] * rel / avg : null, cad = bu && money_ok ? bu * R.prices.cad_t[PRICE_KEY[id]] / R.prices.bu_per_t[PRICE_KEY[id]] - COST[id] : null;
      const i0 = Math.max(60, plant - 12), i1 = Math.min(c.n - 1, plant + cr.days + 18);
      return { crop: { id, name: ENGINE_NAME[id], emo: ENGINE_EMO[id] }, year: c.yearOf[plant], plant, i0, i1, tr: trace(c, cr, farm, plant, DEFAULT_P, i0, i1), rel, pen, bu, cad };
    }),
  }));
  const tot = plans.map(p => p.seasons.reduce((s, x) => s + (money_ok ? x.cad : x.rel * 100), 0));
  b.innerHTML = `<span class="tag">Simulation with real NASA weather</span><h2>Watch your field grow: same crop vs rotation</h2>
    <p class="say">Two halves of your field, grown through the <b>last ${years.length} real seasons</b> of NASA weather. <b>Left:</b> ${ENGINE_EMO[main]} ${ENGINE_NAME[main].toLowerCase()} every year. <b>Right:</b> ${rot.map(id => ENGINE_EMO[id] + ' ' + ENGINE_NAME[id].toLowerCase()).join(' → ')}. Brown leaves = thirsty plants. Dark soil = wet.</p>
    <div style="position:relative"><div id="gview" style="height:min(60vh,520px);border-radius:18px;overflow:hidden;background:#9fd3ff"></div>
      <div id="ghud" style="position:absolute;left:12px;top:12px;right:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none;flex-wrap:wrap">
        <span class="chip" style="background:rgba(5,11,31,.75)" id="gl0"></span><span class="chip" style="background:rgba(5,11,31,.75);font-size:18px" id="gdate"></span><span class="chip" style="background:rgba(5,11,31,.75)" id="gl1"></span></div>
      <div style="position:absolute;left:12px;bottom:12px;display:flex;gap:8px"><button class="chip" id="gplay" style="background:rgba(5,11,31,.8)">⏸ Pause</button><button class="chip" id="grst" style="background:rgba(5,11,31,.8)">⟲ Start again</button>
        <button class="chip" data-sp="0.8" style="background:rgba(5,11,31,.8)">🐢 Slow</button><button class="chip" data-sp="2.2" style="background:rgba(5,11,31,.8)">🐇 Fast</button></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(255,255,255,.2)"><i id="gbar" style="display:block;height:100%;width:0;background:var(--sun)"></i></div></div>
    <div class="vs" id="gres" style="margin-top:16px"></div><div id="gsum"></div>
    <details class="how"><summary>How does the simulation work?</summary>Each day of each season, our crop model (FAO-56 water balance with NASA POWER rain, temperature and sunshine, on your SoilGrids soil) works out how much water is in the soil, how thirsty the crop is, heat and frost. That sets the plant size and colour you see and the harvest. Planting the same crop twice in a row loses ${R.omafa.corn_after_corn_loss_pct}% (corn) or ${R.omafa.soy_after_soy_loss_pct}% (soybeans), the figures in Ontario's 2026 crop budgets. ${money_ok ? `Bushels use Ontario's budget yields (corn ${BUDGET_BU.maize}, soybeans ${BUDGET_BU.soybean}, wheat ${BUDGET_BU.wheat} bu/acre) scaled by how good each season was here; dollars = sales at Statistics Canada Ontario prices (${esc(R.prices.month)}) minus Ontario's 2026 budget operating costs per acre (corn $${COST.maize}, soybeans $${COST.soybean}, wheat $${COST.wheat}, grain only). Land, machinery and your own time are not included.` : 'Harvests are shown as % of a full harvest.'} It does not include pests, disease or soil building, which the field trials in step 4 show make rotation pay even more.</details>`;
  const rows = plans[0].seasons.map((_, si) => si);
  const shown = new Set();
  const fmt = x => money_ok ? `${Math.round(x.bu)} bu · ${x.cad < 0 ? '−' : ''}${money(Math.abs(x.cad))} left` : `${Math.round(x.rel * 100)}%`;
  const draw = done => {
    q('#gres').innerHTML = `<div class="row" style="font-weight:800;color:var(--mut)"><span>Harvest</span><span style="display:flex;justify-content:space-between"><span>Same crop every year</span><span>Our rotation</span></span><span></span></div>` + rows.map(si => {
      if (!shown.has(si)) return `<div class="row"><span>${plans[0].seasons[si].year}</span><span style="color:var(--mut)">growing...</span><span></span></div>`;
      const a = plans[0].seasons[si], r = plans[1].seasons[si];
      return `<div class="row"><span>${a.year}</span><span style="display:flex;justify-content:space-between;gap:8px"><b>${a.crop.emo} ${fmt(a)}${a.pen ? ' <small style="color:var(--bad)">(same crop again)</small>' : ''}</b><b>${r.crop.emo} ${fmt(r)}</b></span><span></span></div>`;
    }).join('');
    if (done) {
      const d = tot[1] - tot[0];
      q('#gsum').innerHTML = `<div class="money"><span class="tag" style="--c:var(--leaf)">Result over ${years.length} seasons</span><p class="say" style="margin:8px 0">${money_ok
        ? `Money left after growing costs, over ${years.length} seasons. Same crop: <b>${money(tot[0])}</b> an acre. Rotation: <b>${money(tot[1])}</b> an acre. Difference: <b style="color:${d >= 0 ? 'var(--leaf)' : 'var(--bad)'}">${d >= 0 ? '+' : '−'}${money(Math.abs(d))} an acre</b>${S.site?.ha ? `, about <b>${d >= 0 ? '+' : '−'}${money(Math.abs(d) * S.site.ha * 2.47105)}</b> for your field` : ''}.</p>
          <p style="font-size:17px;margin:6px 0 0">${Math.abs(d) < 60 ? '👉 Over these seasons both plans make <b>about the same money</b>, but the rotation field ends up healthier. ' : d < 0 ? '👉 At today\'s prices corn every year made more money over these few seasons. ' : '👉 The rotation made more money, even over these few seasons. '}This test only counts weather, water and the corn-after-corn loss. The <b>long-term trials in step 4</b> also count healthier soil, fewer pests and drought protection, and there the rotation earned more ($${S.rot.elora.net_ac['Corn, corn, soybean, wheat']} vs $${S.rot.elora.net_ac['Corn every year']} an acre a year).`
        : `Same crop: <b>${Math.round(tot[0] / years.length)}%</b> of a full harvest on average. Rotation: <b>${Math.round(tot[1] / years.length)}%</b>.`}</p></div>`;
    }
  };
  draw(false);
  const container = q('#gview');
  const start = () => {
    if (grow || !container.offsetWidth) return;
    grow = createGrowSim(container, plans, c, (day, di, n, done) => {
      const dt = new Date(Date.UTC(2005, 0, 1) + day.i * 864e5);
      q('#gdate').textContent = `📅 ${dt.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
      const a = plans[0].seasons[day.si], r = plans[1].seasons[day.si];
      q('#gl0').textContent = `◀ Same: ${a.crop.emo} ${a.crop.name}`; q('#gl1').textContent = `Rotation: ${r.crop.emo} ${r.crop.name} ▶`;
      q('#gbar').style.width = (di / (n - 1) * 100) + '%';
      for (const si of rows) if (!shown.has(si) && (day.si > si || (day.si === si && day.i >= Math.max(plans[0].seasons[si].plant + CROP[plans[0].seasons[si].crop.id].days, plans[1].seasons[si].plant + CROP[plans[1].seasons[si].crop.id].days)))) { shown.add(si); draw(false); }
      if (done) { rows.forEach(si => shown.add(si)); draw(true); q('#gplay').textContent = '▶ Play again'; }
    });
  };
  if (grow) { grow.destroy(); grow = null; }
  onShow.grow = () => setTimeout(start, 120);
  if (q('#ch-grow').classList.contains('show')) onShow.grow();
  b.querySelector('#gplay').onclick = () => { if (!grow) return; const on = grow.play(); q('#gplay').textContent = on ? '⏸ Pause' : '▶ Play'; };
  b.querySelector('#grst').onclick = () => { if (!grow) return; shown.clear(); q('#gsum').innerHTML = ''; draw(false); grow.restart(); q('#gplay').textContent = '⏸ Pause'; };
  b.querySelectorAll('[data-sp]').forEach(x => x.onclick = () => grow?.setSpeed(+x.dataset.sp));
}
