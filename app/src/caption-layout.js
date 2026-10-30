// Caption layout shared by the preview (DOM) and the export (libass), so both draw the same thing:
// same size relative to the frame, same line breaks, same box, same word positions.
// Everything is computed in frame pixels; text widths come from the browser (canvas measureText)
// and are sent with the export, since the server cannot measure text itself.

// asc/desc: hhea metrics (what the browser uses to place text in a line box).
// winAsc/winDesc: OS/2 win metrics (what libass treats as the font size and line top).
export const CAPTION_FACES={
 arial:{css:'Arial, Helvetica, sans-serif',ass:'Arial',bold:true,asc:.905,desc:.212,winAsc:.905,winDesc:.212},
 dm:{css:"'DM Sans', sans-serif",ass:'DM Sans Caption',file:'DMSans-Caption.ttf',asc:.992,desc:.31,winAsc:1.012,winDesc:.31},
 clash:{css:"'Clash Display', sans-serif",ass:'Clash Display Semibold',file:'ClashDisplay-Semibold.ttf',asc:.89,desc:.25,winAsc:.89,winDesc:.25}
};
export const CAPTION_WEIGHT=600;
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v:null;
const num=(v,a,b,f)=>Number.isFinite(Number(v))?Math.max(a,Math.min(b,Number(v))):f;

// Mashup: a word is a "keyword" (Clash Display) when it is long enough to carry meaning or written in capitals.
export const isKeyword=w=>{const t=w.trim().replace(/[^\p{L}\p{N}']/gu,'');return t.length>=6||(t.length>=2&&t===t.toUpperCase()&&/\p{L}/u.test(t));};
export function captionFaces(comp){
 const f=comp.captionFont;
 return f==='mashup'?{base:'dm',key:'clash'}:f==='dm-sans'?{base:'dm',key:null}:f==='clash-display'?{base:'clash',key:null}:{base:'arial',key:null};
}
// Words of a cue, already cased as they are drawn, each with the face it is drawn in.
export function captionWords(cue,comp){
 const {base,key}=captionFaces(comp),upper=comp.captionStyle==='bold';
 const src=cue.words?.length?cue.words:String(cue.text||'').split(/\s+/).filter(Boolean).map(text=>({text}));
 return src.map(w=>{const text=upper?String(w.text).toUpperCase():String(w.text);return {text,face:key&&isKeyword(text)?key:base,start:w.start,end:w.end};}).filter(w=>w.text.trim());
}
// Style in frame pixels. Size follows the frame's short side, so a 9:16 short and a 16:9 video read alike.
export function captionStyle(comp,W,H){
 const kind=comp.captionStyle==='bold'?'bold':comp.captionStyle==='highlight'?'highlight':'classic';
 const fontPx=Math.min(W,H)*(kind==='bold'?.056:.045)*num(comp.captionSize,.6,2,1);
 const bg=comp.captionBg===''?null:hex(comp.captionBg)||(kind==='highlight'?'#d8f0b9':'#101017');
 const bgAlpha=comp.captionBg===undefined&&kind!=='highlight'?.75:1;
 const width=num(comp.captionWidth,.3,1,.92)*W;
 return {kind,fontPx,lineH:fontPx*1.35,padX:fontPx*.55,padY:fontPx*.22,radius:fontPx*.32,
  color:hex(comp.captionColor)||(kind==='highlight'?'#27301e':'#ffffff'),bg,bgAlpha,outline:bg?0:fontPx*.06,
  maxTextW:Math.max(fontPx,width-fontPx*1.1),centerX:W/2,bottom:num(comp.captionY,.5,.95,.88)*H,
  hi:comp.wordHighlight?{color:hex(comp.wordHighlightColor)||'#7967ff',padX:num(comp.wordHighlightPadX,0,.8,.25)*fontPx,padY:num(comp.wordHighlightPadY,0,.6,.1)*fontPx,radius:fontPx*.2}:null};
}
// measure(text,face) -> width in em. Greedy wrap like the browser; returns boxes in frame pixels.
export function layoutCaption(cue,comp,W,H,measure){
 const s=captionStyle(comp,W,H),words=captionWords(cue,comp),{base}=captionFaces(comp),space=measure(' ',base)*s.fontPx;
 const lines=[];let line=null;
 for(const [index,w] of words.entries()){
  const width=measure(w.text,w.face)*s.fontPx;
  if(line&&line.width+space+width<=s.maxTextW+.5){line.words.push({...w,index,x:line.width+space,width});line.width+=space+width;}
  else{line={words:[{...w,index,x:0,width}],width};lines.push(line);}
 }
 const boxW=Math.max(0,...lines.map(l=>l.width))+2*s.padX,boxH=lines.length*s.lineH+2*s.padY;
 const box={x:s.centerX-boxW/2,y:s.bottom-boxH,w:boxW,h:boxH,r:Math.min(s.radius,boxH/2)};
 const A=CAPTION_FACES[base].asc,D=CAPTION_FACES[base].desc;
 lines.forEach((l,i)=>{l.top=box.y+s.padY+i*s.lineH;l.baseline=l.top+(s.lineH-(A+D)*s.fontPx)/2+A*s.fontPx;l.x=s.centerX-l.width/2;for(const w of l.words)w.x+=l.x;});
 return {style:s,box,lines,words:lines.flatMap(l=>l.words.map(w=>({...w,baseline:l.baseline})))};
}
// Background of a highlighted word: the word's content area plus padding, as the browser paints a span background.
export function wordHighlightBox(w,s){
 const f=CAPTION_FACES[w.face],h=(f.asc+f.desc)*s.fontPx+2*s.hi.padY,width=w.width+2*s.hi.padX;
 return {x:w.x-s.hi.padX,y:w.baseline-f.asc*s.fontPx-s.hi.padY,w:width,h,r:Math.min(s.hi.radius,h/2,width/2)};
}
// Em widths of every word of the cues, measured by the browser, for the export.
export function measureCaptionWords(cues,comp,measure){
 const {base}=captionFaces(comp),out={[base]:{' ':measure(' ',base)}};
 for(const c of cues)for(const w of captionWords(c,comp)){(out[w.face]??={})[w.text]??=measure(w.text,w.face);}
 return out;
}
// Browser-only: em width of a text drawn in a caption face.
export function canvasMeasure(){
 const ctx=document.createElement('canvas').getContext('2d'),cache=new Map();
 return (text,face)=>{const k=face+'\u0000'+text;if(!cache.has(k)){ctx.font=`${CAPTION_WEIGHT} 100px ${CAPTION_FACES[face].css}`;cache.set(k,ctx.measureText(text).width/100);}return cache.get(k);};
}
// Browser-only: resolves once every caption face can be measured (fallback widths otherwise).
export function loadCaptionFonts(){
 return Promise.all(Object.values(CAPTION_FACES).map(f=>document.fonts.load(`${CAPTION_WEIGHT} 100px ${f.css}`).catch(()=>[])));
}
