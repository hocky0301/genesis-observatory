// Compact, transferable render snapshot. The simulation lives in a Web Worker;
// every frame it packs only what the renderer needs into one ArrayBuffer and
// transfers it (zero-copy) to the main thread. Node-importable so it can be
// round-trip tested without a browser.
//
// Layout: Int32 header [tick, nCreatures, nFood, nCarrion, generationMax, 0,0,0]
// then Float32 creatures (stride 11), food (stride 3), carrion (stride 2),
// packed contiguously (counts in the header say how many of each).

export const HEADER_INTS = 8;
export const CSTRIDE = 11; // id,x,y,heading,size,hue,diet,energyFrac,speciesId,fov,sensorRange
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
  // write past the buffer — under SAB that would throw INSIDE the seqlock and freeze the
  // renderer permanently. Defense-in-depth backstop.
  const cap = Math.floor((buf.byteLength - HEADER_INTS * 4 - (world.maxFood * FSTRIDE + world.maxCarrion * KSTRIDE) * 4) / (CSTRIDE * 4));
  const nc = Math.min(creatures.length, Math.max(0, cap));
  let p = 0;
  for (let i = 0; i < nc; i++) {
    const c = creatures[i], b = c.body;
    f[p] = c.id; f[p + 1] = c.x; f[p + 2] = c.y; f[p + 3] = c.heading;
    f[p + 4] = b.size; f[p + 5] = b.hue; f[p + 6] = b.diet;
    f[p + 7] = c.energy > 200 ? 1 : c.energy / 200;
    f[p + 8] = c.speciesId; f[p + 9] = b.fov; f[p + 10] = b.sensorRange;
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
  return buf;
}

/** build a render-friendly view over a packed buffer. */
export function view(buf, width, height) {
  const head = new Int32Array(buf, 0, HEADER_INTS);
  const f = new Float32Array(buf, HEADER_INTS * 4);
  const nc = head[1], nf = head[2], nk = head[3];
  const creatures = new Array(nc);
  const byId = new Map();
  let p = 0;
  for (let i = 0; i < nc; i++) {
    const c = {
      id: f[p], x: f[p + 1], y: f[p + 2], heading: f[p + 3],
      energyFrac: f[p + 7], speciesId: f[p + 8],
      body: { size: f[p + 4], hue: f[p + 5], diet: f[p + 6], fov: f[p + 9], sensorRange: f[p + 10] },
    };
    creatures[i] = c; byId.set(c.id, c);
    p += CSTRIDE;
  }
  const foodOff = p;
  const carrOff = foodOff + nf * FSTRIDE;
  const base = HEADER_INTS * 4; // byte offset where the Float32 region begins
  return {
    tick: head[0], generationMax: head[4], width, height,
    creatures, byId, foodCount: nf, carrionCount: nk,
    fx: (i) => f[foodOff + i * FSTRIDE], fy: (i) => f[foodOff + i * FSTRIDE + 1], ftoxic: (i) => f[foodOff + i * FSTRIDE + 2],
    kx: (i) => f[carrOff + i * KSTRIDE], ky: (i) => f[carrOff + i * KSTRIDE + 1],
    // raw buffer + BYTE offsets, so the GL renderer can bind instance attributes
    // straight from the packed floats (no repack)
    buf, nc, nf, nk,
    creatureByteOffset: base,
    foodByteOffset: base + foodOff * 4,
    carrionByteOffset: base + carrOff * 4,
  };
}
