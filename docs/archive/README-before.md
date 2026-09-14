> **Archived. Superseded — kept as a record, not as a description of this project.**
>
> **What this file actually is.** This is the README *after* the September 2026 corrections in
> commit `28d140d`, not the pre-audit original. It contains that commit's fixes — for example
> "`CONFIG.protect` is `false` by default" (line 190) and "`sp.count` and `sp.alive` are not
> written only inside `metrics()`" (line 194) — and it does not contain the errors those fixes
> replaced. An earlier version of this note called it the pre-audit original. That was wrong.
>
> **Two statements in this file are still incorrect.** They are annotated rather than edited,
> so the corrections can be checked against what they replaced.
>
> 1. **"built in one night [redacted]. Six months later I audited it"** (line 94) — false, and never
>    true. The simulator was built over several months, and checking its claims against the
>    code was part of that work, not a separate event months later. Removed in commit `85f612c`.
> 2. **"only species IDs differed"** (in the 300-tick observation comparison, line 199) —
>    backwards. In the saved evidence the species identifiers *matched*
>    (`nextSpeciesId` 1 vs 1, `sumSpeciesId` 563 vs 563, `aliveSpecies` 1 vs 1). What differed was
>    the species **bookkeeping ledger**: `peak` was 0 without observation and 563 with it, because
>    `metrics()` wrote it. See `evidence/observer-before-300.json`. The claim confused the fields
>    that were held equal with the field that actually moved.
>
> **One phrase is redacted rather than annotated.** On line 94, a short phrase about how the
> "one night" build was carried out is replaced below with `[redacted]`, separately from the
> falsity correction in item 1 above — a disclosure choice for this release, not a claim about
> what happened. Everything else on that line is quoted unchanged. The same phrase is redacted
> in the `README.md` inside `evidence/original-source.zip`, and that archive omits the original
> `docs/HANDOFF.md` (an internal session note) and drops one ignore pattern from `.gitignore`. Every other file in the archive is byte-identical
> to the original; `evidence/source-manifest.json` lists their hashes.
>
> Everything else here is superseded rather than false.

# 🧬 GENESIS — an evolving ecosystem of neural-network insects

> Watch a population of random twitching specks turn into competent foragers.

GENESIS is a browser artificial-life simulation. Digital insects, each steered by its own
neural network, are dropped into a 2D toroidal world. They sense, move, eat, breed and die.
The ones that find food breed more, passing on mutated copies of their brains and bodies.

**Zero dependencies, zero build step.** Clone it, serve the directory, open the page.

---

## What actually happens (measured, not claimed)

Every number below comes from `tools/headless.mjs`, which runs the simulation without a
browser. Two independent seeds at the default 9,000 ticks:

| | seed 42 | seed 7 |
|---|---:|---:|
| population | 5,592 | 7,992 |
| species | 32 | 55 |
| max generation | 52 | 38 |
| mean hidden nodes/brain | 3.2 | 2.3 |
| mean connections/brain | 33.8 | 32.2 |
| herbivore / carnivore / scavenger | 4225 / 268 / 1099 | 5568 / 521 / 1903 |
| **foraging: random brains → evolved brains** | **3.3 → 13.8 (4.23×)** | **3.0 → 14.6 (4.91×)** |
| toxic fraction of food eaten (chance ≈ 0.50) | 0.448 → 0.390 | 0.421 → 0.343 |

The foraging A/B is the load-bearing number: it replays evolved genomes and freshly randomised
ones through the same arena. **Selection is doing something.**

Two caveats on how to read it. It compares **whole genomes**, so body traits ride along with the
brain — this is not isolated evidence about the network. And these runs pass `protect=1` to the
harness, which is **not** the library default. Both numbers come from the shipped harness; an
independent full re-run has not been done.

### Where you cut the run flips the conclusion

At **300 ticks**, the same benchmark reports random 5.9 vs evolved 3.3 — an *improvement of
0.55×*. Evolution looks actively harmful. At 9,000 ticks it is 4.23×.

It is tempting to say "nothing changed except the horizon". That is not accurate.
Shortening the evolution phase also changes the sampling interval, and the benchmark's shuffle
draws from a shared RNG whose consumption depends on how many creatures are alive — so
**the random control group changes too** (`headless.mjs:24, 104-124`). The comparison is real, but
it is not a clean single-variable manipulation.

The measured figures: evolved 3.259789 vs control 5.915556, ratio 0.551054. Of the 30 sampled
creatures, 14 were still first-generation.

### Trophic structure is a succession, not a steady state

Tracking seed 42:

```
tick     pop   species  hidden   herb   carn   scav
   1     400      1      0.0      400      0      0
1201    2745      2      0.4     2597    101     47
2401    3968      6      0.9     3100    826     42
3601    4943     11      1.2     4166    662    115
6001    5194     27      2.1     4405    336    453
9000    5592     32      3.2     4225    268   1099
```

Carnivores boom to 826 and then fall back to 268 while scavengers climb monotonically to 1,099.

