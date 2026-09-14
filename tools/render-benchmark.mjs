#!/usr/bin/env node
// Renderer benchmark with declared quiet-machine gates, or an explicitly
// non-acceptance diagnostic protocol. Includes provenance and every raw sample.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { launchChrome, waitFor } from './cdp.mjs';
const root=new URL('../',import.meta.url), port=Number(process.env.RENDER_PORT||5179);
const argv=process.argv.slice(2),opt=(key,def)=>{const i=argv.indexOf(key);return i<0?def:argv[i+1];};
const frames=Number(opt('--frames','240')),warmup=Number(opt('--warmup','60'));
const focus=argv.includes('--focus'), mode=focus?'focus':'broad';
const diagnostic=argv.includes('--diagnostic-30hz');
const recordAll=argv.includes('--record-all');
const useIdleGate=argv.includes('--cpu-idle-gate');
const protocol=diagnostic?{
  version:3,label:'measured-in-30Hz-environment',backgroundProbeSeconds:5,
  rule:'Record aggregate CPU idle for five seconds before and after every case, all load averages, and during-case CPU. No quiet-machine admission is claimed; low idle is retained and labelled. The 55 FPS presentation target remains unvalidated because empty requestAnimationFrame probes show an approximately 30 Hz environment ceiling.',
  reason:'Headless and headed empty-rAF diagnostics both measured approximately 30 Hz. The host was connected to AC before this run; OS power settings are unchanged. This diagnostic protocol was declared before samples and does not replace or relabel rejected v1 runs.',
  ownership:'All owned simulation, media and packaging work is stopped. Unrelated user processes and OS power settings are untouched.',
}:useIdleGate?{
  version:2,label:'measured-with-CPU-idle-gate',minimumBackgroundIdlePercent:75,backgroundProbeSeconds:5,
  rule:'Aggregate CPU idle must be at least 75% for five seconds immediately before each case and for five seconds after rendering stops. During-case CPU and all load averages are reported, not admission gates.',
  reason:'The absolute one-minute load gate rejected a completed original-renderer measurement although background CPU probes were about 87% idle across 12 cores. The measured renderer contributes to during-case load. This alternative was declared prospectively; rejected v1 samples remain separate.',
  ownership:'Root confirmed all owned production, simulation, media, browser and packaging jobs closed; unrelated user processes remain untouched.',
}: {version:1,label:'original-load-gate',maximumOneMinuteLoad:3,rule:'One-minute load must be at most 3 before and after every case.'};
if(recordAll)protocol.rejectedCasePolicy='Record every case once even when admission or post-case quietness fails. Retain raw samples and label failed cases rejected; do not retry or claim quiet-machine acceptance for them.';
const cpuSnapshot=()=>os.cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
const cpuDelta=(a,b)=>({idlePercent:100*(b.idle-a.idle)/(b.total-a.total),busyPercent:100*(1-(b.idle-a.idle)/(b.total-a.total))});
const backgroundProbe=async()=>{const a=cpuSnapshot(),loadBefore=os.loadavg();await new Promise(resolve=>setTimeout(resolve,5000));return{seconds:5,...cpuDelta(a,cpuSnapshot()),loadBefore,loadAfter:os.loadavg()};};
const power=()=>{try{const value=execFileSync('pmset',['-g','batt'],{encoding:'utf8'});return{recordedAt:new Date().toISOString(),source:value.match(/Now drawing from '([^']+)'/)?.[1],percent:Number(value.match(/\b(\d+)%;/)?.[1]),state:value.match(/\d+%;\s*([^;]+);/)?.[1]};}catch{return null;}};
if(!Number.isInteger(frames)||frames<2||!Number.isInteger(warmup)||warmup<0)throw new Error('--frames must be an integer >= 2; --warmup must be an integer >= 0');
const scope=focus
  ? 'Fixed camera zoom 0.4: original WebGL, current WebGL, current WebGL with clade and synthetic ribbon. Canvas only when --fallback is supplied.'
  : 'Twelve cases across zoom 0.25, 0.4, 0.9: original/current WebGL, current WebGL with clade+ribbon, and Canvas with clade+ribbon.';
const uptime=execFileSync('uptime',{encoding:'utf8'}).trim();console.log(uptime);
const initialLoad=os.loadavg();
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
// Protocol decision is saved before any browser frames or performance samples.
await writeFile(new URL(`../evidence/render-benchmark-protocol-v${protocol.version}-${mode}.json`,import.meta.url),JSON.stringify({declaredAt:new Date().toISOString(),mode,scope,protocol,uptime,initialLoad,power:power()},null,2)+'\n');
const initialBackground=useIdleGate&&!diagnostic?await backgroundProbe():null;
if(!diagnostic&&!recordAll&&(useIdleGate?initialBackground.idlePercent<75:initialLoad[0]>3)){
  await writeFile(new URL('../evidence/render-benchmark-deferred.json',import.meta.url),JSON.stringify({status:'deferred',mode,scope,protocol,reason:useIdleGate?'Background CPU idle below 75%':'1-minute load average exceeds 3',uptime,loadavg:initialLoad,initialBackground},null,2)+'\n');
  console.error('Benchmark deferred: '+protocol.label+' admission failed.');process.exit(2);
}
const files=['src/config.js','src/rng.js','tools/render-benchmark.mjs','tools/cdp.mjs','src/render-snapshot.js','src/gl-renderer.js','src/renderer.js','src/camera.js','src/palette.js','src/muller.js','tools/render-bench.html','tools/render-fixture.js','tools/bench-baseline/gl-renderer.js','tools/bench-baseline/render-snapshot.js','tools/bench-baseline/camera.js'];
const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
const server=spawn(process.execPath,['serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'pipe'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser;
const results=[],admissionChecks=[],environment={headless:!argv.includes('--visible'),node:process.version,platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,memoryBytes:os.totalmem(),uptime,initialLoad,initialBackground,powerBefore:power(),powerSettings:execFileSync('pmset',['-g','custom'],{encoding:'utf8'}).trim(),presentationProbe:'evidence/refresh-probe-ac.json'};
try{
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/tools/render-bench.html`)).ok)break;}catch{}await sleep(100);}
  browser=await launchChrome({url:`http://127.0.0.1:${port}/tools/render-bench.html`,width:1440,height:950,headless:!argv.includes('--visible')});
  await waitFor(browser.cdp,'window.benchmarkReady===true');
  const cases=[];
  if(focus){
    cases.push({backend:'baseline',zoom:0.4,ribbon:false,clade:false},
      {backend:'webgl',zoom:0.4,ribbon:false,clade:false},
      {backend:'webgl',zoom:0.4,ribbon:true,clade:true});
    if(argv.includes('--fallback'))cases.push({backend:'canvas',zoom:0.4,ribbon:true,clade:true});
  }else{
    for(const zoom of [0.25,0.4,0.9])for(const backend of ['baseline','webgl'])cases.push({backend,zoom,ribbon:false,clade:false});
    for(const zoom of [0.25,0.4,0.9])cases.push({backend:'webgl',zoom,ribbon:true,clade:true});
    for(const zoom of [0.25,0.4,0.9])cases.push({backend:'canvas',zoom,ribbon:true,clade:true});
  }
  for(const scenario of cases){
    const backgroundBefore=useIdleGate||diagnostic?await backgroundProbe():null;
    const loadBefore=os.loadavg();
    const admitted=useIdleGate?backgroundBefore.idlePercent>=75:loadBefore[0]<=3;
    admissionChecks.push({scenario,backgroundBefore,loadBefore,admitted});
    if(!diagnostic&&!recordAll&&!admitted)throw new Error(`Background gate failed before ${JSON.stringify(scenario)}`);
    const powerBefore=power(),startedAt=new Date().toISOString();
    const measuredFrames=focus&&scenario.backend==='canvas'?240:frames;
    const warmupFrames=focus&&scenario.backend==='canvas'?30:warmup;
    const cpuBefore=cpuSnapshot();
    const result=await browser.cdp.evaluate(`window.runBenchmark(${JSON.stringify({...scenario,frames:measuredFrames,warmup:warmupFrames,width:1280,height:720})})`,{timeout:Math.max(180000,(measuredFrames+warmupFrames)*100)});
    const duringCaseCpu=cpuDelta(cpuBefore,cpuSnapshot()),loadAfter=os.loadavg();
    const backgroundAfter=useIdleGate||diagnostic?await backgroundProbe():null;
    const powerAfter=power();
    const loadValid=loadBefore[0]<=3&&loadAfter[0]<=3;
    const cpuIdleValid=useIdleGate||diagnostic?backgroundBefore.idlePercent>=75&&backgroundAfter.idlePercent>=75:null;
    const gateValid=useIdleGate?cpuIdleValid:loadValid;
    const accepted=!diagnostic&&gateValid&&(result.glError===null||result.glError===0);
    // Retain raw samples even when a completed case fails the post-measurement
    // gate. The incomplete record explicitly separates rejected measurements.
    results.push({...result,startedAt,powerBefore,powerAfter,measurementDurationSeconds:result.samples.frameIntervalsMs.reduce((sum,value)=>sum+value,0)/1000,loadBefore,loadAfter,loadValid,originalLoadGatePassed:loadValid,backgroundBefore,backgroundAfter,duringCaseCpu,cpuIdleValid,accepted,measurementStatus:diagnostic?'measured-in-30Hz-environment':accepted?'accepted':'rejected'});
    if(result.glError!==null&&result.glError!==0)throw new Error('GL error '+result.glError);
    if(!diagnostic&&!recordAll&&!gateValid)throw new Error(`Post-case gate failed for ${JSON.stringify(scenario)}: ${JSON.stringify({loadAfter,backgroundAfter})}`);
    console.log(`${scenario.backend} zoom=${scenario.zoom} ribbon=${scenario.ribbon} clade=${scenario.clade} p50=${result.medianFps.toFixed(2)} fps cpu=${result.cpuSubmissionMs.p50.toFixed(3)} ms accepted=${accepted} backgroundIdle=${backgroundBefore?.idlePercent.toFixed(2)}/${backgroundAfter?.idlePercent.toFixed(2)}%`);
    const currentCases=results.filter(result=>result.options.backend==='webgl');
    const record={schema:1,status:diagnostic?'measured-in-30Hz-environment':results.length===cases.length?(results.every(result=>result.accepted)?'complete':'complete-with-rejected-cases'):'partial',complete:results.length===cases.length,mode,scope,protocol,admissionChecks,originalLoadGatePassed:initialLoad[0]<=3&&results.every(result=>result.loadValid),acceptance:{status:diagnostic?'unvalidated-environmental-presentation-ceiling':results.every(result=>result.accepted)?'measured':'unvalidated-background-contention',minimumMedianFps:55,testedCurrentWebglCases:currentCases.length,observedCurrentWebglPass:currentCases.length?currentCases.every(result=>result.medianFps>=55):null,currentWebglPass:diagnostic||!results.every(result=>result.accepted)?null:currentCases.length?currentCases.every(result=>result.medianFps>=55):null},environment:{...environment,powerAfter:power()},sourceSha256:hashes,results};
    await writeFile(new URL(`../evidence/render-benchmark-${mode}.json`,import.meta.url),JSON.stringify(record,null,2)+'\n');
    if(focus)await writeFile(new URL('../evidence/render-benchmark.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
  }
}catch(error){
  await writeFile(new URL('../evidence/render-benchmark-incomplete.json',import.meta.url),JSON.stringify({schema:1,status:'incomplete',mode,scope,protocol,admissionChecks,error:error.message,environment,sourceSha256:hashes,results},null,2)+'\n');throw error;
}finally{await browser?.close();server.kill('SIGTERM');}
