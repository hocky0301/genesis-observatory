// Capture actual WebGL frames under a frame lock, using a private Chrome process.
// Usage: node tools/shoot.mjs --shots shots/smoke.json [--out out/smoke]
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome,waitFor } from './cdp.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),get=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
const specPath=path.resolve(ROOT,get('--shots','shots/smoke.json')),spec=JSON.parse(await readFile(specPath,'utf8'));
const out=path.resolve(ROOT,get('--out',`out/${spec.name||'film'}`));await mkdir(path.join(out,'frames'),{recursive:true});
const port=Number(get('--port','5187'));const server=spawn(process.execPath,['serve.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Static server startup timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
let browser;
try{
  browser=await launchChrome({url:`http://127.0.0.1:${port}/film.html`,width:1280,height:720,headless:!args.includes('--headed')});
  const runtimeErrors=[];browser.cdp.on('Runtime.exceptionThrown',e=>runtimeErrors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await waitFor(browser.cdp,'window.__FILM?.ready');
  const runtime=await browser.cdp.evaluate(`window.__FILM.init(${JSON.stringify(spec)})`);
  console.log(JSON.stringify({event:'capture-start',runtime,spec:specPath,out}));
  const count=spec.frames??Math.round((spec.duration||270)*(spec.sourceFps||15));const frames=[];
  for(let f=0;f<count;f++){
    const {png,meta}=await browser.cdp.evaluate(`window.__FILM.next(${f+(spec.startFrame||0)})`);
    const bytes=Buffer.from(png,'base64');const filename=String(f).padStart(6,'0')+'.png';
    await writeFile(path.join(out,'frames',filename),bytes);frames.push({...meta,file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    if((f+1)%60===0||f===count-1)console.log(JSON.stringify({event:'frames',done:f+1,total:count,tick:meta.tick}));
  }
  if(runtimeErrors.length)throw new Error(runtimeErrors.join('\n'));
  const sourceFiles={};for(const name of ['src/world.js','src/creature.js','src/neat.js','src/config.js','src/palette.js','src/gl-renderer.js','src/render-snapshot.js','src/film.js','src/recorder.js','tools/shoot.mjs'])sourceFiles[name]=createHash('sha256').update(await readFile(path.join(ROOT,name))).digest('hex');
  const manifest={schemaVersion:1,spec,runtime,browser:await browser.cdp.send('Browser.getVersion'),sourceFiles,sourceSha256:createHash('sha256').update(await readFile(specPath)).digest('hex'),frames};
  await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(out,'captions.json'),JSON.stringify(await browser.cdp.evaluate('({captions:window.__FILM.captions,limitations:window.__FILM.limitations})'),null,2)+'\n');
  console.log(JSON.stringify({event:'complete',frames:count,manifest:path.join(out,'manifest.json')}));
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
