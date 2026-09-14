// Node CPU benchmark. Rendering cadence is measured separately in render-bench.html.
import {loadavg,cpus,platform,arch} from 'node:os';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {CONFIG} from '../src/config.js';
import {World} from '../src/world.js';
import {pack,bufferSize,CSTRIDE} from '../src/render-snapshot.js';
const before={uptime:execFileSync('uptime',{encoding:'utf8'}).trim(),load:loadavg(),cpus:cpus().length,model:cpus()[0].model,node:process.version,platform:platform(),arch:arch()};
console.log(before.uptime);
if(before.load[0]>3){
  await writeFile('evidence/node-benchmark.json',JSON.stringify({status:'deferred',reason:'1-minute load average exceeds the predeclared limit of 3',before},null,2)+'\n');
  console.error('Benchmark deferred: no timing measurements collected.');process.exit(2);
}
Object.assign(CONFIG,{seed:'bench-8000',startPopulation:8000,maxPopulation:8000,startFood:16000,maxFood:16000});
const w=new World(), bytes=bufferSize(CONFIG.maxPopulation,CONFIG.maxFood,CONFIG.maxCarrion), buf=new ArrayBuffer(bytes);
for(let i=0;i<10;i++)w.step(1);
const steps=[],packs=[];
for(let i=0;i<100;i++){
  let t=performance.now();w.step(1);steps.push(performance.now()-t);
  t=performance.now();pack(w,buf);packs.push(performance.now()-t);
}
const quantile=(arr,q)=>arr.toSorted((a,b)=>a-b)[Math.floor((arr.length-1)*q)];
const after=loadavg(), valid=after[0]<=3;
const report={status:valid?'measured':'contended',before,after,config:CONFIG,world:{tick:w.tick,population:w.creatures.length,food:w.foodCount},snapshot:{CSTRIDE,bytes},stepMs:{p50:quantile(steps,.5),p95:quantile(steps,.95)},packMs:{p50:quantile(packs,.5),p95:quantile(packs,.95)},raw:{steps,packs},scope:'Node CPU step and pack; no browser FPS or GPU execution claim'};
await writeFile('evidence/node-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=valid?0:2;
