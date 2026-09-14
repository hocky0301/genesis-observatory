// The heritable blueprint of a creature: body genes + a NEAT brain genome.
// genome = { body: Float32Array(GENE_COUNT), brain: NEATGenome }.
// Body genes are raw [0,1] values decoded into phenotype ranges (hue wraps).
// The brain's topology itself evolves — see neat.js.

import { lerp, clamp } from './vec.js';
import { minimalBrain, cloneBrain, mutateBrain, crossoverBrain, brainDistance } from './neat.js';

export const GENE = {
  SIZE: 0,
  SPEED: 1,
  RANGE: 2,
  FOV: 3,
  HUE: 4,
  EFF: 5,
  LIFE: 6,
  OSC: 7,
  DIET: 8,
  SCAVENGE: 9,
};
export const GENE_COUNT = 10;

export function randomGenome(rng, nIn, nOut, reg) {
  const body = new Float32Array(GENE_COUNT);
  for (let i = 0; i < GENE_COUNT; i++) body[i] = rng.next();
  body[GENE.DIET] = rng.range(0, 0.12); // start herbivorous; carnivory must evolve
  body[GENE.SCAVENGE] = rng.range(0, 0.3); // weak scavengers at first
  return { body, brain: minimalBrain(nIn, nOut, rng, reg) };
}

function perturb(v, rng, step, bigChance, wrap01) {
  let nv;
  if (rng.chance(bigChance)) nv = v + rng.gauss() * step * 4;
  else nv = v + rng.gauss() * step;
  if (wrap01) { nv %= 1; if (nv < 0) nv += 1; return nv; }
  return clamp(nv, 0, 1);
}

/** mutate a (cloned) genome: body genes + brain topology/weights. */
export function mutate(genome, rng, rate, step, bigChance, neatCfg, reg) {
  const body = genome.body.slice();
  for (let i = 0; i < GENE_COUNT; i++) {
    if (rng.chance(rate)) body[i] = perturb(body[i], rng, step, bigChance, i === GENE.HUE);
  }
  const brain = mutateBrain(cloneBrain(genome.brain), rng, neatCfg, reg);
  return { body, brain };
}

/** sexual recombination: body genes chosen per-gene, brain crossed by innovation. */
export function crossover(a, b, rng, aFitter) {
  const body = new Float32Array(GENE_COUNT);
  for (let i = 0; i < GENE_COUNT; i++) body[i] = rng.next() < 0.5 ? a.body[i] : b.body[i];
  return { body, brain: crossoverBrain(a.brain, b.brain, rng, aFitter) };
}

/** Decode raw body genes into the phenotype the simulation uses. */
export function decodeBody(body) {
  return {
    size: lerp(0.6, 1.7, body[GENE.SIZE]),
    maxSpeed: lerp(1.4, 3.6, body[GENE.SPEED]),
    sensorRange: lerp(50, 150, body[GENE.RANGE]),
    fov: lerp(0.5, 2.4, body[GENE.FOV]),
    hue: (body[GENE.HUE] % 1) * 360,
    eff: lerp(0.75, 1.25, body[GENE.EFF]),
    lifeJitter: lerp(0.7, 1.3, body[GENE.LIFE]),
    oscFreq: lerp(0.0, 0.25, body[GENE.OSC]),
    diet: body[GENE.DIET], // 0 herbivore .. 1 carnivore
    scavenge: lerp(0.2, 1.4, body[GENE.SCAVENGE]), // carrion-eating efficiency
  };
}

/** genetic distance for speciation / biodiversity (brain topology dominant). */
export function genomeDistance(a, b) {
  let bodyDiff = 0;
  for (let i = 0; i < GENE_COUNT; i++) {
    const d = a.body[i] - b.body[i];
    bodyDiff += d * d;
  }
  return brainDistance(a.brain, b.brain) + 0.5 * Math.sqrt(bodyDiff / GENE_COUNT);
}
