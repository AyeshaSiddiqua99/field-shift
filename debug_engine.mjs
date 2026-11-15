// Decompose the yield index for one crop/region by planting date.
import { readFileSync } from 'node:fs';
import { prepClimate, seasonSim, CROP, DEFAULT_P } from './js/engine.js';
const [region = 'iowa', crop = 'maize', soil = 'loam'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(`data/${region}.json`, 'utf8'));
const c = prepClimate(raw), farm = { soil, slope: 4, irrig: 0 }, cr = CROP[crop];
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log(region, crop, soil, ' doy  rel   Ft    wf   heatDays frostFrac stressDays');
for (let doy = 91; doy <= 231; doy += 20) {
  const rs = c.yStarts.map(ys => seasonSim(c, cr, farm, ys + doy - 1, DEFAULT_P, true)).filter(Boolean);
  console.log(String(doy).padStart(14), avg(rs.map(r => r.rel)).toFixed(2), avg(rs.map(r => r.Ft)).toFixed(2), avg(rs.map(r => r.wf)).toFixed(2),
    avg(rs.map(r => r.heat)).toFixed(1).padStart(6), avg(rs.map(r => +r.frost)).toFixed(2).padStart(8), avg(rs.map(r => r.stress)).toFixed(0).padStart(8));
}
const jul = [], jja = []; for (let i = 0; i < c.n; i++) { const m = new Date(Date.UTC(2005, 0, 1) + i * 864e5).getUTCMonth(); if (m === 6) { jul.push(c.et0[i]); } if (m >= 5 && m <= 7) jja.push(c.prec[i]); }
console.log('mean July ET0 mm/d', avg(jul).toFixed(2), ' mean JJA rain mm/d', avg(jja).toFixed(2));
