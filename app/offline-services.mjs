import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

export const MODELS={
 base:{bytes:147951465,sha256:'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'},
 small:{bytes:487601967,sha256:'1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'},
 medium:{bytes:1533763059,sha256:'6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'},
 'large-v3-turbo':{bytes:1624555275,sha256:'1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'}
};
export function whisperWords(result){
 const words=[];
 for(const segment of result.transcription||[]){
  let current=null;
  for(const token of segment.tokens||[]){
   const text=String(token.text||'');if(!text||text.startsWith('[_')||text.startsWith('<|'))continue;
   const start=Number(token.offsets?.from)/1000,end=Number(token.offsets?.to)/1000;
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)continue;
   if(/^\s/.test(text)||!current){current={text:text.trim(),start,end};if(current.text)words.push(current);}
   else {current.text+=text;current.end=Math.max(current.end,end);}
  }
 }
 return words.filter(w=>w.text&&w.end>w.start);
}
export function createOfflineServices({data,nativeRoot,ffmpeg,run,getAsset,persistCatalog,waitPreview=()=>null,fetchImpl=globalThis.fetch}){
 const modelsDir=path.join(data,'models'),settingsFile=path.join(data,'settings.json');let downloading=new Map();
 let settings={model:'large-v3-turbo',language:'auto',optionalAI:false,theme:'light',tourDismissed:false};try{settings={...settings,...JSON.parse(fs.readFileSync(settingsFile,'utf8'))};}catch{}
 const native=path.join(nativeRoot,`${process.platform}-${process.arch}`),exe=process.platform==='win32'?'.exe':'';
 const whisper=process.platform==='win32'?path.join(native,'whisper','Release','whisper-cli.exe'):path.join(native,'whisper','bin','whisper-cli');
 const deepFilter=path.join(native,'deep-filter'+exe),dfModel=path.join(native,'DeepFilterNet3_onnx.tar.gz');
 const modelFile=model=>path.join(modelsDir,`ggml-${model}.bin`);
 const status=()=>({settings:{...settings},models:Object.entries(MODELS).map(([id,m])=>({id,bytes:m.bytes,installed:fs.existsSync(modelFile(id))&&fs.statSync(modelFile(id)).size===m.bytes})),whisper:fs.existsSync(whisper),studioSound:fs.existsSync(deepFilter)&&fs.existsSync(dfModel)});
 async function saveSettings(input){if(input.model!==undefined){if(!MODELS[input.model])throw Error('Choisissez base, small, medium ou large-v3-turbo');settings.model=input.model;}if(input.language!==undefined){if(input.language!=='auto'&&!/^[a-z]{2}$/.test(input.language))throw Error('Choisissez auto ou un code de langue à 2 lettres');settings.language=input.language;}if(input.optionalAI!==undefined)settings.optionalAI=input.optionalAI===true;if(input.theme!==undefined){if(!['light','dark'].includes(input.theme))throw Error('Choisissez l’apparence claire ou sombre');settings.theme=input.theme;}if(input.tourDismissed!==undefined)settings.tourDismissed=input.tourDismissed===true;await fsp.writeFile(settingsFile,JSON.stringify(settings,null,2));return status();}
 async function ensureModel(model,j){
  if(!MODELS[model])throw Error('Modèle de transcription inconnu');
  const file=modelFile(model),spec=MODELS[model];if(fs.existsSync(file)&&fs.statSync(file).size===spec.bytes)return file;
  if(downloading.has(model)){j.stage='En attente du téléchargement du modèle';return downloading.get(model);}
  const task=(async()=>{await fsp.mkdir(modelsDir,{recursive:true});j.stage=`Téléchargement du modèle ${model} (première utilisation)`;const response=await fetchImpl(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`,{signal:AbortSignal.timeout(30*60*1000)});if(!response.ok||!response.body)throw Error(`Échec du téléchargement du modèle (${response.status}). Connectez-vous une fois pour le télécharger, puis travaillez hors ligne.`);
   const temp=file+'.part',handle=await fsp.open(temp,'w'),hash=createHash('sha256');let bytes=0;
   try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>spec.bytes)throw Error('Le téléchargement du modèle dépasse la taille prévue');hash.update(chunk);await handle.write(chunk);j.downloadedBytes=bytes;j.totalBytes=spec.bytes;j.progress=Math.round(bytes/spec.bytes*85);}if(bytes!==spec.bytes||hash.digest('hex')!==spec.sha256)throw Error('La vérification du modèle a échoué (somme de contrôle)');}catch(e){await handle.close();await fsp.rm(temp,{force:true});throw e;}await handle.close();await fsp.rename(temp,file);return file;
  })();downloading.set(model,task);try{return await task;}finally{downloading.delete(model);}
 }
 // Detect real silences from the audio itself (whisper word timestamps have almost no gaps).
 const silenceCache=new Map();
 async function detectSilences(assetId,{noiseDb=-30,minDuration=0.6}={}){
  const a=getAsset(assetId);if(!a.hasAudio)throw Error('Ce média n’a pas de piste audio');
  const db=Math.max(-60,Math.min(-10,Number(noiseDb)||-30)),dur=Math.max(0.2,Math.min(5,Number(minDuration)||0.6));
  const key=`${assetId}:${db}:${dur}`;if(silenceCache.has(key))return silenceCache.get(key);
  // Decode the audio once to a light mono wav, then run silencedetect on that (fast even for 4K sources).
  const dir=path.join(data,'jobs','silences');await fsp.mkdir(dir,{recursive:true});const wav=path.join(dir,`${assetId}.wav`);
  if(!fs.existsSync(wav))await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',a.file,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
  const out=await run(ffmpeg,['-hide_banner','-nostats','-i',wav,'-af',`silencedetect=noise=${db}dB:d=${dur}`,'-f','null','-'],{captureStderr:true});
  const silences=[];let start=null;
  for(const line of out.split('\n')){
   const s=line.match(/silence_start:\s*(-?[\d.]+)/);if(s){start=Number(s[1]);continue;}
   const e=line.match(/silence_end:\s*([\d.]+)/);if(e&&start!==null){const end=Number(e[1]);if(end>start)silences.push({start:Math.max(0,start),end});start=null;}
  }
  const result={assetId,silences};silenceCache.set(key,result);return result;
 }
 async function transcribe(assetId,model,j){
  if(!fs.existsSync(whisper))throw Error('L’outil whisper.cpp intégré est introuvable. Réinstallez OziCut.');
  const a=getAsset(assetId);if(!a.hasAudio)throw Error('Ce média n’a pas de piste audio');const file=await ensureModel(model||settings.model,j),dir=path.join(data,'jobs',j.id);await fsp.mkdir(dir,{recursive:true});
  try{
   j.stage='Extraction de l’audio';j.progress=87;const wav=path.join(dir,'speech.wav'),output=path.join(dir,'transcript');
   await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',a.file,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav]);
   j.stage=`Transcription hors ligne avec whisper.cpp (${model||settings.model})`;j.progress=90;
   await run(whisper,['-m',file,'-f',wav,'-ojf','-of',output,'-ml','1','-sow','-l',settings.language||'auto','-t',String(Math.max(1,Math.min(8,os.cpus().length-1)))]);
   const result=JSON.parse(await fsp.readFile(output+'.json','utf8')),words=whisperWords(result);if(!words.length)throw Error('Aucune parole horodatée détectée. Essayez un modèle plus grand ou un audio plus clair.');return {words,engine:'whisper.cpp',model:model||settings.model};
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
 }
 const processing=new Map();
 async function studioSound(assetId,j){
  const a=getAsset(assetId);if(!a.hasAudio)throw Error('Ce média n’a pas d’audio');if(a.studioFile&&fs.existsSync(a.studioFile))return {assetId,url:`/studio/${assetId}`,engine:'DeepFilterNet3 ONNX'};
  if(processing.has(assetId))return processing.get(assetId);
  const task=(async()=>{if(!fs.existsSync(deepFilter)||!fs.existsSync(dfModel))throw Error('L’outil DeepFilterNet intégré est introuvable');
   const dir=path.join(data,'media',`${assetId}-studio`);await fsp.mkdir(dir,{recursive:true});const wav=path.join(dir,'input.wav');j.stage='Préparation de l’audio 48 kHz';j.progress=10;
   await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',a.file,'-vn','-ar','48000','-ac','1','-c:a','pcm_s16le',wav]);
   j.stage='Réduction de bruit (DeepFilterNet3)';j.progress=30;await run(deepFilter,['-m',dfModel,'-D','-o',path.join(dir,'enhanced'),wav],{env:{...process.env,RAYON_NUM_THREADS:'4'}});
   const files=await fsp.readdir(path.join(dir,'enhanced')),enhanced=files.find(f=>f.endsWith('.wav'));if(!enhanced)throw Error('Le nettoyage de la voix n’a produit aucun audio');
   j.stage='Mesure du volume';j.progress=70;const input=path.join(dir,'enhanced',enhanced);
   const measurement=await run(ffmpeg,['-hide_banner','-nostats','-i',input,'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{captureStderr:true});
   let measured;try{measured=JSON.parse(measurement.slice(measurement.lastIndexOf('{')));}catch{throw Error('Impossible de mesurer le volume de l’audio traité');}
   const numbers=['input_i','input_tp','input_lra','input_thresh','target_offset'];const measuredOK=numbers.every(k=>Number.isFinite(Number(measured[k])));
   const filter=measuredOK?`loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`:'loudnorm=I=-16:TP=-1.5:LRA=11';
   j.stage='Normalisation et préparation de la comparaison A/B';j.progress=85;const cleaned=path.join(dir,'cleaned.wav');await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',input,'-af',filter,'-ar','48000','-ac','2','-c:a','pcm_s16le',cleaned]);
   await Promise.resolve(waitPreview(assetId)).catch(()=>{});
   const output=path.join(dir,a.type==='video'?'preview.mp4':'preview.m4a');const args=a.type==='video'?['-i',a.proxy||a.file,'-i',cleaned,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-t',String(a.duration),'-movflags','+faststart',output]:['-i',cleaned,'-c:a','aac',output];
   await run(ffmpeg,['-hide_banner','-loglevel','error','-y',...args]);a.studioFile=output;a.studioAudio=cleaned;await persistCatalog();
   // Only cleaned.wav (export) and the preview are needed; the 48 kHz copies are temporary.
   await fsp.rm(wav,{force:true});await fsp.rm(path.join(dir,'enhanced'),{recursive:true,force:true});return {assetId,url:`/studio/${assetId}`,engine:'DeepFilterNet3 ONNX',loudness:measured};
  })();processing.set(assetId,task);try{return await task;}finally{processing.delete(assetId);}
 }
 return {status,saveSettings,ensureModel,transcribe,studioSound,detectSilences,cloudEnabled:()=>settings.optionalAI};
}
