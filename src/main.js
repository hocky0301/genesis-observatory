// GENESIS entry point. The simulation runs in Web Worker(s); this thread renders
// snapshots and drives the dashboard. Single world by default; `?islands=2..4`
// spawns that many independent worlds in parallel (safe now that the NEAT
// innovation registry + creature ids are per-world), each on its own worker +
// snapshot transport + renderer, laid out in a grid. The dashboard binds to the
// focused world; this page does not migrate organisms between workers.

import { CONFIG } from './config.js';
import { Renderer } from './renderer.js';
import { GLRenderer } from './gl-renderer.js';
import { view as snapView } from './render-snapshot.js';
import { initUI } from './ui.js';
import { downloadState } from './persistence.js';
import { initLab } from './lab.js';
import { initOnboarding } from './onboarding.js';

const params = new URLSearchParams(location.search);
const recordingAtStart = params.has('record') || params.has('rec');
const N = Math.max(1, Math.min(4, parseInt(params.get('islands'), 10) || 1));
const stage = document.getElementById('stage');
const state = { stepsPerFrame: 0, lastSpeed: 2, selectedId: null, fps: 60, phyloView: 'phylo', mullerNormalise: false, playhead: 0, behaviorFollow: true, behaviorPlaying: false, highlightSpecies: null, recording: recordingAtStart, ticksPerSecond: 0, frameMeasured: false };

// per-island CONFIG override when running multiple worlds: smaller worlds so N
// parallel sims + N renders stay smooth (the plan's budget rule)
const ISLAND_CFG = { maxPopulation: 3000, width: 2000, height: 1300, startPopulation: 200,
  startFood: 2900, maxFood: 6000, foodRate: 36, maxCarrion: 2200, bloomCount: 9 };

const islands = [];
let active = 0;
let ui = null, tour = null, lab = null, previewFrame = null, checkpointLoading = false;
let serial = 0; const requests = new Map(); let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
function request(isl, msg) { return new Promise((resolve, reject) => { const requestId = ++serial; requests.set(requestId, { resolve, reject, isl }); isl.worker.postMessage({ ...msg, requestId }); }); }
function loading(message) { document.getElementById('loadingState').hidden = !message; if (message) document.getElementById('loadingMessage').textContent = message; }
function status(message) { document.getElementById('worldStatus').textContent = message; }

// The immutable base seed. Islands derive `${baseSeed}-${i}`; the seed box always
// shows baseSeed (never a suffixed live seed), so repeated resets are reproducible
// and each island keeps its own lineage instead of collapsing onto the focused one.
let baseSeed = params.get('seed') || String(CONFIG.seed);

function makeSim(worker, seed, maxPop, w, h) {
  return {
    view: null, _buf: null, _useSAB: false, metrics: null, series: null, ticks: [],
    speciesMap: new Map(), speciesHistory: new Map(), speciesMeta: new Map(), historyTicks: [], fullSpeciesHistory: new Map(), fullSpeciesMeta: new Map(), inspect: null,
    width: w, height: h, topo: { nIn: CONFIG.nIn, nOut: CONFIG.nOut }, seed, maxPopulation: maxPop,
    send(msg, transfer) { worker.postMessage(msg, transfer || []); },
  };
}

