// Pexels API: https://www.pexels.com/api/documentation/
// API requests always use this origin; client-provided download URLs are never accepted.
const origin='https://api.pexels.com';
function safeURL(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.includes(u.hostname)&&(!u.port||u.port==='443')?u.href:null;}catch{return null;}}
const mediaURL=value=>safeURL(value,['images.pexels.com','videos.pexels.com']);
const sourceURL=value=>safeURL(value,['www.pexels.com','pexels.com']);
function validateKey(key){if(typeof key!=='string'||!key.trim()||key.length>1000||/[\r\n]/.test(key))throw Error('Connectez votre clé API Pexels pour rechercher dans la banque de médias');return key.trim();}
function validateKind(kind){if(!['photo','video'].includes(kind))throw Error('Choisissez photos ou vidéos');return kind;}
function mapItem(item,kind){
 if(!item||!Number.isSafeInteger(item.id)||item.id<=0)return null;
 const page=sourceURL(item.url),author=String(kind==='photo'?item.photographer||'Pexels creator':item.user?.name||'Pexels creator').slice(0,200),authorURL=sourceURL(kind==='photo'?item.photographer_url:item.user?.url);
 let url,preview;
 if(kind==='photo'){url=mediaURL(item.src?.large2x)||mediaURL(item.src?.large)||mediaURL(item.src?.original);preview=mediaURL(item.src?.medium)||mediaURL(item.src?.small)||url;}
 else{
  const files=(Array.isArray(item.video_files)?item.video_files:[]).filter(f=>f.file_type==='video/mp4'&&Number(f.width)>0&&Number(f.height)>0&&Math.max(f.width,f.height)<=1920&&Math.min(f.width,f.height)<=1080&&mediaURL(f.link)).sort((a,b)=>b.width*b.height-a.width*a.height);
  url=files[0]&&mediaURL(files[0].link);preview=mediaURL(item.image);
 }
 if(!page||!url||!preview)return null;
 return {id:item.id,title:String(item.alt||`${kind==='photo'?'Photo':'Video'} by ${author}`).slice(0,300),preview,url,kind,author,authorURL:authorURL||page,sourceURL:page,attribution:`${kind==='photo'?'Photo':'Video'} by ${author} on Pexels`};
}
async function request(endpoint,apiKey,fetchImpl){const response=await fetchImpl(origin+endpoint,{headers:{Authorization:validateKey(apiKey)},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok){if(response.status===401||response.status===403)throw Error('Pexels a refusé cette clé API');if(response.status===429)throw Error('Limite de requêtes Pexels atteinte. Réessayez plus tard');throw Error(`La requête Pexels a échoué (${response.status})`);}return response.json();}
export async function searchStock({apiKey,query,kind='photo',page=1},{fetchImpl=fetch}={}){
 validateKey(apiKey);validateKind(kind);if(typeof query!=='string'||!query.trim()||query.trim().length>100)throw Error('Saisissez une recherche de 1 à 100 caractères');if(!Number.isInteger(Number(page))||Number(page)<1||Number(page)>1000)throw Error('Page de résultats invalide');
 const params=new URLSearchParams({query:query.trim(),page:String(Number(page)),per_page:'12'}),result=await request(`${kind==='photo'?'/v1/search':'/v1/videos/search'}?${params}`,apiKey,fetchImpl),items=(kind==='photo'?result.photos:result.videos);
 if(!Array.isArray(items))throw Error('Pexels a renvoyé un résultat invalide');
 return {items:items.map(item=>mapItem(item,kind)).filter(Boolean),page:Number(page),hasNext:!!result.next_page,total:Math.max(0,Number(result.total_results)||0)};
}
export async function resolveStock({apiKey,id,kind='photo'},{fetchImpl=fetch}={}){
 validateKey(apiKey);validateKind(kind);if(!/^[1-9]\d{0,14}$/.test(String(id)))throw Error('Identifiant de média Pexels invalide');
 const result=await request(`${kind==='photo'?'/v1/photos/':'/v1/videos/videos/'}${id}`,apiKey,fetchImpl),item=mapItem(result,kind);if(!item||String(item.id)!==String(id))throw Error('Pexels n’a fourni aucun fichier téléchargeable compatible');return item;
}
