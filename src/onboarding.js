// A guided reading of the live world. Tick-driven: pause or take control at any time.
const OBSERVATIONS = [
  ['A world already in motion.', 'Each organism senses nearby food, poison, carrion, and other creatures. Its neural network steers it. Energy, inherited traits, and reproduction shape the population.'],
  ['Read the three colors.', 'Teal marks herbivores, crimson marks carnivores, and ochre marks scavengers. These are genetic labels, not measured energy flows.'],
  ['Follow a life.', 'Click a creature to inspect its inherited body and neural network. Drag to travel; scroll to look closer. Press F to see the whole world.'],
  ['History leaves a trace.', 'The ribbon below follows lineage abundance from the beginning. Select a band to illuminate that lineage and its descendants in the world.'],
  ['Predict before you intervene.', 'Ecology Lab freezes this moment and forks two matching worlds. Enter a population estimate, then change food, metabolism, or toxin loss.'],
  ['Let the result disagree.', 'Compare your estimate with the intervention and its untouched control. A single-seed intervention is not a general ecological law.'],
];
export function initOnboarding({ sim, enabled = true }) {
  let index = 0, anchor = null, paused = false, visible = enabled;
  const $ = (id) => document.getElementById(id);
  function paint() {
    $('tour').hidden = !visible;
    $('tourCount').textContent = `GUIDED OBSERVATION ${String(index + 1).padStart(2, '0')} / ${String(OBSERVATIONS.length).padStart(2, '0')}`;
    $('tourTitle').textContent = OBSERVATIONS[index][0]; $('tourBody').textContent = OBSERVATIONS[index][1];
    $('tourPause').textContent = paused ? 'Resume' : 'Pause';
  }
  function move(delta) { index = (index + delta + OBSERVATIONS.length) % OBSERVATIONS.length; anchor = sim.view?.tick ?? null; paint(); }
  $('tourPrevious').onclick = () => move(-1); $('tourNext').onclick = () => move(1);
  $('tourPause').onclick = () => { paused = !paused; anchor = sim.view?.tick ?? null; paint(); };
  $('takeControl').onclick = () => { visible = false; paint(); };
  $('restartTour').onclick = () => { visible = true; index = 0; paused = false; anchor = sim.view?.tick ?? null; paint(); };
  paint();
  return { reset(tick) { index = 0; anchor = tick ?? sim.view?.tick ?? null; paint(); }, update() { const tick = sim.view?.tick; if (!visible || paused || tick == null) return; if (anchor == null || tick < anchor) anchor = tick; if (tick - anchor >= 480) move(1); }, hide() { visible = false; paint(); } };
}
