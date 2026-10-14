import {savedRanking,recommendationSections} from '../shared/news.mjs';

const TOKEN_KEY='private/gmail-refresh-token.json';
const SCOPE='https://www.googleapis.com/auth/gmail.send';
const SENDER='garzette@gmail.com';
async function newsRecipients(env){
  if(!env.DB)throw Object.assign(new Error('사용자 DB가 연결되지 않았습니다.'),{status:503});
  return (await env.DB.prepare("SELECT email FROM users WHERE news_email_enabled = 1 AND status != 'disabled' ORDER BY email").all()).results.map(row=>row.email);
}
export async function gmailStatus(env){
  const missing=['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_TOKEN_KEY'].filter(key=>!env[key]);
  const configured=missing.length===0;
  let connected=false;
  if(configured){try{connected=!!(await loadToken(env))?.refresh_token;}catch{}}
  const last=await env.BUCKET.get('private/gmail-last-send.json');
  return {configured,connected,missing,recipientCount:env.DB?(await newsRecipients(env)).length:0,lastSentAt:last?(await last.json()).sentAt:null};
}
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const utf8=s=>new TextEncoder().encode(s);
const b64url=bytes=>{
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const b64=bytes=>{
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
};
const wrap=s=>s.match(/.{1,76}/g)?.join('\r\n')||'';
const randomHex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const decodeKey=value=>{
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
async function cryptKey(env){
  if(!env.GMAIL_TOKEN_KEY)throw Object.assign(new Error('메일 암호화 키가 Sites에 설정되지 않았습니다.'),{status:503});
  const bytes=decodeKey(env.GMAIL_TOKEN_KEY);
  if(bytes.length!==32)throw Object.assign(new Error('메일 암호화 키 설정이 올바르지 않습니다.'),{status:503});
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function saveToken(env,token){
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await cryptKey(env);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,utf8(JSON.stringify(token)));
  await env.BUCKET.put(TOKEN_KEY,JSON.stringify({iv:b64url(iv),ciphertext:b64url(new Uint8Array(ciphertext))}),{httpMetadata:{contentType:'application/json'}});
}
async function loadToken(env){
  const object=await env.BUCKET.get(TOKEN_KEY);
  if(!object)return null;
  const saved=await object.json(),key=await cryptKey(env);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeKey(saved.iv)},key,decodeKey(saved.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
function htmlResponse(message,status=200){
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jaden AI News 메일 설정</title><body style="font:16px system-ui;max-width:640px;margin:64px auto;padding:24px;color:#17212f"><h1>${html(message)}</h1><p><a href="/">Jaden AI News로 돌아가기</a></p></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export async function connectGmail(env,actor,url){
  if(actor?.role!=='owner')return new Response('소유자만 메일을 연결할 수 있습니다.',{status:403});
  const missing=['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_TOKEN_KEY'].filter(key=>!env[key]);
  if(missing.length)return htmlResponse('Sites 실행 환경에서 읽지 못하는 설정: '+missing.join(', '),503);
  const state=randomHex(),expiresAt=Date.now()+10*60*1000;
  await env.BUCKET.put(`private/gmail-oauth-state/${state}`,JSON.stringify({userId:actor.user_id,email:actor.email,expiresAt}),{httpMetadata:{contentType:'application/json'}});
  const redirectUri=`${url.origin}/api/google/callback`,auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id',env.GMAIL_CLIENT_ID);auth.searchParams.set('redirect_uri',redirectUri);
  auth.searchParams.set('response_type','code');auth.searchParams.set('scope',SCOPE);auth.searchParams.set('access_type','offline');
  auth.searchParams.set('prompt','consent select_account');auth.searchParams.set('login_hint',env.GMAIL_SENDER_EMAIL||'garzette@gmail.com');
  auth.searchParams.set('state',state);auth.searchParams.set('include_granted_scopes','true');
  return Response.redirect(auth.toString(),302);
}
export async function gmailCallback(env,request,url){
  const missing=['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_TOKEN_KEY'].filter(key=>!env[key]);
  if(missing.length)return htmlResponse('Sites 실행 환경에서 읽지 못하는 설정: '+missing.join(', '),503);
  const query=url.searchParams;
  if(query.has('error'))return htmlResponse('Google 메일 연결이 취소되었습니다.',400);
  const state=query.get('state'),code=query.get('code');
  if(!state||!/^[a-f0-9]{64}$/.test(state)||!code)return htmlResponse('인증 응답이 올바르지 않습니다. 사이트 소유자 메뉴에서 다시 연결해 주세요.',400);
  const stateKey=`private/gmail-oauth-state/${state}`,pending=await env.BUCKET.get(stateKey);
  if(!pending)return htmlResponse('인증 요청이 만료되었거나 이미 사용되었습니다. 다시 연결해 주세요.',400);
  await env.BUCKET.delete(stateKey);
  const owner=await pending.json();
  if(owner.expiresAt<Date.now())return htmlResponse('인증 요청이 만료되었습니다. 다시 연결해 주세요.',400);
  if(!env.DB||!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET)return htmlResponse('메일 발송 설정이 완료되지 않았습니다.',503);
  const current=await env.DB.prepare('SELECT user_id,email,role,status FROM users WHERE user_id = ?').bind(owner.userId).first();
  if(!current||current.role!=='owner'||current.status==='disabled'||current.email!==owner.email)return htmlResponse('소유자 확인에 실패했습니다. 다시 로그인해 연결해 주세요.',403);
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,redirect_uri:`${url.origin}/api/google/callback`,grant_type:'authorization_code'})});
  const token=await tokenResponse.json();
  if(!tokenResponse.ok||!token.refresh_token)return htmlResponse('Google이 장기 메일 연결을 발급하지 않았습니다. 소유자 메뉴에서 다시 연결해 주세요.',502);
  if(!String(token.scope||'').split(/\s+/).includes(SCOPE))return htmlResponse('Gmail 발송 권한이 승인되지 않았습니다. 다시 연결해 주세요.',403);
  await saveToken(env,{refresh_token:token.refresh_token,access_token:token.access_token,expires_at:Date.now()+Number(token.expires_in||3600)*1000});
  return htmlResponse('Gmail 발신 계정 연결이 완료되었습니다.');
}
async function accessToken(env){
  const missing=['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET'].filter(key=>!env[key]);
  if(missing.length)throw Object.assign(new Error('Sites 실행 환경에서 읽지 못하는 설정: '+missing.join(', ')),{status:503});
  const saved=await loadToken(env);
  if(!saved?.refresh_token)throw Object.assign(new Error('Gmail 발신 계정을 먼저 연결하세요.'),{status:503});
  if(saved.access_token&&saved.expires_at>Date.now()+60000)return saved.access_token;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,refresh_token:saved.refresh_token,grant_type:'refresh_token'})});
  const refreshed=await response.json();
  if(!response.ok||!refreshed.access_token)throw Object.assign(new Error(refreshed.error==='invalid_grant'?'Gmail 연결이 만료되었습니다. 소유자 메뉴에서 다시 연결하세요.':'Gmail 인증을 갱신할 수 없습니다.'),{status:502});
  const next={...saved,access_token:refreshed.access_token,expires_at:Date.now()+Number(refreshed.expires_in||3600)*1000};
  await saveToken(env,next);
  return next.access_token;
}
function validUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}}
function articleLines(articles){return articles.map((a,i)=>`${String(i+1).padStart(2,'0')}. ${a.titleKo||a.title||'제목 없음'}\n${a.publisher||'출처 미상'} · ${a.score??'—'}점 · ${a.publishedAt||'날짜 미상'}\n${a.displaySummary||a.summary||''}\n${validUrl(a.url)||''}`).join('\n\n');}
export function emailMarkup(state){
  const ranked=savedRanking(state),sections=recommendationSections(ranked),top=sections.top||ranked.slice(0,6),more=ranked.slice(6,50);
  const card=a=>`<article style="border:1px solid #dce3ed;border-radius:12px;padding:16px;margin:12px 0"><p style="margin:0 0 8px;color:#51647f">${html(a.publisher||'출처 미상')} · ${html(a.kind||'뉴스')} · ${html(a.publishedAt||'날짜 미상')}</p><h2 style="font-size:19px;margin:0 0 8px"><a style="color:#173b78" href="${html(validUrl(a.url)||'#')}">${html(a.titleKo||a.title||'제목 없음')}</a></h2>${a.title&&a.title!==a.titleKo?`<p style="margin:0 0 8px;color:#617086">${html(a.title)}</p>`:''}<p style="line-height:1.6;margin:0 0 10px">${html(a.displaySummary||a.summary||'설명 없음')}</p><strong style="font-size:18px;color:#174b9a">${html(a.score??'—')}점</strong></article>`;
  const title=`오늘의 SDS 맞춤형 AI News · ${new Date().toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}`;
  const markup=`<!doctype html><html lang="ko"><body style="font:15px Arial,'Malgun Gothic',sans-serif;color:#17212f;max-width:760px;margin:auto;padding:20px"><h1 style="font-size:24px">${html(title)}</h1><p>조회 전용 화면 · ${html(state.collectedAt||state.requestedAt||'수집 시각 미상')} 수집 · 총 ${ranked.length}건</p><h2>Top 6 뉴스</h2>${top.map(card).join('')||'<p>표시할 기사가 없습니다.</p>'}<h2>전체 순위</h2>${more.map((a,i)=>`<p style="border-bottom:1px solid #ddd;padding:10px 0"><b>${String(i+7).padStart(2,'0')} · ${html(a.score??'—')}점</b> · <a href="${html(validUrl(a.url)||'#')}">${html(a.titleKo||a.title||'제목 없음')}</a><br><span style="color:#58677a">${html(a.publisher||'출처 미상')} · ${html(a.displaySummary||a.summary||'설명 없음')}</span></p>`).join('')}</body></html>`;
  const plain=`${title}\n조회 전용 화면 · ${state.collectedAt||state.requestedAt||'수집 시각 미상'} 수집 · 총 ${ranked.length}건\n\nTop 6 뉴스\n${articleLines(top)}\n\n전체 순위\n${articleLines(more)}`;
  return {html:markup,plain,subject:title,count:ranked.length};
}
function mimeMessage({to,from,subject,html:bodyHtml,plain}){
  const boundary=`jaden-${randomHex()}`;
  const encodedSubject=`=?UTF-8?B?${b64(utf8(subject))}?=`;
  return [`To: ${to}`,`From: ${from}`,`Subject: ${encodedSubject}`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',wrap(b64(utf8(plain))),`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',wrap(b64(utf8(bodyHtml))),`--${boundary}--`,''].join('\r\n');
}
export async function sendViewerEmail(env,state){
  if(!savedRanking(state).length)throw Object.assign(new Error('발송할 뉴스가 없습니다. 먼저 뉴스를 수집해 주세요.'),{status:409});
  const recipients=await newsRecipients(env);
  if(!recipients.length)throw Object.assign(new Error('메일 수신이 체크된 사용자가 없습니다. 사용자 관리에서 수신 여부를 저장하세요.'),{status:409});
  const token=await accessToken(env),message=emailMarkup(state),messageIds=[];
  for(const recipient of recipients){
    const raw=b64url(utf8(mimeMessage({to:recipient,from:SENDER,...message})));
    const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw})});
    if(!response.ok){
      const failure=await response.json().catch(()=>({}));
      const reason=failure.error?.errors?.[0]?.reason;
      const message=response.status===401?'Gmail 연결이 만료되었습니다. 소유자가 다시 연결해 주세요.':reason==='accessNotConfigured'?'Google Cloud에서 Gmail API를 사용 설정해 주세요.':response.status===403?'Gmail 발송 권한이 없거나 발송 한도에 도달했습니다. Google 설정을 확인해 주세요.':'Gmail이 메일 발송을 거부했습니다. 잠시 후 다시 시도해 주세요.';
      throw Object.assign(new Error(messageIds.length?`${messageIds.length}명 발송 완료 후 중단: ${message}`:message),{status:502});
    }
    const result=await response.json();
    if(!result.id)throw Object.assign(new Error('Gmail 발송 확인을 받지 못했습니다.'),{status:502});
    messageIds.push(result.id);
  }
  const sentAt=new Date().toISOString();
  await env.BUCKET.put('private/gmail-last-send.json',JSON.stringify({sentAt,messageIds,recipientCount:recipients.length}),{httpMetadata:{contentType:'application/json'}});
  return {ok:true,count:message.count,messageIds,recipientCount:recipients.length,sentAt};
}
