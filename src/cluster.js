// Deme-model island migration coordinator. One process (the sim worker, or a headless
// test harness) owns N independent Worlds ("demes") and steps them IN LOCKSTEP. Migration
// is a synchronous between-step pass, so reproducibility is STRUCTURAL: there is no async
// channel, no message-arrival ordering, and no barrier to negotiate — the single-threaded
// sequential loop IS the barrier. Given the seeds + migration params, the whole N-world
// trajectory is bit-reproducible run-to-run.
//
// The multi-worker `?islands` mode cannot migrate deterministically (message timing leaks
// into state); this deme model is the price/benefit trade the design settled on: N demes
// share one core (slower) in exchange for provably-correct, reproducible migration.

import { World } from './world.js';
import { makeRNG } from './rng.js';

/** build a cluster of N demes from explicit per-deme seeds. CONFIG must already be set to
 *  the per-deme world config by the caller (worker / harness) before this is called. */
export function makeCluster(seeds, migrate, baseSeed) {
  const demes = seeds.map((seed) => { const w = new World(); w.reset(seed); return w; });
  return {
    demes,
    migrate: normMigrate(migrate),
    // topology='random' draws its destination from this cluster-level sub-stream, seeded
    // from baseSeed (never wall-clock); persisted in the save container for reproducibility.
    migRng: makeRNG(String(baseSeed) + '-cluster'),
    baseSeed: String(baseSeed),
    focused: 0,
  };
}

function normMigrate(m) {
  m = m || {};
  return { interval: m.interval | 0, perDeme: Math.max(1, m.perDeme | 0 || 1), topology: m.topology || 'ring' };
}

/** ring by default; 'random' picks a uniform OTHER deme via the cluster sub-stream. */
function destOf(cluster, s) {
  const N = cluster.demes.length;
  if (cluster.migrate.topology === 'random' && N > 1) {
    let d = cluster.migRng.int(N - 1); // 0..N-2
    if (d >= s) d++;                   // skip self → uniform over the other N-1
    return d;
  }
  return (s + 1) % N;
}

/** advance every deme by exactly one tick, then (at migration boundaries) migrate. This is
 *  the ONLY tick-advancement primitive — free-run and single-step both route through it, so
 *  a migration boundary can never be skipped by the speed setting. Returns the shared tick. */
export function demeStep(cluster) {
  const demes = cluster.demes;
  for (let d = 0; d < demes.length; d++) demes[d].step(1);
  const t = demes[0].tick; // all demes share one tick by construction (lockstep)
  const m = cluster.migrate;
  if (m.interval > 0 && demes.length > 1 && t > 0 && t % m.interval === 0) runMigration(cluster);
  return t;
}

/** synchronous two-phase migration. Phase A reads + MOVES emigrants out of every source
 *  (splice, no corpse). Phase B injects them in a fixed (srcDeme, sel) order, reconciling
 *  each into its destination's registry namespace; a per-destination node map persists across
 *  the batch so genetic twins from one source lineage unify. No async, no locks → no deadlock. */
export function runMigration(cluster) {
  const demes = cluster.demes, N = demes.length, m = cluster.migrate;
  // Phase A — collect + emigrate (MOVE)
  const records = [];
  for (let s = 0; s < N; s++) {
    const picks = demes[s].selectMigrants(m.perDeme);
    for (let k = 0; k < picks.length; k++) {
      const spec = demes[s].serializeMigrant(picks[k]);
      const dest = destOf(cluster, s); // may draw cluster.migRng (topology='random'), in source order
      demes[s].emigrate(picks[k]);
      records.push({ srcDeme: s, dest, sel: k, spec });
    }
  }
  // Phase B — inject in a fixed, host-timing-independent order
  records.sort((a, b) => (a.srcDeme - b.srcDeme) || (a.sel - b.sel));
  const nodeMaps = new Map(); // destIndex -> Map<`${srcDeme}_${srcHid}`, destHid>
  for (const r of records) {
    let nm = nodeMaps.get(r.dest);
    if (!nm) { nm = new Map(); nodeMaps.set(r.dest, nm); }
    demes[r.dest].immigrate(r.spec, r.srcDeme, nm);
  }
}

// --- save / load: a cluster container wrapping N per-world states ---

export function clusterToState(cluster) {
  return {
    v: 4, mode: 'demes',
    migrate: cluster.migrate,
    baseSeed: cluster.baseSeed,
    focused: cluster.focused,
    clusterRng: cluster.migRng.state(),
    tick: cluster.demes[0].tick, // canonical lockstep tick
    demes: cluster.demes.map((w) => w.toState()),
  };
}

/** restore into an already-built cluster of matching deme count. Throws (caller toasts) on
 *  a non-deme save or a deme-count mismatch — no best-effort partial load. */
export function clusterFromState(cluster, state) {
  if (!state || state.mode !== 'demes') throw new Error('not a multi-world save');
  if (!Array.isArray(state.demes) || state.demes.length !== cluster.demes.length) {
    throw new Error('this is a ' + (state.demes ? state.demes.length : '?') + '-world save; reopen with ?islands=' + (state.demes ? state.demes.length : '?'));
  }
  cluster.migrate = normMigrate(state.migrate || cluster.migrate);
  if (state.baseSeed != null) cluster.baseSeed = String(state.baseSeed);
  cluster.focused = state.focused || 0;
  cluster.migRng = makeRNG(cluster.baseSeed + '-cluster');
  if (state.clusterRng) cluster.migRng.setState(state.clusterRng);
  const t0 = state.tick;
  cluster.demes.forEach((w, i) => {
    w.fromState(state.demes[i]);
    if (t0 != null && w.tick !== t0) throw new Error('deme ' + i + ' tick desync on load (' + w.tick + ' vs ' + t0 + ')');
  });
}
