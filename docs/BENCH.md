# Rendering and performance evidence

The matched AC comparison observed **60.01 FPS median** for the original renderer, the current renderer, and the current renderer with clade highlighting plus a synthetic lineage ribbon redrawn every frame. Each case measured approximately 60 seconds at the same camera and 1280 × 720 viewport, using 8,000 organisms, 16,000 food particles and 5,800 carrion particles.

This is an observed frame rate, **not a controlled speedup result**. Every primary case failed at least one predeclared background-idle check. Their raw samples are retained with `accepted: false`; the overall acceptance status is `unvalidated-background-contention`. CPU submission timings include snapshot-view creation and draw submission, and do not measure GPU execution time. The simulation worker is absent from this rendering fixture.

The numerical tables are generated in [MEASUREMENTS.md](MEASUREMENTS.md), directly from the primary and broader-matrix JSON files. The shorter 12-case matrix varies zoom, renderer, clade selection and ribbon display. Canvas is a fallback diagnostic; it is not included in the WebGL 55 FPS criterion. Its zoom 0.25 and 0.4 cases have approximately 33.33 ms frame-time p95 despite a 60 FPS median, so the median alone hides some slower frames.

## Why the measurement protocol is explicit

The first protocol required a one-minute system load of at most 3 before and after every case. It deferred several starts and rejected a completed baseline measurement. Those records remain in `evidence/`. Background CPU probes were also recorded; the renderer's own work contributes to aggregate system load.

A second protocol was declared before collecting its samples. It measures aggregate CPU idle for five seconds before and after each case and requires at least 75% idle at both ends. During-case CPU, load averages and power state are reported separately. The record-all policy samples every case once even when a gate fails, preserving rejected samples instead of retrying until a favorable result appears. No unrelated process or OS power setting was changed.

While the battery was very low, empty requestAnimationFrame probes measured about 30 Hz in both headless and headed Chrome. Fresh probes after AC connection measured about 60 Hz headless and 120 Hz headed. The final comparison is recorded on AC; earlier battery diagnostics are kept separate. The observed change does not isolate a particular browser or OS power-saving mechanism.

The separate Node CPU benchmark measures a changing simulation after ten warmup steps. Its 100 measured steps satisfy the original system-load gate. Its power state was not captured, and it is not a controlled comparison with the later AC browser runs.

## Reproduce

From the repository root:

```sh
node tools/bench.mjs
node tools/render-benchmark.mjs --focus --cpu-idle-gate --record-all --frames 3600 --warmup 180
node tools/render-benchmark.mjs --cpu-idle-gate --record-all --frames 240 --warmup 60
node tools/build-report.mjs
```

Omit `--record-all` to stop when a quietness gate fails. Omit `--cpu-idle-gate` to select the original absolute-load protocol. The renderer tool starts and closes its own loopback server and isolated Chrome profile. It writes the protocol decision before performance samples and includes source hashes, all frame intervals, CPU submission samples and per-case environment probes.

No glow or trail feedback buffers were added. The measured full presentation consists of organism silhouettes, genetic-diet colors, clade selection and lineage history. Runtime refresh rate, background work, viewport, power state and device remain part of any performance claim.
