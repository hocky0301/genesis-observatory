// Behavior phylogeny — the species tree, but each node is a GLYPH encoding the
// founding lineage's evolved BEHAVIOR (from its steering fingerprint) and traits,
// with a time PLAYHEAD: only clades born by the playhead draw, and lineage spans
// clip to it, so scrubbing/playing shows behaviour radiating across the tree.
//
// glyph: core = species hue (brightness = nectar-seeking strength); violet ring
// thickness = toxin-avoidance strength; a small niche pip (green herbivore / red
// carnivore / amber scavenger); node radius grows with the species' peak size.

export function renderBehaviorTree(canvas, speciesMap, playheadTick, currentTick) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ph = playheadTick;
  let all = [...speciesMap.values()].filter((s) => (s.peak >= 2 || s.alive) && s.birthTick <= ph);
  if (!all.length) { _hint(ctx, w, h, ph); return; }
  const byId = new Map(all.map((s) => [s.id, s]));
  const children = new Map();
  for (const s of all) if (byId.has(s.parent)) (children.get(s.parent) || children.set(s.parent, []).get(s.parent)).push(s);
  for (const list of children.values()) list.sort((a, b) => a.birthTick - b.birthTick);
  const roots = all.filter((s) => !byId.has(s.parent)).sort((a, b) => a.id - b.id);

  let slot = 0; const yslot = new Map();
  const assign = (s, d) => {
    if (d > 300) return slot++;
    const kids = children.get(s.id);
    if (!kids || !kids.length) { const v = slot++; yslot.set(s.id, v); return v; }
    let sum = 0; for (const k of kids) sum += assign(k, d + 1);
    const v = sum / kids.length; yslot.set(s.id, v); return v;
  };
  for (const r of roots) assign(r, 0);

  const maxSlot = Math.max(1, slot - 1);
  const padX = 10, padTop = 10, padBot = 14;
  const maxT = Math.max(1, ph);
  const xOf = (t) => padX + (Math.min(t, ph) / maxT) * (w - padX * 2);
  const yOf = (s) => padTop + ((yslot.get(s.id) || 0) / maxSlot) * (h - padTop - padBot);

  // branches + lineage spans (clipped to the playhead)
  ctx.lineWidth = 1;
  for (const s of all) {
    const p = byId.get(s.parent);
    if (p) { ctx.strokeStyle = 'rgba(150,170,180,0.20)'; ctx.beginPath(); ctx.moveTo(xOf(s.birthTick), yOf(p)); ctx.lineTo(xOf(s.birthTick), yOf(s)); ctx.stroke(); }
    const end = Math.min(ph, s.alive ? currentTick : s.lastSeen);
    ctx.strokeStyle = `hsl(${s.color | 0}, 60%, ${s.alive ? 50 : 36}%)`;
    ctx.globalAlpha = s.alive ? 0.9 : 0.5; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(xOf(s.birthTick), yOf(s)); ctx.lineTo(Math.max(xOf(end), xOf(s.birthTick) + 1), yOf(s)); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // behaviour glyphs at each species' founding node
  for (const s of all) {
    const rp = s.rep; if (!rp) continue;
    const x = xOf(s.birthTick), y = yOf(s);
    const avoid = Math.min(1, Math.abs(rp.fp[2]));                 // toxin-avoidance (turn on toxic-ahead)
    const seek = Math.min(1, (Math.abs(rp.fp[0]) + Math.abs(rp.fp[1])) / 2); // nectar-steering
    const rad = 2.4 + Math.sqrt(Math.max(1, s.peak)) * 0.7;
    // avoidance ring
    if (avoid > 0.05) {
      ctx.strokeStyle = `rgba(190,110,235,${0.25 + 0.6 * avoid})`;
      ctx.lineWidth = 0.8 + 2.4 * avoid;
      ctx.beginPath(); ctx.arc(x, y, rad + 2.2, 0, Math.PI * 2); ctx.stroke();
    }
    // core (brightness = nectar-seeking)
    ctx.fillStyle = `hsl(${rp.hue | 0}, 70%, ${38 + 34 * seek}%)`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    // niche pip
    const niche = rp.diet > 0.5 ? 'rgba(255,90,110,0.95)' : (rp.scavenge > 0.95 ? 'rgba(255,196,84,0.95)' : 'rgba(90,220,150,0.9)');
    ctx.fillStyle = niche; ctx.beginPath(); ctx.arc(x, y, Math.max(1, rad * 0.42), 0, Math.PI * 2); ctx.fill();
  }

  // playhead + labels
  const phx = xOf(ph);
  ctx.strokeStyle = 'rgba(120,245,215,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(phx, padTop - 4); ctx.lineTo(phx, h - padBot + 2); ctx.stroke();
  _hint(ctx, w, h, ph);
}

function _hint(ctx, w, h, ph) {
  ctx.fillStyle = 'rgba(150,165,175,0.75)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText('ring = toxin-avoidance', 6, h - 3);
  ctx.textAlign = 'right'; ctx.fillText('t=' + (ph | 0), w - 6, h - 3);
}
