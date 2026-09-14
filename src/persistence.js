// Save / load helpers. The World now lives in the worker, so these operate on
// plain serialized state objects (the worker produces/consumes them); the main
// thread only does the DOM-side file I/O and localStorage.

export function downloadState(state) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const world = state.state || state;
  a.download = `genesis-gen${world.generationMax ?? 0}-t${world.tick ?? 0}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readStateFile(file) {
  return file.text().then((txt) => JSON.parse(txt));
}

