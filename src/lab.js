// Matched interventions use separate worker realms. CONFIG and the random stream
// are restored from the exact same checkpoint before each branch. They execute
// sequentially, avoiding simultaneous heavy simulation on the host.
import { renderChart } from './charts.js';

export const INTERVENTIONS = Object.freeze({
  'food-half': { title: 'Food arrival × 0.5', patch: (c) => ({ foodRate: c.foodRate * 0.5 }) },
  'metabolism-double': { title: 'Base + movement metabolism × 2', patch: (c) => ({ baseMetabolism: c.baseMetabolism * 2, moveMetabolism: c.moveMetabolism * 2 }) },
  'toxin-zero': { title: 'Toxin energy loss → 0', patch: () => ({ toxinEnergy: 0 }) },
});
export function makePlan(checkpoint, intervention, prediction, ticks = 1800) {
  if (!INTERVENTIONS[intervention]) throw new Error('Unknown intervention');
  if (!Number.isInteger(prediction) || prediction < 0) throw new Error('Prediction must be a non-negative whole population');
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000) throw new Error('Choose 1–10,000 whole ticks');
  const config = checkpoint.provenance?.config || checkpoint.state?.config;
  if (!config || !checkpoint.state) throw new Error('Experiment requires a checkpoint with its effective configuration');
  return { schemaVersion: 1, intervention, title: INTERVENTIONS[intervention].title, prediction,
    startTick: checkpoint.state.tick, ticks, targetTick: checkpoint.state.tick + ticks,
    config: structuredClone(config), patch: INTERVENTIONS[intervention].patch(config) };
}
export function compareOutcome(plan, control, intervention) {
  if (control.tick !== plan.targetTick || intervention.tick !== plan.targetTick) throw new Error('Branch did not reach the exact target tick');
  const actual = intervention.population, signedError = plan.prediction - actual;
  return { prediction: plan.prediction, actual, control: control.population, signedError,
    absoluteError: Math.abs(signedError), relativeError: actual ? Math.abs(signedError) / actual : null,
    populationEffect: actual - control.population,
    relativeEffect: control.population ? (actual - control.population) / control.population : null };
}
function workerSession(config) {
  const worker = new Worker(new URL('../sim.worker.js', import.meta.url), { type: 'module' });
  let serial = 0; const pending = new Map();
  worker.onmessage = ({ data }) => {
    if (data.type === 'snapshot') { worker.postMessage({ type: 'snapshotReturn', buf: data.buf }, [data.buf]); return; }
    if (data.requestId != null) { const p = pending.get(data.requestId); if (!p) return; pending.delete(data.requestId); data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data); }
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message)); pending.clear(); };
  return { request(msg) { return new Promise((resolve, reject) => { const requestId = ++serial; pending.set(requestId, { resolve, reject }); worker.postMessage({ ...msg, requestId }); }); },
    close() { worker.terminate(); for (const p of pending.values()) p.reject(new Error('Experiment cancelled')); pending.clear(); } };
}
export async function runMatchedExperiment({ checkpoint, plan, onProgress = () => {}, signal }) {
  const branches = {}, trace = [];
  for (const name of ['control', 'intervention']) {
    if (signal?.aborted) throw new Error('Experiment cancelled');
    const session = workerSession(plan.config), abort = () => session.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await session.request({ type: 'init', config: plan.config, recording: true });
      const loaded = await session.request({ type: 'load', checkpoint });
      trace.push({ branch: name, command: 'load-checkpoint', tick: loaded.tick });
      if (name === 'intervention') for (const [key, value] of Object.entries(plan.patch)) {
        await session.request({ type: 'config', key, value }); trace.push({ branch: name, command: 'config', tick: loaded.tick, key, value });
      }
      const samples = [{ tick: loaded.tick, population: loaded.metrics.population }];
      let latest = loaded, advanced = 0;
      while (advanced < plan.ticks) {
        if (signal?.aborted) throw new Error('Experiment cancelled');
        const n = Math.min(24, plan.ticks - advanced);
        latest = await session.request({ type: 'step', n, stats: false }); advanced += n;
        samples.push({ tick: latest.tick, population: latest.metrics.population });
        onProgress({ name, advanced, total: plan.ticks, latest, samples, control: branches.control });
      }
      trace.push({ branch: name, command: 'step', n: plan.ticks, stats: false, targetTick: latest.tick });
      branches[name] = { metrics: latest.metrics, samples, snapshot: latest.buf, width: latest.width, height: latest.height };
    } finally { signal?.removeEventListener('abort', abort); session.close(); }
  }
  return { schemaVersion: 1, plan, result: compareOutcome(plan, branches.control.metrics, branches.intervention.metrics),
    commands: trace, branches, checkpoint };
}
export function initLab({ api, preview, clearPreview, onStart = () => {} }) {
  const $ = (id) => document.getElementById(id); let experiment = null, controller = null;
  function chart(control, treatment) { renderChart($('labChart'), [{ data: control || [], color: '#91a5b8' }, { data: treatment || [], color: '#ffc454' }], { label: 'population · control / intervention', min: 0 }); }
  async function run() {
    const prediction = Number($('labPrediction').value), ticks = Number($('labTicks').value), intervention = $('labIntervention').value;
    if (!$('labForm').reportValidity()) return;
    $('labRun').disabled = true; $('labPrediction').disabled = true; $('labTicks').disabled = true; $('labIntervention').disabled = true;
    $('labResult').hidden = true; $('labProgress').hidden = false; $('labCancel').hidden = false; $('labProgressLabel').textContent = 'Preparing matched worlds'; $('labProgressBar').value = 0;
    controller = new AbortController(); onStart();
    const pausedControls = [...document.querySelectorAll('.controls-details button, .controls-details input, #checkpointSelect, #btnCheckpoint')].map(el => [el, el.disabled]);
    for (const [el] of pausedControls) el.disabled = true;
    $('ecologyLab').setAttribute('aria-busy', 'true');
    try {
      await api.pause();
      const checkpoint = await api.checkpoint(); const plan = makePlan(checkpoint, intervention, prediction, ticks);
      $('labStatus').textContent = `Prediction locked: ${prediction.toLocaleString()} organisms at tick ${plan.targetTick.toLocaleString()}. Both branches start at tick ${plan.startTick.toLocaleString()}.`;
      experiment = await runMatchedExperiment({ checkpoint, plan, signal: controller.signal, onProgress(p) {
        $('labProgressLabel').textContent = `${p.name === 'control' ? 'Control' : 'Intervention'} · ${p.advanced.toLocaleString()} / ${p.total.toLocaleString()} ticks`;
        $('labProgressBar').value = ((p.name === 'intervention' ? 1 : 0) + p.advanced / p.total) / 2;
        chart(p.name === 'control' ? p.samples.map(s => s.population) : p.control.samples.map(s => s.population), p.name === 'intervention' ? p.samples.map(s => s.population) : []);
        preview(p.latest, `LAB · ${p.name.toUpperCase()}`);
      } });
      const r = experiment.result; $('labResult').hidden = false;
      $('labPredicted').textContent = r.prediction.toLocaleString(); $('labControl').textContent = r.control.toLocaleString(); $('labActual').textContent = r.actual.toLocaleString();
      $('labError').textContent = r.absoluteError === 0 ? 'Your prediction matched this outcome exactly.' : `Your prediction was ${r.signedError > 0 ? 'high' : 'low'} by ${r.absoluteError.toLocaleString()} organisms${r.relativeError == null ? '' : ` (${(r.relativeError * 100).toFixed(1)}% of the outcome)`}.`;
      $('labEffect').textContent = `Intervention − control: ${r.populationEffect > 0 ? '+' : ''}${r.populationEffect.toLocaleString()} organisms${r.relativeEffect == null ? '' : ` (${(r.relativeEffect * 100).toFixed(1)}%)`}. Same start, same tick, one changed pressure.`;
      $('labProgressLabel').textContent = `Complete · tick ${plan.targetTick.toLocaleString()}`;
      $('labStatus').textContent = 'A single-seed intervention is not a general ecological law.';
      api.lastExperiment = experiment;
    } catch (err) { $('labStatus').textContent = err.message; $('labProgressLabel').textContent = 'Experiment stopped'; clearPreview(); }
    finally { controller = null; $('labCancel').hidden = true; $('ecologyLab').setAttribute('aria-busy', 'false'); for (const [el, disabled] of pausedControls) el.disabled = disabled; for (const id of ['labRun','labPrediction','labTicks','labIntervention']) $(id).disabled = false; }
  }
  $('labForm').onsubmit = (e) => { e.preventDefault(); run(); };
  $('labCancel').onclick = () => controller?.abort();
  for (const [id, name] of [['labViewControl','control'], ['labViewTreatment','intervention']]) $(id).onclick = () => {
    const branch = experiment?.branches[name]; if (branch) preview({ buf: branch.snapshot, width: branch.width, height: branch.height, metrics: branch.metrics }, `LAB · ${name.toUpperCase()}`);
  };
  $('labReturn').onclick = () => clearPreview();
  $('labExport').onclick = async () => {
    if (!experiment) return;
    const { branches, ...rest } = experiment;
    const bytes = new TextEncoder().encode(JSON.stringify(experiment.checkpoint));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const out = { ...rest, checkpointSHA256: hash, branches: Object.fromEntries(Object.entries(branches).map(([k,v])=>[k,{metrics:v.metrics,samples:v.samples}])) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type:'application/json' }));
    const a = document.createElement('a'); a.href=url;a.download=`genesis-lab-${experiment.plan.intervention}-t${experiment.plan.targetTick}.json`;a.click();URL.revokeObjectURL(url);
  };
  return { run, cancel() { controller?.abort(); } };
}
