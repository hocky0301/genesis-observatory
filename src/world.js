// The simulation world: a toroidal plane holding creatures, plant food, and
// carrion. Each step it rebuilds the spatial grids, drifts the food "blooms",
// spawns food, ages carrion, runs every creature, then folds in newborns and
// turns the dead into corpses. Three feeding niches (grazing, hunting,
// scavenging), sexual reproduction, and speciation all emerge on top.

import { CONFIG } from './config.js';
import { makeRNG } from './rng.js';
import { SpatialGrid } from './spatialgrid.js';
import { Creature } from './creature.js';
import { randomGenome, mutate, crossover, decodeBody, genomeDistance, GENE_COUNT } from './genome.js';
import { InnovationRegistry, cloneBrain, complexity, maxIds, minimalBrain, remapBrain, NODE } from './neat.js';
import { wrap, lerp } from './vec.js';

export class World {
  constructor() {
    this.width = CONFIG.width;
    this.height = CONFIG.height;
    this.topo = { nIn: CONFIG.nIn, nOut: CONFIG.nOut };
    this.maxFood = CONFIG.maxFood;
    this.maxCarrion = CONFIG.maxCarrion;

    // plant food (parallel typed arrays + free-list). cueA[i]===1 ⟺ the pellet is
    // toxic; it also drives which antenna channel senses it and how it's drawn.
    this.foodX = new Float32Array(this.maxFood);
    this.foodY = new Float32Array(this.maxFood);
    this.foodAlive = new Uint8Array(this.maxFood);
    this.foodLife = new Float32Array(this.maxFood); // uneaten food rots, so avoided toxic doesn't blanket the world
    this.cueA = new Uint8Array(this.maxFood);
    this.foodFree = [];
    this.foodCount = 0;

    // carrion (corpses): position + remaining energy + remaining lifetime
    this.carrionX = new Float32Array(this.maxCarrion);
    this.carrionY = new Float32Array(this.maxCarrion);
    this.carrionE = new Float32Array(this.maxCarrion);
    this.carrionLife = new Float32Array(this.maxCarrion);
    this.carrionAlive = new Uint8Array(this.maxCarrion);
    this.carrionFree = [];
    this.carrionCount = 0;

    this.creatureGrid = new SpatialGrid(this.width, this.height, 72);
    this.foodGrid = new SpatialGrid(this.width, this.height, 56);
    this.carrionGrid = new SpatialGrid(this.width, this.height, 56);
    this.byId = new Map();
    this.species = new Map();

    this.reset(CONFIG.seed);
  }

  reset(seed) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    // dedicated sub-stream for migration + cataclysm events, so those NEVER consume the
    // per-step world.rng — a deme's step trajectory stays byte-identical to a solo run
    // between migrations (island-model determinism, see migration methods below).
    this.migRng = makeRNG(seed + '-mig');
    this._nextId = 1; // per-world creature id counter (seeds each creature's phase)
    this.innov = new InnovationRegistry(this.topo.nIn, this.topo.nOut);
    this.creatures = [];
    this.byId.clear();
    this.species.clear();
    this.nextSpeciesId = 1;
    this.births = [];

    this.foodAlive.fill(0);
    this.cueA.fill(0);
    this.foodFree.length = 0;
    for (let i = this.maxFood - 1; i >= 0; i--) this.foodFree.push(i);
    this.foodCount = 0;
    this.foodAccum = 0;
    this._goodEaten = 0;
    this._toxicEaten = 0;

    this.carrionAlive.fill(0);
    this.carrionFree.length = 0;
    for (let i = this.maxCarrion - 1; i >= 0; i--) this.carrionFree.push(i);
    this.carrionCount = 0;

    this.tick = 0;
    this.generationMax = 1;
    this._birthsTotal = 0;
    this._deathsTotal = 0;

    // drifting fertility centres — each is a nectar OR toxic patch
    this.blooms = [];
    for (let i = 0; i < CONFIG.bloomCount; i++) {
      this.blooms.push({
        x: this.rng.range(0, this.width),
        y: this.rng.range(0, this.height),
        a: this.rng.range(0, Math.PI * 2),
        toxic: this.rng.next() < CONFIG.toxinFraction,
      });
    }

    // founding species
    const rep = randomGenome(this.rng, this.topo.nIn, this.topo.nOut, this.innov);
    this.species.set(1, {
      id: 1, parent: 0, birthTick: 0, color: decodeBody(rep.body).hue,
      repGenome: { body: rep.body.slice(), brain: cloneBrain(rep.brain) },
      count: 0, peak: 0, alive: false, lastSeen: 0, fitSum: 0, fitN: 0,
    });

