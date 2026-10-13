import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from '../scripts/local-db.mjs';
import worker from '../worker/index.js';
import {member} from '../worker/users.mjs';
const origin='https://news.test';
const req=(path,data,cookie,extra={})=>new Request(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:data?JSON.stringify(data):undefined});
async function fixture(){const DB=localDB(),env={DB,BUCKET:{get:async()=>null},APP_LOGIN:'1',LOGIN_PASSWORD:crypto.randomUUID()};await member(env,new Request(origin,{headers:{'oai-authenticated-user-email':'garzette@paran.com'}}),'original-owner');return env;}
async function signIn(env,id='garzette'){return worker.fetch(req('/api/login',{loginId:id,password:env.LOGIN_PASSWORD}),env);}
test('public app requires its own session even when platform identity exists; login and logout use secure opaque cookies',async()=>{
 const env=await fixture();try{
  for(const path of ['/api/me','/api/state','/api/news','/api/users','/api/runtime'])assert.equal((await worker.fetch(req(path,undefined,undefined,{'oai-authenticated-user-id':'original-owner','oai-authenticated-user-email':'garzette@paran.com'}),env)).status,401);
  assert.equal((await worker.fetch(req('/api/login',{loginId:'garzette',password:'invalid'}),env)).status,401);
  const response=await signIn(env);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.includes(env.LOGIN_PASSWORD));
  const me=await (await worker.fetch(req('/api/me',undefined,cookie),env)).json();assert.equal(me.role,'owner');assert.equal(me.loginId,'garzette');
  assert.equal((await worker.fetch(req('/api/state',undefined,cookie),env)).status,200);
  assert.equal((await worker.fetch(req('/api/logout',{},cookie),env)).status,200);assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
 }finally{env.DB.close();}
});
test('registered IDs preserve email, support edits, reject duplicates and apply permissions and disable immediately',async()=>{
 const env=await fixture();try{const cookie=(await signIn(env)).headers.get('set-cookie');
  const edit=data=>worker.fetch(req('/api/users',data,cookie),env);
  assert.equal((await edit({action:'add',email:'planner@example.com',loginId:'planner-one',name:'기획자'})).status,200);
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
  assert.equal((await worker.fetch(req('/api/login',{loginId:'garzette',password:env.LOGIN_PASSWORD},undefined,{Origin:'https://elsewhere.test'}),env)).status,403);
  const cookie=(await signIn(env)).headers.get('set-cookie');await env.DB.prepare('UPDATE app_sessions SET expires_at = ?').bind(0).run();assert.equal((await worker.fetch(req('/api/me',undefined,cookie),env)).status,401);
  assert.equal((await worker.fetch(req('/api/me',undefined,'__Host-news-session=forged'),env)).status,401);
  for(let i=0;i<14;i++)assert.equal((await worker.fetch(req('/api/login',{loginId:'missing',password:'incorrect'}),env)).status,401);
  assert.equal((await signIn(env)).status,429);
 }finally{env.DB.close();}
});
