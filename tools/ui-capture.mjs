// Real curated checkpoint UI screenshots, including narrow-screen layout.
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launchChrome, waitFor } from './cdp.mjs';
const origin=process.env.GENESIS_ORIGIN||'http://127.0.0.1:5173';
const manifest=JSON.parse(await readFile(new URL('../checkpoints/manifest.json',import.meta.url),'utf8'));
const entry=manifest.checkpoints.find(e=>e.id==='s42-t2400')||manifest.checkpoints[0];
const b=await launchChrome({url:`${origin}/?paused=1&checkpoint=${entry.id}`,width:1440,height:1000,extraArgs:['--enable-unsafe-swiftshader']});
const evidence=[];
try {
 const c=b.cdp;await waitFor(c,`window.__GENESIS?.sim?.view?.tick===${entry.tick} && document.getElementById('loadingState').hidden`);
 const initial=await c.evaluate(`({tick:__GENESIS.sim.view.tick,population:__GENESIS.sim.view.creatureCount,historyStart:document.getElementById('historyStart').textContent,checkpoint:document.getElementById('checkpointSelect').value,loading:document.getElementById('loadingState').hidden})`);
 assert.equal(initial.checkpoint,entry.id);assert.equal(initial.historyStart,'TICK 0');assert.equal(initial.tick,entry.tick);evidence.push({name:'curated checkpoint startup',ok:true,detail:initial});
 await c.evaluate('__GENESIS.pause();__GENESIS.render()');
 let capture=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(new URL('../evidence/observatory-desktop.png',import.meta.url),Buffer.from(capture.data,'base64'));
 await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await c.evaluate('__GENESIS.render()');
 const mobile=await c.evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,lab:!!document.getElementById('labRun'),panel:document.getElementById('panel').getBoundingClientRect().width,scrollHeight:document.documentElement.scrollHeight})`);
 assert.ok(mobile.documentWidth<=mobile.width);assert.ok(mobile.bodyWidth<=mobile.width);assert.equal(mobile.panel,390);assert.ok(mobile.lab);evidence.push({name:'390px layout has no horizontal overflow and controls remain reachable',ok:true,detail:mobile});
 capture=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(new URL('../evidence/observatory-mobile-top.png',import.meta.url),Buffer.from(capture.data,'base64'));
 await c.evaluate(`document.getElementById('ecologyLab').scrollIntoView({block:'start'})`);
 capture=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(new URL('../evidence/observatory-mobile-lab.png',import.meta.url),Buffer.from(capture.data,'base64'));
 console.log(JSON.stringify(evidence,null,2));
}finally{await b.close();await writeFile(new URL('../evidence/browser-layout.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');}
