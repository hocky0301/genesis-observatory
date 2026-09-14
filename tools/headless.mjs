// Headless verification + tuning harness — no browser, no DOM.
// 1) Runs the world for a while and prints the time-series of key metrics.
// 2) Historical whole-genome assay: bodies and brains vary together.
//    These descriptive scores do not isolate learning or brain-only effects.
//
//   usage: node tools/headless.mjs [ticks] [seed] [protect 0|1]

import { CONFIG } from '../src/config.js';
import { World } from '../src/world.js';
import { Creature } from '../src/creature.js';
import { randomGenome } from '../src/genome.js';
import { cloneBrain, InnovationRegistry } from '../src/neat.js';
import { makeRNG } from '../src/rng.js';

const TICKS = parseInt(process.argv[2] || '9000', 10);
if (!Number.isInteger(TICKS) || TICKS < 1 || process.argv.slice(2).some(x => x.startsWith('--'))) throw new Error('Usage: headless.mjs [positive ticks] [seed] [protect 0|1]');
if (process.argv[3] !== undefined) CONFIG.seed = process.argv[3];
if (process.argv[4] !== undefined) CONFIG.protect = process.argv[4] !== '0';
console.log(`seed=${CONFIG.seed} protect=${CONFIG.protect} toxinFraction=${CONFIG.toxinFraction}`);

function pad(s, n) { return String(s).padStart(n); }

function runEvolution(ticks) {
  const w = new World();
  const sampleEvery = Math.max(1, Math.floor(ticks / 30));
  console.log('\n=== EVOLUTION RUN ===');
  console.log([
    pad('tick', 7), pad('pop', 5), pad('food', 5), pad('carr', 5), pad('maxGen', 6),
    pad('avgGen', 6), pad('conns', 6), pad('hidd', 5), pad('spec', 5),
    pad('herb', 5), pad('carn', 5), pad('scav', 5), pad('div', 5),
  ].join(' '));
  let extinct = false;
  const resetAt = Math.floor(ticks * 0.8); // measure in-distribution toxic intake over the final 20%
  for (let t = 0; t < ticks; t++) {
    if (t === resetAt) { w._goodEaten = 0; w._toxicEaten = 0; }
    w.step(1);
    if (w.population() === 0) { extinct = true; break; }
    if (t % sampleEvery === 0 || t === ticks - 1) {
      const m = w.metrics();
      console.log([
        pad(m.tick, 7), pad(m.population, 5), pad(m.food, 5), pad(m.carrion, 5), pad(m.maxGen, 6),
        pad(m.avgGen.toFixed(1), 6), pad(m.avgConns.toFixed(1), 6), pad(m.avgHidden.toFixed(1), 5), pad(m.species, 5),
        pad(m.herbivores, 5), pad(m.carnivores, 5), pad(m.scavengers, 5), pad(m.diversity.toFixed(2), 5),
      ].join(' '));
    }
  }
  if (extinct) console.log('!! EXTINCTION — population reached zero');
  const tot = w._goodEaten + w._toxicEaten;
  console.log(`\nin-distribution toxic intake (final 20%, toxinFraction=${CONFIG.toxinFraction}): ` +
    `${tot > 0 ? (w._toxicEaten / tot).toFixed(3) : 'n/a'}  (configured bloom probability, not a calibrated chance baseline)`);
  return w;
}

function cloneGenome(g) {
  return { body: g.body.slice(), brain: cloneBrain(g.brain) };
}

// A single controlled foraging trial: one creature, a food-rich arena, fixed
// duration, no reproduction or old age. Returns pellets eaten.
const TRIAL_TICKS = 500;
function forageTrial(genome, seed) {
  const save = { ...CONFIG };
  Object.assign(CONFIG, {
    width: 700, height: 700,
    startPopulation: 1, maxPopulation: 1,
    startFood: 240, maxFood: 700, foodRate: 9,
    maxAge: 1e9, startEnergy: 1e7, reproduceThreshold: 1e12,
    seed,
  });
  try {
    const w = new World();
    const c = new Creature(w.newId(), 350, 350, 0, cloneGenome(genome), 1, w.topo);
    c.energy = 1e7;
    w.creatures = [c];
    for (let t = 0; t < TRIAL_TICKS; t++) w.step(1);
    return c.eaten / CONFIG.foodEnergy;
  } finally {
    Object.assign(CONFIG, save);
  }
}

