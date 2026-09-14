// Dashboard controller. The simulation runs in a worker; this reads the latest
// snapshot + stats from the `sim` facade and forwards every control as a message.
// main.js owns the animation loop and calls ui.update(sim) once per frame.

import { CONFIG } from './config.js';
import { renderChart } from './charts.js';
import { renderNet } from './netviz.js';
import { renderPhylo } from './phylo.js';
import { renderMuller } from './muller.js';
import { renderHeatmap } from './heatmap.js';
import { renderBehaviorTree } from './behaviortree.js';
import { buildNetwork } from './neat.js';
import { decodeBody } from './genome.js';
import { readStateFile } from './persistence.js';

const $ = (id) => document.getElementById(id);
const GENE_LABELS = ['size', 'speed', 'range', 'fov', 'hue', 'metab', 'lifespan', 'rhythm', 'diet', 'scavenge'];

export function initUI({ sim, renderer, state }) {
  const els = {
    pop: $('statPop'), gen: $('statGen'), food: $('statFood'), tick: $('statTick'),
    species: $('statSpecies'), carrion: $('statCarrion'),
    play: $('btnPlay'), speed: $('speed'), speedLabel: $('speedLabel'),
    foodRate: $('foodRate'), foodRateLabel: $('foodRateLabel'),
    mutRate: $('mutRate'), mutRateLabel: $('mutRateLabel'),
    seedInput: $('seedInput'),
    chartPop: $('chartPop'), chartGen: $('chartGen'),
    chartTraits: $('chartTraits'), chartSpecies: $('chartSpecies'),
    phylo: $('phyloCanvas'), muller: $('mullerCanvas'), heatmap: $('heatmapCanvas'), behavior: $('behaviorCanvas'),
    phyloWrap: $('phyloWrap'), mullerWrap: $('mullerWrap'), heatmapWrap: $('heatmapWrap'), behaviorWrap: $('behaviorWrap'),
    behaviorScrubRow: $('behaviorScrubRow'), behaviorScrub: $('behaviorScrub'), behaviorPlay: $('btnBehaviorPlay'),
    phyloToggle: $('btnPhyloToggle'), phyloLabel: $('phyloLabel'),
    inspector: $('inspector'), inspBody: $('inspBody'), inspHint: $('inspHint'),
    title: $('specimenTitle'), deselect: $('btnDeselect'),
    net: $('netCanvas'), specimenStats: $('specimenStats'), genome: $('genomeBars'),
    fps: $('fps'), toast: $('toast'), stage: $('stage'), ribbon: $('mullerRibbon'),
  };

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1700);
  }

  // ---- speed / play ----
  function setSpeed(v) {
    v = Math.max(0, Math.min(24, v | 0));
    state.stepsPerFrame = v;
    if (v > 0) state.lastSpeed = v;
    els.speed.value = v;
    els.speedLabel.textContent = v === 0 ? 'paused' : v + ' ticks/update';
    els.play.textContent = v === 0 ? '▶ play' : '⏸ pause';
    sim.send({ type: 'speed', steps: v });
    $('worldStatus').textContent = v > 0 ? 'LIVE OBSERVATION' : 'PAUSED';
  }
  els.play.onclick = () => setSpeed(state.stepsPerFrame > 0 ? 0 : (state.lastSpeed || 2));
  els.speed.oninput = () => setSpeed(+els.speed.value);
  $('btnStep').onclick = () => { setSpeed(0); sim.send({ type: 'step', n: 1 }); };

  // ---- reset / seed ----
  function resetPlayback() {
    state.playhead = 0; state.behaviorFollow = true; state.behaviorPlaying = false;
    els.behaviorPlay.textContent = '▶';
  }
  function doReset(seed) {
    sim.send({ type: 'reset', seed });
    state.selectedId = null; state.highlightSpecies = null; state.selectedSpecies = null;
    sim.send({ type: 'select', id: null });
    els.seedInput.value = seed;
    resetPlayback();
    refreshInspector(true);
    toast('new world · seed ' + seed);
  }
  $('btnReset').onclick = () => doReset(els.seedInput.value || sim.seed);
  $('btnReseed').onclick = () => doReset(
    els.seedInput.value ||
    (Number.isFinite(+sim.seed) ? String((+sim.seed | 0) + 1) : String(sim.seed) + '-next'));

  // ---- world events ----
  $('btnCataclysm').onclick = () => { sim.send({ type: 'cataclysm' }); toast('Cataclysm applied · observe which lineages survive'); };
  $('btnSave').onclick = () => sim.send({ type: 'save' });
  $('btnLoad').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    readStateFile(f)
      .then((st) => { sim.send({ type: 'load', state: st }); state.selectedId = null; resetPlayback(); toast('loading world…'); })
      .catch(() => toast('load failed — invalid file'));
    e.target.value = '';
  };

  // ---- live config sliders (worker-authoritative CONFIG) ----
  els.foodRate.value = CONFIG.foodRate;
  els.foodRate.oninput = () => {
    els.foodRateLabel.textContent = (+els.foodRate.value).toFixed(1);
    sim.send({ type: 'config', key: 'foodRate', value: +els.foodRate.value });
  };
  els.mutRate.value = CONFIG.mutationRate;
  els.mutRate.oninput = () => {
    els.mutRateLabel.textContent = (+els.mutRate.value).toFixed(2);
    sim.send({ type: 'config', key: 'mutationRate', value: +els.mutRate.value });
  };
  els.foodRateLabel.textContent = CONFIG.foodRate.toFixed(1);
  els.mutRateLabel.textContent = CONFIG.mutationRate.toFixed(2);
  els.seedInput.value = sim.seed;

  els.deselect.onclick = () => { state.selectedId = null; sim.send({ type: 'select', id: null }); refreshInspector(true); };

  // phylogeny → muller → heatmap → behavior 4-way cycle
  const VIEWS = ['phylo', 'muller', 'heatmap', 'behaviortree'];
  const VIEW_META = {
    phylo: { label: 'phylogeny · species lineages', next: '⤳ Muller' },
    muller: { label: 'muller · clade abundance', next: '⤳ heatmap' },
    heatmap: { label: 'heatmap · per-species brain complexity', next: '⤳ behavior' },
    behaviortree: { label: 'behavior · evolution playback', next: '⤳ tree' },
  };
  function renderViews() {
    renderRibbon();
    if (state.phyloView === 'muller') {
      renderMuller(els.muller, sim.historyTicks || sim.ticks, sim.fullSpeciesHistory || sim.speciesHistory, sim.fullSpeciesMeta || sim.speciesMeta, { normalise: state.mullerNormalise, highlightSpecies: state.highlightSpecies });
    } else if (state.phyloView === 'heatmap') {
      renderHeatmap(els.heatmap, [...sim.speciesMap.values()]);
    } else if (state.phyloView === 'behaviortree') {
      const cur = sim.view ? sim.view.tick : 0;
      // a stale playhead past the current tick (after reset/load to an earlier world)
      // would cram the whole tree at the right edge and freeze — snap back to live
      if (state.playhead > cur) { state.playhead = cur; state.behaviorFollow = true; state.behaviorPlaying = false; els.behaviorPlay.textContent = '▶'; }
      if (state.behaviorFollow) state.playhead = cur;
      renderBehaviorTree(els.behavior, sim.speciesMap, state.playhead, cur);
      els.behaviorScrub.value = cur > 0 ? Math.round(state.playhead / cur * 1000) : 1000;
    } else {
      renderPhylo(els.phylo, sim.speciesMap, sim.view ? sim.view.tick : 0);
    }
  }
  els.phyloToggle.onclick = () => {
    state.phyloView = VIEWS[(VIEWS.indexOf(state.phyloView) + 1) % VIEWS.length];
    els.phyloWrap.hidden = state.phyloView !== 'phylo';
    els.mullerWrap.hidden = state.phyloView !== 'muller';
    els.heatmapWrap.hidden = state.phyloView !== 'heatmap';
    els.behaviorWrap.hidden = state.phyloView !== 'behaviortree';
    els.behaviorScrubRow.hidden = state.phyloView !== 'behaviortree';
    els.phyloToggle.textContent = VIEW_META[state.phyloView].next;
    els.phyloLabel.textContent = VIEW_META[state.phyloView].label;
    renderViews();
  };
  els.behaviorScrub.oninput = () => {
    const cur = sim.view ? sim.view.tick : 0;
    const frac = +els.behaviorScrub.value / 1000;
    state.playhead = Math.round(frac * cur);
    state.behaviorFollow = frac >= 0.999;
    state.behaviorPlaying = false;
    els.behaviorPlay.textContent = '▶';
    renderViews();
  };
  els.behaviorPlay.onclick = () => {
    state.behaviorPlaying = !state.behaviorPlaying;
    els.behaviorPlay.textContent = state.behaviorPlaying ? '⏸' : '▶';
    if (state.behaviorPlaying) { state.behaviorFollow = false; state.playhead = 0; }
  };

  // camera pan/zoom/pick is handled per-island in main.js (multi-world aware)

  // The full-history ribbon selects a clade, including future descendants.
  function selectClade(id) {
    state.selectedSpecies = id == null ? null : Number(id);
    updateClade(); renderRibbon();
  }
  function updateClade() {
    if (state.selectedSpecies == null) { state.highlightSpecies = null; $('clearClade').hidden = true; $('cladeLabel').textContent = 'Select a band to follow its descendants'; return; }
    const ids = new Set([state.selectedSpecies]); let changed = true;
    while (changed) { changed = false; for (const sp of sim.speciesMap.values()) if (ids.has(sp.parent) && !ids.has(sp.id)) { ids.add(sp.id); changed = true; } }
    state.highlightSpecies = ids;
    const living = [...ids].reduce((n, id) => n + (sim.speciesMap.get(id)?.count || 0), 0);
    $('cladeLabel').textContent = `Clade #${state.selectedSpecies} · ${ids.size.toLocaleString()} lineages · ${living.toLocaleString()} alive`;
    $('clearClade').hidden = false;
  }
  function renderRibbon() {
    updateClade();
    const ticks = sim.historyTicks?.length ? sim.historyTicks : sim.ticks;
    renderMuller(els.ribbon, ticks, sim.fullSpeciesHistory?.size ? sim.fullSpeciesHistory : sim.speciesHistory, sim.fullSpeciesMeta?.size ? sim.fullSpeciesMeta : sim.speciesMeta, { normalise: false, highlightSpecies: state.highlightSpecies, labels: false });
    $('historyStart').textContent = `TICK ${(ticks[0] ?? 0).toLocaleString()}`;
    $('historyEnd').textContent = `TICK ${(ticks.at(-1) ?? sim.view?.tick ?? 0).toLocaleString()}`;
  }
  for (const canvas of [els.ribbon, els.muller]) canvas.addEventListener('click', (e) => { const hit = canvas._mullerPick?.(e.offsetX, e.offsetY); if (hit != null) selectClade(typeof hit === 'object' ? hit.id : hit); });
  $('clearClade').onclick = () => selectClade(null);

  // ---- keyboard ----
  window.addEventListener('keydown', (e) => {
    if (['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName) || e.target.isContentEditable) return;
    if (e.code === 'Space') { e.preventDefault(); els.play.click(); }
    else if (e.key === 'c') $('btnCataclysm').click();
    else if (e.key === 'f') renderer.fit();
  });

  // ---- inspector (fed by worker 'inspect' pushes) ----
  let lastInspect = null;
  function refreshInspector(structural) {
    const id = state.selectedId;
    if (id == null) {
      els.inspector.classList.add('empty');
      els.inspBody.hidden = true; els.inspHint.hidden = false; els.deselect.hidden = true;
      els.title.textContent = 'no specimen selected';
      lastInspect = null;
      return;
    }
    els.inspector.classList.remove('empty');
    els.inspHint.hidden = true;
    els.deselect.hidden = false;
    const insp = (sim.inspect && sim.inspect.id === id) ? sim.inspect : null;
    if (!insp) { els.title.textContent = `specimen #${id}`; els.inspBody.hidden = true; return; }
    if (!structural && insp === lastInspect) return;
    lastInspect = insp;
    els.title.textContent = `specimen #${id}` + (insp.alive ? '' : ' † deceased');
    if (!insp.alive) { els.inspBody.hidden = true; return; }
    els.inspBody.hidden = false;

    const brain = {
      nodes: insp.brain.nodes.map((n) => ({ id: n[0], type: n[1] })),
      conns: insp.brain.conns.map((k) => ({ from: k[0], to: k[1], w: k[2], enabled: !!k[3] })),
    };
    const net = buildNetwork(brain, sim.topo.nIn, sim.topo.nOut);
    net.val = new Map(insp.activations);
    renderNet(els.net, brain, net);

    const b = decodeBody(insp.body);
    const niche = b.diet > (sim.config?.carnivoreThreshold ?? CONFIG.carnivoreThreshold) ? 'carnivore' : (b.scavenge > (sim.config?.scavengerLabel ?? CONFIG.scavengerLabel) ? 'scavenger' : 'herbivore');
    const rows = [
      ['generation', insp.gen], ['species', '#' + insp.species], ['niche', niche],
      ['age', insp.age], ['energy', insp.energy], ['harvested', insp.eaten],
      ['brain', `${insp.hidden}n · ${insp.conns}c`], ['kills', insp.kills],
      ['size', b.size.toFixed(2)], ['max speed', b.maxSpeed.toFixed(2)],
      ['vision', b.sensorRange.toFixed(0)], ['scavenge', b.scavenge.toFixed(2)],
    ];
    els.specimenStats.innerHTML = rows
      .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
    els.genome.innerHTML = insp.body.reduce((acc, g, i) =>
      acc + `<div class="gene"><span class="gk">${GENE_LABELS[i]}</span>` +
      `<span class="bar"><i style="width:${(Math.max(0, Math.min(1, g)) * 100).toFixed(0)}%"></i></span></div>`, '');
  }

  // ---- per-frame refresh ----
  let frame = 0, lastHistory = null, lastRibbonWidth = 0;
  function update() {
    frame++;
    if (sim.fullSpeciesHistory !== lastHistory || els.ribbon.clientWidth !== lastRibbonWidth) { lastHistory = sim.fullSpeciesHistory; lastRibbonWidth = els.ribbon.clientWidth; renderViews(); }
    const v = sim.view, m = sim.metrics;
    els.pop.textContent = v ? (v.creatureCount ?? v.nc ?? v.creatures.length).toLocaleString() : '—';
    els.gen.textContent = v ? v.generationMax : '—';
    els.food.textContent = v ? v.foodCount : '—';
    els.carrion.textContent = v ? v.carrionCount : '—';
    els.species.textContent = v?.livingSpecies ?? (m ? m.species : '—');
    els.tick.textContent = v ? v.tick.toLocaleString() : '—';
    els.fps.textContent = state.recording ? 'frame locked' : (state.frameMeasured ? state.fps.toFixed(0) + ' render fps' : 'measuring render rate');
    $('simRate').textContent = state.recording ? 'manual ticks' : state.ticksPerSecond.toFixed(1) + ' ticks/s';

    if ((state.recording || frame % 8 === 0) && sim.series && sim.ticks.length > 1) {
      const s = sim.series;
      renderChart(els.chartPop, [
        { data: s.population, color: 'hsl(168,70%,55%)', fill: true },
        { data: s.carnivores, color: 'hsl(2,85%,62%)' },
        { data: s.scavengers, color: 'hsl(40,90%,60%)' },
      ], { label: 'population · carn · scav', min: 0 });
      renderChart(els.chartGen, [
        { data: s.maxGen, color: 'hsl(168,78%,62%)' },
        { data: s.avgGen, color: 'rgba(140,233,255,0.75)' },
      ], { label: 'generation ▸ max / avg', min: 0 });
      renderChart(els.chartTraits, [{ data: s.avgAddedConns || s.avgConns, color: 'hsl(190,80%,62%)' }], { label: s.avgAddedConns ? 'brain · added connections' : 'brain · connections' });
      renderChart(els.chartSpecies, [{ data: s.species, color: 'hsl(280,72%,70%)' }], { label: 'living species', min: 0 });
    }

    // behavior playback: sweep the playhead from 0 → now over ~2s
    if (state.behaviorPlaying && state.phyloView === 'behaviortree') {
      const cur = v ? v.tick : 0;
      state.playhead = Math.min(cur, state.playhead + Math.max(1, cur / 120));
      if (state.playhead >= cur) { state.behaviorPlaying = false; state.behaviorFollow = true; els.behaviorPlay.textContent = '▶'; }
      renderViews();
    } else if (frame % 16 === 0 && sim.ticks.length > 1) renderViews();
    if (state.selectedId != null && frame % 3 === 0) refreshInspector(false);
  }

  function onReady(m) {
    if (!m) return;
    if (m.seed != null) els.seedInput.value = m.seed;
    // sync sliders to the world's EFFECTIVE config (island worlds run their own
    // foodRate, which differs from the main-thread CONFIG default)
    if (m.foodRate != null) { els.foodRate.value = m.foodRate; els.foodRateLabel.textContent = (+m.foodRate).toFixed(1); }
    if (m.mutationRate != null) { els.mutRate.value = m.mutationRate; els.mutRateLabel.textContent = (+m.mutationRate).toFixed(2); }
  }

  // force an immediate re-render of the inspector + panels (on focus/selection change)
  function refresh() { refreshInspector(true); renderViews(); }

  setSpeed(state.stepsPerFrame);
  return { update, toast, doReset, onReady, refresh, setSpeed };
}
