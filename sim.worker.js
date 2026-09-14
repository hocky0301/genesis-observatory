// GENESIS simulation worker. Owns the World + Stats + CONFIG and runs the whole
// simulation off the main thread, so the UI stays at 60fps even with thousands of
// creatures. Each frame it packs a compact render snapshot into one of two
// ping-pong ArrayBuffers and transfers it to the main thread; stats, species and
// the selected creature's brain are posted on slower cadences.

import { CONFIG } from './src/config.js';
import { World } from './src/world.js';
import { Stats } from './src/stats.js';
import { pack, bufferSize } from './src/render-snapshot.js';
import { evaluate, complexity, buildNetwork } from './src/neat.js';
import { decodeBody } from './src/genome.js';

// per-species "rep signature" for the behavior-phylogeny view: decoded traits of
// the founding genome + a STEERING FINGERPRINT (how the founding brain responds to
// a canned battery of sensory vectors). repGenome is immutable, so compute once
// per species id and cache. Cleared on reset/load.
const repCache = new Map();
function speciesRep(s) {
  let r = repCache.get(s.id);
  if (r) return r;
  if (!s.repGenome) return { size: 1, speed: 2, vision: 100, diet: 0, scavenge: 0.5, hue: s.color || 0, repHidden: 0, repConns: 0, fp: [0, 0, 0, 0, 0, 0] };
  const b = decodeBody(s.repGenome.body);
  const cx = complexity(s.repGenome.brain);
  const net = buildNetwork(s.repGenome.brain, world.topo.nIn, world.topo.nOut);
  const inp = new Float32Array(world.topo.nIn), out = new Float32Array(world.topo.nOut);
  const probe = (idx) => { inp.fill(0); inp[15] = 1; inp[idx] = 1; evaluate(net, inp, out); return [out[0], out[1]]; };
  // inputs: nectar L/C/R=0..2, toxic L/C/R=3..5, carrion L/C/R=6..8, foe L/C/R=9..11, bias=15
  const nL = probe(0), nR = probe(2), tC = probe(4), nC = probe(1), fC = probe(10), kC = probe(7);
  r = {
    size: b.size, speed: b.maxSpeed, vision: b.sensorRange, diet: b.diet, scavenge: b.scavenge, hue: b.hue,
    repHidden: cx.hidden, repConns: cx.conns,
    // [turn→nectarL, turn→nectarR, turn→toxicAhead, thrust→nectarC, turn→foeAhead, thrust→carrionC]
    fp: [nL[0], nR[0], tC[0], nC[1], fC[0], kC[1]],
  };
  repCache.set(s.id, r);
  return r;
}

// World/Stats/buffers are created on 'init' so each island (multi-world mode) can
// pass its own CONFIG overrides (maxPopulation, world size, seed) BEFORE the World
// and the snapshot buffer are sized.
let world = null, stats = null, SIZE = 0;
let running = true, stepsPerTick = 1, selectedId = null, frame = 0;
let recording = false, interval = null;

// Snapshot transport. Preferred: a SharedArrayBuffer written under a seqlock
// (ctrl[0] is a sequence counter — odd while writing, even when stable), so the
// main thread copies each new stable sequence without a per-frame postMessage.
// This is shared transport, not a zero-copy renderer. Falls back to
// transferable ping-pong ArrayBuffers when the page is not cross-origin isolated.
const useSAB = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
let dataSab = null, ctrl = null, freeBufs = null;

function boot(cfg, rec = false) {
  if (world) return;
  if (cfg) Object.assign(CONFIG, cfg); // per-island overrides
  world = new World();
  stats = new Stats(CONFIG.historyPoints);
  stats.sample(world);
  SIZE = bufferSize(CONFIG.maxPopulation, CONFIG.maxFood, CONFIG.maxCarrion);
  if (useSAB) { dataSab = new SharedArrayBuffer(SIZE); ctrl = new Int32Array(new SharedArrayBuffer(16)); }
  else { freeBufs = [new ArrayBuffer(SIZE), new ArrayBuffer(SIZE)]; }
  recording = rec;
  if (!recording) interval = setInterval(loop, 1000 / 60);
}

