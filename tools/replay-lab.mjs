// Reproduce an exported Ecology Lab experiment without executing supplied code.
// Usage: node tools/replay-lab.mjs path/to/genesis-lab-....json
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { World } from '../src/world.js';
import { makePlan, compareOutcome } from '../src/lab.js';

export function validateExperiment(experiment) {
  assert.equal(experiment.schemaVersion, 1, 'Unsupported experiment schema');
  assert.match(experiment.checkpointSHA256 || '', /^[a-f0-9]{64}$/, 'Checkpoint SHA-256 required');
  const hash = createHash('sha256').update(JSON.stringify(experiment.checkpoint)).digest('hex');
  assert.equal(hash, experiment.checkpointSHA256, 'Checkpoint checksum mismatch');
  assert.equal(experiment.checkpoint.state.v, 4, 'Replay requires an exact v4 checkpoint');
  const p = experiment.plan;
  const expected = makePlan(experiment.checkpoint, p.intervention, p.prediction, p.ticks);
  assert.deepEqual(p, expected, 'Plan differs from its checkpoint and intervention');
  const commands = [];
  for (const branch of ['control','intervention']) {
    commands.push({ branch, command:'load-checkpoint', tick:p.startTick });
    if (branch === 'intervention') for (const [key,value] of Object.entries(p.patch)) commands.push({branch,command:'config',tick:p.startTick,key,value});
    commands.push({branch,command:'step',n:p.ticks,stats:false,targetTick:p.targetTick});
  }
  assert.deepEqual(experiment.commands, commands, 'Command trace does not match the locked plan');
  for (const name of ['control','intervention']) assert.ok(experiment.branches?.[name]?.metrics, `Missing ${name} metrics`);
  assert.ok(experiment.result, 'Missing experiment result');
  return expected;
}
export function replayExperiment(experiment) {
  const plan = validateExperiment(experiment), branches = {};
  const previous = structuredClone(CONFIG);
  try {
    for (const name of ['control','intervention']) {
      Object.assign(CONFIG, structuredClone(plan.config));
      const world = new World(); world.fromState(experiment.checkpoint.state);
      if (name === 'intervention') Object.assign(CONFIG, plan.patch);
      for (let i=0;i<plan.ticks;i++) world.step(1);
      branches[name] = world.metrics();
    }
  } finally { Object.assign(CONFIG, previous); }
  const result = compareOutcome(plan, branches.control, branches.intervention);
  const differences = [];
  for (const name of ['control','intervention']) {
    const expected = experiment.branches[name].metrics;
    for (const key of new Set([...Object.keys(expected),...Object.keys(branches[name])])) if (!Object.is(expected[key], branches[name][key])) differences.push({branch:name,field:key,expected:expected[key],actual:branches[name][key]});
  }
  for (const key of new Set([...Object.keys(experiment.result),...Object.keys(result)])) if (!Object.is(experiment.result[key],result[key])) differences.push({branch:'result',field:key,expected:experiment.result[key],actual:result[key]});
  return { schemaVersion:1, status:differences.length?'DIFFERENT':'EXACT', runtime:process.version,
    checkpointSHA256:experiment.checkpointSHA256, startTick:plan.startTick,targetTick:plan.targetTick,
    branches,result,differences, limitation:'Replay equality is tested on the same runtime; cross-engine equality is not guaranteed.' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node tools/replay-lab.mjs path/to/genesis-lab-....json');
    const experiment = JSON.parse(await readFile(process.argv[2],'utf8'));
    const report = replayExperiment(experiment); console.log(JSON.stringify(report,null,2));
    if (report.status !== 'EXACT') process.exitCode = 1;
  } catch (err) { console.error('Replay failed: '+err.message); process.exitCode = 1; }
}
