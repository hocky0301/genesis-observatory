import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CONFIG } from '../src/config.js';
import { World } from '../src/world.js';
import { Stats } from '../src/stats.js';
const args=process.argv.slice(2), arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const ticks=arg('--ticks','1200,2400,9000').split(',').map(Number).sort((a,b)=>a-b);
CONFIG.seed=arg('--seed','42');
const out=arg('--out','checkpoints');
await mkdir(out,{recursive:true}); await mkdir('evidence',{recursive:true});
const w=new World(), stats=new Stats(CONFIG.historyPoints), manifest={schemaVersion:2,default:'',checkpoints:[]};
stats.sample(w);
const series=[stats.last], sourceHash=createHash('sha256');
for (const path of ['world','creature','neat','config','genome','rng']) {
  const {readFile}=await import('node:fs/promises'); sourceHash.update(await readFile(new URL(`../src/${path}.js`,import.meta.url)));
}
const revision=sourceHash.digest('hex');
let check=null, checkAt=0;
for (let t=1;t<=ticks.at(-1)+100;t++) {
  w.step(1);
  if(check) check.step(1);
  if (t%CONFIG.statsEvery===0) {stats.sample(w);series.push(stats.last);}
  if(check && t===checkAt){
    if(JSON.stringify(w.toState())!==JSON.stringify(check.toState())) throw new Error(`Checkpoint continuation mismatch at ${t}`);
    manifest.checkpoints.at(-1).verification={ticks:100,status:'exact',runtime:process.version};
    await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
    console.log(`verified checkpoint at ${t-100} +100 ticks exactly`);check=null;
  }
  if(ticks.includes(t)){
    const state=w.toState(), payload={schemaVersion:2,provenance:{sourceSha256:revision,node:process.version,observeEvery:CONFIG.statsEvery,config:structuredClone(CONFIG)},state,history:stats.toJSON()};
    const data=gzipSync(JSON.stringify(payload),{level:9}), hash=createHash('sha256').update(data).digest('hex');
    const id=`s${w.seed}-t${t}`, file=`${id}-${hash.slice(0,12)}.json.gz`;
    await writeFile(`${out}/${file}`,data);
    const titles=['A world takes shape','Lineages diverge','An evolved ecosystem'];
    const m=w.metrics();
    manifest.checkpoints.push({id,title:titles[Math.min(manifest.checkpoints.length,2)],description:`Seed ${w.seed} at tick ${t}. Resume, observe, or branch an intervention.`,url:`/${out}/${file}`,tick:t,sha256:hash,bytes:data.length,metrics:m});
    if(!manifest.default || t===2400)manifest.default=id;
    await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
    await writeFile('evidence/checkpoint-metrics.json',JSON.stringify(manifest.checkpoints.map(c=>({id:c.id,metrics:c.metrics})),null,2)+'\n');
    console.log(`saved ${id} pop=${m.population} species=${m.species} bytes=${data.length}`);
    check=new World();check.fromState(JSON.parse(JSON.stringify(state)));checkAt=t+100;
  }
  if(t%500===0) console.log(`progress ${t}/${ticks.at(-1)+100} pop=${w.creatures.length}`);
}
await writeFile('evidence/evolution-series-42.json',JSON.stringify({config:CONFIG,sourceSha256:revision,series})+'\n');
console.log('CHECKPOINTS VERIFIED');