    // seed life and food
    for (let i = 0; i < CONFIG.startPopulation; i++) {
      const g = randomGenome(this.rng, this.topo.nIn, this.topo.nOut, this.innov);
      const c = new Creature(
        this.newId(), this.rng.range(0, this.width), this.rng.range(0, this.height),
        this.rng.range(0, Math.PI * 2), g, 1, this.topo, 1,
      );
      this.creatures.push(c);
      this._spEnter(this.species.get(1));
    }
    this.spawnFood(CONFIG.startFood, true);
  }

  /** per-world creature id (deterministic; seeds each creature's oscillator phase) */
  newId() { return this._nextId++; }

  // counts pending newborns too, so the population cap holds within a tick
  population() { return this.creatures.length + this.births.length; }

  // --- plant food ---
  spawnFood(n, uniform = false) {
    const W = this.width, H = this.height;
    for (let i = 0; i < n; i++) {
      if (this.foodFree.length === 0 || this.foodCount >= CONFIG.maxFood) break;
      const idx = this.foodFree.pop();
      let x, y, toxic;
      if (!uniform && this.rng.next() < CONFIG.bloomFraction) {
        // grow inside a bloom; the food inherits the bloom's nectar/toxic type,
        // so nectar and toxic end up in spatially separated patches
        const b = this.rng.pick(this.blooms);
        x = wrap(b.x + this.rng.gauss() * CONFIG.bloomSpread, W);
        y = wrap(b.y + this.rng.gauss() * CONFIG.bloomSpread, H);
        toxic = b.toxic;
      } else {
        x = this.rng.range(0, W); y = this.rng.range(0, H);
        toxic = this.rng.next() < CONFIG.toxinFraction;
      }
      this.foodX[idx] = x; this.foodY[idx] = y; this.cueA[idx] = toxic ? 1 : 0;
      this.foodLife[idx] = CONFIG.foodDecay; this.foodAlive[idx] = 1; this.foodCount++;
    }
  }

  /** consume all food within r; returns SIGNED energy (toxic pellets are negative).
   *  Nectar and toxic grow in separate patches, so a creature that steers into a
   *  nectar bloom eats mostly nectar. */
  eatNear(x, y, r) {
    let gained = 0;
    const r2 = r * r, W = this.width, H = this.height;
    this.foodGrid.queryRadius(x, y, r, (idx) => {
      if (!this.foodAlive[idx]) return;
      let dx = this.foodX[idx] - x; dx -= W * Math.round(dx / W);
      let dy = this.foodY[idx] - y; dy -= H * Math.round(dy / H);
      if (dx * dx + dy * dy <= r2) {
        const toxic = this.cueA[idx]; // toxic ⟺ cueA
        this.foodAlive[idx] = 0; this.foodFree.push(idx); this.foodCount--;
        if (toxic) { gained -= CONFIG.toxinEnergy; this._toxicEaten++; }
        else { gained += CONFIG.foodEnergy; this._goodEaten++; }
      }
    });
    return gained;
  }

  // --- carrion ---
  spawnCorpse(x, y, energy) {
    if (this.carrionFree.length === 0 || energy <= 0) return;
    const idx = this.carrionFree.pop();
    this.carrionX[idx] = x; this.carrionY[idx] = y;
    this.carrionE[idx] = energy; this.carrionLife[idx] = CONFIG.carrionDecay;
    this.carrionAlive[idx] = 1; this.carrionCount++;
  }

  eatCarrionNear(x, y, r) {
    let gained = 0;
    const r2 = r * r, W = this.width, H = this.height;
    this.carrionGrid.queryRadius(x, y, r, (idx) => {
      if (!this.carrionAlive[idx]) return;
      let dx = this.carrionX[idx] - x; dx -= W * Math.round(dx / W);
      let dy = this.carrionY[idx] - y; dy -= H * Math.round(dy / H);
      if (dx * dx + dy * dy <= r2) {
        const take = Math.min(CONFIG.carrionBite, this.carrionE[idx]);
        this.carrionE[idx] -= take; gained += take;
        if (this.carrionE[idx] <= 0) {
          this.carrionAlive[idx] = 0; this.carrionFree.push(idx); this.carrionCount--;
        }
      }
    });
    return gained;
  }

  // --- predation ---
  huntNear(pred) {
    const W = this.width, H = this.height;
    const reach = CONFIG.eatRadius + pred.body.size * 4.5;
    const r2 = reach * reach;
    let victim = null;
    this.creatureGrid.queryRadius(pred.x, pred.y, reach, (cid) => {
      if (victim || cid === pred.id) return;
      const other = this.byId.get(cid);
      if (!other || !other.alive) return;
      if (pred.body.size <= other.body.size * CONFIG.predationSizeEdge) return;
      let dx = other.x - pred.x; dx -= W * Math.round(dx / W);
      let dy = other.y - pred.y; dy -= H * Math.round(dy / H);
      if (dx * dx + dy * dy <= r2) victim = other;
    });
    if (!victim) return 0;
    victim.alive = false;
    victim.predated = true;
    return victim.energy * CONFIG.meatFromEnergy + CONFIG.meatPerSize * victim.body.size;
  }

  // Membership counts refer to settled arrays plus queued births. Deaths are
  // committed at the end of a step; readers never reconcile or repair them.
  _spEnter(sp) {
    sp.count++; sp.alive = true;
    sp.peak = Math.max(sp.peak, sp.count); sp.lastSeen = this.tick;
  }
  _spLeave(sp) {
    if (sp.count <= 0) throw new Error(`Species ${sp.id} count underflow`);
    sp.count--; sp.alive = sp.count > 0; sp.lastSeen = this.tick;
  }
  // Load-only reconstruction for legacy saves. Never call during simulation.
  _rebuildSpeciesCounts() {
    for (const sp of this.species.values()) { sp.count = 0; sp.alive = false; }
    for (const c of this.creatures) {
      const sp = this.species.get(c.speciesId);
      if (!sp) throw new Error(`Missing species ${c.speciesId}`);
      sp.count++; sp.alive = true;
      if (!sp.repGenome) sp.repGenome = {body:c.genome.body.slice(), brain:cloneBrain(c.genome.brain)};
    }
    for (const sp of this.species.values()) sp.peak = Math.max(sp.peak, sp.count);
  }

  // --- reproduction (sexual with a nearby mate, else clone) ---
  reproduce(parent) {
    let childGenome, childGen = parent.generation + 1;

    let mate = null;
    if (this.rng.chance(CONFIG.sexualChance)) mate = this._findMate(parent);
    if (mate) {
      const aFitter = parent.eaten >= mate.eaten;
      const combined = crossover(parent.genome, mate.genome, this.rng, aFitter);
      childGenome = mutate(combined, this.rng, CONFIG.mutationRate, CONFIG.mutationStep, CONFIG.bigMutationChance, CONFIG.neat, this.innov);
      childGen = Math.max(parent.generation, mate.generation) + 1;
    } else {
      childGenome = mutate(parent.genome, this.rng, CONFIG.mutationRate, CONFIG.mutationStep, CONFIG.bigMutationChance, CONFIG.neat, this.innov);
    }

    parent.energy -= CONFIG.reproduceCost;
    const speciesId = this._assignSpecies(childGenome, parent.speciesId);
    const sp = this.species.get(speciesId); // live count: ++ here, -- at the one death site
    if (sp) this._spEnter(sp);
    const r = parent.body.size * 6 + 4;
    const x = wrap(parent.x + this.rng.range(-r, r), this.width);
    const y = wrap(parent.y + this.rng.range(-r, r), this.height);
    const child = new Creature(this.newId(), x, y, this.rng.range(0, Math.PI * 2), childGenome, childGen, this.topo, speciesId);
    child.energy = CONFIG.reproduceCost * CONFIG.childEnergyShare;
    this.births.push(child);
    if (childGen > this.generationMax) this.generationMax = childGen;
    this._birthsTotal++;
  }

  _findMate(parent) {
    const W = this.width, H = this.height, r = CONFIG.mateRadius, r2 = r * r;
    let mate = null, bestD = r2;
    this.creatureGrid.queryRadius(parent.x, parent.y, r, (cid) => {
      if (cid === parent.id) return;
      const o = this.byId.get(cid);
      if (!o || !o.alive || o.age < CONFIG.maturity) return;
      let dx = o.x - parent.x; dx -= W * Math.round(dx / W);
      let dy = o.y - parent.y; dy -= H * Math.round(dy / H);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD && genomeDistance(parent.genome, o.genome) <= CONFIG.speciesThreshold) {
        bestD = d2; mate = o;
      }
    });
    return mate;
  }

  _assignSpecies(childGenome, parentSpeciesId) {
    const thr = CONFIG.speciesThreshold;
    const parentSp = this.species.get(parentSpeciesId);
    if (parentSp && parentSp.count > 0 && genomeDistance(childGenome, parentSp.repGenome) <= thr) return parentSpeciesId;
    for (const sp of this.species.values()) {
      if (sp.count > 0 && genomeDistance(childGenome, sp.repGenome) <= thr) return sp.id;
    }
    const id = ++this.nextSpeciesId;
    this.species.set(id, {
      id, parent: parentSpeciesId, birthTick: this.tick, color: decodeBody(childGenome.body).hue,
      repGenome: { body: childGenome.body.slice(), brain: cloneBrain(childGenome.brain) },
      count: 0, peak: 0, alive: false, lastSeen: this.tick, fitSum: 0, fitN: 0,
    });
    return id;
  }

  /** wipe out a fraction of the population (mass-extinction event). Draws from migRng,
   *  NOT world.rng: cataclysm is an interactive event whose per-creature rolls scale with
   *  creatures.length, so routing it off the step stream keeps that stream unforked when
   *  migration has changed the population count. */
  cataclysm(fraction) {
    for (const c of this.creatures) if (this.migRng.next() < fraction) c.alive = false;
  }

  // --- island migration (deme model) ------------------------------------------------
  // Move creatures between independently-seeded worlds without corrupting NEAT innovation
  // numbering (which is per-world). Every migrant is re-expressed in THIS world's registry
  // namespace at inject time (see immigrate → remapBrain). ALL migration randomness draws
  // from migRng, never world.rng, so each world's per-step stream is unaffected until a
  // creature is actually moved.

  /** the K fittest mature emigrants (eaten desc, id asc) — deterministic, RNG-free. */
  selectMigrants(k) {
    const pool = this.creatures.filter((c) => c.alive && c.age >= CONFIG.maturity);
    pool.sort((a, b) => (b.eaten - a.eaten) || (a.id - b.id));
    return pool.slice(0, Math.max(0, k | 0));
  }

  /** MOVE a creature out: splice + decrement its species count, NO corpse (unlike death —
   *  so no spurious carrion and no extra tick of eating/reproducing for the emigrant). */
  emigrate(creature) {
    const i = this.creatures.indexOf(creature);
    if (i < 0) return false;
    this.creatures.splice(i, 1);
    const sp = this.species.get(creature.speciesId);
    if (sp) this._spLeave(sp);
    return true;
  }

  /** compact, structured-clone-safe description of a migrant (source-namespace brain). */
  serializeMigrant(c) {
    return {
      b: Array.from(c.genome.body),
      bn: c.genome.brain.nodes.map((n) => [n.id, n.type]),
      bc: c.genome.brain.conns.map((k) => [k.innov, k.from, k.to, k.w, k.enabled ? 1 : 0]),
      e: c.energy, age: c.age, gen: c.generation,
    };
  }

  /** inject a migrant serialized by another deme. Reconciles its brain into THIS world's
   *  registry namespace (remapBrain), re-speciates it here (fresh dest species id if novel),
   *  mints a fresh local id (which reseeds its oscillator phase), and enforces the pop cap by
   *  evicting the weakest resident first. `nodeMap` persists across a Phase-B batch so genetic
   *  twins from one source lineage unify onto the same dest nodes. RNG: migRng only. */
  immigrate(spec, srcDeme, nodeMap) {
    const srcBrain = {
      nodes: spec.bn.map((n) => ({ id: n[0], type: n[1] })),
      conns: spec.bc.map((k) => ({ innov: k[0], from: k[1], to: k[2], w: k[3], enabled: !!k[4] })),
    };
    const brain = remapBrain(srcBrain, this.innov, this.topo.nIn, this.topo.nOut, nodeMap, srcDeme);
    const genome = { body: Float32Array.from(spec.b), brain };

    // pop cap: evict the weakest resident first (silent — no corpse), so the render buffer
    // (sized once for maxPopulation) never overflows and _foldFitness's frozen counts hold.
    if (this.population() >= CONFIG.maxPopulation) this._evictWeakest();

    const speciesId = this._assignSpecies(genome, 0); // parentSpeciesId 0 → scan all dest species
    const sp = this.species.get(speciesId);
    if (sp) this._spEnter(sp);

    const x = this.migRng.range(0, this.width), y = this.migRng.range(0, this.height);
    const heading = this.migRng.range(0, Math.PI * 2);
    const c = new Creature(this.newId(), x, y, heading, genome, spec.gen, this.topo, speciesId);
    c.energy = spec.e; c.age = spec.age;
    this.creatures.push(c);
    return c;
  }

  /** remove the weakest resident (lowest energy, tie lowest id) with no corpse — the cap
   *  eviction path for immigration. Deterministic, RNG-free. */
  _evictWeakest() {
    const arr = this.creatures;
    if (!arr.length) return;
    let idx = 0;
    for (let i = 1; i < arr.length; i++) {
      const c = arr[i], b = arr[idx];
      if (c.energy < b.energy || (c.energy === b.energy && c.id < b.id)) idx = i;
    }
    const victim = arr[idx];
    arr.splice(idx, 1);
    const sp = this.species.get(victim.speciesId);
    if (sp) this._spLeave(sp);
  }

  // --- main step ---
  step(dt = 1) {
    // rebuild grids + id index
    this.creatureGrid.clear();
    this.byId.clear();
    for (const c of this.creatures) {
      this.creatureGrid.insert(c.id, c.x, c.y);
      this.byId.set(c.id, c);
    }
    this.foodGrid.clear();
    for (let i = 0; i < this.maxFood; i++) if (this.foodAlive[i]) this.foodGrid.insert(i, this.foodX[i], this.foodY[i]);
    this.carrionGrid.clear();
    for (let i = 0; i < this.maxCarrion; i++) if (this.carrionAlive[i]) this.carrionGrid.insert(i, this.carrionX[i], this.carrionY[i]);

    // drift blooms
    for (const b of this.blooms) {
      b.a += this.rng.range(-0.08, 0.08);
      b.x = wrap(b.x + Math.cos(b.a) * 0.6 * dt, this.width);
      b.y = wrap(b.y + Math.sin(b.a) * 0.6 * dt, this.height);
    }

    // spawn food
    this.foodAccum += CONFIG.foodRate * dt;
    const n = Math.floor(this.foodAccum);
    if (n > 0) { this.spawnFood(n); this.foodAccum -= n; }

    // rot uneaten food (keeps avoided toxic from accumulating to the cap)
    for (let i = 0; i < this.maxFood; i++) {
      if (!this.foodAlive[i]) continue;
      this.foodLife[i] -= dt;
      if (this.foodLife[i] <= 0) {
        this.foodAlive[i] = 0; this.foodFree.push(i); this.foodCount--;
      }
    }

    // age carrion
    for (let i = 0; i < this.maxCarrion; i++) {
      if (!this.carrionAlive[i]) continue;
      this.carrionLife[i] -= dt;
      if (this.carrionLife[i] <= 0) {
        this.carrionAlive[i] = 0; this.carrionFree.push(i); this.carrionCount--;
      }
    }

    // update creatures
    this.births.length = 0;
    const arr = this.creatures;
    for (let i = 0; i < arr.length; i++) arr[i].update(this, dt);

    // fold in newborns
    if (this.births.length) for (const c of this.births) arr.push(c);

    // remove the dead, leaving corpses
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.alive) { arr[w++] = c; continue; }
      const e = c.predated
        ? CONFIG.predationLeftover * CONFIG.carrionPerSize * c.body.size
        : CONFIG.carrionPerSize * c.body.size + CONFIG.carrionFromEnergy * Math.max(0, c.energy);
      this.spawnCorpse(c.x, c.y, e);
      const sp = this.species.get(c.speciesId); // the one death chokepoint: -- live count
      if (sp) this._spLeave(sp);
      this._deathsTotal++;
    }
    arr.length = w;
    this.births.length = 0; // newborns are already in creatures

    this.tick++;
    if (CONFIG.fitShare) this._foldFitness();
  }

  /** fitness sharing: fold each species' per-member harvest rate into an EMA and
   *  freeze `_rho` (population-share ÷ fitness-share) for next tick's reproduce gate.
   *  Frozen here (end of step) so every creature in the next tick sees one value —
   *  birth order within a tick cannot change the outcome (determinism). */
  _foldFitness() {
    let Wtot = 0;
    for (const sp of this.species.values()) {
      if (sp.fitN > 0) {
        const mean = sp.fitSum / sp.fitN;
        sp.fitEMA = sp.fitEMA === undefined ? mean : lerp(sp.fitEMA, mean, CONFIG.fitAlpha);
        sp.fitSum = 0; sp.fitN = 0;
      }
      if (sp.count > 0 && sp.fitEMA !== undefined) Wtot += sp.fitEMA;
    }
    const pop = this.creatures.length;
    for (const sp of this.species.values()) {
      if (sp.count > 0 && Wtot > 0 && sp.fitEMA !== undefined) {
        const targetShare = sp.fitEMA / Wtot;
        sp._rho = (sp.count / pop) / Math.max(targetShare, CONFIG.epsShare);
      } else sp._rho = 1;
    }
  }

  /** aggregate snapshot for the dashboard / time-series. */
  metrics() {
    const arr = this.creatures;
    const n = arr.length;
    let energy = 0, gen = 0, eaten = 0, age = 0, diet = 0, speedGene = 0, sizeGene = 0;
    let carn = 0, herb = 0, scav = 0, hidden = 0, conns = 0;
    const centroid = new Float64Array(GENE_COUNT);

    for (const c of arr) {
      energy += c.energy; gen += c.generation; eaten += c.eaten; age += c.age;
      diet += c.body.diet; speedGene += c.body.maxSpeed; sizeGene += c.body.size;
      const cx = complexity(c.genome.brain);
      hidden += cx.hidden; conns += cx.conns;
      if (c.body.diet > CONFIG.carnivoreThreshold) carn++;
      else if (c.body.scavenge > CONFIG.scavengerLabel) scav++;
      else herb++;
      for (let g = 0; g < GENE_COUNT; g++) centroid[g] += c.genome.body[g];
    }

    let aliveSpecies = 0;
    for (const sp of this.species.values()) {
      if (sp.count > 0) aliveSpecies++;
    }

    let diversity = 0;
    if (n > 0) {
      for (let g = 0; g < GENE_COUNT; g++) centroid[g] /= n;
      for (const c of arr) {
        let s = 0;
        for (let g = 0; g < GENE_COUNT; g++) { const d = c.genome.body[g] - centroid[g]; s += d * d; }
        diversity += Math.sqrt(s);
      }
      diversity /= n;
    }

    const m = {
      tick: this.tick, population: n, food: this.foodCount, carrion: this.carrionCount,
      maxGen: this.generationMax, avgGen: n ? gen / n : 0,
      avgEnergy: n ? energy / n : 0, avgEaten: n ? eaten / n : 0, avgAge: n ? age / n : 0,
      avgDiet: n ? diet / n : 0, avgSpeed: n ? speedGene / n : 0, avgSize: n ? sizeGene / n : 0,
      carnivores: carn, herbivores: herb, scavengers: scav,
      avgConns: n ? conns / n : 0, avgHidden: n ? hidden / n : 0,
      avgAddedConns: n ? conns / n - this.topo.nIn * this.topo.nOut : 0,
      species: aliveSpecies, diversity, birthsTotal: this._birthsTotal, deathsTotal: this._deathsTotal,
    };
    return m;
  }

  // --- save / load ---
  // Exact v4 checkpoints preserve slots, free-list order, IDs and all dynamic
  // creature state. Equality is tested in one runtime, not promised across engines.
  toState() {
    const brain = b => ({bn:b.nodes.map(n=>[n.id,n.type]),bc:b.conns.map(c=>[c.innov,c.from,c.to,c.w,c.enabled?1:0])});
    const creatures = this.creatures.map(c => ({id:c.id,x:c.x,y:c.y,h:c.heading,e:c.energy,age:c.age,g:c.generation,sp:c.speciesId,
      ph:c.phase,speed:c.speed,eaten:c.eaten,kills:c.kills,alive:c.alive,predated:c.predated,
      inputs:Array.from(c.inputs),out:Array.from(c.out),values:[...c.net.val],b:Array.from(c.genome.body),...brain(c.genome.brain)}));
    const species = [...this.species.values()].map(s=>({id:s.id,parent:s.parent,birthTick:s.birthTick,color:s.color,
      count:s.count,alive:s.alive,peak:s.peak,lastSeen:s.lastSeen,fitSum:s.fitSum,fitN:s.fitN,fitEMA:s.fitEMA,rho:s._rho,
      rep:s.repGenome?{b:Array.from(s.repGenome.body),...brain(s.repGenome.brain)}:null}));
    const arrays = {};
    for (const k of ['foodX','foodY','foodAlive','foodLife','cueA','foodFree','carrionX','carrionY','carrionE','carrionLife','carrionAlive','carrionFree']) arrays[k]=Array.from(this[k]);
    return {v:4,kind:'genesis-world',config:structuredClone(CONFIG),seed:this.seed,tick:this.tick,
      width:this.width,height:this.height,topo:{...this.topo},maxFood:this.maxFood,maxCarrion:this.maxCarrion,
      generationMax:this.generationMax,nextSpeciesId:this.nextSpeciesId,nextId:this._nextId,
      innov:this.innov.toJSON(),rng:this.rng.state(),migRng:this.migRng.state(),foodAccum:this.foodAccum,
      foodCount:this.foodCount,carrionCount:this.carrionCount,birthsTotal:this._birthsTotal,deathsTotal:this._deathsTotal,
      goodEaten:this._goodEaten,toxicEaten:this._toxicEaten,blooms:this.blooms.map(b=>({...b})),creatures,species,arrays};
  }

  fromState(state) {
    if (!state || !Array.isArray(state.creatures)) throw new Error('Invalid world checkpoint');
    if (state.v !== 4 || state.kind !== 'genesis-world') return this._fromLegacyState(state);
    if (!state.config || !state.arrays) throw new Error('Incomplete v4 checkpoint');
    Object.assign(CONFIG, structuredClone(state.config));
    this.seed=state.seed; this.tick=state.tick; this.width=state.width; this.height=state.height; this.topo={...state.topo};
    this.maxFood=state.maxFood; this.maxCarrion=state.maxCarrion;
    this.rng=makeRNG(this.seed); this.rng.setState(state.rng);
    this.migRng=makeRNG(this.seed+'-mig'); this.migRng.setState(state.migRng);
    this.innov=InnovationRegistry.fromJSON(state.innov); this._nextId=state.nextId; this.nextSpeciesId=state.nextSpeciesId;
    this.generationMax=state.generationMax; this.foodAccum=state.foodAccum; this.foodCount=state.foodCount; this.carrionCount=state.carrionCount;
    this._birthsTotal=state.birthsTotal; this._deathsTotal=state.deathsTotal; this._goodEaten=state.goodEaten; this._toxicEaten=state.toxicEaten;
    this.blooms=state.blooms.map(b=>({...b}));
    const brain = o => ({nodes:o.bn.map(n=>({id:n[0],type:n[1]})),conns:o.bc.map(c=>({innov:c[0],from:c[1],to:c[2],w:c[3],enabled:!!c[4]}))});
    this.creatures=state.creatures.map(o=>{
      const c=new Creature(o.id,o.x,o.y,o.h,{body:Float32Array.from(o.b),brain:brain(o)},o.g,this.topo,o.sp);
      Object.assign(c,{energy:o.e,age:o.age,phase:o.ph,speed:o.speed,eaten:o.eaten,kills:o.kills,alive:o.alive,predated:o.predated});
      c.inputs.set(o.inputs); c.out.set(o.out); c.net.val=new Map(o.values); return c;
    });
    this.species=new Map(state.species.map(s=>[s.id,{id:s.id,parent:s.parent,birthTick:s.birthTick,color:s.color,
      count:s.count,alive:s.alive,peak:s.peak,lastSeen:s.lastSeen,fitSum:s.fitSum,fitN:s.fitN,fitEMA:s.fitEMA,_rho:s.rho,
      repGenome:s.rep?{body:Float32Array.from(s.rep.b),brain:brain(s.rep)}:null}]));
    for (const k of ['foodX','foodY','foodLife','carrionX','carrionY','carrionE','carrionLife']) this[k]=Float32Array.from(state.arrays[k]);
    for (const k of ['foodAlive','cueA','carrionAlive']) this[k]=Uint8Array.from(state.arrays[k]);
    this.foodFree=state.arrays.foodFree.slice(); this.carrionFree=state.arrays.carrionFree.slice(); this.births=[];
    this.creatureGrid=new SpatialGrid(this.width,this.height,72); this.foodGrid=new SpatialGrid(this.width,this.height,56); this.carrionGrid=new SpatialGrid(this.width,this.height,56);
    this.byId=new Map(this.creatures.map(c=>[c.id,c]));
  }

  _fromLegacyState(state) {
    // v3 introduced the 15-input brain + toxic-food cue bits; older saves are incompatible
    if (state.v && state.v < 3) throw new Error('incompatible save (pre-v3): brain input layout changed');
    this.seed = state.seed;
    this.rng = makeRNG(state.seed);
    if (state.rng) this.rng.setState(state.rng);
    // migration sub-stream: restore if present (v4+), else recreate from seed (v3 saves)
    this.migRng = makeRNG(state.seed + '-mig');
    if (state.migRng) this.migRng.setState(state.migRng);
    this.tick = state.tick || 0;
    this.generationMax = state.generationMax || 1;
    if (state.topo) this.topo = state.topo;
    // restore the saved world size so toroidal wrap + grids match the coordinates
    if (state.width) this.width = state.width;
    if (state.height) this.height = state.height;
    this.creatureGrid = new SpatialGrid(this.width, this.height, 72);
    this.foodGrid = new SpatialGrid(this.width, this.height, 56);
    this.carrionGrid = new SpatialGrid(this.width, this.height, 56);
    this.nextSpeciesId = state.nextSpeciesId || 1;
    this._nextId = 1;
    this.innov = new InnovationRegistry(this.topo.nIn, this.topo.nOut);

    let maxNode = 0, maxInnov = 0;
    // cap to the snapshot buffer's fixed capacity (sized once for maxPopulation)
    const loaded = state.creatures.length > CONFIG.maxPopulation
      ? state.creatures.slice(0, CONFIG.maxPopulation)
      : state.creatures;
    this.creatures = loaded.map((o) => {
      const brain = {
        nodes: o.bn.map((nd) => ({ id: nd[0], type: nd[1] })),
        conns: o.bc.map((cc) => ({ innov: cc[0], from: cc[1], to: cc[2], w: cc[3], enabled: !!cc[4] })),
      };
      const ids = maxIds(brain);
      if (ids.maxNode > maxNode) maxNode = ids.maxNode;
      if (ids.maxInnov > maxInnov) maxInnov = ids.maxInnov;
      const g = { body: Float32Array.from(o.b), brain };
      const c = new Creature(this.newId(), o.x, o.y, o.h, g, o.g, this.topo, o.sp || 1);
      c.energy = o.e; c.age = o.age;
      if (o.ph !== undefined) c.phase = o.ph; // faithful oscillator resume (fallback: id-seeded)
      return c;
    });
    this.innov.sync(maxNode, maxInnov);
    // restore the exact innovation registry + id counter so the future resumes
    // identically (v3 saves lack these → fall back to the synced fresh registry)
    if (state.innov) this.innov = InnovationRegistry.fromJSON(state.innov);
    if (state.nextId) this._nextId = state.nextId;
    this.byId.clear();

    // species metadata; restore the saved founding rep, else reconstruct from a member
    this.species.clear();
    for (const s of (state.species || [])) {
      const rep = s.rep ? { body: Float32Array.from(s.rep.b), brain: { nodes: s.rep.bn.map((n) => ({ id: n[0], type: n[1] })), conns: s.rep.bc.map((c) => ({ innov: c[0], from: c[1], to: c[2], w: c[3], enabled: !!c[4] })) } } : null;
      this.species.set(s.id, { id: s.id, parent: s.parent, birthTick: s.birthTick, color: s.color, peak: s.peak, lastSeen: s.lastSeen, repGenome: rep, count: 0, alive: false, fitSum: 0, fitN: 0, fitEMA: s.fitEMA });
    }
    if (!this.species.size) {
      const rep = this.creatures[0] || { genome: { body: new Float32Array(GENE_COUNT), brain: minimalBrain(this.topo.nIn, this.topo.nOut, this.rng, this.innov) } };
      this.species.set(1, { id: 1, parent: 0, birthTick: 0, color: decodeBody(rep.genome.body).hue, repGenome: { body: rep.genome.body.slice(), brain: cloneBrain(rep.genome.brain) }, count: 0, peak: 0, alive: false, lastSeen: this.tick, fitSum: 0, fitN: 0 });
    }

    this._rebuildSpeciesCounts();

    // food (stride 3: x, y, cueA)
    this.foodAlive.fill(0); this.cueA.fill(0);
    this.foodFree.length = 0; this.foodCount = 0;
    for (let i = this.maxFood - 1; i >= 0; i--) this.foodFree.push(i);
    const f = state.food || [];
    const fl = state.foodLife || null; // parallel remaining-lifetime array (v4+)
    for (let i = 0, j = 0; i + 2 < f.length; i += 3, j++) {
      if (!this.foodFree.length) break;
      const idx = this.foodFree.pop();
      this.foodX[idx] = f[i]; this.foodY[idx] = f[i + 1]; this.cueA[idx] = f[i + 2];
      this.foodLife[idx] = fl && fl[j] !== undefined ? fl[j] : CONFIG.foodDecay;
      this.foodAlive[idx] = 1; this.foodCount++;
    }

    // carrion
    this.carrionAlive.fill(0); this.carrionFree.length = 0; this.carrionCount = 0;
    for (let i = this.maxCarrion - 1; i >= 0; i--) this.carrionFree.push(i);
    const cr = state.carrion || [];
    for (let i = 0; i + 3 < cr.length; i += 4) {
      if (!this.carrionFree.length) break;
      const idx = this.carrionFree.pop();
      this.carrionX[idx] = cr[i]; this.carrionY[idx] = cr[i + 1];
      this.carrionE[idx] = cr[i + 2]; this.carrionLife[idx] = cr[i + 3];
      this.carrionAlive[idx] = 1; this.carrionCount++;
    }

    this.blooms = (state.blooms || []).map((b) => ({ x: b.x, y: b.y, a: b.a, toxic: !!b.toxic }));
    if (!this.blooms.length) {
      for (let i = 0; i < CONFIG.bloomCount; i++) {
        this.blooms.push({ x: this.rng.range(0, this.width), y: this.rng.range(0, this.height), a: this.rng.range(0, Math.PI * 2), toxic: this.rng.next() < CONFIG.toxinFraction });
      }
    }
    this.births = []; this.foodAccum = state.foodAccum || 0; this._birthsTotal = 0; this._deathsTotal = 0;
    this._goodEaten = 0; this._toxicEaten = 0;
    // freeze per-species _rho from the restored fitEMA + rebuilt counts, so the first
    // post-load reproduce gate reads the same value an uninterrupted run would (fitEMA
    // is saved but _rho is derived — recompute it rather than defaulting everyone to 1)
    if (CONFIG.fitShare) this._foldFitness();
  }
}
