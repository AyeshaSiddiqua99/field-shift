// Field Replay (Part 1): replay the last 18 seasons of a field on NASA weather and soil, find the hard years,
// cross-check them with other trusted public data, and ask the farmer whether it matches their memory.
import { CROPS, CROP, DEFAULT_P, YEAR0, prepClimate, evalCrops, trace, soilFromLayers, seasonSim } from './engine.js';
import { createMap } from './map.js';
import { createStack } from './stack3d.js';

const $ = id => document.getElementById(id);
const T0 = Date.UTC(2005, 0, 1);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const S = { loc: null, raw: null, soilModel: null, soilState: '', slope: 3, cropId: null, c: null, table: null, seasons: [], sel: 0, day: 0, playing: true, yield: null, fire: null };
let regions = {}, mapApi = null, token = 0, lastT = 0, lastDraw = -1;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dparts = idx => { const d = new Date(T0 + idx * 864e5); return [d.getUTCDate(), d.getUTCMonth(), d.getUTCFullYear()]; };
const fmtDate = idx => { const [d, m, y] = dparts(idx); return `${d} ${MONTHS[m].slice(0, 3)} ${y}`; };
const fuzzy = idx => { const [d, m, y] = dparts(idx); return `${d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late'} ${MONTHS[m]} ${y}`; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// ---------- the 3D stack of real NASA layers over the selected farm ----------
let stack = null, stackTimer = null, stackAt = 0, stackIso = null;
const LAYER_NAMES = { rain: 'c-rain', soil: 'c-soil', heat: 'c-heat', veg: 'c-veg', water: 'c-water' };
function onLayerStatus(key, st) {
  const el = LAYER_NAMES[key] && $(LAYER_NAMES[key]); if (!el) return; const cap = el.querySelector('.cap'), orig = cap.dataset.orig || (cap.dataset.orig = cap.textContent);
  cap.classList.toggle('no', !st.ok); cap.classList.toggle('no', !st.ok && !(st.empty && key === 'rain')); cap.textContent = st.empty ? (key === 'rain' ? 'NASA IMERG saw no rain here that day' : 'NASA has no clear reading here that day (cloud)') : !st.ok ? 'no NASA image for this date' : st.used ? `${orig} - image of ${st.used}` : orig;
}
// colour legends: NASA's own published colour scales, so a colour on a layer can be read as a value
async function loadLegends() {
  for (const k of ['rain', 'soil', 'heat', 'veg', 'water']) {
    const el = $('leg-' + k); if (!el) continue;
    try {
      const L = await fetchJSON(`/api/legend?key=${k}`, 30000);
      el.innerHTML = L.classes ? L.classes.map(c => `<span class="lc"><i style="background:${c.rgb}"></i>${esc(c.label)}</span>`).join('') :
        `<div class="lbar" style="background:linear-gradient(to right, ${L.stops.join(',')})"></div><div class="lticks">${L.ticks.map(t => `<span style="left:${(t.p * 100).toFixed(0)}%">${esc(t.label)}</span>`).join('')}</div><div class="lunits">${esc(L.units)}. Clear = no data or none.</div>`;
    } catch { el.innerHTML = ''; }
  }
}
function stackDate(iso) { // while playing, refresh the NASA images about every 2 s; when you scrub or stop, a moment after you let go
  stackIso = iso; if (stackTimer || !stack) return;
  stackTimer = setTimeout(() => { stackTimer = null; stackAt = Date.now(); stack.setDate(stackIso); }, S.playing ? Math.max(300, 2000 - (Date.now() - stackAt)) : 350);
}

// ---------- the land the buyer draws ----------
function toXY(pts) { const k = Math.cos(mean(pts.map(p => p[0])) * Math.PI / 180); return pts.map(p => [p[1] * 111320 * k, p[0] * 110540]); }
function polyAreaHa(pts) { const q = toXY(pts); let a = 0; for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2 / 10000; }
function polyCentroid(pts) {
  const q = toXY(pts); let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length], f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  if (Math.abs(a) < 1e-6) return [mean(pts.map(p => p[0])), mean(pts.map(p => p[1]))];
  const k = Math.cos(mean(pts.map(p => p[0])) * Math.PI / 180); return [cy / (3 * a) / 110540, cx / (3 * a) / (111320 * k)];
}
const fmtArea = ha => { const ac = ha * 2.47105; return `${ha < 10 ? ha.toFixed(2) : ha < 100 ? ha.toFixed(1) : Math.round(ha)} ha (${ac < 10 ? ac.toFixed(1) : Math.round(ac)} acres)`; };
function drawUI(info) {
  const drawing = mapApi.isDrawing(), n = info?.pts?.length || 0;
  $('draw').textContent = drawing ? 'Cancel drawing' : 'Draw my land'; $('draw').classList.toggle('on', drawing);
  $('undo').disabled = !drawing || n < 1; $('finish').disabled = !drawing || n < 3; $('clearland').disabled = drawing || !S.outline;
  if (drawing) $('drawnote').textContent = n < 3 ? `Click the corners of your land on the satellite map (${n} so far; at least 3).` : `${n} corners, about ${fmtArea(polyAreaHa(info.pts))} so far. Click the first (green) corner again, or press Finish, to close the shape.`;
  else if (S.outline) { const a = polyAreaHa(S.outline); $('drawnote').innerHTML = `${S.outlineSrc === 'osm' ? 'Farm outline from OpenStreetMap' : 'Your outline'}: <b>${fmtArea(a)}</b>. ${S.outlineSrc === 'osm' ? 'This is a mapped farmland area, not a legal boundary or proof of who owns it.' : 'This is the outline you drew, not a legal boundary.'} Weather, soil and projections are read at its centre.${a > 1500 ? ' <span class="warn">That is much larger than almost any single farm. Zoom in and trace just the land you are checking.</span>' : a < 0.05 ? ' <span class="warn">That is very small; add more space or zoom in.</span>' : ''}`; }
  else $('drawnote').textContent = 'Checking land you don\'t own yet? Press "Draw my land", then click its corners on the satellite map.';
}
function onDraw(info) {
  if (!info.closed) return drawUI(info);
  const c = polyCentroid(info.pts); selectLocation(c[0], c[1], `My land, ${fmtArea(polyAreaHa(info.pts))}`, { keepView: true, poly: info.pts });
}

