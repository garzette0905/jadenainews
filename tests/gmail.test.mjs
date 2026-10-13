import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {connectGmail,gmailCallback,sendViewerEmail,emailMarkup} from '../worker/gmail.mjs';
import {localDB} from '../scripts/local-db.mjs';

function bucket(){
  const values=new Map();
  return {values,async put(key,value){values.set(key,value);return {};},async get(key){const value=values.get(key);return value===undefined?null:{json:async()=>typeof value==='string'?JSON.parse(value):value};},async delete(key){values.delete(key);}};
}
const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const article={url:'https://example.com/news/1',title:'A model launch',titleKo:'모델 출시',publisher:'Example',kind:'news',category:'launch',publishedAt:new Date().toISOString(),score:81,related:[],reasons:[],scores:{importance:20,preference:10,category:8,evidence:4,dislike:0}};

test('viewer digest escapes article content and keeps the requested recipient fixed',async()=>{
  const markup=emailMarkup({articles:[],ranked:[{...article,titleKo:'<script>alert(1)</script>',summary:'<b>safe text</b>'}]});
  assert.match(markup.html,/&lt;script&gt;/);assert.doesNotMatch(markup.html,/<script>/);assert.match(markup.plain,/01\. <script>alert\(1\)<\/script>/);
});

test('owner OAuth callback stores an encrypted refresh token and sends only the viewer snapshot',async()=>{
  const BUCKET=bucket(),DB={prepare(sql){return {bind(userId){return {first:async()=>({user_id:userId,email:'garzette@paran.com',role:'owner',status:'active'})};}};}};
  const env={BUCKET,DB,GMAIL_CLIENT_ID:'client-id',GMAIL_CLIENT_SECRET:'client-secret',GMAIL_TOKEN_KEY:key,GMAIL_SENDER_EMAIL:'garzette@gmail.com'};
  const originalFetch=globalThis.fetch;let sentRequest;
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'access-token',refresh_token:'refresh-token',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.send'}),{status:200});
    if(String(url)==='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'){sentRequest={url:String(url),options};return new Response(JSON.stringify({id:'gmail-message'}),{status:200});}
    throw new Error('unexpected request');
  };
  try{
    const connect=await connectGmail(env,{role:'owner',user_id:'owner-id',email:'garzette@paran.com'},new URL('https://news.example/'));
    assert.equal(connect.status,302);const authorization=new URL(connect.headers.get('location'));
    assert.equal(authorization.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.send');
    const state=authorization.searchParams.get('state');assert.ok(BUCKET.values.has(`private/gmail-oauth-state/${state}`));
    const callback=await gmailCallback(env,new Request('https://news.example/api/google/callback'),new URL(`https://news.example/api/google/callback?state=${state}&code=code`));
    assert.equal(callback.status,200);assert.match(await callback.text(),/연결이 완료되었습니다/);
    const stored=JSON.parse(BUCKET.values.get('private/gmail-refresh-token.json'));assert.ok(stored.ciphertext);assert.doesNotMatch(JSON.stringify(stored),/refresh-token/);
    const result=await sendViewerEmail(env,{articles:[],ranked:[article],collectedAt:new Date().toISOString()});
    assert.equal(result.ok,true);assert.equal(result.count,1);assert.equal(result.messageId,'gmail-message');
    assert.equal(sentRequest.url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(sentRequest.options.headers.Authorization,'Bearer access-token');
    const raw=JSON.parse(sentRequest.options.body).raw.replace(/-/g,'+').replace(/_/g,'/');
    const mime=Buffer.from(raw,'base64').toString('utf8');assert.match(mime,/To: garzette\.kim@samsung\.com/);assert.match(mime,/From: garzette@gmail\.com/);
    const htmlPart=mime.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    assert.match(Buffer.from(htmlPart.replace(/\s/g,''),'base64').toString('utf8'),/모델 출시/);
  }finally{globalThis.fetch=originalFetch;}
});

test('viewer email action accepts viewers but refuses owners before contacting Gmail',async()=>{
  const DB=localDB(),objects=new Map(),BUCKET={async get(k){const v=objects.get(k);return v?{json:async()=>JSON.parse(v)}:null;},async put(k,v){objects.set(k,v);return {};}};
  const env={DB,BUCKET};
  const request=(email,path='/api/viewer-email')=>new Request('https://news.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://news.test','oai-authenticated-user-id':email,'oai-authenticated-user-email':email},body:'{}'});
  try{
    await worker.fetch(new Request('https://news.test/api/me',{headers:{'oai-authenticated-user-id':'garzette@paran.com','oai-authenticated-user-email':'garzette@paran.com'}}),env);
    await worker.fetch(new Request('https://news.test/api/users',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://news.test','oai-authenticated-user-id':'garzette@paran.com','oai-authenticated-user-email':'garzette@paran.com'},body:JSON.stringify({action:'add',email:'reader@example.com'})}),env);
    const response=await worker.fetch(request('reader@example.com'),env);
    assert.equal(response.status,503);assert.match((await response.json()).error,/클라이언트 설정/);
    const ownerResponse=await worker.fetch(request('garzette@paran.com'),env);assert.equal(ownerResponse.status,403);
  }finally{DB.close();}
});
