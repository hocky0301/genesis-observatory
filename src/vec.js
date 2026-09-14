// Tiny math helpers. The world is a torus, so distance uses the minimal-image
// convention: the shortest delta considering wrap-around in each axis.

export const TAU = Math.PI * 2;

/** shortest signed delta from a to b on a wrapped axis of given size */
export function wrapDelta(d, size) {
  // bring d into (-size/2, size/2]
  d %= size;
  if (d > size * 0.5) d -= size;
  else if (d < -size * 0.5) d += size;
  return d;
}

/** wrap a coordinate into [0, size) */
export function wrap(x, size) {
  x %= size;
  if (x < 0) x += size;
  return x;
}

/** normalise an angle into (-PI, PI] */
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