async function fetchJSON(url, ms = 60000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'request failed'); return j; }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message); } finally { clearTimeout(t); }
}
const presetFor = (lat, lon) => Object.entries(regions).find(([, r]) => Math.abs(r.lat - lat) < 0.05 && Math.abs(r.lon - lon) < 0.05)?.[0];
const rawCache = {};
async function getRaw(loc) {
  const id = presetFor(loc.lat, loc.lon), key = id || `${loc.lat},${loc.lon}`;
  if (rawCache[key]) return rawCache[key];
  const raw = id ? await (await fetch(`data/${id}.json`)).json() : await fetchJSON(`/api/power?lat=${loc.lat}&lon=${loc.lon}`, 120000);
  raw.name = loc.name; return (rawCache[key] = raw);
}
const state = (t, cls = '') => { const el = $('h-state'); el.textContent = t; el.className = 'state ' + cls; };
const farm = () => ({ soil: 'loam', sp: S.soilModel || undefined, slope: S.slope, irrig: 0 });

// ---------- location ----------
// ---------- searching a place lists the farms near it; you pick one (or click / draw your own land) ----------
let areaToken = 0;
function goToArea(lat, lon, name) {
  const tk = ++areaToken; ++token; // abandon any analysis still loading for a previous field
  mapApi.cancelDraw(); mapApi.clearFarms(); mapApi.setMarker(lat, lon); mapApi.setView(lat, lon, 13); S.outline = null; S.loc = null; S.farms = []; drawUI();
  document.body.classList.add('empty'); state('PICK A FARM'); $('siteline').textContent = `Area: ${name}`;
  $('farmlist').innerHTML = `<span>Searching OpenStreetMap for farmland near ${esc(name)} (this can take up to a minute)...</span>`;
  fetchJSON(`/api/farms?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, 120000).then(r => {
    if (tk !== areaToken) return; S.farms = r.farms; mapApi.showFarms(S.farms);
    if (!S.farms.length) { $('farmlist').innerHTML = '<span>No farmland outlines are mapped near here in OpenStreetMap. Click the map, or press "Draw my land".</span>'; return; }
    mapApi.fitFarms(S.farms.slice(0, 12));
    $('farmlist').innerHTML = `<span class="fl-title">${S.farms.length} mapped farmland areas near ${esc(name)}. Pick one:</span>` + S.farms.slice(0, 14).map((f, i) =>
      `<button type="button" data-i="${i}">${esc(f.name || (f.kind === 'orchard' ? 'Orchard' : f.kind === 'vineyard' ? 'Vineyard' : 'Farmland'))} &middot; ${fmtArea(f.ha)} &middot; ${f.d < 1000 ? f.d + ' m' : (f.d / 1000).toFixed(1) + ' km'} away</button>`).join('') +
      '<span class="note">Outlines are mapped by OpenStreetMap volunteers. They show farmland areas, not who owns them, and this is not a list of farms for sale.</span>';
  }).catch(e => { if (tk === areaToken) $('farmlist').innerHTML = `<span>Farm search is unavailable (${esc(e.message)}). Click the map, or press "Draw my land".</span>`; });
}
const pickFarm = f => selectLocation(f.lat, f.lon, `${f.name || 'Farm'}, ${fmtArea(f.ha)}`, { keepView: true, poly: f.poly, src: 'osm' });

async function selectLocation(lat, lon, name, opt = {}) {
  document.body.classList.remove('empty'); ++areaToken;
  const tk = ++token;
  S.loc = { lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), name }; S.soilModel = null; S.soilState = 'loading'; S.yield = null; S.fire = null; S.proj = null;
  document.querySelector('.future').style.display = 'none';
  $('h-lat').textContent = `${Math.abs(S.loc.lat).toFixed(4)} ${S.loc.lat >= 0 ? 'N' : 'S'}`; $('h-lon').textContent = `${Math.abs(S.loc.lon).toFixed(4)} ${S.loc.lon >= 0 ? 'E' : 'W'}`;
  mapApi.cancelDraw(); S.outline = opt.poly || null; S.outlineSrc = opt.src || 'drawn'; mapApi.setMarker(S.loc.lat, S.loc.lon, S.outline); drawUI();
  stack?.setSite({ lat: S.loc.lat, lon: S.loc.lon, poly: S.outline });
  if (!opt.keepView) mapApi.setView(S.loc.lat, S.loc.lon, opt.zoom || 11);
  state('SCANNING...'); siteLine(); renderPublic();
  const q = `lat=${S.loc.lat}&lon=${S.loc.lon}`;
  const soilP = fetchJSON(`/api/soil?${q}`, 240000);
  fetchJSON(`/api/slope?${q}`, 30000).then(s => { if (tk === token) { S.slope = Math.round(s.slope); siteLine(); } }).catch(() => {});
  fetchJSON(`/api/yield?${q}`, 90000).then(y => { if (tk === token) { S.yield = y; renderPublic(); renderTiles(); } }).catch(e => { if (tk === token) { S.yield = { error: e.message }; renderPublic(); } });
  fetchJSON(`/api/fires?${q}`, 150000).then(f => { if (tk === token) { S.fire = f; renderPublic(); } }).catch(e => { if (tk === token) { S.fire = { error: e.message }; renderPublic(); } });
  fetchJSON(`/api/climate?${q}`, 300000).then(p => { if (tk === token) { S.proj = p; computeFuture(); } }).catch(() => {});
  try { S.raw = await getRaw(S.loc); } catch (e) { state('NO DATA: ' + e.message, 'err'); return; }
  if (tk !== token) return;
  const early = await Promise.race([soilP.catch(() => null), sleep(2500).then(() => 'late')]);
  if (early && early !== 'late') { S.soilModel = soilFromLayers(early.layers); S.soilState = S.soilModel ? 'ok' : 'empty'; } else if (!early) S.soilState = 'error';
  compute(true); siteLine();
  soilP.then(s => { if (tk !== token || S.soilModel) return; S.soilModel = soilFromLayers(s.layers); S.soilState = S.soilModel ? 'ok' : 'empty'; compute(false); siteLine(); }).catch(() => { if (tk === token && !S.soilModel) { S.soilState = 'error'; siteLine(); } });
}
function siteLine() {
  const m = S.soilModel, st = S.soilState;
  $('siteline').innerHTML = `${esc(S.loc?.name || '')} &middot; slope ${S.slope}% &middot; ` +
    (m ? `soil: ${esc(m.texture)}, holds ${Math.round(m.awc)} mm water per m (SoilGrids)` : st === 'loading' ? 'soil: reading the soil database (can take a minute; the replay updates when it arrives)' : 'soil: no database value here, using loam');
}

// ---------- compute the 18 seasons ----------
function compute(pickCrop) {
  if (!S.raw) return;
  const f = farm(); S.c = prepClimate(S.raw); S.table = evalCrops(S.c, f);
  if (S.cropAuto || !S.cropId || S.table[S.cropId].noWindow) { // automatic: the crop best suited to this land
    const best = CROPS.filter(x => x.cash && !S.table[x.id].noWindow).sort((a, b) => b.value * S.table[b.id].meanRel - a.value * S.table[a.id].meanRel)[0];
    S.cropId = best.id;
  }
  buildSeasons(); state('READY', 'ok');
}
function buildSeasons() {
  const c = S.c, cr = CROP[S.cropId], t = S.table[S.cropId], f = farm(), thr = 1 - cr.p;
  if (t.noWindow) { S.seasons = []; state('THIS CROP CANNOT BE GROWN HERE', 'err'); renderTiles(); return; }
  const sowDoy = S.sowMonth ? Math.round(S.sowMonth * 30.4 - 15) : t.doy; // farmer's own sowing month, else the model's choice
  // every season that has finished by the end of the NASA data (so 2025 and 2026 are included, not just up to 2023)
  const L = cr.days, starts = [];
  for (let y = YEAR0; ; y++) { const plantIdx = Math.round((Date.UTC(y, 0, 1) - T0) / 864e5) + sowDoy - 1; if (plantIdx + L > c.n - 1) break; starts.push(plantIdx); }
  S.seasons = starts.map((plantIdx, yi) => {
    const i0 = plantIdx - 40, i1 = Math.min(plantIdx + L + 30, c.n), tr = trace(c, cr, f, plantIdx, DEFAULT_P, i0, i1);
    let first = -1, stress = 0, sev = 0, heat = 0, rain = 0, maxRain = 0, maxRainDay = -1, minMoist = 1, run = 0, dry = 0, dryEnd = -1;
    for (let d = 0; d < i1 - i0; d++) if (tr.inSeason[d]) {
      const i = i0 + d;
      if (tr.ks[d] < 0.8) { stress++; if (first < 0) first = d; }
      if (tr.ks[d] < 0.5) sev++;
      if (c.tmax[i] > cr.heat) heat++;
      rain += c.prec[i]; if (c.prec[i] > maxRain) { maxRain = c.prec[i]; maxRainDay = d; }
      run = c.prec[i] < 1 ? run + 1 : 0; if (run > dry) { dry = run; dryEnd = d; } // longest stretch under 1 mm of rain a day
      minMoist = Math.min(minMoist, tr.moist[d]);
    }
    return { yi, plantIdx, i0, i1, tr, first, stress, sev, heat, rain, maxRain, maxRainDay, minMoist, dry, dryEnd, thr, year: dparts(plantIdx + L)[2] };
  });
  const avgRain = mean(S.seasons.map(s => s.rain)); S.seasons.forEach(s => { s.rainPct = 100 * s.rain / avgRain; });
  const order = [...S.seasons].sort((a, b) => b.sev - a.sev || b.stress - a.stress || a.minMoist - b.minMoist);
  S.seasons.forEach(s => { s.hard = order.indexOf(s) < 3 && s.sev > 0; s.rank = order.indexOf(s) + 1; });
  S.scaleMax = Math.max(25, ...S.seasons.map(s => s.sev)); $('nseas').textContent = S.seasons.length;
  S.sel = S.seasons.indexOf(order[0]); S.day = 0; lastDraw = -1;
  $('striptitle').textContent = `Replaying ${CROP[S.cropId].name}${S.cropAuto ? ' (best suited here)' : ''}, sown ${S.sowMonth ? MONTHS[S.sowMonth - 1] : fuzzy(S.seasons[0].plantIdx).replace(/ \d+$/, '') + ' (automatic)'}`;
  renderTiles(); selectYear(S.sel); renderPublic(); computeFuture();
}

// ---------- the next decades: the same 18 weather years re-run with the projected climate shift ----------
function computeFuture() {
  const sec = document.querySelector('.future');
  if (!S.proj || !S.c || !S.seasons.length) { sec.style.display = 'none'; return; }
  const cr = CROP[S.cropId], t = S.table[S.cropId], f = farm(), sowDoy = S.sowMonth ? Math.round(S.sowMonth * 30.4 - 15) : t.doy;
  const stat = c => { const v = c.yStarts.map(ys => seasonSim(c, cr, f, ys + sowDoy - 1, DEFAULT_P, true)?.severe ?? 0); return { mean: mean(v), hard: v.filter(x => x >= 20).length, n: v.length }; };
  const base = { mean: mean(S.seasons.map(s => s.sev)), hard: S.seasons.filter(s => s.sev >= 20).length, n: S.seasons.length };
  const rows = Object.entries(S.proj.horizons).map(([h, v]) => ({ h, v, ...stat(prepClimate(S.raw, { dT: Math.max(0, v.dT), dP: v.dP, ext: v.ext })) }));
  const pc = x => `${x >= 0 ? '+' : ''}${Math.round(100 * x)}%`, bar = m => `<div class="fbar"><i style="width:${Math.min(100, 100 * m / 70)}%;background:${stressColor(m)}"></i></div>`;
  $('futurebody').innerHTML = `<table class="ft"><tr><th></th><th>Warming</th><th>Rain</th><th>Downpours</th><th>Badly water-short days per season</th><th>Seasons with 20+ such days</th></tr>
    <tr><td>${S.seasons[0].year}-${S.seasons.at(-1).year} <span class="note">(what happened)</span></td><td>-</td><td>-</td><td>-</td><td><b>${base.mean.toFixed(0)}</b>${bar(base.mean)}</td><td><b>${base.hard}</b> of ${base.n}</td></tr>
    ${rows.map(r => `<tr><td>${r.h} <span class="note">(projected)</span></td><td>+${Math.max(0, r.v.dT).toFixed(1)} &deg;C <span class="note">(${r.v.dT_range[0].toFixed(1)} to ${r.v.dT_range[1].toFixed(1)})</span></td><td>${pc(r.v.dP)} <span class="note">(${pc(r.v.dP_range[0])} to ${pc(r.v.dP_range[1])})</span></td><td>${pc(r.v.ext)}</td><td><b>${r.mean.toFixed(0)}</b>${bar(r.mean)}</td><td><b>${r.hard}</b> of ${r.n}</td></tr>`).join('')}</table>
    <p class="note">A "badly water-short day" is a day the soil holds so little water that the crop's water use falls below half of what it wants. It comes from a simple soil-water model, so trust the change between rows more than the absolute number. The same weather years re-run with the shift that climate models project for this location (mean and range of ${S.proj.models.length} models). It is a what-if, not a forecast. Projections: CMIP6 models via Open-Meteo, not a NASA product.</p>`;
  sec.style.display = '';
}

// ---------- strip of 18 seasons ----------
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function stressColor(s) { const t = Math.min(1, s / (S.scaleMax || 40)), G = [43, 212, 160], A = [242, 184, 75], R = [240, 96, 93]; const c = t < 0.5 ? mix(G, A, t * 2) : mix(A, R, (t - 0.5) * 2); return `rgb(${c.join(',')})`; }
const memKey = s => `fieldreplay:${S.loc.lat},${S.loc.lon}:${S.cropId}:${s.year}`;
const memGet = s => { try { return localStorage.getItem(memKey(s)); } catch { return null; } };
function yieldAnoms() {
  const y = S.yield?.series; if (!y || y.length < 8) return null;
  const xs = y.map(r => r[0]), ys = y.map(r => r[1]), mx = mean(xs), my = mean(ys); let n = 0, d = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); d += (x - mx) ** 2; });
  const b = n / d, a = my - b * mx; return Object.fromEntries(y.map(r => [r[0], 100 * (r[1] - (a + b * r[0])) / (a + b * r[0])]));
}
function renderTiles() {
  const el = $('tiles'); if (!S.seasons.length) { el.innerHTML = '<p class="note">No seasons to show yet.</p>'; $('ynat').innerHTML = ''; return; }
  const an = yieldAnoms();
  el.innerHTML = S.seasons.map((s, i) => {
    const m = memGet(s), v = an ? an[s.year] : null;
    const ny = v == null ? '' : `<span class="ny ${v < -3 ? 'dn' : v > 3 ? 'up' : ''}" title="National cereal yield vs its trend (World Bank / FAO)">nat'l ${v > 0 ? '+' : ''}${v.toFixed(0)}%</span>`;
    return `<div class="tile ${i === S.sel ? 'sel' : ''} ${s.hard ? 'hard' : ''} ${m === 'y' ? 'mem-y' : m === 'n' ? 'mem-n' : ''}" data-i="${i}" title="${s.year}: rain ${Math.round(s.rain)} mm, longest dry stretch ${s.dry} days, ${s.sev} badly water-short days (model)"><b>${s.year}</b><div class="bar2" style="background:${stressColor(s.sev)}"></div><span>rain ${Math.round(s.rainPct)}%</span><span>${s.dry} d no rain</span>${ny}</div>`;
  }).join('');
  $('ynat').innerHTML = an ? '<p class="note">Lower line in each tile: the country\'s cereal yield vs its own trend that year (World Bank, FAO data). It is a national average, shown only as a cross-check.</p>' : '';
}

