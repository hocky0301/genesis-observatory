# GENESIS film

The introduction uses the application's actual WebGL2 renderer, with an original instrumental score and English captions painted into the source frames. I generate it locally. I haven't uploaded or published it.

## Files and timing

- `genesis-film.mp4`: 270 seconds, 1280 × 720, H.264 video and stereo AAC audio.
- `genesis-film.srt`: editable English captions matching the burned-in captions.
- `genesis.gif`: a six-second excerpt from the film.
- `film-provenance.json`: runtime, source/encoded frame rates, checkpoint list and audio provenance.

There are **15 unique simulation frames per second** and **one integer simulation tick per source frame**. Encoding repeats each source frame twice to produce a 30 fps container. This is not a claim of 30 unique simulation states per second. Each of six 45-second chapters starts from its disclosed checkpoint and then advances normally. Cuts between checkpoints are editorial cuts, not uninterrupted simulation time. The HUD is read from the exact render snapshot being drawn.

Chapter sequence: a world already in motion; visual encoding; lineage history; observer independence; Ecology Lab; limits and possibility. The Ecology Lab panel reads the measured `evidence/lab-results.json`. It distinguishes those recorded control/intervention endpoints from the continuously running unmodified world behind it.

The lineage ribbon uses stored whole-history samples and their original tick coordinates. It does not claim to preserve every birth between samples. Its colors identify lineages; organism colors identify genetic diet labels.

## Reproduce

From the repository root, with Node and Chrome available:

```sh
node tools/shoot.mjs --shots shots/film.json --out out/film
node tools/cut.mjs --input out/film --output docs/genesis-film.mp4 --gif docs/genesis.gif
```

`ffmpeg` must be available for encoding. The app itself requires no packages, build step, encoder or browser automation dependency. `CHROME_PATH` can select a Chrome binary. Chrome runs in its own temporary profile; shutdown targets only that owned process. `--headed` is available, but this reproduction uses headless Chrome with verified hardware WebGL2. Capture fails if WebGL2 is unavailable; it never substitutes the Canvas renderer.

Every frame is requested sequentially, advances a fixed integer tick count, and is painted before its PNG is read. `film.html`, `src/film.js` and `src/recorder.js` use no wall-clock time or unseeded randomness. The host driver may wait for scheduling; those waits cannot change frame content. I captured the film in two chapter-aligned batches; the manifest retains each batch's source hashes. I keep the opening-source archive in `evidence/film-opening-source.js` because I corrected an unused later caption before the remaining chapters. Final captions and the SRT use the correction. The capture manifest records frame index, actual and expected tick, population, living species, generation, food, caption, camera, checkpoint, PNG SHA-256, source hashes and browser/GPU information.

I recorded two same-runtime smoke runs in `evidence/film-determinism.json`. I tested PNG equality in the same Chrome, operating system and GPU environment. This does not imply byte-identical rendering across GPUs, fonts, browsers or engines. I inspect the completed encode with `ffprobe`, representative frames and an audio-level check; see `evidence/film-verification.json`.

## Sound

`tools/score.mjs` synthesizes the original score mathematically: slow additive pads, bass notes, soft bells and quiet stereo delays. It uses the project's seeded RNG for composition choices. I don't use any recordings, borrowed samples, generated-media services or external assets. The score is editorial music, not a sonification of measured organisms. It has a gradual opening and closing fade. I save a repeated WAV synthesis check in `evidence/audio-determinism.json`.

## Shared limitations

A designed artificial ecosystem, not a model of a real habitat.

Diet colors are genetic labels, not measured energy flows.

A single-seed intervention is not a general ecological law.

I test replay equality on the same runtime; cross-engine equality is not guaranteed.
