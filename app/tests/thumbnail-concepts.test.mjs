import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleConcepts,thumbnailConcepts,keywordsOf} from '../thumbnail-concepts.mjs';
const json=(body,ok=true)=>({ok,json:async()=>body});
const sample='Voici 5 erreurs qui coûtent cher. Pourquoi votre application ne décolle pas ? Le secret, c est la simplicité. Une application simple gagne.';
test('rule concepts keep hooks contiguous, keep negations and turn spelled numbers into digits',()=>{
 const c=ruleConcepts(sample);assert.equal(c.length,3);assert.ok(c.every(x=>x.source==='rules'&&x.text.split(' ').length<=7));
 assert.equal(c[0].text,'5 erreurs qui coûtent');assert.match(c[1].text,/ne décolle pas \?$/);
 assert.equal(ruleConcepts('Il existe sept approches pour lancer une application.')[0].text,'7 approches pour lancer');
 assert.ok(!keywordsOf('est-ce que est-ce que application application').includes('est-ce'));
});
test('Ollama concepts are used when a local model answers, with the highlighted word located',async()=>{
 const fetchImpl=async url=>url.endsWith('/api/tags')?json({models:[{name:'nomic-embed-text'},{name:'qwen2.5:7b'}]}):json({message:{content:JSON.stringify({concepts:[{angle:'Chiffre',text:'5 erreurs fatales',highlight:'erreurs'},{angle:'Question',text:'Ton app décolle ?',highlight:'décolle'},{angle:'Promesse',text:'Le secret : simplicité',highlight:'simplicité'}]})}});
 const r=await thumbnailConcepts({text:sample},{fetchImpl});assert.equal(r.engine,'Ollama · qwen2.5:7b');assert.equal(r.concepts[0].highlight,1);assert.equal(r.concepts[1].text,'Ton app décolle ?');
});
test('without Ollama (or with a broken answer) the free rules engine answers instead',async()=>{
 const down=async()=>{throw Error('ECONNREFUSED');};assert.equal((await thumbnailConcepts({text:sample},{fetchImpl:down})).engine,'Règles locales');
 const broken=async url=>url.endsWith('/api/tags')?json({models:[{name:'qwen2.5:7b'}]}):json({message:{content:'pas du json'}});assert.equal((await thumbnailConcepts({text:sample},{fetchImpl:broken})).engine,'Règles locales');
 await assert.rejects(thumbnailConcepts({text:'  '}),/transcription est vide/);
});