// ---------- selected season ----------
function selectYear(i) { S.sel = i; S.day = 0; lastDraw = -1; const s = S.seasons[i]; $('day').max = s.i1 - s.i0 - 1; $('day').value = 0; renderTiles(); renderYear(); drawAll(0); }
function renderYear() {
  const s = S.seasons[S.sel], cr = CROP[S.cropId]; if (!s) return;
  const lines = [`Sown ${fmtDate(s.plantIdx)}, harvest ${fmtDate(s.plantIdx + cr.days)} (${cr.name}, ${cr.days} days).`,
    `<b>Weather you can check:</b> ${Math.round(s.rain)} mm of rain in the season, <b>${Math.round(s.rainPct)}%</b> of the average season here.`,
    `Longest stretch with almost no rain (under 1 mm a day): <b>${s.dry} days</b>${s.dry ? `, ending ${fmtDate(s.i0 + s.dryEnd)}` : ''}.`,
    `<b>${s.heat}</b> days above ${cr.heat} &deg;C; heaviest rain ${s.maxRain.toFixed(0)} mm on ${fmtDate(s.i0 + s.maxRainDay)}.`,
    s.first >= 0 ? `<b>What the soil model says:</b> the crop first ran short of water around <b>${fuzzy(s.i0 + s.first)}</b> (${s.stress} days short, ${s.sev} of them badly).` : '<b>What the soil model says:</b> the crop never ran short of water.',
    `Ranked <b>${s.rank} of ${S.seasons.length}</b> for water shortage on this land (1 = hardest).`];
  $('yearcard').innerHTML = `<h3>${s.year}${s.hard ? ' &#9711;' : ''}</h3><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul><p class="note">Stress line = soil water below ${Math.round(100 * s.thr)}% of what the root zone holds. Estimated from NASA weather and soil data, not measured in your field.</p>`;
  const m = memGet(s);
  $('match').innerHTML = [['y', 'Yes, that was it'], ['n', 'No'], ['u', 'Not sure']].map(([k, l]) => `<button type="button" data-k="${k}" class="${m === k ? 'on' : ''}">${l}</button>`).join('');
  const ms = S.seasons.map(memGet), y = ms.filter(v => v === 'y').length, n = ms.filter(v => v === 'n').length;
  $('matchtally').textContent = y + n ? `You have checked ${y + n} seasons: ${y} matched your memory, ${n} did not. (Saved in this browser only.)` : 'Your answers are saved in this browser only.';
}