function handleWorkerMsg(isl, m) {
  const sim = isl.sim;
  switch (m.type) {
    case 'snapshot':
      if (sim._buf) isl.worker.postMessage({ type: 'snapshotReturn', buf: sim._buf }, [sim._buf]);
      sim._buf = m.buf;
      sim.view = snapView(m.buf, sim.width, sim.height);
      if (!checkpointLoading) loading(null);
      break;
    case 'stats':
      sim.metrics = m.metrics; sim.series = m.series; sim.ticks = m.ticks;
      sim.speciesMap = new Map(m.species.map((s) => [s.id, s]));
      sim.speciesHistory = new Map(m.speciesHistory);
      sim.speciesMeta = new Map(m.speciesMeta);
      sim.historyTicks = m.historyTicks || m.ticks; sim.fullSpeciesHistory = new Map(m.fullSpeciesHistory || m.speciesHistory); sim.fullSpeciesMeta = new Map(m.fullSpeciesMeta || m.speciesMeta);
      break;
    case 'inspect': sim.inspect = m; break;
    case 'ready':
      if (m.loaded) tour?.reset(m.tick);
      sim.width = m.width; sim.height = m.height; sim.topo = m.topo; sim.seed = m.seed; sim.maxPopulation = m.maxPopulation;
      isl.renderer.setWorldSize(m.width, m.height);
      sim._useSAB = !!m.sab; sim._sabLastSeq = -1;
      if (m.sab) {
        sim._sabCtrl = new Int32Array(m.sab.ctrl);
        sim._sabU8 = new Uint8Array(m.sab.data);
        // double-buffered: SAB is copied into _scratch first, then swapped into
        // _local only on a clean (non-torn) read, so the live view never sees torn bytes
        sim._localBuf = new ArrayBuffer(m.sab.data.byteLength);
        sim._localU8 = new Uint8Array(sim._localBuf);
        sim._scratchBuf = new ArrayBuffer(m.sab.data.byteLength);
        sim._scratchU8 = new Uint8Array(sim._scratchBuf);
        if (isl.i === 0) console.log('GENESIS: SharedArrayBuffer snapshot path active');
      }
      sim.config = { ...(sim.config || {}), ...(m.config || {}), foodRate: m.foodRate, mutationRate: m.mutationRate };
      isl.renderer.setConfig?.(sim.config);
      document.getElementById('transportBadge').textContent = sim._useSAB ? 'SHARED MEMORY' : 'TRANSFER BUFFERS';
      if (isl.i === 0) readyResolve();
      isl.needFit = true;
      // island mode always shows the immutable base seed, never the suffixed live seed
      if (isl.i === active && ui) ui.onReady(islands.length > 1 ? { ...m, seed: baseSeed } : m);
      break;
    case 'saved': downloadState(m.state); if (ui) ui.toast('world downloaded'); break;
    case 'ack': {
      if (m.buf) { sim.view = snapView(m.buf, m.width || sim.width, m.height || sim.height); sim._rpcBuffer = m.buf; }
      if (m.metrics) sim.metrics = m.metrics;
      if (m.config) { sim.config = m.config; isl.renderer.setConfig?.(sim.config); }
      const pending = requests.get(m.requestId); if (pending) { requests.delete(m.requestId); pending.resolve(m); }
      break;
    }
    case 'error': case 'loadError': {
      if (!sim.config && isl.i === 0) readyReject(new Error(m.message));
      const pending = requests.get(m.requestId); if (pending) { requests.delete(m.requestId); pending.reject(new Error(m.message)); }
      else if (ui) ui.toast('Command failed: ' + m.message);
      loading(null); status('COMMAND ERROR'); break;
    }
  }
}

function readSAB(sim) {
  const ctrl = sim._sabCtrl;
  const s1 = Atomics.load(ctrl, 0);
  if (s1 === 0 || (s1 & 1) || s1 === sim._sabLastSeq) return; // worker mid-write — keep previous consistent view
  sim._scratchU8.set(sim._sabU8); // copy into scratch, NOT the live buffer
  if (Atomics.load(ctrl, 0) !== s1) return; // torn read — discard scratch, keep last good view
  sim._sabLastSeq = s1;
  // clean read: swap scratch <-> local, then point the view at the fresh buffer
  const b = sim._localBuf, u = sim._localU8;
  sim._localBuf = sim._scratchBuf; sim._localU8 = sim._scratchU8;
  sim._scratchBuf = b; sim._scratchU8 = u;
  sim.view = snapView(sim._localBuf, sim.width, sim.height);
  if (!checkpointLoading) loading(null);
}

function setActive(i) {
  if (i === active) return;
  // stop the outgoing island's worker inspecting a now-unfocused creature
  islands[active].sim.send({ type: 'select', id: null });
  active = i;
  state.selectedId = null;
  for (const isl of islands) if (isl.cell) isl.cell.classList.toggle('active', isl.i === active);
  if (ui) { ui.onReady({ ...islands[active].sim.config, seed: islands.length > 1 ? baseSeed : islands[active].sim.seed }); ui.refresh(); }
}

