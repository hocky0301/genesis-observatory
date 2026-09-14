# Rereading my own original GENESIS snapshot

I reread the unmodified `work/original` source myself and ran small controlled reproducers, without assuming that my earlier planning notes, comments, earlier read-throughs, or performance numbers I had reported earlier were correct. Paths and line numbers below identify the original snapshot; functions remain the durable reference after editing. Observer-frequency simulation results are recorded separately by the main observer harness.

## The two observer measurements do not make the same claim

The reported 300-tick experiment uses seed 42 and the ordinary world configuration; its source report says only one species existed throughout. The reported 211 → 231 experiment instead uses seed 1337, 1,500 ticks, 120 initial creatures, population cap 700, a 1200 × 900 world, compatibility threshold 0.35, and mutation rate 0.30. Its table labels those values **total species ever created**, not currently living species. Its own prose says physical coordinate/energy sums agree to three decimal places when both reproductive schemes are off.

Those statements are compatible. A short, single-species run cannot test reassignment into extinct species. A difference in species labels does not itself establish a change in the organisms' physical trajectory. My earlier notes lose these distinctions when they present the results as an unresolved numerical conflict.

The old report's separate `protect` / `fitShare` table says the population cap was made “effectively unlimited” without recording its actual value. Its exact population figures cannot be reconstructed from that description alone. Rounded sums are also weaker evidence than exact per-creature state and RNG comparisons.

## Causal paths checked in code

- `World.metrics()` (`src/world.js:459–507`) rewrites species count/liveness/peak/lastSeen and clears birth/death counters. Repeated readers interfere even if no physical state changes.
- `_assignSpecies()` (`src/world.js:260–274`) consults stale `sp.alive` when searching nonparent species. Consequently an empty species may accept a new member until an observation marks it extinct. Its parent-species fast path does not check either `alive` or `count`.
- `_findMate()` (`src/world.js:243–258`) uses distance and direct genome compatibility. It does **not** use species IDs. Species reassignment uses no randomness. With both reproductive schemes off, this label-only path has no source-level route back into movement, feeding, mutation, or mating.
- `Creature.update()` (`src/creature.js:137–155`) gives two physical feedback paths: `protect` reads species population share; `fitShare` accumulates per-species harvest rates and uses the `_rho` ratio frozen by `_foldFitness()`. Their presence establishes a conditional route, not the magnitude or inevitability of divergence in a particular run.
- Ordinary deaths decrement species membership only in the end-of-step sweep. Newborns join the species immediately but enter the creature array later in the same step. `cataclysm()` marks creatures dead pending that sweep. Any live-count invariant must state whether it applies to settled tick boundaries or these intermediate states.

## New direct regressions, reproduced before editing

`tools/core-edge-test.mjs` can import the original tree via `GENESIS_SOURCE_DIR`. The original run exited **1**, with **9 failed cases**; complete output is in `core-edge-before.log`. These fixtures are intentionally small and are correctness tests, not ecological or performance estimates.

1. **Repeated structural mutation creates duplicate innovation IDs.** `addNode()` (`src/neat.js:148–157`) checks whether its reused node exists but appends both reused connection innovations unconditionally. Splitting one connection, reenabling the original, and splitting it again produces five connections but only three innovation IDs. `crossoverBrain()` uses Maps keyed by innovation, so even identical parents lose duplicates during crossover. Preserve the existing connection's identity and learned weight when reusing a split.
2. **Between ticks, `population()` can count a newborn twice.** `step()` appends `births` to `creatures` but does not empty `births` afterward. A one-parent, one-birth fixture has two creatures but reports population three. This also affects migration capacity checks between steps. The pending queue must be empty once births have been integrated.
3. **Checkpointing discards exact creature state.** `toState()` / `fromState()` (`src/world.js:510–650`) round position, heading, phase, energy and connection weights; assign new creature IDs; and omit speed, eaten, kills, alive and predated. A controlled 30-tick fixture directly lost or rounded IDs, x/y, heading, energy, phase, speed and eaten. Speed is a next-tick sensory input; eaten is used in crossover fitness and sharing.
4. **Checkpointing changes indexed resources and reuse order.** Live food/carrion are compacted and rounded, and free-index stacks are rebuilt. Exact continuation must preserve occupied indices, values and free-list order, not only totals.
5. **Restored populated species remain marked dead.** The old restoration increments count after initializing `alive:false` but never reconciles liveness. Calling metrics afterward hides this defect while changing state.
6. **Saving pending deaths revives organisms.** `cataclysm(1)` followed immediately by save/load revived all 30 organisms in a controlled fixture. Preserve alive/predated state or make the event synchronous with well-defined accounting.
7. **Exact continuation fails at the first resumed tick** under default, protect and fitShare configurations. The tests compare creature/genome state, occupied resource pools, free lists, RNG streams, innovation registry, counters needed for identity, bloom state, and species state—not merely aggregate metrics.

## Problems in the proposed acceptance criteria

- The existing headless “count-integrity assertion” is a console message, not an assertion; `MISMATCH` does not produce a failing exit status. Its final metrics call has already rebuilt the counts, making the check circular. Validate before invoking any reader and fail on mismatch.
- Sum fingerprints can collide or conceal reordered/reassigned individuals. Compare exact canonical state and RNG streams, with separate physical and lineage sections so a bookkeeping failure is not mislabeled as a physical one.
- Comparing only resumed `metrics()` after 100 ticks is insufficient for checkpoint fidelity. Round-trip field checks and per-tick continuation detect missing state and identify the first divergence.
- `avgConns` counts **enabled** connections (`complexity()`); subtracting the initial dense network's connection count yields a signed net change in active connections, not the count of structurally “added connections.” Label the proposed `avgAddedConns` accordingly or count structural additions explicitly.
- Updating `lastSeen` only on entry/exit leaves a long-lived, unchanged species with a stale “last seen” tick. Define it as last living tick and update on simulation time, or rename it to last membership-change tick. Similarly define whether peak includes births before same-tick deaths.
- Headless foraging compares complete genomes, not brains alone; a shared sampling RNG also changes the random control genomes when the survivor cohort changes. Do not reuse the old “4× smarter brains” interpretation. The toy toxin inputs are already separated; this is not evidence of solving XOR.

## Prerequisites for a defensible Ecology Lab

An intervention and its control should branch from the **same exact checkpoint**, including effective configuration, IDs, age/speed/harvest state, resource slots/free lists, species state, both RNG streams, and innovation history. Preserve the checkpoint before applying any knob change. Apply exactly one documented intervention to one arm, step both by the same integer tick horizon, and record each arm's effective settings and endpoint.

The old `CONFIG` is a mutable module singleton. Interleaving two worlds with different settings requires explicit per-world configuration or isolated workers; merely constructing two `World` objects does not isolate interventions. The baseline and intervention must share initial randomness, but their future random streams may legitimately diverge after different births/deaths. User predictions should be compared with the measured endpoint rather than with the 6,617 / 3,446 / 4,051 figures I had reported earlier, whose full experimental provenance is not present here.

Retaining `protect` and `fitShare` as documented, disabled-by-default experimental modes avoids silently changing scientific scope. Any remaining model limitations should use identical wording in the app, README, article draft and film.