// ---------- drawing: stage, bucket, chart ----------
function drawAll(d) {
  const s = S.seasons[S.sel]; if (!s) return; d = Math.max(0, Math.min(s.i1 - s.i0 - 1, d)); S.day = d; $('day').value = d; if (d === lastDraw) return; lastDraw = d;
  const c = S.c, cr = CROP[S.cropId], i = s.i0 + d, tr = s.tr, rain = c.prec[i], tmax = c.tmax[i], moist = tr.moist[d], can = tr.canopy[d], ks = tr.ks[d], inS = tr.inSeason[d] === 1;
  let r7 = 0; for (let k = 0; k < 7; k++) r7 += c.prec[i - k];
  const set = (id, val, cls) => { const el = $(id); el.querySelector('b').textContent = val; el.className = 'call ' + cls; };
  set('c-rain', `${rain.toFixed(1)} mm  (7 d: ${r7.toFixed(0)})`, rain > 1 ? 'good' : '');
  const wet = c.gwroot?.[i];
  set('c-soil', wet == null ? 'no value' : `${Math.round(100 * wet)}% wet`, '');
  set('c-heat', `${tmax.toFixed(0)} °C high`, tmax > cr.heat ? 'bad' : tmax > cr.heat - 3 ? 'warn' : '');
  set('c-veg', inS ? `crop cover ${Math.round(100 * can)}%` : d < tr.plant ? 'field is bare' : 'harvested', '');
  set('c-water', `${Math.round(100 * moist)}% full`, moist < s.thr ? 'bad' : moist < s.thr + 0.15 ? 'warn' : 'good');
  stackDate(new Date(T0 + i * 864e5).toISOString().slice(0, 10));
  const phase = d < tr.plant ? 'BEFORE SOWING' : inS ? `SEASON DAY ${d - tr.plant + 1} OF ${cr.days}` : 'AFTER HARVEST';
  $('hud').innerHTML = `<span>${fmtDate(i)}</span><span>${phase}</span><span>${esc(cr.name).toUpperCase()}</span><span>${S.sel + 1} / ${S.seasons.length} SEASONS</span>`;
  drawBucket(moist, s.thr, rain, tmax > cr.heat, inS ? can : 0, ks, d);
  drawChart(s, d);
}
function drawBucket(m, thr, rain, hot, can, ks, d) {
  const x = 60, y = 110, w = 150, h = 190, top = y + h - h * m, thy = y + h - h * thr, low = m < thr, col = low ? '#f0605d' : '#2bd4a0';
  const stem = 14 + can * 62, leaf = 6 + can * 20, lc = ks < 0.8 ? '#c9b24a' : '#4aa04a';
  let drops = ''; if (rain > 0.5) for (let k = 0; k < Math.min(16, Math.round(2 + rain)); k++) { const dx = 70 + ((k * 37 + d * 11) % 130), dy = 8 + ((k * 23 + d * 17) % 60); drops += `<line x1="${dx}" y1="${dy}" x2="${dx - 3}" y2="${dy + 13}" stroke="#4aa3ff" stroke-width="2" opacity=".85"/>`; }
  $('bucket').innerHTML = `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".85"/><stop offset="1" stop-color="${col}" stop-opacity=".45"/></linearGradient></defs>
    ${hot ? '<circle cx="225" cy="35" r="20" fill="#ff7a3d" opacity=".85"/><circle cx="225" cy="35" r="30" fill="#ff7a3d" opacity=".2"/>' : ''}${drops}
    <line x1="135" y1="${y}" x2="135" y2="${y - stem}" stroke="${lc}" stroke-width="4"/><ellipse cx="${135 - leaf * 0.7}" cy="${y - stem * 0.6}" rx="${leaf}" ry="${leaf * 0.4}" fill="${lc}" opacity=".9"/><ellipse cx="${135 + leaf * 0.7}" cy="${y - stem * 0.85}" rx="${leaf}" ry="${leaf * 0.4}" fill="${lc}" opacity=".9"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#1a2336" stroke="#31c8f0" stroke-width="2"/>
    <rect x="${x + 2}" y="${top}" width="${w - 4}" height="${y + h - top - 2}" fill="url(#wg)"/>
    <line x1="${x - 8}" y1="${thy}" x2="${x + w + 8}" y2="${thy}" stroke="#f2b84b" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="${x + w + 12}" y="${thy + 4}" fill="#f2b84b" font-size="11" font-family="monospace">STRESS</text>
    <text x="${x + w / 2}" y="${y + h + 24}" fill="${col}" font-size="22" font-weight="700" font-family="monospace" text-anchor="middle">${Math.round(100 * m)}% full</text>`;
  $('bucketnote').textContent = low ? 'Below the stress line: the crop is short of water.' : 'Above the stress line: the crop has the water it needs.';
}
function drawChart(s, d) {
  const cv = $('chart'), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = 230; if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px'; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const c = S.c, cr = CROP[S.cropId], n = s.i1 - s.i0, L = 40, R = 38, T = 14, B = 26, X = k => L + (w - L - R) * k / (n - 1), Yp = v => T + (h - T - B) * (1 - v);
  g.fillStyle = 'rgba(43,212,160,.07)'; g.fillRect(X(s.tr.plant), T, X(s.tr.harvest) - X(s.tr.plant), h - T - B);
  g.font = '11px ui-monospace,Consolas,monospace'; g.fillStyle = '#8fa3c0'; g.strokeStyle = '#26364f'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(L, Yp(k / 4)); g.lineTo(w - R, Yp(k / 4)); g.stroke(); g.fillText(`${k * 25}%`, 4, Yp(k / 4) + 4); g.fillText(`${Math.round(k * 11.25)}°`, w - R + 6, Yp(k / 4) + 4); }
  let last = -1; for (let k = 0; k < n; k++) { const [dd, m] = dparts(s.i0 + k); if (dd === 1 && m !== last) { last = m; g.fillText(MONTHS[m].slice(0, 3), X(k) - 8, h - 8); g.beginPath(); g.moveTo(X(k), T); g.lineTo(X(k), h - B); g.stroke(); } }
  for (let k = 0; k < n; k++) { const p = c.prec[s.i0 + k]; if (p > 0.2) { g.fillStyle = '#4aa3ff'; const bh = Math.min(1, p / 40) * (h - T - B) * 0.6; g.fillRect(X(k) - 1, h - B - bh, 2, bh); } }
  g.strokeStyle = '#f2b84b'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(L, Yp(s.thr)); g.lineTo(w - R, Yp(s.thr)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#ff7a3d'; g.lineWidth = 1.5; g.beginPath(); for (let k = 0; k < n; k++) { const v = Math.min(1, c.tmax[s.i0 + k] / 45); k ? g.lineTo(X(k), Yp(v)) : g.moveTo(X(k), Yp(v)); } g.stroke();
  g.strokeStyle = '#ff7a3d'; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(L, Yp(cr.heat / 45)); g.lineTo(w - R, Yp(cr.heat / 45)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#2bd4a0'; g.lineWidth = 2.5; g.beginPath(); for (let k = 0; k < n; k++) { const v = s.tr.moist[k]; k ? g.lineTo(X(k), Yp(v)) : g.moveTo(X(k), Yp(v)); } g.stroke();
  for (let k = 0; k < n; k++) if (s.tr.inSeason[k] && c.tmax[s.i0 + k] > cr.heat) { g.fillStyle = '#f0605d'; g.fillRect(X(k) - 1, T, 2, 7); }
  if (s.first >= 0) { g.fillStyle = '#f2b84b'; g.beginPath(); g.moveTo(X(s.first), Yp(s.tr.moist[s.first]) - 4); g.lineTo(X(s.first) - 6, Yp(s.tr.moist[s.first]) - 16); g.lineTo(X(s.first) + 6, Yp(s.tr.moist[s.first]) - 16); g.fill(); g.fillText('first stress', X(s.first) + 8, Yp(s.tr.moist[s.first]) - 18); }
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(d), T); g.lineTo(X(d), h - B); g.stroke();
  g.fillStyle = '#2bd4a0'; g.fillText('soil water', L + 6, T + 26); g.fillStyle = '#ff7a3d'; g.fillText('daily high', L + 80, T + 26); g.fillStyle = '#4aa3ff'; g.fillText('rain', L + 154, T + 26); g.fillStyle = '#f2b84b'; g.fillText('- - stress line', L + 190, T + 26); g.fillStyle = '#f0605d'; g.fillText('| days over the heat limit', L + 290, T + 26);
  $('chartsub').textContent = `${s.year} season`;
}

