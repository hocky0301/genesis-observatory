// A single organism. Each tick it senses its surroundings through directional
// antennae (now also smelling carrion), runs its evolved NEAT brain, moves,
// burns energy, feeds in up to three ways — grazing plants, hunting smaller
// creatures, scavenging corpses — and, if it has banked enough energy,
// reproduces (sexually with a nearby mate, or by cloning). It dies when energy
// hits zero or it reaches old age, leaving a corpse behind.

import { CONFIG } from './config.js';
import { buildNetwork, evaluate } from './neat.js';
import { decodeBody } from './genome.js';
import { wrapDelta, wrapAngle, wrap, lerp, clamp, TAU } from './vec.js';

// input slots — BIAS MUST STAY LAST (neat.js types node id===nIn-1 as the bias)
const I_NECTAR = 0;  // 0..2  safe food, directional
const I_TOXIC = 3;   // 3..5  toxic food, directional (sensed separately → avoidable)
const I_CARRION = 6; // 6..8
const I_FOE = 9;     // 9..11
const I_ENERGY = 12;
const I_SPEED = 13;
const I_OSC = 14;
const I_BIAS = 15;

export class Creature {
  constructor(id, x, y, heading, genome, generation, topo, speciesId = 0) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.genome = genome;
    this.body = decodeBody(genome.body);
    this.net = buildNetwork(genome.brain, topo.nIn, topo.nOut);
    this.energy = CONFIG.startEnergy;
    this.age = 0;
    this.generation = generation;
    this.speciesId = speciesId;
    this.speed = 0;
    this.phase = (this.id * 0.61803398875) % TAU;
    this.alive = true;
    this.predated = false;
    this.eaten = 0; // lifetime energy harvested (fitness proxy for the UI)
    this.kills = 0;
    this.inputs = new Float32Array(topo.nIn);
    this.out = new Float32Array(topo.nOut);
    this.topo = topo;
  }

  /** Fill this.inputs from the world via the spatial grids. */
  sense(world) {
    const inp = this.inputs;
    for (let i = 0; i < inp.length; i++) inp[i] = 0;
    const { fov, sensorRange } = this.body;
    const half = fov * 0.5;
    const off = [-half, 0, half];
    const W = world.width, H = world.height;
    const x = this.x, y = this.y, heading = this.heading;
    const range2 = sensorRange * sensorRange;

    // generic antenna accumulation into inp[base..base+2]; returns the proximity
    // value it assigned (0 if the target was out of range / field of view)
    const feel = (ox, oy, base) => {
      const dx = wrapDelta(ox - x, W);
      const dy = wrapDelta(oy - y, H);
      const d2 = dx * dx + dy * dy;
      if (d2 > range2) return 0;
      const rel = wrapAngle(Math.atan2(dy, dx) - heading);
      if (rel < -half - 0.15 || rel > half + 0.15) return 0;
      let a = 0, best = Math.abs(rel - off[0]);
      for (let k = 1; k < 3; k++) { const e = Math.abs(rel - off[k]); if (e < best) { best = e; a = k; } }
      const v = 1 - Math.sqrt(d2) / sensorRange;
      if (v > inp[base + a]) inp[base + a] = v;
      return v;
    };

    // nectar and toxic food feed SEPARATE antennae, so the brain can steer toward
    // one and away from the other
    world.foodGrid.queryRadius(x, y, sensorRange, (idx) => {
      if (!world.foodAlive[idx]) return;
      feel(world.foodX[idx], world.foodY[idx], world.cueA[idx] ? I_TOXIC : I_NECTAR);
    });
    world.carrionGrid.queryRadius(x, y, sensorRange, (idx) => {
      if (world.carrionAlive[idx]) feel(world.carrionX[idx], world.carrionY[idx], I_CARRION);
    });
    world.creatureGrid.queryRadius(x, y, sensorRange, (cid) => {
      if (cid === this.id) return;
      const o = world.byId.get(cid);
      if (o && o.alive) feel(o.x, o.y, I_FOE);
    });

    inp[I_ENERGY] = this.energy / CONFIG.maxEnergy;
    inp[I_SPEED] = this.speed / this.body.maxSpeed;
    inp[I_OSC] = Math.sin(this.phase);
    inp[I_BIAS] = 1;
  }

  /** think, move, metabolise, feed, maybe reproduce, maybe die. */
  update(world, dt) {
    if (!this.alive) return; // may have been eaten earlier this tick
    this.sense(world);
    const out = evaluate(this.net, this.inputs, this.out);
    const turn = out[0];
    const thrust = out[1] > 0 ? out[1] : 0;

    // movement
    this.heading = wrapAngle(this.heading + turn * CONFIG.maxTurn * dt);
    const speed = thrust * this.body.maxSpeed;
    this.speed = speed;
    this.x = wrap(this.x + Math.cos(this.heading) * speed * dt, world.width);
    this.y = wrap(this.y + Math.sin(this.heading) * speed * dt, world.height);
    this.phase += this.body.oscFreq * dt;

    // metabolism
    const cost = dt * (CONFIG.baseMetabolism * this.body.size +
      CONFIG.moveMetabolism * speed) / this.body.eff;
    this.energy -= cost;

    const reach = CONFIG.eatRadius + this.body.size * 3.5;

    // graze whatever is in reach. Nectar gives energy (carnivores digest it
    // poorly); toxic food (signed negative return) poisons every diet equally —
    // so steering clear of toxic patches is what pays off.
    const plant = world.eatNear(this.x, this.y, reach);
    if (plant > 0) this._gain(plant * (1 - 0.65 * this.body.diet));
    else if (plant < 0) this.energy = Math.max(0, this.energy + plant);

    // scavenge carrion (efficiency from the SCAVENGE gene)
    const carrion = world.eatCarrionNear(this.x, this.y, reach);
    if (carrion > 0) this._gain(carrion * this.body.scavenge);

    // hunt (carnivores only)
    if (this.body.diet > CONFIG.carnivoreThreshold) {
      const meat = world.huntNear(this);
      if (meat > 0) { this._gain(meat); this.kills++; }
    }

    // fitness-sharing: accumulate this member's per-tick harvest rate for its species
    // (age-normalised, so it measures foraging skill, not survivorship)
    if (CONFIG.fitShare) {
      const sp = world.species.get(this.speciesId);
      if (sp) { sp.fitSum += this.eaten / Math.max(this.age, CONFIG.maturity); sp.fitN++; }
    }

    // reproduce — the effective energy threshold is scaled by the species' fitness
    // share: elite under-represented species breed sooner, over-bred/junk ones later
    if (this.age >= CONFIG.maturity && world.population() < CONFIG.maxPopulation) {
      let effThreshold = CONFIG.reproduceThreshold;
      if (CONFIG.fitShare) {
        const sp = world.species.get(this.speciesId);
        const rho = (sp && sp._rho !== undefined) ? sp._rho : 1;
        const g = clamp(Math.log(rho) / CONFIG.fitShareGain, -1, 1); // <0 under-bred, >0 over-bred
        effThreshold *= lerp(CONFIG.fitShareMin, CONFIG.fitShareMax, (g + 1) / 2);
      } else if (CONFIG.protect) {
        const pop = world.population();
        const sp = world.species.get(this.speciesId);
        const f = (sp && pop > 0) ? sp.count / pop : 1;
        effThreshold *= lerp(CONFIG.protectMin, 1, Math.min(1, f / CONFIG.protectShare));
      }
      if (this.energy >= effThreshold) world.reproduce(this);
    }

    // age / death
    this.age += dt;
    if (this.energy <= 0 || this.age >= CONFIG.maxAge * this.body.lifeJitter) {
      this.alive = false;
    }
  }

  _gain(e) {
    this.energy = Math.min(CONFIG.maxEnergy, this.energy + e);
    this.eaten += e;
  }

  /** re-run sensing + brain so the inspector can show current activations. */
  perceive(world) {
    this.sense(world);
    evaluate(this.net, this.inputs, this.out);
  }
}
