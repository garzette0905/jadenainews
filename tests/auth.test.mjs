import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../worker/index.js';
import {member} from '../worker/users.mjs';
const origin='https://news.test';
const req=(path,data,cookie,extra={})=>new Request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:data?JSON.stringify(data):undefined});
async function fixture(){const DB=localDB(),env={DB,BUCKET:{get:async()=>null},APP_LOGIN:'1',OWNER_BOOTSTRAP_PASSWORD:crypto.randomUUID()};await member(env,new Request(origin,{headers:{'oai-authenticated-user-email':'garzette@paran.com'}}),'original-owner');return env;}
async function signIn(env,id='garzette',password=env.OWNER_BOOTSTRAP_PASSWORD){return worker.fetch(req('/api/login',{loginId:id,password}),env);}

test('embedded login uses a secure partitioned session and logout clears the matching cookie',async()=>{
 const env=await fixture();try{
  const response=await worker.fetch(req('/api/login',{loginId:'garzette',password:env.OWNER_BOOTSTRAP_PASSWORD,embedded:true}),env);
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');
  assert.match(cookie,/^__Host-news-session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=86400$/);
  assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/news',undefined,cookie),env)).status,200);
  const directCookie=(await signIn(env)).headers.get('set-cookie');
  assert.match(directCookie,/SameSite=Strict/);assert.ok(!directCookie.includes('Partitioned'));
  const loggedOut=await worker.fetch(req('/api/logout',{embedded:true},cookie),env);
  assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('set-cookie'),/SameSite=None; Partitioned; Max-Age=0$/);
  assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
  assert.equal((await worker.fetch(req('/api/me',undefined,directCookie),env)).status,200);
  for(const embedded of [false,'true',1,null]){
    const r=await worker.fetch(req('/api/login',{loginId:'garzette',password:env.OWNER_BOOTSTRAP_PASSWORD,embedded}),env);
    assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
  }
 }finally{env.DB.close();}
});

