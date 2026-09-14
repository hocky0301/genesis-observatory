// Original deterministic instrumental score: additive sine partials, slow pads,
// soft bell notes and bass. No recordings, samples, external assets or services.
// Usage: node tools/score.mjs [output.wav] [durationSeconds]
import { writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { makeRNG } from '../src/rng.js';
export async function writeScore(filename,duration=270){
  const rate=48000,samples=Math.round(duration*rate),left=new Float32Array(samples),right=new Float32Array(samples),rng=makeRNG('GENESIS-original-score-v1');
  const hz=m=>440*2**((m-69)/12);
  const chords=[[40,47,54,59],[36,43,50,55],[45,52,59,64],[47,54,61,66],[40,47,55,62],[36,43,52,59]];
  function note(start,length,midi,gain,pan,kind){const begin=Math.floor(start*rate),end=Math.min(samples,Math.ceil((start+length)*rate)),freq=hz(midi),l=Math.sqrt((1-pan)/2),r=Math.sqrt((1+pan)/2);
    for(let i=begin;i<end;i++){const t=(i-begin)/rate;let env,signal;if(kind==='pad'){env=Math.min(1,t/2)*Math.min(1,(length-t)/3);signal=Math.sin(2*Math.PI*freq*t)+.18*Math.sin(2*Math.PI*freq*2.002*t)+.06*Math.sin(2*Math.PI*freq*3*t);}else{env=(1-Math.exp(-t*45))*Math.exp(-t/(kind==='bass'?2.8:1.6))*Math.min(1,(length-t)/.1);signal=Math.sin(2*Math.PI*freq*t)+.2*Math.sin(2*Math.PI*freq*2*t)*Math.exp(-t*2)+.05*Math.sin(2*Math.PI*freq*4*t)*Math.exp(-t*3);}const v=signal*env*gain;left[i]+=v*l;right[i]+=v*r;}
  }
  for(let start=0;start<duration;start+=15){const chapter=Math.min(5,Math.floor(start/45)),chord=chords[chapter];chord.forEach((n,i)=>note(start,19,n,.04,(i-1.5)/2,'pad'));note(start,8,chord[0]-12,.10,0,'bass');
    for(let b=0;b<6;b++){const midi=chord[(b+Math.floor(start/15))%4]+12+(rng.chance(.2)?12:0);note(start+b*2.5,8,midi,.06,rng.range(-.65,.65),'bell');}}
  // Quiet fixed cross-channel delays add space without changing total duration.
  const delay=Math.round(rate*.375);for(let i=samples-1;i>=delay;i--){left[i]+=right[i-delay]*.14;right[i]+=left[i-delay]*.12;}
  let peak=0;for(let i=0;i<samples;i++){const fade=Math.min(1,i/(rate*4),(samples-i)/(rate*7));left[i]*=fade;right[i]*=fade;peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));}
  const scale=.68/Math.max(peak,.001),data=Buffer.alloc(44+samples*4);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*4,28);data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*4,40);for(let i=0;i<samples;i++){data.writeInt16LE(Math.round(left[i]*scale*32767),44+i*4);data.writeInt16LE(Math.round(right[i]*scale*32767),46+i*4);}
  await mkdir(path.dirname(path.resolve(filename)),{recursive:true});await writeFile(filename,data);return {duration,rate,channels:2,peak:.68,bytes:data.length};
}
if(process.argv[1]&&import.meta.url===new URL('file:'+path.resolve(process.argv[1])).href){const filename=process.argv[2]||'out/score.wav';console.log(JSON.stringify({file:filename,...await writeScore(filename,Number(process.argv[3]||270))}));}
