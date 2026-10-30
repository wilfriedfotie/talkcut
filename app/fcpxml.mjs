import {pathToFileURL} from 'node:url';
import {intervals,subtitles} from './src/model.js';
import {captionFaces,layoutCaption} from './src/caption-layout.js';

// FCPXML 1.9 timeline for DaVinci Resolve (File > Import > Timeline). Every edit OziCut made
// (deleted words, fillers, silences, retakes, trim) becomes a real cut on the original media.
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// "30000/1001" -> {num:30000,den:1001}; rejects VFR placeholders like 90000/1.
export function parseRate(r){const [n,d]=String(r||'').split('/').map(Number);const fps=n/(d||1);return Number.isFinite(fps)&&fps>=10&&fps<=120?{num:n,den:d||1}:null;}
export function sequenceSize(aspect){return aspect==='9:16'?[1080,1920]:aspect==='1:1'?[1080,1080]:aspect==='4:5'?[1080,1350]:[1920,1080];}

// Captions become editable Resolve titles drawn from the same layout as the preview and the MP4 burn-in
// (src/caption-layout.js): same size, line breaks, faces and colours. Resolve reads adjust-transform position
// as % of frame height from the centre, and never wraps titles itself, so lines are broken explicitly.
const TITLE_FONTS={arial:['Arial','Bold'],dm:['DM Sans Caption','Regular'],clash:['Clash Display','Semibold']};
const rgba=(hex,a=1)=>[0,2,4].map(i=>(parseInt(hex.slice(1+i,3+i),16)/255).toFixed(3)).join(' ')+' '+a;
// Font files a Resolve import needs installed (the same files the burn-in uses).
export function captionFontFaces(comp){const {base,key}=captionFaces(comp);return [base,key].filter(f=>f&&f!=='arial');}
export function captionTitles(comp,cues,[w,h],metrics){
 const measure=(text,face)=>{const v=Number(metrics?.[face]?.[text]);return Number.isFinite(v)&&v>=0&&v<50?v:text===' '?.28:text.length*.56;};
 return cues.map((c,i)=>{
  const L=layoutCaption(c,comp,w,h,measure),s=L.style;if(!L.words.length)return null;
  const look=s.bg?` backgroundColor="${rgba(s.bg,s.bgAlpha)}"`:s.outline?` strokeColor="0 0 0 1" strokeWidth="${s.outline.toFixed(1)}"`:'';
  const faces=[...new Set(L.words.map(x=>x.face))],def=f=>`<text-style-def id="c${i}${f}"><text-style font="${TITLE_FONTS[f][0]}" fontSize="${Math.round(s.fontPx)}" fontFace="${TITLE_FONTS[f][1]}" fontColor="${rgba(s.color)}"${look} alignment="center"/></text-style-def>`;
  const runs=[];L.lines.forEach((l,n)=>l.words.forEach((x,k)=>{const text=(k?' ':n?'\n':'')+x.text,prev=runs.at(-1);if(prev&&prev.face===x.face)prev.text+=text;else runs.push({face:x.face,text});}));
  const y=(.5-(L.box.y+L.box.h/2)/h)*100;
  return {start:c.start,end:c.end,name:c.text,body:`<text>${runs.map(r=>`<text-style ref="c${i}${r.face}">${esc(r.text)}</text-style>`).join('')}</text>${faces.map(def).join('')}<adjust-transform position="0 ${y.toFixed(2)}"/>`};
 }).filter(Boolean);
}

