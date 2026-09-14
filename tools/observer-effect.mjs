// Compare observation schedules without allowing the fingerprint to call metrics().
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const base = arg('--source', resolve(import.meta.dirname, '..'));
const { CONFIG } = await import(pathToFileURL(resolve(base, 'src/config.js')));
const { World } = await import(pathToFileURL(resolve(base, 'src/world.js')));
if (!args.includes('--full')) Object.assign(CONFIG, {
  startPopulation: 120, maxPopulation: Number(arg('--cap', 700)),
  width: 1200, height: 900, speciesThreshold: 0.35, mutationRate: 0.30,
});
Object.assign(CONFIG, {seed:arg('--seed', '1337'), protect:args.includes('--protect'), fitShare:args.includes('--fitshare')});
const ticks = Number(arg('--ticks', 1500));
const schedules = arg('--schedules', '8,0,400').split(',').map(Number);
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const config = structuredClone(CONFIG);
const results = [];
for (const every of schedules) {
  const w = new World();
  let firstCountMismatch = null, firstAliveMismatch = null, zombieJoins = 0;
  const originalAssign = w._assignSpecies;
  w._assignSpecies = function(...a) {
    const id = originalAssign.apply(this, a), sp = this.species.get(id);
    if (sp.count === 0 && sp.alive && sp.birthTick < this.tick) zombieJoins++;
    return id;
  };
  if (every) w.metrics();
  for (let i = 1; i <= ticks; i++) {
    w.step(1);
    if (every && i % every === 0) w.metrics();
    if (i % 97 === 0 || i === ticks) {
      const counts = new Map();
      for (const c of w.creatures) counts.set(c.speciesId, (counts.get(c.speciesId) || 0) + 1);
      for (const sp of w.species.values()) {
        if (sp.count !== (counts.get(sp.id) || 0)) firstCountMismatch ??= i;
        if (sp.alive !== (sp.count > 0)) firstAliveMismatch ??= i;
      }
    }
  }
  const physical = w.creatures.map(c => [c.id,c.x,c.y,c.heading,c.energy,c.age,c.generation,c.speed,c.phase,c.alive,c.predated,c.eaten,c.kills,Array.from(c.genome.body),c.genome.brain,Array.from(c.inputs),Array.from(c.out)]);
  const food = [w.foodX,w.foodY,w.foodAlive,w.foodLife,w.cueA,w.foodFree].map(x => Array.from(x));
  const carrion = [w.carrionX,w.carrionY,w.carrionAlive,w.carrionE,w.carrionLife,w.carrionFree].map(x => Array.from(x));
  const sum = fn => w.creatures.reduce((s,c)=>s+fn(c),0);
  const physicalFingerprint = {population:w.creatures.length, x:sum(c=>c.x), y:sum(c=>c.y), energy:sum(c=>c.energy), food:w.foodCount, carrion:w.carrionCount, hash:sha([physical,food,carrion,w.rng.state(),w.migRng.state(),w.blooms,w.foodAccum,w.innov.toJSON(),w._nextId,w.generationMax,w._goodEaten,w._toxicEaten])};
  const bookkeepingFingerprint = {nextSpeciesId:w.nextSpeciesId, sumSpeciesId:sum(c=>c.speciesId), aliveSpecies:[...w.species.values()].filter(s=>s.count>0).length, peak:[...w.species.values()].reduce((s,v)=>s+v.peak,0), hash:sha([w.nextSpeciesId,w.creatures.map(c=>[c.id,c.speciesId]),[...w.species.values()].map(s=>[s.id,s.parent,s.count,s.alive,s.peak,s.lastSeen,s.fitEMA,s._rho,s.fitSum,s.fitN,s.repGenome])])};
  const r = {every, physical:physicalFingerprint, bookkeeping:bookkeepingFingerprint, firstCountMismatch, firstAliveMismatch, zombieJoins};
  results.push(r);
  console.error(`completed every=${every} tick=${w.tick} pop=${w.creatures.length} speciesCreated=${w.nextSpeciesId}`);
}
const physicalEqual = results.every(r=>r.physical.hash===results[0].physical.hash);
const bookkeepingEqual = results.every(r=>r.bookkeeping.hash===results[0].bookkeeping.hash);
const invariants = results.every(r=>r.firstCountMismatch===null && r.firstAliveMismatch===null);
const pass = physicalEqual && bookkeepingEqual && invariants;
console.log(JSON.stringify({fingerprintVersion:2,source:base,config,ticks,results,physicalEqual,bookkeepingEqual,invariants,status:pass?'OK':'DIFFERENT'},null,2));
process.exitCode = pass ? 0 : 1;
