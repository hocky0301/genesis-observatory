// Determinism + correctness harness for the deme-model migration coordinator (src/cluster.js).
// This is the gate the design requires before wiring the worker: it proves the multi-world
// system is bit-reproducible from seeds, that migration consumes ZERO step-stream RNG, and
// that save/load round-trips the migration sub-streams.

import { CONFIG } from '../src/config.js';
Object.assign(CONFIG, {
  maxPopulation: 300, startPopulation: 100, width: 1100, height: 750,
  startFood: 1200, maxFood: 2200, foodRate: 15, maxCarrion: 800, bloomCount: 6,
});
const { makeCluster, demeStep, clusterToState, clusterFromState } = await import('../src/cluster.js');
const { World } = await import('../src/world.js');

function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function clusterHash(c) { return hashStr(JSON.stringify(c.demes.map((w) => w.toState()))); }

const SEEDS = ['1337-0', '1337-1', '1337-2'];
const MIG = { interval: 100, perDeme: 2, topology: 'ring' };
const STEPS = 1500;

let pass = true;
const check = (name, cond) => { console.log((cond ? '  ✓' : '  ✗') + ' ' + name); if (!cond) pass = false; };
const run = (steps, mig = MIG) => { const c = makeCluster(SEEDS, mig, '1337'); for (let i = 0; i < steps; i++) demeStep(c); return c; };

console.log('=== Test 1: bit-reproducibility across two identical runs ===');
{
  const h1 = clusterHash(run(STEPS)), h2 = clusterHash(run(STEPS));
  check('two runs → identical cluster state (hash ' + h1 + ')', h1 === h2);
}

console.log('=== Test 2: independent of host scheduling (sync vs async yielding) ===');
{
  const cA = makeCluster(SEEDS, MIG, '1337'); for (let i = 0; i < 700; i++) demeStep(cA);
  const cB = makeCluster(SEEDS, MIG, '1337'); for (let i = 0; i < 700; i++) { await Promise.resolve(); demeStep(cB); }
  check('async-yielded run identical to tight-loop run', clusterHash(cA) === clusterHash(cB));
}

console.log('=== Test 3: migration is non-vacuous (changes the trajectory) ===');
{
  const withMig = clusterHash(run(STEPS, { interval: 100, perDeme: 2, topology: 'ring' }));
  const noMig = clusterHash(run(STEPS, { interval: 1e9, perDeme: 2, topology: 'ring' }));
  check('migration run differs from a no-migration run of the same seeds', withMig !== noMig);
  const rnd = clusterHash(run(STEPS, { interval: 100, perDeme: 2, topology: 'random' }));
  check('random topology is deterministic and differs from ring', rnd !== withMig && rnd === clusterHash(run(STEPS, { interval: 100, perDeme: 2, topology: 'random' })));
}

console.log('=== Test 4: RNG purity — migration never consumes the step stream ===');
{
  // (a) with NO migration, a deme is byte-identical to a solo world of the same seed
  const cNo = makeCluster(SEEDS, { interval: 1e9, perDeme: 2, topology: 'ring' }, '1337');
  const solo = new World(); solo.reset('1337-0');
  for (let i = 0; i < 500; i++) { demeStep(cNo); solo.step(1); }
  check('no-migration deme rng identical to solo world of same seed',
    JSON.stringify(cNo.demes[0].rng.state()) === JSON.stringify(solo.rng.state()));

  // (b) at the migration tick the deme rng still matches solo (migration consumed no step rng)…
  const cMig = makeCluster(SEEDS, MIG, '1337');
  const solo2 = new World(); solo2.reset('1337-0');
  for (let i = 0; i < 100; i++) { demeStep(cMig); solo2.step(1); } // through tick 100 incl. migration
  check('deme rng still identical to solo right after the migration pass', JSON.stringify(cMig.demes[0].rng.state()) === JSON.stringify(solo2.rng.state()));
  // …then diverges only because the population composition changed (the intended island effect)
  for (let i = 0; i < 60; i++) { demeStep(cMig); solo2.step(1); }
  check('deme rng diverges after migration (population changed — expected, not a leak)', JSON.stringify(cMig.demes[0].rng.state()) !== JSON.stringify(solo2.rng.state()));
}

console.log('=== Test 5: save/load round-trips the migration sub-streams ===');
{
  const c = makeCluster(SEEDS, MIG, '1337');
  for (let i = 0; i < 350; i++) demeStep(c); // past 3 migration rounds
  const saved = JSON.parse(JSON.stringify(clusterToState(c)));
  const atSaveDemes = c.demes.map((w) => JSON.stringify([w.rng.state(), w.migRng.state(), w.tick]));
  const atSaveCluster = JSON.stringify(c.migRng.state());

  const cLoad = makeCluster(SEEDS, MIG, '1337');
  clusterFromState(cLoad, saved);
  check('per-deme rng + migRng + tick round-trip exactly', JSON.stringify(cLoad.demes.map((w) => JSON.stringify([w.rng.state(), w.migRng.state(), w.tick]))) === JSON.stringify(atSaveDemes));
  check('cluster (topology) rng round-trips', JSON.stringify(cLoad.migRng.state()) === atSaveCluster);

  // load the SAME save twice → identical futures (the reproducibility guarantee that holds
  // despite coordinate quantization in toState)
  const l1 = makeCluster(SEEDS, MIG, '1337'); clusterFromState(l1, saved);
  const l2 = makeCluster(SEEDS, MIG, '1337'); clusterFromState(l2, saved);
  for (let i = 0; i < 300; i++) { demeStep(l1); demeStep(l2); }
  check('load-same-save-twice → identical 300-tick futures', clusterHash(l1) === clusterHash(l2));

  // deme-count mismatch is rejected loudly
  let rejected = false;
  try { const bad = makeCluster(['a', 'b'], MIG, '1337'); clusterFromState(bad, saved); } catch (e) { rejected = true; }
  check('loading a 3-deme save into a 2-deme cluster is rejected', rejected);
}

console.log(pass ? '\n✅ cluster determinism OK' : '\n❌ cluster determinism FAILED');
process.exit(pass ? 0 : 1);
