// One ecological colour grammar for both renderers. The GLSL fragment below is
// interpolated into the shader, so category thresholds and palette constants do
// not drift between Canvas and WebGL. Species id adds bounded hue variation.
import { CONFIG } from './config.js';

export const PALETTE = Object.freeze({
  herbivore: { hue: 168, spread: 28, saturation: 0.62 },
  scavenger: { hue: 34, spread: 14, saturation: 0.48 },
  carnivore: { hue: 352, spread: 8, saturation: 0.92 },
  nectar: '#ffc454', toxin: '#8a5fb0', carrion: '#965c46',
});
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function trophicKind(diet, scavenge, config = CONFIG) {
  return diet > config.carnivoreThreshold ? 'carnivore'
    : scavenge > config.scavengerLabel ? 'scavenger' : 'herbivore';
}
export function lineageVariation(speciesId) { return (((speciesId % 29) + 29) % 29) / 14 - 1; }
export function organismColor(diet, scavenge, speciesId, energyFrac, ageFrac, highlighted = true, config = CONFIG) {
  const kind = trophicKind(diet, scavenge, config), p = PALETTE[kind];
  return { kind, hue: p.hue + p.spread * lineageVariation(speciesId),
    saturation: p.saturation * (highlighted ? 1 : 0.18),
    lightness: (0.42 + 0.26 * clamp(energyFrac, 0, 1)) * (highlighted ? 1 : 0.48),
    alpha: (1 - 0.52 * clamp((ageFrac - 0.55) / 0.45, 0, 1)) * (highlighted ? 1 : 0.42),
  };
}
export function cssColor(c, lightness = c.lightness) {
  return `hsla(${c.hue},${c.saturation * 100}%,${lightness * 100}%,${c.alpha})`;
}
// Keep category semantics strict: a scavenger label is a efficiency label, not
// proof that this particular animal has consumed carrion. Carnivore takes priority.
export const PALETTE_GLSL = `
float lineageVariation(float species) { return mod(species, 29.0) / 14.0 - 1.0; }
vec4 ecologyColor(float diet, float scav, float species, float energy, float age, bool highlighted) {
  float hue = ${PALETTE.herbivore.hue.toFixed(1)} + ${PALETTE.herbivore.spread.toFixed(1)} * lineageVariation(species);
  float sat = ${PALETTE.herbivore.saturation};
  if (diet > uCarnThreshold) { hue = ${PALETTE.carnivore.hue.toFixed(1)} + ${PALETTE.carnivore.spread.toFixed(1)} * lineageVariation(species); sat = ${PALETTE.carnivore.saturation}; }
  else if (scav > uScavLabel) { hue = ${PALETTE.scavenger.hue.toFixed(1)} + ${PALETTE.scavenger.spread.toFixed(1)} * lineageVariation(species); sat = ${PALETTE.scavenger.saturation}; }
  float light = 0.42 + 0.26 * clamp(energy, 0.0, 1.0);
  float alpha = 1.0 - 0.52 * clamp((age - 0.55) / 0.45, 0.0, 1.0);
  if (!highlighted) { sat *= 0.18; light *= 0.48; alpha *= 0.42; }
  return vec4(hsl2rgb(hue, sat, light), alpha);
}`;
