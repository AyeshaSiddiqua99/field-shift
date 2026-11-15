import { CROPS, CROP, DEFAULT_P, YEAR0, prepClimate, evalCrops, rank, robustRank, modelCheck, trace, rotMod, planKey, soilFromLayers, waterNeed } from './engine.js';
import { createScene } from './scene.js';
import { createMap } from './map.js';

const $ = id => document.getElementById(id);
const T0 = Date.UTC(2005, 0, 1), WIN = 540;
const HEIGHT = { maize: 3.4, sorghum: 3.0, millet: 2.4, sunflower: 3.0, wheat: 1.6, soybean: 1.5, groundnut: 0.9, chickpea: 1.0, potato: 1.0, cover: 0.9 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// S holds everything known about the selected field; view holds the latest simulation
const S = { loc: null, raw: null, soil: null, soilModel: null, soilStatus: 'none', proj: null, projStatus: 'none', ndvi: null, farms: [] };
let regions = {}, view = null, scene = null, mapApi = null, running = false, dayF = 0, lastDay = -1, playing = true, lastT = 0, selYi = 0, timer = null, selToken = 0, rerun = false;
const rawCache = {};

// ---------- helpers ----------
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f0 = x => Math.round(x).toString();
const sgn = (x, d = 0) => (x >= 0 ? '+' : '') + x.toFixed(d);
const names = ids => ids.map(i => CROP[i].name);
const chain = ids => names(ids).join(' <span class="arrow">&rarr;</span> ');
const dateOf = idx => { const d = new Date(T0 + idx * 864e5); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const monthOfDoy = doy => MONTHS[new Date(Date.UTC(2001, 0, 1) + (((doy - 1) % 365) + 365) % 365 * 864e5).getUTCMonth()];
const argmin = a => a.indexOf(Math.min(...a)), argmax = a => a.indexOf(Math.max(...a));
const median = a => { const s = [...a].map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); return s[Math.floor(s.length / 2)][1]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setStatus(msg, cls) { $('status').textContent = msg; if (cls !== undefined) $('datapill').className = 'pill ' + cls; }

async function fetchJSON(url, ms = 60000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal }), j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'request failed');
    return j;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : e.message); } finally { clearTimeout(t); }
}

// ---------- data for the selected field ----------
const presetFor = (lat, lon) => Object.entries(regions).find(([, r]) => Math.abs(r.lat - lat) < 0.05 && Math.abs(r.lon - lon) < 0.05)?.[0];

async function getRaw(loc) {
  const id = presetFor(loc.lat, loc.lon), key = id || `${loc.lat},${loc.lon}`;
  if (rawCache[key]) return rawCache[key];
  const raw = id ? await (await fetch(`data/${id}.json`)).json() : await fetchJSON(`/api/power?lat=${loc.lat}&lon=${loc.lon}`, 120000);
  raw.name = loc.name; return (rawCache[key] = raw);
}

async function selectLocation(lat, lon, name, opt = {}) {
  const token = ++selToken; document.body.classList.remove('empty');
  S.loc = { lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), name };
  mapApi.setMarker(S.loc.lat, S.loc.lon, opt.poly);
  if (!opt.keepView) mapApi.setView(S.loc.lat, S.loc.lon, opt.zoom || 12);
  $('locline').textContent = `${name} (${S.loc.lat.toFixed(3)}, ${S.loc.lon.toFixed(3)})`;
  Object.assign(S, { soil: null, soilModel: null, soilStatus: 'loading', proj: null, projStatus: 'loading', ndvi: null });
  renderSoil(); renderProj(); $('satcheck').innerHTML = '';
  setStatus('Loading NASA weather for this field...', '');
  $('datapill').textContent = 'Loading data...';

  // slow, optional services start in parallel and update the app when they arrive
  const loc = S.loc, q = `lat=${loc.lat}&lon=${loc.lon}`;
  const soilP = fetchJSON(`/api/soil?${q}`, 240000), slopeP = fetchJSON(`/api/slope?${q}`, 30000);
  fetchJSON(`/api/climate?${q}`, 300000).then(p => { if (token === selToken) { S.proj = p; S.projStatus = 'ok'; renderProj(); applyHorizon(); } })
    .catch(e => { if (token === selToken) { S.projStatus = 'error:' + e.message; renderProj(); } });
  S.ndviErr = null;
  fetchJSON(`/api/ndvi?${q}`, 300000).then(n => { if (token === selToken) { S.ndvi = n; renderSat(); } })
    .catch(e => { if (token === selToken) { S.ndviErr = e.message; renderSat(); } });
  slopeP.then(s => { if (token === selToken) { $('slope').value = Math.max(0, Math.min(25, Math.round(s.slope))); $('o-slope').textContent = $('slope').value; $('slopesrc').textContent = `(terrain model: ${s.slope}%, elevation ${f0(s.elev)} m)`; } }).catch(() => {});

  try { S.raw = await getRaw(loc); } catch (e) { setStatus('Could not load NASA weather: ' + e.message, 'err'); $('datapill').textContent = 'Data error'; return; }
  if (token !== selToken) return;
  // cached soil comes back instantly; otherwise do not make the user wait for the slow service
  const early = await Promise.race([soilP.then(s => s).catch(() => null), sleep(2500).then(() => 'late')]);
  if (early && early !== 'late') setSoil(early);
  await run();
  soilP.then(s => { if (token !== selToken) return; if (!S.soil) { setSoil(s); schedule(); } }).catch(e => { if (token === selToken) { S.soilStatus = 'error:' + e.message; renderSoil(); } });
}

