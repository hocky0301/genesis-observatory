// Descriptive whole-genome assay; brain and body are inherited together.
// Control genomes use a dedicated RNG stream, independent of survivor shuffling.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {CONFIG} from '../src/config.js';
import {World} from '../src/world.js';
import {Creature} from '../src/creature.js';
import {randomGenome} from '../src/genome.js';
import {cloneBrain,InnovationRegistry} from '../src/neat.js';
import {makeRNG} from '../src/rng.js';
const manifest=JSON.parse(await readFile('checkpoints/manifest.json','utf8'));
const base=structuredClone(CONFIG), controlRNG=makeRNG('genesis-assay-control-v1'), reg=new InnovationRegistry(CONFIG.nIn,CONFIG.nOut);
const controls=Array.from({length:30},()=>randomGenome(controlRNG,CONFIG.nIn,CONFIG.nOut,reg));
const clone=g=>({body:g.body.slice(),brain:cloneBrain(g.brain)});
function trial(genome,seed){
  Object.assign(CONFIG,structuredClone(base),{seed,width:700,height:700,startPopulation:1,maxPopulation:1,startFood:240,maxFood:700,maxCarrion:0,foodRate:9,maxAge:1e9,reproduceThreshold:1e12,startEnergy:200});
  const w=new World(), c=new Creature(1,350,350,0,clone(genome),1,w.topo,1);w.creatures=[c];
  for(let t=0;t<500;t++)w.step(1);
  return {harvest:c.eaten/CONFIG.foodEnergy,survived:c.alive,toxic:w._toxicEaten,total:w._toxicEaten+w._goodEaten};
}
function score(genomes){
  const trials=genomes.flatMap(g=>[101,202].map(s=>trial(g,s)));
  return {genomes:genomes.length,trials:trials.length,meanHarvest:trials.reduce((s,r)=>s+r.harvest,0)/trials.length,survivalFraction:trials.filter(r=>r.survived).length/trials.length};
}
const control=score(controls), results=[];
for(const cp of manifest.checkpoints){
  const bytes=await readFile(`.${cp.url}`);
  if(createHash('sha256').update(bytes).digest('hex')!==cp.sha256)throw new Error('Checkpoint checksum mismatch');
  const payload=JSON.parse(gunzipSync(bytes));
  Object.assign(CONFIG,structuredClone(payload.provenance.config));const w=new World();w.fromState(payload.state);
  const rng=makeRNG('genesis-assay-survivors-v1'), pool=w.creatures.slice();
  for(let i=pool.length-1;i>0;i--){const j=rng.int(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  const evolved=score(pool.slice(0,30).map(c=>c.genome));
  results.push({checkpoint:cp.id,checkpointSha256:cp.sha256,evolved,control,ratio:control.meanHarvest?evolved.meanHarvest/control.meanHarvest:null});
  console.log(`${cp.id}: evolved=${evolved.meanHarvest} control=${control.meanHarvest} ratio=${results.at(-1).ratio}`);
}
Object.assign(CONFIG,base);
await writeFile('evidence/whole-genome-assay.json',JSON.stringify({assayVersion:1,units:'positive credited intake / nectar pellet energy (mixed nectar and toxin are netted before credit)',scope:'brain and body jointly; no brain-only causal claim; different assay from historical headless.mjs',trialTicks:500,arenaSeeds:[101,202],sampleSize:30,config:{...base,width:700,height:700,startPopulation:1,maxPopulation:1,startFood:240,maxFood:700,maxCarrion:0,foodRate:9,maxAge:1e9,reproduceThreshold:1e12,startEnergy:200},results},null,2)+'\n');
