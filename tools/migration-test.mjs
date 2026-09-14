// Unit test for the migration reconciliation (remapBrain) — the correctness heart of
// island migration. Verifies a migrant genome re-expressed in a destination registry
// becomes a valid, alias-free, canonical genome in that namespace.

import { InnovationRegistry, minimalBrain, mutateBrain, remapBrain, buildNetwork, evaluate, brainDistance, cloneBrain, NODE } from '../src/neat.js';
import { makeRNG } from '../src/rng.js';

const NIN = 16, NOUT = 2, NIO = NIN + NOUT;
const cfg = { weightMutRate: 0.8, weightReplaceChance: 0.1, weightStep: 0.5, toggleChance: 0.1, addConnChance: 0.55, addNodeChance: 0.4 };

function evolve(seed, steps) {
  const reg = new InnovationRegistry(NIN, NOUT);
  const rng = makeRNG(seed);
  const b = minimalBrain(NIN, NOUT, rng, reg);
  for (let i = 0; i < steps; i++) mutateBrain(b, rng, cfg, reg);
  return { reg, brain: b };
}

function isDAG(conns) {
  const indeg = new Map(), adj = new Map(), nodes = new Set();
  for (const c of conns) { nodes.add(c.from); nodes.add(c.to); }
  for (const n of nodes) { indeg.set(n, 0); adj.set(n, []); }
  for (const c of conns) { adj.get(c.from).push(c.to); indeg.set(c.to, indeg.get(c.to) + 1); }
  const q = [...nodes].filter((n) => indeg.get(n) === 0);
  let seen = 0;
  while (q.length) {
    const x = q.pop(); seen++;
    for (const y of adj.get(x)) { indeg.set(y, indeg.get(y) - 1); if (indeg.get(y) === 0) q.push(y); }
  }
  return seen === nodes.size;
}

let pass = true;
const check = (name, cond) => { console.log((cond ? '  ✓' : '  ✗') + ' ' + name); if (!cond) pass = false; };

console.log('=== Test 1: basic remap into a native destination lineage ===');
{
  const dest = evolve('dest-1', 40);
  const src = evolve('src-1', 40);
  const destNodeBefore = dest.reg.node;
  const remapped = remapBrain(src.brain, dest.reg, NIN, NOUT, new Map(), 0);

  let consistent = true;
  for (const c of remapped.conns) if (dest.reg.connReg.get(c.from + '_' + c.to) !== c.innov) consistent = false;
  check('every emitted conn is keyed in destReg.connReg with its innov', consistent);

  const srcIO = src.brain.nodes.filter((n) => n.id < NIO).map((n) => n.id).sort((a, b) => a - b);
  const remIO = remapped.nodes.filter((n) => n.id < NIO).map((n) => n.id).sort((a, b) => a - b);
  check('IO/bias node ids preserved as identity', JSON.stringify(srcIO) === JSON.stringify(remIO));

  const hid = remapped.nodes.filter((n) => n.id >= NIO).map((n) => n.id);
  check('hidden ids are all fresh (>= dest node counter before remap)', hid.every((id) => id >= destNodeBefore));
  check('hidden ids are distinct', new Set(hid).size === hid.length);

  const innovs = remapped.conns.map((c) => c.innov), edges = remapped.conns.map((c) => c.from + '_' + c.to);
  check('innov <-> edge is a bijection (no aliasing)', new Set(innovs).size === innovs.length && new Set(edges).size === edges.length);

  const net = buildNetwork(remapped, NIN, NOUT);
  const inp = new Float32Array(NIN); inp[15] = 1; for (let i = 0; i < NIN; i++) inp[i] = (i % 3) - 1;
  const out = new Float32Array(NOUT); evaluate(net, inp, out);
  check('post-remap evaluate is finite', Number.isFinite(out[0]) && Number.isFinite(out[1]));
}

