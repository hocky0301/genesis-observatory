// Generates docs/genesis.svg — the project's key art, drawn deterministically
// from the same seeded RNG the simulation uses. Run:  node tools/make-banner.mjs
import { makeRNG } from '../src/rng.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rng = makeRNG('genesis-banner');
const W = 1200, H = 460;
const out = [];
const push = (s) => out.push(s);

push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, monospace">`);
push(`<defs>
  <radialGradient id="glow" cx="50%" cy="0%" r="90%">
    <stop offset="0%" stop-color="#0f3b32"/><stop offset="55%" stop-color="#070b10"/><stop offset="100%" stop-color="#04060a"/>
  </radialGradient>
  <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#36e0b0"/><stop offset="100%" stop-color="#8fe9ff"/>
  </linearGradient>
</defs>`);
push(`<rect width="${W}" height="${H}" fill="url(#glow)"/>`);

// --- food specks scattered behind everything ---
for (let i = 0; i < 46; i++) {
  const x = rng.range(40, W - 40), y = rng.range(150, H - 40);
  push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="3" height="3" fill="#ffc454" opacity="${rng.range(0.35, 0.9).toFixed(2)}"/>`);
}

// --- kite-shaped insects ---
function insect(cx, cy, r, heading, hue, carn) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const nose = [cx + c * r * 1.7, cy + s * r * 1.7];
  const l = [cx + Math.cos(heading + 2.5) * r, cy + Math.sin(heading + 2.5) * r];
  const tail = [cx + Math.cos(heading + Math.PI) * r * 0.5, cy + Math.sin(heading + Math.PI) * r * 0.5];
  const rr = [cx + Math.cos(heading - 2.5) * r, cy + Math.sin(heading - 2.5) * r];
  const fill = carn ? `hsl(4,80%,58%)` : `hsl(${hue},68%,56%)`;
  const ant = (off) => {
    const a = heading + off;
    return `<line x1="${(cx + c * r * 1.2).toFixed(1)}" y1="${(cy + s * r * 1.2).toFixed(1)}" x2="${(cx + Math.cos(a) * r * 2.6).toFixed(1)}" y2="${(cy + Math.sin(a) * r * 2.6).toFixed(1)}" stroke="hsl(${carn ? 4 : hue},80%,72%)" stroke-opacity="0.5" stroke-width="1"/>`;
  };
  return ant(-0.5) + ant(0.5) +
    `<polygon points="${nose} ${l} ${tail} ${rr}" fill="${fill}"/>` +
    `<circle cx="${(cx + c * r).toFixed(1)}" cy="${(cy + s * r).toFixed(1)}" r="${(r * 0.32).toFixed(1)}" fill="hsl(${carn ? 4 : hue},90%,85%)"/>`;
}
for (let i = 0; i < 13; i++) {
  const carn = i % 6 === 0;
  push(insect(rng.range(70, 560), rng.range(190, H - 50), rng.range(9, 16), rng.range(0, Math.PI * 2), rng.int(360), carn));
}

// --- neural pipeline on the right ---
const col = (x, n, y0, y1) => Array.from({ length: n }, (_, i) => [x, y0 + (n === 1 ? (y1 - y0) / 2 : (i / (n - 1)) * (y1 - y0))]);
const inN = col(720, 16, 108, 430);
const hidN = col(900, 9, 150, 410);
const outN = col(1080, 2, 220, 330);

function edge(a, b, w) {
  const m = Math.abs(w);
  const col = w >= 0 ? `rgba(80,230,200,${(0.08 + 0.5 * m).toFixed(2)})` : `rgba(235,90,150,${(0.08 + 0.5 * m).toFixed(2)})`;
  return `<line x1="${a[0]}" y1="${a[1].toFixed(1)}" x2="${b[0]}" y2="${b[1].toFixed(1)}" stroke="${col}" stroke-width="${(0.4 + 2.2 * m).toFixed(2)}"/>`;
}
// representative subset of edges
for (const a of inN) for (const b of hidN) if (rng.next() < 0.55) push(edge(a, b, rng.range(-1, 1)));
for (const a of hidN) for (const b of outN) push(edge(a, b, rng.range(-1, 1)));

const node = (p, act) => {
  const m = Math.abs(act);
  const c = act >= 0 ? `hsl(168,80%,${30 + 45 * m}%)` : `hsl(330,75%,${30 + 45 * m}%)`;
  return `<circle cx="${p[0]}" cy="${p[1].toFixed(1)}" r="6" fill="${c}" stroke="rgba(255,255,255,0.18)"/>`;
};
for (const p of inN) push(node(p, rng.range(0, 1)));
for (const p of hidN) push(node(p, rng.range(-1, 1)));
for (const p of outN) push(node(p, rng.range(-1, 1)));

const inLabels = ['nectar L', 'nectar C', 'nectar R', 'toxic L', 'toxic C', 'toxic R',
  'carr L', 'carr C', 'carr R', 'foe L', 'foe C', 'foe R', 'energy', 'speed', 'osc', 'bias'];
inN.forEach((p, i) => push(`<text x="${p[0] - 12}" y="${(p[1] + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#99aab5">${inLabels[i]}</text>`));
['turn', 'thrust'].forEach((t, i) => push(`<text x="${outN[i][0] + 12}" y="${(outN[i][1] + 3).toFixed(1)}" font-size="11" fill="#bfeede">${t}</text>`));

// --- wordmark + tagline ---
push(`<text x="60" y="92" font-size="58" font-weight="800" letter-spacing="14" fill="url(#title)">GENESIS</text>`);
push(`<text x="64" y="120" font-size="15" fill="#7f8e99" letter-spacing="1">a self-evolving ecosystem of neural-network insects</text>`);

// --- stat chips ---
const chips = ['no fitness function', 'evolving brain topology', 'toxin avoidance', 'thousands, in a worker', 'zero dependencies'];
let cx = 64;
for (const c of chips) {
  const w = 24 + c.length * 7.2;
  push(`<rect x="${cx}" y="${H - 46}" width="${w.toFixed(0)}" height="26" rx="13" fill="rgba(255,255,255,0.04)" stroke="rgba(54,224,176,0.3)"/>`);
  push(`<text x="${(cx + w / 2).toFixed(0)}" y="${H - 28}" text-anchor="middle" font-size="11" fill="#9fe9cf">${c}</text>`);
  cx += w + 12;
}

push(`</svg>`);

const dir = fileURLToPath(new URL('../docs', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/genesis.svg', out.join('\n'));
console.log('wrote docs/genesis.svg');