function setSoil(s) {
  S.soil = s; S.soilModel = soilFromLayers(s.layers); S.soilStatus = S.soilModel ? 'ok' : 'empty'; renderSoil();
}

// ---------- soil card ----------
function renderSoil() {
  const el = $('soilcard'), m = S.soilModel;
  if (S.soilStatus === 'loading') { el.innerHTML = '<p class="hint">Reading soil from the global soil database (ISRIC SoilGrids). This can take up to a minute on a new location; results update automatically.</p>'; return; }
  if (!m) {
    el.innerHTML = `<p class="hint">${S.soilStatus === 'empty' ? 'The soil database has no data at this point (water, city or rock).' : 'Soil database unavailable right now (' + esc(S.soilStatus.replace('error:', '')) + ').'} Using the soil class set by hand below.</p>`;
    return;
  }
  const notes = [];
  if (m.ph != null && m.ph < 5.5) notes.push(`Acidic (pH ${f1(m.ph)}): limits several crops; lime may help.`);
  if (m.ph != null && m.ph > 8) notes.push(`Alkaline (pH ${f1(m.ph)}): can lock up some nutrients.`);
  if (m.soc < 10) notes.push('Low organic carbon: favour residue-rich crops and cover crops.');
  if (m.awc < 110) notes.push('Holds little water: drought hits early.');
  if (m.clay > 45) notes.push('Heavy clay: runoff and waterlogging risk when wet.');
  if (m.sand > 70) notes.push('Very sandy: drains fast and loses nutrients.');
  el.innerHTML = `<div class="tex">${m.texture} <small>&middot; hydrologic group ${m.hsg}</small></div>
    <div class="stack" title="sand / silt / clay"><i style="width:${m.sand}%;background:#d9b25a"></i><i style="width:${m.silt}%;background:#8aa4d6"></i><i style="width:${m.clay}%;background:#b0603a"></i></div>
    <div class="soilgrid"><span>Sand / silt / clay</span><span>${f0(m.sand)} / ${f0(m.silt)} / ${f0(m.clay)} %</span>
    <span>Organic carbon</span><span>${f1(m.soc)} g/kg</span><span>pH</span><span>${m.ph != null ? f1(m.ph) : 'n/a'}</span>
    <span>Nitrogen</span><span>${f2(m.n)} g/kg</span><span>Water the soil can hold for plants</span><span>${f0(m.awc)} mm per m of soil</span>
    <span>Erodibility (K)</span><span>${f2(m.K)}</span></div>
    ${notes.length ? '<ul>' + notes.map(n => `<li>${n}</li>`).join('') + '</ul>' : ''}
    <p class="hint">ISRIC SoilGrids, 250 m, top 30 cm average; water holding from the Saxton and Rawls equations over 0 to 100 cm.</p>`;
}

// ---------- future climate ----------
function renderProj() {
  const el = $('projinfo'), st = S.projStatus, p = S.proj;
  if (st === 'loading') { el.textContent = 'Loading projections for this location (CMIP6 models; can take up to a minute)...'; return; }
  if (!p) { el.textContent = st.startsWith('error') ? `Projections unavailable (${st.slice(6)}). Use "My own settings".` : 'Select a field to load projections.'; return; }
  const h = p.horizons, r = x => `${sgn(x[0], 1)} to ${sgn(x[1], 1)}`, pc = x => sgn(Math.round(100 * x) || 0, 0);
  el.innerHTML = Object.entries(h).map(([k, v]) => `<b>${k}:</b> ${sgn(v.dT, 1)} C (${r(v.dT_range)}), rain ${pc(v.dP)}% (${pc(v.dP_range[0])} to ${pc(v.dP_range[1])}), downpours ${pc(v.ext)}%`).join('<br>') +
    `<br>vs 2005-2024; mean and range of ${p.models.length} climate models. High-emission pathway; not a NASA product.`;
}
function applyHorizon() {
  const v = $('horizon').value;
  if (v === 'custom') return;
  const set = (dT, dP, ext) => { $('dT').value = dT; $('dP').value = dP; $('ext').value = ext; for (const id of ['dT', 'dP', 'ext']) $('o-' + id).textContent = $(id).value; };
  if (v === 'today') set(0, 0, 0);
  else if (S.proj?.horizons[v]) { const h = S.proj.horizons[v]; set(Math.max(0, h.dT).toFixed(1), Math.round(100 * h.dP), Math.round(100 * h.ext)); }
  else return;
  schedule();
}
const toCustom = () => { $('horizon').value = 'custom'; };

