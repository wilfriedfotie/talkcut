import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProjectStore,validateProject} from '../project-store.mjs';
const make=()=>({id:'project-a',name:'Story',compositions:[{id:'comp-a',name:'Main',assetIds:[],words:[]}]});
test('version history retains distinct states and skips duplicate autosaves',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ozicut-history-'));const store=createProjectStore(dir);const p=make();await store.save(p);await store.save(p);assert.equal((await store.history(p.id)).length,1);p.name='A new title';await store.save(p);const versions=await store.history(p.id);assert.equal(versions.length,2);assert.equal((await store.version(p.id,versions[1].id)).name,'Story');});
test('timestamped comments persist separately from autosaved composition edits',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ozicut-comments-'));const store=createProjectStore(dir);const p=make();await store.save(p);const c=await store.addComment(p.id,{text:'Keep this moment',time:3.5,compositionId:'comp-a'});await store.save({...p,name:'Renamed'});assert.equal((await store.comments(p.id))[0].time,3.5);await store.resolveComment(p.id,c.id,true);assert.equal((await store.comments(p.id))[0].resolved,true);});
test('malformed project timing and filesystem-like identifiers are rejected',()=>{assert.throws(()=>validateProject({...make(),id:'../escape'}));const p=make();p.compositions[0].words=[{id:'w',assetId:'a',text:'bad',start:5,end:2}];assert.throws(()=>validateProject(p),/minutage/);});
test('remove deletes the project, its history and comments, and refuses unknown ids',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ozicut-remove-')),store=createProjectStore(dir);
 const project={id:'p1',name:'À jeter',compositions:[{id:'c1',name:'C',assetIds:[],words:[]}]};
 await store.save(project);await store.addComment('p1',{compositionId:'c1',text:'note',time:0});
 assert.equal((await store.remove('p1')).name,'À jeter');
 assert.deepEqual(await store.list(),[]);assert.deepEqual(await store.history('p1'),[]);assert.deepEqual(await store.comments('p1'),[]);
 await assert.rejects(store.remove('p1'),/introuvable/);await assert.rejects(store.remove('../x'),/./);
});
