# What I decided, and where my own earlier plan was wrong

I set out with two goals: a finished artificial-life work that runs locally without
a build step, and an independently reproduced check of the observer-effect disagreement
recorded in the original README. I treat my earlier planning notes as a set
of proposals I made to myself, not as established facts; I withdrew its time budget, and no scope
decision below depends on it. I deliberately left publishing the repository, uploading the film and
posting announcements to a separate step.

## Decisions

- I include Ecology Lab because its intervention is the simulation's actual
  mechanism. It locks a prediction and branches from an exact saved world, with
  a matched control and explicit tick horizon. It does not stage canned outcomes.
- I include exact checkpoints. My earlier plan simultaneously defers exact saving
  and requires exact resumed continuation; the original rounded format cannot
  satisfy both. Exact v4 preserves IDs, speed, phase, harvested energy, active/dead
  flags, network values, indexed resource arrays, free stacks, RNG state,
  innovation registry and effective CONFIG. Legacy imports remain approximate.
- I independently reproduced and fixed newborn queue double-counting and duplicate
  NEAT innovations. A reused split re-enables its existing historical edges
  while preserving their evolved weights. Add-node remains non-neutral.
- I include trophic color, visible organism shape, age fading, matched Canvas/WebGL
  output, whole-history ribbon and descendant highlighting. The ribbon
  preserves sampled history, not every event. Actual narrow lineages stay narrow.
- I retain protection, off by default, alongside optional fitness sharing.
  Removal is not needed to obtain observation-independent bookkeeping. My earlier plan's
  inference that retention preserves every historical headline does not follow:
  other correctness fixes also change the engine. I archived the old assay, and
  the new descriptive assay is explicit about its changed protocol.
- I did not add feedback-buffer glow or trails. Organism silhouettes and the
  lineage interaction communicate the subject without disguising actual density.
- My long introduction includes synthesized sound and English captions. Its
  imagery comes from the real WebGL renderer. Movie frame rate, simulation tick
  rate and encoded frame rate are distinct and recorded in its manifest.
- Checkpoints use content-addressed gzip filenames and SHA-256 verification. The
  manifest is revalidated; data files may be cached immutably. There is no
  Content-Encoding header on the gzip payload to avoid implicit double decoding.
- The server binds to loopback. I prepared hosting headers in advance and
  left publishing, making GitHub public, YouTube upload, and external posts
  to a separate step.

## What my earlier plan got wrong or did not establish

1. The short and long observer tests are not equivalent experiments. The reported
   211/231 is cumulative species creation, not living species. My fixture's raw
   values are in the generated measurement record; I don't claim that exact pair
   as independently reproduced.
2. The original headless “assert” only printed a mismatch and exited successfully.
   Its final observation also repaired the counts before the comparison. New tests
   independently check per-species counts without calling metrics to normalize them.
3. `protect` and `fitShare` were already off in the original code. The current
   incoming README already corrects the old default-on claim; repeating it as a
   newly discovered README error would itself be inaccurate.
4. Uncapped population experiments omit their actual maxPopulation. The reported
   percentage cannot be reconstructed uniquely from that description.
5. The original server already sends COOP/COEP/CORP. “No headers” is not a current
   local-source defect. Public deployment behavior was not established.
6. Headless Chrome is not categorically unable to render WebGL2. This machine's
   actual Chrome context is checked, and capture fails if the required renderer
   is absent; no silent Canvas substitution is accepted for the film.
7. Frame locking and exact state do not prove cross-browser pixel identity. The
   two-run hash test is scoped to the measured Chrome/runtime on this machine.
8. `avgAddedConns` is enabled connections minus the initial dense topology. It is
   net active-connection change, not a counter of structural mutation events.
9. The incoming old chance/XOR labels did not establish a calibrated toxin
   avoidance baseline. I corrected the historical harness labels, and the new
   assay makes no XOR or brain-only causal claim.

## Deliberate non-changes and remaining limitations

A designed artificial ecosystem, not a model of a real habitat.

Diet colors are genetic labels, not measured energy flows.

A single-seed intervention is not a general ecological law.

Replay equality is tested on the same runtime; cross-engine equality is not guaranteed.

No lifetime learning, physical nutrient-flow model, neutral add-node guarantee,
statistical multi-seed intervention conclusion, public hosting, account operation,
or real-device iPhone/Safari validation is implied. Browser responsive checks
cover only the measured Chrome environment. Baseline and final evidence are
kept separate, including negative or inconclusive results.