// ---------- farm outlines ----------
let farmToken = 0;
async function findFarms(center) {
  const c = center || mapApi.center(), el = $('farmlist'), btn = $('findfarms'), tk = ++farmToken;
  if (!center && c.zoom < 11) { el.innerHTML = '<span>Zoom in to your area first (the farm search covers about 4 km around the centre).</span>'; return; }
  btn.disabled = true; el.innerHTML = '<span>Searching OpenStreetMap for farmland around here (up to a minute)...</span>';
  try {
    const r = await fetchJSON(`/api/farms?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, 120000);
    if (tk !== farmToken) return;
    S.farms = r.farms; mapApi.showFarms(S.farms);
    if (!S.farms.length) { el.innerHTML = '<span>No farmland outlines are mapped here in OpenStreetMap. Click the map to place your field.</span>'; return; }
    if (center) mapApi.fitFarms(S.farms.slice(0, 12));
    el.innerHTML = `<span class="fl-title">${S.farms.length} mapped farmland areas nearby. Pick one (or click its outline):</span>` + S.farms.slice(0, 14).map((f, i) =>
      `<button type="button" class="ghost" data-i="${i}">${esc(f.name || (f.kind === 'orchard' ? 'Orchard' : f.kind === 'vineyard' ? 'Vineyard' : 'Farmland'))} &middot; ${f.ha} ha &middot; ${f.d < 1000 ? f.d + ' m' : (f.d / 1000).toFixed(1) + ' km'} away</button>`).join('') +
      '<span class="fl-note">Outlines are mapped by OpenStreetMap volunteers. They show farmland areas, not who owns them, and this is not a list of farms for sale.</span>';
  } catch (e) { if (tk === farmToken) el.innerHTML = `<span>Farm search unavailable (${esc(e.message)}). Click the map to place your field.</span>`; } finally { if (tk === farmToken) btn.disabled = false; }
}
const pickFarm = f => selectLocation(f.lat, f.lon, `${f.name || 'Farm outline'}, ${f.ha} ha`, { poly: f.poly, keepView: true });

// searching a place (or using your location) goes to that area and lists the farms near it; the simulation runs once you pick one
function goToArea(lat, lon, name) {
  ++selToken; mapApi.clearFarms(); mapApi.setMarker(lat, lon); mapApi.setView(lat, lon, 13); S.loc = null;
  document.body.classList.add('empty'); $('locline').textContent = `Area: ${name}. Pick a farm below, or click the map.`;
  setStatus('Pick a farm to simulate.', ''); $('datapill').textContent = 'Pick a farm';
  findFarms({ lat, lon, zoom: 13 });
}

// ---------- inputs ----------
function readInputs() {
  const mode = $('soilmode').value, auto = mode === 'auto' && S.soilModel;
  const first = $('c1').value, rest = [$('c2').value, $('c3').value].filter(v => v !== 'none');
  return {
    farm: { soil: mode === 'auto' ? 'loam' : mode, sp: auto ? S.soilModel : undefined, slope: +$('slope').value, irrig: +$('irrig').value },
    W: { income: +$('w-income').value, stability: +$('w-stab').value, water: +$('w-water').value, soil: +$('w-soil').value },
    scen: { dT: +$('dT').value, dP: +$('dP').value / 100, ext: +$('ext').value / 100 },
    current: first === '__best' ? ['__best'] : [first, ...rest],
    usingSoilDb: !!auto,
  };
}

// ---------- run ----------
async function run() {
  if (running) { rerun = true; return; }
  if (!S.loc || !S.raw) return;
  running = true; $('run').disabled = true;
  try {
    setStatus('Simulating every past season of real weather for every crop and rotation...'); await sleep(30);
    const inp = readInputs(), raw = S.raw, t0 = performance.now(), zero = inp.scen.dT === 0 && inp.scen.dP === 0 && inp.scen.ext === 0;
    const c = prepClimate(raw, inp.scen), table = evalCrops(c, inp.farm);
    // "not sure": compare against the single most valuable well-suited crop (what you'd plant without rotating)
    let current = inp.current, fresh = false;
    if (current[0] === '__best') { fresh = true; current = [CROPS.filter(x => x.cash && !table[x.id].noWindow).sort((a, b) => b.value * table[b.id].meanRel - a.value * table[a.id].meanRel)[0].id]; }
    const ranking = rank(table, inp.W, current);
    const robust = robustRank(raw, inp.scen, inp.farm, inp.W, current, ranking, 8);
    let todayBest = robust.order[0];
    if (!zero) {
      const z = { dT: 0, dP: 0, ext: 0 }, ct = prepClimate(raw, z), rt = rank(evalCrops(ct, inp.farm), inp.W, current);
      todayBest = robustRank(raw, z, inp.farm, inp.W, current, rt, 8).order[0];
    }
    const byKey = Object.fromEntries(ranking.all.map(r => [planKey(r), r]));
    const recs = robust.order.slice(0, 3).map(k => ({ ...byKey[k], stat: robust.stat[k] }));
    const check = modelCheck(prepClimate(raw), inp.farm);
    const need = waterNeed(c, table, inp.farm, [...recs[0].ids, ...current]);
    view = { inp, raw, c, table, current, fresh, cur: ranking.current, recs, robust, todayBest, check, zero, need };
    renderResults(); setupScene(); drawChart(); renderSat();
    setStatus(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s. ${ranking.all.length} rotations compared.${inp.usingSoilDb ? '' : S.soilStatus === 'loading' && $('soilmode').value === 'auto' ? ' Using loam until the soil database answers; results will update.' : ' (Soil set by hand.)'}`, 'ok');
    $('datapill').textContent = `NASA POWER | ${esc(S.loc.name).slice(0, 40)} | 2005 to now`;
  } catch (e) {
    console.error(e); setStatus('Error: ' + e.message, 'err'); $('datapill').textContent = 'Error';
  } finally { running = false; $('run').disabled = false; if (rerun) { rerun = false; schedule(); } }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 450); };

