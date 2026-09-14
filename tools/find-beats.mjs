// Deterministic, threshold-based observations. Beat absence is a valid result;
// the detector never fabricates a required count of events or a historical peak.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { World } from '../src/world.js';
const args=process.argv.slice(2),get=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
const cpPath=get('--checkpoint',null),ticks=Number(get('--ticks','1500')),seed=get('--seed','42'),out=get('--out','runs');
let cp;if(cpPath){const bytes=await readFile(cpPath);cp=JSON.parse((cpPath.endsWith('.gz')?gunzipSync(bytes):bytes).toString());Object.assign(CONFIG,cp.provenance.config);}else CONFIG.seed=seed;
const w=new World();if(cp)w.fromState(cp.state);const startTick=w.tick,series=[],beats=[],seen=new Set();let previous=null,peak=null;
function record(){const m=w.metrics();series.push(m);const emit=(kind,score=1)=>{if(seen.has(kind))return;seen.add(kind);beats.push({kind,tick:m.tick,score,population:m.population,livingSpecies:m.species});};
 if(m.carnivores>0)emit('first_observed_carnivore');if(m.scavengers>0)emit('first_observed_scavenger');if(m.avgHidden>0)emit('first_observed_hidden_node');if(m.species>1)emit('observed_speciation');if(m.population===0)emit('extinction',10);
 if(previous){if(m.population<previous.population*.85)emit('population_drop',5);if(m.food<previous.food*.5)emit('food_drop',3);if(m.diversity<previous.diversity*.85)emit('diversity_drop',3);}if(!peak||m.carnivores>peak.carnivores)peak=m;previous=m;
}
record();for(let i=0;i<ticks;i++){w.step(1);if(w.tick%CONFIG.statsEvery===0)record();}if(series.at(-1).tick!==w.tick)record();
beats.push({kind:'maximum_observed_carnivores',tick:peak.tick,count:peak.carnivores,score:2});
beats.sort((a,b)=>b.score-a.score||a.tick-b.tick||a.kind.localeCompare(b.kind));await mkdir(out,{recursive:true});
const seriesText=series.map(m=>JSON.stringify(m)).join('\n')+'\n';const result={schemaVersion:1,seed:w.seed,startTick,endTick:w.tick,config:structuredClone(CONFIG),sampleEvery:CONFIG.statsEvery,seriesSha256:createHash('sha256').update(seriesText).digest('hex'),caution:'Extrema refer only to sampled observations in this run; categories are genetic labels.',beats};
await writeFile(path.join(out,`series-${w.seed}.jsonl`),seriesText);await writeFile(path.join(out,`beats-${w.seed}.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({samples:series.length,beats:beats.length,startTick,endTick:w.tick}));