---

## Corrections to earlier versions of this README

This project was built in one night [redacted]. Six months later I audited it against
the code. **Several headline claims did not survive.** They are listed here rather than quietly
deleted.

### "There is no fitness function" — false

`world.js:221` uses `eaten` as a fitness scalar to pick which parent dominates during crossover.
This is on by default. A second, fuller fitness fold (`_foldFitness`, `world.js:432,439-452`,
per-creature `eaten / max(age, maturity)`) also exists, though it is off by default
(`config.js:93`).

Selection here is still driven by energy, reproduction and death — but **a fitness scalar is
computed and used**, and saying otherwise was wrong.

### "Learned avoidance" — should be *evolved*

There is **no lifetime learning**. Weights change only at reproduction, via `mutateBrain`
(`neat.js:99`, `creature.js:31`). Toxin avoidance is inherited, not acquired. The README
contradicted itself: another line already said "creatures evolve to steer".

Avoidance is also modest: 0.390 and 0.343 against a chance level of 0.50, and it varies by seed.

### "Zero-copy SharedArrayBuffer" — false

The SAB path copies the whole snapshot (`main.js:84`) — **590,432 bytes** for a single default
world. `postMessage` is gone; the copy is not.

Two refinements over how I first wrote this. The copy is **conditional**: an odd sequence value
means a write is in flight and the read is skipped; on an even value it copies, and discards the
result if the sequence changed underneath (`main.js:80-91`). Island mode has a different size.
And calling `readSAB()` twice with an unchanged sequence copies twice (1,180,864 bytes for two
calls) — whether that costs anything measurable is **not measured**.

Nor is the fallback wholly zero-copy: what it avoids is a structured clone, by transferring
`ArrayBuffer` ownership between threads. Packing the snapshot and uploading it to WebGL still copy
(`sim.worker.js:72-75`, `render-snapshot.js:20-51`, `gl-renderer.js:172-176`).

Also: the SAB path only activates when the page is cross-origin isolated. `python -m http.server`
and GitHub Pages do not send COOP/COEP, so they silently fall back.

### "None of these niches is designed in — they emerge" — partly false

Carnivory is gated by a hard `diet > 0.5` branch (`creature.js:130`) whose threshold is a literal
not even exposed in `CONFIG`. Scavengers are not a separate population at all — **every creature
eats carrion**, and `scavenge` is an efficiency coefficient (0.2–1.4). The `> 0.95` test at
`world.js:473` is a display label, nothing more.

What emerges is *where lineages sit along those axes*. **The niches themselves were dug by hand.**

Similarly, foraging, hunting, mate-seeking and reproduction all fire from explicit rules
(`world.js:149-164, 194-212, 243-258`). **What the network actually controls is steering.**

### Numbers that were wrong

| Claim | Actual |
|---|---|
| "grows minds from 26 connections" | **32** — `nIn × nOut = 16 × 2` (`neat.js:79-83`). 26 is left over from a 13-input version |
| "brain complexity climbs, visible in the avg-connections chart" | mean connections barely move (32.0 → 32.3 → 31.9 over 3,000 ticks). **Mean hidden nodes** is what grows (0 → 3.2) |
| speed slider "0–24" | `index.html:52` is `max="20"` |
| sample output (tick 10000, pop 649, conns 27.1) | does not reproduce on current code (measured: pop 5,455, conns 32.3) |
| "global innovation number" | per-World (`neat.js:13-17`, `world.js:59`) |
| "~15,000 instances in 0.29 ms/frame" | **the benchmark that produced this is not in the repository.** Unverifiable here |
| "Fitness sharing — toggle `CONFIG.protect`" | `protect` is a legacy rarity scheme, explicitly "superseded by `fitShare`" (`config.js:75`). The real one is `CONFIG.fitShare` (`config.js:93`) |
| the recorded finding that fitness sharing lowers mean hidden nodes 0.58 → 0.47 | re-measured at defaults: unprotected 0.46 / fitshare 0.47. **The direction reverses.** The stated reason for defaulting `fitShare` off does not reproduce |

### Determinism, precisely

`src/rng.js` is a seeded sfc32, so a run *is* reproducible from its seed — with two caveats:

- `CONFIG` is a mutable global and is **not** captured by `toState()` (`world.js:537-544`).
  Touching the food-rate or mutation-rate sliders breaks reproduction from the same seed.
- `toState()` rounds coordinates to 2 decimals and weights to 4 (`world.js:513-518`).
  **Save→restore is not bit-identical to continuing the run.**

`~40% of food is poisonous` is an expectation: each of the 14 blooms draws independently
(`world.js:92`), so the realised fraction varies by seed. 18% of food is scattered uniformly
outside blooms with its own per-item 40% draw, and the initial 7,500 items are fully uniform.

### `World.metrics()` is not read-only

