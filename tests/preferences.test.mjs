import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {preferenceFeedback,researchInput,mergeFeedbackDetails} from '../shared/news.mjs';
import {readPreferenceArticles,fetchEvidence} from '../bridge/evidence.mjs';
import {sourceSearchBatches} from '../bridge/discovery.mjs';
const now=Date.parse('2026-11-15T10:00:00Z');
const vote=(i=0)=>({url:`https://publisher${i}.example/ai`,vote:1,updatedAt:new Date(now-i*1000).toISOString(),title:'AI launch',summary:'x'.repeat(1500)});
function storage(){const entries=new Map();return {async get(k){const v=entries.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.body)}:null;},async put(k,body,{onlyIf}={}){const prior=entries.get(k);if(onlyIf?.etagMatches&&prior?.etag!==onlyIf.etagMatches)return null;if(onlyIf?.etagDoesNotMatch==='*'&&prior)return null;const v={etag:crypto.randomUUID(),body};entries.set(k,v);return v;}};}
const req=(path,body)=>new Request('https://news.example'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'owner',...(body?{'Content-Type':'application/json',Origin:'https://news.example'}:{})},body:body?JSON.stringify(body):undefined});
test('manual saves survive reload, deduplicate canonical URLs and preserve over 400 records',async()=>{
 const env={BUCKET:storage(),LOCAL_PREVIEW:'test-no-db'};
 for(let i=0;i<410;i+=10){const response=await worker.fetch(req('/api/likes',{urls:Array.from({length:10},(_,j)=>vote(i+j).url)}),env);assert.equal(response.status,200);}
 const state=await (await worker.fetch(req('/api/state'),env)).json();assert.equal(state.feedback.length,410);assert.equal(state.feedback[0].url,vote(0).url);assert.equal(state.feedback[0].contentStatus,'pending');
 const before=state.feedback[0];await worker.fetch(req('/api/likes',{urls:[vote(0).url+'?utm_source=duplicate#section']}),env);
 const reloaded=await (await worker.fetch(req('/api/state'),env)).json();assert.equal(reloaded.feedback.length,410);assert.deepEqual(reloaded.feedback[0],before);
 const rejected=await worker.fetch(req('/api/likes',{urls:['https://new.example/valid','javascript:alert(1)']}),env);assert.equal(rejected.status,400);assert.equal((await (await worker.fetch(req('/api/state'),env)).json()).feedback.length,410);
 await worker.fetch(req('/api/feedback',{url:vote(0).url,vote:0}),env);assert.equal((await (await worker.fetch(req('/api/state'),env)).json()).feedback.length,409);
});
test('thousands of saved votes have a fixed AI context and source-search budget',()=>{
 const feedback=Array.from({length:5000},(_,i)=>vote(i));const compact=preferenceFeedback(feedback,now);assert.ok(compact.length<=60);assert.ok(JSON.stringify(compact).length<=16000);assert.equal(compact[0].url,feedback[0].url);
 const input=researchInput({feedback,previous:Array.from({length:250},()=>({content:'p'.repeat(5000)})),now:new Date(now).toISOString(),candidates:Array.from({length:40},()=>({content:'a'.repeat(6000)}))});assert.equal(input.previous.length,0);assert.equal(input.candidates.length,20);assert.ok(input.candidates.every(a=>a.content.length===1800));
 const coverage=Array.from({length:32},(_,i)=>({publisher:`Outlet ${i}`,status:'needs-search'}));const batches=sourceSearchBatches(coverage,compact,'test');assert.equal(batches.length,3);assert.ok(batches.every(b=>b.coverage.length<=8));assert.equal(batches[0].coverage[0].domain,'publisher0.example');assert.deepEqual(sourceSearchBatches(coverage,compact,'source-ranking'),[]);
});
test('registered old articles are read once without AI or news date requirements; failures back off',async()=>{
 const feedback=Array.from({length:15},(_,i)=>({...vote(i),title:'',summary:''}));let calls=0;
 const fetcher=async()=>{calls++;return new Response('<meta property="og:title" content="Claude manufacturing"><meta property="og:description" content="Claude adds seventeen manufacturing workflow skills for industrial teams to automate work."><meta property="article:published_time" content="2020-01-01">');};
 const updates=await readPreferenceArticles(feedback,{now,fetcher});assert.equal(calls,10);assert.equal(updates.length,10);assert.ok(updates.every(u=>u.contentStatus==='ready'));assert.ok(!updates.some(u=>u.publishedAt));
 const enriched=mergeFeedbackDetails(feedback,updates);calls=0;await readPreferenceArticles(enriched.slice(0,10),{now:now+1000,fetcher});assert.equal(calls,0);
 const failed=await readPreferenceArticles([{...feedback[0],title:'',summary:''}],{now,fetcher:async()=>new Response('',{status:403})});assert.equal(failed[0].contentStatus,'failed');calls=0;await readPreferenceArticles(mergeFeedbackDetails(feedback.slice(0,1),failed),{now:now+1000,fetcher});assert.equal(calls,0);
});
test('late content enrichment cannot revive deleted votes or overwrite a changed vote',()=>{
 const f=vote(),u={...f,title:'Original content',contentStatus:'ready',checkedAt:new Date(now).toISOString()};assert.deepEqual(mergeFeedbackDetails([], [u]),[]);assert.equal(mergeFeedbackDetails([{...f,vote:-1}],[u])[0].vote,-1);assert.equal(mergeFeedbackDetails([{...f,updatedAt:new Date(now+1).toISOString()}],[u])[0].title,f.title);assert.equal(mergeFeedbackDetails([f],[u])[0].title,u.title);
});
test('original evidence cache avoids repeat HTTP reads and invalidates changed feeds and six-hour expiry',async()=>{
 const row={...vote(),publisher:'Publisher',publishedAt:new Date(now).toISOString(),kind:'news'},cache={};let calls=0;
 const fetcher=async()=>{calls++;return new Response('<title>AI release</title><meta property="article:published_time" content="2026-11-15T09:00:00Z">');};
 const first=await fetchEvidence([row],{now,cache,fetcher});assert.equal(first.evidence.size,1);
 await fetchEvidence([row],{now:now+1000,cache,fetcher});assert.equal(calls,1);
 await fetchEvidence([{...row,title:'Changed'}],{now:now+2000,cache,fetcher});assert.equal(calls,2);
 await fetchEvidence([{...row,title:'Changed'}],{now:now+7*3600000,cache,fetcher});assert.equal(calls,3);
});