// ---------- trusted public cross-checks ----------
function pearson(a, b) { const ma = mean(a), mb = mean(b); let n = 0, x = 0, y = 0; a.forEach((v, i) => { n += (v - ma) * (b[i] - mb); x += (v - ma) ** 2; y += (b[i] - mb) ** 2; }); return x && y ? n / Math.sqrt(x * y) : NaN; }
function renderPublic() {
  const Y = S.yield, F = S.fire; let yh = '', fh = ''; // a box appears only when its data really arrived; nothing half-loaded is shown
  if (Y && !Y.error) {
    const an = yieldAnoms(), ss = S.seasons.filter(s => an && an[s.year] != null);
    if (an && ss.length >= 8) {
      const r = pearson(ss.map(s => s.stress), ss.map(s => an[s.year])), low = [...ss].sort((a, b) => an[a.year] - an[b.year]).slice(0, 3).map(s => s.year), hard = ss.filter(s => s.hard).map(s => s.year), both = hard.filter(y => low.includes(y));
      const verdict = r < -0.3 ? '<span class="good">agrees</span>' : r > 0.3 ? '<span class="bad">disagrees</span>' : '<span class="warn">shows no clear link</span>';
      yh = `<div class="box"><b class="t">NATIONAL CEREAL YIELD (WORLD BANK / FAO) &middot; ${esc(Y.country || '')}</b>Across ${ss.length} seasons, years our replay calls dry vs the country's yield below its trend: r = <b>${r.toFixed(2)}</b>, which ${verdict}. Our 3 hardest years: ${hard.join(', ') || 'none'}; the country's 3 weakest yields: ${low.join(', ')}; overlap: ${both.length}.<br><span class="note">A national average of all cereals, so it can only be a rough cross-check of one field.</span></div>`;
    }
  }
  if (F && !F.error) fh =`<div class="box"><b class="t">FIRES NEAR YOU, LAST 24 HOURS (NASA FIRMS, MODIS)</b>${F.count ? `<span class="warn"><b>${F.count}</b> active-fire detections within ${F.radius_km} km; nearest ${F.nearest_km} km away.</span>` : `<span class="good">No active-fire detections within ${F.radius_km} km.</span>`} Data as of ${esc(F.as_of || '?')}.<br><span class="note">Live feed only. Past years of fire need a free NASA FIRMS key, which is not set up here.</span></div>`;
  const any = yh || fh; document.querySelector('.public').style.display = any ? '' : 'none';
  $('pubyield').innerHTML = any ? `<div class="grid2">${yh}${fh}</div>` : '';
  $('pubsrc').innerHTML = !any ? '' : 'Sources: <a href="https://power.larc.nasa.gov/">NASA POWER</a> (weather), <a href="https://soilgrids.org/">ISRIC SoilGrids</a> (soil), <a href="https://data.worldbank.org/indicator/AG.YLD.CREL.KG">World Bank cereal yield</a> (FAO data), <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a> (fires), Esri and <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> imagery. Soil water, crop cover and stress are model estimates, not measurements.';
}

