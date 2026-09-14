// Matched branches: all arms start from the same exact checkpoint and RNG state.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {CONFIG} from '../src/config.js';
import {World} from '../src/world.js';
const manifest=JSON.parse(await readFile('checkpoints/manifest.json','utf8'));
const cp=manifest.checkpoints[0], bytes=await readFile(`.${cp.url}`);
if(createHash('sha256').update(bytes).digest('hex')!==cp.sha256) throw new Error('Checkpoint checksum mismatch');
const payload=JSON.parse(gunzipSync(bytes));
const executed=createHash('sha256');
for(const name of ['world','creature','neat','config','genome','rng'])executed.update(await readFile(new URL(`../src/${name}.js`,import.meta.url)));
const executedSourceSha256=executed.digest('hex');
if(executedSourceSha256!==payload.provenance.sourceSha256)throw new Error('Checkpoint engine source differs from executing source; generate fresh checkpoints');
const horizon=1800, base=payload.provenance.config;
const interventions={baseline:{},food_half:{foodRate:base.foodRate/2},metabolism_double:{baseMetabolism:base.baseMetabolism*2,moveMetabolism:base.moveMetabolism*2},toxin_zero:{toxinEnergy:0}};
const result={schemaVersion:1,checkpoint:cp.id,checkpointSha256:cp.sha256,seed:payload.state.seed,ticks:horizon,startTick:payload.state.tick,targetTick:payload.state.tick+horizon,sourceSha256:payload.provenance.sourceSha256,executedSourceSha256,config:base,runtime:process.version,baseline:null,arms:[]};
for(const [id, intervention] of Object.entries(interventions)){
  Object.assign(CONFIG,structuredClone(base));const w=new World();w.fromState(payload.state);Object.assign(CONFIG,intervention);
  const series=[w.metrics()];
  for(let t=1;t<=horizon;t++) {w.step(1);if(t%120===0)series.push(w.metrics());if(t%600===0)console.log(`${id} ${t}/${horizon} pop=${w.creatures.length}`);}
  const arm={id,intervention,startTick:result.startTick,targetTick:w.tick,metrics:w.metrics(),series,stateSha256:createHash('sha256').update(JSON.stringify(w.toState())).digest('hex')};
  if(id==='baseline')result.baseline=arm;else {arm.populationDelta=arm.metrics.population-result.baseline.metrics.population;result.arms.push(arm);}
  await writeFile('evidence/lab-results.json',JSON.stringify(result,null,2)+'\n');
  console.log(`completed ${id}: pop=${arm.metrics.population}`);
}
console.log('LAB COMPLETE — one seed, exact matched start, not a general ecological law');
