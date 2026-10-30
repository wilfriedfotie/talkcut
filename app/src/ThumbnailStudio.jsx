import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Brush,Check,Download,Droplets,Eraser,Eye,ImageUp,Lightbulb,Smile,Loader2,Sparkles,Star,Undo2,Wand2} from 'lucide-react';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import './thumbnail-studio.css';

// Thumbnail studio: picks the best frames of the edit (sharpness + face), cuts the speaker out locally with
// MediaPipe, and composes a 1280x720 (or 1080x1920) image with the caption fonts and highlight colours.
const W=1280,H=720,FRAME_COUNT=12;
const MODELS={face:'/mediapipe/models/blaze_face_short_range.tflite',segment:'/mediapipe/models/selfie_multiclass_256x256.tflite'};
export const THUMB_DEFAULTS={filter:'none',fBright:1,fContrast:1,fSat:1,sharpen:0,clarity:0,vignette:0,grade:'none',strokes:[],cutout:true,background:'blur',bgColor:'#7967ff',dim:.35,outline:'#ffffff',outlineWidth:8,glow:0,subjectX:.7,subjectY:.55,subjectScale:1.05,textBehind:false,text:'',font:'clash-display',textColor:'#ffffff',highlightIndex:-1,highlightMode:'box',highlightColor:'#7967ff',textSize:.15,textX:.3,textY:.5,textWidth:.52,uppercase:true,align:'left'};
const VERTICAL={subjectX:.5,subjectY:.66,subjectScale:.62,textX:.5,textY:.2,textWidth:.88,textSize:.075,align:'center'};
const PALETTE=[['#7967FF','Violet'],['#FDE047','Jaune'],['#D8F0B9','Vert'],['#F4E2D2','Crème'],['#FF4D4D','Rouge'],['#0A0A0F','Encre']];
// Thumbnail-maker looks: global tone (brightness/contrast/saturation), sharpness and clarity (local contrast,
// the "HDR" look) on the person, a colour grade, and a vignette. The person and the background are graded apart.
export const FILTERS={
 none:{label:'Aucun',fBright:1,fContrast:1,fSat:1,sharpen:0,clarity:0,vignette:0,grade:'none'},
 pop:{label:'Punchy',fBright:1.05,fContrast:1.15,fSat:1.25,sharpen:.6,clarity:.35,vignette:.25,grade:'none'},
 hdr:{label:'HDR',fBright:1.04,fContrast:1.1,fSat:1.25,sharpen:.8,clarity:.9,vignette:.3,grade:'none'},
 cinema:{label:'Ciné',fBright:1,fContrast:1.12,fSat:1.1,sharpen:.4,clarity:.4,vignette:.4,grade:'tealorange'},
 warm:{label:'Chaud',fBright:1.04,fContrast:1.06,fSat:1.15,sharpen:.4,clarity:.2,vignette:.2,grade:'warm'},
 cool:{label:'Froid',fBright:1.02,fContrast:1.08,fSat:1.05,sharpen:.4,clarity:.2,vignette:.25,grade:'cool'},
 drama:{label:'Drama',fBright:.96,fContrast:1.3,fSat:.85,sharpen:.6,clarity:.7,vignette:.55,grade:'none'},
 colorpop:{label:'Color pop',fBright:1.04,fContrast:1.1,fSat:1.15,sharpen:.5,clarity:.3,vignette:.3,grade:'colorpop'}};
const FILTER_KEYS=['fBright','fContrast','fSat','sharpen','clarity','vignette','grade'];
const GRADES={warm:{bg:['#ff9a3c',.3],subject:['#ffb070',.22]},cool:{bg:['#3c9dff',.3],subject:['#7fb8ff',.18]},tealorange:{bg:['#0f8c8c',.45],subject:['#ff8a3c',.28]}};
// One look per concept: bust on the right with a blurred room, a colour poster with a glow, a centred close-up.
const CONCEPT_STYLES=[
 {...FILTERS.pop,filter:'pop',background:'blur',dim:.35,highlightMode:'box',highlightColor:'#7967ff',textColor:'#ffffff',textX:.3,textY:.5,textWidth:.52,textSize:.15,align:'left',subjectX:.7,subjectY:.55,subjectScale:1.05,outline:'#ffffff',outlineWidth:8,glow:0},
 {...FILTERS.hdr,filter:'hdr',background:'color',bgColor:'#7967ff',highlightMode:'color',highlightColor:'#FDE047',textColor:'#ffffff',textX:.31,textY:.45,textWidth:.56,textSize:.17,align:'left',subjectX:.73,subjectY:.55,subjectScale:1.1,outline:'#FDE047',outlineWidth:10,glow:.35},
 {...FILTERS.cinema,filter:'cinema',background:'frame',dim:.45,highlightMode:'box',highlightColor:'#FF4D4D',textColor:'#ffffff',textX:.5,textY:.8,textWidth:.9,textSize:.13,align:'center',subjectX:.5,subjectY:.5,subjectScale:1.15,outline:'#ffffff',outlineWidth:0,glow:0}];
const FONTS={'clash-display':"600 {px}px 'Clash Display',sans-serif",'dm-sans':"700 {px}px 'DM Sans',sans-serif"};

let visionPromise=null;
function vision(){
 // Wasm files are bundled by Vite (no CDN), so the analysis works offline.
 visionPromise||=(async()=>{const fileset={wasmLoaderPath,wasmBinaryPath},{FaceDetector,ImageSegmenter}=await import('@mediapipe/tasks-vision');
  const [face,segmenter]=await Promise.all([
   FaceDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:MODELS.face},runningMode:'IMAGE',minDetectionConfidence:.5}).catch(()=>null),
   ImageSegmenter.createFromOptions(fileset,{baseOptions:{modelAssetPath:MODELS.segment},runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false}).catch(()=>null)]);
  return {face,segmenter};})();
 return visionPromise;
}

const canvasOf=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const seekTo=(video,t)=>new Promise((resolve,reject)=>{const done=()=>{video.removeEventListener('seeked',done);resolve();};video.addEventListener('seeked',done);video.addEventListener('error',()=>reject(Error('Lecture de la vidéo impossible')),{once:true});video.currentTime=t;});
async function openVideo(url){const v=document.createElement('video');v.muted=true;v.preload='auto';v.playsInline=true;v.src=url;
 await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('Vidéo illisible pour l’analyse'));});return v;}
