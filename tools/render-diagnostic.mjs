// Short, explicitly non-acceptance diagnostic for constrained presentation/power.
import {spawn,execFileSync} from 'node:child_process';
import{mkdir,writeFile}from'node:fs/promises';
import os from'node:os';
import{launchChrome,waitFor}from'./cdp.mjs';
const power=()=>{try{const text=execFileSync('pmset',['-g','batt'],{encoding:'utf8'});return{source:text.match(/Now drawing from '([^']+)'/)?.[1],percent:Number(text.match(/\b(\d+)%;/)?.[1]),state:text.match(/\d+%;\s*([^;]+);/)?.[1]};}catch{return null;}};
const root=new URL('../',import.meta.url),port=5179;
const server=spawn(process.execPath,['serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const results=[],environment={uptime:execFileSync('uptime',{encoding:'utf8'}).trim(),loadBefore:os.loadavg(),powerBefore:power(),cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length};
try{
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/tools/render-bench.html`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await launchChrome({url:`http://127.0.0.1:${port}/tools/render-bench.html`,width:1440,height:950});
 await waitFor(browser.cdp,'window.benchmarkReady===true');
 for(const clade of[false,true]){
  const result=await browser.cdp.evaluate(`window.runBenchmark(${JSON.stringify({backend:'webgl',zoom:0.4,frames:120,warmup:15,clade,ribbon:clade})})`);
  results.push(result);console.log(JSON.stringify({clade,medianFps:result.medianFps,cpuSubmissionMs:result.cpuSubmissionMs,glError:result.glError}));
 }
}finally{
 await browser?.close();server.kill('SIGTERM');
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
 await writeFile(new URL('../evidence/render-battery-diagnostic.json',import.meta.url),JSON.stringify({status:'diagnostic-only',acceptance:false,reason:'Empty rAF cadence near30Hz; host battery reported near depletion. No55fps claim; long acceptance runs deferred pending stable power.',environment:{...environment,loadAfter:os.loadavg(),powerAfter:power()},results},null,2)+'\n');
}