export function buildFcpxml(comp,assets,{rates={},maxMarkerText=80,captionMetrics}={}){
 const segments=intervals(comp,assets);if(!segments.length)throw Error('Rien à exporter : toute la composition est coupée');
 const byId=new Map(assets.map(a=>[a.id,a]));
 const firstVideo=segments.map(s=>byId.get(s.assetId)).find(a=>a?.type==='video');
 const rate=(firstVideo&&rates[firstVideo.id])||{num:25,den:1};
 // Everything is snapped to whole timeline frames so offsets never drift.
 const frames=t=>Math.round(t*rate.num/rate.den),time=f=>f===0?'0s':`${f*rate.den}/${rate.num}s`;
 const [w,h]=sequenceSize(comp.aspect);
 const used=[...new Set(segments.map(s=>s.assetId))].map(id=>{const a=byId.get(id);if(!a)throw Error('Fichier média introuvable');return a;});
 const res=[`<format id="r0" name="OziCut ${w}x${h}" frameDuration="${time(1)}" width="${w}" height="${h}"/>`];
 const ref=new Map();used.forEach((a,i)=>{const fid=`f${i+1}`,aid=`r${i+1}`;ref.set(a.id,{aid,fid});const ar=rates[a.id]||rate;
  if(a.type!=='audio')res.push(`<format id="${fid}" frameDuration="${ar.den}/${ar.num}s" width="${a.width||w}" height="${a.height||h}"/>`);
  res.push(`<asset id="${aid}" name="${esc(a.name)}" start="0s" duration="${time(frames(a.duration))}" hasVideo="${a.type==='audio'?0:1}" hasAudio="${a.hasAudio===false?0:1}"${a.type==='audio'?'':` format="${fid}"`} audioSources="1" audioChannels="2" audioRate="48000"><media-rep kind="original-media" src="${esc(pathToFileURL(a.file).href)}"/></asset>`);});
 const vol=Number(comp.volume),gain=Number.isFinite(vol)&&vol>0&&Math.abs(vol-1)>.001?`<adjust-volume amount="${(20*Math.log10(vol)).toFixed(2)}dB"/>`:'';
 const zoom=Number(comp.zoom),scale=Number.isFinite(zoom)&&zoom>0&&Math.abs(zoom-1)>.001?`<adjust-transform scale="${zoom} ${zoom}"/>`:'';
 const titles=comp.captions?captionTitles(comp,subtitles(comp,segments),[w,h],captionMetrics):[];
 if(titles.length)res.push('<effect id="e0" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>');
 const deleted=(comp.words||[]).filter(w=>w.deleted);
 let offset=0;const clips=segments.map((s,i)=>{const a=byId.get(s.assetId),r=ref.get(s.assetId),start=frames(s.start),dur=Math.max(1,frames(s.end)-start);
  // Marker on the first frame of each clip that follows a cut, naming what was removed.
  const prev=segments[i-1];let marker='';
  if(prev&&prev.assetId===s.assetId&&s.start>prev.end+.01){const gone=deleted.filter(w=>w.assetId===s.assetId&&w.start>=prev.end-.01&&w.end<=s.start+.01).map(w=>w.text.trim()).filter(Boolean).join(' ');
   const label=gone?`Coupé : ${gone.length>maxMarkerText?gone.slice(0,maxMarkerText-1)+'…':gone}`:`Silence coupé · ${(s.start-prev.end).toFixed(1).replace('.',',')} s`;marker=`<marker start="${time(start)}" duration="${time(1)}" value="${esc(label)}"/>`;}
  // Each caption hangs off the clip it starts in, so it follows that clip when the edit changes in Resolve.
  const own=titles.filter(t=>{const f=frames(t.start);return f>=offset&&(f<offset+dur||i===segments.length-1);}).map(t=>{const f=frames(t.start);
   return `<title ref="e0" lane="1" name="${esc(t.name.slice(0,60))}" offset="${time(start+f-offset)}" start="0s" duration="${time(Math.max(1,frames(t.end)-f))}">${t.body}</title>`;}).join('');
  const clip=`<asset-clip ref="${r.aid}" name="${esc(a.name)}" offset="${time(offset)}" start="${time(start)}" duration="${time(dur)}"${a.type==='audio'?'':` format="${r.fid}"`} tcFormat="NDF">${scale}${gain}${own}${marker}</asset-clip>`;
  offset+=dur;return clip;});
 return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
 <resources>
  ${res.join('\n  ')}
 </resources>
 <library>
  <event name="OziCut">
   <project name="${esc(comp.name||'OziCut')}">
    <sequence format="r0" duration="${time(offset)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
     <spine>
      ${clips.join('\n      ')}
     </spine>
    </sequence>
   </project>
  </event>
 </library>
</fcpxml>
`;
}
