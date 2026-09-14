// GENESIS — global, live-tunable configuration.
// A single mutable object so the UI can tweak parameters while the world runs.
// Brain inputs/outputs (nIn/nOut) are fixed at world creation; hidden structure
// is grown by NEAT. Changing nIn/nOut requires a reset.

export const CONFIG = {
  // --- World ---
  // Large, because the simulation runs in a Web Worker decoupled from rendering,
  // so the main thread stays at 60fps even with a few thousand creatures.
  width: 3200,
  height: 2100,
  seed: 1337,

  // --- Brain (NEAT — topology evolves) ---
  // Inputs (16): nectar×3 + toxic×3 + carrion×3 + creature×3 + energy + speed
  //              + oscillator + bias  ← BIAS MUST STAY LAST
  // Nectar and toxic food are sensed on SEPARATE directional antennae and grow in
  // separate spatial clusters, so "approach nectar, avoid toxic" evolves as a
  // steering behaviour — visible toxin avoidance, using the same machinery as
  // foraging. Outputs (2): turn, thrust. Eating is automatic on contact.
  // NOTE: changing nIn/nOut requires a reset and invalidates older save files.
  nIn: 16,
  nOut: 2,
  sensorCount: 3, // antennae per sense channel (left / center / right)
  neat: {
    weightMutRate: 0.8, // chance each weight is perturbed on reproduction
    weightStep: 0.18, // gaussian sigma of a weight nudge
    weightReplaceChance: 0.07, // chance a perturbed weight is replaced outright
    toggleChance: 0.03, // chance to flip a connection's enabled bit
    addConnChance: 0.30, // chance to grow a new connection
    addNodeChance: 0.12, // chance to split a connection with a new node
  },
  speciesThreshold: 0.9, // compatibility distance that splits off a new species

  // --- Population ---
  startPopulation: 400,
  maxPopulation: 8000, // WebGL renders this smoothly; the worker sim step is the ceiling

  // --- Food ---
  // Abundant, because creatures avoid the ~40% that is toxic — the nectar alone
  // must comfortably feed the population, or they starve and eat toxins anyway.
  startFood: 7500,
  maxFood: 16000,
  foodRate: 95, // pellets spawned per simulation tick (averaged)
  foodEnergy: 28, // energy gained per nectar pellet
  foodDecay: 280, // ticks an uneaten pellet lasts before it rots
  // Toxic food poisons whatever eats it. Nectar and toxic grow in SEPARATE blooms
  // (spatially clustered), so creatures can evolve to steer toward nectar patches
  // and away from toxic ones — avoidance you can watch.
  toxinFraction: 0.4, // share of blooms (and food) that is toxic
  toxinEnergy: 22, // energy LOST when a toxic pellet is eaten (vs +28 for nectar)
  bloomCount: 14, // drifting fertility centers; each is a nectar OR toxic patch
  bloomFraction: 0.82, // share of food spawned inside a (typed) bloom vs. scattered
  bloomSpread: 110, // gaussian spread of a bloom (world units)

  // --- Metabolism / life ---
  maxEnergy: 200,
  baseMetabolism: 0.045, // energy/tick scaled by body size
  moveMetabolism: 0.0065, // energy/tick scaled by speed
  startEnergy: 110,
  maturity: 50, // minimum age before reproduction (ticks)
  maxAge: 2000, // soft lifespan; jittered per creature by a gene (fast turnover → fast evolution)
  eatRadius: 7,

  // --- Reproduction ---
  reproduceThreshold: 165, // energy needed to reproduce
  reproduceCost: 95, // energy parent spends to give birth
  childEnergyShare: 0.62, // fraction of reproduceCost handed to the child

  // --- Reproductive protection (NEAT fitness sharing, continuous-sim variant) ---
  // Rare/novel species reproduce sooner (lower effective threshold) so a fresh
  // topology isn't out-competed before it can be tuned. Protection auto-withdraws
  // as a species grows common (negative frequency-dependence) → self-limiting.
  // protect:false (or protectMin:1) reproduces the unprotected world bit-for-bit.
  protect: false, // legacy scheme (rarity-based); superseded by fitShare below
  protectShare: 0.06, // a species at ≥6% of the population gets no protection
  protectMin: 0.90, // the rarest species reproduce at 0.90× the energy threshold

  // --- Fitness sharing (real NEAT, continuous-sim variant) ---
  // Each species earns a birth-rate multiplier from how well its members actually
  // forage RELATIVE to its population share. High per-member harvest rate + small
  // share → reproduce sooner (protect a genuinely good new topology); low fitness or
  // over-represented → reproduce later (tax dominant/junk lineages). Unlike the
  // rarity-only `protect`, this rewards MEASURED success, so beneficial add-node
  // mutants entrench before drift erodes them → bolder, functional hidden growth.
  // Per-member fitness = eaten / max(age, maturity), smoothed per species (EMA).
  // fitShare:false OR fitShareMin==fitShareMax==1 reproduces the unprotected world.
  // FINDING (3-arm headless A/B, tools/fitshare-ab.mjs): this is correct real-NEAT
  // fitness sharing (deterministic, size-invariant), BUT in GENESIS's ~linearly-
  // separable foraging task the highest-fitness lineages ARE the leanest brains, so
  // rewarding fitness rewards leanness — avgHidden DROPS vs unprotected (0.47 vs
  // 0.58). Kept OFF by default; a legit toggle for tasks that actually need depth.
  fitShare: false,
  fitAlpha: 0.02, // EMA smoothing of per-species mean fitness rate (~50-tick)
  fitShareMin: 0.80, // an elite, under-bred species reproduces at 0.80× threshold
  fitShareMax: 1.15, // an over-bred / low-fitness species is taxed to 1.15×
  fitShareGain: 1.0, // log-ratio scale (rho within [1/e, e] spans the full range)
  epsShare: 1e-3, // floor on a species' target share (guards new/zero-fitness species)

  // --- Evolution ---
  mutationRate: 0.16, // probability each gene/weight is perturbed
  mutationStep: 0.22, // gaussian sigma of a perturbation
  bigMutationChance: 0.03, // chance a perturbed gene takes a large jump

  // --- Predation (the second trophic level — must evolve from herbivores) ---
  // A creature with diet > 0.5 is a carnivore: it can kill a meaningfully
  // smaller creature it touches and metabolise it. This lets a food chain
  // emerge without being designed in.
  carnivoreThreshold: 0.5, // genetic predation gate; shared by metrics and renderers
  scavengerLabel: 0.95, // label only: scavenging efficiency is continuous
  predationSizeEdge: 1.12, // predator must be this× larger than prey
  meatFromEnergy: 0.55, // share of prey's energy the predator absorbs
  meatPerSize: 20, // flat energy per unit of prey body size

  // --- Carrion & scavenging (the third trophic level) ---
  // Every death leaves a corpse; predation leaves scraps. Creatures eat carrion
  // with an efficiency set by their SCAVENGE gene, so a decomposer niche can
  // evolve and the nutrient loop closes.
  maxCarrion: 5800,
  carrionPerSize: 30, // corpse energy per unit body size
  carrionFromEnergy: 0.5, // plus this share of the dead creature's leftover energy
  carrionBite: 22, // base energy per carrion meal (×scavenge efficiency)
  carrionDecay: 1100, // ticks before a corpse rots away
  predationLeftover: 0.45, // share of prey size left as scraps after a kill

  // --- Sexual reproduction ---
  sexualChance: 0.5, // chance a ready parent seeks a mate instead of cloning
  mateRadius: 64, // how far it looks for a compatible, mature partner

  // --- Movement ---
  maxTurn: 0.32, // radians/tick at full turn, scaled by 1/size
  speedRef: 3.2, // reference speed for metabolism normalisation

  // --- Simulation runtime ---
  statsEvery: 8, // sample the time-series every N ticks
  historyPoints: 320, // points kept per stats series
};

// Convenience: the per-creature sense layout the brain expects.
export const SENSE = {
  FOOD: 0, // indices 0..sensorCount-1
  FOE: 1, // indices sensorCount..2*sensorCount-1
};
