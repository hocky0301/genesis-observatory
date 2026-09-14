import { launchChrome } from './cdp.mjs';
import {writeFile} from 'node:fs/promises';
const results=[];
for(const headless of [true,false]){
 const browser=await launchChrome({width:1440,height:950,headless});
 try{const result=await browser.cdp.evaluate(`new Promise(resolve=>{const frames=[];let previous;function frame(now){if(previous!==undefined)frames.push(now-previous);previous=now;if(frames.length<120)requestAnimationFrame(frame);else{const sorted=[...frames].sort((a,b)=>a-b);resolve({kind:'empty-requestAnimationFrame-cadence',visibility:document.visibilityState,p50Ms:sorted[Math.floor(sorted.length/2)],medianFps:1000/sorted[Math.floor(sorted.length/2)],samples:frames,userAgent:navigator.userAgent});}}requestAnimationFrame(frame);})`);results.push({headless,...result});console.log(JSON.stringify({headless,medianFps:result.medianFps,p50Ms:result.p50Ms,visibility:result.visibility}));}finally{await browser.close();}
}
await writeFile(new URL('../evidence/refresh-probe.json',import.meta.url),JSON.stringify({purpose:'Presentation cadence diagnostic, not renderer performance',results},null,2)+'\n');