function attachCamera(isl) {
  const cv = isl.canvas, r = isl.renderer;
  let down = false, moved = false, lx = 0, ly = 0;
  cv.addEventListener('pointerdown', (e) => {
    setActive(isl.i);
    down = true; moved = false; lx = e.offsetX; ly = e.offsetY;
    cv.setPointerCapture(e.pointerId); stage.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.offsetX - lx, dy = e.offsetY - ly;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    r.panBy(dx, dy); lx = e.offsetX; ly = e.offsetY;
  });
  cv.addEventListener('pointerup', (e) => {
    down = false; stage.classList.remove('dragging');
    if (!moved) {
      if (previewFrame) { ui?.toast('Return to the observatory to inspect the source world'); return; }
      const id = r.pick(e.offsetX, e.offsetY, isl.sim.view);
      state.selectedId = id;
      isl.sim.send({ type: 'select', id });
      if (ui) ui.refresh();
    }
  });
  cv.addEventListener('pointercancel', () => { down = false; stage.classList.remove('dragging'); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); r.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
}

// Pick a renderer for `glCanvas`. GLRenderer.tryCreate may acquire a webgl2 context
// and then fail during shader/program build; that permanently locks the canvas so a
// 2D context can no longer bind to it. If that happened (getContext('2d') === null),
// swap in a fresh clone before falling back, so the 2D renderer always has a canvas.
function createRenderer(glCanvas, overlayCanvas) {
  const gl = params.get('renderer') === 'canvas' ? null : GLRenderer.tryCreate(glCanvas, overlayCanvas);
  if (gl) return gl;
  let c = glCanvas;
  if (!c.getContext('2d')) {
    const clone = c.cloneNode(false);
    if (c.parentNode) c.parentNode.replaceChild(clone, c);
    c = clone;
  }
  return new Renderer(c);
}

function makeIsland(i, glCanvas, overlayCanvas, cell, cfg) {
  const worker = new Worker(new URL('../sim.worker.js', import.meta.url), { type: 'module' });
  const renderer = createRenderer(glCanvas, overlayCanvas);
  const seed = cfg ? cfg.seed : CONFIG.seed;
  const maxPop = cfg ? cfg.maxPopulation : CONFIG.maxPopulation;
  const w = cfg ? cfg.width : CONFIG.width, h = cfg ? cfg.height : CONFIG.height;
  const sim = makeSim(worker, seed, maxPop, w, h);
  // renderer.canvas is the clone if the 2D fallback had to replace a locked canvas
  const isl = { i, worker, renderer, sim, canvas: renderer.canvas, overlay: overlayCanvas, cell, needFit: true };
  worker.onmessage = (e) => handleWorkerMsg(isl, e.data);
  worker.onerror = (e) => { if (isl.i === 0) readyReject(new Error(e.message)); loading('Worker failed: ' + e.message); status('WORKER ERROR'); for (const [id, p] of requests) if (p.isl === isl) { p.reject(new Error(e.message)); requests.delete(id); } };
  worker.postMessage({ type: 'init', config: cfg || { seed: baseSeed }, recording: recordingAtStart });
  renderer.resize();
  attachCamera(isl);
  islands.push(isl);
  return isl;
}

// --- build islands + layout ---
if (N === 1) {
  makeIsland(0, document.getElementById('world'), document.getElementById('overlay'), null, null);
} else {
  document.getElementById('world').remove();
  document.getElementById('overlay').remove();
  stage.classList.add('islands');
  stage.style.gridTemplateColumns = N >= 3 ? '1fr 1fr' : (N === 2 ? '1fr 1fr' : '1fr');
  stage.style.gridTemplateRows = N >= 3 ? '1fr 1fr' : '1fr';
  for (let i = 0; i < N; i++) {
    const cell = document.createElement('div');
    cell.className = 'island-cell' + (i === 0 ? ' active' : '');
    const gl = document.createElement('canvas'); gl.className = 'island-gl';
    const ov = document.createElement('canvas'); ov.className = 'island-ov';
    const label = document.createElement('div'); label.className = 'island-label'; label.textContent = 'world ' + (i + 1);
    cell.append(gl, ov, label);
    stage.appendChild(cell);
    makeIsland(i, gl, ov, cell, { ...ISLAND_CFG, seed: baseSeed + '-' + i });
  }
}

// --- proxy the active island to the dashboard ---
const SIM_KEYS = ['view', 'metrics', 'series', 'ticks', 'speciesMap', 'speciesHistory', 'speciesMeta', 'inspect', 'width', 'height', 'topo', 'seed', 'maxPopulation', '_useSAB', 'historyTicks', 'fullSpeciesHistory', 'fullSpeciesMeta', 'config'];
const uiSim = {
  send(msg, transfer) {
    const t = msg.type;
    if (previewFrame && ((t === 'speed' && msg.steps > 0) || ['reset','load','step'].includes(t))) clearPreview();
    if (t === 'select' || t === 'save' || t === 'load') { islands[active].sim.send(msg, transfer); return; }
    if (t === 'reset') {
      // msg.seed is the (un-suffixed) seed-box value; adopt it as the new base, then
      // re-derive each island from it. Never re-suffix an already-suffixed live seed.
      baseSeed = String(msg.seed);
      islands.forEach((isl, i) => isl.sim.send({ type: 'reset', seed: islands.length > 1 ? baseSeed + '-' + i : baseSeed }));
      return;
    }
    for (const isl of islands) isl.sim.send(msg); // speed / step / cataclysm / config broadcast to all
  },
};
for (const k of SIM_KEYS) Object.defineProperty(uiSim, k, { get: () => islands[active].sim[k] });
const uiRenderer = { fit() { islands[active].renderer.fit(); islands[active].needFit = false; }, get canvas() { return islands[active].canvas; } };

ui = initUI({ sim: uiSim, renderer: uiRenderer, state });

const ro = new ResizeObserver(() => { for (const isl of islands) { isl.renderer.resize(); if (isl.renderer.cssW <= 10) isl.needFit = true; } });
ro.observe(stage);

let lastT = null, rateTime = null, rateTick = null, frameHandle = null, manual = recordingAtStart;
function render() {
  for (const isl of islands) {
    if (isl.sim._useSAB && !previewFrame) readSAB(isl.sim);
    if (isl.needFit) { isl.renderer.resize(); if (isl.renderer.cssW > 10) { isl.renderer.fit(); isl.needFit = false; } }
    const v = previewFrame && isl.i === active ? previewFrame.view : isl.sim.view;
    isl.renderer.draw(v, isl.i === active ? state.selectedId : null, state.highlightSpecies);
  }
  ui.update(uiSim); tour?.update();
  return islands[active].sim.view?.tick ?? null;
}
function frame(now) {
  if (manual) return;
  if (lastT != null && now > lastT) { state.fps = state.fps * 0.9 + (1000 / (now - lastT)) * 0.1; state.frameMeasured = true; }
  const tick = islands[active].sim.view?.tick;
  if (rateTime == null || tick < rateTick) { rateTime = now; rateTick = tick; }
  if (tick != null && now - rateTime >= 1000) { state.ticksPerSecond = (tick - (rateTick ?? tick)) * 1000 / (now - rateTime); rateTime = now; rateTick = tick; }
  lastT = now;
  try { render(); } catch (err) { console.error('GENESIS render:', err); }
  frameHandle = requestAnimationFrame(frame);
}
if (!manual) frameHandle = requestAnimationFrame(frame);

const api = {
  ready, islands, state, get CONFIG() { return this.sim.config || CONFIG; }, setActive, get active() { return active; },
  get sim() { return islands[active].sim; }, get renderer() { return islands[active].renderer; },
  get recording() { return manual; }, lastExperiment: null,
  async pause() { ui.setSpeed(0); await Promise.all(islands.map(i => request(i, { type: 'speed', steps: 0 }))); },
  async setRecording(value = true) {
    manual = value; state.recording = value;
    if (frameHandle != null) cancelAnimationFrame(frameHandle);
    await Promise.all(islands.map(i => request(i, { type: 'mode', recording: value })));
    if (!value) { lastT = null; frameHandle = requestAnimationFrame(frame); }
  },
  async checkpoint() { await ready; return (await request(islands[active], { type: 'checkpoint' })).checkpoint; },
  async load(checkpoint) { await ready; clearPreview(); await request(islands[active], { type: 'load', checkpoint }); state.selectedId = null; state.highlightSpecies = null; render(); return this.sim.metrics; },
  async step(n = 1, options = {}) { await ready; const result = await request(islands[active], { type: 'step', n, stats: options.stats !== false }); render(); return { tick: result.tick, metrics: result.metrics }; },
  async config(key, value) { return request(islands[active], { type: 'config', key, value }); },
  async reset(seed = this.sim.seed || baseSeed) { await ready; clearPreview(); state.selectedId = null; state.selectedSpecies = null; state.highlightSpecies = null; tour?.reset(0); const r = await request(islands[active], { type:'reset', seed }); render(); return r.metrics; },
  render,
  setCamera(camera) { const r = this.renderer.camera || this.renderer; for (const key of ['cx','cy','zoom']) if (Number.isFinite(camera[key])) r[key] = camera[key]; islands[active].needFit = false; render(); },
  readback() { render(); const r = this.renderer; if (r.gl) { const bytes = new Uint8Array(r.canvas.width * r.canvas.height * 4); r.gl.readPixels(0, 0, r.canvas.width, r.canvas.height, r.gl.RGBA, r.gl.UNSIGNED_BYTE, bytes); return { width:r.canvas.width,height:r.canvas.height,rgba:bytes, bottomUp:true }; } const ctx = r.canvas.getContext('2d');return {width:r.canvas.width,height:r.canvas.height,rgba:ctx.getImageData(0,0,r.canvas.width,r.canvas.height).data,bottomUp:false}; },
};
function showPreview(data, label) { previewFrame = { view: snapView(data.buf, data.width, data.height) }; document.querySelector('#ribbon .eyebrow').textContent = 'SOURCE CHECKPOINT · LINEAGE HISTORY'; document.querySelector('.brand .eyebrow').textContent = 'SOURCE CHECKPOINT'; status(label); render(); }
function clearPreview() { previewFrame = null; document.querySelector('#ribbon .eyebrow').textContent = 'LINEAGE THROUGH TIME'; document.querySelector('.brand .eyebrow').textContent = 'FIELD NOTES'; status(state.stepsPerFrame ? 'LIVE OBSERVATION' : 'PAUSED'); }
window.GENESIS = window.__GENESIS = api;
tour = initOnboarding({ sim: uiSim, enabled: !recordingAtStart && params.get('tour') !== '0' });
lab = initLab({ api, preview: showPreview, clearPreview, onStart: () => tour.hide() });

async function fetchCheckpoint(entry) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`Checkpoint download failed (${response.status})`);
  const buffer = await response.arrayBuffer(), bytes = new Uint8Array(buffer);
  if (entry.sha256) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if (hash !== entry.sha256) throw new Error('Checkpoint checksum mismatch');
  }
  let text;
  if (bytes[0] === 31 && bytes[1] === 139) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress this checkpoint');
    text = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}
