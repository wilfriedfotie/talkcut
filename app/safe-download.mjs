import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
export function providerMediaURL(value){const u=new URL(value);const allowed=u.hostname==='fal.media'||u.hostname.endsWith('.fal.media')||(u.hostname==='storage.googleapis.com'&&u.pathname.startsWith('/falserverless/'))||['images.pexels.com','videos.pexels.com'].includes(u.hostname);if(u.protocol!=='https:'||!allowed||u.username||u.password||u.port)throw Error('Le fournisseur a renvoyé un emplacement de média non pris en charge');return u;}
export async function downloadProviderMedia(url,destination,{fetchImpl=fetch,maxBytes=512*1024*1024}={}){
 let current=providerMediaURL(url),response;
 for(let redirects=0;redirects<4;redirects++){
  response=await fetchImpl(current.href,{redirect:'manual',signal:AbortSignal.timeout(180000)});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!next)throw Error('La redirection du média fournisseur est invalide');current=providerMediaURL(new URL(next,current).href);continue;}break;
 }
 if(!response?.ok||!response.body)throw Error(`Impossible de télécharger le média généré (HTTP ${response?.status||'inconnu'})`);
 if(Number(response.headers.get('content-length'))>maxBytes)throw Error('Le média généré dépasse la limite d’import de 512 Mo');
 let count=0;const limit=new Transform({transform(chunk,encoding,callback){count+=chunk.length;if(count>maxBytes)return callback(Error('Le média généré dépasse la limite d’import'));callback(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(destination+'.part'));
 await fs.rename(destination+'.part',destination);return {bytes:count};
}