// ---------- results ----------
function verdict(top3, runs) { const r = top3 / runs; return r >= 0.75 ? ['win', 'Holds up'] : r >= 0.5 ? ['mid', 'Fairly stable'] : ['low', 'Close call']; }

function renderResults() {
  const { recs, cur, inp, c, check, robust, todayBest, zero, table, current, fresh } = view, best = recs[0];
  const goals = [['income', 'Income'], ['stability', 'Bad years'], ['water', 'Water'], ['soil', 'Soil health']];
  const baseName = fresh ? `the best single crop here (${CROP[current[0]].name})` : 'your current plan';

  $('reco').innerHTML = recs.map((r, i) => {
    const [cls, txt] = verdict(r.stat.top3, robust.runs);
    const bars = goals.map(([g, l]) => `<div class="bar"><span>${l}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(100 * r.parts[g])}%"></span></span><span>${Math.round(100 * r.parts[g])}</span></div>`).join('');
    const legume = r.ids.some(id => CROP[id].family === 'legume'), curLegume = current.some(id => CROP[id].family === 'legume');
    const why = i === 0 ? `<ul>
      <li>Income index ${f2(r.mean)} vs ${f2(cur.mean)} for ${fresh ? 'the best single crop' : 'now'} (${cur.mean > 0 ? sgn(100 * (r.mean - cur.mean) / cur.mean) + '%' : 'n/a'})</li>
      <li>Worst-10% year ${f2(r.p10)} vs ${f2(cur.p10)}; erosion risk ${f0(r.eros)} vs ${f0(cur.eros)}</li>
      <li>Soil health index ${f0(r.soil)} vs ${f0(cur.soil)}</li>
      ${legume && !curLegume ? '<li>Adds a nitrogen-fixing legume (assumed +' + Math.round(100 * DEFAULT_P.legume) + '% to the next crop)</li>' : ''}
      ${r.ids.length > 1 ? `<li>Spreads weather risk over ${r.ids.length} crops; ${r.ids.length}-year cycle</li>` : ''}</ul>` : '';
    return `<div class="rcard ${i === 0 ? 'best' : ''}"><div class="name">${i + 1}. ${chain(r.ids)} <span class="tag ${cls}" title="Across runs with assumptions varied: how often this plan was #1 and in the top 3">${txt}: #1 in ${r.stat.wins}, top 3 in ${r.stat.top3} of ${robust.runs} runs</span></div>${why}<div class="bars">${bars}</div></div>`;
  }).join('');

  // season-by-season calendar for the best plan
  const k = best.ids.length;
  const role = (cr, pred) => cr.id === 'cover' ? 'Soil builder: fixes nitrogen, covers the soil' : cr.family === 'legume' ? 'Fixes nitrogen for the next crop' : pred.family === 'legume' ? 'Uses nitrogen left by the legume' : cr.residue >= 0.8 ? 'Leaves plenty of residue' : '';
  $('plan').innerHTML = `<table class="vs plan"><tr><th>Year</th><th>Crop</th><th>Sow &rarr; harvest</th><th>Yield*</th></tr>` + best.ids.map((id, j) => {
    const cr = CROP[id], pred = CROP[best.ids[(j + k - 1) % k]], t = table[id], att = cr.cash ? t.rows.reduce((s, r) => s + Math.min(1, r.rel * rotMod(cr, pred, DEFAULT_P)), 0) / t.rows.length : null;
    return `<tr><td>${j + 1}</td><td>${cr.name}<br><span class="hint">${role(cr, pred)}</span></td><td>${monthOfDoy(t.doy)} &rarr; ${monthOfDoy(t.doy + cr.days)}</td><td>${att == null ? '&ndash;' : Math.round(100 * att) + '%'}</td></tr>`;
  }).join('') + `</table><p class="hint">After year ${k}, start again at year 1 (each field in the farm is one year ahead of the next). *Average share of attainable yield. Sowing months are model-chosen from temperature and water; check your local calendar.</p>`;

  const hardest = argmin(cur.farmY), yr = YEAR0 + hardest;
  const row = (label, a, b, fmt, higherBetter) => {
    const d = b - a, good = higherBetter ? d > 0 : d < 0, cls = Math.abs(d) < 1e-9 ? '' : good ? 'up' : 'down';
    return `<tr><td>${label}</td><td>${fmt(a)}</td><td>${fmt(b)}</td><td class="${cls}">${sgn(d, fmt === f0 ? 0 : 2)}</td></tr>`;
  };
  $('vs').innerHTML = `<table class="vs"><tr><th></th><th>${fresh ? 'Best single crop' : 'Now'}</th><th>Suggested</th><th>Change</th></tr>
    ${row('Income index (avg)', cur.mean, best.mean, f2, true)}
    ${row('Worst-10% year', cur.p10, best.p10, f2, true)}
    ${row(`Bad years (of ${cur.farmY.length})`, cur.fail * cur.farmY.length, best.fail * best.farmY.length, f0, false)}
    ${row('Income per 100 mm water', cur.effic, best.effic, f2, true)}
    ${row('Irrigation used (mm/yr)', cur.irr, best.irr, f0, false)}
    ${row('Erosion risk (0-100)', cur.eros, best.eros, f0, false)}
    ${row('Soil health index (0-100)', cur.soil, best.soil, f0, true)}</table>
    <div class="note">In ${yr}, the hardest year for ${baseName}, income was <b>${f2(cur.farmY[hardest])}</b> vs <b>${f2(best.farmY[hardest])}</b> with the suggested rotation (index: maize at full yield = 1.0).</div>`;

  const tb = todayBest ? todayBest.split('>') : null;
  $('shift').innerHTML = zero ? '' : `<div class="note">${planKey(best) === todayBest
    ? `Even with your climate settings, the best plan is unchanged: ${chain(best.ids)}.`
    : `<b>The best plan shifts.</b> Today's climate: ${chain(tb)}. Your climate settings: ${chain(best.ids)}.`}</div>`;

  // crops suited to this site
  const suited = CROPS.filter(x => x.cash && !table[x.id].noWindow).map(x => ({ x, t: table[x.id] })).sort((a, b) => b.x.value * b.t.meanRel - a.x.value * a.t.meanRel);
  const good = suited.filter(s => s.t.meanRel >= 0.5), poor = CROPS.filter(x => x.cash && (table[x.id].noWindow || table[x.id].meanRel < 0.5));
  $('suited').innerHTML = `<div class="chips">${good.slice(0, 7).map(({ x, t }) => `<span class="chip" title="Average share of attainable yield, sown in ${monthOfDoy(t.doy)}">${x.name} <b>${Math.round(100 * t.meanRel)}%</b> <small>sow ${monthOfDoy(t.doy)}${t.rows[0].phPen < 0.95 ? ' &middot; soil pH limits' : ''}</small></span>`).join('') || '<span class="hint">No crop reaches 50% of attainable yield here under these settings.</span>'}</div>
    ${poor.length ? `<p class="hint">Poorly suited: ${poor.map(x => x.name).join(', ')}.</p>` : ''}<p class="hint">Percent = share of the crop's attainable yield (climate, water, heat, frost and soil pH combined, before rotation effects). Listed by that share times the rough crop-value index.</p>`;

  // water
  const m = S.soilModel && inp.usingSoilDb ? S.soilModel.awc : (inp.farm.soil === 'sand' ? 85 : inp.farm.soil === 'clay' ? 150 : 170);
  const ids = [...new Set([...best.ids, ...current])], nd = Object.fromEntries(view.need.map(n => [n.id, n]));
  const sugNeed = best.ids.filter(id => CROP[id].cash).map(id => nd[id]?.p90 ?? 0), supply = inp.farm.irrig, avgDry = sugNeed.length ? sugNeed.reduce((a, b) => a + b, 0) / sugNeed.length : 0;
  $('waterres').innerHTML = `<p class="hint">The soil can hold about <b>${f0(m)} mm per metre</b> of plant-available water (roughly ${f0(m * 1.2)} mm over a typical root zone). Rain fills it; crops draw it down.</p>
    <table class="vs"><tr><th>Crop</th><th>Needs (avg yr)</th><th>Needs (dry yr)</th></tr>${ids.filter(id => nd[id] && CROP[id].cash).map(id => `<tr><td>${CROP[id].name}${best.ids.includes(id) ? '' : ' <span class="hint">(now)</span>'}</td><td>${f0(nd[id].mean)} mm</td><td>${f0(nd[id].p90)} mm</td></tr>`).join('')}</table>
    <div class="note">Irrigation you chose: <b>${f0(supply)} mm per season</b>. ${avgDry <= 5 ? 'The suggested crops rarely need extra water in this climate.' : supply >= avgDry ? 'That covers the dry-year need of the suggested crops.' : `That covers about ${Math.round(100 * supply / avgDry)}% of the dry-year need (${f0(avgDry)} mm) of the suggested crops.`}</div>
    <p class="hint">"Needs" = extra water the simulation had to add to keep each crop out of water stress. It is what to compare with your real water source.</p>`;

  const [vc, vt] = verdict(best.stat.top3, robust.runs), r = check.r;
  const rc = r >= 0.7 ? 'Good agreement' : r >= 0.5 ? 'Moderate agreement' : 'Weak agreement', s = c.stats, tr = s.trendPerDecade;
  $('trust').innerHTML = `<div class="trust">
    <div class="t"><b>Does the pick hold up? ${vt}.</b>The suggested plan was #1 in ${best.stat.wins} and in the top 3 in ${best.stat.top3} of ${robust.runs} runs, when crop coefficients, soil water capacity, heat limits, rotation effects and crop prices were randomly varied (about 10-30%). ${vc === 'low' ? 'Treat the top few plans as roughly equal.' : 'Close runner-up plans can swap places, so look at all three.'}</div>
    <div class="t"><b>Model check: ${rc} (r = ${Number.isNaN(r) ? 'n/a' : r.toFixed(2)})</b>Simulated root-zone wetness vs NASA POWER's MERRA-2 soil wetness, month-to-month anomalies, ${check.months} months. A consistency check, not independent validation: both use the same rainfall, and neither is measured yield.</div>
    <div class="t"><b>Your location in NASA data</b>Mean temperature ${f1(s.meanT)} C, rain ${f0(s.meanP)} mm/yr. Trend over 2005-2024: ${sgn(tr, 2)} C per decade (a short, noisy record, not a projection).${zero ? '' : ` With your climate settings: ${f1(s.scenT)} C, ${f0(s.scenP)} mm/yr.`}</div></div>`;

  $('assumebody').innerHTML = `<ul>
    <li><b>Yield index, not tonnes.</b> It is the fraction of each crop's attainable yield left after water, heat, frost and soil-pH stress, times a rough crop-value index (maize = 1). No market prices are used; the value index is randomised in the robustness test.</li>
    <li><b>Water:</b> daily single-layer soil-water balance (FAO-56 style), Hargreaves evapotranspiration from NASA solar radiation, SCS runoff. Crop coefficients and sensitivities are approximate FAO defaults.</li>
    <li><b>Soil:</b> texture, organic carbon and pH from SoilGrids (a modelled global map, 250 m, uncertain at field scale); water holding from the Saxton and Rawls equations; erodibility is an approximation. Crops lose 12% of yield per 0.5 pH unit outside their optimum band.</li>
    <li><b>Irrigation need</b> is the water the simulation added to avoid stress. Your actual water source, rights and cost are not known to any dataset; you set the amount.</li>
    <li><b>Rotation effects are rules of thumb:</b> legume before another crop +${Math.round(100 * DEFAULT_P.legume)}%, same crop twice in a row -${Math.round(100 * DEFAULT_P.mono)}%, same family -4%. Pests, disease, nitrogen and the water a cover crop leaves behind are not simulated.</li>
    <li><b>Soil health index is a proxy</b> built from erosion risk, bare-ground time, crop residue returned, a legume in the cycle and crop-family diversity. It is not measured organic matter, structure or nutrients.</li>
    <li><b>Wet-climate losses are a crude proxy:</b> chickpea, sunflower, groundnut and millet lose yield when in-season rain passes a threshold (a stand-in for disease and waterlogging).</li>
    <li><b>Planting dates are model-chosen</b> from temperature and water only. Check your local calendar. Both the current plan and the suggestion get optimised dates, so gains come from the rotation, not the date.</li>
    <li><b>Future climate:</b> shifts the 2005-2024 record by the change projected by CMIP6 HighResMIP models (via Open-Meteo, not NASA; single high-emission pathway; model spread shown). Manual sliders are a what-if, not a forecast.</li>
    <li><b>Resolution:</b> NASA POWER cells are about 50 km wide; field-scale variation is not resolved. Slope comes from a 90 m elevation model. Farm outlines are OpenStreetMap volunteer data and are often whole farmland areas, not single fields.</li>
    <li><b>Not validated against farm yields.</b> Use it to compare options and see trade-offs, then check with a local agronomist.</li></ul>`;
}

