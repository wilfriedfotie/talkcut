// Development only (macOS): the Dock and Cmd+Tab show the .app folder name, so the unpackaged
// Electron runtime appears as "Electron". Rename it to OziCut.app, give it the OziCut name, icon and
// bundle id, and point the electron package at it. Idempotent; reruns after every `npm install`.
// Packaged builds are unaffected (electron-builder downloads its own runtime).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(process.platform!=='darwin')process.exit(0);
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=path.join(root,'node_modules','electron'),dist=path.join(pkg,'dist');
const from=path.join(dist,'Electron.app'),to=path.join(dist,'OziCut.app');
if(fs.existsSync(from)){fs.rmSync(to,{recursive:true,force:true});fs.renameSync(from,to);}
if(!fs.existsSync(to)){console.warn('dev-app-name: no Electron runtime found, skipped');process.exit(0);}
const plist=path.join(to,'Contents','Info.plist'),buddy=cmd=>execFileSync('/usr/libexec/PlistBuddy',['-c',cmd,plist]);
const read=key=>{try{return execFileSync('/usr/libexec/PlistBuddy',['-c',`Print ${key}`,plist],{encoding:'utf8'}).trim();}catch{return null;}};
const wanted={CFBundleName:'OziCut',CFBundleDisplayName:'OziCut',CFBundleIdentifier:'com.ozirus.ozicut.dev',CFBundleExecutable:'OziCut'};
let changed=false;
// macOS names the running process after the executable, so rename it too (as electron-builder does).
const macos=path.join(to,'Contents','MacOS');if(fs.existsSync(path.join(macos,'Electron'))){fs.renameSync(path.join(macos,'Electron'),path.join(macos,'OziCut'));changed=true;}
for(const [key,value] of Object.entries(wanted))if(read(key)!==value){buddy(read(key)===null?`Add ${key} string ${value}`:`Set ${key} ${value}`);changed=true;}
const icon=path.join(to,'Contents','Resources','electron.icns'),source=path.join(root,'build','icons','ozicut.icns');
if(!fs.existsSync(icon)||!fs.readFileSync(icon).equals(fs.readFileSync(source))){fs.copyFileSync(source,icon);changed=true;}
fs.writeFileSync(path.join(pkg,'path.txt'),'OziCut.app/Contents/MacOS/OziCut');
if(changed){
 // Editing Info.plist breaks the runtime's ad-hoc signature; re-sign it so macOS keeps launching it.
 execFileSync('codesign',['--force','--deep','--sign','-',to],{stdio:'ignore'});
 try{execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',to],{stdio:'ignore'});}catch{}
 console.log('dev-app-name: Electron runtime renamed to OziCut.app');
}
