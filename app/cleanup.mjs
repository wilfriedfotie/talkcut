const normalize=text=>String(text).toLowerCase().replace(/[^\p{L}\p{N}']/gu,'');
// Hesitation sounds (EN + FR). Pure interjections, safe to always cut.
const FILLER=/^(u+m+|u+h+|e+r+m+|h+m+|m+h+|hum+|a+h+|e+u+h+|h+e+u+h*|eh+|beh|ben|bah|boh|hein|bof|pff+|tsk)$/;
// Multi-word FR/EN discourse fillers, only cut when standing alone as a unit.
const FILLER_PHRASE=new Set([
 'du coup','en fait','en gros','genre','voila','voilà','quoi','disons',
 'tu vois','tu sais','vous voyez','vous savez','tu vois quoi','enfin bref','bon ben','ben voilà','ben voila','voilà quoi','voila quoi',
 'on va dire','comment dire','tu vois ce que je veux dire',
 'you know','i mean','like','you see','basically','you know what i mean']);
const PHRASE_MAX=Math.max(...[...FILLER_PHRASE].map(p=>p.split(' ').length));
// Words allowed to repeat for emphasis: never treated as a short-repeat stutter.
const EMPHASIS=new Set(['tres','très','non','oui','si','no','yes','very','so','bien']);
export function cleanupPlan(composition,action,options={}){
 const words=composition.words||[],live=words.filter(w=>!w.deleted),removed=[],changes=[];
 const minGap=Number.isFinite(options.minGap)?Math.max(.24,options.minGap):.7;
 if(action==='fillers')for(let i=0;i<live.length;i++){const w=live[i],one=normalize(w.text);
  // Longest phrase match first so 'tu vois quoi' wins over 'tu vois'.
  let n=0;for(let k=Math.min(PHRASE_MAX,live.length-i);k>=2&&!n;k--)if(FILLER_PHRASE.has(live.slice(i,i+k).map(x=>normalize(x.text)).join(' ')))n=k;
  if(n){for(const x of live.slice(i,i+n))removed.push({id:x.id,text:x.text,start:x.start,end:x.end});i+=n-1;}
  else if(FILLER.test(one)||FILLER_PHRASE.has(one))removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}
 if(action==='gaps'){
  // Prefer real audio-detected silences when provided (whisper word gaps are near-zero).
  const audioSilences=Array.isArray(options.silences)?options.silences:null;
  if(audioSilences){const pad=.1;const byId=new Map();
   for(const sil of audioSilences){if(!(sil.end-sil.start>minGap))continue;
    const s=sil.start+pad,e=sil.end-pad;if(e<=s)continue;
    // Whisper words can swallow a silence inside their span. Cut the silence off the
    // nearest boundary of whichever word overlaps it, keeping speech on both sides.
    const host=live.find(w=>w.start<e&&w.end>s);
    if(host){const cs=byId.get(host.id)?.cutStart??host.cutStart??host.start,ce=byId.get(host.id)?.cutEnd??host.cutEnd??host.end;
     // trim from the side where the silence sits (closer to start -> raise cutStart, else lower cutEnd)
     if(e-cs<ce-s){const ns=Math.min(ce,Math.max(cs,e));if(ns-cs>.05){byId.set(host.id,{id:host.id,cutStart:ns,cutEnd:ce});removed.push({text:'Silence',start:s,end:e});}}
     else{const ne=Math.max(cs,Math.min(ce,s));if(ce-ne>.05){byId.set(host.id,{id:host.id,cutStart:cs,cutEnd:ne});removed.push({text:'Silence',start:s,end:e});}}
    }
   }
   for(const c of byId.values())changes.push(c);
  }
  else for(let i=0;i<live.length-1;i++){const a=live[i],b=live[i+1];if(a.assetId!==b.assetId)continue;const gap=b.start-a.end;if(gap>minGap&&(a.cutEnd??a.end)-(a.end)>.120001&&(b.start-(b.cutStart??b.start))>.120001){changes.push({id:a.id,cutEnd:a.end+.12},{id:b.id,cutStart:b.start-.12});removed.push({text:'Pause',start:a.end+.12,end:b.start-.12});}}
 }
 // Conservative adjacent repeated phrases: retain the later take, never match across sources/speakers.
 if(action==='retakes'){const cut=new Set();for(let i=0;i<live.length;i++){for(let n=Math.min(16,Math.floor((live.length-i)/2));n>=3;n--){const first=live.slice(i,i+n),second=live.slice(i+n,i+2*n);if(first.some(w=>cut.has(w.id))||first[0].assetId!==second.at(-1).assetId||first[0].speaker!==second.at(-1).speaker||second[0].start-first.at(-1).end>3||second[0].start<first.at(-1).end)continue;if(first.every((w,k)=>normalize(w.text)&&normalize(w.text)===normalize(second[k].text))){for(const w of first){cut.add(w.id);removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}i+=n-1;break;}}}
  // Short stutters: a word (or 2-word unit) immediately repeated, e.g. "je je", "c'est c'est". Keep the later copy; skip emphasis words.
  for(let i=0;i<live.length;i++){if(cut.has(live[i].id))continue;for(let n=2;n>=1;n--){const first=live.slice(i,i+n),second=live.slice(i+n,i+2*n);if(second.length<n)continue;if(first.some(w=>cut.has(w.id))||first[0].assetId!==second.at(-1).assetId||first[0].speaker!==second.at(-1).speaker||second[0].start-first.at(-1).end>1.2||second[0].start<first.at(-1).end)continue;if(n===1&&EMPHASIS.has(normalize(first[0].text)))continue;if(first.every((w,k)=>normalize(w.text)&&normalize(w.text)===normalize(second[k].text))){for(const w of first){cut.add(w.id);removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}i+=n-1;break;}}}}
 if(!['fillers','gaps','retakes'].includes(action))throw Error('Action de nettoyage inconnue');
 return {action,removed,deleteIds:removed.filter(r=>r.id).map(r=>r.id),changes,secondsRemoved:removed.reduce((sum,r)=>sum+Math.max(0,r.end-r.start),0)};
}
export function cleanupPreview(composition,actions=[],options={}){
 const draft=structuredClone(composition),removed=[],summary={fillers:0,silenceSeconds:0,retakes:0},initial=new Map(draft.words.map(w=>[w.id,{...w}]));
 const retained=()=>draft.words.filter(w=>!w.deleted).reduce((n,w)=>n+Math.max(0,(w.cutEnd??w.end)-(w.cutStart??w.start)),0);
 for(const action of ['retakes','fillers','gaps'].filter(a=>actions.includes(a))){
  const before=retained(),plan=cleanupPlan(draft,action,options);
  if(action==='retakes'){let last=-2;for(const r of plan.removed){const index=draft.words.findIndex(w=>w.id===r.id);if(index!==last+1)summary.retakes++;last=index;}}
  if(action==='fillers')summary.fillers=plan.removed.length;
  for(const w of draft.words){if(plan.deleteIds.includes(w.id))w.deleted=true;for(const patch of plan.changes.filter(p=>p.id===w.id))Object.assign(w,patch);}
  if(action==='gaps')summary.silenceSeconds=Math.max(0,before-retained());removed.push(...plan.removed.map(r=>({...r,kind:action})));
 }
 const deleteIds=draft.words.filter(w=>w.deleted&&!initial.get(w.id).deleted).map(w=>w.id),changes=draft.words.filter(w=>w.cutStart!==initial.get(w.id).cutStart||w.cutEnd!==initial.get(w.id).cutEnd).map(w=>({id:w.id,cutStart:w.cutStart,cutEnd:w.cutEnd}));
 return {deleteIds,changes,removed,summary};
}
