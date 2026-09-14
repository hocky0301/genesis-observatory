// Seeded, deterministic PRNG so any world can be reproduced exactly from its seed.
// sfc32 core (fast, good statistical quality) seeded via a string/number hash.

function hashSeed(seed) {
  // xmur3 — turn an arbitrary seed into four 32-bit ints.
  let h = 1779033703 ^ String(seed).length;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  return [next(), next(), next(), next()];
}

export function makeRNG(seed) {
  let [a, b, c, d] = hashSeed(seed);

  function next() {
    // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  let spare = null;
  return {
    next,
    /** uniform in [min, max) */
    range(min, max) { return min + (max - min) * next(); },
    /** integer in [0, n) */
    int(n) { return Math.floor(next() * n); },
    /** standard normal (Box–Muller, cached spare) */
    gauss() {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * m;
      return u * m;
    },
    /** true with probability p */
    chance(p) { return next() < p; },
    /** random element of an array */
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    /** export internal state for save/restore (incl. the Box–Muller gaussian spare
     *  so a loaded world resumes the exact random stream) */
    state() { return [a, b, c, d, spare === null ? null : spare]; },
    setState(st) { [a, b, c, d] = st; spare = st.length > 4 ? st[4] : null; },
  };
}
