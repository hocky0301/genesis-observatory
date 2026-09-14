// Visualises a creature's evolved NEAT brain. Nodes are laid out in columns by
// their depth (longest path from the inputs); outputs are pinned to the right.
// Edge colour = weight sign (teal +, magenta −), width = magnitude. Node
// brightness = current activation, so you watch the mind think — and watch it
// grow more intricate as lineages evolve new nodes and connections.

import { NODE } from './neat.js';

const IN_LABELS = ['nectar L', 'nectar C', 'nectar R', 'toxic L', 'toxic C', 'toxic R',
  'carr L', 'carr C', 'carr R', 'foe L', 'foe C', 'foe R', 'energy', 'speed', 'osc', 'bias'];
const OUT_LABELS = ['turn', 'thrust'];

export function renderNet(canvas, brain, net) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 190;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const nIn = net.nIn, nOut = net.nOut;
  const typeOf = new Map(brain.nodes.map((n) => [n.id, n.type]));

  // depth = longest path from inputs (via forward edges only)
  const depth = new Map();
  for (const id of net.order) {
    if (id < nIn) { depth.set(id, 0); continue; }
    let d = 0;
    for (const e of net.incoming.get(id) || []) d = Math.max(d, (depth.get(e.from) || 0) + 1);
    depth.set(id, d);
  }
  let maxHidden = 0;
  for (const n of brain.nodes) if (n.type === NODE.HIDDEN) maxHidden = Math.max(maxHidden, depth.get(n.id) || 1);
  const COLS = maxHidden + 2; // inputs | hidden columns | outputs

  const colOf = (n) => {
    if (n.type === NODE.INPUT || n.type === NODE.BIAS) return 0;
    if (n.type === NODE.OUTPUT) return COLS - 1;
    return Math.min(COLS - 2, Math.max(1, depth.get(n.id) || 1));
  };

  // bucket nodes by column, then assign positions
  const buckets = Array.from({ length: COLS }, () => []);
  for (const n of brain.nodes) buckets[colOf(n)].push(n);
  const padX = 56, padY = 12;
  const colX = (c) => COLS <= 1 ? w / 2 : padX + (c / (COLS - 1)) * (w - padX - padX * 0.6);
  const pos = new Map();
  for (let c = 0; c < COLS; c++) {
    const list = buckets[c].sort((a, b) => a.id - b.id);
    for (let i = 0; i < list.length; i++) {
      const y = list.length <= 1 ? h / 2 : padY + (i / (list.length - 1)) * (h - padY * 2);
      pos.set(list[i].id, [colX(c), y]);
    }
  }

  // edges
  let wmax = 1e-6;
  for (const cn of brain.conns) if (cn.enabled) wmax = Math.max(wmax, Math.abs(cn.w));
  for (const cn of brain.conns) {
    if (!cn.enabled) continue;
    const a = pos.get(cn.from), b = pos.get(cn.to);
    if (!a || !b) continue;
    const m = Math.abs(cn.w) / wmax;
    ctx.strokeStyle = cn.w >= 0 ? `rgba(80,230,200,${(0.06 + 0.5 * m).toFixed(3)})`
      : `rgba(235,90,150,${(0.06 + 0.5 * m).toFixed(3)})`;
    ctx.lineWidth = 0.4 + 2.0 * m;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // nodes
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (const n of brain.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const act = net.val.get(n.id) || 0;
    const mag = Math.min(1, Math.abs(act));
    ctx.fillStyle = act >= 0 ? `hsl(168,80%,${30 + 45 * mag}%)` : `hsl(330,75%,${30 + 45 * mag}%)`;
    ctx.beginPath();
    ctx.arc(p[0], p[1], n.type === NODE.HIDDEN ? 4 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (n.id < nIn) {
      ctx.fillStyle = 'rgba(180,195,205,0.65)';
      ctx.textAlign = 'right';
      ctx.fillText(IN_LABELS[n.id] || `in${n.id}`, p[0] - 8, p[1]);
    } else if (n.id < nIn + nOut) {
      ctx.fillStyle = 'rgba(190,238,222,0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(OUT_LABELS[n.id - nIn] || `out`, p[0] + 8, p[1]);
    }
  }

  // complexity footer
  let hid = 0, en = 0;
  for (const n of brain.nodes) if (n.type === NODE.HIDDEN) hid++;
  for (const cn of brain.conns) if (cn.enabled) en++;
  ctx.fillStyle = 'rgba(150,165,175,0.8)';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${hid} hidden · ${en} conns`, 6, h - 7);
}
