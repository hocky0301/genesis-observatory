#!/usr/bin/env node
// Real Chrome shader / Canvas smoke checks. Timings captured here are explicitly
// invalid for performance claims; root's quiet-machine benchmark is separate.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchChrome, waitFor } from './cdp.mjs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), port=Number(process.env.RENDER_PORT||5179);
const server=spawn(process.execPath,['serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'pipe'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;
try {
  for(let i=0;i<100;i++) { try { if((await fetch(`http://127.0.0.1:${port}/tools/render-bench.html`)).ok) break; } catch{} await sleep(100); }
  await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
  browser=await launchChrome({url:`http://127.0.0.1:${port}/tools/render-bench.html`,width:1440,height:950});
  const errors=[];browser.cdp.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails));
  await waitFor(browser.cdp,'window.benchmarkReady===true');
  const results=[]; const specimens=new Map();
  const cases=[
    {name:'baseline-overview',backend:'baseline',zoom:0.4},
    {name:'webgl-overview',backend:'webgl',zoom:0.4},
    {name:'webgl-clade',backend:'webgl',zoom:0.4,clade:true,ribbon:true},
    {name:'webgl-specimen',backend:'webgl',zoom:1.1,nc:9,nf:0,nk:0,specimen:true},
    {name:'canvas-specimen',backend:'canvas',zoom:1.1,nc:9,nf:0,nk:0,specimen:true},
    {name:'canvas-overview',backend:'canvas',zoom:0.4},
    {name:'webgl-custom-threshold',backend:'webgl',zoom:1.1,nc:9,nf:0,nk:0,specimen:true,paletteConfig:{carnivoreThreshold:0.9,scavengerLabel:1.3}},
    {name:'canvas-custom-threshold',backend:'canvas',zoom:1.1,nc:9,nf:0,nk:0,specimen:true,paletteConfig:{carnivoreThreshold:0.9,scavengerLabel:1.3}},
  ];
  for(const options of cases) {
    await browser.cdp.evaluate(`window.runBenchmark(${JSON.stringify({...options,frames:4,warmup:2})})`);
    const smoke=await browser.cdp.evaluate('window.rendererSmoke');
    if(options.backend!=='canvas') { assert.equal(smoke.creatureProgramLinked,true);assert.equal(smoke.dotProgramLinked,true);assert.equal(smoke.glError,0); }
    let pixels;
    if(options.specimen){ pixels=await browser.cdp.evaluate('window.sampleRenderPixels()'); specimens.set(options.name,pixels); }
    results.push({case:options,smoke,pixels});
    const screenshot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(new URL(`../evidence/render-${options.name}.png`,import.meta.url),Buffer.from(screenshot.data,'base64'));
    console.log('OK browser renderer '+options.name);
  }
  assert.equal(errors.length,0);
  // WebGL readPixels exposes premultiplied RGB from blending; Canvas readback
  // unpremultiplies it. Compare after applying the same alpha convention.
  for(const suffix of ['specimen','custom-threshold'])for(let i=0;i<9;i++) {
    const a=specimens.get('webgl-'+suffix)[i],b=specimens.get('canvas-'+suffix)[i];
    assert(Math.abs(a[3]-b[3])<=2,`age alpha differs at ${i}`);
    for(let channel=0;channel<3;channel++) assert(Math.abs(a[channel]-b[channel]*b[3]/255)<=3,`palette channel differs at ${i}:${channel}: ${a} vs ${b}`);
  }
  assert.notDeepEqual(specimens.get('webgl-specimen')[2],specimens.get('webgl-custom-threshold')[2]);
  console.log('OK WebGL/Canvas default/custom threshold palette and age alpha pixel parity');
  await writeFile(new URL('../evidence/shader-smoke.json',import.meta.url),JSON.stringify({purpose:'correctness-only; no valid performance claim',results,errors},null,2)+'\n');
} finally { await browser?.close();server.kill('SIGTERM'); }