function postSnapshot() {
  if (useSAB) {
    Atomics.add(ctrl, 0, 1);   // odd → writing
    pack(world, dataSab);
    Atomics.add(ctrl, 0, 1);   // even → stable
    return;
  }
  if (!freeBufs.length) return; // main still holds both buffers — drop this frame
  const buf = freeBufs.pop();
  pack(world, buf);
  postMessage({ type: 'snapshot', buf }, [buf]);
}

function readyMsg(extra) {
  return {
    type: 'ready', tick: world.tick, width: world.width, height: world.height, topo: world.topo,
    seed: world.seed, maxPopulation: CONFIG.maxPopulation,
    // effective per-island tunables so the dashboard sliders match what this world runs
    foodRate: CONFIG.foodRate, mutationRate: CONFIG.mutationRate, config: structuredClone(CONFIG),
    sab: useSAB ? { data: dataSab, ctrl: ctrl.buffer } : null,
    ...extra,
  };
}

function postStats() {
  const m = stats.last;
  // per-species average brain complexity (for the heatmap)
  const cx = new Map(); // id -> { n, hidden, conns }
  for (const c of world.creatures) {
    let e = cx.get(c.speciesId);
    if (!e) { e = { n: 0, hidden: 0, conns: 0 }; cx.set(c.speciesId, e); }
    const k = complexity(c.genome.brain);
    e.n++; e.hidden += k.hidden; e.conns += k.conns;
  }
  const species = [...world.species.values()].map((s) => {
    const e = cx.get(s.id);
    return {
      id: s.id, parent: s.parent, birthTick: s.birthTick, color: s.color,
      peak: s.peak, alive: s.alive, lastSeen: s.lastSeen, count: s.count,
      avgHidden: e ? e.hidden / e.n : 0, avgConns: e ? e.conns / e.n : 0,
      rep: speciesRep(s),
    };
  });
  postMessage({
    type: 'stats',
    metrics: m,
    ticks: stats.ticks,
    series: stats.series,
    species,
    speciesHistory: [...stats.speciesHistory.entries()],
    speciesMeta: [...stats.speciesMeta.entries()],
    historyTicks: stats.historyTicks || stats.ticks,
    fullSpeciesHistory: [...(stats.fullSpeciesHistory || stats.speciesHistory).entries()],
    fullSpeciesMeta: [...(stats.fullSpeciesMeta || stats.speciesMeta).entries()],
  });
}

function postInspect() {
  const c = selectedId != null ? world.byId.get(selectedId) : null;
  if (!c) { postMessage({ type: 'inspect', id: selectedId, alive: false }); return; }
  // Inspect the last simulated activations without changing creature state.
  const b = c.body;
  const cx = complexity(c.genome.brain);
  postMessage({
    type: 'inspect', id: c.id, alive: true,
    brain: { nodes: c.genome.brain.nodes.map((n) => [n.id, n.type]), conns: c.genome.brain.conns.map((k) => [k.from, k.to, k.w, k.enabled ? 1 : 0]) },
    activations: [...c.net.val.entries()],
    body: Array.from(c.genome.body),
    gen: c.generation, species: c.speciesId, age: Math.round(c.age),
    energy: Math.round(c.energy), eaten: Math.round(c.eaten), kills: c.kills,
    hidden: cx.hidden, conns: cx.conns,
  });
}

function loop() {
  if (!running) return;
  {
    for (let i = 0; i < stepsPerTick; i++) {
      world.step(1);
      if (world.tick % CONFIG.statsEvery === 0) stats.sample(world);
    }
  }
  postSnapshot();
  frame++;
  if (frame % 15 === 0) postStats();             // ~4 Hz
  if (selectedId != null && frame % 6 === 0) postInspect(); // ~10 Hz when inspecting
}