console.log('=== Test 2: canonicalization removes self-loop / cycle / duplicate ===');
{
  const dest = evolve('dest-2', 30);
  const srcBrain = {
    nodes: [{ id: 0, type: NODE.INPUT }, { id: 15, type: NODE.BIAS }, { id: 16, type: NODE.OUTPUT }, { id: 18, type: NODE.HIDDEN }, { id: 19, type: NODE.HIDDEN }],
    conns: [
      { innov: 0, from: 18, to: 18, w: 0.5, enabled: true },   // self-loop
      { innov: 1, from: 0, to: 18, w: 0.4, enabled: true },
      { innov: 2, from: 18, to: 19, w: 0.3, enabled: true },
      { innov: 3, from: 19, to: 18, w: 0.2, enabled: true },   // back-edge → cycle 18<->19
      { innov: 4, from: 0, to: 18, w: 0.9, enabled: false },   // duplicate of 0->18
      { innov: 5, from: 18, to: 16, w: 0.1, enabled: true },
    ],
  };
  const r = remapBrain(srcBrain, dest.reg, NIN, NOUT, new Map(), 0);
  const edges = r.conns.map((c) => c.from + '->' + c.to);
  check('no self-loops after canonicalization', r.conns.every((c) => c.from !== c.to));
  check('no duplicate directed edges', new Set(edges).size === edges.length);
  check('canonical edge set is acyclic', isDAG(r.conns));
  check('the enabled duplicate 0->18 kept (not the disabled one)', r.conns.some((c) => c.enabled && dest.reg.connReg.get(c.from + '_' + c.to) === c.innov));
}

console.log('=== Test 3: twin unification within one source lineage+batch ===');
{
  const dest = evolve('dest-3', 25);
  const src = evolve('srcTwin', 45);
  const nodeMap = new Map(); // shared batch map (same destination deme)
  const ra = remapBrain(cloneBrain(src.brain), dest.reg, NIN, NOUT, nodeMap, 0);
  const rb = remapBrain(cloneBrain(src.brain), dest.reg, NIN, NOUT, nodeMap, 0);
  check('twins from same lineage+batch unify (brainDistance 0)', brainDistance(ra, rb) === 0);
  const idsA = ra.nodes.map((n) => n.id).sort((a, b) => a - b), idsB = rb.nodes.map((n) => n.id).sort((a, b) => a - b);
  check('twins share dest node ids', JSON.stringify(idsA) === JSON.stringify(idsB));
  const inA = ra.conns.map((c) => c.innov).sort((a, b) => a - b), inB = rb.conns.map((c) => c.innov).sort((a, b) => a - b);
  check('twins share dest innovation numbers', JSON.stringify(inA) === JSON.stringify(inB));
  const rc = remapBrain(cloneBrain(src.brain), dest.reg, NIN, NOUT, nodeMap, 1); // different srcDeme
  const overlap = ra.nodes.some((n) => n.id >= NIO && rc.nodes.some((m) => m.id === n.id));
  check('a different source deme does NOT alias twin hidden ids', !overlap);
}

console.log('=== Test 4: fuzz — 40 random migrants remap to valid alias-free genomes ===');
{
  const dest = evolve('dest-fuzz', 20);
  let ok = true;
  for (let s = 0; s < 40; s++) {
    const src = evolve('fuzz-' + s, 8 + (s % 30));
    const r = remapBrain(src.brain, dest.reg, NIN, NOUT, new Map(), s);
    const innovs = r.conns.map((c) => c.innov), edges = r.conns.map((c) => c.from + '_' + c.to);
    if (new Set(innovs).size !== innovs.length || new Set(edges).size !== edges.length) ok = false;
    for (const c of r.conns) if (dest.reg.connReg.get(c.from + '_' + c.to) !== c.innov) ok = false;
    if (!isDAG(r.conns)) ok = false;
    const net = buildNetwork(r, NIN, NOUT);
    const inp = new Float32Array(NIN); inp[15] = 1; const out = new Float32Array(NOUT); evaluate(net, inp, out);
    if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) ok = false;
  }
  check('fuzz: all consistent, acyclic, finite, alias-free', ok);
}

console.log(pass ? '\n✅ remapBrain correctness OK' : '\n❌ remapBrain FAILED');
process.exit(pass ? 0 : 1);
