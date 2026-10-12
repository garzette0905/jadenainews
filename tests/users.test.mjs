import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../worker/index.js';
const owner='garzette@paran.com',viewer='garzette.kim@samsungsds.com';
const request=(email,path='/api/users',data)=>new Request('https://news.test'+path,{method:data?'POST':'GET',headers:{'oai-authenticated-user-id':email,'oai-authenticated-user-email':email,Origin:'https://news.test','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
test('DB user management authorizes owner, separates platform invitation and blocks disabled users',async()=>{
  const DB=localDB(),env={DB,BUCKET:{}};
  try{
    assert.equal((await worker.fetch(request(viewer),env)).status,403);
    assert.equal((await worker.fetch(request(owner),env)).status,200);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'add',email:'new@example.com',name:'새 사용자'}),env)).status,200);
    const users=await(await worker.fetch(request(owner),env)).json();assert.equal(users.users.find(u=>u.email==='new@example.com').status,'pending');
    assert.equal((await worker.fetch(request('new@example.com','/api/me'),env)).status,200);
    await worker.fetch(request(owner,'/api/users',{action:'disable',email:'new@example.com'}),env);
    assert.equal((await worker.fetch(request('new@example.com','/api/me'),env)).status,403);
    assert.equal((await worker.fetch(request('unknown@example.com','/api/me'),env)).status,403);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'disable',email:owner}),env)).status,400);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'add',email:'bad'}),env)).status,400);
  }finally{DB.close();}
});
test('viewers read owner news and cannot collect, vote, add likes or modify users',async()=>{
  const DB=localDB(),objects=new Map(),BUCKET={async get(k){const value=objects.get(k);return value?{json:async()=>value}:null;}},env={DB,BUCKET};
  try{
    const ownerResponse=await worker.fetch(request(owner,'/api/me'),env);assert.equal(ownerResponse.status,200,await ownerResponse.text());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner))),b=>b.toString(16).padStart(2,'0')).toString();
    objects.set('news/'+hash+'.json',{articles:[{title:'관리자 수집 결과'}],ranked:[],feedback:[],revision:2});
    const result=await(await worker.fetch(request(viewer,'/api/state'),env)).json();assert.equal(result.articles[0].title,'관리자 수집 결과');
    for(const path of ['/api/collect','/api/feedback','/api/likes','/api/collection','/api/users'])assert.equal((await worker.fetch(request(viewer,path,{vote:1}),env)).status,403,path);
    assert.equal((await worker.fetch(request(viewer,'/api/jobs/anything'),env)).status,403);
    assert.equal((await worker.fetch(request(owner,'/api/users'),env)).status,200);
  }finally{DB.close();}
});
