import assert from 'node:assert/strict';
import { bufferSize, pack, view, CSTRIDE, HEADER_INTS } from '../src/render-snapshot.js';
import { CONFIG } from '../src/config.js';
import { organismColor, trophicKind, lineageVariation, PALETTE_GLSL } from '../src/palette.js';
import { Camera } from '../src/camera.js';
import { cladeDescendants, renderMuller } from '../src/muller.js';
import { renderFixture } from './render-fixture.js';
let checks=0; const test=(name,fn)=>{fn();checks++;console.log('OK '+name);};
const world=renderFixture(6,4,3), buffer=pack(world,new ArrayBuffer(bufferSize(6,4,3))), v=view(buffer,world.width,world.height);
test('13-float layout capacity and all offsets',()=>{
  assert.equal(CSTRIDE,13); assert.equal(bufferSize(8000,16000,5800),654432);
  assert.equal(v.creatureByteOffset,HEADER_INTS*4); assert.equal(v.foodByteOffset,32+6*13*4); assert.equal(v.carrionByteOffset,32+(6*13+4*3)*4);
});
test('round trip includes age, scavenging, current living species',()=>{
  assert.equal(v.livingSpecies,6); assert.equal(v.creatureCount,6);
  for(let i=0;i<6;i++){ const a=world.creatures[i],b=v.creatureAt(i); assert.equal(b.id,a.id); assert.equal(b.body.scavenge,Math.fround(a.body.scavenge)); assert.equal(b.ageFrac,Math.fround(a.age/(CONFIG.maxAge*a.body.lifeJitter))); assert.equal(b.energyFrac,Math.fround(a.energy/CONFIG.maxEnergy)); }
  assert.equal(v.ftoxic(1),world.cueA[1]); assert.equal(v.kx(2),world.carrionX[2]);
});
test('legacy array and map access preserve values; direct lookup handles absent ids',()=>{
  assert.deepEqual(v.creatures[3],v.creatureAt(3)); assert.deepEqual(v.byId.get(4),v.findCreature(4)); assert.equal(v.findCreature(1000),undefined); assert.equal(v.creatureAt(-1),undefined);
});
test('transient creature overflow cannot overwrite food/carrion regions',()=>{
  const small=view(pack(world,new ArrayBuffer(bufferSize(3,4,3))),world.width,world.height);
  assert.equal(small.nc,3); assert.equal(small.nf,4); assert.equal(small.nk,3); assert.equal(small.fx(0),world.foodX[0]); assert.equal(small.ky(2),world.carrionY[2]);
});
test('invalid header is rejected before renderer reads beyond bytes',()=>{
  assert.throws(()=>view(new ArrayBuffer(8),1,1),RangeError); const corrupt=buffer.slice(0);new Int32Array(corrupt)[1]=1e6; assert.throws(()=>view(corrupt,1,1),RangeError);
});
test('strict category thresholds and carnivore priority match configurable behaviour',()=>{
  assert.equal(trophicKind(CONFIG.carnivoreThreshold,CONFIG.scavengerLabel),'herbivore');
  assert.equal(trophicKind(CONFIG.carnivoreThreshold,CONFIG.scavengerLabel+0.01),'scavenger');
  assert.equal(trophicKind(CONFIG.carnivoreThreshold+0.01,CONFIG.scavengerLabel+0.01),'carnivore');
  assert.equal(trophicKind(0.8,1.2,{carnivoreThreshold:0.9,scavengerLabel:1.3}),'herbivore');
  assert.equal(organismColor(0.8,1.2,1,1,0,true,{carnivoreThreshold:0.9,scavengerLabel:1.3}).kind,'herbivore');
  assert.match(PALETTE_GLSL,/diet > uCarnThreshold/); assert.match(PALETTE_GLSL,/scav > uScavLabel/);
});
test('palette bounds, energy brightness and age fading',()=>{
  for(let sid=0;sid<100;sid++) { assert(lineageVariation(sid)>=-1&&lineageVariation(sid)<=1); const color=organismColor(0.2,0.4,sid,0.5,0); assert(color.hue>=140&&color.hue<=196); }
  const young=organismColor(0.8,1.2,3,0.4,0),old=organismColor(0.8,1.2,3,0.4,1),bright=organismColor(0.8,1.2,3,1,0); assert(old.alpha<young.alpha);assert(bright.lightness>young.lightness);
});
test('camera picks packed ids without requesting legacy object allocation',()=>{
  const camera=new Camera(100,100);camera.setViewport(100,100);camera.cx=50;camera.cy=50;camera.zoom=1;
  const fake={nc:1,f:new Float32Array([7,50,50,...new Array(10).fill(0)]),get creatures(){throw new Error('eager allocation');}};
  assert.equal(camera.pick(50,50,fake),7);assert.equal(camera.pick(100,100,fake),null);
});
test('descendant traversal includes nested children and survives malformed cycles',()=>{
  const meta=new Map([[1,{parent:3}],[2,{parent:1}],[3,{parent:2}],[4,{parent:null}]]);assert.deepEqual([...cladeDescendants(1,meta)].sort(),[1,2,3]);
});
test('Muller hit test follows actual nonuniform tick spacing',()=>{
  const ctx=new Proxy({},{get:()=>()=>{},set:()=>true});const canvas={clientWidth:100,clientHeight:100,width:0,height:0,getContext:()=>ctx};
  const geometry=renderMuller(canvas,[0,10,100],new Map([[1,[5,5,5]],[2,[5,5,5]]]),new Map([[1,{parent:null}],[2,{parent:1}]]),{normalise:true});
  assert.equal(geometry.length,2);assert.equal(canvas._mullerPick(50,65),1);assert.equal(canvas._mullerPick(50,20),2);assert.equal(canvas._mullerPick(-1,20),null);
});
test('Muller highlight never strokes zero-abundance pre-birth history',()=>{
  let path=[],strokes=[];
  const ctx=new Proxy({beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},stroke(){strokes.push(path.slice());}},{get:(target,key)=>target[key]||(()=>{}),set:()=>true});
  const canvas={clientWidth:300,clientHeight:100,width:0,height:0,getContext:()=>ctx};
  const meta=new Map([[1,{parent:null}],[2,{parent:1}]]);
  renderMuller(canvas,[0,10,20,30],new Map([[1,[5,5,5,5]],[2,[0,0,2,2]]]),meta,{highlightSpecies:new Set([2])});
  assert.equal(strokes.length,1);assert.equal(Math.min(...strokes[0].map(p=>p[0])),100);
  strokes=[];
  renderMuller(canvas,[0,10,20,30],new Map([[1,[5,5,5,5]],[2,[0,0,0,0]]]),meta,{highlightSpecies:new Set([2])});
  assert.equal(strokes.length,0);
});
console.log(`${checks} render contracts passed`);
