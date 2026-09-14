import { makeRNG } from '../src/rng.js';
import { CONFIG } from '../src/config.js';

// Deterministic render-only fixture. It does not claim a naturally evolved state.
export function renderFixture(nc = 8000, nf = 16000, nk = 5800, seed = 'render-bench-42') {
  const rng = makeRNG(seed), world = {
    width: 3200, height: 2100, tick: 9000, generationMax: 0,
    creatures: [], species: new Map(), maxFood: nf, maxCarrion: nk,
    foodAlive: new Uint8Array(nf).fill(1), foodX: new Float32Array(nf), foodY: new Float32Array(nf), cueA: new Float32Array(nf),
    carrionAlive: new Uint8Array(nk).fill(1), carrionX: new Float32Array(nk), carrionY: new Float32Array(nk),
  };
  for (let i = 0; i < nc; i++) {
    const sid = i % 97 + 1, kind = i % 3;
    if (!world.species.has(sid)) world.species.set(sid, { count: 0 });
    world.species.get(sid).count++;
    world.creatures.push({ id: i + 1, x: rng.range(0, world.width), y: rng.range(0, world.height), heading: rng.range(-Math.PI, Math.PI),
      energy: rng.range(20, CONFIG.maxEnergy), age: rng.range(0, CONFIG.maxAge), speciesId: sid,
      body: { size: rng.range(0.6, 2.1), hue: rng.range(0, 360), diet: kind === 2 ? 0.8 : 0.2,
        scavenge: kind === 1 ? 1.2 : 0.4, fov: 1.8, sensorRange: 80, lifeJitter: 1 },
    });
  }
  for (let i = 0; i < nf; i++) { world.foodX[i] = rng.range(0, world.width); world.foodY[i] = rng.range(0, world.height); world.cueA[i] = i % 5 < 2 ? 1 : 0; }
  for (let i = 0; i < nk; i++) { world.carrionX[i] = rng.range(0, world.width); world.carrionY[i] = rng.range(0, world.height); }
  return world;
}