// RPC snapshots are independent transfers: their delivery never depends on the
// autonomous loop or on returned ping-pong buffers. This is the recording clock.
function acknowledge(msg, extra = {}, withSnapshot = false) {
  if (msg.requestId == null) return;
  if (withSnapshot) {
    const buf = new ArrayBuffer(SIZE);
    pack(world, buf);
    postMessage({ type: 'ack', requestId: msg.requestId, tick: world.tick,
      metrics: world.metrics(), width: world.width, height: world.height, buf, ...extra }, [buf]);
  } else postMessage({ type: 'ack', requestId: msg.requestId, tick: world.tick, ...extra });
}
function checkpoint() {
  return { schemaVersion: 2, provenance: { config: structuredClone(CONFIG) },
    state: world.toState(), history: typeof stats.toJSON === 'function' ? stats.toJSON() : null };
}
function loadCheckpoint(data) {
  const st = data.state || data;
  const cfg = data.provenance?.config || data.config || st.config;
  if (cfg) Object.assign(CONFIG, structuredClone(cfg));
  world.fromState(st);
  // Capacity follows the loaded configuration, including a larger uploaded world.
  SIZE = bufferSize(CONFIG.maxPopulation, CONFIG.maxFood, CONFIG.maxCarrion);
  if (useSAB) { dataSab = new SharedArrayBuffer(SIZE); ctrl = new Int32Array(new SharedArrayBuffer(16)); }
  else freeBufs = [new ArrayBuffer(SIZE), new ArrayBuffer(SIZE)];
  stats = new Stats(CONFIG.historyPoints);
  if (data.history && typeof stats.fromJSON === 'function') stats.fromJSON(data.history);
  else stats.sample(world);
  repCache.clear(); selectedId = null;
}
self.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        boot(msg.config, !!msg.recording);
        postMessage(readyMsg()); postStats(); postSnapshot();
        acknowledge(msg, { config: structuredClone(CONFIG), recording }, true);
        break;
      case 'mode':
        recording = !!msg.recording;
        if (interval) { clearInterval(interval); interval = null; }
        if (!recording) interval = setInterval(loop, 1000 / 60);
        acknowledge(msg, { recording }); break;
      case 'speed':
        stepsPerTick = Math.max(0, Math.min(24, Number(msg.steps) || 0));
        running = stepsPerTick > 0; acknowledge(msg); break;
      case 'step': {
        const n = Math.max(0, Math.min(10000, Math.trunc(msg.n ?? 1)));
        for (let i = 0; i < n; i++) {
          world.step(1);
          if (msg.stats !== false && world.tick % CONFIG.statsEvery === 0) stats.sample(world);
        }
        if (msg.stats !== false) postStats();
        postSnapshot(); acknowledge(msg, {}, true); break;
      }
      case 'reset':
        world.reset(msg.seed); stats.reset(); repCache.clear(); stats.sample(world); selectedId = null;
        postMessage(readyMsg()); postStats(); postSnapshot(); acknowledge(msg, {}, true); break;
      case 'cataclysm': world.cataclysm(0.7); postSnapshot(); acknowledge(msg, {}, true); break;
      case 'config': {
        if (!(msg.key in CONFIG) || typeof CONFIG[msg.key] === 'object') throw new Error('Unknown scalar configuration key');
        if (typeof msg.value !== typeof CONFIG[msg.key] || (typeof msg.value === 'number' && !Number.isFinite(msg.value))) throw new Error('Invalid configuration value');
        CONFIG[msg.key] = msg.value; acknowledge(msg, { config: structuredClone(CONFIG) }); break;
      }
      case 'select': selectedId = msg.id; if (selectedId != null) postInspect(); acknowledge(msg); break;
      case 'checkpoint': acknowledge(msg, { checkpoint: checkpoint() }); break;
      case 'save': postMessage({ type: 'saved', state: checkpoint() }); acknowledge(msg); break;
      case 'load':
        loadCheckpoint(msg.checkpoint || msg.state);
        postMessage(readyMsg({ loaded: true })); postStats(); postSnapshot(); acknowledge(msg, { config: structuredClone(CONFIG) }, true); break;
      case 'snapshotReturn': if (freeBufs && freeBufs.length < 2 && msg.buf.byteLength === SIZE) freeBufs.push(msg.buf); break;
      default: throw new Error('Unknown worker command: ' + msg.type);
    }
  } catch (err) {
    postMessage({ type: 'error', requestId: msg.requestId, message: String(err?.message || err) });
  }
};
