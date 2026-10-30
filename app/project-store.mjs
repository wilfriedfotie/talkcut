import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
function checkId(id){if(!validId(id))throw Error('Identifiant de projet invalide');}
export function validateProject(p){
 checkId(p?.id);if(typeof p.name!=='string'||p.name.length>300)throw Error('Le nom du projet doit faire 300 caractères au maximum');
 if(!Array.isArray(p.compositions)||!p.compositions.length||p.compositions.length>100)throw Error('Un projet doit contenir de 1 à 100 compositions');
 for(const c of p.compositions){if(!validId(c.id)||typeof c.name!=='string'||!Array.isArray(c.words)||!Array.isArray(c.assetIds))throw Error('Composition invalide');if(c.words.length>100000||(c.layers?.length||0)>100)throw Error('Composition trop volumineuse');for(const w of c.words){if(!validId(w.id)||!validId(w.assetId)||typeof w.text!=='string'||w.text.length>3000||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<w.start)throw Error('Mot ou minutage de transcription invalide');}}
 return p;
}
export function createProjectStore(data){
 let pending=Promise.resolve();
 const file=(folder,id)=>{checkId(id);return path.join(data,folder,`${id}.json`);};
 const read=async(filename,fallback)=>{try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
 const atomic=async(filename,value)=>{await fs.mkdir(path.dirname(filename),{recursive:true});const temp=filename+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,filename);};
 const serial=fn=>{const result=pending.catch(()=>{}).then(fn);pending=result;return result;};
 const save=(project,{expectedRevision}={})=>serial(async()=>{
  validateProject(project);const filename=file('projects',project.id),previous=await read(filename,null),copy=structuredClone(project);
  const digest=p=>{const {updatedAt,revision,...content}=p;return createHash('sha256').update(JSON.stringify(content)).digest('hex');};
  if(previous&&digest(copy)===digest(previous)){const historyFile=file('history',project.id);const existing=await read(historyFile,[]);if(!existing.length)await atomic(historyFile,[{id:randomUUID(),revision:previous.revision||1,createdAt:previous.updatedAt||new Date().toISOString(),name:previous.name,project:previous}]);return previous;}
  if(expectedRevision!==undefined&&expectedRevision!==(previous?.revision||0)){const error=Error('Ce projet a été modifié dans une autre session. Chargez la dernière version avant de l’écraser.');error.status=409;error.currentRevision=previous?.revision||0;throw error;}
  copy.updatedAt=new Date().toISOString();copy.revision=(previous?.revision||0)+1;
  const historyFile=file('history',project.id);const history=await read(historyFile,[]);
  history.unshift({id:randomUUID(),revision:copy.revision,createdAt:copy.updatedAt,name:copy.name,project:copy});
  await atomic(historyFile,history.slice(0,50));await atomic(filename,copy);return copy;
 });
 const list=async()=>{await fs.mkdir(path.join(data,'projects'),{recursive:true});const projects=[];for(const name of await fs.readdir(path.join(data,'projects'))){if(!name.endsWith('.json'))continue;const p=await read(path.join(data,'projects',name),null);if(p)projects.push(p);}return projects.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));};
 const history=async id=>(await read(file('history',id),[])).map(({project,...v})=>v);
 const version=async(id,versionId)=>{checkId(versionId);const item=(await read(file('history',id),[])).find(v=>v.id===versionId);if(!item)throw Error('Version introuvable');return item.project;};
 const comments=async id=>await read(file('comments',id),[]);
 const addComment=(id,input)=>serial(async()=>{const project=await read(file('projects',id),null);if(!project)throw Error('Projet introuvable');if(typeof input.text!=='string'||!input.text.trim()||input.text.length>5000)throw Error('Écrivez un commentaire de 1 à 5000 caractères');if(!project.compositions.some(c=>c.id===input.compositionId))throw Error('Composition introuvable');const all=await comments(id);const comment={id:randomUUID(),compositionId:input.compositionId,text:input.text.trim(),time:Math.max(0,Math.min(86400,Number(input.time)||0)),author:String(input.author||'You').slice(0,60),createdAt:new Date().toISOString(),resolved:false};all.push(comment);await atomic(file('comments',id),all);return comment;});
 const resolveComment=(id,commentId,resolved)=>serial(async()=>{checkId(commentId);const all=await comments(id);const c=all.find(c=>c.id===commentId);if(!c)throw Error('Commentaire introuvable');c.resolved=!!resolved;await atomic(file('comments',id),all);return c;});
 const kits=()=>read(path.join(data,'brand-kits.json'),[]);
 const saveKit=input=>serial(async()=>{if(!/^#[a-f0-9]{6}$/i.test(input.color||''))throw Error('Choisissez une couleur de marque valide');const all=await kits();const kit={id:randomUUID(),name:String(input.name||'My brand').slice(0,100),color:input.color,background:/^#[a-f0-9]{6}$/i.test(input.background||'')?input.background:'#161b23',titleColor:/^#[a-f0-9]{6}$/i.test(input.titleColor||'')?input.titleColor:'#ffffff',createdAt:new Date().toISOString()};all.push(kit);await atomic(path.join(data,'brand-kits.json'),all);return kit;});
 const templates=()=>read(path.join(data,'templates.json'),[]);
 const saveTemplate=input=>serial(async()=>{if(!input.composition)throw Error('Choisissez une composition');const c=input.composition;const template={id:randomUUID(),name:String(input.name||c.name||'Untitled template').slice(0,100),createdAt:new Date().toISOString(),style:Object.fromEntries(['aspect','background','captions','captionStyle','titlePosition','titleColor','brand','fadeIn','fadeOut'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]))};const all=await templates();all.push(template);await atomic(path.join(data,'templates.json'),all);return template;});
 // Deletes the project with its version history and comments; media cleanup is the caller's job.
 const remove=id=>serial(async()=>{const project=await read(file('projects',id),null);if(!project)throw Error('Projet introuvable');for(const folder of ['projects','history','comments'])await fs.rm(file(folder,id),{force:true});return project;});
 return {save,list,history,version,comments,addComment,resolveComment,kits,saveKit,templates,saveTemplate,remove};
}