// ---------- satellite check (NASA MODIS NDVI) ----------
function renderSat() {
  const el = $('satcheck');
  if (!S.ndvi) {
    el.innerHTML = !S.loc || !view ? '' : S.ndviErr
      ? `<div class="trust"><div class="t"><b>Satellite check unavailable</b>The NASA MODIS vegetation service (ORNL DAAC) did not answer (${esc(S.ndviErr)}). It is often slow or down; the rest of the results do not depend on it.</div></div>`
      : '<div class="trust"><div class="t"><b>Satellite check</b>Loading NASA MODIS vegetation data for this point (a slow service; it will appear here)...</div></div>';
    return;
  }
  if (!view) return;
  const sums = Array(12).fill(0), cnt = Array(12).fill(0);
  for (const [d, v] of S.ndvi.series) if (v != null) { const m = +d.slice(5, 7) - 1; sums[m] += v; cnt[m]++; }
  const mm = sums.map((s, i) => cnt[i] ? s / cnt[i] : null), vals = mm.filter(v => v != null);
  if (vals.length < 8) { el.innerHTML = ''; return; }
  const lo = Math.min(...vals), hi = Math.max(...vals), thr = lo + 0.5 * (hi - lo), green = mm.map(v => v != null && v > thr);
  const cropMonths = id => { const t = view.table[id], o = new Set(); for (let d = 0; d < CROP[id].days; d += 5) o.add(new Date(Date.UTC(2001, 0, 1) + (t.doy - 1 + d) % 365 * 864e5).getUTCMonth()); return [...o]; };
  const sug = view.recs[0].ids.filter(id => !view.table[id].noWindow), inGreen = sug.map(id => { const m = cropMonths(id); return m.filter(x => green[x]).length / m.length; });
  const overlap = inGreen.length ? inGreen.reduce((a, b) => a + b, 0) / inGreen.length : 0;
  const bars = mm.map((v, i) => `<div style="flex:1;text-align:center"><div style="height:${Math.round(60 * (v ?? 0) / Math.max(0.01, hi))}px;background:${green[i] ? 'var(--good)' : 'var(--line)'};border-radius:3px 3px 0 0;margin:0 1px"></div><small>${MONTHS[i][0]}</small></div>`).join('');
  const greenList = MONTHS.filter((_, i) => green[i]).join(', ') || 'none';
  el.innerHTML = `<div class="trust"><div class="t"><b>Satellite check: ${overlap >= 0.6 ? 'consistent' : 'differs'}</b>
    NASA MODIS sees green vegetation here in <b>${greenList}</b> (monthly mean NDVI, 2019-2023). The suggested crops' seasons overlap that window ${Math.round(100 * overlap)}%. ${overlap >= 0.6 ? '' : 'Local farmers may rely on irrigation or a different season; check before trusting the sowing months.'}
    <div style="display:flex;align-items:flex-end;height:78px;margin-top:6px">${bars}</div>
    <span class="hint">One 250 m pixel at the point, which mixes everything inside it (not only crops). A plausibility check, not proof.</span></div></div>`;
}

