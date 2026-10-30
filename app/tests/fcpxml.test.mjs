import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFcpxml,parseRate} from '../fcpxml.mjs';

const asset={id:'a',name:'Rush & co.mp4',file:'/tmp/rush 1.mp4',duration:10,type:'video',hasAudio:true,width:3840,height:2160};
const words=['bonjour','euh','à','tous'].map((text,i)=>({id:String(i),assetId:'a',text,start:i*2,end:i*2+1,cutStart:i*2,cutEnd:i*2+2,deleted:text==='euh'}));
test('parseRate accepts NTSC and rejects VFR timebases',()=>{assert.deepEqual(parseRate('30000/1001'),{num:30000,den:1001});assert.equal(parseRate('90000/1'),null);assert.equal(parseRate(''),null);});
test('fcpxml turns deleted words into frame-exact cuts on the original file with a marker',()=>{
 const xml=buildFcpxml({name:'Mon <montage>',aspect:'16:9',words,assetIds:['a']},[asset],{rates:{a:{num:25,den:1}}});
 assert.match(xml,/<fcpxml version="1\.9">/);
 assert.match(xml,/src="file:\/\/\/tmp\/rush%201\.mp4"/);
 assert.match(xml,/name="Rush &amp; co\.mp4"/);
 assert.match(xml,/<project name="Mon &lt;montage&gt;">/);
 const clips=[...xml.matchAll(/<asset-clip [^>]*offset="([^"]+)" start="([^"]+)" duration="([^"]+)"/g)].map(m=>m.slice(1));
 assert.deepEqual(clips,[['0s','0s','50/25s'],['50/25s','100/25s','100/25s']]);
 assert.match(xml,/<marker start="100\/25s" duration="1\/25s" value="Coupé : euh"\/>/);
 assert.match(xml,/<sequence format="r0" duration="150\/25s"/);
});
test('fcpxml uses vertical sequence size, NTSC timing, volume and zoom',()=>{
 const xml=buildFcpxml({name:'v',aspect:'9:16',words:[],assetIds:['a'],volume:.5,zoom:1.2},[asset],{rates:{a:{num:30000,den:1001}}});
 assert.match(xml,/frameDuration="1001\/30000s" width="1080" height="1920"/);
 assert.match(xml,/duration="300300\/30000s"/);
 assert.match(xml,/<adjust-volume amount="-6\.02dB"\/>/);
 assert.match(xml,/<adjust-transform scale="1\.2 1\.2"\/>/);
});
test('fcpxml refuses an empty cut',()=>{assert.throws(()=>buildFcpxml({words:words.map(w=>({...w,deleted:true})),assetIds:['a']},[asset]),/Rien à exporter/);});
test('fcpxml labels pure silence cuts with their length',()=>{const ws=[{id:'0',assetId:'a',text:'un',start:0,end:1,cutStart:0,cutEnd:1.2},{id:'1',assetId:'a',text:'deux',start:3,end:4,cutStart:2.8,cutEnd:4}];
 const xml=buildFcpxml({words:ws,assetIds:['a']},[asset],{rates:{a:{num:25,den:1}}});assert.match(xml,/value="Silence coupé · 1,6 s"/);});
test('fcpxml turns captions into styled Resolve titles attached to their clip',()=>{
 const xml=buildFcpxml({words,assetIds:['a'],captions:true,captionFont:'mashup',captionBg:''},[asset],{rates:{a:{num:25,den:1}}});
 assert.match(xml,/<effect id="e0" name="Basic Title"/);
 assert.equal((xml.match(/<title /g)||[]).length,2);
 assert.match(xml,/<text-style ref="c0clash">bonjour<\/text-style>/);
 assert.match(xml,/font="Clash Display" fontSize="\d+" fontFace="Semibold"/);
 assert.match(xml,/strokeColor="0 0 0 1"/);
 assert.match(xml,/<adjust-transform position="0 -\d+\.\d+"\/><\/title>/);
 // The second caption starts after the cut "euh", inside the second clip, in that clip's source time.
 assert.match(xml,/start="100\/25s" duration="100\/25s" format="f1" tcFormat="NDF"><title ref="e0" lane="1" name="à tous" offset="100\/25s"/);
});
test('fcpxml leaves titles out when captions are off',()=>{const xml=buildFcpxml({words,assetIds:['a']},[asset],{rates:{a:{num:25,den:1}}});assert.doesNotMatch(xml,/<title |Basic Title/);});
