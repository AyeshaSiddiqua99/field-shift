// Does the model "see" known drought years? Prints simulated maize yield index by year vs. summer rainfall.
import { readFileSync } from 'node:fs';
import { prepClimate, evalCrops } from './js/engine.js';
const [region = 'iowa', crop = 'maize'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(`data/${region}.json`, 'utf8'));
const c = prepClimate(raw), farm = { soil: 'loam', slope: 4, irrig: 0 };
const t = evalCrops(c, farm), rows = t[crop].rows, doy = t[crop].doy;
console.log(region, crop, 'best doy', doy);
rows.forEach((r, i) => {
  const ys = c.yStarts[i] + doy - 1; let rain = 0; for (let d = 0; d < 130; d++) rain += c.prec[ys + d];
  console.log(2006 + i, 'rel', r.rel.toFixed(2), ' season rain', Math.round(rain), 'mm  stressDays', r.stress, ' heatDays', r.heat, r.frost ? ' FROST' : '');
});
const sorted = rows.map((r, i) => [r.rel, 2006 + i]).sort((a, b) => a[0] - b[0]);
console.log('worst 3 years:', sorted.slice(0, 3).map(x => `${x[1]} (${x[0].toFixed(2)})`).join(', '));
