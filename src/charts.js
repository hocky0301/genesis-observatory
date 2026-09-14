// Minimal canvas line charts for the dashboard. renderChart draws one or more
// series (auto-scaled to a shared range) with a faint frame and a current-value
// label. No dependencies.

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 280;
  const h = canvas.clientHeight || 54;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * @param canvas target <canvas>
 * @param series [{data:number[], color, fill?:bool}]
 * @param opts {label, min?, max?, unit?}
 */
export function renderChart(canvas, series, opts = {}) {
  const { ctx, w, h } = setup(canvas);
  ctx.clearRect(0, 0, w, h);

  // frame
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const pad = 4;
  const plotH = h - pad * 2;
  const plotW = w - pad * 2;

  // shared range
  let min = opts.min, max = opts.max;
  if (min == null || max == null) {
    min = Infinity; max = -Infinity;
    for (const s of series) for (const v of s.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min)) { min = 0; max = 1; }
  }
  if (max - min < 1e-9) max = min + 1;

  const n = Math.max(...series.map((s) => s.data.length), 1);
  const xAt = (i) => pad + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v) => pad + plotH - ((v - min) / (max - min)) * plotH;

  for (const s of series) {
    const d = s.data;
    if (d.length === 0) continue;
    if (s.fill) {
      ctx.beginPath();
      ctx.moveTo(xAt(0), yAt(d[0]));
      for (let i = 1; i < d.length; i++) ctx.lineTo(xAt(i), yAt(d[i]));
      ctx.lineTo(xAt(d.length - 1), pad + plotH);
      ctx.lineTo(xAt(0), pad + plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(d[0]));
    for (let i = 1; i < d.length; i++) ctx.lineTo(xAt(i), yAt(d[i]));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // label + last value of the first series
  ctx.fillStyle = 'rgba(190,205,215,0.85)';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'top';
  if (opts.label) ctx.fillText(opts.label, 6, 5);
  const last = series[0]?.data;
  if (last && last.length) {
    const v = last[last.length - 1];
    const txt = (v >= 100 ? Math.round(v) : v.toFixed(v < 10 ? 2 : 1)) + (opts.unit || '');
    ctx.fillStyle = series[0].color;
    ctx.textAlign = 'right';
    ctx.fillText(txt, w - 6, 5);
    ctx.textAlign = 'left';
  }
}
