import {readFile as localReadFile,stat} from 'node:fs/promises';
import path from 'node:path';
const MAX_BYTES=20*1024*1024;
const required=(value,label,max=4000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`${label} : champ requis (${max} caractères maximum)`);return value.trim();};
async function call(route,key,options,fetchImpl){const response=await fetchImpl(`https://api.elevenlabs.io${route}`,{...options,headers:{'xi-api-key':key,...options.headers},redirect:'error',signal:AbortSignal.timeout(180000)});if(!response.ok){let message;try{const data=await response.json();message=typeof data.detail==='string'?data.detail:data.detail?.message||data.message;}catch{}throw Error(message||`Voice provider returned ${response.status}`);}return response;}
export async function runVoiceAction(action,input={},context={}){
 const key=required(input.apiKey||input.key,'Clé API ElevenLabs',500),fetchImpl=context.fetchImpl||globalThis.fetch;
 if(action==='voices'){
  const token=input.nextPageToken?`&next_page_token=${encodeURIComponent(String(input.nextPageToken).slice(0,500))}`:'';
  const data=await(await call(`/v2/voices?page_size=100${token}`,key,{method:'GET'},fetchImpl)).json();
  if(!Array.isArray(data.voices))throw Error('Le service vocal a renvoyé une liste de voix invalide');
  return {voices:data.voices.filter(v=>typeof v.voice_id==='string'&&typeof v.name==='string').map(v=>({id:v.voice_id,name:v.name,category:v.category||'',requiresVerification:false})),hasMore:!!data.has_more,nextPageToken:data.next_page_token||null};
 }
 if(action==='clone'){
  const name=required(input.name,'Nom de la voix',100);if(!Array.isArray(input.sampleIds)||!input.sampleIds.length||input.sampleIds.length>10)throw Error('Choisissez entre 1 et 10 échantillons audio');
  if(input.consent!==true)throw Error('Confirmez que vous avez l’autorisation de cloner cette voix');
  const form=new FormData();form.set('name',name);form.set('remove_background_noise','false');let total=0;
  for(const id of [...new Set(input.sampleIds)]){
   const asset=await context.getAsset(required(id,'Sample ID',80));if(asset.type!=='audio')throw Error('Les échantillons de voix doivent être des fichiers audio');if(!asset.file)throw Error('Échantillon audio indisponible');
   if(!context.readFile&&(await stat(asset.file)).size>MAX_BYTES)throw Error('Les échantillons de voix doivent faire 20 Mo au total maximum');
   const bytes=Buffer.from(await(context.readFile||localReadFile)(asset.file));total+=bytes.length;if(!bytes.length||total>MAX_BYTES)throw Error('Les échantillons de voix doivent faire entre 1 octet et 20 Mo au total');
   const ext=path.extname(asset.file).toLowerCase(),mime=({'.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.webm':'audio/webm'}[ext]||'audio/mpeg');
   form.append('files',new Blob([bytes],{type:mime}),`sample-${form.getAll('files').length+1}${ext||'.mp3'}`);
  }
  const data=await(await call('/v1/voices/add',key,{method:'POST',body:form},fetchImpl)).json();if(typeof data.voice_id!=='string'||!data.voice_id)throw Error('Le service vocal n’a renvoyé aucune voix clonée');return {voice:{id:data.voice_id,name,category:'cloned',requiresVerification:!!data.requires_verification}};
 }
 if(action==='synthesize'){
  const id=required(input.voiceId,'Voice ID',100);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Identifiant de voix invalide');
  const response=await call(`/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`,key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:required(input.text,'Script',5000),model_id:'eleven_multilingual_v2'})},fetchImpl);
  const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw Error('Le service vocal n’a renvoyé aucun audio');return {base64:bytes.toString('base64'),mime:'audio/mpeg',filename:'custom-voiceover.mp3',disclosure:'AI-generated voice'};
 }
 throw Error('Outil vocal inconnu');
}
