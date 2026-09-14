// Compact, transferable render snapshot. The simulation lives in a Web Worker;
// every frame it packs only what the renderer needs into one ArrayBuffer and
// transfers ownership to the main thread. This transfer avoids cloning the
// buffer; packing, SAB snapshots and the GPU upload still copy bytes. Node-importable so it can be
// round-trip tested without a browser.
//
// Layout: Int32 header [tick, nCreatures, nFood, nCarrion, generationMax, livingSpecies,0,0]
// then Float32 creatures (stride 13), food (stride 3), carrion (stride 2),
// packed contiguously (counts in the header say how many of each).

import { CONFIG } from './config.js';

export const HEADER_INTS = 8;
export const CSTRIDE = 13; // id,x,y,heading,size,hue,diet,energyFrac,speciesId,fov,sensorRange,scavenge,ageFrac
export const FSTRIDE = 3;  // x,y,toxic
export const KSTRIDE = 2;  // x,y

export function bufferSize(maxPop, maxFood, maxCarrion) {
  return HEADER_INTS * 4 + (maxPop * CSTRIDE + maxFood * FSTRIDE + maxCarrion * KSTRIDE) * 4;
}

/** pack the world's render state into buf (an ArrayBuffer sized via bufferSize). */
export function pack(world, buf) {
  const head = new Int32Array(buf, 0, HEADER_INTS);
  const f = new Float32Array(buf, HEADER_INTS * 4);
  const creatures = world.creatures;
  // clamp to the buffer's creature capacity (sized once for maxPopulation). Migration's
  // cap+evict keeps population within maxPopulation, but a transient overflow must never
  // announce records outside the buffer. Typed-array out-of-bounds writes can be
  // silently ignored; clamping keeps counts, offsets and complete records consistent.
  const cap = Math.floor((buf.byteLength - HEADER_INTS * 4 - (world.maxFood * FSTRIDE + world.maxCarrion * KSTRIDE) * 4) / (CSTRIDE * 4));
  const nc = Math.min(creatures.length, Math.max(0, cap));
  let p = 0;
  for (let i = 0; i < nc; i++) {
    const c = creatures[i], b = c.body;
    f[p] = c.id; f[p + 1] = c.x; f[p + 2] = c.y; f[p + 3] = c.heading;
    f[p + 4] = b.size; f[p + 5] = b.hue; f[p + 6] = b.diet;
    f[p + 7] = Math.max(0, Math.min(1, c.energy / CONFIG.maxEnergy));
    f[p + 8] = c.speciesId; f[p + 9] = b.fov; f[p + 10] = b.sensorRange;
    f[p + 11] = b.scavenge;
    f[p + 12] = Math.max(0, Math.min(1, c.age / (CONFIG.maxAge * b.lifeJitter)));
    p += CSTRIDE;
  }
  let nf = 0;
  for (let i = 0; i < world.maxFood; i++) {
    if (!world.foodAlive[i]) continue;
    f[p] = world.foodX[i]; f[p + 1] = world.foodY[i]; f[p + 2] = world.cueA[i];
    p += FSTRIDE; nf++;
  }
  let nk = 0;
  for (let i = 0; i < world.maxCarrion; i++) {
    if (!world.carrionAlive[i]) continue;
    f[p] = world.carrionX[i]; f[p + 1] = world.carrionY[i];
    p += KSTRIDE; nk++;
  }
  head[0] = world.tick; head[1] = nc; head[2] = nf; head[3] = nk; head[4] = world.generationMax;
  let livingSpecies = 0;
  for (const sp of world.species.values()) if (sp.count > 0) livingSpecies++;
  head[5] = livingSpecies; head[6] = 0; head[7] = 0;
  return buf;
}

/** A cheap view over the packed bytes. GL frames create no creature objects.
 * Legacy creatures/byId APIs materialise only when explicitly requested; picking
 * and camera following can request one creature through creatureAt/findCreature.
 */
export function view(buf, width, height) {
  if (buf.byteLength < HEADER_INTS * 4) throw new RangeError('Truncated snapshot header');
  const head = new Int32Array(buf, 0, HEADER_INTS);
  const f = new Float32Array(buf, HEADER_INTS * 4);
  const nc = head[1], nf = head[2], nk = head[3];
  if (nc < 0 || nf < 0 || nk < 0 || nc * CSTRIDE + nf * FSTRIDE + nk * KSTRIDE > f.length) {
    throw new RangeError('Invalid snapshot counts');
  }
  let creatures, byId;
  const creatureAt = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= nc) return undefined;
    const p = i * CSTRIDE;
    return { id: f[p], x: f[p + 1], y: f[p + 2], heading: f[p + 3],
      energyFrac: f[p + 7], speciesId: f[p + 8], ageFrac: f[p + 12],
      body: { size: f[p + 4], hue: f[p + 5], diet: f[p + 6], fov: f[p + 9], sensorRange: f[p + 10], scavenge: f[p + 11] },
    };
  };
  const findCreature = (id) => {
    if (byId) return byId.get(id);
    for (let i = 0; i < nc; i++) if (f[i * CSTRIDE] === id) return creatureAt(i);
    return undefined;
  };
  const foodOff = nc * CSTRIDE, carrOff = foodOff + nf * FSTRIDE;
  const base = HEADER_INTS * 4;
  return {
    tick: head[0], generationMax: head[4], livingSpecies: head[5], width, height,
    get creatures() { return creatures ||= Array.from({ length: nc }, (_, i) => creatureAt(i)); },
    get byId() {
      if (!byId) { byId = new Map(); for (const c of this.creatures) byId.set(c.id, c); }
      return byId;
    },
    creatureAt, findCreature, creatureCount: nc, foodCount: nf, carrionCount: nk,
    fx: (i) => f[foodOff + i * FSTRIDE], fy: (i) => f[foodOff + i * FSTRIDE + 1], ftoxic: (i) => f[foodOff + i * FSTRIDE + 2],
    kx: (i) => f[carrOff + i * KSTRIDE], ky: (i) => f[carrOff + i * KSTRIDE + 1],
    buf, f, nc, nf, nk,
    creatureByteOffset: base,
    foodByteOffset: base + foodOff * 4,
    carrionByteOffset: base + carrOff * 4,
  };
}