// ---------- 3D scene ----------
function setupScene() {
  const { cur, recs, c, current } = view, best = recs[0];
  const specials = [['Hardest year for the current plan', argmin(cur.farmY)], ['Typical year', median(cur.farmY)], ['Best year', argmax(cur.farmY)]];
  $('yearsel').innerHTML = specials.map(([l, yi]) => `<option value="${yi}">${l} (${YEAR0 + yi})</option>`).join('') + '<option disabled>-----</option>' + c.yStarts.map((_, yi) => `<option value="${yi}">${YEAR0 + yi}</option>`).join('');
  selYi = specials[0][1]; $('yearsel').value = String(selYi);
  $('title-cur').textContent = (view.fresh ? 'Best single crop: ' : 'Now: ') + names(current).join(' > ');
  $('title-sug').textContent = 'Suggested: ' + names(best.ids).join(' > ');
  buildYear();
}

function buildYear() {
  const { c, table, inp, recs, current } = view, yi = selYi, W0 = c.yStarts[yi];
  const mk = ids => {
    const k = ids.length;
    return { strips: ids.map((_, j) => {
      const p = (j + yi) % k, id = ids[p], pred = CROP[ids[(p + k - 1) % k]], cr = CROP[id], t = table[id];
      const plantIdx = t.noWindow ? W0 + WIN + 10 : W0 + t.doy - 1;
      const tr = trace(c, cr, inp.farm, plantIdx, DEFAULT_P, W0, W0 + WIN), a = t.noWindow ? 0 : Math.min(1, t.rows[yi].rel * rotMod(cr, pred, DEFAULT_P));
      return { name: cr.name, color: cr.color, height: HEIGHT[id] || 1.5, trace: tr, noWindow: !!t.noWindow, yieldText: cr.cash ? `yield ${Math.round(100 * a)}%` : 'soil builder' };
    }) };
  };
  view.plans = [mk(current), mk(recs[0].ids)];
  scene.setPlans(view.plans, inp.farm.slope); dayF = 0; lastDay = -1; frameAt(0);
}

