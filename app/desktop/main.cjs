const {app,BrowserWindow,session,ipcMain,dialog,desktopCapturer}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {randomBytes}=require('node:crypto');
const {autoUpdater}=require('electron-updater');
app.setName('OziCut');
if(process.env.OZICUT_TEST_DATA)app.setPath('userData',process.env.OZICUT_TEST_DATA);
if(!app.requestSingleInstanceLock())app.quit();
// `electron .` in development sets process.defaultApp. Electron's own app.isPackaged only checks the executable's
// name, which the dev runtime renamed to OziCut (scripts/dev-app-name.mjs) would otherwise flip to true.
const packaged=app.isPackaged&&!process.defaultApp;
let window,backend,update={state:'idle'},origin;
const trusted=event=>{if(event.sender!==window?.webContents||!event.senderFrame.url.startsWith(origin+'/'))throw Error('Unknown desktop caller');};
app.whenReady().then(async()=>{
 // macOS ignores BrowserWindow.icon: in development (unpackaged) the Dock would show Electron's icon.
 if(process.platform==='darwin'&&!packaged)app.dock?.setIcon(path.join(__dirname,'..','build','icons','ozicut.png'));
 process.env.OZICUT_DATA=path.join(app.getPath('userData'),'media-library');
 process.env.OZICUT_NATIVE=packaged?path.join(process.resourcesPath,'native'):path.join(__dirname,'..','native');
 process.env.OZICUT_SAMPLES=packaged?path.join(process.resourcesPath,'samples'):path.join(__dirname,'..','samples');
 process.env.OZICUT_TOKEN=randomBytes(32).toString('hex');process.env.PORT='0';
 if(!process.argv.includes('--production'))process.argv.push('--production');
 if(process.env.OZICUT_TEST_OFFLINE==='1'){
  const originalFetch=globalThis.fetch;globalThis.fetch=(url,...args)=>{const u=new URL(typeof url==='string'?url:url.url||url);if(!['127.0.0.1','localhost'].includes(u.hostname))throw Error('Offline verification: external network blocked');return originalFetch(url,...args);};
 }
 backend=await (await import(pathToFileURL(path.join(__dirname,'..','server.mjs')).href)).ready;origin=`http://127.0.0.1:${backend.port}`;
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url),optionalImage=process.env.OZICUT_TEST_OFFLINE!=='1'&&backend.cloudEnabled()&&details.resourceType==='image'&&url.protocol==='https:'&&url.hostname==='images.pexels.com';callback({cancel:!optionalImage&&!['devtools:','data:','blob:'].includes(url.protocol)&&url.origin!==origin&&!(url.protocol==='ws:'&&url.host===new URL(origin).host)});});
 session.defaultSession.webRequest.onBeforeSendHeaders((details,callback)=>{if(details.url.startsWith(origin+'/')||details.url.startsWith(`ws://127.0.0.1:${backend.port}/`))details.requestHeaders['X-OziCut-Token']=process.env.OZICUT_TOKEN;callback({requestHeaders:details.requestHeaders});});
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===window?.webContents&&['media','display-capture'].includes(permission)));
 session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{try{if(!request.frame.url.startsWith(origin+'/'))return callback({});const sources=await desktopCapturer.getSources({types:['screen']});const {response}=await dialog.showMessageBox(window,{type:'question',message:'Choose the screen to record',buttons:[...sources.map(s=>s.name),'Cancel'],cancelId:sources.length,noLink:true});if(response>=sources.length)return callback({});callback({video:sources[response],...(process.platform==='win32'?{audio:'loopback'}:{})});}catch{callback({});}},{useSystemPicker:true});
 window=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:700,title:'OziCut',icon:packaged?path.join(process.resourcesPath,'icons','ozicut.png'):path.join(__dirname,'..','build','icons','ozicut.png'),backgroundColor:'#f8f8fa',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 window.webContents.session.on('will-download',(_event,item)=>{const safe=path.basename(item.getFilename());item.setSavePath(path.join(app.getPath('downloads'),safe));});
 ipcMain.handle('desktop:status',event=>{trusted(event);return {version:app.getVersion(),platform:process.platform,updates:update,packaged:packaged};});
 autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=true;
 for(const name of ['checking-for-update','update-available','update-not-available','download-progress','update-downloaded','error'])autoUpdater.on(name,value=>{update={state:name,detail:value instanceof Error?value.message:value};window?.webContents.send('desktop:update',update);});
 const configFile=path.join(__dirname,'..','release-config.json'),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 autoUpdater.setFeedURL({provider:'github',owner:config.owner,repo:config.repo});
 ipcMain.handle('desktop:updates',async(event,action)=>{trusted(event);if(process.env.OZICUT_TEST_OFFLINE==='1')throw Error('Updates unavailable offline');if(!packaged)return {state:'development-build'};if(action==='check')await autoUpdater.checkForUpdates();else if(action==='download')await autoUpdater.downloadUpdate();else if(action==='install')autoUpdater.quitAndInstall();else throw Error('Unknown update action');return update;});
 await window.loadURL(origin);if(process.env.OZICUT_TEST_READY)fs.writeFileSync(process.env.OZICUT_TEST_READY,JSON.stringify({origin,pid:process.pid,userData:app.getPath('userData')}));
}).catch(error=>{dialog.showErrorBox('OziCut could not start',error.stack||error.message);app.quit();});
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{backend?.stop();});
