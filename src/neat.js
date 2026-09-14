// NEAT-style neuroevolution: the brain's *topology* evolves, not just its
// weights. A genome is a set of node genes and connection genes, each connection
// carrying a global "innovation" number so two genomes can be aligned and crossed
// over meaningfully. Mutations grow the network (add-connection, add-node) so
// minds get structurally more complex over generations.
//
// Networks are evaluated feed-forward. add-connection refuses to create cycles,
// and the builder additionally drops any back-edge it finds, so evaluation is
// always finite even after crossover combines two parents.

export const NODE = { INPUT: 0, OUTPUT: 1, HIDDEN: 2, BIAS: 3 };

// ---- innovation bookkeeping — one registry PER WORLD ----
// Historically these were module globals, which meant two worlds running
// concurrently (e.g. the app + a benchmark trial) would pollute each other's
// innovation numbering and diverge. Each World now owns its own registry, so
// concurrent worlds are fully independent and deterministic.
export class InnovationRegistry {
  constructor(nIn, nOut) { this.reset(nIn, nOut); }

  reset(nIn, nOut) {
    this.innov = 0;
    this.node = nIn + nOut;
    this.connReg = new Map(); // `${from}_${to}` -> innovation number
    this.splitReg = new Map(); // connInnov -> [newNodeId, innovIn, innovOut]
  }

  /** after loading a saved world, make sure new ids/innovations won't collide. */
  sync(maxNodeId, maxInnov) {
    this.node = Math.max(this.node, maxNodeId + 1);
    this.innov = Math.max(this.innov, maxInnov + 1);
  }

  connInnov(from, to) {
    const k = from + '_' + to;
    let v = this.connReg.get(k);
    if (v === undefined) { v = this.innov++; this.connReg.set(k, v); }
    return v;
  }

  splitInnov(cInnov) {
    let v = this.splitReg.get(cInnov);
    if (!v) { v = [this.node++, this.innov++, this.innov++]; this.splitReg.set(cInnov, v); }
    return v;
  }

  /**
   * Allocate a fresh hidden-node id in THIS registry's namespace, drawing from the
   * same monotonic counter as splitInnov — so a node minted here can never collide
   * with an existing node id or a future split's node id. Used by remapBrain() when
   * a migrant's lineage-specific hidden nodes are re-expressed in a destination world.
   */
  freshNode() { return this.node++; }

  // serialize/restore so a loaded world resumes with the SAME innovation numbering
  // (otherwise a re-seen structural mutation would get a fresh number → different
  // speciation/crossover alignment → divergent future).
  toJSON() {
    return { innov: this.innov, node: this.node, conn: [...this.connReg.entries()], split: [...this.splitReg.entries()] };
  }

  static fromJSON(o) {
    const r = new InnovationRegistry(0, 0);
    r.innov = o.innov; r.node = o.node;
    r.connReg = new Map(o.conn);
    r.splitReg = new Map(o.split);
    return r;
  }
}

// ---- genome construction ----

/** minimal genome: every input (incl. bias) wired straight to every output. */
export function minimalBrain(nIn, nOut, rng, reg) {
  const nodes = [];
  for (let i = 0; i < nIn; i++) nodes.push({ id: i, type: i === nIn - 1 ? NODE.BIAS : NODE.INPUT });
  for (let o = 0; o < nOut; o++) nodes.push({ id: nIn + o, type: NODE.OUTPUT });
  const conns = [];
  for (let i = 0; i < nIn; i++) {
    for (let o = 0; o < nOut; o++) {
      conns.push({ innov: reg.connInnov(i, nIn + o), from: i, to: nIn + o, w: rng.gauss() * 0.8, enabled: true });
    }
  }
  return { nodes, conns };
}

export function cloneBrain(b) {
  return {
    nodes: b.nodes.map((n) => ({ id: n.id, type: n.type })),
    conns: b.conns.map((c) => ({ innov: c.innov, from: c.from, to: c.to, w: c.w, enabled: c.enabled })),
  };
}

// ---- mutation ----