function frameAt(d) {
  if (!view) return; const { c } = view, i = c.yStarts[selYi] + d;
  scene.setFrame(d, { rain: c.prec[i], tmax: c.tmax[i], tmin: c.tmin[i], rad: c.rad[i] });
  const moist = pl => Math.round(100 * pl.strips.reduce((s, x) => s + x.trace.moist[d], 0) / pl.strips.length);
  $('hud').innerHTML = `<span><b>${dateOf(i)}</b></span><span>High ${f0(c.tmax[i])} C</span><span>Rain ${f1(c.prec[i])} mm</span><span>Soil water now ${moist(view.plans[0])}% | suggested ${moist(view.plans[1])}%</span>`;
  $('day').value = d;
}

function tick(t) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (!view || !playing) return;
  dayF += dt * 28 * +$('speed').value; if (dayF >= WIN) dayF = 0;
  const d = Math.floor(dayF); if (d !== lastDay) { lastDay = d; frameAt(d); }
}

// ---------- chart ----------
function drawChart() {
  const { cur, recs } = view, best = recs[0], cv = $('chart'), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = 170;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
  const L = 36, R = 8, T = 10, B = 22, n = cur.farmY.length, ymax = Math.max(0.1, ...cur.farmY, ...best.farmY) * 1.1;
  const X = i => L + (w - L - R) * i / (n - 1), Y = v => T + (h - T - B) * (1 - v / ymax);
  g.font = '11px system-ui'; g.strokeStyle = col('--line'); g.fillStyle = col('--muted'); g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); g.fillText(v.toFixed(2), 2, Y(v) + 4); }
  for (let i = 0; i < n; i += 3) g.fillText(String(YEAR0 + i), X(i) - 12, h - 6);
  const line = (arr, color, dash) => { g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dash); g.beginPath(); arr.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke(); g.setLineDash([]); };
  line(cur.farmY, col('--cur'), [5, 4]); line(best.farmY, col('--sug'), []);
  const sx = X(selYi); g.strokeStyle = col('--accent'); g.lineWidth = 1; g.beginPath(); g.moveTo(sx, T); g.lineTo(sx, h - B); g.stroke();
  g.fillStyle = col('--cur'); g.fillText(view.fresh ? '--- best single crop' : '--- your current plan', L + 8, T + 10); g.fillStyle = col('--sug'); g.fillText('--- suggested rotation', L + 150, T + 10);
  $('chartnote').textContent = 'Each point is one real year of NASA weather replayed with your climate settings. The orange line is the year shown in the 3D view.';
}