`metrics()` looks like a getter. It is not. On every call it writes species bookkeeping
(`world.js:465, 482`) — `sp.count`, `sp.alive`, `sp.lastSeen`, `sp.peak` — and it **consumes the
birth/death counters** (`world.js:504-507`): call it twice in a row and the second call reports
0/0 for a window in which births and deaths occurred. Two independent readers interfere with
each other.

Two paths lead from that bookkeeping back into the simulation:

- **`world.js:265`** — `_assignSpecies` only places an offspring into an existing species
  `if (sp.alive && ...)`.
- **`creature.js:154`** — when `CONFIG.protect` is enabled, the reproduction threshold is scaled
  by `sp.count / pop`.

**How much this actually matters is narrower than it looks, and I got the first version of this
section wrong.** Three corrections:

- **`CONFIG.protect` is `false` by default** (`config.js:75`), as is `fitShare` (`config.js:93`).
  The `creature.js:154` path is dormant unless you turn it on. The measured runs in this README
  used `protect=true` because `tools/headless.mjs` takes it as its third argument — that is the
  harness, not the default.
- **`sp.count` and `sp.alive` are not written only inside `metrics()`.** Both are also set at
  species creation, birth, death, migration and restore
  (`world.js:101, 113, 232, 271, 305, 338, 426, 599-605`).
- **Observation frequency does not obviously change individual trajectories.** Running seed 42 for
  300 ticks with `metrics()` never called versus called every tick, the strict per-creature state
  matched at every checkpoint; only species IDs differed. Both runs stayed at one species, so this
  is not evidence about long runs — but it is evidence against the strong claim.

What survives: **`metrics()` mutates state, and the species-assignment path
(`world.js:265`) is real.** If you are measuring this simulation, read state directly and keep
`metrics()` out of the loop. (`stats.js:23` calls it with the comment "reconciles live species
counts" — that reconciliation is the side effect.)

### Innovation numbers can collide

Split a connection, re-enable the original, and split it again: the code checks only whether the
node already exists, then adds the connection a second time
(`neat.js:103-108, 148-156`). Evaluation treats the two as separate edges; crossover keys them by
the same innovation number in a `Map` and silently drops one
(`neat.js:162-175, 325-343`).

Worked example: 6 connections in, 4 out after crossing a brain with itself and no mutation, output
moving 0.958575910 → 0.642014992. With ordinary mutation (seed `duplicate-check`, 16×2 starting
brain), innovations 92 and 93 each appear twice by mutation 580.

How often this happens in a normal run, and whether it affects the 9,000-tick results, is
**not measured**.

### `add-node` is not function-preserving

Inserting a hidden node splits a connection and routes it through `tanh`, so the same input does
not produce the same output (`neat.js:148-156, 336-343`): 0.761594 → 0.642015 in a worked example.
Classic NEAT treats add-node as (approximately) neutral; this implementation does not.

### Saving drops `eaten`

`toState()` does not serialise `eaten` (`world.js:512-519`), and restored creatures start at 0
(`world.js:583-586`, `creature.js:40`). In a 30-tick run under seed `save-eaten`, all 182
creatures that had eaten came back with `eaten = 0`.

That value feeds the crossover dominance check, so this is a state loss on top of the coordinate
rounding — not the same problem.

### Stale handoff notes

`docs/HANDOFF.md` records `migration-cluster-test` as failing with exit 137 (OOM).
Re-run during the audit: **11/11 passed in 112 s, exit 0.** Its regression command
(`node tools/headless.mjs --ticks 400 --pop 200`) also takes no such flags — it parses to
`NaN` and runs zero ticks while exiting 0.

---

## Running it

```sh
node serve.mjs          # or: python3 -m http.server 8000
```

Headless, no browser:

```sh
node tools/headless.mjs [ticks] [seed] [protect 0|1]   # defaults: 9000, ...
```

Tools: `headless.mjs` (time series + foraging A/B), `neat-test.mjs`, `fitshare-ab.mjs`,
`migration-test.mjs`, `migration-cluster-test.mjs`, `make-banner.mjs`.

## Architecture

`src/` — `world.js` (step loop, food, reproduction) · `creature.js` · `genome.js` ·
`neat.js` (innovation numbers, structural mutation, innovation-aligned crossover) ·
`spatialgrid.js` · `behaviortree.js` · `cluster.js` (island migration) · `rng.js` · `vec.js` ·
`config.js` — and the view layer: `renderer.js`, `gl-renderer.js`, `netviz.js`, `charts.js`,
`heatmap.js`, `muller.js`, `camera.js`, `ui.js`, `persistence.js`, `render-snapshot.js`.

`sim.worker.js` runs the world at a fixed 60 Hz interval (`sim.worker.js:62`), stepping
`stepsPerTick` times per period. Population is capped at boot by `maxPopulation`
(default 8,000), which also fixes the snapshot buffer size.

The NEAT implementation is the real thing: innovation numbers, add-node and add-connection
mutations, and crossover aligned on innovation numbers where matching genes are inherited whole
from one parent rather than averaged.

## License

MIT — see `LICENSE`.