export function mutateBrain(b, rng, cfg, reg) {
  for (const c of b.conns) {
    if (rng.chance(cfg.weightMutRate)) {
      if (rng.chance(cfg.weightReplaceChance)) c.w = rng.gauss() * 0.8;
      else c.w += rng.gauss() * cfg.weightStep;
    }
  }
  if (b.conns.length && rng.chance(cfg.toggleChance)) {
    const c = rng.pick(b.conns);
    c.enabled = !c.enabled;
  }
  if (rng.chance(cfg.addConnChance)) addConnection(b, rng, reg);
  if (rng.chance(cfg.addNodeChance)) addNode(b, rng, reg);
  return b;
}

/** does `from` reach `to` following any connection? (cycle test) */
function reaches(b, from, to) {
  const adj = new Map();
  for (const c of b.conns) {
    let a = adj.get(c.from);
    if (!a) { a = []; adj.set(c.from, a); }
    a.push(c.to);
  }
  const stack = [from];
  const seen = new Set();
  while (stack.length) {
    const x = stack.pop();
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    const a = adj.get(x);
    if (a) for (const y of a) stack.push(y);
  }
  return false;
}

function addConnection(b, rng, reg) {
  const nodes = b.nodes;
  for (let tries = 0; tries < 14; tries++) {
    const a = rng.pick(nodes);
    const c2 = rng.pick(nodes);
    if (c2.type === NODE.INPUT || c2.type === NODE.BIAS) continue; // never feed into an input
    if (a.id === c2.id) continue;
    if (b.conns.some((c) => c.from === a.id && c.to === c2.id)) continue; // already exists
    if (reaches(b, c2.id, a.id)) continue; // would create a cycle
    // start near zero so a new connection is ~neutral (drifts in, then evolves)
    b.conns.push({ innov: reg.connInnov(a.id, c2.id), from: a.id, to: c2.id, w: rng.gauss() * 0.05, enabled: true });
    return;
  }
}

function addNode(b, rng, reg) {
  const enabled = b.conns.filter((c) => c.enabled);
  if (!enabled.length) return;
  const c = rng.pick(enabled);
  c.enabled = false;
  const [nid, i1, i2] = reg.splitInnov(c.innov);
  if (!b.nodes.some((n) => n.id === nid)) b.nodes.push({ id: nid, type: NODE.HIDDEN });
  // A disabled original edge can be re-enabled and split again. Reuse its
  // historical genes; duplicating an innovation makes evaluation and crossover
  // disagree about how many edges exist. Preserve the evolved weights.
  for (const gene of [
    { innov: i1, from: c.from, to: nid, w: 1, enabled: true },
    { innov: i2, from: nid, to: c.to, w: c.w, enabled: true },
  ]) {
    const existing = b.conns.find(k => k.innov === gene.innov);
    if (existing) existing.enabled = true;
    else b.conns.push(gene);
  }
}

// ---- crossover (align by innovation; disjoint/excess from the fitter parent) ----

export function crossoverBrain(a, b, rng, aFitter) {
  const am = new Map(a.conns.map((c) => [c.innov, c]));
  const bm = new Map(b.conns.map((c) => [c.innov, c]));
  const innovs = new Set([...am.keys(), ...bm.keys()]);
  const conns = [];
  for (const i of innovs) {
    const ca = am.get(i), cb = bm.get(i);
    let chosen;
    if (ca && cb) chosen = rng.next() < 0.5 ? ca : cb;
    else if (ca) chosen = aFitter ? ca : null;
    else chosen = aFitter ? null : cb;
    if (!chosen) continue;
    let enabled = chosen.enabled;
    if (ca && cb && (!ca.enabled || !cb.enabled)) enabled = rng.next() < 0.75 ? false : true;
    conns.push({ innov: chosen.innov, from: chosen.from, to: chosen.to, w: chosen.w, enabled });
  }
  const fitter = aFitter ? a : b;
  const nodeMap = new Map(fitter.nodes.map((n) => [n.id, { id: n.id, type: n.type }]));
  for (const c of conns) {
    if (!nodeMap.has(c.from)) nodeMap.set(c.from, inferNode(c.from, a, b));
    if (!nodeMap.has(c.to)) nodeMap.set(c.to, inferNode(c.to, a, b));
  }
  return { nodes: [...nodeMap.values()], conns };
}

