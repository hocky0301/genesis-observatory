// Phylogenetic tree of species. Each species is a horizontal lineage-line from
// the tick it branched off to the tick it was last seen (extant lines reach the
// right edge). A faint vertical branch connects it to its parent at its birth
// time. Line colour = species hue, thickness grows with the species' peak size.
// You watch clades radiate, thrive, and go extinct.

export function renderPhylo(canvas, speciesMap, currentTick) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // keep the tree legible: drop one-off species that never reached 2 members
  let all = [...speciesMap.values()].filter((s) => s.peak >= 2 || s.alive);
  if (all.length === 0) all = [...speciesMap.values()];
  const byId = new Map(all.map((s) => [s.id, s]));
  const children = new Map();
  for (const s of all) {
    if (byId.has(s.parent)) {
      if (!children.has(s.parent)) children.set(s.parent, []);
      children.get(s.parent).push(s);
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.birthTick - b.birthTick);
  const roots = all.filter((s) => !byId.has(s.parent)).sort((a, b) => a.id - b.id);

  // post-order slot assignment: leaves get sequential slots, parents centre on children
  let slot = 0;
  const yslot = new Map();
  const assign = (s, depth) => {
    if (depth > 200) return slot++; // cycle guard
    const kids = children.get(s.id);
    if (!kids || !kids.length) { const v = slot++; yslot.set(s.id, v); return v; }
    let sum = 0;
    for (const k of kids) sum += assign(k, depth + 1);
    const v = sum / kids.length;
    yslot.set(s.id, v);
    return v;
  };
  for (const r of roots) assign(r, 0);

  const maxSlot = Math.max(1, slot - 1);
  const padX = 8, padTop = 10, padBot = 14;
  const maxT = Math.max(1, currentTick);
  const xOf = (t) => padX + (t / maxT) * (w - padX * 2);
  const yOf = (s) => padTop + ((yslot.get(s.id) || 0) / maxSlot) * (h - padTop - padBot);

  // branches first (under the lineage lines)
  ctx.lineWidth = 1;
  for (const s of all) {
    const p = byId.get(s.parent);
    if (!p) continue;
    const x = xOf(s.birthTick);
    ctx.strokeStyle = 'rgba(150,170,180,0.22)';
    ctx.beginPath();
    ctx.moveTo(x, yOf(p));
    ctx.lineTo(x, yOf(s));
    ctx.stroke();
  }

  // lineage lines
  for (const s of all) {
    const x0 = xOf(s.birthTick);
    const x1 = xOf(s.alive ? currentTick : s.lastSeen);
    const y = yOf(s);
    const thick = Math.min(6, 1 + Math.sqrt(s.peak || 1) * 0.5);
    ctx.strokeStyle = `hsl(${s.color | 0}, 65%, ${s.alive ? 60 : 42}%)`;
    ctx.globalAlpha = s.alive ? 1 : 0.6;
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(Math.max(x1, x0 + 1), y);
    ctx.stroke();
    if (s.alive) {
      ctx.fillStyle = `hsl(${s.color | 0}, 75%, 66%)`;
      ctx.beginPath();
      ctx.arc(Math.max(x1, x0 + 1), y, thick * 0.5 + 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // axis hint
  ctx.fillStyle = 'rgba(150,165,175,0.7)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('time →', padX, h - 3);
  ctx.textAlign = 'right';
  const living = [...speciesMap.values()].filter((s) => s.alive).length;
  ctx.fillText(`${living} living species`, w - padX, h - 3);
}
