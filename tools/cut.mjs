// Encode deterministic PNG frames plus an original synthesized score. Captions
// are already painted into each actual WebGL frame; also export an editable SRT.
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeScore } from './score.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),get=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
const input=path.resolve(ROOT,get('--input','out/film')),output=path.resolve(ROOT,get('--output','docs/genesis-film.mp4'));
const manifest=JSON.parse(await readFile(path.join(input,'manifest.json'),'utf8')),sourceFps=manifest.spec.sourceFps||15,duration=manifest.frames.length/sourceFps;
await mkdir(path.dirname(output),{recursive:true});const wav=path.join(input,'score.wav');await writeScore(wav,duration);
function run(argv){return new Promise((resolve,reject)=>{const p=spawn(process.env.FFMPEG||'ffmpeg',argv,{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}`)));});}
await run(['-hide_banner','-loglevel','warning','-y','-framerate',String(sourceFps),'-i',path.join(input,'frames','%06d.png'),'-i',wav,'-map','0:v:0','-map','1:a:0','-vf','fps=30,format=yuv420p','-c:v','libx264','-threads','2','-preset','medium','-crf','20','-c:a','aac','-b:a','160k','-ar','48000','-t',String(duration),'-movflags','+faststart','-metadata','title=GENESIS — An Artificial Life Observatory','-metadata',`comment=Actual WebGL2 frames. ${sourceFps} unique simulation frames/s; encoded to 30 fps. Original synthesized score.`,output]);
const time=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(Math.floor(s)%60).padStart(2,'0')},000`;
const captions=JSON.parse(await readFile(path.join(input,'captions.json'),'utf8')).captions;const srt=captions.map((c,i)=>`${i+1}\n${time(i*15)} --> ${time(Math.min(duration,(i+1)*15))}\n${c}\n`).filter((_,i)=>i*15<duration).join('\n');await writeFile(output.replace(/\.mp4$/,'.srt'),srt+'\n');
const gif=path.resolve(ROOT,get('--gif','docs/genesis.gif')),from=Math.min(Math.max(0,duration-6),Number(get('--gif-from','52')));
await run(['-hide_banner','-loglevel','warning','-y','-ss',String(from),'-t','6','-i',output,'-filter_complex','[0:v]fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',gif]);
await writeFile(path.join(path.dirname(output),'film-provenance.json'),JSON.stringify({duration,width:1280,height:720,sourceFps,encodedFps:30,uniqueFrames:manifest.frames.length,encodedFrames:duration*30,checkpoints:manifest.spec.checkpoints||manifest.spec.checkpoint,sourceCapture:path.relative(ROOT,input),audio:'Original deterministic additive synthesis, tools/score.mjs',captions:'Burned into source canvas; matching SRT',gif:{from,duration:6,width:640,fps:10,maxColors:80},runtime:manifest.runtime},null,2)+'\n');
console.log(JSON.stringify({event:'encoded',output,gif,duration,sourceFrames:manifest.frames.length}));