test('embedded sessions retain same-origin JSON write checks and password-reset revocation',async()=>{
 const env=await fixture();try{
  const data={loginId:'garzette',password:env.OWNER_BOOTSTRAP_PASSWORD,embedded:true};
  assert.equal((await worker.fetch(req('/api/login',data,undefined,{Origin:'https://japis.example'}),env)).status,403);
  const cookie=(await worker.fetch(req('/api/login',data),env)).headers.get('set-cookie');
  assert.equal((await worker.fetch(req('/api/feedback',{url:'https://example.com/news',vote:1},cookie,{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await worker.fetch(req('/api/feedback',{url:'https://example.com/news',vote:1},cookie,{'Content-Type':'text/plain'}),env)).status,415);
  assert.equal((await worker.fetch(req('/api/logout',{embedded:true},cookie,{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'garzette@paran.com',password:crypto.randomUUID()},cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
 }finally{env.DB.close();}
});
test('public app requires its own session even when platform identity exists; login and logout use secure opaque cookies',async()=>{
 const env=await fixture();try{
  for(const path of ['/api/me','/api/state','/api/news','/api/users','/api/runtime'])assert.equal((await worker.fetch(req(path,undefined,undefined,{'oai-authenticated-user-id':'original-owner','oai-authenticated-user-email':'garzette@paran.com'}),env)).status,401);
  assert.equal((await worker.fetch(req('/api/login',{loginId:'garzette',password:'invalid'}),env)).status,401);
  const response=await signIn(env);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.includes(env.OWNER_BOOTSTRAP_PASSWORD));
  const me=await (await worker.fetch(req('/api/me',undefined,cookie),env)).json();assert.equal(me.role,'owner');assert.equal(me.loginId,'garzette');
  assert.equal((await worker.fetch(req('/api/state',undefined,cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/logout',{},cookie),env)).status,200);assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
 }finally{env.DB.close();}
});
test('owner signs in with email and per-user passwords are salted and never exposed by management',async()=>{
 const env=await fixture();try{
  const response=await signIn(env,'GARZETTE@PARAN.COM');assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');
  const password=crypto.randomUUID();assert.equal((await worker.fetch(req('/api/users',{action:'add',email:'new-admin@example.com',loginId:'new-admin',role:'admin',password},cookie),env)).status,200);
  assert.equal((await signIn(env,'new-admin')).status,401);
  const userCookie=(await signIn(env,'new-admin',password)).headers.get('set-cookie');assert.ok(userCookie);
  const me=await (await worker.fetch(req('/api/me',undefined,userCookie),env)).json();assert.equal(me.role,'admin');
  const data=await (await worker.fetch(req('/api/users',undefined,cookie),env)).json();const text=JSON.stringify(data);assert.ok(!text.includes(password));assert.ok(!text.includes('password_hash'));assert.ok(!text.includes('password_salt'));assert.equal(data.users.find(u=>u.login_id==='new-admin').password_set,1);
  const rows=(await env.DB.prepare('SELECT password_hash,password_salt FROM users').all()).results;assert.ok(rows.every(u=>u.password_hash.length===64&&u.password_salt.length===32));assert.notEqual(rows[0].password_salt,rows[1].password_salt);
 }finally{env.DB.close();}
});
test('password resets revoke sessions and old passwords without changing news ownership or role',async()=>{
 const env=await fixture();try{const cookie=(await signIn(env)).headers.get('set-cookie'),password=crypto.randomUUID(),replacement=crypto.randomUUID();
  await worker.fetch(req('/api/users',{action:'add',email:'reader@example.com',loginId:'reader-one',password},cookie),env);
  const oldCookie=(await signIn(env,'reader-one',password)).headers.get('set-cookie');assert.ok(oldCookie);
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'reader@example.com',password:replacement},oldCookie),env)).status,403);
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'reader@example.com',password:'short'},cookie),env)).status,400);
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'reader@example.com',password:replacement},cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/state',undefined,oldCookie),env)).status,401);assert.equal((await signIn(env,'reader-one',password)).status,401);
  const nextCookie=(await signIn(env,'reader-one',replacement)).headers.get('set-cookie');assert.ok(nextCookie);assert.equal((await (await worker.fetch(req('/api/me',undefined,nextCookie),env)).json()).role,'viewer');
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'garzette@paran.com',password:replacement},cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);assert.equal((await signIn(env)).status,401);assert.equal((await signIn(env,'garzette@paran.com',replacement)).status,200);
  assert.equal((await env.DB.prepare("SELECT user_id FROM users WHERE role = 'owner'").first()).user_id,'original-owner');
 }finally{env.DB.close();}
});
test('deleted accounts and their sessions stay deleted; admins cannot reset or delete the owner',async()=>{
 const env=await fixture();try{const cookie=(await signIn(env)).headers.get('set-cookie'),password=crypto.randomUUID();
  await worker.fetch(req('/api/users',{action:'add',email:'manager@example.com',loginId:'manager-one',role:'admin',password},cookie),env);
  const adminCookie=(await signIn(env,'manager-one',password)).headers.get('set-cookie');assert.ok(adminCookie);
  assert.equal((await worker.fetch(req('/api/users',{action:'set-password',email:'garzette@paran.com',password},adminCookie),env)).status,403);
  assert.equal((await worker.fetch(req('/api/users',{action:'delete',email:'garzette@paran.com'},cookie),env)).status,400);
  assert.equal((await worker.fetch(req('/api/users',{action:'delete',email:'manager@example.com'},adminCookie),env)).status,400);
  assert.equal((await worker.fetch(req('/api/users',{action:'delete',email:'manager@example.com'},cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/me',undefined,adminCookie),env)).status,401);assert.equal((await signIn(env,'manager-one',password)).status,401);
  await member(env,new Request(origin,{headers:{'oai-authenticated-user-email':'garzette@paran.com'}}),'original-owner');
  assert.equal(await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind('manager@example.com').first(),null);
  assert.equal((await worker.fetch(req('/api/users',{action:'delete',email:'manager@example.com'},cookie),env)).status,404);
 }finally{env.DB.close();}
});
test('creating accounts requires a password and migration invalidates legacy sessions',async()=>{
 const env=await fixture();try{const cookie=(await signIn(env)).headers.get('set-cookie');
  assert.equal((await worker.fetch(req('/api/users',{action:'add',email:'reader@example.com',loginId:'reader-one'},cookie),env)).status,400);
  assert.equal(await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind('reader@example.com').first(),null);
  const token='a'.repeat(64),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('INSERT INTO app_sessions (token_hash,email,expires_at) VALUES (?,?,?)').bind(hash,'garzette@paran.com',Date.now()+60000).run();
  assert.equal((await worker.fetch(req('/api/me',undefined,'__Host-news-session='+token),env)).status,401);
 }finally{env.DB.close();}
});
test('registered IDs preserve email, support edits, reject duplicates and apply permissions and disable immediately',async()=>{
 const env=await fixture();try{const cookie=(await signIn(env)).headers.get('set-cookie');
  const edit=data=>worker.fetch(req('/api/users',data,cookie),env);
  assert.equal((await edit({action:'add',email:'planner@example.com',loginId:'planner-one',name:'기획자',password:env.OWNER_BOOTSTRAP_PASSWORD})).status,200);
  assert.equal((await edit({action:'add',email:'other@example.com',loginId:'planner-one'})).status,409);
  assert.equal((await edit({action:'add',email:'invalid',loginId:'planner-two'})).status,400);
  assert.equal((await edit({action:'set-login-id',email:'planner@example.com',loginId:'planner-new'})).status,200);
  assert.equal((await signIn(env,'planner-one')).status,401);
  const userCookie=(await signIn(env,'planner-new')).headers.get('set-cookie');assert.ok(userCookie);
  assert.equal((await worker.fetch(req('/api/users',undefined,userCookie),env)).status,403);
  assert.equal((await worker.fetch(req('/api/feedback',{vote:1},userCookie),env)).status,403);
  await edit({action:'set-role',email:'planner@example.com',role:'admin'});assert.equal((await worker.fetch(req('/api/users',undefined,userCookie),env)).status,200);
  await edit({action:'disable',email:'planner@example.com'});assert.equal((await worker.fetch(req('/api/state',undefined,userCookie),env)).status,401);assert.equal((await signIn(env,'planner-new')).status,401);
  const row=await env.DB.prepare('SELECT user_id FROM users WHERE role = ?').bind('owner').first();assert.equal(row.user_id,'original-owner');
 }finally{env.DB.close();}
});
test('invalid, expired sessions, cross-origin login and repeated guesses are rejected',async()=>{
 const env=await fixture();try{
  assert.equal((await worker.fetch(req('/api/login',{loginId:'garzette',password:env.OWNER_BOOTSTRAP_PASSWORD},undefined,{Origin:'https://elsewhere.test'}),env)).status,403);
  const cookie=(await signIn(env)).headers.get('set-cookie');await env.DB.prepare('UPDATE app_sessions SET expires_at = ?').bind(0).run();assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
  assert.equal((await worker.fetch(req('/api/me',undefined,'__Host-news-session=forged'),env)).status,401);
  for(let i=0;i<14;i++)assert.equal((await worker.fetch(req('/api/login',{loginId:'missing',password:'incorrect'}),env)).status,401);
  assert.equal((await signIn(env)).status,429);
 }finally{env.DB.close();}
});
