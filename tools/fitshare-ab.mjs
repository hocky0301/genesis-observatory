// 3-arm A/B for the fitness-sharing scheme: unprotected vs. legacy rarity-protect
// vs. real NEAT fitness-sharing. Runs a smaller population for speed; reports, per
// arm (averaged over seeds): brain complexity (the point), population/species
// stability, and toxin avoidance (must not regress).
//   node tools/fitshare-ab.mjs [ticks] [maxPop]

import { CONFIG } from '../src/config.js';
import { World } from '../src/world.js';

const TICKS = parseInt(process.argv[2] || '6000', 10);
const MAXPOP = parseInt(process.argv[3] || '800', 10);
const SEEDS = ['1337', 'abc', 'forest', '2024'];
const ARMS = {
  unprotected: { protect: false, fitShare: false },
  protect: { protect: true, fitShare: false },
  fitshare: { protect: false, fitShare: true },
};

function fingerprint(w) {
  let s = 0;
  for (const c of w.creatures) s = (s * 31 + Math.round(c.x * 100) + (Math.sin(c.phase) * 1e6 | 0) + c.genome.brain.conns.length) >>> 0;
  return w.creatures.length + ':' + s;
}

function runArm(arm, seed) {
  const save = { ...CONFIG };
  Object.assign(CONFIG, ARMS[arm], { seed, maxPopulation: MAXPOP, startPopulation: Math.min(200, MAXPOP / 4 | 0) });
  try {
    const w = new World();
    const resetAt = Math.floor(TICKS * 0.8);
    for (let t = 0; t < TICKS; t++) {
      if (t === resetAt) { w._goodEaten = 0; w._toxicEaten = 0; }
      w.step(1);
      if (w.population() === 0) return { extinct: true };
    }
    const m = w.metrics();
    const tot = w._goodEaten + w._toxicEaten;
    return {
      avgHidden: m.avgHidden, avgConns: m.avgConns, pop: m.population,
      species: m.species, maxGen: m.maxGen, toxic: tot > 0 ? w._toxicEaten / tot : 0.5,
      fp: fingerprint(w),
    };
  } finally { Object.assign(CONFIG, save); }
}

// determinism: unprotected run twice must be byte-identical (fitShare-off = no-op)
const d1 = runArm('unprotected', 'det').fp, d2 = runArm('unprotected', 'det').fp;
console.log(`determinism (unprotected×2): ${d1 === d2 ? 'OK ✓' : 'FAIL ✗'}\n`);

const agg = {};
for (const arm of Object.keys(ARMS)) agg[arm] = { avgHidden: 0, avgConns: 0, pop: 0, species: 0, toxic: 0, n: 0, extinct: 0 };
for (const seed of SEEDS) {
  for (const arm of Object.keys(ARMS)) {
    const r = runArm(arm, seed);
    const a = agg[arm];
    if (r.extinct) { a.extinct++; continue; }
    a.avgHidden += r.avgHidden; a.avgConns += r.avgConns; a.pop += r.pop; a.species += r.species; a.toxic += r.toxic; a.n++;
  }
}

const pad = (s, n) => String(s).padStart(n);
console.log(`=== ${TICKS} ticks, maxPop ${MAXPOP}, ${SEEDS.length} seeds ===`);
console.log([pad('arm', 12), pad('avgHidden', 10), pad('avgConns', 9), pad('pop', 6), pad('species', 8), pad('toxic↓', 7), pad('extinct', 8)].join(' '));
for (const arm of Object.keys(ARMS)) {
  const a = agg[arm], n = a.n || 1;
  console.log([pad(arm, 12), pad((a.avgHidden / n).toFixed(2), 10), pad((a.avgConns / n).toFixed(2), 9),
    pad((a.pop / n).toFixed(0), 6), pad((a.species / n).toFixed(1), 8), pad((a.toxic / n).toFixed(3), 7), pad(a.extinct, 8)].join(' '));
}
