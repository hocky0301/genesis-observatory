// Minimal dependency-free Chrome DevTools client. Each launch owns an isolated
// temporary profile and process. Never attaches to or closes a user's browser.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export class CDP {
  constructor(ws) { this.ws = ws; this.next = 1; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.id) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else for (const fn of this.handlers.get(m.method) || []) fn(m.params);
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP connection closed')); } this.pending.clear(); });
  }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true}); }); return new CDP(ws); }
  on(method, fn) { const list = this.handlers.get(method) || []; list.push(fn); this.handlers.set(method, list); return () => this.handlers.set(method, list.filter(f=>f!==fn)); }
  send(method, params = {}, timeout = 120000) { const id = this.next++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout); this.pending.set(id, {resolve,reject,timer}); this.ws.send(JSON.stringify({id,method,params})); }); }
  async evaluate(expression, options = {}) { const r = await this.send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true, userGesture:true, ...options}, options.timeout || 120000); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)); return r.result?.value; }
  close() { this.ws.close(); }
}
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
export async function launchChrome({url='about:blank', width=1280, height=720, headless=true, executable, extraArgs=[], profileRoot=tmpdir()} = {}) {
  const profile = await mkdtemp(path.join(profileRoot,'genesis-chrome-'));
  const binary = executable || process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--disable-component-update', '--force-device-scale-factor=1', '--hide-scrollbars', `--window-size=${width},${height}`, ...(headless ? ['--headless=new'] : []), ...extraArgs, 'about:blank'];
  const child = spawn(binary,args,{stdio:['ignore','ignore','pipe']}); let stderr=''; child.stderr.on('data',b=>{stderr=(stderr+b).slice(-12000);});
  child.on('error',()=>{});
  let port;
  for(let i=0;i<200;i++){ try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{} if(child.exitCode!==null)throw new Error(`Chrome exited: ${stderr}`);await pause(100); }
  if(!port){child.kill();throw new Error(`Chrome failed to start: ${stderr}`);}
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(t=>t.type==='page'); if(!target)throw new Error('No Chrome page target');
  const cdp=await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  if(url!=='about:blank')await cdp.send('Page.navigate',{url});
  return {cdp, client:cdp, port, profile, pid:child.pid, process:child,
    async close(){cdp.close();child.kill('SIGTERM');for(let i=0;i<30&&child.exitCode===null;i++)await pause(100);if(child.exitCode===null)child.kill('SIGKILL');await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100});},
  };
}
export async function waitFor(cdp, expression, {timeout=60000, interval=100}={}) { const deadline=Date.now()+timeout; let last; while(Date.now()<deadline){try{last=await cdp.evaluate(expression);if(last)return last;}catch(e){last=e.message;}await pause(interval);}throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(last)}`); }