function grab(video){const scale=Math.min(1,1920/video.videoWidth),c=canvasOf(Math.round(video.videoWidth*scale),Math.round(video.videoHeight*scale));c.getContext('2d').drawImage(video,0,0,c.width,c.height);return c;}
// Variance of the Laplacian on a small grey copy: higher = sharper (motion blur and focus misses score low).
function sharpness(src){const w=320,h=Math.round(320*src.height/src.width),c=canvasOf(w,h),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);
 const d=x.getImageData(0,0,w,h).data,g=new Float32Array(w*h);let bright=0;for(let i=0;i<w*h;i++){g[i]=d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114;bright+=g[i];}
 let sum=0,sq=0,n=0;for(let y=1;y<h-1;y++)for(let i=y*w+1;i<y*w+w-1;i++){const l=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];sum+=l;sq+=l*l;n++;}
 return {sharp:sq/n-(sum/n)**2,bright:bright/(w*h)};}
function bestFace(detector,img){if(!detector)return null;const r=detector.detect(img).detections||[];
 const f=r.map(d=>({x:d.boundingBox.originX/img.width,y:d.boundingBox.originY/img.height,w:d.boundingBox.width/img.width,h:d.boundingBox.height/img.height,score:d.categories?.[0]?.score||0})).sort((a,b)=>b.w*b.h-a.w*a.h)[0];return f||null;}
// Source times spread over what is kept in the edit, so cut parts never become a thumbnail.
function sampleTimes(segments,assetId,count){const parts=segments.filter(s=>s.assetId===assetId&&s.duration>.3),total=parts.reduce((a,s)=>a+s.duration,0);if(!total)return [];
 return Array.from({length:count},(_,i)=>{let t=total*(.03+.94*(i+.5)/count);for(const s of parts){if(t<=s.duration)return s.start+Math.min(t,s.duration-.05);t-=s.duration;}return parts.at(-1).end-.05;});}
// Person alpha from the multiclass segmenter: categories are background, hair, body skin, face skin, clothes and
// "others". "Others" also catches posters and papers behind the head, so it is dropped: alpha = 1 - bg - others.
function cutout(segmenter,img){if(!segmenter)return null;const r=segmenter.segment(img),m=r.confidenceMasks?.[0];if(!m){r.close?.();return null;}
 const mw=m.width,mh=m.height,bg=m.getAsFloat32Array(),other=r.confidenceMasks[5]?.getAsFloat32Array(),a=other?bg.map((v,i)=>v+other[i]):bg,mask=canvasOf(mw,mh),mx=mask.getContext('2d'),id=mx.createImageData(mw,mh);
 for(let i=0;i<mw*mh;i++){const v=Math.max(0,Math.min(1,(1-a[i]-.15)/.7));id.data[i*4+3]=v*255;}mx.putImageData(id,0,0);r.close?.();
 const out=canvasOf(img.width,img.height),ox=out.getContext('2d');ox.drawImage(mask,0,0,img.width,img.height);ox.globalCompositeOperation='source-in';ox.drawImage(img,0,0);
 // Bounding box of the person, so scaling/positioning works on the subject and not on the whole frame.
 let x0=mw,y0=mh,x1=0,y1=0;for(let y=0;y<mh;y++)for(let x=0;x<mw;x++)if(id.data[(y*mw+x)*4+3]>128){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 if(x1<=x0)return null;return {canvas:out,box:{x:x0/mw,y:y0/mh,w:(x1-x0+1)/mw,h:(y1-y0+1)/mh},bust:y1>=mh-3};}
const BRUSH_CODES={erase:'e',restore:'r',teeth:'w',eyes:'y',skin:'s'},BRUSH_LABELS={erase:'gomme',restore:'restaurer',teeth:'dents',eyes:'yeux',skin:'peau'};
const tintCache=new WeakMap();
const tinted=(src,color)=>{const hit=tintCache.get(src);if(hit?.color===color)return hit.canvas;const c=canvasOf(src.width,src.height),x=c.getContext('2d');x.drawImage(src,0,0);x.globalCompositeOperation='source-in';x.fillStyle=color;x.fillRect(0,0,c.width,c.height);tintCache.set(src,{color,canvas:c});return c;};
// Brush retouches, stored in the project as strokes in source-image fractions and replayed on the cutout:
// 'e' erases the person mask, 'r' paints the original frame back.
// Retouch brushes, pure pixel maths (no AI), applied only where painted with a feathered mask:
// 'w' teeth: removes yellow and brightens light pixels, skipping red/dark ones (lips, gums);
// 'y' eyes: brightens the whites and cools redness; 's' skin: blends towards a blurred copy, keeping some texture.
const RETOUCH=new Set(['w','y','s']);
function strokeMask(w,h,s,feather){const m=canvasOf(w,h),x=m.getContext('2d',{willReadFrequently:true});x.filter=`blur(${feather}px)`;x.strokeStyle='#fff';x.lineCap='round';x.lineJoin='round';x.lineWidth=s.r*2*w;x.beginPath();
 s.p.forEach(([px,py],i)=>i?x.lineTo(px*w,py*h):x.moveTo(px*w,py*h));if(s.p.length===1)x.lineTo(s.p[0][0]*w+.1,s.p[0][1]*h);x.stroke();return x;}
const retouchCache=new WeakMap();
function retouch(image,strokes){const list=(strokes||[]).filter(s=>RETOUCH.has(s.m));if(!list.length)return image;const key=JSON.stringify(list),hit=retouchCache.get(image);if(hit?.key===key)return hit.canvas;
 const w=image.width,h=image.height,c=canvasOf(w,h),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);
 for(const s of list){const pad=s.r*w+6,xs=s.p.map(p=>p[0]*w),ys=s.p.map(p=>p[1]*h),x0=Math.max(0,Math.floor(Math.min(...xs)-pad)),y0=Math.max(0,Math.floor(Math.min(...ys)-pad)),x1=Math.min(w,Math.ceil(Math.max(...xs)+pad)),y1=Math.min(h,Math.ceil(Math.max(...ys)+pad)),bw=x1-x0,bh=y1-y0;if(bw<=0||bh<=0)continue;
  const m=strokeMask(w,h,s,Math.max(1.5,s.r*w*.25)).getImageData(x0,y0,bw,bh).data,img=x.getImageData(x0,y0,bw,bh),d=img.data;
  let soft=null;if(s.m==='s'){const b=canvasOf(bw,bh),bx=b.getContext('2d',{willReadFrequently:true});bx.filter=`blur(${Math.max(2,w*.004)}px)`;bx.drawImage(c,x0,y0,bw,bh,0,0,bw,bh);soft=bx.getImageData(0,0,bw,bh).data;}
  // Brightness gate relative to the stroke (95th percentile), so it adapts to the lighting of the shot.
  let p95=255;if(s.m==='w'){const ls=[];for(let i=0;i<d.length;i+=16)if(m[i+3]>76)ls.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);ls.sort((u,v)=>u-v);if(ls.length)p95=ls[Math.floor(ls.length*.95)];}
  for(let i=0;i<d.length;i+=4){const a=m[i+3]/255;if(a<.01)continue;const r=d[i],g=d[i+1],b=d[i+2],l=.299*r+.587*g+.114*b;
   if(s.m==='w'){// Teeth: yellow cast (green above blue) and low saturation. Lips and gums are pink (blue ≥ green),
    // skin is strongly saturated: both are left alone. Measured on warm-lit footage: teeth ≈ (165,127,114).
    const sat=(Math.max(r,g,b)-Math.min(r,g,b))/Math.max(1,Math.max(r,g,b)),clamp01=v=>Math.min(1,Math.max(0,v));
    const k=a*clamp01((l-p95*.68)/(p95*.15))*clamp01((g-b-3)/8)*clamp01((.5-sat)/.15);if(k<=0)continue;
    // Pull towards a neutral, slightly lifted grey of the same luminance: removes the yellow without a blue cast.
    const t=Math.min(255,l*1.12+8),kk=k*.85;d[i]=r+(t-r)*kk;d[i+1]=g+(t*.99-g)*kk;d[i+2]=b+(t*.96-b)*kk;}
   else if(s.m==='y'){const k=a*Math.min(1,Math.max(0,(l-70)/70));d[i]=Math.min(255,r+(Math.min(r,(g+b)/2+6)*1.12-r)*k);d[i+1]=Math.min(255,g+(g*1.12-g)*k);d[i+2]=Math.min(255,b+(b*1.14-b)*k);}
   else{const k=a*.65;for(let j=0;j<3;j++)d[i+j]=d[i+j]*(1-k)+soft[i+j]*k;}}
  x.putImageData(img,x0,y0);}
 retouchCache.set(image,{key,canvas:c});return c;}