function inferNode(id, a, b) {
  const n = a.nodes.find((x) => x.id === id) || b.nodes.find((x) => x.id === id);
  return n ? { id: n.id, type: n.type } : { id, type: NODE.HIDDEN };
}

// ---- migration: re-express a foreign genome in a destination registry's namespace ----

/**
 * Reconcile a MIGRANT brain (evolved under a DIFFERENT world's innovation registry)
 * into `destReg`'s namespace, so it becomes indistinguishable from a locally-authored
 * genome. This is the core correctness step of island migration: innovation numbers,
 * node ids and species are only meaningful within one registry's history, so a migrant
 * carrying the source world's numbers would corrupt crossover, speciation and future
 * mutation in the destination unless re-keyed here.
 *
 *   - input/output/bias nodes (id < nIn+nOut) are SHARED across worlds (every world
 *     ran reset(nIn,nOut)), so they map to themselves.
 *   - hidden nodes (id >= nIn+nOut) are lineage-specific → each gets a FRESH dest id
 *     from destReg.freshNode() (monotonic ⇒ never collides with existing or future
 *     dest node ids). `nodeMap` (keyed `${srcDeme}_${srcHidId}`) persists across a
 *     batch so genetic TWINS from one source lineage unify onto the same dest id.
 *   - every surviving connection is re-numbered through destReg.connInnov(from,to) —
 *     the SAME memoized function newborn mutations use — after canonicalizing the edge
 *     set (drop self-loops, dedup, drop cycle-creating back-edges) so it looks like a
 *     freshly-mutated genome. Result invariant: two dest genes share an innovation
 *     number IFF they are the same (from,to) edge in dest namespace.
 *
 * Pure w.r.t. the source brain (works on a clone). Consumes NO RNG.
 */
export function remapBrain(srcBrain, destReg, nIn, nOut, nodeMap, srcDeme) {
  const nIO = nIn + nOut;
  const key = (hid) => srcDeme + '_' + hid;
  const local = new Map(); // srcId -> destId, for THIS brain

  // 1. node-id map. IO/bias identity; hidden -> fresh dest id (twin-unified via nodeMap)
  for (const n of srcBrain.nodes) if (n.id < nIO) local.set(n.id, n.id);
  const hidden = srcBrain.nodes.filter((n) => n.id >= nIO).map((n) => n.id).sort((a, b) => a - b);
  for (const srcHid of hidden) {
    let destId = nodeMap.get(key(srcHid));
    if (destId === undefined) { destId = destReg.freshNode(); nodeMap.set(key(srcHid), destId); }
    local.set(srcHid, destId);
  }
  const nodes = [];
  const nodeSeen = new Set();
  for (const n of srcBrain.nodes) {
    const destId = local.get(n.id);
    if (destId === undefined || nodeSeen.has(destId)) continue;
    nodeSeen.add(destId);
    nodes.push({ id: destId, type: n.type });
  }

  // 2. map + canonicalize connections (drop self-loops, dedup by directed edge)
  const byEdge = new Map(); // `${from2}_${to2}` -> {from,to,w,enabled}
  for (const c of srcBrain.conns) {
    const from2 = local.get(c.from), to2 = local.get(c.to);
    if (from2 === undefined || to2 === undefined) continue;
    if (from2 === to2) continue; // self-loop
    const ek = from2 + '_' + to2;
    const prev = byEdge.get(ek);
    const cur = { from: from2, to: to2, w: c.w, enabled: c.enabled };
    if (!prev) { byEdge.set(ek, cur); continue; }
    // keep the enabled one; tie-break on larger |w|
    if (cur.enabled !== prev.enabled) { if (cur.enabled) byEdge.set(ek, cur); }
    else if (Math.abs(cur.w) > Math.abs(prev.w)) byEdge.set(ek, cur);
  }

  // 3. renumber in a structure-canonical order (sort by dest from,to), dropping any
  //    back-edge that would create a cycle — exactly as addConnection does.
  const surviving = [...byEdge.values()].sort((a, b) => (a.from - b.from) || (a.to - b.to));
  const acc = { conns: [] };
  const conns = [];
  for (const c of surviving) {
    if (reaches(acc, c.to, c.from)) continue; // adding from->to would close a cycle
    acc.conns.push({ from: c.from, to: c.to });
    conns.push({ innov: destReg.connInnov(c.from, c.to), from: c.from, to: c.to, w: c.w, enabled: c.enabled });
  }
  return { nodes, conns };
}