// ---------- wiring ----------
function tick(t) {
  requestAnimationFrame(tick); const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  const s = S.seasons[S.sel]; if (!s || !S.playing) return;
  S.dayF = (S.dayF ?? S.day) + dt * 22 * +$('speed').value; if (S.dayF >= s.i1 - s.i0) S.dayF = 0; drawAll(Math.floor(S.dayF));
}
async function init() {
  try { regions = await (await fetch('data/regions.json')).json(); } catch { state('RUN: python server.py', 'err'); return; }
  $('crop').innerHTML = '<option value="auto">Crop: best suited here (automatic)</option>' + CROPS.filter(c => c.cash).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  S.cropAuto = true;
  stack = createStack($('stackview'), onLayerStatus); loadLegends();
  $('winkm').addEventListener('change', () => stack.setWindowKm(+$('winkm').value));
  mapApi = createMap($('map'), { onPick: (lat, lon) => selectLocation(lat, lon, 'Selected point', { keepView: true }), onFarm: f => pickFarm(f) });
  $('farmlist').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pickFarm(S.farms[+b.dataset.i]); });
  $('draw').addEventListener('click', () => { if (mapApi.isDrawing()) { mapApi.cancelDraw(); drawUI(); } else mapApi.startDraw(onDraw); });
  $('undo').addEventListener('click', () => mapApi.undoDraw());
  $('finish').addEventListener('click', () => { if (!mapApi.finishDraw()) $('drawnote').textContent = 'Add at least 3 corners first.'; });
  $('clearland').addEventListener('click', () => { S.outline = null; mapApi.setMarker(S.loc.lat, S.loc.lon); drawUI(); });
  $('basesel').addEventListener('click', e => { const b = e.target.closest('button[data-b]'); if (!b) return; document.querySelectorAll('#basesel button').forEach(x => x.classList.toggle('on', x === b)); mapApi.setBase(b.dataset.b); });
  $('sow').innerHTML = '<option value="0">Sowing month: not sure (automatic)</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">Sow in ${m}</option>`).join('');
  $('sow').addEventListener('change', () => { S.sowMonth = +$('sow').value; if (S.c) buildSeasons(); });
  $('crop').addEventListener('change', () => { const v = $('crop').value; S.cropAuto = v === 'auto'; if (!S.cropAuto) S.cropId = v; if (S.c) { if (S.cropAuto) compute(true); else buildSeasons(); } });
  $('tiles').addEventListener('click', e => { const t = e.target.closest('.tile'); if (t) { S.dayF = 0; selectYear(+t.dataset.i); } });
  $('match').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; try { localStorage.setItem(memKey(S.seasons[S.sel]), b.dataset.k); } catch {} renderYear(); renderTiles(); });
  $('play').addEventListener('click', () => { S.playing = !S.playing; $('play').textContent = S.playing ? 'Pause' : 'Play'; S.dayF = S.day; });
  $('day').addEventListener('input', () => { S.playing = false; $('play').textContent = 'Play'; S.dayF = +$('day').value; drawAll(+$('day').value); });
  const cvScrub = ev => { const s = S.seasons[S.sel]; if (!s) return; const cv = $('chart'), r = cv.getBoundingClientRect(), k = Math.round(((ev.clientX - r.left - 40) / (r.width - 78)) * (s.i1 - s.i0 - 1)); S.playing = false; $('play').textContent = 'Play'; S.dayF = k; drawAll(k); };
  $('chart').addEventListener('pointerdown', ev => { cvScrub(ev); const mv = e2 => cvScrub(e2), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
  $('placeform').addEventListener('submit', async e => {
    e.preventDefault(); const q = $('place').value.trim(); if (q.length < 2) return; const el = $('placeresults'); el.innerHTML = '<span class="note">Searching...</span>';
    try { const r = await fetchJSON(`/api/geocode?q=${encodeURIComponent(q)}`, 30000); el._r = r.results; el.innerHTML = r.results.length ? r.results.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name.split(',').slice(0, 3).join(','))}</button>`).join('') : '<span class="note">No match.</span>'; }
    catch (er) { el.innerHTML = `<span class="note">Search unavailable (${esc(er.message)}).</span>`; }
  });
  $('placeresults').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; const p = $('placeresults')._r[+b.dataset.i]; $('placeresults').innerHTML = ''; goToArea(p.lat, p.lon, p.name.split(',').slice(0, 2).join(',')); });
  addEventListener('resize', () => { mapApi.invalidate(); lastDraw = -1; drawAll(S.day); });
  requestAnimationFrame(tick);
  const q = new URLSearchParams(location.search), preset = regions[q.get('r')];
  if (preset) selectLocation(preset.lat, preset.lon, preset.name, { zoom: 12 }); // ?r=iowa etc. still opens a cached demo region directly
  else goToArea(43.8505, -79.0209, 'Ajax, Ontario');
}
init();