function applyStrokes(base,image,strokes){if(!base||!strokes?.length)return base;const c=canvasOf(base.canvas.width,base.canvas.height),x=c.getContext('2d');x.drawImage(base.canvas,0,0);
 const line=(ctx,s)=>{ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=s.r*2*c.width;ctx.beginPath();s.p.forEach(([px,py],i)=>i?ctx.lineTo(px*c.width,py*c.height):ctx.moveTo(px*c.width,py*c.height));if(s.p.length===1)ctx.lineTo(s.p[0][0]*c.width+.1,s.p[0][1]*c.height);ctx.stroke();};
 for(const s of strokes){if(s.m==='e'){x.globalCompositeOperation='destination-out';line(x,s);x.globalCompositeOperation='source-over';}
  else if(s.m==='r'){const tmp=canvasOf(c.width,c.height),tx=tmp.getContext('2d');line(tx,s);tx.globalCompositeOperation='source-in';tx.drawImage(image,0,0);x.drawImage(tmp,0,0);}}
 // Retouches show through the person's current alpha (they never add pixels to the cutout).
 if(strokes.some(s=>RETOUCH.has(s.m))){x.globalCompositeOperation='source-atop';x.drawImage(image,0,0);x.globalCompositeOperation='source-over';}
 return {...base,canvas:c};}
// Unsharp masks in one pass: a small radius for sharpness, a large one for clarity. Cached per source canvas.
const fxCache=new WeakMap();
function enhance(src,t){const sharpen=t.sharpen||0,clarity=t.clarity||0,g=GRADES[t.grade]?.subject,key=`${sharpen}|${clarity}|${t.grade}`;if(!sharpen&&!clarity&&!g)return src;
 const hit=fxCache.get(src);if(hit?.key===key)return hit.canvas;const w=src.width,h=src.height,c=canvasOf(w,h),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0);
 if(sharpen||clarity){const blurred=r=>{const b=canvasOf(w,h),bx=b.getContext('2d',{willReadFrequently:true});bx.filter=`blur(${r}px)`;bx.drawImage(src,0,0);return bx.getImageData(0,0,w,h).data;};
  const img=x.getImageData(0,0,w,h),d=img.data,small=sharpen?blurred(Math.max(1,w/1600)):null,large=clarity?blurred(Math.max(4,w*.012)):null,a1=sharpen*1.6,a2=clarity*.7;
  for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;for(let k=0;k<3;k++){const v=d[i+k];let o=v;if(small)o+=a1*(v-small[i+k]);if(large)o+=a2*(v-large[i+k]);d[i+k]=o<0?0:o>255?255:o;}}x.putImageData(img,0,0);}
 // Colour grade on the person only: soft-light tint, then the original alpha is restored.
 if(g){x.globalCompositeOperation='soft-light';x.globalAlpha=g[1];x.fillStyle=g[0];x.fillRect(0,0,w,h);x.globalAlpha=1;x.globalCompositeOperation='destination-in';x.drawImage(src,0,0);x.globalCompositeOperation='source-over';}
 fxCache.set(src,{key,canvas:c});return c;}
const tone=t=>`brightness(${t.fBright??1}) contrast(${t.fContrast??1}) saturate(${t.fSat??1})`;
const cover=(ctx,img,w,h)=>{const s=Math.max(w/img.width,h/img.height),dw=img.width*s,dh=img.height*s,r={x:(w-dw)/2,y:(h-dh)/2,w:dw,h:dh};ctx.drawImage(img,r.x,r.y,dw,dh);return r;};

function wrap(ctx,words,maxW){const lines=[];let line=[],width=0;const space=ctx.measureText(' ').width;
 words.forEach((w,i)=>{const ww=ctx.measureText(w).width;if(line.length&&width+space+ww>maxW){lines.push({words:line,width});line=[];width=0;}width+=(line.length?space:0)+ww;line.push({text:w,index:i,width:ww});});
 if(line.length)lines.push({words:line,width});return {lines,space};}

