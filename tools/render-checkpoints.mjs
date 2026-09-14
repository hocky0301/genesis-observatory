#!/usr/bin/env node
// Matched real-world checkpoint renders in isolated Chrome. Uses checkpoint
// metadata and source bytes, never hand-authored populations or fake organisms.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchChrome, waitFor } from './cdp.mjs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),port=Number(process.env.RENDER_PORT||5179);
const manifest=JSON.parse(await readFile(new URL('../checkpoints/manifest.json',import.meta.url),'utf8'));
const args=process.argv.slice(2),requested=args.filter(arg=>!arg.startsWith('--')).map(Number);
for(const tick of requested)if(!manifest.checkpoints.some(entry=>entry.tick===tick))throw new Error(`Requested checkpoint tick ${tick} is not available`);
const entries=manifest.checkpoints.filter(entry=>!requested.length||requested.includes(entry.tick));
const server=spawn(process.execPath,['serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'pipe'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser;const results=[];
try {
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/index.html`)).ok)break;}catch{}await sleep(100);}
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
 browser=await launchChrome({width:1600,height:1000});
 const errors=[];browser.cdp.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails));
 for(const backend of ['webgl','canvas']) {
   await browser.cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/index.html?record=1&tour=0&renderer=${backend}&checkpoint=none`});
   await waitFor(browser.cdp,'Boolean(window.__GENESIS)');
   await browser.cdp.evaluate('window.__GENESIS.ready');
   for(const entry of entries) {
     const result=await browser.cdp.evaluate(`(async()=>{const api=window.__GENESIS; await api.pause(); await api.setRecording(true); await api.load(await api.fetchCheckpoint(${JSON.stringify(entry)})); api.setCamera({cx:1600,cy:1050,zoom:0.4}); api.render(); return {tick:api.sim.view.tick,population:api.sim.view.nc,livingSpecies:api.sim.view.livingSpecies,renderer:api.renderer.constructor.name,camera:{cx:api.renderer.camera.cx,cy:api.renderer.camera.cy,zoom:api.renderer.camera.zoom},glError:api.renderer.gl?.getError()??null};})()`);
     assert.equal(result.tick,entry.tick);assert.equal(result.population,entry.metrics.population);assert.equal(result.camera.zoom,0.4);if(backend==='webgl')assert.equal(result.glError,0);
     const shot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     const file=`render-checkpoint-${backend}-t${entry.tick}.png`;
     await writeFile(new URL('../evidence/'+file,import.meta.url),Buffer.from(shot.data,'base64'));
     results.push({checkpoint:entry.id,sha256:entry.sha256,file,...result});console.log(`OK checkpoint ${backend} tick ${entry.tick} population ${result.population}`);
     if(args.includes('--clade')) {
       const hit=await browser.cdp.evaluate(`(()=>{const api=window.__GENESIS,c=document.getElementById('mullerRibbon'),r=c.getBoundingClientRect(),x=c.clientWidth-3;let best=null;for(let y=1;y<c.clientHeight-1;y++){const id=c._mullerPick(x,y),n=api.sim.speciesMap.get(id)?.count||0;if(id!==1&&n>0&&c._mullerPick(x,y-0.6)===id&&c._mullerPick(x,y+0.6)===id&&(!best||n>best.population))best={id,population:n,x:r.x+x,y:r.y+y};}return best;})()`);
       if(!hit)throw new Error('No visible living non-founder lineage band found');
       await browser.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
       await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});
       const selection=await browser.cdp.evaluate(`(()=>{const api=window.__GENESIS;api.render();let highlighted=0;const ids=api.state.highlightSpecies;for(let i=0;i<api.sim.view.nc;i++)if(ids.has(api.sim.view.f[i*13+8]))highlighted++;return{selectedSpecies:api.state.selectedSpecies,highlighted,cladeIds:[...ids],label:document.getElementById('cladeLabel').textContent};})()`);
       assert.equal(selection.selectedSpecies,hit.id);assert(selection.highlighted>0&&selection.highlighted<result.population);
       const cladeShot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
       const cladeFile=`render-checkpoint-${backend}-t${entry.tick}-clade.png`;
       await writeFile(new URL('../evidence/'+cladeFile,import.meta.url),Buffer.from(cladeShot.data,'base64'));
       results.push({checkpoint:entry.id,file:cladeFile,selection});console.log(`OK live ribbon click ${backend} clade ${hit.id} highlights ${selection.highlighted}`);
     }
   }
 }
 assert.equal(errors.length,0);
 const name=requested.length?requested.join('-'):'all';
 await writeFile(new URL(`../evidence/render-checkpoints-${name}.json`,import.meta.url),JSON.stringify({camera:'world centre / zoom 0.4',results,errors},null,2)+'\n');
} finally {await browser?.close();server.kill('SIGTERM');}
