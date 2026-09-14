# Continuing GENESIS

Start with README.md, docs/MEASUREMENTS.md, docs/DECISIONS.md and evidence/.
I didn't include a pre-implementation note for continuing an unfinished, unrelated
feature (multi-world migration) in this repository; it described in-progress work, not
anything in this release.

## Working assumptions

The app runs on loopback with native ES modules, no package installation and no
build; there is no hosted deployment. Remaining limitations listed in this repo
are scientific or verified-platform boundaries, not a to-do list against a time
budget.

## Replay contract

Use a v4 exact world checkpoint including CONFIG. Restoring a legacy save is
approximate. Global CONFIG is realm-local: browser Lab arms use isolated workers;
Node arms restore and run sequentially. Do not interleave differently configured
World instances in the same realm without restoring their effective CONFIG.

metrics() must remain read-only. Maintain species membership at committed entry
and exit points; births are queued until the end of a tick and deaths are committed
there. Statistics readers derive interval births/deaths from cumulative counts.
Keep toState() pure and preserve resource slot/free-list order, IDs, RNG spare,
phase, speed, harvest counters, death flags, registry and unrounded weights.

## Evidence and reproduction

- observer-before/after JSON: actual schedules, full CONFIG, detailed fingerprints.
  Version2 includes ordered creature species assignments and representative genomes.
- observer-v1/: an earlier, weaker harness I kept on purpose as superseded evidence.
- core-edge-before.log / core-edge-after.log: independent red/green counterexamples.
- original-source.zip / source-manifest.json: the original source files and their hashes. The archived README.md carries the one redaction noted in docs/archive/README-before.md, and I didn't include the original docs/HANDOFF.md session note.
- checkpoints/manifest.json: content-addressed gzip data and exact continuation checks.
- lab-results.json: generated matched experiment, one seed and one horizon.
- browser-lab-export.json / replay CLI: checkpoint, prediction and trace replay.
- browser-tests.json / browser-layout.json: real measured browser scope.
- browser-lab-full.json: one real full-horizon form run, including its exact target
  and comparison of all recorded metric fields with the Node reference.
- shader-smoke.json / render-test.log: actual shader/palette/buffer checks.
- film-determinism.json / film-frames.json / docs/film-provenance.json: real capture evidence.
- node-benchmark.json / render-benchmark.json: measurements valid only within their
  recorded machine-load conditions and scopes. The AC primary renderer comparison
  observed 60 FPS in all three cases; background-idle gates failed, so the records
  do not establish a controlled speedup. Deferred or rejected is not passed.

To repeat the original failure, unzip evidence/original-source.zip into a scratch
folder and pass its directory to tools/observer-effect.mjs --source. The source
is archived evidence, not the application's import target.

Run npm test, npm run test:observer and node tools/headless.mjs 1200 42.
Browser tools require an installed Chrome binary; authoring the film requires
FFmpeg/ffprobe. Browser processes use disposable profiles and only owned PIDs.
Do not modify render sources during a capture. Regenerate checksums and reports
when inputs change. Source state, configuration, observation, simulation ticks,
unique capture frames and encoded fps are separate concepts.

## Next useful investigations

Measure multiple intervention seeds, calibrate a neutral toxin-intake control,
profile simulation neighbor sensing, and test real Safari/iOS. Treat these as
new experiments. A visually busy or weakly separated lineage is a model result,
not a reason to inflate its abundance. Keep the four limitation sentences
consistent across README, app, article and film.
