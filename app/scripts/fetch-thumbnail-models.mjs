// Downloads the MediaPipe models used by the thumbnail studio (face detection + person segmentation).
// They are kept out of Git like the other model weights (Apache-2.0, published by Google).
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','public','mediapipe','models');
const base='https://storage.googleapis.com/mediapipe-models/';
const models={'blaze_face_short_range.tflite':'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite','selfie_multiclass_256x256.tflite':'image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'};
await fs.mkdir(dir,{recursive:true});
for(const [file,url] of Object.entries(models)){
 const target=path.join(dir,file);if(await fs.stat(target).then(s=>s.size>0,()=>false)){console.log('ok   '+file);continue;}
 const r=await fetch(base+url);if(!r.ok)throw Error(`${file}: HTTP ${r.status}`);await fs.writeFile(target,Buffer.from(await r.arrayBuffer()));console.log('got  '+file);
}
