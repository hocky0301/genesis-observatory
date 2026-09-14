// One full-horizon end-to-end browser Lab acceptance, using a real curated state.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {launchChrome,waitFor} from './cdp.mjs';
const origin=process.env.GENESIS_ORIGIN||'http://127.0.0.1:5173';
const expected=JSON.parse(await readFile(new URL('../evidence/lab-results.json',import.meta.url),'utf8'));
const b=await launchChrome({url:origin+'/?paused=1&checkpoint=s42-t1200&tour=0',width:1440,height:1000});
const report={scope:'One real Chromium form experiment from curated s42-t1200, food-half, 1800 ticks. Cross-runtime agreement is an observation, not a guarantee.',checks:[]};
try{
 const c=b.cdp,errors=[];c.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
 await waitFor(c,'window.__GENESIS?.sim?.view?.tick===1200 && document.getElementById("loadingState").hidden');
 report.start=await c.evaluate('({tick:__GENESIS.sim.view.tick,seed:__GENESIS.sim.seed,paused:__GENESIS.state.stepsPerFrame===0,checkpoint:document.getElementById("checkpointSelect").value})');
 assert.deepEqual(report.start,{tick:1200,seed:'42',paused:true,checkpoint:'s42-t1200'});
 await c.evaluate(`(()=>{document.getElementById('labPrediction').value='2500';document.getElementById('labTicks').value='1800';document.getElementById('labIntervention').value='food-half';document.getElementById('labForm').requestSubmit();})()`);
 assert.equal(await c.evaluate('document.getElementById("labPrediction").disabled'),true);
 report.checks.push('Prediction locked before branch execution');
 let last='';
 for(let i=0;i<1800;i++){
  const state=await c.evaluate(`({done:!!__GENESIS.lastExperiment,locked:document.getElementById('labRun').disabled,label:document.getElementById('labProgressLabel').textContent,message:document.getElementById('labStatus').textContent})`);
  if(state.label!==last){console.log(state.label);last=state.label;}
  if(state.done)break;
  if(!state.locked)throw new Error('Experiment stopped: '+state.message);
  if(i===1799)throw new Error('Full browser Lab did not complete');
  await new Promise(r=>setTimeout(r,500));
 }
 const actual=await c.evaluate(`(()=>{const e=__GENESIS.lastExperiment;return{plan:e.plan,result:e.result,commands:e.commands,control:e.branches.control.metrics,intervention:e.branches.intervention.metrics,controlSamples:e.branches.control.samples,interventionSamples:e.branches.intervention.samples,sourceTick:__GENESIS.sim.view.tick,status:document.getElementById('labStatus').textContent,errorCopy:document.getElementById('labError').textContent,effectCopy:document.getElementById('labEffect').textContent};})()`);
 report.actual=actual;
 assert.equal(actual.plan.startTick,1200);assert.equal(actual.plan.targetTick,3000);assert.equal(actual.plan.ticks,1800);assert.equal(actual.plan.prediction,2500);assert.equal(actual.sourceTick,1200);
 assert.equal(actual.control.tick,3000);assert.equal(actual.intervention.tick,3000);
 report.checks.push('Both live worker branches ended at tick 3000; original source stayed at 1200');
 const nodeControl=expected.baseline.metrics,nodeIntervention=expected.arms.find(a=>a.id==='food_half').metrics;
 report.comparison={referenceEvidence:'evidence/lab-results.json',referenceCheckpointSHA256:expected.checkpointSha256,nodeRuntime:expected.runtime,browserRuntime:await c.evaluate('navigator.userAgent'),controlDifferences:[],interventionDifferences:[]};
 for(const [name,browser,node]of [['control',actual.control,nodeControl],['intervention',actual.intervention,nodeIntervention]])for(const key of new Set([...Object.keys(browser),...Object.keys(node)]))if(!Object.is(browser[key],node[key]))report.comparison[name+'Differences'].push({field:key,browser:browser[key],node:node[key]});
 assert.equal(actual.control.population,nodeControl.population);assert.equal(actual.intervention.population,nodeIntervention.population);
 assert.equal(actual.result.actual,nodeIntervention.population);assert.equal(actual.result.signedError,2500-nodeIntervention.population);assert.equal(actual.result.populationEffect,nodeIntervention.population-nodeControl.population);
 report.checks.push('Control and intervention population match the independently recorded Node experiment; prediction error and intervention effect match arithmetic');
 for(const [name,id]of [['control','labViewControl'],['intervention','labViewTreatment']]){
  await c.evaluate(`(()=>{document.getElementById('${id}').click();document.getElementById('panel').scrollTop=document.getElementById('ecologyLab').offsetTop-20;})()`);
  const shot=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`../evidence/browser-lab-full-${name}.png`,import.meta.url),Buffer.from(shot.data,'base64'));
 }
 await c.evaluate('document.getElementById("labReturn").click()');
 assert.equal(await c.evaluate('__GENESIS.sim.view.tick'),1200);
 report.checks.push('Both outcome view controls work and return preserves the source checkpoint');
 assert.deepEqual(errors,[]);report.uncaught=errors;report.status='PASS';
 console.log(JSON.stringify({status:report.status,control:actual.control.population,intervention:actual.intervention.population,error:actual.result.signedError,controlMetricDifferences:report.comparison.controlDifferences.length,interventionMetricDifferences:report.comparison.interventionDifferences.length}));
}catch(error){report.status='FAIL';report.error=error.stack;console.error(error);process.exitCode=1;}
finally{await b.close();await writeFile(new URL('../evidence/browser-lab-full.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
