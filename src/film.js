import { CONFIG } from './config.js';
import { World } from './world.js';
import { GLRenderer } from './gl-renderer.js';
import { pack, view, bufferSize } from './render-snapshot.js';
import { loadCheckpoint, toroidalCenter, logZoom, ease, wrapLines, drawRibbon } from './recorder.js';

const LIMITATIONS=[
  'A designed artificial ecosystem, not a model of a real habitat.',
  'Diet colors are genetic labels, not measured energy flows.',
  'A single-seed intervention is not a general ecological law.',
  'Replay equality is tested on the same runtime; cross-engine equality is not guaranteed.',
];
const CHAPTERS=[
  ['A world already in motion','GENESIS'],
  ['Read a living language','FORM & ENERGY'],
  ['Every species leaves a trace','LINEAGE & TIME'],
  ['Observe without changing the outcome','MEASUREMENT'],
  ['Make a prediction. Change one pressure.','ECOLOGY LAB'],
  ['A model you can question','LIMITS & POSSIBILITY'],
];
const CAPTIONS=[
  'No creature is scripted to follow a path. Each one senses, moves, feeds, and reproduces.',
  'This is a living checkpoint: an evolved population, ready to continue from the moment it was saved.',
  'A designed artificial ecosystem, not a model of a real habitat.',
  'Teal, ochre, and crimson separate genetic diet labels. Species add small variations within each color family.',
  'Body shape and energy change what you see. Aging gradually fades an organism before it disappears.',
  'Diet colors are genetic labels, not measured energy flows.',
  'The ribbon preserves population history. A lineage can grow, branch, shrink, or vanish.',
  'Highlight a clade to follow related species across space and time. Rewind the story by loading a checkpoint.',
  'The colors in the history ribbon identify lineages; the colors of organisms identify diet labels.',
  'The original observer changed species bookkeeping. A short one-species run preserved physical state, while its bookkeeping still changed.',
  'Metrics now reads the world without consuming its events. The regression suite varies observation frequency.',
  'Checkpoints retain the state needed for continuation, including harvest history and the ordering of resource slots.',
  'Begin with one exact checkpoint. Keep a control unchanged. Apply one intervention to the other branch.',
  'Reduce food arrivals, increase metabolism, or remove toxin energy loss. Then compare both populations at the same tick.',
  'A single-seed intervention is not a general ecological law.',
  'These rules create a world worth watching. They do not make a claim about human intelligence or a real ecosystem.',
  'Replay equality is tested on the same runtime; cross-engine equality is not guaranteed.',
  'Observe. Predict. Intervene. Leave room for the outcome to surprise you.',
];
const canvas=document.getElementById('film'),ctx=canvas.getContext('2d',{alpha:false});
const glCanvas=document.getElementById('gl'),overlay=document.getElementById('overlay');
const gl=glCanvas.getContext('webgl2',{alpha:true,antialias:true,preserveDrawingBuffer:true});
if(!gl)throw new Error('Film capture requires real WebGL2; Canvas fallback is forbidden');
const renderer=new GLRenderer(glCanvas,overlay,gl);renderer.camera.dpr=1;renderer.resize();
let spec,world,buf,currentChapter=-1,frame=-1,history,focus,lab=null,chapterStartTick=0;
const checkpoints=new Map();
function appendHistory(){
  if(history.ticks.at(-1)===world.tick)return;
  const ids=new Map(history.speciesHistory);const previous=history.ticks.length;
  history.ticks.push(world.tick);
  for(const sp of world.species.values()){let a=ids.get(sp.id);if(!a){a=new Array(previous).fill(0);ids.set(sp.id,a);}a.push(sp.count);}
  for(const [id,a]of ids)if(a.length<history.ticks.length)a.push(0);
  history.speciesHistory=[...ids];
  // Film history retains its full time extent with uniform decimation only.
  if(history.ticks.length>1600){history.ticks=history.ticks.filter((_,i)=>i%2===0);history.speciesHistory=history.speciesHistory.map(([id,a])=>[id,a.filter((_,i)=>i%2===0)]);}
}
async function enter(chapter){
  currentChapter=chapter;const cpUrl=spec.checkpoints?.[chapter]||spec.checkpoint;
  let cp;
  if(cpUrl){if(!checkpoints.has(cpUrl))checkpoints.set(cpUrl,await loadCheckpoint(cpUrl));cp=checkpoints.get(cpUrl);Object.assign(CONFIG,structuredClone(cp.provenance.config));world=new World();world.fromState(structuredClone(cp.state));history={ticks:structuredClone(cp.history?.historyTicks||cp.history?.ticks||[]),speciesHistory:structuredClone(cp.history?.fullSpeciesHistory||cp.history?.speciesHistory||[])};}
  else{if(!spec.config)throw new Error('No checkpoint or explicit fixture config');Object.assign(CONFIG,spec.config);world=new World();for(let i=0;i<(spec.fromTick||0);i++)world.step(1);history={ticks:[],speciesHistory:[]};}
  history.ticks||=[];history.speciesHistory||=[];if(!Array.isArray(history.speciesHistory))history.speciesHistory=Object.entries(history.speciesHistory).map(([id,a])=>[Number(id),a]);
  renderer.setConfig(CONFIG);
  chapterStartTick=world.tick;
  appendHistory();buf=new ArrayBuffer(bufferSize(CONFIG.maxPopulation,world.maxFood,world.maxCarrion));renderer.setWorldSize(world.width,world.height);renderer.fit();
  const bins=new Map();for(const c of world.creatures){const id=Math.floor(c.x/200)+':'+Math.floor(c.y/200);let a=bins.get(id);if(!a){a=[];bins.set(id,a);}a.push(c);}
  const dense=[...bins.values()].sort((a,b)=>b.length-a.length)[0]||[];
  focus=toroidalCenter(dense,world.width,world.height);
}
function text(text,x,y,{font='18px system-ui',color='#d9e9e9',align='left'}={}){ctx.font=font;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(text,x,y);ctx.textAlign='left';}
function drawLab(local){
  if(!lab)return;
  const baseline=lab.baseline?.metrics||lab.baseline;const arms=lab.arms||[];
  if(!baseline?.population)return;
  const labels={'food_half':'FOOD ARRIVALS × 0.5','metabolism_double':'BASE + MOVEMENT METABOLISM × 2','toxin_zero':'TOXIN ENERGY LOSS → 0','food-half':'FOOD ARRIVALS × 0.5','metabolism-double':'BASE + MOVEMENT METABOLISM × 2','toxin-zero':'TOXIN ENERGY LOSS → 0','half-food':'FOOD ARRIVALS × 0.5','double-metabolism':'BASE + MOVEMENT METABOLISM × 2','zero-toxin':'TOXIN ENERGY LOSS → 0'};
  const rows=[{title:'UNCHANGED CONTROL',population:baseline.population},...arms.map(a=>({title:a.title||labels[a.id]||String(a.id),population:a.metrics.population}))];
  const max=Math.max(...rows.map(r=>r.population));const x=665,y=185,w=560;
  ctx.fillStyle='rgba(7,20,26,.94)';ctx.fillRect(x,y,w,260);
  text(`RECORDED RESULTS · TICK ${lab.startTick} → ${lab.targetTick}`,x+22,y+30,{font:'12px ui-monospace, Menlo, monospace',color:'#a5c4c5'});
  rows.forEach((r,i)=>{const yy=y+65+i*44;text(r.title.toUpperCase(),x+22,yy,{font:'11px ui-monospace, Menlo, monospace',color:'#a5c4c5'});ctx.fillStyle=i?'#e8b568':'#82aaa9';ctx.fillRect(x+22,yy+9,(w-120)*r.population/max*ease(local/120),7);text(r.population.toLocaleString('en-US'),x+w-22,yy+14,{font:'20px ui-monospace, Menlo, monospace',align:'right'});});
  text(`seed ${lab.seed} · ${lab.ticks} ticks · backdrop is the unmodified world`,x+22,y+244,{font:'11px ui-monospace, Menlo, monospace',color:'#8ca7ad'});
}
function paint(v,f){
  const fps=spec.sourceFps||15,duration=spec.duration||270,t=f/fps,chapter=Math.min(5,Math.floor(t/45));const local=t-chapter*45;
  const fit=Math.min(1280/world.width,720/world.height)*.9;
  const zoomTargets=[1.05,1.8,.7,1.1,.75,.8];const z0=chapter===0?fit:Math.max(fit,.7),z1=zoomTargets[chapter];
  const progress=ease(local/45),centerProgress=ease(local/18);
  renderer.camera.zoom=logZoom(z0,z1,progress);
  renderer.camera.cx=world.width/2+(focus[0]-world.width/2)*centerProgress;
  renderer.camera.cy=world.height/2+(focus[1]-world.height/2)*centerProgress;
  const halfW=640/renderer.camera.zoom,halfH=360/renderer.camera.zoom;
  if(halfW<world.width/2)renderer.camera.cx=Math.max(halfW,Math.min(world.width-halfW,renderer.camera.cx));
  if(halfH<world.height/2)renderer.camera.cy=Math.max(halfH,Math.min(world.height-halfH,renderer.camera.cy));
  const candidates=[...world.species.values()].filter(s=>s.count>0).sort((a,b)=>b.count-a.count);
  const clade=chapter===2?(candidates[1]||candidates[0])?.id:null;
  const cladeSet=clade?new Set([clade]):null;
  if(cladeSet){let changed=true;while(changed){changed=false;for(const sp of world.species.values())if(cladeSet.has(sp.parent)&&!cladeSet.has(sp.id)){cladeSet.add(sp.id);changed=true;}}}
  renderer.draw(v,null,cladeSet);
  const bg=ctx.createRadialGradient(650,330,30,650,330,800);bg.addColorStop(0,'#14262c');bg.addColorStop(1,'#071017');ctx.fillStyle=bg;ctx.fillRect(0,0,1280,720);ctx.drawImage(glCanvas,0,0);ctx.drawImage(overlay,0,0);
  const vignette=ctx.createLinearGradient(0,0,0,720);vignette.addColorStop(0,'rgba(4,12,18,.92)');vignette.addColorStop(.22,'rgba(4,12,18,.06)');vignette.addColorStop(.65,'rgba(4,12,18,.04)');vignette.addColorStop(.8,'rgba(4,12,18,.94)');vignette.addColorStop(1,'rgba(4,12,18,1)');ctx.fillStyle=vignette;ctx.fillRect(0,0,1280,720);
  text('GENESIS',40,47,{font:'600 25px system-ui',color:'#edf7f1'});text('AN ARTIFICIAL LIFE OBSERVATORY',190,44,{font:'11px ui-monospace, Menlo, monospace',color:'#86aaa9'});
  text(`${String(chapter+1).padStart(2,'0')} / 06   ${CHAPTERS[chapter][1]}`,40,76,{font:'12px ui-monospace, Menlo, monospace',color:'#86aaa9'});
  const conditions=`seed ${world.seed} · protect=${Number(CONFIG.protect)} · fitShare=${Number(CONFIG.fitShare)}`;
  text(conditions,1240,34,{font:'12px ui-monospace, Menlo, monospace',align:'right',color:'#a6bfc3'});
  text(`${fps} source frames/s · ${spec.ticksPerFrame||1} tick/frame · encoded 30 fps`,1240,54,{font:'11px ui-monospace, Menlo, monospace',align:'right',color:'#78989f'});
  const items=[['TICK',v.tick],['POPULATION',v.nc],['SPECIES',v.livingSpecies],['GENERATION',v.generationMax],['FOOD',v.nf]];
  items.forEach(([label,n],i)=>{const x=40+i*148;text(label,x,125,{font:'10px ui-monospace, Menlo, monospace',color:'#86a1a7'});text(n.toLocaleString('en-US'),x,155,{font:'24px ui-monospace, Menlo, monospace',color:'#e0edea'});});
  if(chapter===4)drawLab(f-chapter*45*fps);
  text(CHAPTERS[chapter][0],40,541,{font:'500 31px system-ui',color:'#e4f3eb'});
  const caption=CAPTIONS[Math.min(CAPTIONS.length-1,Math.floor(t/15))];ctx.font='20px system-ui';const lines=wrapLines(ctx,caption,1180);lines.forEach((line,i)=>text(line,40,577+i*28,{font:'20px system-ui',color:'#a9c4c7'}));
  drawRibbon(ctx,history,world,{focus:clade});
  ctx.fillStyle='#19343a';ctx.fillRect(0,714,1280,6);ctx.fillStyle='#6ab5a7';ctx.fillRect(0,714,1280*Math.min(1,(f+1)/(duration*fps)),6);
  text('SIMULATION CHAPTERS BEGIN FROM DISCLOSED CHECKPOINTS',1240,705,{font:'9px ui-monospace, Menlo, monospace',color:'#506e78',align:'right'});
  const firstFrame=Math.max(spec.startFrame||0,chapter*45*fps),expectedTick=chapterStartTick+(f-firstFrame+1)*(spec.ticksPerFrame||1);
  if(v.tick!==expectedTick)throw new Error(`Frame tick mismatch: ${v.tick} vs ${expectedTick}`);
  return {frame:f,chapter,sourceTime:t,tick:v.tick,expectedTick,chapterStartTick,population:v.nc,species:v.livingSpecies,generation:v.generationMax,food:v.nf,caption,checkpoint:spec.checkpoints?.[chapter]||spec.checkpoint||'explicit small fixture',conditions,sourceFps:fps,ticksPerFrame:spec.ticksPerFrame||1,renderer:'WebGL2',camera:{x:renderer.camera.cx,y:renderer.camera.cy,zoom:renderer.camera.zoom}};
}
window.__FILM={ready:true,limitations:LIMITATIONS,captions:CAPTIONS,
  async init(s){spec=s;frame=(s.startFrame||0)-1;currentChapter=-1;checkpoints.clear();if(spec.labResults){const r=await fetch(spec.labResults);if(!r.ok)throw new Error('Missing measured Lab result');lab=await r.json();}await enter(Math.min(5,Math.floor((s.startFrame||0)/(s.sourceFps||15)/45)));const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:'WebGL2',glRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),width:canvas.width,height:canvas.height};},
  async next(f){if(f!==frame+1)throw new Error('Film frames must be requested in strict sequential order');const ch=Math.min(5,Math.floor(f/(spec.sourceFps||15)/45));if(ch!==currentChapter)await enter(ch);for(let i=0;i<(spec.ticksPerFrame||1);i++)world.step(1);if(world.tick%8===0)appendHistory();const v=view(pack(world,buf),world.width,world.height),meta=paint(v,f);frame=f;return {meta,png:canvas.toDataURL('image/png').split(',')[1]};},
};
