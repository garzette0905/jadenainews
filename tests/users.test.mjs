import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../worker/index.js';
import {userDisplayName} from '../worker/users.mjs';
const owner='garzette@paran.com',viewer='viewer@example.com',admin='garzette.kim@samsungsds.com';
const request=(email,path='/api/users',data)=>new Request('https://news.test'+path,{method:data?'POST':'GET',headers:{'oai-authenticated-user-id':email,'oai-authenticated-user-email':email,Origin:'https://news.test','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});

test('profile names decode Korean UTF-8 and fall back safely to registered name or email',()=>{
  const profile=new Request('https://news.test',{headers:{'oai-authenticated-user-full-name':encodeURIComponent('김제이든'),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  assert.equal(userDisplayName(profile,'등록 이름',owner),'김제이든');
  const missing=new Request('https://news.test');assert.equal(userDisplayName(missing,'등록 이름',owner),'등록 이름');assert.equal(userDisplayName(missing,'',owner),owner);
  const malformed=new Request('https://news.test',{headers:{'oai-authenticated-user-full-name':'%E0%A4%A','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  assert.equal(userDisplayName(malformed,'등록 이름',owner),'등록 이름');
});

test('current-user API returns the signed-in display name without changing authorization',async()=>{
  const DB=localDB(),env={DB,BUCKET:{}};
  try{const original=request(owner,'/api/me'),headers=new Headers(original.headers);headers.set('oai-authenticated-user-full-name',encodeURIComponent('김제이든'));headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
    const r=await worker.fetch(new Request(original,{headers}),env);assert.equal(r.status,200);const me=await r.json();assert.equal(me.name,'김제이든');assert.equal(me.role,'owner');assert.equal(me.email,owner);
    assert.equal((await(await worker.fetch(request(owner,'/api/me'),env)).json()).name,'Jaden Kim');
  }finally{DB.close();}
});
test('DB user management authorizes owner, separates platform invitation and blocks disabled users',async()=>{
  const DB=localDB(),env={DB,BUCKET:{}};
  try{
    await worker.fetch(request(owner,'/api/users',{action:'add',email:viewer}),env);assert.equal((await worker.fetch(request(viewer),env)).status,403);
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
    await worker.fetch(request(owner,'/api/users',{action:'add',email:viewer}),env);const ownerResponse=await worker.fetch(request(owner,'/api/me'),env);assert.equal(ownerResponse.status,200,await ownerResponse.text());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner))),b=>b.toString(16).padStart(2,'0')).toString();
    objects.set('news/'+hash+'.json',{articles:[{title:'관리자 수집 결과'}],ranked:[],feedback:[],revision:2});
    const result=await(await worker.fetch(request(viewer,'/api/state'),env)).json();assert.equal(result.articles[0].title,'관리자 수집 결과');
    for(const path of ['/api/collect','/api/feedback','/api/likes','/api/collection','/api/users'])assert.equal((await worker.fetch(request(viewer,path,{vote:1}),env)).status,403,path);
    assert.equal((await worker.fetch(request(viewer,'/api/jobs/anything'),env)).status,403);
    assert.equal((await worker.fetch(request(owner,'/api/users'),env)).status,200);
  }finally{DB.close();}
});


test('persisted admin shares owner news, feedback and collection jobs',async()=>{
  const DB=localDB(),objects=new Map(),BUCKET={async get(k){const v=objects.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.body)}:null;},async put(k,body){const v={etag:crypto.randomUUID(),body};objects.set(k,v);return v;},async delete(k){objects.delete(k);}},env={DB,BUCKET};
  try{
    // Preserve the existing deployed administrator flag rather than promoting on every request.
    await DB.prepare("INSERT INTO users (email,user_id,role,status,created_at,is_admin) VALUES (?,?,'viewer','active',?,1)").bind(admin,admin,new Date().toISOString()).run();
    await worker.fetch(request(owner,'/api/me'),env);
    const me=await(await worker.fetch(request(admin,'/api/me'),env)).json();assert.equal(me.role,'admin');
    assert.equal((await worker.fetch(request(admin,'/api/users'),env)).status,200);
    assert.equal((await worker.fetch(request(admin,'/api/feedback',{url:'https://example.com/team-ai',vote:1}),env)).status,200);
    const ownerState=await(await worker.fetch(request(owner,'/api/state'),env)).json();assert.equal(ownerState.feedback[0].url,'https://example.com/team-ai');
    const adminState=await(await worker.fetch(request(admin,'/api/state'),env)).json();assert.deepEqual(adminState,ownerState);
    assert.equal((await worker.fetch(request(admin,'/api/users',{action:'add',email:viewer}),env)).status,200);
    const agent=(path,body)=>new Request('https://news.test/api/agent/'+path,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});env.NEWS_AGENT_SECRET='test';
    await worker.fetch(agent('heartbeat',{models:[{slug:'test'}]}),env);
    const queued=await worker.fetch(request(admin,'/api/collect',{model:'test'}),env);assert.equal(queued.status,202);const job=await queued.json();
    assert.equal((await worker.fetch(request(owner,'/api/jobs/'+job.id),env)).status,200);
    assert.equal((await worker.fetch(request(admin,'/api/jobs/'+job.id),env)).status,200);
    assert.equal((await worker.fetch(request(viewer,'/api/jobs/'+job.id),env)).status,403);
    assert.equal((await worker.fetch(request(admin,'/api/users',{action:'disable',email:owner}),env)).status,400);
    assert.equal((await worker.fetch(request(admin,'/api/users',{action:'disable',email:admin}),env)).status,400);
    await worker.fetch(request(owner,'/api/users',{action:'disable',email:admin}),env);
    assert.equal((await worker.fetch(request(admin,'/api/me'),env)).status,403);
  }finally{DB.close();}
});


test('owner can change roles in both directions; demoted accounts stay demoted across later logins',async()=>{
  const DB=localDB(),env={DB,BUCKET:{}};
  try{
    await worker.fetch(request(owner,'/api/me'),env);
    assert.equal((await(await worker.fetch(request(admin,'/api/me'),env)).json()).role,'admin');
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'set-role',email:admin,role:'viewer'}),env)).status,200);
    assert.equal((await(await worker.fetch(request(admin,'/api/me'),env)).json()).role,'viewer');
    await worker.fetch(request(owner,'/api/me'),env);
    assert.equal((await(await worker.fetch(request(admin,'/api/me'),env)).json()).role,'viewer');
    assert.equal((await worker.fetch(request(admin,'/api/users'),env)).status,403);
    assert.equal((await worker.fetch(request(admin,'/api/collect',{model:'test'}),env)).status,403);
    assert.equal((await worker.fetch(request(admin,'/api/feedback',{url:'https://example.com/a',vote:1}),env)).status,403);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'set-role',email:admin,role:'admin'}),env)).status,200);
    assert.equal((await(await worker.fetch(request(admin,'/api/me'),env)).json()).role,'admin');
    assert.equal((await worker.fetch(request(admin,'/api/users'),env)).status,200);
    await worker.fetch(request(owner,'/api/users',{action:'add',email:viewer}),env);
    assert.equal((await worker.fetch(request(admin,'/api/users',{action:'set-role',email:viewer,role:'admin'}),env)).status,403);
    assert.equal((await worker.fetch(request(viewer,'/api/users',{action:'set-role',email:viewer,role:'admin'}),env)).status,403);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'set-role',email:viewer,role:'owner'}),env)).status,400);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'set-role',email:owner,role:'viewer'}),env)).status,400);
    assert.equal((await worker.fetch(request(owner,'/api/users',{action:'set-role',email:'missing@example.com',role:'admin'}),env)).status,404);
    await worker.fetch(request(owner,'/api/users',{action:'disable',email:viewer}),env);
    await worker.fetch(request(owner,'/api/users',{action:'set-role',email:viewer,role:'admin'}),env);
    assert.equal((await worker.fetch(request(viewer,'/api/me'),env)).status,403);
    const row=await DB.prepare('SELECT * FROM users WHERE email = ?').bind(admin).first();assert.equal(row.user_id,admin);assert.equal(row.is_admin,1);
  }finally{DB.close();}
});