api.fetchCheckpoint = fetchCheckpoint;
let manifest = [];
async function chooseCheckpoint(id) {
  const entry = manifest.find(e => e.id === id);
  checkpointLoading = true; loading(entry ? `Loading ${entry.title}` : 'Starting a new world');
  try {
    await api.pause();
    if (!entry && id !== 'scratch') throw new Error('Unknown checkpoint: ' + id);
    if (entry) { const checkpoint = await fetchCheckpoint(entry); await api.load(checkpoint); document.getElementById('checkpointStatus').textContent = entry.description || `Resumed at tick ${api.sim.view.tick.toLocaleString()}`; }
    else { await api.reset(baseSeed); document.getElementById('checkpointStatus').textContent = 'Fresh seeded world · evolution starts here'; }
    status(manual ? 'FRAME LOCKED' : params.has('paused') ? 'PAUSED' : 'LIVE OBSERVATION');
    if (!manual && !params.has('paused')) ui.setSpeed(2);
    const url = new URL(location.href); if (entry) { url.searchParams.set('checkpoint', entry.id); url.searchParams.delete('scratch'); } else { url.searchParams.delete('checkpoint'); url.searchParams.set('scratch', '1'); } history.replaceState(null, '', url);
  } catch (err) { document.getElementById('checkpointStatus').textContent = err.message; ui.toast(err.message); status('CHECKPOINT UNAVAILABLE'); }
  finally { checkpointLoading = false; loading(null); render(); }
}
document.getElementById('btnCheckpoint').onclick = () => chooseCheckpoint(document.getElementById('checkpointSelect').value);
api.loadCheckpoint = chooseCheckpoint;
async function bootPage() {
  await ready;
  if (recordingAtStart) { status('FRAME LOCKED'); document.getElementById('checkpointStatus').textContent = 'Recording mode · automatic checkpoint loading is disabled'; loading(null); render(); return; }
  try {
    const response = await fetch('./checkpoints/manifest.json'); if (!response.ok) throw new Error(`manifest ${response.status}`);
    const data = await response.json(); manifest = data.checkpoints || [];
    if (!manifest.length) throw new Error('manifest contains no checkpoints');
    for (const entry of manifest) { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.title; document.getElementById('checkpointSelect').appendChild(option); }
    const chosen = params.has('scratch') ? 'scratch' : params.get('checkpoint') || data.default || manifest[0].id;
    document.getElementById('checkpointSelect').value = chosen;
    await chooseCheckpoint(chosen);
  } catch (err) {
    document.getElementById('checkpointStatus').textContent = `Starting from seed: curated checkpoints unavailable (${err.message}).`;
    status(params.has('paused') ? 'PAUSED · FROM SEED' : 'LIVE · FROM SEED'); loading(null); if (!params.has('paused')) ui.setSpeed(2);
  }
}
bootPage().catch(err => { loading('Unable to initialize: ' + err.message); console.error(err); });