// ---------- wiring ----------
function bindOutputs() {
  for (const id of ['slope', 'irrig', 'w-income', 'w-stab', 'w-water', 'w-soil', 'dT', 'dP', 'ext']) {
    const el = $(id), out = $('o-' + id), upd = () => { out.textContent = el.value; };
    el.addEventListener('input', () => {
      upd();
      if (id === 'irrig') $('wsource').value = ['0', '100', '250', '500'].includes(el.value) ? el.value : 'custom';
      if (id === 'slope') $('slopesrc').textContent = '(set by hand)';
      if (['dT', 'dP', 'ext'].includes(id)) toCustom();
      schedule();
    });
    upd();
  }
}

async function doSearch(q) {
  const el = $('placeresults'); el.innerHTML = '<span class="hint">Searching...</span>';
  try {
    const r = await fetchJSON(`/api/geocode?q=${encodeURIComponent(q)}`, 30000);
    el.innerHTML = r.results.length ? r.results.map((p, i) => `<button type="button" class="ghost" data-i="${i}">${esc(p.name.split(',').slice(0, 3).join(','))}</button>`).join('') : '<span class="hint">No match. Try a nearby town.</span>';
    el._r = r.results;
  } catch (e) { el.innerHTML = `<span class="hint">Search unavailable (${esc(e.message)}). Click the map instead.</span>`; }
}

async function init() {
  try { regions = await (await fetch('data/regions.json')).json(); }
  catch { setStatus('Could not load data/regions.json. Start the app with: python server.py', 'err'); $('datapill').textContent = 'No data'; return; }
  const cropOpts = CROPS.filter(c => c.cash).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  $('c1').innerHTML = '<option value="__best">Not sure (use best single crop)</option>' + cropOpts;
  $('c2').innerHTML = '<option value="none">(none)</option>' + cropOpts; $('c3').innerHTML = '<option value="none">(none)</option>' + cropOpts;
  bindOutputs();

  mapApi = createMap($('map'), { onPick: (lat, lon) => selectLocation(lat, lon, 'Selected point', { keepView: true }), onFarm: pickFarm });
  document.querySelectorAll('#basesel button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#basesel button').forEach(x => x.classList.toggle('on', x === b)); mapApi.setBase(b.dataset.b); }));
  $('findfarms').addEventListener('click', findFarms);
  $('farmlist').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pickFarm(S.farms[+b.dataset.i]); });
  $('placeform').addEventListener('submit', e => { e.preventDefault(); const q = $('place').value.trim(); if (q.length > 1) doSearch(q); });
  $('placeresults').addEventListener('click', async e => {
    const b = e.target.closest('button[data-i]'); if (!b) return; const p = $('placeresults')._r[+b.dataset.i];
    $('placeresults').innerHTML = ''; goToArea(p.lat, p.lon, p.name.split(',').slice(0, 2).join(','));
  });
  $('geoloc').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(
    p => goToArea(p.coords.latitude, p.coords.longitude, 'My location'),
    () => setStatus('Location permission denied or unavailable. Search for a place instead.')));

  $('wsource').addEventListener('change', () => { const v = $('wsource').value; if (v !== 'custom') { $('irrig').value = v; $('o-irrig').textContent = v; schedule(); } });
  $('horizon').addEventListener('change', () => { if ($('horizon').value !== 'custom' && !S.proj && $('horizon').value !== 'today') { setStatus('Projections are still loading; they will apply when ready.'); } applyHorizon(); });
  for (const id of ['soilmode', 'c1', 'c2', 'c3']) $(id).addEventListener('change', schedule);
  $('run').addEventListener('click', run);
  document.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', () => {
    const [t, p, e] = b.dataset.p.split(',').map(Number); $('dT').value = t; $('dP').value = p; $('ext').value = e; toCustom();
    for (const id of ['dT', 'dP', 'ext']) $('o-' + id).textContent = $(id).value; run();
  }));
  $('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; });
  $('day').addEventListener('input', () => { playing = false; $('play').textContent = 'Play'; dayF = +$('day').value; lastDay = Math.floor(dayF); frameAt(lastDay); });
  $('yearsel').addEventListener('change', () => { selYi = +$('yearsel').value; buildYear(); drawChart(); });
  $('print').addEventListener('click', () => window.print());
  addEventListener('resize', () => { mapApi.invalidate(); if (view) drawChart(); });

  scene = createScene($('canvaswrap'), $('labels'));
  requestAnimationFrame(tick);
  const r = regions.iowa; await selectLocation(r.lat, r.lon, r.name, { zoom: 11 });
}
init();