// ---- compatibility distance (speciation / diversity) ----

export function brainDistance(a, b, c1 = 1.0, c2 = 1.0, c3 = 0.45) {
  const am = new Map(a.conns.map((c) => [c.innov, c]));
  const bm = new Map(b.conns.map((c) => [c.innov, c]));
  let maxA = 0, maxB = 0;
  for (const c of a.conns) if (c.innov > maxA) maxA = c.innov;
  for (const c of b.conns) if (c.innov > maxB) maxB = c.innov;
  const lim = Math.min(maxA, maxB);
  let matching = 0, wdiff = 0, disjoint = 0, excess = 0;
  const all = new Set([...am.keys(), ...bm.keys()]);
  for (const i of all) {
    const ca = am.get(i), cb = bm.get(i);
    if (ca && cb) { matching++; wdiff += Math.abs(ca.w - cb.w); }
    else if (i > lim) excess++;
    else disjoint++;
  }
  const N = Math.max(1, a.conns.length, b.conns.length);
  return c1 * excess / N + c2 * disjoint / N + c3 * (matching ? wdiff / matching : 0);
}

// ---- network build + evaluate ----

/**
 * Compile a genome into an evaluatable feed-forward network. Uses an iterative
 * DFS reverse-postorder; any back-edge (a leftover cycle from crossover) is
 * dropped from evaluation so think() is always finite.
 */
export function buildNetwork(brain, nIn, nOut) {
  const ids = brain.nodes.map((n) => n.id);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const c of brain.conns) {
    if (!c.enabled) continue;
    if (!adj.has(c.from)) adj.set(c.from, []);
    if (!adj.has(c.to)) adj.set(c.to, []);
    adj.get(c.from).push(c.to);
  }
  const color = new Map(); // undefined=white, 1=gray, 2=black
  const post = [];
  for (const start of ids) {
    if (color.get(start)) continue;
    const stack = [[start, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      if (frame[1] === 0) color.set(node, 1);
      const nbrs = adj.get(node) || [];
      if (frame[1] < nbrs.length) {
        const nb = nbrs[frame[1]++];
        if (!color.get(nb)) stack.push([nb, 0]);
      } else {
        color.set(node, 2);
        post.push(node);
        stack.pop();
      }
    }
  }
  post.reverse();
  const pos = new Map(post.map((id, i) => [id, i]));
  const incoming = new Map(post.map((id) => [id, []]));
  for (const c of brain.conns) {
    if (!c.enabled) continue;
    const pf = pos.get(c.from), pt = pos.get(c.to);
    if (pf == null || pt == null) continue;
    if (pf < pt) incoming.get(c.to).push({ from: c.from, w: c.w }); // forward edges only
  }
  return { order: post, incoming, nIn, nOut, val: new Map() };
}

/** evaluate: inputs[] (length nIn, last slot is bias) -> out[] (length nOut). */
export function evaluate(net, inputs, out) {
  const val = net.val;
  for (let i = 0; i < net.nIn; i++) val.set(i, inputs[i]);
  for (const id of net.order) {
    if (id < net.nIn) continue; // input/bias nodes already set
    const inc = net.incoming.get(id);
    let sum = 0;
    for (let k = 0; k < inc.length; k++) sum += inc[k].w * (val.get(inc[k].from) || 0);
    val.set(id, Math.tanh(sum));
  }
  for (let o = 0; o < net.nOut; o++) out[o] = val.get(net.nIn + o) || 0;
  return out;
}

/** structural complexity, for the "minds are growing" readout. */
export function complexity(brain) {
  let hidden = 0, conns = 0;
  for (const n of brain.nodes) if (n.type === NODE.HIDDEN) hidden++;
  for (const c of brain.conns) if (c.enabled) conns++;
  return { hidden, conns };
}

export function maxIds(brain) {
  let maxNode = 0, maxInnov = 0;
  for (const n of brain.nodes) if (n.id > maxNode) maxNode = n.id;
  for (const c of brain.conns) if (c.innov > maxInnov) maxInnov = c.innov;
  return { maxNode, maxInnov };
}
