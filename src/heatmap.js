// Per-species brain-complexity heatmap. Each living species is a cell sized by
// its population and coloured by a "heat" gradient over its average connection
// count — cool = simple reflex brains, hot = intricate evolved topologies. A thin
// top stripe in the species' own lineage hue ties it back to the world / phylo.

// cool → hot gradient stops (t in [0,1])
const STOPS = [
  [20, 30, 60], [30, 120, 150], [70, 200, 120], [230, 200, 70], [235, 90, 60],
];
function heat(t) {
  t = Math.max(0, Math.min(0.9999, t)) * (STOPS.length - 1);
  const i = Math.floor(t), f = t - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

export function renderHeatmap(canvas, speciesList) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 138;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const live = speciesList.filter((s) => s.alive && s.count > 0).sort((a, b) => b.count - a.count).slice(0, 40);
  if (!live.length) {
    ctx.fillStyle = 'rgba(150,165,175,0.6)';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillText('no living species yet', 8, 20);
    return;
  }

  // heat scale over avg connections across shown species (min = minimal brain size)
  let lo = Infinity, hi = -Infinity;
  for (const s of live) { lo = Math.min(lo, s.avgConns); hi = Math.max(hi, s.avgConns); }
  if (hi - lo < 1) hi = lo + 1;

  // simple flow grid, cell size scaled so all fit
  const n = live.length;
  const cols = Math.ceil(Math.sqrt(n * (w / h)));
  const rows = Math.ceil(n / cols);
  const pad = 2;
  const cw = w / cols, ch = h / rows;

  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const s = live[i];
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
    const t = (s.avgConns - lo) / (hi - lo);
    ctx.fillStyle = heat(t);
    ctx.fillRect(cx + pad, cy + pad, cw - pad * 2, ch - pad * 2);
    // lineage-hue top stripe (identity)
    ctx.fillStyle = `hsl(${s.color | 0},70%,58%)`;
    ctx.fillRect(cx + pad, cy + pad, cw - pad * 2, 3);
    // complexity label
    if (cw > 34 && ch > 20) {
      ctx.fillStyle = t > 0.55 ? 'rgba(15,15,20,0.9)' : 'rgba(235,240,245,0.92)';
      ctx.textAlign = 'center';
      ctx.fillText(`${s.avgConns.toFixed(0)}c`, cx + cw / 2, cy + ch / 2 - 4);
      ctx.fillText(`${s.avgHidden.toFixed(1)}h`, cx + cw / 2, cy + ch / 2 + 7);
    }
  }

  // legend
  ctx.fillStyle = 'rgba(150,165,175,0.75)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`brain conns: ${lo.toFixed(0)}`, 4, h - 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${hi.toFixed(0)} →hot`, w - 4, h - 3);
}
