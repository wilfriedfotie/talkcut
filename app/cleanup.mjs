const normalize=text=>String(text).toLowerCase().replace(/[^\p{L}\p{N}']/gu,'');
// Hesitation sounds (EN + FR). Pure interjections, safe to always cut.
const FILLER=/^(um+|uh+|erm+|hmm+|ah+|euh+|heu+|euh+|ben|bah|hein|bof)$/;
// Multi-word FR/EN discourse fillers, only cut when standing alone as a unit.
const FILLER_PHRASE=new Set(['du coup','en fait','tu vois','genre','voila','voilà','quoi','you know','i mean','like']);
// Words allowed to repeat for emphasis: never treated as a short-repeat stutter.
const EMPHASIS=new Set(['tres','très','non','oui','si','no','yes','very','so','bien']);
export function cleanupPlan(composition,action,options={}){
 const words=composition.words||[],live=words.filter(w=>!w.deleted),removed=[],changes=[];
 const minGap=Number.isFinite(options.minGap)?Math.max(.24,options.minGap):.7;
 if(action==='fillers')for(let i=0;i<live.length;i++){const w=live[i],one=normalize(w.text),two=i+1<live.length?one+' '+normalize(live[i+1].text):null;
  if(two&&FILLER_PHRASE.has(two)){removed.push({id:w.id,text:w.text,start:w.start,end:w.end},{id:live[i+1].id,text:live[i+1].text,start:live[i+1].start,end:live[i+1].end});i++;}
  else if(FILLER.test(one)||FILLER_PHRASE.has(one))removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}
 if(action==='gaps')for(let i=0;i<live.length-1;i++){const a=live[i],b=live[i+1];if(a.assetId!==b.assetId)continue;const gap=b.start-a.end;if(gap>minGap&&(a.cutEnd??a.end)-(a.end)>.120001&&(b.start-(b.cutStart??b.start))>.120001){changes.push({id:a.id,cutEnd:a.end+.12},{id:b.id,cutStart:b.start-.12});removed.push({text:'Pause',start:a.end+.12,end:b.start-.12});}}
 // Conservative adjacent repeated phrases: retain the later take, never match across sources/speakers.
 if(action==='retakes'){const cut=new Set();for(let i=0;i<live.length;i++){for(let n=Math.min(16,Math.floor((live.length-i)/2));n>=3;n--){const first=live.slice(i,i+n),second=live.slice(i+n,i+2*n);if(first.some(w=>cut.has(w.id))||first[0].assetId!==second.at(-1).assetId||first[0].speaker!==second.at(-1).speaker||second[0].start-first.at(-1).end>3||second[0].start<first.at(-1).end)continue;if(first.every((w,k)=>normalize(w.text)&&normalize(w.text)===normalize(second[k].text))){for(const w of first){cut.add(w.id);removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}i+=n-1;break;}}}
  // Short stutters: a word (or 2-word unit) immediately repeated, e.g. "je je", "c'est c'est". Keep the later copy; skip emphasis words.
  for(let i=0;i<live.length;i++){if(cut.has(live[i].id))continue;for(let n=2;n>=1;n--){const first=live.slice(i,i+n),second=live.slice(i+n,i+2*n);if(second.length<n)continue;if(first.some(w=>cut.has(w.id))||first[0].assetId!==second.at(-1).assetId||first[0].speaker!==second.at(-1).speaker||second[0].start-first.at(-1).end>1.2||second[0].start<first.at(-1).end)continue;if(n===1&&EMPHASIS.has(normalize(first[0].text)))continue;if(first.every((w,k)=>normalize(w.text)&&normalize(w.text)===normalize(second[k].text))){for(const w of first){cut.add(w.id);removed.push({id:w.id,text:w.text,start:w.start,end:w.end});}i+=n-1;break;}}}}
 if(!['fillers','gaps','retakes'].includes(action))throw Error('Unknown local cleanup action');
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
