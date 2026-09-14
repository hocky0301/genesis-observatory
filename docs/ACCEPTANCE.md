# What I verified before shipping

I checked my own implementation against the evidence I collected, aiming for a finished work that runs locally without dependencies and an independent check of the observer-effect disagreement. The withdrawn time budget isn't something I'm holding myself to.

## Verified implementation and evidence

| Requirement | Observed implementation and verification |
|---|---|
| Independent observer investigation | Original-source artifacts and hashes are preserved. The short default-world run preserves recorded physical state while bookkeeping changes; the stressed fixture can also change physical state when fitness sharing is enabled. The exact 211/231 pair from my original README is not independently reproduced. All final cited observer records use fingerprint version 2; the completed gates are recorded below. |
| Metrics reads without repairing the world | `metrics-test.mjs` compares repeated metrics and the complete serialized world, independent Stats readers, migration/extinction bookkeeping, and history persistence. `core-edge-test.mjs` also exercises newborn counting, repeated NEAT splits, exact saves, pending deaths, and continuation with protection/sharing modes. |
| A usable observatory | `evidence/browser-tests.json` records 24/24 passing Chromium acceptance checks, with no uncaught exceptions. They cover actual WebGL and Canvas pixels, shared/transfer transport, threshold propagation, checkpoint/hash errors, scratch mode, selection, tour controls, isolated branches, export/replay, cancellation, reset, and independent islands. |
| Layout and evolved startup | `evidence/browser-layout.json` records 2 passing checks: verified curated startup and a 390-pixel layout without horizontal overflow. I inspected the desktop and narrow-layout screenshots; Lab controls remain reachable by scrolling. This is Chrome viewport testing, not iPhone/Safari validation. |
| Exact checkpoint continuation | The v4 format stores effective configuration, IDs, genomes, dynamic state, RNGs, resource arrays and free-list order. The existing curated checkpoint manifest records exact continuation checks. Browser replay and a browser-export-to-Node replay also match for the measured small fixture. Legacy files remain approximate. |
| Visible lineage history | The ribbon retains its origin and current sampled endpoint, uses true timestamp spacing after decimation, and highlights a selected clade’s descendants. Tests exercise nonuniform time spacing, nested/cyclic ancestry, clicked bands, and restored history. Narrow real lineages are not enlarged for presentation. |
| Trophic colors and consistent renderers | Snapshot data carries scavenging, age fraction and living-species count. Actual shader/Canvas checks compare default and changed thresholds and age alpha. Renderer configurations belong to their individual workers; the inspector reads the active worker’s configuration. |
| Prediction before intervention | The form requires a whole-number estimate, locks it before either branch runs, pauses its source world, and restores the same exact checkpoint into separate worker realms. Branches run sequentially, stop at the exact horizon, distinguish prediction error from intervention effect, and expose cancellation and source return. |
| Reproducible experiment export | Export includes the locked plan, exact checkpoint, configuration, command trace, SHA-256 and outcomes. `replay-lab.mjs` validates the schema/hash/derived plan/trace, reruns both branches, and compares all recorded metric and result fields. The small browser export passes exact replay; corruption is rejected. |
| Dependency-free local application | Native browser modules, no build/install requirement, local assets, package marked private, and a loopback server. The app does not require Chrome automation or FFmpeg; those are production/verification tools. As of this check, I had not published, uploaded, or announced the repository. |
| Four-surface limitations | The four exact limitation sentences occur in README, the application, the Japanese article draft and the film caption source. The completed film passes its separate production-media checks, including all four captions. |
| Deterministic recording foundations | The worker has explicit recording mode and step acknowledgements; the film renderer advances integer ticks from frame indices. The available same-runtime smoke evidence compares every PNG in two short captures. Synthesized audio and beat detection also have repeated-output smoke checks. The completed production film is verified separately below. |

## Matched intervention evidence

The recorded Node experiment starts at tick 1200 from `s42-t1200` and ends at tick 3000, a horizon of 1800 ticks. All arms restore the same checkpoint and effective configuration. These are this implementation’s results, not the numbers quoted in my earlier notes.

| Branch | Measured population |
|---|---:|
| baseline | 4404 |
| food_half | 2340 |
| metabolism_double | 2987 |
| toxin_zero | 7563 |

The full-horizon real Chromium form run in `evidence/browser-lab-full.json` **passed**. It started from paused tick 1200, locked prediction 2500, and ran food arrival reduction for 1800 ticks. Both branches ended at tick 3000; the source stayed at tick 1200. The control contained 4404 organisms and the intervention 2340; the prediction was high by 160. All 22 raw metric fields in each branch matched the independently recorded Node results in this observed case. This does not establish cross-runtime equality in general.

I inspected both completed outcome screenshots, [`browser-lab-full-control.png`](../evidence/browser-lab-full-control.png) and [`browser-lab-full-intervention.png`](../evidence/browser-lab-full-intervention.png): source history is explicitly labeled, control and intervention population traces are visible, and prediction error is distinct from intervention effect. Returning to the source preserves its paused tick. The private test browser closed after completion. The smaller browser suite separately covers cancellation, export/replay and the other intervention transforms. Full-horizon browser execution of the metabolism and toxin forms is not claimed.

## Completed final evidence gates

