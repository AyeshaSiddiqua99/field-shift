// Sanity test: run the engine on each cached region and print what it recommends.
import { readFileSync } from 'node:fs';
import { pipeline, prepClimate, modelCheck, robustRank, planKey, CROP, DEFAULT_P } from './js/engine.js';

const regions = JSON.parse(readFileSync('data/regions.json', 'utf8'));
const farm = { soil: 'loam', slope: 4, irrig: 0 };
const W = { income: 5, stability: 5, water: 5, soil: 5 };
const current = ['maize'];
const names = ids => ids.map(i => CROP[i].name).join(' > ');
const scen0 = { dT: 0, dP: 0, ext: 0 }, scen1 = { dT: 2, dP: -0.15, ext: 0.3 };

for (const [id, r] of Object.entries(regions)) {
  const raw = JSON.parse(readFileSync(`data/${id}.json`, 'utf8'));
  let t = performance.now();
  const a = pipeline(raw, scen0, farm, W, current);
  const ms = Math.round(performance.now() - t);
  const b = pipeline(raw, scen1, farm, W, current);
  const mc = modelCheck(a.c, farm);
  console.log(`\n=== ${r.name}  (${ms} ms/pipeline)  meanT ${a.c.stats.meanT.toFixed(1)}C  rain ${Math.round(a.c.stats.meanP)} mm  trend ${a.c.stats.trendPerDecade.toFixed(2)} C/dec`);
  console.log('model check r (anomaly vs GWETROOT):', mc.r.toFixed(2), 'months', mc.months);
  const rowsFor = ['maize', 'wheat', 'soybean', 'sorghum', 'millet', 'groundnut', 'chickpea', 'potato', 'sunflower'];
  console.log('crop  best-doy  meanRel:', rowsFor.map(k => `${k}:${a.table[k].doy}/${a.table[k].meanRel.toFixed(2)}`).join('  '));
  console.log('TODAY    top1:', names(a.ranking.top[0].ids), '| mean', a.ranking.top[0].mean.toFixed(2), 'p10', a.ranking.top[0].p10.toFixed(2), 'eros', a.ranking.top[0].eros.toFixed(0));
  console.log('         top2:', names(a.ranking.top[1].ids), ' top3:', names(a.ranking.top[2].ids));
  console.log('         current maize mono: mean', a.ranking.current.mean.toFixed(2), 'p10', a.ranking.current.p10.toFixed(2), 'eros', a.ranking.current.eros.toFixed(0));
  console.log('+2C -15%  top1:', names(b.ranking.top[0].ids), '| mean', b.ranking.top[0].mean.toFixed(2), 'p10', b.ranking.top[0].p10.toFixed(2));
  const rb = robustRank(raw, scen1, farm, W, current, b.ranking, 8);
  const k = rb.order[0], s = rb.stat[k];
  console.log(`robust pick under scenario: ${k.split('>').map(i => CROP[i].name).join(' > ')} (#1 in ${s.wins} of ${rb.runs} runs)`);
}
