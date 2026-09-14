# Seeing the ecology

A creature’s hue identifies a **trait category**. It does not measure its recent diet or the energy flow through the ecosystem. All creatures can consume food and carrion; the scavenger label denotes a carrion-efficiency threshold. Carnivore takes priority when both labels apply.

| Visual channel | Meaning |
| --- | --- |
| Teal, long rounded silhouette | Diet at or below `CONFIG.carnivoreThreshold` and scavenging at or below `CONFIG.scavengerLabel` |
| Ochre, broad rounded silhouette | Scavenging above the label threshold, without the carnivore trait |
| Crimson, pointed silhouette | Diet above the carnivore threshold |
| Bounded hue variation | Species identity, deterministically mapped into a narrow colour band |
| Brightness | Energy relative to the configured energy ceiling |
| Transparency | Age relative to that individual’s genetic lifespan; fades during the final 45% |
| Amber dot | Nectar |
| Muted violet dot | Toxic food |
| Hollow rust ring | Carrion |

The JavaScript colour function and generated GLSL palette share anchors and spreads in `src/palette.js`. Each renderer receives the effective world configuration through `setConfig`, so loaded checkpoints and multiple islands retain their own classification thresholds. Herbivore hue spans 140–196°, scavenger hue 20–48°, and carnivore hue 344–360°. Species IDs repeat in the hue mapping after 29 IDs: colour is a grouping aid, not a unique identifier. Select a lineage for an exact descendant mask.

The widened snapshot stores scavenging and age fraction. Its header carries living-species count from population bookkeeping; packing does not call `metrics()`. At capacities 8,000 creatures, 16,000 food items and 5,800 carrion items, the buffer is **654,432 bytes**; `tools/render-test.mjs` checks the calculation. WebGL and camera picking use packed bytes directly. Legacy object-array access remains available lazily for tools that explicitly request it.

Zoom reveals a small eye and central body mark. No blur, shadow, glow buffer or motion trail is rendered. Selected descendants retain their normal colour while other organisms recede. This keeps the selection spatially precise; there is no halo that could be mistaken for a larger body.

The Muller ribbon receives full-history samples from Stats and positions them by actual tick, including uneven decimated intervals. Its bands encode species abundance; click testing interpolates the displayed band boundaries. Colour in the ribbon denotes a lineage, not a trophic category. The oldest and latest retained ticks are printed on the chart. The ribbon cannot rewind a live simulation.

## Verification

- `node tools/render-test.mjs`: packed-buffer capacity and offsets, round trip, overflow clipping, invalid-header rejection, classification boundaries, colour bounds, energy/age channels, allocation-free camera picking, descendant traversal and nonuniform-time Muller hit testing.
- `node tools/render-verify.mjs`: eight real Chrome rendering cases, shader linking and GL error checks, Canvas fallback, lineage masking, and readback comparisons between WebGL and Canvas specimen colours/age alpha under default and changed thresholds. Saves `evidence/shader-smoke.json` and `evidence/render-*.png`.
- `node tools/render-checkpoints.mjs 1200 2400 9000`: matched checkpoint captures at the world centre and zoom 0.4, with manifest population/tick checks. It rejects a requested tick missing from the manifest; `--clade` also clicks a visible non-founder lineage and verifies that the descendant mask selects a nonempty subset.
- `node tools/render-benchmark.mjs`: twelve scenarios at three camera zooms, original/revised WebGL and a Canvas fallback stress pass. It records source hashes and raw samples; `uptime` and the one-minute load average are checked before measurement and the load is checked again around each scenario. Current WebGL and Canvas stress cases include a synthetic full-width lineage ribbon.
- `node tools/render-benchmark.mjs --focus --frames 3600 --warmup 180`: three primary WebGL cases at zoom 0.4. Each measures 3,600 frames (about 60 seconds at 60 Hz), after 180 warmup frames. `--fallback` optionally adds a separate 240-frame Canvas stress case. The output records actual measured duration and evaluates the 55 fps median criterion for current WebGL.
- `tools/render-bench.html`: original and revised renderers use the same deterministic synthetic fixture and camera. Reports frame intervals and CPU submission separately. The smoke-test timing is **not performance evidence**; a valid performance run additionally requires a quiet machine and retained benchmark JSON.

The specimen screenshots deliberately enlarge nine synthetic organisms to expose visual differences. They are not evolved-world snapshots. The full-capacity screenshots are also labelled synthetic. CPU submission time is not GPU execution time, and this renderer harness excludes simulation and worker transport.
