// Independent regression tests for audit findings. No browser or package dependencies.
// GENESIS_SOURCE_DIR=/absolute/path/to/repo node tools/core-edge-test.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const source = process.env.GENESIS_SOURCE_DIR ? pathToFileURL(path.resolve(process.env.GENESIS_SOURCE_DIR) + '/').href : new URL('../', import.meta.url).href;
const [{ CONFIG }, { World }, { InnovationRegistry, minimalBrain, mutateBrain }, { makeRNG }] = await Promise.all([
  import(new URL('src/config.js', source)), import(new URL('src/world.js', source)),
  import(new URL('src/neat.js', source)), import(new URL('src/rng.js', source)),
]);
const original = structuredClone(CONFIG);
const failures = [];
function configure(extra = {}) {
  Object.assign(CONFIG, structuredClone(original), {
    seed: 'audit-resume', startPopulation: 30, maxPopulation: 100, width: 700, height: 700,
    startFood: 400, maxFood: 700, maxCarrion: 100, foodRate: 10,
    maturity: 2, reproduceThreshold: 90, protect: false, fitShare: false,
  }, extra);
}
function test(name, fn) {
  try { configure(); fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message.slice(0, 1200)}`); }
}
function resume(w) {
  const state = JSON.parse(JSON.stringify(w.toState()));
  const restored = new World(); restored.fromState(state); return restored;
}
function prepared() {
  const w = new World(); for (let t = 0; t < 30; t++) w.step(1); return w;
}
const fields = ['id', 'x', 'y', 'heading', 'energy', 'age', 'phase', 'speed', 'eaten', 'kills', 'alive', 'predated', 'generation', 'speciesId'];
function creatures(w) {
  return w.creatures.map(c => ({ ...Object.fromEntries(fields.map(k => [k, c[k]])),
    body: [...c.genome.body], nodes: c.genome.brain.nodes, conns: c.genome.brain.conns }));
}
function pools(w) {
  return ['food', 'carrion'].map(prefix => {
    const alive = w[prefix + 'Alive'];
    const keys = prefix === 'food' ? ['foodX', 'foodY', 'foodLife', 'cueA'] : ['carrionX', 'carrionY', 'carrionE', 'carrionLife'];
    return { count: w[prefix + 'Count'], alive: [...alive], free: [...w[prefix + 'Free']],
      occupied: [...alive].flatMap((flag, i) => flag ? [[i, ...keys.map(k => w[k][i])]] : []) };
  });
}
function core(w) {
  return { tick: w.tick, creatures: creatures(w), pools: pools(w),
    rng: w.rng.state(), migRng: w.migRng.state(), innov: w.innov.toJSON(),
    nextId: w._nextId, nextSpeciesId: w.nextSpeciesId, foodAccum: w.foodAccum,
    blooms: w.blooms, generationMax: w.generationMax,
    species: [...w.species].map(([id, sp]) => [id, { count: sp.count, alive: sp.alive,
      peak: sp.peak, lastSeen: sp.lastSeen, fitEMA: sp.fitEMA, rho: sp._rho,
      rep: sp.repGenome && { body: [...sp.repGenome.body], brain: sp.repGenome.brain } }]),
  };
}

test('re-splitting a re-enabled connection keeps innovations unique', () => {
  const reg = new InnovationRegistry(1, 1);
  const brain = minimalBrain(1, 1, makeRNG('audit-split'), reg);
  const rng = { chance: p => p === 1, pick: xs => xs[0] };
  const cfg = { weightMutRate: 0, toggleChance: 0, addConnChance: 0, addNodeChance: 1 };
  mutateBrain(brain, rng, cfg, reg);
  brain.conns[0].enabled = true;
  mutateBrain(brain, rng, cfg, reg);
  assert.equal(new Set(brain.conns.map(c => c.innov)).size, brain.conns.length, 'duplicate innovation after splitting the same edge twice');
  assert.equal(new Set(brain.nodes.map(n => n.id)).size, brain.nodes.length);
});

test('completed tick counts each newborn once', () => {
  configure({ startPopulation: 1, maxPopulation: 10, startFood: 0, foodRate: 0, maturity: 0, startEnergy: 120 });
  const w = new World(); w.step(1);
  assert.equal(w.creatures.length, 2, 'fixture must cause one real birth');
  assert.equal(w.population(), w.creatures.length, 'newborn was included in both creatures and pending births');
  assert.equal(w.births.length, 0, 'pending birth queue must be empty between ticks');
});

test('checkpoint preserves every creature field and genome without rounding', () => {
  const w = prepared(), r = resume(w);
  const losses = fields.filter(k => w.creatures.some((c, i) => !Object.is(c[k], r.creatures[i]?.[k])));
  assert.deepEqual(losses, [], 'fields lost or rounded by checkpoint');
  assert.deepEqual(creatures(r), creatures(w));
});

test('checkpoint preserves indexed resources and free-list order', () => {
  const w = prepared(), r = resume(w);
  assert.deepEqual(pools(r), pools(w));
});

test('checkpoint preserves populated species liveness', () => {
  const w = prepared(), r = resume(w);
  for (const sp of r.species.values()) assert.equal(sp.alive, sp.count > 0, `species ${sp.id}`);
});

test('checkpoint never revives a pending cataclysm death', () => {
  const w = new World(); w.cataclysm(1); const r = resume(w);
  assert.equal(r.creatures.filter(c => c.alive).length, 0);
  w.step(1); r.step(1);
  assert.deepEqual(core(r), core(w));
});

for (const arm of ['default', 'protect', 'fitShare']) test(`checkpoint resumes the exact next 12 ticks (${arm})`, () => {
  configure({ protect: arm === 'protect', fitShare: arm === 'fitShare' });
  const w = prepared(), r = resume(w);
  for (let t = 1; t <= 12; t++) {
    w.step(1); r.step(1);
    assert.deepEqual(core(r), core(w), `first post-load divergence at +${t} ticks`);
  }
});

Object.assign(CONFIG, original);
console.log(JSON.stringify({ tests: 9, failures: failures.length, names: failures }));
process.exitCode = failures.length ? 1 : 0;