// High-toxin arena: observed intake fraction. Inputs separate nectar and toxin;
// this is not an XOR task, and the neutral intake rate is not calibrated.
function toxicTrial(genome, seed) {
  const save = { ...CONFIG };
  Object.assign(CONFIG, {
    width: 700, height: 700, startPopulation: 1, maxPopulation: 1,
    startFood: 320, maxFood: 800, foodRate: 11, toxinFraction: 0.5,
    maxAge: 1e9, startEnergy: 1e7, reproduceThreshold: 1e12, seed,
  });
  try {
    const w = new World();
    const c = new Creature(w.newId(), 350, 350, 0, cloneGenome(genome), 1, w.topo);
    c.energy = 1e7; w.creatures = [c];
    for (let t = 0; t < TRIAL_TICKS; t++) w.step(1);
    const tot = w._goodEaten + w._toxicEaten;
    return tot > 0 ? w._toxicEaten / tot : 0.5;
  } finally {
    Object.assign(CONFIG, save);
  }
}

function benchmark(world) {
  console.log('\n=== A/B FORAGING BENCHMARK (pellets in', TRIAL_TICKS, 'ticks) ===');
  const rng = makeRNG('bench');
  const topo = world.topo;

  // sample evolved genomes from the survivors
  const evolved = world.creatures.slice();
  for (let i = evolved.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [evolved[i], evolved[j]] = [evolved[j], evolved[i]];
  }
  const sample = evolved.slice(0, 30);

  let evoSum = 0, rndSum = 0, evoTox = 0, rndTox = 0;
  for (const c of sample) {
    evoSum += (forageTrial(c.genome, 101) + forageTrial(c.genome, 202)) / 2;
    evoTox += toxicTrial(c.genome, 303);
  }
  const benchReg = new InnovationRegistry(topo.nIn, topo.nOut);
  for (let i = 0; i < 30; i++) {
    const g = randomGenome(rng, topo.nIn, topo.nOut, benchReg);
    rndSum += (forageTrial(g, 101) + forageTrial(g, 202)) / 2;
    rndTox += toxicTrial(g, 303);
  }
  const evo = sample.length ? evoSum / sample.length : 0, rnd = rndSum / 30;
  console.log('  random genomes : ', rnd.toFixed(1), 'pellets/trial');
  console.log('  evolved genomes: ', evo.toFixed(1), 'pellets/trial');
  console.log('  improvement   : ', (rnd > 0 ? (evo / rnd).toFixed(2) + '×' : 'n/a'), `(+${(evo - rnd).toFixed(1)})`);
  console.log('\n=== TOXIN INTAKE (descriptive fraction; neutral baseline uncalibrated) ===');
  console.log('  random genomes : ', (rndTox / 30).toFixed(3), '(neutral baseline uncalibrated)');
  console.log('  evolved genomes: ', (sample.length ? evoTox / sample.length : 0).toFixed(3));
  return { evo, rnd };
}

const t0 = process.hrtime.bigint();
const world = runEvolution(TICKS);
// count-integrity assertion: live species counts must sum to the living creatures
let liveSum = 0; for (const sp of world.species.values()) liveSum += sp.count;
const living = world.creatures.length;
console.log(`\ncount-integrity: Σspecies.count=${liveSum} creatures=${living} ${liveSum === living ? 'OK ✓' : 'MISMATCH ✗'}`);
if (liveSum !== living) throw new Error('Species count mismatch');
if (world.population() > 0) benchmark(world);
const t1 = process.hrtime.bigint();
console.log('\nwall time:', Number(t1 - t0) / 1e9, 's for', TICKS, 'ticks');