// Draws the whole thumbnail; returns the hit boxes of the text block and the subject for dragging.
export function drawThumbnail(ctx,w,h,t,frame,subject,{fast=false}={}){
 const boxes={};ctx.save();ctx.clearRect(0,0,w,h);
 const useCut=t.cutout&&subject;
 if(!frame){ctx.fillStyle='#1b1b24';ctx.fillRect(0,0,w,h);}
 else if(useCut&&t.background==='color'){const g=ctx.createRadialGradient(w*.7,h*.45,0,w*.7,h*.45,Math.max(w,h)*.8);g.addColorStop(0,t.bgColor);g.addColorStop(1,'#0a0a0f');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
 else{const pop=t.grade==='colorpop'&&useCut;ctx.filter=`${useCut&&t.background==='blur'?`blur(${Math.round(h*.025)}px) `:''}brightness(${(1-(useCut?t.dim:t.dim*.6))*(t.fBright??1)}) contrast(${t.fContrast??1}) saturate(${pop?0:t.fSat??1})`;
  // Without a cutout the whole frame is the subject, so it gets the sharpness/clarity treatment too.
  const rect=cover(ctx,useCut||fast?frame:enhance(frame,t),w*1.04,h*1.04);ctx.filter='none';if(!useCut)boxes.frame=rect;}
 const bgGrade=GRADES[t.grade]?.bg;if(frame&&bgGrade){ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=bgGrade[1];ctx.fillStyle=bgGrade[0];ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';}
 // Text behind the person: drawn on the background, then the cut-out person covers it.
 const behind=Boolean(t.textBehind&&useCut),drawText=()=>{
 const words=(t.uppercase?t.text.toUpperCase():t.text).split(/\s+/).filter(Boolean);
 if(words.length){const px=Math.round(t.textSize*h),blockW=t.textWidth*w,lh=px*1.08;ctx.font=FONTS[t.font]?.replace('{px}',px)||FONTS['clash-display'].replace('{px}',px);ctx.textBaseline='middle';
  const {lines,space}=wrap(ctx,words,blockW),left=t.textX*w-blockW/2,top=t.textY*h-lines.length*lh/2;
  lines.forEach((line,li)=>{let x=t.align==='center'?left+(blockW-line.width)/2:t.align==='right'?left+blockW-line.width:left;const y=top+lh*(li+.5);
   line.words.forEach(word=>{const hi=word.index===t.highlightIndex;
    if(hi&&t.highlightMode==='box'){const p=px*.12;ctx.fillStyle=t.highlightColor;ctx.beginPath();ctx.roundRect(x-p,y-px*.56,word.width+p*2,px*1.1,px*.12);ctx.fill();}
    ctx.lineJoin='round';ctx.lineWidth=px*.12;ctx.strokeStyle='#0a0a0f';if(!(hi&&t.highlightMode==='box'))ctx.strokeText(word.text,x,y);
    ctx.fillStyle=hi&&t.highlightMode==='color'?t.highlightColor:t.textColor;ctx.fillText(word.text,x,y);x+=word.width+space;});});
  boxes.text={x:left,y:top,w:blockW,h:lines.length*lh};}
 };
 if(behind)drawText();
 if(useCut){const {canvas,box}=subject,sh=h*t.subjectScale,scale=sh/(box.h*canvas.height),dw=canvas.width*scale,dh=canvas.height*scale;
  // Anchor the person's own box (not the frame) at subjectX/subjectY. A person cut by the frame bottom (a bust)
  // is never lifted above the image bottom, otherwise the straight cut and its outline would show.
  const bx=t.subjectX*w-box.w*dw/2,by=Math.max(t.subjectY*h-box.h*dh/2,subject.bust?h-box.h*dh:-Infinity),x=bx-box.x*dw,y=by-box.y*dh,r=t.outlineWidth*h/720;
  if(t.glow>0){ctx.shadowColor=t.outline;ctx.shadowBlur=t.glow*h*.08;ctx.drawImage(tinted(canvas,t.outline),x,y,dw,dh);ctx.shadowBlur=0;}
  if(r>0){const sil=tinted(canvas,t.outline);for(let a=0;a<16;a++)ctx.drawImage(sil,x+Math.cos(a/8*Math.PI)*r,y+Math.sin(a/8*Math.PI)*r,dw,dh);}
  ctx.filter=tone(t);ctx.drawImage(fast?canvas:enhance(canvas,t),x,y,dw,dh);ctx.filter='none';boxes.subject={x:bx,y:by,w:box.w*dw,h:box.h*dh};boxes.frame={x,y,w:dw,h:dh};}
 // Vignette under the text, so the title stays clean.
 if(t.vignette>0){const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.35,w/2,h/2,Math.hypot(w,h)/2);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,`rgba(0,0,0,${Math.min(.9,t.vignette*.85)})`);ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
 if(!behind)drawText();
 ctx.restore();return boxes;
}

// Transcript keywords (same rule as the mashup captions) as text suggestions.
function keywords(comp){const count=new Map();for(const w of comp.words||[]){if(w.deleted||w.hidden)continue;const t=w.text.replace(/[^\p{L}\p{N}'-]/gu,'');if(t.length<6)continue;const k=t.toLowerCase();count.set(k,(count.get(k)||0)+1);}
 return [...count].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);}

// Candidates and concepts are saved in the project as small descriptors ({assetId,time,thumb,...}); full-size
// frames and cutouts are rebuilt on demand and cached for the session. Loads are queued: one decoder at a time.
const frameKey=d=>d?`${d.assetId}@${(+d.time||0).toFixed(2)}`:'';
const frameCache=new Map();let loadQueue=Promise.resolve();
const thumbOf=img=>{const c=canvasOf(320,Math.round(320*img.height/img.width));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7);};
async function loadImage(asset,time){
 if(asset.type==='image'){const img=new Image();img.src=asset.url;await img.decode();const s=Math.min(1,1920/img.naturalWidth),c=canvasOf(Math.round(img.naturalWidth*s),Math.round(img.naturalHeight*s));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;}
 const video=await openVideo(asset.url);try{await seekTo(video,time);return grab(video);}finally{video.removeAttribute('src');video.load();}}
function ensureFrame(desc,asset){const key=frameKey(desc);if(!frameCache.has(key)){
 const job=loadQueue.then(()=>{if(!asset)throw Error('Média de la miniature introuvable');return loadImage(asset,desc.time);}).then(image=>({image}));
 loadQueue=job.catch(()=>{});frameCache.set(key,job);job.catch(()=>frameCache.delete(key));}
 return frameCache.get(key);}
async function withCutout(entry){if(entry.base===undefined){const {segmenter}=await vision();entry.base=cutout(segmenter,entry.image);}return entry;}

export function useThumbnail({comp,assets,segments,change,active,onAsset}){
 const t=useMemo(()=>({...THUMB_DEFAULTS,text:comp?.name||'',...comp?.thumbnail}),[comp]);
 const [current,setCurrent]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[draft,setDraft]=useState(null),[brush,setBrush]=useState({mode:null,size:40});
 const uploaded=useRef(new Map()),reloaded=useRef('');
 const asset=useMemo(()=>assets.find(a=>a.type==='video'&&comp?.assetIds?.includes(a.id)),[assets,comp]);
 const assetOf=useCallback(id=>uploaded.current.get(id)||assets.find(a=>a.id===id),[assets]);
 const set=useCallback((patch,history=true)=>change(c=>{c.thumbnail={...THUMB_DEFAULTS,text:c.name||'',...c.thumbnail,...patch};},history),[change]);
 const full=useCallback(async desc=>withCutout(await ensureFrame(desc,assetOf(desc.assetId))),[assetOf]);
 const select=useCallback(async desc=>{setBusy('Détourage…');try{const e=await full(desc);setCurrent({...desc,image:e.image,base:e.base});}catch(e){setError(e.message);}finally{setBusy('');}},[full]);
 const analyze=useCallback(async()=>{if(!asset)return setError('Ajoutez une vidéo à la composition pour créer une miniature.');setError('');setBusy('Chargement des modèles…');
  try{const vis=await vision();if(!vis.face||!vis.segmenter)setError('Modèles MediaPipe absents : lancez « npm run models:thumbnail ». Analyse sans visage/détourage.');
   const video=await openVideo(asset.url),times=sampleTimes(segments,asset.id,FRAME_COUNT),list=[];
   for(const [i,time] of times.entries()){setBusy(`Analyse des images ${i+1}/${times.length}…`);await seekTo(video,time);const image=grab(video),{sharp,bright}=sharpness(image),face=bestFace(vis.face,image),desc={assetId:asset.id,time};frameCache.set(frameKey(desc),Promise.resolve({image}));list.push({...desc,thumb:thumbOf(image),sharp,bright,face});}
   video.removeAttribute('src');video.load();
   // Score: sharp, well-exposed frames with a large, centred, confident face win.
   const maxSharp=Math.max(...list.map(f=>f.sharp),1);
   for(const f of list){const fs=f.face?f.face.score*(.6+Math.min(f.face.w*f.face.h*12,1))*(1-Math.min(Math.abs(f.face.x+f.face.w/2-.5),.5)*.6):.25,exp=1-Math.min(Math.abs(f.bright-125)/125,1)*.5;f.score=(.45+.55*f.sharp/maxSharp)*fs*exp;}
   list.sort((a,b)=>b.score-a.score);
   const candidates=[...(t.candidates||[]).filter(c=>c.imported),...list.map(f=>({assetId:f.assetId,time:f.time,thumb:f.thumb,score:+f.score.toFixed(4),face:!!f.face}))];
   set({candidates,frame:{assetId:asset.id,time:list[0].time},strokes:[],concepts:null});await select(list[0]);
  }catch(e){setError(e.message);setBusy('');}},[asset,segments,select,set,t.candidates]);
 // Imported pictures (a photo of you, a product, a logo…) become candidates like the video frames.
 const importImages=useCallback(async files=>{setError('');const added=[];
  for(const file of Array.from(files||[])){setBusy(`Import de ${file.name}…`);
   try{const r=await fetch('/api/upload',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:file}),a=await r.json();if(!r.ok)throw Error(a.error||'Import impossible');if(a.type!=='image')throw Error('Choisissez une image PNG, JPG ou WebP');
    uploaded.current.set(a.id,a);onAsset?.(a);const desc={assetId:a.id,time:0},{image}=await ensureFrame(desc,a),vis=await vision();
    added.push({...desc,thumb:thumbOf(image),face:!!bestFace(vis.face,image),imported:true,name:a.name});}catch(e){setError(e.message);}}
  setBusy('');if(!added.length)return;set({candidates:[...added,...(t.candidates||[])],frame:{assetId:added[0].assetId,time:0},strokes:[]});await select(added[0]);},[onAsset,select,set,t.candidates]);
 // Reopening the project (or switching composition): reload the saved frame alone, candidates come from the project.
 useEffect(()=>{const saved=comp?.thumbnail?.frame,key=frameKey(saved);if(!active||!saved||busy||reloaded.current===key||frameKey(current)===key)return;reloaded.current=key;select(saved);},[active,comp,busy,current,select]);
 const view=useMemo(()=>draft?{...t,...draft}:t,[t,draft]);
 const image=useMemo(()=>current?retouch(current.image,view.strokes):null,[current,view.strokes]);
 const subject=useMemo(()=>current?applyStrokes(current.base,image,view.strokes):null,[current,image,view.strokes]);
 const shown=useMemo(()=>current?{...current,image,subject}:null,[current,image,subject]);
 const pickFrame=desc=>{set({frame:{assetId:desc.assetId,time:desc.time},strokes:[]});select(desc);};
 // Three free concepts: text from the local Ollama model (or the rules engine), each with its own look and frame.
 const requestConcepts=useCallback(async()=>{const text=(comp?.words||[]).filter(w=>!w.deleted&&!w.hidden).map(w=>w.text).join(' ');setError('');setBusy('Recherche de concepts (IA locale)…');
  try{const r=await fetch('/api/thumbnail/concepts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}),data=await r.json();if(!r.ok)throw Error(data.error||'Concepts indisponibles');
   const pool=(t.candidates||[]).length?t.candidates:[t.frame].filter(Boolean);
   set({concepts:{engine:data.engine,list:data.concepts.map((c,i)=>{const f=pool[i%Math.max(pool.length,1)];return {angle:c.angle,text:c.text,highlight:c.highlight,style:i%CONCEPT_STYLES.length,frame:f?{assetId:f.assetId,time:f.time}:null};})}});
  }catch(e){setError(e.message);}finally{setBusy('');}},[comp,set,t.candidates,t.frame]);
 const applyConcept=c=>{const same=frameKey(c.frame)===frameKey(current);set({...CONCEPT_STYLES[c.style],cutout:true,text:c.text,highlightIndex:c.highlight,...(c.frame&&!same?{frame:c.frame,strokes:[]}:{})});if(c.frame&&!same)select(c.frame);};
 return {t:view,set,frames:t.candidates||[],concepts:t.concepts||null,current:shown,busy,error,analyze,importImages,select:pickFrame,full,frameKey,setDraft,asset,brush,setBrush,requestConcepts,applyConcept,keywords:useMemo(()=>comp?keywords(comp):[],[comp])};
}

async function exportImage(th,vertical){await document.fonts.ready;const [w,h]=vertical?[1080,1920]:[W,H],c=canvasOf(w,h);
 drawThumbnail(c.getContext('2d'),w,h,vertical?{...th.t,...VERTICAL}:th.t,th.current?.image,th.current?.subject);
 // YouTube refuses thumbnails over 2 MB: fall back to a high-quality JPEG when the PNG is too heavy.
 let blob=await new Promise(r=>c.toBlob(r,'image/png')),ext='png';if(blob.size>2e6){blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));ext='jpg';}
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`miniature-${vertical?'1080x1920':'1280x720'}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return {w,h,ext,bytes:blob.size};}

export function ThumbnailCanvas({th}){
 const ref=useRef(null),boxes=useRef({}),[vertical,setVertical]=useState(false),[fontsReady,setFontsReady]=useState(false),[cursor,setCursor]=useState(null),[textBox,setTextBox]=useState(null);
 const mask=['erase','restore'].includes(th.brush.mode),painting=!vertical&&th.brush.mode&&th.current&&(!mask||(th.t.cutout&&th.current.subject));
 useEffect(()=>{document.fonts.load("600 40px 'Clash Display'").then(()=>document.fonts.load("700 40px 'DM Sans'")).then(()=>setFontsReady(true));},[]);
 const [w,h]=vertical?[1080,1920]:[W,H],view=useMemo(()=>vertical?{...th.t,...VERTICAL}:th.t,[th.t,vertical]);
 useEffect(()=>{const c=ref.current;if(c){boxes.current=drawThumbnail(c.getContext('2d'),w,h,view,th.current?.image,th.current?.subject);setTextBox(boxes.current.text||null);}},[view,th.current,w,h,fontsReady]);
 // Drag the text block or the subject directly on the image (16:9 only: the vertical layout is derived).
 // Brush: paint erase/restore strokes in source-image fractions; the radius follows the on-image brush size.
 const paint=e=>{const r=ref.current.getBoundingClientRect(),f=boxes.current.frame;if(!f)return;e.preventDefault();ref.current.setPointerCapture(e.pointerId);
  const at=ev=>{const px=(ev.clientX-r.left)/r.width*w,py=(ev.clientY-r.top)/r.height*h;return [+((px-f.x)/f.w).toFixed(4),+((py-f.y)/f.h).toFixed(4)];};
  const prev=th.t.strokes||[],stroke={m:BRUSH_CODES[th.brush.mode],r:+(th.brush.size/2/f.w).toFixed(4),p:[at(e)]};th.setDraft({strokes:[...prev,stroke]});
  const move=ev=>{stroke.p=[...stroke.p,at(ev)];th.setDraft({strokes:[...prev,stroke]});};
  const up=()=>{ref.current.removeEventListener('pointermove',move);ref.current.removeEventListener('pointerup',up);th.setDraft(null);th.set({strokes:[...prev,stroke]});};
  ref.current.addEventListener('pointermove',move);ref.current.addEventListener('pointerup',up);};
 const resizeText=(side,e)=>{e.preventDefault();e.stopPropagation();const r=ref.current.getBoundingClientRect(),b=boxes.current.text;if(!b)return;const fixed=side==='right'?b.x:b.x+b.w;let last=null;
  const move=ev=>{const px=(ev.clientX-r.left)/r.width*w,width=Math.min(1,Math.max(.12,Math.abs(px-fixed)/w)),left=side==='right'?fixed:fixed-width*w;last={textWidth:+width.toFixed(3),textX:+((left+width*w/2)/w).toFixed(3)};th.setDraft(last);};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);th.setDraft(null);if(last)th.set(last);};
  addEventListener('pointermove',move);addEventListener('pointerup',up);};
 const hover=e=>{if(!painting)return setCursor(null);const c=ref.current;setCursor({x:c.offsetLeft+e.nativeEvent.offsetX,y:c.offsetTop+e.nativeEvent.offsetY,d:th.brush.size*c.clientWidth/w});};
 const down=e=>{if(painting)return paint(e);if(vertical)return;const r=ref.current.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*w,py=(e.clientY-r.top)/r.height*h,inside=b=>b&&px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h;
  // When boxes overlap (text behind the person), the smallest one under the pointer wins: the person's box covers
  // most of the image, so taking it first would make the title impossible to grab.
  const target=['text','subject'].filter(k=>inside(boxes.current[k])).sort((a,b)=>boxes.current[a].w*boxes.current[a].h-boxes.current[b].w*boxes.current[b].h)[0]||null;if(!target)return;e.preventDefault();ref.current.setPointerCapture(e.pointerId);
  const sx=target==='text'?th.t.textX:th.t.subjectX,sy=target==='text'?th.t.textY:th.t.subjectY;let last=null;
  const move=ev=>{const nx=Math.min(1,Math.max(0,sx+(ev.clientX-e.clientX)/r.width)),ny=Math.min(1,Math.max(0,sy+(ev.clientY-e.clientY)/r.height));last=target==='text'?{textX:nx,textY:ny}:{subjectX:nx,subjectY:ny};th.setDraft(last);};
  const up=()=>{ref.current.removeEventListener('pointermove',move);ref.current.removeEventListener('pointerup',up);th.setDraft(null);if(last)th.set(last);};
  ref.current.addEventListener('pointermove',move);ref.current.addEventListener('pointerup',up);};
 return <div className="thumb-stage"><div className="thumb-format" role="tablist" aria-label="Format de la miniature"><button role="tab" aria-selected={!vertical} className={!vertical?'selected':''} onClick={()=>setVertical(false)}>16:9 · YouTube</button><button role="tab" aria-selected={vertical} className={vertical?'selected':''} onClick={()=>setVertical(true)}>9:16 · Shorts</button></div>
  <canvas ref={ref} width={w} height={h} className={`thumb-canvas ${vertical?'vertical':''} ${painting?'painting':''}`} aria-label="Aperçu de la miniature" onPointerDown={down} onPointerMove={hover} onPointerLeave={()=>setCursor(null)}/>
  {painting&&cursor&&<span className={`thumb-brush ${th.brush.mode}`} style={{left:cursor.x,top:cursor.y,width:cursor.d,height:cursor.d}}/>}
  {/* The real text box (wrap width) on the image, with width handles. Editor only: never drawn in the export. */}
  {!vertical&&!painting&&textBox&&ref.current&&(()=>{const c=ref.current,k=c.clientWidth/w;return <div className="thumb-textbox" style={{left:c.offsetLeft+textBox.x*k,top:c.offsetTop+textBox.y*k,width:textBox.w*k,height:textBox.h*k}}>
   <span className="thumb-textbox-label">Texte · {Math.round(th.t.textWidth*100)}%</span><span className="thumb-handle left" aria-hidden="true" onPointerDown={e=>resizeText('left',e)}/><span className="thumb-handle right" aria-hidden="true" onPointerDown={e=>resizeText('right',e)}/></div>;})()}
  {th.busy&&<div className="thumb-busy"><Loader2 className="spin" size={16}/>{th.busy}</div>}
  {!th.current&&!th.busy&&<div className="thumb-empty"><Sparkles size={22}/><strong>Analysez la vidéo ou importez une image</strong><span>Les images les plus nettes où vous êtes bien visible sont proposées en premier.</span></div>}
  <span className="preview-hint">{vertical?'1080 × 1920 · disposition Shorts automatique':painting?`Pinceau ${BRUSH_LABELS[th.brush.mode]} · peignez sur ${th.brush.mode==='teeth'?'les dents':th.brush.mode==='eyes'?'le blanc des yeux':th.brush.mode==='skin'?'la peau':'la personne'}`:'1280 × 720 · glissez le texte ou la personne pour les déplacer'}</span></div>;
}

// Preset chip with a live mini preview of the current thumbnail (fast mode: tone, grade and vignette only).
function FilterChip({id,filter,th}){
 const ref=useRef(null),active=th.t.filter===id;
 useEffect(()=>{const c=ref.current;if(c)drawThumbnail(c.getContext('2d'),128,72,{...th.t,...filter,text:''},th.current?.image,th.current?.subject,{fast:true});},[th.t,th.current,filter]);
 return <button type="button" aria-pressed={active} className={active?'selected':''} onClick={()=>th.set({filter:id,...Object.fromEntries(FILTER_KEYS.map(k=>[k,filter[k]]))})}><canvas ref={ref} width={128} height={72}/><span>{filter.label}</span></button>;
}

function ConceptCard({concept,full,onApply}){
 const ref=useRef(null),[frame,setFrame]=useState(null);
 useEffect(()=>{let live=true;if(concept.frame)full(concept.frame).then(e=>live&&setFrame(e),()=>{});return ()=>{live=false;};},[concept.frame,full]);
 useEffect(()=>{const c=ref.current;if(c)document.fonts.ready.then(()=>drawThumbnail(c.getContext('2d'),320,180,{...THUMB_DEFAULTS,...CONCEPT_STYLES[concept.style],cutout:true,text:concept.text,highlightIndex:concept.highlight},frame?.image,frame?.base));},[concept,frame]);
 return <button type="button" className="thumb-concept" onClick={onApply} aria-label={`Appliquer le concept ${concept.angle} : ${concept.text}`}><canvas ref={ref} width={320} height={180}/><span><strong>{concept.angle}</strong>{concept.text}</span></button>;
}

export function ThumbnailPanel({th,comp,notify}){
 const {t,set}=th,words=(t.text||'').split(/\s+/).filter(Boolean),[exporting,setExporting]=useState(false),fileRef=useRef(null);
 const range=(key,label,min,max,step,fmt=v=>`${Math.round(v*100)}%`)=><label className="field-label" key={key}>{label}<span>{fmt(t[key])}</span><input type="range" min={min} max={max} step={step} value={t[key]} aria-label={label} onChange={e=>set({[key]:+e.target.value,...(FILTER_KEYS.includes(key)?{filter:'custom'}:{})})}/></label>;
 const swatches=(key,label)=><div className="bg-presets" aria-label={label}>{PALETTE.map(([c,name])=><button key={c} type="button" title={name} className={t[key]?.toLowerCase()===c.toLowerCase()?'selected':''} style={{background:c}} onClick={()=>set({[key]:c})}/>)}</div>;
 const fromCaptions=()=>{set({font:comp.captionFont==='dm-sans'?'dm-sans':'clash-display',textColor:comp.captionColor||'#ffffff',highlightColor:comp.wordHighlightColor||t.highlightColor});notify('Style des sous-titres appliqué à la miniature');};
 const save=async vertical=>{setExporting(true);try{const r=await exportImage(th,vertical);notify(`Miniature ${r.w}×${r.h} exportée (${r.ext.toUpperCase()}, ${(r.bytes/1e6).toFixed(1)} Mo)`);}finally{setExporting(false);}};
 return <div className="thumb-panel"><div className="panel-eyebrow">UNE IMAGE QUI DONNE ENVIE</div><h2>Votre miniature.</h2><p className="panel-description">Les meilleures images de votre montage, détourées en local, avec le style de vos sous-titres.</p>
  <button className="button primary full" disabled={!!th.busy||!th.asset} onClick={th.analyze}>{th.busy?<Loader2 className="spin" size={15}/>:<Wand2 size={15}/>}{th.frames.length?'Relancer l’analyse':'Analyser la vidéo'}</button>
  {th.error&&<p className="field-help thumb-error" role="alert">{th.error}</p>}
  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e=>{th.importImages(e.target.files);e.target.value='';}}/>
  <button className="button secondary full thumb-import" disabled={!!th.busy} onClick={()=>fileRef.current.click()}><ImageUp size={15}/>Importer une image</button>
  {th.frames.length>0&&<div className="thumb-frames" aria-label="Images candidates">{th.frames.map(f=>{const best=!f.imported&&f===th.frames.find(x=>!x.imported);return <button key={th.frameKey(f)} type="button" className={th.frameKey(th.current)===th.frameKey(f)?'selected':''} aria-label={f.imported?`Image importée ${f.name||''}`:`Image à ${f.time.toFixed(1)} s${best?' (meilleure)':''}`} onClick={()=>th.select(f)}><img src={f.thumb} alt=""/>{best&&<span className="thumb-best"><Star size={9} fill="currentColor"/>Meilleure</span>}{f.imported&&<span className="thumb-best imported">Importée</span>}{!f.face&&<span className="thumb-noface">sans visage</span>}</button>;})}</div>}
  {(th.current||th.frames.length>0)&&<><button className="button secondary full thumb-concepts-button" disabled={!!th.busy} onClick={th.requestConcepts}><Lightbulb size={15}/>{th.concepts?'Proposer d’autres concepts':'Proposer 3 concepts'}</button>
   {th.concepts&&<><p className="field-help">Gratuit et local · {th.concepts.engine}. Cliquez sur un concept pour l’appliquer.</p><div className="thumb-concepts">{th.concepts.list.map((c,i)=><ConceptCard key={i+c.text} concept={c} full={th.full} onApply={()=>{th.applyConcept(c);notify(`Concept « ${c.angle} » appliqué`);}}/>)}</div></>}</>}
  <div className="panel-rule"/><label className="field-label">Texte<textarea aria-label="Texte de la miniature" value={t.text} rows={2} onChange={e=>set({text:e.target.value,highlightIndex:-1})}/></label>
  {th.keywords.length>0&&<div className="thumb-chips" aria-label="Mots-clés de la transcription">{th.keywords.map(k=><button key={k} type="button" onClick={()=>set({text:(t.text?t.text+' ':'')+k})}>+ {k}</button>)}</div>}
  {words.length>0&&<><label className="field-label">Mot mis en avant</label><div className="thumb-chips words" aria-label="Mot mis en avant">{words.map((w,i)=><button key={i} type="button" aria-pressed={t.highlightIndex===i} className={t.highlightIndex===i?'selected':''} onClick={()=>set({highlightIndex:t.highlightIndex===i?-1:i})}>{w}</button>)}</div>
   {t.highlightIndex>=0&&<><div className="segmented" role="group" aria-label="Style du mot mis en avant">{[['box','Fond'],['color','Couleur']].map(([v,l])=><button key={v} type="button" className={t.highlightMode===v?'selected':''} onClick={()=>set({highlightMode:v})}>{l}</button>)}</div>{swatches('highlightColor','Couleur du mot mis en avant')}</>}</>}
  <label className="field-label">Police<select aria-label="Police de la miniature" value={t.font} onChange={e=>set({font:e.target.value})}><option value="clash-display">Clash Display</option><option value="dm-sans">DM Sans</option></select></label>
  <label className="field-label">Couleur du texte<div className="color-field"><input type="color" aria-label="Couleur du texte de la miniature" value={t.textColor} onChange={e=>set({textColor:e.target.value})}/><span>{t.textColor.toUpperCase()}</span></div></label>
  {range('textSize','Taille du texte',.06,.28,.005)}{range('textWidth','Largeur du texte',.25,.95,.01)}
  <label className="field-label">Position du texte</label>
  <div className="thumb-place" role="group" aria-label="Position du texte">{[.22,.5,.8].flatMap((y,row)=>['left','center','right'].map((align,col)=>{
   // The block centre that puts its left/centre/right edge 5% from the image side, at the chosen third.
   const x=align==='left'?.05+t.textWidth/2:align==='right'?.95-t.textWidth/2:.5,on=Math.abs(t.textX-x)<.02&&Math.abs(t.textY-y)<.02&&t.align===align;
   return <button key={`${row}${col}`} type="button" aria-pressed={on} className={on?'selected':''} aria-label={`Texte ${['en haut','au milieu','en bas'][row]} ${{left:'à gauche',center:'au centre',right:'à droite'}[align]}`} onClick={()=>set({textX:+x.toFixed(3),textY:y,align})}><i/></button>;}))}</div>
  <div className="segmented" role="group" aria-label="Alignement du texte">{[['left','Gauche'],['center','Centre'],['right','Droite']].map(([v,l])=><button key={v} type="button" aria-pressed={t.align===v} className={t.align===v?'selected':''} onClick={()=>set({align:v})}>{l}</button>)}</div>
  {range('textX','Position horizontale du texte',0,1,.005)}{range('textY','Position verticale du texte',0,1,.005)}
  <div className="toggle-row"><span>Majuscules</span><button aria-label="Majuscules" aria-pressed={t.uppercase} className={'toggle '+(t.uppercase?'on':'')} onClick={()=>set({uppercase:!t.uppercase})}><span/></button></div>
  <button className="button secondary full" onClick={fromCaptions}><Check size={14}/>Reprendre le style des sous-titres</button>
  <div className="panel-rule"/><label className="field-label">Filtres</label><div className="thumb-filters" role="group" aria-label="Filtres">{Object.entries(FILTERS).map(([id,f])=><FilterChip key={id} id={id} filter={f} th={th}/>)}</div>
  {range('fBright','Luminosité',.7,1.4,.01)}{range('fContrast','Contraste',.7,1.6,.01)}{range('fSat','Saturation',0,2,.01)}{range('sharpen','Netteté',0,1.5,.05)}{range('clarity','Clarté (HDR)',0,1.5,.05)}{range('vignette','Vignette',0,1,.05)}
  <div className="panel-rule"/><div className="toggle-row"><span>Détourer la personne</span><button aria-label="Détourer la personne" aria-pressed={t.cutout} className={'toggle '+(t.cutout?'on':'')} onClick={()=>set({cutout:!t.cutout})}><span/></button></div>
  {t.cutout&&th.current&&!th.current.subject&&<p className="field-help">Aucune personne détectée sur cette image : choisissez-en une autre.</p>}
  {t.cutout&&<><label className="field-label">Arrière-plan</label><div className="segmented" role="group" aria-label="Arrière-plan">{[['blur','Flou'],['frame','Image'],['color','Couleur']].map(([v,l])=><button key={v} type="button" className={t.background===v?'selected':''} onClick={()=>set({background:v})}>{l}</button>)}</div>
   {t.background==='color'&&swatches('bgColor','Couleur d’arrière-plan')}{t.background!=='color'&&range('dim','Assombrir',0,.8,.01)}
   <label className="field-label">Contour<div className="color-field"><input type="color" aria-label="Couleur du contour" value={t.outline} onChange={e=>set({outline:e.target.value})}/><span>{t.outline.toUpperCase()}</span></div></label>
   {range('outlineWidth','Épaisseur du contour',0,24,1,v=>`${v}px`)}{range('glow','Halo',0,1,.05)}{range('subjectScale','Taille de la personne',.5,1.6,.01)}{range('subjectX','Position horizontale',0,1,.01)}{range('subjectY','Position verticale',0,1,.01)}
   <div className="toggle-row"><span>Texte derrière la personne</span><button aria-label="Texte derrière la personne" aria-pressed={Boolean(t.textBehind)} className={'toggle '+(t.textBehind?'on':'')} onClick={()=>set({textBehind:!t.textBehind})}><span/></button></div>
   {t.textBehind&&<p className="field-help">La personne passe devant le titre : placez le texte en partie derrière elle, en grand, pour l’effet magazine.</p>}
   {th.current?.subject&&<><label className="field-label">Retoucher le détourage</label><div className="segmented" role="group" aria-label="Pinceau de détourage">{[[null,'Déplacer',null],['erase','Gommer',Eraser],['restore','Restaurer',Brush]].map(([v,l,Icon])=><button key={l} type="button" aria-pressed={th.brush.mode===v} className={th.brush.mode===v?'selected':''} onClick={()=>th.setBrush(b=>({...b,mode:v}))}>{Icon&&<Icon size={12}/>}{l}</button>)}</div>
</>}</>}
  {th.current&&<><div className="panel-rule"/><label className="field-label">Retouches (pinceau, sans IA)</label><div className="segmented" role="group" aria-label="Pinceau de retouche">{[['teeth','Dents',Smile],['eyes','Yeux',Eye],['skin','Peau',Droplets]].map(([v,l,Icon])=><button key={v} type="button" aria-pressed={th.brush.mode===v} className={th.brush.mode===v?'selected':''} onClick={()=>th.setBrush(b=>({...b,mode:b.mode===v?null:v}))}><Icon size={12}/>{l}</button>)}</div>
   {th.brush.mode&&<label className="field-label">Taille du pinceau<span>{th.brush.size}px</span><input type="range" min="8" max="160" step="2" value={th.brush.size} aria-label="Taille du pinceau" onChange={e=>th.setBrush(b=>({...b,size:+e.target.value}))}/></label>}
   {th.brush.mode&&<p className="field-help">Chaque passage renforce l’effet. Repassez pour intensifier.</p>}
   {(t.strokes||[]).length>0&&<><button className="button secondary full" onClick={()=>set({strokes:t.strokes.slice(0,-1)})}><Undo2 size={14}/>Annuler le dernier coup de pinceau</button><button className="button secondary full" onClick={()=>set({strokes:[]})}>Tout effacer ({t.strokes.length})</button></>}</>}
  <div className="panel-rule"/><button className="button primary full" disabled={!th.current||exporting} onClick={()=>save(false)}><Download size={15}/>Exporter 1280×720 (YouTube)</button>
  <button className="button secondary full" disabled={!th.current||exporting} onClick={()=>save(true)}><Download size={15}/>Exporter 1080×1920 (Shorts)</button>
  <p className="field-help">100 % gratuit : tout est calculé sur votre machine. PNG, ou JPEG si l’image dépasse la limite YouTube de 2 Mo.</p></div>;
}