- **Observer fingerprint consistency — passed:** all final before/after records carry `fingerprintVersion: 2`. The three after-mode records report OK, equal recorded physical/bookkeeping hashes and passing invariants. The original-source records still expose the failure; version-1 evidence remains archived separately. I regenerated MEASUREMENTS from the version-2 records.
- **All curated checkpoints — passed:** s42-t1200, s42-t2400 and s42-t9000 exist as v4 gzip checkpoints. For this package audit, I independently recomputed their compressed SHA-256 values, checked byte sizes and decoded ticks, and confirmed each manifest entry records exact uninterrupted-versus-restored continuation for 100 ticks. The default is s42-t2400.
- **Scientific caption source — corrected:** the measurement caption now states that the short one-species run preserved physical state while bookkeeping still changed. I verify that corrected text in the final encoded chapter under media acceptance, below.
- **Existing package links — passed:** the static audit in `evidence/package-audit.json` found no missing current Markdown links, application assets or native module imports. Archived documents are historical evidence, not current instructions. The four limitation sentences occur in all four current source surfaces; package privacy and loopback binding are present.

## Production acceptance

- **Long film — passed:** `evidence/film-verification.json` passes all 13 checks. The completed H.264/AAC movie is 270 seconds at 1280 × 720 with stereo 48 kHz sound. Its 4,050 unique actual WebGL frames at 15 fps are repeated to encode 8,100 frames at 30 fps. I inspected all six chapters and the ending in decoded frames. The separate six-second GIF is 4,482,203 bytes, below 5 MB.
- **Encoded wording — passed:** every requested frame has its expected tick and caption in the retained manifest. The corrected measurement chapter and all four limitation captions are present. Each chapter lasts 45 seconds and starts from its disclosed checkpoint; the film does not imply uninterrupted simulation time across editorial cuts. Both capture batches retain their source hashes.
- **Original sound — passed:** the score uses deterministic additive synthesis. Encoded audio has measured mean −16.2 dB and peak −3.4 dB, with opening and ending fades. The audio and 30-frame rendering smoke tests have repeated-output equality records; these do not imply cross-device identity.
- **Performance — measured, with an explicit qualification:** the Node CPU run satisfies its original load gate. The three matched AC renderer cases each measured about 60 FPS over approximately 60 seconds, including current WebGL with clade highlighting and an every-frame synthetic lineage ribbon. Their pre/post background-idle gates each failed at least once, so all raw cases remain rejected for quiet-machine acceptance; no controlled speedup is claimed. Battery-era empty-rAF probes measured about 30 Hz; fresh AC probes returned about 60 Hz headless and 120 Hz headed. These conditions and the separate broader matrix are retained in the evidence and generated report.
- **Generated reporting:** observer, checkpoint, Lab and whole-genome assay tables are generated from their JSON evidence. The changed assay cannot support a like-for-like causal comparison with the old headline. Movie, GIF, SRT and provenance links resolve to completed artifacts.
- **Final source consistency:** source/config/runtime provenance is retained in the checkpoints, capture manifest and tests. All required regression suites passed after the relevant engine changes. The final syntax scan covers 61 modules with no failures. The incoming-source manifest describes incoming files; `MANIFEST.sha256` inventories the files in this build separately.

## Boundaries that must remain explicit

- This edition exposes independent parallel worlds, not interactive deme migration. Backend migration tests pass; the old unconnected deme UI proposal has not become a shipped feature.
- Real browser checks cover the current Chromium environment. They do not establish cross-engine replay, all mobile devices, Safari, screen-reader completeness, native file-picker interactions, or every legacy-save import path.
- No general ecological law, brain-only causal improvement, lifetime learning, neutral add-node transformation, calibrated XOR/chance baseline, or increasing intelligence follows from these assays.
- No trail/glow feedback buffers were added. The chosen silhouettes, palette and clade interaction communicate the simulated state directly. A live autonomous cinematic director and event-driven sonification are not claimed; the film’s camera and score are editorial production features.
- Public hosting, GitHub visibility changes, YouTube upload and external messages were not something I checked here. Keeping local release drafts does not make those actions complete.

## Default checkpoint decision

The manifest now uses **s42-t2400** as the observatory’s default and retains verified s42-t1200 and s42-t9000 as selectable comparisons. The existing evidence supports a more legible introduction at tick 2400: it has several living lineages and substantial representation of all three genetic diet labels. This is a presentation recommendation, not a claim of measured startup or simulation speed.

| Candidate | Population | Living lineages | Herbivore / carnivore / scavenger labels |
|---|---:|---:|---|
| s42-t1200 | 2846 | 2 | 2720 / 75 / 51 |
| s42-t2400 | 3858 | 8 | 2872 / 867 / 119 |

The generated local measurement table identifies its own earlier start checkpoint. Changing the default observatory checkpoint does not silently change those recorded experiment conditions.

## Integration corrections I made in this review

- I archived the obsolete notes for continuing and replaced them with the current English version; the archived one’s old failure reports, rounded-save description and speed claims must remain historical.
- I aligned browser acceptance and capture tool defaults with the documented loopback server port.
- I identified the ambiguous physical-fingerprint description and the overly broad “complete physical hash” wording, and I describe the recorded fields and reserve complete serialized-world equality for the tests that actually compare that serialization.
- I kept draft/production/completed status distinct during film generation and identified the measurement-chapter caption contradiction above.
- I closed the earlier auxiliary server; the final loopback server is managed separately.
