// Full-history Muller ribbon. The caller supplies time/count samples; x positions
// use actual ticks, including decimated history. The canvas owns only the latest
// geometry for pointer hit-testing, never simulation state.
import { lineageVariation } from './palette.js';

export function cladeDescendants(id, meta) {
  const children = new Map();
  for (const [child, sp] of meta) {
    if (!children.has(sp.parent)) children.set(sp.parent, []);
    children.get(sp.parent).push(child);
  }
  const result = new Set(), pending = [id];
  while (pending.length) {
    const next = pending.pop();
    if (result.has(next)) continue;
    result.add(next);
    for (const child of children.get(next) || []) pending.push(child);
  }
  return result;
}

export function renderMuller(canvas, ticks, speciesHistory, speciesMeta, opts = {}) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 110;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const T = ticks.length, geometry = [];
  canvas._mullerPick = (x, y) => {
    if (T < 2 || x < 0 || x > w) return null;
    let lo = 0, hi = T - 1;
    const target = ticks[0] + x / w * (ticks[T - 1] - ticks[0]);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ticks[mid] > target) hi = mid; else lo = mid; }
    const mix = (target - ticks[lo]) / Math.max(1, ticks[hi] - ticks[lo]);
    for (const band of geometry) {
      const top = band.top[lo] + mix * (band.top[hi] - band.top[lo]);
      const bottom = band.bottom[lo] + mix * (band.bottom[hi] - band.bottom[lo]);
      if (y >= top && y <= bottom && bottom - top > 0.1) return band.id;
    }
    return null;
  };
  if (T < 2) {
    ctx.fillStyle = '#71888c'; ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText('Lineage history appears as the world advances', 12, h / 2);
    return geometry;
  }
  const ids = [...speciesHistory.keys()], sigSet = new Set(ids), children = new Map();
  for (const id of ids) {
    const parent = speciesMeta.get(id)?.parent;
    if (sigSet.has(parent)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    }
  }
  for (const list of children.values()) list.sort((a, b) => a - b);
  const roots = ids.filter(id => !sigSet.has(speciesMeta.get(id)?.parent)).sort((a, b) => a - b);
  const order = [], seen = new Set();
  // Iterative DFS tolerates arbitrarily deep lineages and malformed parent cycles.
  for (const root of [...roots, ...ids]) {
    const stack = [root];
    while (stack.length) {
      const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); order.push(id);
      const list = children.get(id) || [];
      for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
  }
  const totals = new Float64Array(T), bottom = new Float64Array(T);
  for (const id of order) {
    const hist = speciesHistory.get(id);
    for (let i = 0; i < T; i++) totals[i] += hist[i] || 0;
  }
  let maxTotal = 1; for (const total of totals) maxTotal = Math.max(maxTotal, total);
  const padTop = 6, padBottom = 19, plotH = h - padTop - padBottom;
  const span = Math.max(1, ticks[T - 1] - ticks[0]);
  const xAt = i => (ticks[i] - ticks[0]) / span * w;
  const highlight = typeof opts.highlightSpecies === 'number' ? new Set([opts.highlightSpecies]) : opts.highlightSpecies;
  for (const id of order) {
    const hist = speciesHistory.get(id), top = new Float32Array(T), bot = new Float32Array(T);
    for (let i = 0; i < T; i++) {
      const denom = opts.normalise ? (totals[i] || 1) : maxTotal;
      bot[i] = padTop + plotH * (1 - bottom[i] / denom);
      bottom[i] += hist[i] || 0;
      top[i] = padTop + plotH * (1 - bottom[i] / denom);
    }
    ctx.beginPath(); ctx.moveTo(xAt(0), top[0]);
    for (let i = 1; i < T; i++) ctx.lineTo(xAt(i), top[i]);
    for (let i = T - 1; i >= 0; i--) ctx.lineTo(xAt(i), bot[i]);
    ctx.closePath();
    const selected = !highlight?.size || highlight.has(id);
    const hue = 168 + 28 * lineageVariation(id), light = 43 + ((id * 7) % 19);
    ctx.fillStyle = `hsla(${hue},${selected ? 54 : 10}%,${light}%,${selected ? 0.9 : 0.2})`;
    ctx.fill();
    if (highlight?.has(id)) {
      ctx.strokeStyle = '#d8ffed'; ctx.lineWidth = 0.8;
      // A closed zero-width polygon still has a strokable boundary. Restrict
      // emphasis to runs with observed abundance, including only the adjacent
      // zero sample needed to interpolate emergence/extinction. Never draw a
      // ghost lineage back to the origin before its first observed member.
      let start = 0;
      while (start < T) {
        while (start < T && !(hist[start] > 0)) start++;
        if (start === T) break;
        let end = start;
        while (end + 1 < T && hist[end + 1] > 0) end++;
        const left = Math.max(0, start - 1), right = Math.min(T - 1, end + 1);
        ctx.beginPath(); ctx.moveTo(xAt(left), top[left]);
        for (let i = left + 1; i <= right; i++) ctx.lineTo(xAt(i), top[i]);
        for (let i = right; i >= left; i--) ctx.lineTo(xAt(i), bot[i]);
        ctx.closePath(); ctx.stroke(); start = end + 1;
      }
    }
    geometry.push({ id, top, bottom: bot });
  }
  if (opts.labels !== false) {
    ctx.fillStyle = '#8aa1a5'; ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(`tick ${ticks[0].toLocaleString()}`, 4, h - 4);
    ctx.textAlign = 'right'; ctx.fillText(`${ticks[T - 1].toLocaleString()} · ${opts.normalise ? 'population share' : 'population'}`, w - 4, h - 4);
    if (w > 500) { ctx.textAlign = 'center'; ctx.fillText('SELECT A LINEAGE TO FOLLOW ITS DESCENDANTS', w / 2, h - 4); }
  }
  return geometry;
}
