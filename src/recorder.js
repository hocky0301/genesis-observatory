// Recording utilities use simulation tick and integer frame index only. Browser
// scheduling controls when a frame is delivered, never what a frame contains.
export function toroidalCenter(creatures, width, height) {
  if (!creatures.length) return [width / 2, height / 2];
  let sx=0,cx=0,sy=0,cy=0;
  for(const c of creatures){const x=c.x/width*Math.PI*2,y=c.y/height*Math.PI*2;sx+=Math.sin(x);cx+=Math.cos(x);sy+=Math.sin(y);cy+=Math.cos(y);}
  const positive=a=>(a+Math.PI*2)%(Math.PI*2);
  return [positive(Math.atan2(sx,cx))*width/(Math.PI*2),positive(Math.atan2(sy,cy))*height/(Math.PI*2)];
}
export function logZoom(a,b,t){return Math.exp(Math.log(a)*(1-t)+Math.log(b)*t);}
export function ease(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
export function wrapLines(ctx,text,maxWidth){const lines=[];let line='';for(const word of text.split(' ')){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);return lines;}
export async function loadCheckpoint(url){const r=await fetch(url);if(!r.ok)throw new Error(`Checkpoint ${url}: HTTP ${r.status}`);let bytes=await r.arrayBuffer();if(url.endsWith('.gz'))bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const checkpoint=JSON.parse(new TextDecoder().decode(bytes));if(!checkpoint.state||!checkpoint.provenance?.config)throw new Error('Film requires an exact checkpoint with effective configuration');return checkpoint;}
export function drawRibbon(ctx,history,world,{x=40,y=630,w=1200,h=44,focus=null}={}){
  const ticks=history.ticks||[];const entries=history.speciesHistory||[];
  if(ticks.length<2||!entries.length)return;
  const rows=entries.map(([id,a])=>({id,a}));const total=ticks.map((_,i)=>rows.reduce((n,r)=>n+(r.a[i]||0),0));
  const base=new Float64Array(ticks.length);const t0=ticks[0],span=Math.max(1,ticks[ticks.length-1]-t0);
  ctx.fillStyle='#15252b';ctx.fillRect(x,y,w,h);
  for(const row of rows){ctx.beginPath();for(let i=0;i<ticks.length;i++){const px=x+(ticks[i]-t0)/span*w,py=y+h-base[i]/Math.max(1,total[i])*h;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}for(let i=ticks.length-1;i>=0;i--)ctx.lineTo(x+(ticks[i]-t0)/span*w,y+h-(base[i]+(row.a[i]||0))/Math.max(1,total[i])*h);ctx.closePath();ctx.fillStyle=`hsla(${(row.id*137.508)%360},${focus&&row.id!==focus?18:48}%,${row.id===focus?67:43}%,.9)`;ctx.fill();for(let i=0;i<base.length;i++)base[i]+=row.a[i]||0;}
  ctx.fillStyle='#9db7bc';ctx.font='11px ui-monospace, Menlo, monospace';ctx.fillText(`LINEAGE HISTORY · relative population · tick ${t0}`,x,y+h+17);ctx.textAlign='right';ctx.fillText(String(ticks[ticks.length-1]),x+w,y+h+17);ctx.textAlign='left';
}
