// Isolated sanity test for the NEAT engine.
import { makeRNG } from '../src/rng.js';
import * as neat from '../src/neat.js';

const rng = makeRNG('neat-test');
const NIN = 16, NOUT = 2;
const reg = new neat.InnovationRegistry(NIN, NOUT);

const cfg = { weightMutRate: 0.8, weightStep: 0.2, weightReplaceChance: 0.08, toggleChance: 0.04, addConnChance: 0.6, addNodeChance: 0.4 };

function evalFinite(brain) {
  const net = neat.buildNetwork(brain, NIN, NOUT);
  const inp = new Float32Array(NIN);
  for (let i = 0; i < NIN; i++) inp[i] = rng.range(-1, 1);
  inp[NIN - 1] = 1;
  const out = new Float32Array(NOUT);
  neat.evaluate(net, inp, out);
  return out.every((v) => Number.isFinite(v) && v >= -1.0001 && v <= 1.0001);
}

// 1) minimal brain builds + evaluates
let g = neat.minimalBrain(NIN, NOUT, rng, reg);
console.log('minimal: conns', g.conns.length, 'evalFinite', evalFinite(g));

// 2) heavy mutation grows topology, stays finite
let allFinite = true, maxHidden = 0, maxConns = 0;
for (let i = 0; i < 400; i++) {
  neat.mutateBrain(g, rng, cfg, reg);
  if (!evalFinite(g)) allFinite = false;
  const cx = neat.complexity(g);
  maxHidden = Math.max(maxHidden, cx.hidden);
  maxConns = Math.max(maxConns, cx.conns);
}
console.log('after 400 mutations: hidden', neat.complexity(g).hidden, 'conns', neat.complexity(g).conns,
  '| maxHidden', maxHidden, 'maxConns', maxConns, '| allFinite', allFinite);

// 3) crossover of two divergent brains builds + evaluates finite (no infinite loop)
let a = neat.minimalBrain(NIN, NOUT, rng, reg);
let b = neat.minimalBrain(NIN, NOUT, rng, reg);
for (let i = 0; i < 60; i++) { neat.mutateBrain(a, rng, cfg, reg); neat.mutateBrain(b, rng, cfg, reg); }
let xFinite = true;
for (let i = 0; i < 100; i++) {
  const child = neat.crossoverBrain(a, b, rng, rng.next() < 0.5);
  if (!evalFinite(child)) xFinite = false;
}
console.log('crossover children evalFinite:', xFinite);

// 4) distance is non-negative and self-distance ~0
console.log('distance(a,a):', neat.brainDistance(a, a).toFixed(4), '| distance(a,b):', neat.brainDistance(a, b).toFixed(3));

const ok = evalFinite(neat.minimalBrain(NIN, NOUT, rng, reg)) && allFinite && xFinite && maxHidden > 0 && maxConns > 20;
console.log(ok ? '\n✅ NEAT engine OK' : '\n❌ NEAT engine FAILED');
process.exit(ok ? 0 : 1);
